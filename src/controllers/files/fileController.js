const { getConnectedPool } = require('../../config/database');
const { uploadFile, downloadFile, deleteFile } = require('../../config/azureBlobService');
const multer = require('multer');
const path = require('path');
const openAIService = require('../../config/openAIService');
const archiver = require('archiver');

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow all file types for now
        cb(null, true);
    }
});

// Deduplicate concurrent ensure calls per tender+project on the backend side.
const ensureTenderFolderInFlight = new Map();

const safeParseJson = (rawValue) => {
    if (!rawValue) return null;
    try {
        return JSON.parse(rawValue);
    } catch {
        return null;
    }
};

const fileController = {
    // Get all folders for the authenticated user
    getAllFolders: async (req, res) => {
        try {
            const startedAt = Date.now();
            const pool = await getConnectedPool();

            const result = await pool.request()
                .query(`
                    SELECT
                        f.FolderID,
                        f.ParentFolderID,
                        f.FolderName,
                        f.FolderPath,
                        f.FolderType,
                        f.DisplayOrder,
                        f.IsActive,
                        f.CreatedAt,
                        f.UpdatedAt,
                        f.DocID,
                        f.ConnectionTable
                    FROM tenderFolder f WITH (READUNCOMMITTED)
                    WHERE f.IsActive = 1
                    ORDER BY f.ParentFolderID, f.FolderID
                `);

            const allFolders = result.recordset.map(folder => ({
                id: folder.FolderID,
                name: folder.FolderName,
                path: folder.FolderPath,
                parentFolderId: folder.ParentFolderID,
                folderType: folder.FolderType,
                displayOrder: folder.DisplayOrder,
                isActive: folder.IsActive,
                createdAt: folder.CreatedAt,
                updatedAt: folder.UpdatedAt,
                docId: folder.DocID,
                connectionTable: folder.ConnectionTable,
                createdBy: null
            }));

            const elapsed = Date.now() - startedAt;
            if (elapsed > 2000) {
                console.warn(`[getAllFolders] Slow query: ${elapsed}ms, rows=${allFolders.length}`);
            }
            res.json({ folders: allFolders });
        } catch (error) {
            console.error('Error getting folders:', {
                message: error.message,
                code: error.code,
                number: error.number
            });
            res.status(500).json({ message: 'Failed to get folders' });
        }
    },

    // Get child folders of a given folder
    getChildFolders: async (req, res) => {
        try {
            const { folderId } = req.params;
            const pool = await getConnectedPool();

            const result = await pool.request()
                .input('ParentFolderID', folderId)
                .query(`
                    SELECT FolderID, FolderName, FolderPath, ParentFolderID, DocID, ConnectionTable
                    FROM tenderFolder
                    WHERE ParentFolderID = @ParentFolderID AND IsActive = 1
                    ORDER BY FolderName
                `);

            res.json({ folders: result.recordset.map(f => ({
                id: f.FolderID,
                name: f.FolderName,
                path: f.FolderPath,
                parentId: f.ParentFolderID,
                docId: f.DocID,
                connectionTable: f.ConnectionTable
            })) });
        } catch (error) {
            console.error('Error getting child folders:', error);
            res.status(500).json({ message: 'Failed to get child folders' });
        }
    },

    // Get files by folder ID
    getFilesByFolder: async (req, res) => {
        try {
            const { folderId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const result = await pool.request()
                .input('FolderID', folderId)
                .input('UserID', userId)
                .query(`
                    SELECT 
                        f.FileID as id,
                        f.DisplayName as name,
                        f.ContentType as contentType,
                        f.Size as size,
                        f.UploadedOn as uploadedOn,
                        f.CreatedAt as createdAt,
                        f.UpdatedAt as updatedAt,
                        f.FolderID as folderId,
                        f.DocID as docId,
                        f.ConnectionTable as connectionTable,
                        f.Metadata as metadata,
                        fl.FolderName as folderName,
                        fl.FolderPath as folderPath,
                        u.Name as uploadedBy,
                        CASE WHEN ff.FileFavID IS NOT NULL THEN 1 ELSE 0 END as isStarred
                    FROM tenderFile f
                    LEFT JOIN tenderFolder fl ON f.FolderID = fl.FolderID
                    LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                    LEFT JOIN tenderFileFav ff ON f.FileID = ff.FileID AND ff.UserID = @UserID
                    WHERE f.FolderID = @FolderID 
                    AND f.IsDeleted = 0
                    ORDER BY f.CreatedAt DESC
                `);

            // Map the results to frontend format
            const files = result.recordset.map(file => ({
                id: file.id,
                name: file.name,
                type: getFileType(file.contentType, file.name),
                size: file.size,
                uploadedOn: file.uploadedOn,
                createdAt: file.createdAt,
                updatedAt: file.updatedAt,
                folderId: file.folderId,
                folderName: file.folderName,
                folderPath: file.folderPath,
                docId: file.docId,
                connectionTable: file.connectionTable,
                metadata: file.metadata ? JSON.parse(file.metadata) : null,
                uploadedBy: file.uploadedBy,
                isStarred: file.isStarred === 1
            }));

            res.json({ files });
        } catch (error) {
            console.error('Error getting files by folder:', error);
            res.status(500).json({ message: 'Failed to get files' });
        }
    },

    // Get ALL files recursively from a folder and all its subfolders (any depth)
    getFilesRecursive: async (req, res) => {
        try {
            const { folderId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            // Use a CTE to walk the folder tree starting from folderId (only active subfolders)
            const result = await pool.request()
                .input('RootFolderID', parseInt(folderId))
                .input('UserID', userId)
                .query(`
                    ;WITH FolderTree AS (
                        SELECT FolderID, FolderName, ParentFolderID, CAST('' AS NVARCHAR(MAX)) AS FolderLabel
                        FROM tenderFolder
                        WHERE FolderID = @RootFolderID
                        UNION ALL
                        SELECT c.FolderID, c.FolderName, c.ParentFolderID,
                            CASE WHEN ft.FolderID = @RootFolderID THEN c.FolderName
                                 ELSE CAST(ft.FolderLabel + ' / ' + c.FolderName AS NVARCHAR(MAX))
                            END
                        FROM tenderFolder c
                        INNER JOIN FolderTree ft ON c.ParentFolderID = ft.FolderID
                        WHERE c.IsActive = 1
                    )
                    SELECT
                        f.FileID as id,
                        f.DisplayName as name,
                        f.ContentType as contentType,
                        f.Size as size,
                        f.UploadedOn as uploadedOn,
                        f.CreatedAt as createdAt,
                        f.FolderID as folderId,
                        f.DocID as docId,
                        f.Metadata as metadata,
                        ft.FolderName as folderName,
                        ft.FolderLabel as folderLabel,
                        ft.FolderID as folderFolderId,
                        u.Name as uploadedBy,
                        CASE WHEN fv.FileFavID IS NOT NULL THEN 1 ELSE 0 END as isStarred
                    FROM FolderTree ft
                    INNER JOIN tenderFile f ON f.FolderID = ft.FolderID AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
                    LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                    LEFT JOIN tenderFileFav fv ON f.FileID = fv.FileID AND fv.UserID = @UserID
                    ORDER BY ft.FolderLabel, f.DisplayName
                `);

            // Also get the list of subfolders (for showing empty ones)
            const foldersResult = await pool.request()
                .input('RootFolderID', parseInt(folderId))
                .query(`
                    ;WITH FolderTree AS (
                        SELECT FolderID, FolderName, ParentFolderID, CAST('' AS NVARCHAR(MAX)) AS FolderLabel
                        FROM tenderFolder
                        WHERE FolderID = @RootFolderID
                        UNION ALL
                        SELECT c.FolderID, c.FolderName, c.ParentFolderID,
                            CASE WHEN ft.FolderID = @RootFolderID THEN c.FolderName
                                 ELSE CAST(ft.FolderLabel + ' / ' + c.FolderName AS NVARCHAR(MAX))
                            END
                        FROM tenderFolder c
                        INNER JOIN FolderTree ft ON c.ParentFolderID = ft.FolderID
                        WHERE c.IsActive = 1
                    )
                    SELECT FolderID, FolderName, FolderLabel
                    FROM FolderTree
                    WHERE FolderID != @RootFolderID
                `);

            const files = result.recordset.map(file => ({
                id: file.id,
                name: file.name,
                type: getFileType(file.contentType, file.name),
                contentType: file.contentType,
                size: file.size,
                uploadedOn: file.uploadedOn,
                createdAt: file.createdAt,
                folderId: file.folderId,
                docId: file.docId,
                folderName: file.folderName,
                folderLabel: file.folderFolderId === parseInt(folderId) ? null : file.folderLabel,
                metadata: file.metadata ? JSON.parse(file.metadata) : null,
                uploadedBy: file.uploadedBy,
                isStarred: file.isStarred === 1
            }));

            const subfolders = foldersResult.recordset.map(f => ({
                id: f.FolderID,
                name: f.FolderName,
                label: f.FolderLabel
            }));

            res.json({ files, subfolders });
        } catch (error) {
            console.error('Error getting files recursively:', error);
            res.status(500).json({ message: 'Failed to get files recursively' });
        }
    },

    // Check and create task folder if it doesn't exist (UPDATED with DocID and ConnectionTable)
    ensureTaskFolder: async (req, res) => {
        try {
            const { taskId, taskDescription } = req.body;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            if (!taskId || !taskDescription) {
                return res.status(400).json({ message: 'Task ID and description are required' });
            }

            // First, get the Tasks folder ID
            const tasksFolderResult = await pool.request()
                .query(`
                    SELECT FolderID 
                    FROM tenderFolder 
                    WHERE FolderName = 'Tasks' AND FolderType = 'main'
                `);

            if (tasksFolderResult.recordset.length === 0) {
                return res.status(404).json({ message: 'Tasks folder not found' });
            }

            const tasksFolderId = tasksFolderResult.recordset[0].FolderID;
            const taskFolderName = `${taskId} - ${taskDescription}`;
            const taskFolderPath = `/Tasks/${taskFolderName}`;

            // Use a transaction to atomically check and create folder
            // This prevents race conditions when multiple requests come in simultaneously
            const transaction = pool.transaction();
            
            try {
                await transaction.begin();
                
                const request = transaction.request();
                
                // Declare all parameters once for both queries (to avoid duplicate parameter error)
                request
                    .input('DocID', taskId)
                    .input('ConnectionTable', 'tenderTask')
                    .input('ParentFolderID', tasksFolderId)
                    .input('FolderName', taskFolderName)
                    .input('FolderPath', taskFolderPath)
                    .input('FolderType', 'sub')
                    .input('AddBy', userId);
                
                // Check if folder exists with UPDLOCK and HOLDLOCK to prevent concurrent inserts
                const existingFolderResult = await request
                    .query(`
                        SELECT FolderID, FolderPath, FolderName
                        FROM tenderFolder WITH (UPDLOCK, HOLDLOCK)
                        WHERE DocID = @DocID 
                          AND ConnectionTable = @ConnectionTable 
                          AND ParentFolderID = @ParentFolderID
                    `);

                if (existingFolderResult.recordset.length > 0) {
                    // Folder exists, commit and return
                    await transaction.commit();
                    const existingFolder = existingFolderResult.recordset[0];
                    return res.json({ 
                        folderId: existingFolder.FolderID,
                        folderPath: existingFolder.FolderPath,
                        folderName: existingFolder.FolderName,
                        exists: true,
                        docId: taskId,
                        connectionTable: 'tenderTask'
                    });
                }

                // Folder doesn't exist, create it (using same request object with already-declared parameters)
                const insertResult = await request
                    .query(`
                        INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                        OUTPUT INSERTED.FolderID, INSERTED.FolderPath, INSERTED.FolderName
                        VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                    `);

                await transaction.commit();

                const newFolder = insertResult.recordset[0];
                
                res.json({ 
                    folderId: newFolder.FolderID,
                    folderPath: newFolder.FolderPath,
                    folderName: newFolder.FolderName,
                    exists: false,
                    docId: taskId,
                    connectionTable: 'tenderTask'
                });
            } catch (insertError) {
                await transaction.rollback();
                
                // If insert failed, check if folder was created by another concurrent request
                const checkResult = await pool.request()
                    .input('DocID', taskId)
                    .input('ConnectionTable', 'tenderTask')
                    .input('ParentFolderID', tasksFolderId)
                    .query(`
                        SELECT FolderID, FolderPath, FolderName
                        FROM tenderFolder 
                        WHERE DocID = @DocID 
                          AND ConnectionTable = @ConnectionTable 
                          AND ParentFolderID = @ParentFolderID
                    `);

                if (checkResult.recordset.length > 0) {
                    // Folder was created by another request, return it
                    const existingFolder = checkResult.recordset[0];
                    return res.json({ 
                        folderId: existingFolder.FolderID,
                        folderPath: existingFolder.FolderPath,
                        folderName: existingFolder.FolderName,
                        exists: true,
                        docId: taskId,
                        connectionTable: 'tenderTask'
                    });
                }
                
                // Re-throw the error if folder still doesn't exist
                throw insertError;
            }

        } catch (error) {
            console.error('Error ensuring task folder:', error);
            res.status(500).json({ message: 'Failed to ensure task folder' });
        }
    },

    // Check and create tender folder (and standard subfolders) if it doesn't exist
    ensureTenderFolder: async (req, res) => {
        try {
            const { tenderId, projectName } = req.body;
            const userId = req.user.UserID;

            if (!tenderId || !projectName) {
                return res.status(400).json({ message: 'tenderId and projectName are required' });
            }

            const rootTenderFolderId = 2; // Parent "Tender" folder
            const safeProjectName = String(projectName || '').trim();
            const tenderFolderName = `${tenderId} - ${safeProjectName}`;
            const tenderFolderPath = `/Tender/${tenderFolderName}`;
            const dedupeKey = `${tenderId}|${safeProjectName.toLowerCase()}`;

            // If same ensure request is currently running, reuse its result.
            if (ensureTenderFolderInFlight.has(dedupeKey)) {
                console.log(`[ensureTenderFolder] Reusing in-flight ensure for key: ${dedupeKey}`);
                const payload = await ensureTenderFolderInFlight.get(dedupeKey);
                return res.json(payload);
            }

            const ensureWork = (async () => {
                const startedAt = Date.now();
                const pool = await getConnectedPool();

                const subNames = [
                    '01. Tender Issue',
                    '02. Addendums & Clarifications & RFIs',
                    '03. Site Photos',
                    '04. BOQ Trade Packages',
                    '05. Draft BOQ & Prelimns',
                    '06. Quotes',
                    '07. Programme',
                    '08. Tender Submitted',
                    '09. Post Tender Clarifications',
                    '10. Final Contract Documents',
                    '11. Brian & Steven Work in Progress'
                ];

                const requiredPaths = [
                    tenderFolderPath,
                    ...subNames.map(name => `${tenderFolderPath}/${name}`),
                    `${tenderFolderPath}/01. Tender Issue/Drawings`
                ];

                // Preload all required folder paths in one indexed query.
                const preloadReq = pool.request();
                requiredPaths.forEach((folderPath, idx) => preloadReq.input(`Path${idx}`, folderPath));
                const inParams = requiredPaths.map((_, idx) => `@Path${idx}`).join(', ');
                const existingRows = await preloadReq.query(`
                    SELECT FolderID, FolderPath, IsActive
                    FROM tenderFolder
                    WHERE FolderPath IN (${inParams})
                `);

                const existingByPath = new Map(existingRows.recordset.map(r => [r.FolderPath, r]));

                const ensureFolderByPath = async ({ folderName, folderPath, parentFolderID, docID, connectionTable, folderType = 'sub' }) => {
                    const existing = existingByPath.get(folderPath);
                    if (existing) {
                        if (!existing.IsActive) {
                            await pool.request()
                                .input('FolderID', existing.FolderID)
                                .query(`
                                    UPDATE tenderFolder
                                    SET IsActive = 1, UpdatedAt = GETDATE()
                                    WHERE FolderID = @FolderID
                                `);
                            existing.IsActive = 1;
                        }
                        return existing.FolderID;
                    }

                    try {
                        const inserted = await pool.request()
                            .input('FolderName', folderName)
                            .input('FolderPath', folderPath)
                            .input('FolderType', folderType)
                            .input('ParentFolderID', parentFolderID)
                            .input('AddBy', userId)
                            .input('DocID', docID)
                            .input('ConnectionTable', connectionTable)
                            .query(`
                                INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable, IsActive)
                                OUTPUT INSERTED.FolderID
                                VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable, 1)
                            `);
                        const newId = inserted.recordset[0]?.FolderID;
                        if (newId) {
                            existingByPath.set(folderPath, { FolderID: newId, FolderPath: folderPath, IsActive: 1 });
                        }
                        return newId;
                    } catch (insertErr) {
                        if (insertErr && (insertErr.number === 2601 || insertErr.number === 2627)) {
                            const afterConflict = await pool.request()
                                .input('FolderPath', folderPath)
                                .query(`
                                    SELECT TOP 1 FolderID
                                    FROM tenderFolder
                                    WHERE FolderPath = @FolderPath
                                `);
                            if (afterConflict.recordset.length > 0) {
                                const resolvedId = afterConflict.recordset[0].FolderID;
                                existingByPath.set(folderPath, { FolderID: resolvedId, FolderPath: folderPath, IsActive: 1 });
                                return resolvedId;
                            }
                        }
                        throw insertErr;
                    }
                };

                const tenderFolderId = await ensureFolderByPath({
                    folderName: tenderFolderName,
                    folderPath: tenderFolderPath,
                    parentFolderID: rootTenderFolderId,
                    docID: tenderId,
                    connectionTable: 'tenderTender',
                    folderType: 'sub'
                });

                const subfolderIds = {};
                for (const name of subNames) {
                    const subPath = `${tenderFolderPath}/${name}`;
                    subfolderIds[name] = await ensureFolderByPath({
                        folderName: name,
                        folderPath: subPath,
                        parentFolderID: tenderFolderId,
                        docID: tenderId,
                        connectionTable: 'tenderTender',
                        folderType: 'sub'
                    });
                }

                const tenderIssueFolderId = subfolderIds['01. Tender Issue'];
                if (tenderIssueFolderId) {
                    const drawingsPath = `${tenderFolderPath}/01. Tender Issue/Drawings`;
                    subfolderIds.Drawings = await ensureFolderByPath({
                        folderName: 'Drawings',
                        folderPath: drawingsPath,
                        parentFolderID: tenderIssueFolderId,
                        docID: tenderId,
                        connectionTable: 'tenderTender',
                        folderType: 'sub'
                    });
                }

                const elapsed = Date.now() - startedAt;
                if (elapsed > 3000) {
                    console.warn(`[ensureTenderFolder] Slow ensure for tender ${tenderId}: ${elapsed}ms`);
                }

                return {
                    folderId: tenderFolderId,
                    folderPath: tenderFolderPath,
                    subfolders: subfolderIds
                };
            })();

            ensureTenderFolderInFlight.set(dedupeKey, ensureWork);
            try {
                const payload = await ensureWork;
                return res.json(payload);
            } finally {
                ensureTenderFolderInFlight.delete(dedupeKey);
            }
        } catch (error) {
            console.error('Error ensuring tender folder:', error);
            console.error('Error stack:', error.stack);
            res.status(500).json({ 
                message: 'Failed to ensure tender folder',
                error: error.message,
                details: error.toString()
            });
        }
    },

    // Create subfolder in tender folder
    createSubfolder: async (req, res) => {
        try {
            const { parentFolderId } = req.params;
            const { folderName } = req.body;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            if (!folderName || folderName.trim() === '') {
                return res.status(400).json({ message: 'Folder name is required' });
            }

            if (folderName.trim().toLowerCase() === 'drawings') {
                return res.status(400).json({ message: 'Cannot create a folder named "Drawings" — this name is reserved.' });
            }

            // Validate parent folder exists and is a tender folder
            const parentFolderResult = await pool.request()
                .input('ParentFolderID', parentFolderId)
                .query(`
                    SELECT FolderID, FolderName, FolderPath, FolderType, DocID, ConnectionTable
                    FROM tenderFolder 
                    WHERE FolderID = @ParentFolderID AND IsActive = 1
                `);

            if (parentFolderResult.recordset.length === 0) {
                return res.status(404).json({ message: 'Parent folder not found' });
            }

            const parentFolder = parentFolderResult.recordset[0];
            
            // Check if parent is a tender folder (should have DocID and ConnectionTable)
            if (!parentFolder.DocID || !parentFolder.ConnectionTable) {
                return res.status(400).json({ message: 'Can only create subfolders in tender folders' });
            }

            // Check if subfolder with same name already exists (active or soft-deleted)
            const existingFolderResult = await pool.request()
                .input('ParentFolderID', parentFolderId)
                .input('FolderName', folderName.trim())
                .query(`
                    SELECT FolderID, FolderName, FolderPath, IsActive
                    FROM tenderFolder 
                    WHERE ParentFolderID = @ParentFolderID
                      AND LOWER(LTRIM(RTRIM(FolderName))) = LOWER(LTRIM(RTRIM(@FolderName)))
                `);

            let newFolder;
            if (existingFolderResult.recordset.length > 0) {
                const existing = existingFolderResult.recordset[0];
                if (existing.IsActive) {
                    return res.status(409).json({ 
                        message: 'A folder with this name already exists',
                        folder: { id: existing.FolderID, name: existing.FolderName, path: existing.FolderPath }
                    });
                }
                // Reactivate soft-deleted folder
                await pool.request()
                    .input('FolderID', existing.FolderID)
                    .query(`UPDATE tenderFolder SET IsActive = 1, UpdatedAt = GETDATE() WHERE FolderID = @FolderID`);
                newFolder = { FolderID: existing.FolderID, FolderName: existing.FolderName, FolderPath: existing.FolderPath };
            } else {
                // Construct the new folder path
                const newFolderPath = `${parentFolder.FolderPath}/${folderName.trim()}`;

                // Create the subfolder
                const insertResult = await pool.request()
                    .input('FolderName', folderName.trim())
                    .input('FolderPath', newFolderPath)
                    .input('FolderType', 'sub')
                    .input('ParentFolderID', parentFolderId)
                    .input('AddBy', userId)
                    .input('DocID', parentFolder.DocID)
                    .input('ConnectionTable', parentFolder.ConnectionTable)
                    .query(`
                        INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable, IsActive)
                        OUTPUT INSERTED.FolderID, INSERTED.FolderPath, INSERTED.FolderName
                        VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable, 1)
                    `);
                newFolder = insertResult.recordset[0];
            }
            
            res.status(201).json({
                message: 'Subfolder created successfully',
                folder: {
                    id: newFolder.FolderID,
                    name: newFolder.FolderName,
                    path: newFolder.FolderPath,
                    parentId: parentFolderId,
                    docId: parentFolder.DocID,
                    connectionTable: parentFolder.ConnectionTable
                }
            });

        } catch (error) {
            console.error('Error creating subfolder:', error);
            res.status(500).json({ message: 'Failed to create subfolder' });
        }
    },

    // Delete folder recursively — deletes all child subfolders and files inside
    deleteFolder: async (req, res) => {
        try {
            const { folderId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const folderResult = await pool.request()
                .input('FolderID', folderId)
                .query(`
                    SELECT FolderID, FolderName, FolderPath, FolderType, AddBy, DocID, ConnectionTable, ParentFolderID
                    FROM tenderFolder 
                    WHERE FolderID = @FolderID AND IsActive = 1
                `);

            if (folderResult.recordset.length === 0) {
                return res.status(404).json({ message: 'Folder not found' });
            }

            const folder = folderResult.recordset[0];

            // Block deletion of the 11 standard tender subfolders (direct children of a tender root folder)
            const protectedPattern = /^\d{2}\.\s/;
            if (protectedPattern.test(folder.FolderName)) {
                const parentCheck = await pool.request()
                    .input('ParentID', folder.ParentFolderID)
                    .query(`SELECT ParentFolderID FROM tenderFolder WHERE FolderID = @ParentID`);
                const grandparentId = parentCheck.recordset[0]?.ParentFolderID;
                if (grandparentId === 2) {
                    return res.status(400).json({ 
                        message: `Cannot delete system folder "${folder.FolderName}".` 
                    });
                }
            }

            // Recursive helper: collect all folder IDs in the subtree (depth-first)
            const collectFolderIds = async (parentId) => {
                const childResult = await pool.request()
                    .input('PID', parentId)
                    .query(`SELECT FolderID FROM tenderFolder WHERE ParentFolderID = @PID AND IsActive = 1`);
                let ids = [];
                for (const child of childResult.recordset) {
                    const childIds = await collectFolderIds(child.FolderID);
                    ids = ids.concat(childIds);
                }
                ids.push(parentId);
                return ids;
            };

            const allFolderIds = await collectFolderIds(parseInt(folderId));

            let deletedFiles = 0;
            const allDeletedFileIds = [];

            for (const fid of allFolderIds) {
                const filesInFolder = await pool.request()
                    .input('FolderID', fid)
                    .query(`SELECT FileID, BlobPath FROM tenderFile WHERE FolderID = @FolderID AND IsDeleted = 0`);

                for (const f of filesInFolder.recordset) {
                    try {
                        if (f.BlobPath) {
                            const { deleteFile: deleteBlobFile } = require('../../config/azureBlobService');
                            await deleteBlobFile(f.BlobPath);
                        }
                    } catch (blobErr) {
                        console.warn('Warning: Failed to delete blob during folder delete:', (blobErr && blobErr.message) || blobErr);
                    }
                    await pool.request()
                        .input('FileID', f.FileID)
                        .query(`UPDATE tenderFile SET IsDeleted = 1 WHERE FileID = @FileID`);

                    allDeletedFileIds.push(f.FileID);
                    deletedFiles++;
                }

                await pool.request()
                    .input('FID', fid)
                    .query(`UPDATE tenderFolder SET IsActive = 0, UpdatedAt = GETDATE() WHERE FolderID = @FID`);
            }

            // Bulk-delete all tenderDrawing records for this tender's DocID
            const docId = folder.DocID;
            if (docId) {
                try {
                    const delResult = await pool.request()
                        .input('TenderID', docId)
                        .query(`DELETE FROM tenderDrawing WHERE TenderID = @TenderID`);
                    console.log(`Deleted ${delResult.rowsAffected[0]} drawing records for TenderID ${docId}`);
                } catch (drawingErr) {
                    console.warn('Could not bulk-delete tenderDrawing by TenderID:', (drawingErr && drawingErr.message) || drawingErr);
                }
            }

            res.json({
                message: 'Folder deleted successfully',
                folderName: folder.FolderName,
                deletedFiles,
                deletedFolders: allFolderIds.length
            });

        } catch (error) {
            console.error('Error deleting folder:', error);
            res.status(500).json({ message: 'Failed to delete folder' });
        }
    },

    // Get files by document ID and connection table (NEW FUNCTION)
    getFilesByDocument: async (req, res) => {
        try {
            const { docId, connectionTable } = req.params;
            const includeDeleted = req.query.includeDeleted === 'true' || req.query.includeDeleted === '1';
            
            // Validate parameters
            if (!docId || docId === 'undefined' || !connectionTable || connectionTable === 'undefined') {
                return res.json({ files: [] });
            }
            
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            // Build query - for RFQ files, include deleted files since they might be needed for comparison
            const isRFQ = connectionTable && connectionTable.toLowerCase().includes('tenderpackagerfq');
            const query = isRFQ || includeDeleted ? `
                    SELECT 
    f.FileID as id,
    f.DisplayName as name,
    f.ContentType as contentType,
    f.Size as size,
    f.UploadedOn as uploadedOn,
    f.CreatedAt as createdAt,
    f.UpdatedAt as updatedAt,
    f.FolderID as folderId,
    f.DocID as docId,
    f.ConnectionTable as connectionTable,
    f.Metadata as metadata,
    f.IsDeleted as isDeleted,
    fl.FolderName as folderName,
    fl.FolderPath as folderPath,
    u.Name as uploadedBy,
    CASE WHEN ff.FileFavID IS NOT NULL THEN 1 ELSE 0 END as isStarred
FROM tenderFile f
LEFT JOIN tenderFolder fl ON f.FolderID = fl.FolderID
LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
LEFT JOIN tenderFileFav ff ON f.FileID = ff.FileID AND ff.UserID = @UserID
WHERE f.DocID = @DocID 
  AND f.ConnectionTable = @ConnectionTable
ORDER BY f.CreatedAt DESC;
                ` : `
                    SELECT 
    f.FileID as id,
    f.DisplayName as name,
    f.ContentType as contentType,
    f.Size as size,
    f.UploadedOn as uploadedOn,
    f.CreatedAt as createdAt,
    f.UpdatedAt as updatedAt,
    f.FolderID as folderId,
    f.DocID as docId,
    f.ConnectionTable as connectionTable,
    f.Metadata as metadata,
    f.IsDeleted as isDeleted,
    fl.FolderName as folderName,
    fl.FolderPath as folderPath,
    u.Name as uploadedBy,
    CASE WHEN ff.FileFavID IS NOT NULL THEN 1 ELSE 0 END as isStarred
FROM tenderFile f
LEFT JOIN tenderFolder fl ON f.FolderID = fl.FolderID
LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
LEFT JOIN tenderFileFav ff ON f.FileID = ff.FileID AND ff.UserID = @UserID
WHERE f.DocID = @DocID 
  AND f.ConnectionTable = @ConnectionTable
  AND f.IsDeleted = 0
ORDER BY f.CreatedAt DESC;
                `;

            const result = await pool.request()
                .input('DocID', docId)
                .input('ConnectionTable', connectionTable)
                .input('UserID', userId)
                .query(query);

            // Map the results to frontend format
            const files = result.recordset.map(file => ({
                id: file.id,
                name: file.name,
                type: getFileType(file.contentType, file.name),
                size: file.size,
                uploadedOn: file.uploadedOn,
                createdAt: file.createdAt,
                updatedAt: file.updatedAt,
                folderId: file.folderId,
                folderName: file.folderName,
                folderPath: file.folderPath,
                uploadedBy: file.uploadedBy,
                docId: file.docId,
                connectionTable: file.connectionTable,
                metadata: file.metadata ? JSON.parse(file.metadata) : null,
                isStarred: file.isStarred === 1
            }));

            res.json({ files });
        } catch (error) {
            console.error('Error getting files by document:', error);
            res.status(500).json({ message: 'Failed to get files' });
        }
    },

    // Get all files for the authenticated user (updated to include folder info)
    getAllFiles: async (req, res) => {
        try {
            const startedAt = Date.now();
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const result = await pool.request()
                .input('UserID', userId)
                .query(`
                    SELECT TOP 50
                        f.FileID,
                        f.DisplayName,
                        f.BlobPath,
                        f.UploadedOn,
                        f.Size,
                        f.ContentType,
                        f.Status,
                        f.CreatedAt,
                        f.UpdatedAt,
                        f.DocID,
                        f.ConnectionTable,
                        f.Metadata,
                        u.Name as UploadedBy,
                        tf.FolderID,
                        tf.FolderName,
                        tf.FolderPath,
                        CASE WHEN ff.FileFavID IS NOT NULL THEN 1 ELSE 0 END as isStarred
                    FROM tenderFile f WITH (READUNCOMMITTED)
                    LEFT JOIN tenderEmployee u WITH (READUNCOMMITTED) ON f.AddBy = u.UserID
                    LEFT JOIN tenderFolder tf WITH (READUNCOMMITTED) ON f.FolderID = tf.FolderID
                    LEFT JOIN tenderFileFav ff WITH (READUNCOMMITTED) ON f.FileID = ff.FileID AND ff.UserID = @UserID
                    WHERE f.IsDeleted = 0 AND f.AddBy = @UserID
                    ORDER BY f.FileID DESC
                `);

            const files = result.recordset.map(file => ({
                id: file.FileID,
                name: file.DisplayName,
                blobPath: file.BlobPath,
                uploadedOn: file.UploadedOn,
                size: file.Size,
                contentType: file.ContentType,
                status: file.Status,
                createdAt: file.CreatedAt,
                updatedAt: file.UpdatedAt,
                uploadedBy: file.UploadedBy,
                folderId: file.FolderID,
                folderName: file.FolderName,
                folderPath: file.FolderPath,
                docId: file.DocID,
                connectionTable: file.ConnectionTable,
                metadata: safeParseJson(file.Metadata),
                type: getFileType(file.ContentType, file.DisplayName),
                isStarred: file.isStarred === 1
            }));

            const elapsed = Date.now() - startedAt;
            if (elapsed > 2000) {
                console.warn(`[getAllFiles] Slow query for user ${userId}: ${elapsed}ms, rows=${files.length}`);
            }
            res.json({ files });
        } catch (error) {
            console.error('Error getting files:', {
                message: error.message,
                code: error.code,
                number: error.number
            });
            res.status(500).json({ message: 'Failed to get files' });
        }
    },

    // Get file metadata by ID
    getFileMetadata: async (req, res) => {
        try {
            const { fileId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const result = await pool.request()
                .input('FileID', fileId)
                .input('UserID', userId)
                .query(`
                    SELECT 
                        f.FileID,
                        f.DisplayName as fileName,
                        f.ContentType as contentType,
                        f.Metadata as metadata,
                        f.ExtractedText as extractedText,
                        f.CreatedAt as createdAt,
                        f.UpdatedAt as updatedAt,
                        f.Size as size,
                        u.Name as uploadedBy
                    FROM tenderFile f
                    LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                    WHERE f.FileID = @FileID 
                    AND f.IsDeleted = 0
                    AND f.AddBy = @UserID
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            const file = result.recordset[0];
            const metadata = file.metadata ? JSON.parse(file.metadata) : null;

            res.json({
                metadata: metadata,
                fileName: file.fileName,
                contentType: file.contentType,
                extractedText: file.extractedText,
                textLength: file.extractedText ? file.extractedText.length : 0,
                createdAt: file.createdAt,
                updatedAt: file.updatedAt,
                size: file.size,
                uploadedBy: file.uploadedBy
            });

        } catch (error) {
            console.error('Error getting file metadata:', error);
            res.status(500).json({ message: 'Failed to get file metadata' });
        }
    },

    // Get file by ID
    getFileById: async (req, res) => {
        try {
            const { fileId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const result = await pool.request()
                .input('FileID', fileId)
                .input('UserID', userId)
                .query(`
                    SELECT 
                        f.FileID,
                        f.DisplayName,
                        f.BlobPath,
                        f.UploadedOn,
                        f.Size,
                        f.ContentType,
                        f.Status,
                        f.CreatedAt,
                        f.UpdatedAt,
                        f.DocID,
                        f.ConnectionTable,
                        f.Metadata,
                        u.Name as UploadedBy,
                        tf.FolderID,
                        tf.FolderName,
                        tf.FolderPath
                    FROM tenderFile f
                    LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                    LEFT JOIN tenderFolder tf ON f.FolderID = tf.FolderID
                    WHERE f.FileID = @FileID AND f.IsDeleted = 0
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            const file = result.recordset[0];
            res.json({
                id: file.FileID,
                name: file.DisplayName,
                blobPath: file.BlobPath,
                uploadedOn: file.UploadedOn,
                size: file.Size,
                contentType: file.ContentType,
                status: file.Status,
                createdAt: file.CreatedAt,
                updatedAt: file.UpdatedAt,
                uploadedBy: file.UploadedBy,
                folderId: file.FolderID,
                folderName: file.FolderName,
                folderPath: file.FolderPath,
                docId: file.DocID,
                connectionTable: file.ConnectionTable,
                type: getFileType(file.ContentType, file.DisplayName),
                metadata: file.Metadata ? JSON.parse(file.Metadata) : null
            });
        } catch (error) {
            console.error('Error getting file:', error);
            res.status(500).json({ message: 'Failed to get file' });
        }
    },

    // Test file upload without Azure storage
    testFileUpload: async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            const pool = await getConnectedPool();
            const userId = req.user.UserID;
            const { originalname, buffer, mimetype, size } = req.file;

            console.log('Test file upload:', {
                fileName: originalname,
                contentType: mimetype,
                size: size,
                userId
            });

            // Extract metadata using OpenAI
            const metadata = await openAIService.extractMetadata(buffer, originalname, mimetype);
            
            console.log('Metadata extraction result:', {
                hasMetadata: !!metadata,
                hasText: !!(metadata && metadata.extractedText),
                textLength: (metadata && metadata.textLength) || 0
            });

            // Test database insert with minimal data
            const testResult = await pool.request()
                .input('AddBy', parseInt(userId))
                .input('FolderID', 1) // Use folder 1 for testing
                .input('BlobPath', 'test/test.txt')
                .input('DisplayName', originalname)
                .input('Size', parseInt(size)) // Ensure size is an integer
                .input('ContentType', mimetype)
                .input('Status', 1)
                .input('DocID', 1) // Use doc ID 1 for testing
                .input('ConnectionTable', 'test')
                .input('Metadata', JSON.stringify(metadata))
                .input('ExtractedText', (metadata && metadata.extractedText) || null)
                .query(`
                    INSERT INTO tenderFile (AddBy, FolderID, BlobPath, DisplayName, UploadedOn, Size, ContentType, Status, DocID, ConnectionTable, Metadata, ExtractedText)
                    VALUES (@AddBy, @FolderID, @BlobPath, @DisplayName, GETDATE(), @Size, @ContentType, @Status, @DocID, @ConnectionTable, @Metadata, @ExtractedText);

                    SELECT SCOPE_IDENTITY() as FileID;
                `);

            const fileId = testResult.recordset[0].FileID;
            console.log('Test file saved to database with ID:', fileId);

            res.json({
                message: 'Test file upload successful',
                fileId: fileId,
                fileName: originalname,
                size: size,
                metadata: metadata,
                hasText: !!(metadata && metadata.extractedText),
                textLength: (metadata && metadata.textLength) || 0
            });

        } catch (error) {
            console.error('Test file upload failed:', error);
            res.status(500).json({ 
                message: 'Test file upload failed',
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    },

    // Check table structure without authentication
    checkTableStructure: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            
            // Check tenderFile table structure
            const tableResult = await pool.request().query(`
                SELECT 
                    COLUMN_NAME, 
                    DATA_TYPE, 
                    IS_NULLABLE,
                    CHARACTER_MAXIMUM_LENGTH,
                    NUMERIC_PRECISION,
                    NUMERIC_SCALE
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'tenderFile' 
                ORDER BY ORDINAL_POSITION
            `);
            
            console.log('tenderFile table structure:', tableResult.recordset);
            
            res.json({
                message: 'Table structure retrieved',
                tableStructure: tableResult.recordset
            });
        } catch (error) {
            console.error('Table structure check failed:', error);
            res.status(500).json({ 
                message: 'Table structure check failed',
                error: error.message 
            });
        }
    },

    // Test endpoint to verify database connectivity
    testDatabase: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            
            // Test basic connection
            const testResult = await pool.request().query('SELECT 1 as test');
            console.log('Database connection test:', testResult.recordset);
            
            // Test tenderFile table structure
            const tableResult = await pool.request().query(`
                SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'tenderFile' 
                ORDER BY ORDINAL_POSITION
            `);
            
            console.log('tenderFile table structure:', tableResult.recordset);
            
            res.json({
                message: 'Database connection successful',
                connectionTest: testResult.recordset[0],
                tableStructure: tableResult.recordset
            });
        } catch (error) {
            console.error('Database test failed:', error);
            res.status(500).json({ 
                message: 'Database test failed',
                error: error.message 
            });
        }
    },

    // Upload file (updated to handle folder assignment and document linking)
    uploadFile: async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            const pool = await getConnectedPool();
            const userId = req.user.UserID;
            const { originalname, buffer, mimetype, size } = req.file;
            let folderId = req.body.folderId || null;
            let docId = req.body.docId || null;
            let connectionTable = req.body.connectionTable || null;
            const tenderId = req.body.tenderId || req.body.TenderID || null;
            const rfiId = req.body.rfiId || req.body.RfiId || req.body.RFIID || null;

            console.log('File upload request:', {
                fileName: originalname,
                contentType: mimetype,
                size: size,
                folderId,
                docId,
                connectionTable,
                userId
            });

            // Fallback assignment to support tender/RFI contexts
            if (!docId) {
                if (rfiId) docId = rfiId;
                else if (tenderId) docId = tenderId;
            }
            if (!connectionTable) {
                if (rfiId) connectionTable = 'tenderRFI';
                else if (tenderId) connectionTable = 'tender';
            }

            // Resolve proper FolderID for Tender/RFI hierarchy
            if (tenderId) {
                try {
                    // 1) Find tender root folder under parent Tender (2), linked to tenderTender by DocID
                    const tenderRoot = await pool.request()
                        .input('TenderID', parseInt(tenderId))
                        .query(`
                            SELECT TOP 1 tf.FolderID
                            FROM tenderFolder tf
                            WHERE tf.DocID = @TenderID AND tf.ConnectionTable = 'tenderTender' AND tf.ParentFolderID = 2
                        `);
                    const tenderRootId = tenderRoot.recordset && tenderRoot.recordset[0] ? tenderRoot.recordset[0].FolderID : null;

                    if (tenderRootId) {
                        // 2) Prefer RFI subfolder when RFI context
                        if (rfiId) {
                            const rfiFolder = await pool.request()
                                .input('ParentFolderID', tenderRootId)
                                .query(`
                                    SELECT TOP 1 FolderID
                                    FROM tenderFolder
                                    WHERE ParentFolderID = @ParentFolderID AND FolderName = 'RFI'
                                `);
                            if (rfiFolder.recordset.length > 0) {
                                folderId = rfiFolder.recordset[0].FolderID;
                            } else if (!folderId) {
                                // If RFI folder missing and no explicit folder was provided, fallback to tender root
                                folderId = tenderRootId;
                            }
                        } else if (!folderId) {
                            // Not an RFI upload and no explicit folder: fall back to tender root
                            folderId = tenderRootId;
                        }
                    }
                } catch (resolveErr) {
                    console.warn('Warning: failed to resolve Tender/RFI folder, will require explicit FolderID', (resolveErr && resolveErr.message) || resolveErr);
                }
            }

            // Special handling: RFQ attachments should go to Tender's BOQ folder
            try {
                if (connectionTable && connectionTable.toLowerCase() === 'dbo.tenderpackagerfq' && docId) {
                    // Resolve TenderID from RFQ -> Package -> tenderBoQPackages
                    const rfqLookup = await pool.request()
                        .input('BOQRFQID', parseInt(docId))
                        .query(`
                            SELECT TOP 1 p.TenderID
                            FROM tenderPackageRFQ r
                            JOIN tenderBoQPackages p ON r.PackageID = p.PackageID
                            WHERE r.BOQRFQID = @BOQRFQID
                        `);
                    const rfqTenderId = rfqLookup.recordset && rfqLookup.recordset[0] ? rfqLookup.recordset[0].TenderID : null;
                    if (rfqTenderId) {
                        const boqFolder = await pool.request()
                            .input('TenderID', rfqTenderId)
                            .query(`
                                SELECT TOP 1 tf.FolderID
                                FROM tenderFolder tf
                                WHERE tf.DocID = @TenderID AND tf.ConnectionTable = 'tenderTender' AND tf.FolderName = 'BOQ'
                            `);
                        if (boqFolder.recordset.length > 0) {
                            folderId = boqFolder.recordset[0].FolderID;
                        } else {
                            // Try to resolve the tender root and then create/find BOQ subfolder
                            const tenderRoot = await pool.request()
                                .input('TenderID', rfqTenderId)
                                .query(`
                                    SELECT TOP 1 tf.FolderID, tf.FolderPath
                                    FROM tenderFolder tf
                                    WHERE tf.DocID = @TenderID AND tf.ConnectionTable = 'tenderTender' AND tf.ParentFolderID = 2
                                `);
                            const tenderRootId = tenderRoot.recordset && tenderRoot.recordset[0] ? tenderRoot.recordset[0].FolderID : null;
                            const tenderRootPath = tenderRoot.recordset && tenderRoot.recordset[0] ? tenderRoot.recordset[0].FolderPath : null;
                            if (tenderRootId) {
                                // Check for existing BOQ subfolder under tender root
                                const existingBoq = await pool.request()
                                    .input('ParentFolderID', tenderRootId)
                                    .query(`
                                        SELECT TOP 1 FolderID FROM tenderFolder WHERE ParentFolderID = @ParentFolderID AND FolderName = 'BOQ'
                                    `);
                                if (existingBoq.recordset.length > 0) {
                                    folderId = existingBoq.recordset[0].FolderID;
                                } else if (tenderRootPath) {
                                    // Create BOQ subfolder
                                    const insertBoq = await pool.request()
                                        .input('FolderName', 'BOQ')
                                        .input('FolderPath', `${tenderRootPath}/BOQ`)
                                        .input('FolderType', 'sub')
                                        .input('ParentFolderID', tenderRootId)
                                        .input('AddBy', userId)
                                        .input('DocID', rfqTenderId)
                                        .input('ConnectionTable', 'tenderTender')
                                        .query(`
                                            IF NOT EXISTS (
                                                SELECT 1 FROM tenderFolder WHERE FolderPath = @FolderPath
                                            )
                                            BEGIN
                                                INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                                                OUTPUT INSERTED.FolderID
                                                VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                                            END
                                            ELSE
                                            BEGIN
                                                SELECT TOP 1 FolderID FROM tenderFolder WHERE FolderPath = @FolderPath
                                            END
                                        `);
                                    folderId = insertBoq.recordset[0].FolderID;
                                }
                            }
                        }
                    }
                }
            } catch (rfqFolderErr) {
                console.warn('Warning: failed to resolve BOQ folder for RFQ upload:', (rfqFolderErr && rfqFolderErr.message) || rfqFolderErr);
            }

            // Validate required fields after fallback and RFQ resolution
            // Only require docId and connectionTable if we're in a specific context (tender/RFI)
            // For general uploads, these can be null
            if (!folderId) {
                // As a last resort, if RFQ context couldn't resolve a folder, try find BOQ by TenderID from RFQ again
                try {
                    if (connectionTable && connectionTable.toLowerCase() === 'dbo.tenderpackagerfq' && docId) {
                        const rfqLookup2 = await pool.request()
                            .input('BOQRFQID', parseInt(docId))
                            .query(`
                                SELECT TOP 1 p.TenderID
                                FROM tenderPackageRFQ r
                                JOIN tenderBoQPackages p ON r.PackageID = p.PackageID
                                WHERE r.BOQRFQID = @BOQRFQID
                            `);
                        const rfqTenderId2 = rfqLookup2.recordset && rfqLookup2.recordset[0] ? rfqLookup2.recordset[0].TenderID : null;
                        if (rfqTenderId2) {
                            const boqFolder2 = await pool.request()
                                .input('TenderID', rfqTenderId2)
                                .query(`
                                    SELECT TOP 1 tf.FolderID
                                    FROM tenderFolder tf
                                    WHERE tf.DocID = @TenderID AND tf.ConnectionTable = 'tenderTender' AND tf.FolderName = 'BOQ'
                                `);
                            if (boqFolder2.recordset.length > 0) {
                                folderId = boqFolder2.recordset[0].FolderID;
                            }
                        }
                    }
                } catch (_) {}

                if (!folderId) {
                    return res.status(400).json({ 
                        message: 'Missing required field: folderId (failed to resolve BOQ folder for RFQ upload)' 
                    });
                }
            }
            
            // If we have a tenderId or rfiId, we should have docId and connectionTable
            if ((tenderId || rfiId) && (!docId || !connectionTable)) {
                return res.status(400).json({ 
                    message: 'Missing required fields: docId, connectionTable (required for tender/RFI uploads)' 
                });
            }

            // Generate unique blob path
            const timestamp = Date.now();
            const blobPath = `uploads/${timestamp}_${originalname}`;

            console.log('Starting metadata extraction...');
            
            // Extract metadata using OpenAI
            const metadata = await openAIService.extractMetadata(buffer, originalname, mimetype);
            
            console.log('Metadata extraction completed:', {
                hasMetadata: !!metadata,
                hasText: !!(metadata && metadata.extractedText),
                textLength: (metadata && metadata.textLength) || 0
            });

            console.log('Saving file to database...');
            
            // Save file record to database with DocID, ConnectionTable, Metadata, and ExtractedText
            const result = await pool.request()
                .input('AddBy', parseInt(userId))
                .input('FolderID', parseInt(folderId))
                .input('BlobPath', blobPath)
                .input('DisplayName', originalname)
                .input('Size', parseInt(size)) // Ensure size is an integer
                .input('ContentType', mimetype)
                .input('Status', 1) // Changed from 'Active' to 1 for bit column
                .input('DocID', docId ? parseInt(docId) : null) // Handle null docId for general uploads
                .input('ConnectionTable', connectionTable || null) // Handle null connectionTable for general uploads
                .input('Metadata', JSON.stringify(metadata))
                .input('ExtractedText', (metadata && metadata.extractedText) || null)
                .query(`
                    INSERT INTO tenderFile (AddBy, FolderID, BlobPath, DisplayName, UploadedOn, Size, ContentType, Status, DocID, ConnectionTable, Metadata, ExtractedText)
                    VALUES (@AddBy, @FolderID, @BlobPath, @DisplayName, GETDATE(), @Size, @ContentType, @Status, @DocID, @ConnectionTable, @Metadata, @ExtractedText);

                    SELECT SCOPE_IDENTITY() as FileID;
                `);

            const fileId = result.recordset[0].FileID;
            console.log('File saved to database with ID:', fileId);

            // If uploaded into Tender > BOQ folder, create tenderBoQ row per new schema
            try {
                if (connectionTable === 'tenderTender' && docId && folderId) {
                    // Check if the file was uploaded to a BOQ folder
                    const folderCheck = await pool.request()
                        .input('FolderID', parseInt(folderId))
                        .query(`
                            SELECT FolderName, ParentFolderID 
                            FROM tenderFolder 
                            WHERE FolderID = @FolderID
                        `);
                    
                    const folderName = folderCheck.recordset && folderCheck.recordset[0] ? folderCheck.recordset[0].FolderName : '';
                    const parentFolderId = folderCheck.recordset && folderCheck.recordset[0] ? folderCheck.recordset[0].ParentFolderID : undefined;
                    
                    // Check if it's a BOQ folder (direct or nested)
                    let isBoqFolder = folderName === 'BOQ';
                    if (!isBoqFolder && parentFolderId) {
                        // Check parent folder
                        const parentCheck = await pool.request()
                            .input('ParentFolderID', parentFolderId)
                            .query(`SELECT FolderName FROM tenderFolder WHERE FolderID = @ParentFolderID`);
                        isBoqFolder = parentCheck.recordset && parentCheck.recordset[0] && parentCheck.recordset[0].FolderName === 'BOQ';
                    }
                    
                    if (isBoqFolder) {
                        const tenderIdInt = parseInt(docId);
                        const fileIdInt = parseInt(fileId);
                        console.log(`[uploadFile] Creating tenderBoQ record: TenderID=${tenderIdInt}, FileID=${fileIdInt}, FolderName=${folderName}`);
                        
                        const boqResult = await pool.request()
                            .input('TenderID', tenderIdInt)
                            .input('FileID', fileIdInt)
                        .input('UploadedAt', new Date())
                        .input('Description', (metadata && metadata.title) || originalname)
                        .query(`
                            INSERT INTO tenderBoQ (TenderID, FileID, UploadedAt, Description)
                            VALUES (@TenderID, @FileID, @UploadedAt, @Description)
                        `);
                        console.log(`[uploadFile] ✅ Successfully created tenderBoQ record for FileID=${fileIdInt}`);
                    } else {
                        console.log(`[uploadFile] Skipping tenderBoQ creation: File not in BOQ folder (FolderName=${folderName}, FolderID=${folderId})`);
                    }
                } else {
                    console.log(`[uploadFile] Skipping tenderBoQ creation: connectionTable=${connectionTable}, docId=${docId}, folderId=${folderId}`);
                }
            } catch (boqErr) {
                console.error('[uploadFile] ❌ Failed to insert tenderBoQ record:', boqErr.message);
                console.error('[uploadFile] Error stack:', boqErr.stack);
            }

            // Upload to Azure Blob Storage FIRST (before extraction, so file exists when we try to download it)
            try {
                const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
                const { DefaultAzureCredential } = require('@azure/identity');
                
                const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
                const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
                const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

                if (!account || !containerName) {
                    console.error('Azure Storage configuration missing');
                    return res.status(500).json({ error: 'Azure Storage configuration missing' });
                }

                // Use account key by default (works on Heroku), use RBAC only if explicitly enabled
                let blobServiceClient;
                if (process.env.AZURE_USE_RBAC === 'true' && !accountKey) {
                    const credential = new DefaultAzureCredential();
                    blobServiceClient = new BlobServiceClient(
                        `https://${account}.blob.core.windows.net`,
                        credential
                    );
                } else {
                    if (!accountKey) {
                        throw new Error('AZURE_STORAGE_ACCOUNT_KEY is required when AZURE_USE_RBAC is not enabled');
                    }
                    const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
                    blobServiceClient = new BlobServiceClient(
                        `https://${account}.blob.core.windows.net`,
                        sharedKeyCredential
                    );
                }
                const containerClient = blobServiceClient.getContainerClient(containerName);
                const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
                
                await blockBlobClient.upload(buffer, buffer.length, {
                    blobHTTPHeaders: {
                        blobContentType: mimetype
                    }
                });
                
                console.log('File uploaded to Azure Blob Storage successfully');
            } catch (azureError) {
                console.error('Azure Blob Storage upload failed:', azureError);
                // Delete the database record if blob upload fails
                await pool.request()
                    .input('FileID', parseInt(fileId))
                    .query(`DELETE FROM tenderFile WHERE FileID = @FileID`);
                return res.status(500).json({ error: 'Failed to upload file to storage', details: azureError.message });
            }

            // If uploaded into Tender > Drawings folder, automatically extract and create tenderDrawing record
            try {
                if (connectionTable === 'tenderTender' && docId && folderId) {
                    // Check if the file was uploaded to the Drawings folder or any subfolder of it
                    let isDrawingsFolder = false;
                    let checkFolderId = parseInt(folderId);
                    const maxDepth = 10;
                    for (let depth = 0; depth < maxDepth; depth++) {
                        const folderCheck = await pool.request()
                            .input('FID', checkFolderId)
                            .query(`SELECT FolderName, ParentFolderID FROM tenderFolder WHERE FolderID = @FID`);
                        if (!folderCheck.recordset || folderCheck.recordset.length === 0) break;
                        const row = folderCheck.recordset[0];
                        if (row.FolderName === 'Drawings') {
                            isDrawingsFolder = true;
                            break;
                        }
                        if (!row.ParentFolderID) break;
                        checkFolderId = row.ParentFolderID;
                    }
                    
                    if (isDrawingsFolder) {
                        const tenderIdInt = parseInt(docId);
                        const fileIdInt = parseInt(fileId);
                        console.log(`[uploadFile] 🎨 File uploaded to Drawings folder (or subfolder) - Auto-extracting drawing info...`);
                        console.log(`[uploadFile] TenderID=${tenderIdInt}, FileID=${fileIdInt}, FolderID=${folderId}`);
                        
                        // Import drawing controller
                        const drawingController = require('../drawing/drawingController');
                        
                        // Create a mock request object for the extraction function
                        const mockReq = {
                            params: { fileId: fileIdInt },
                            user: { UserID: userId },
                            body: {}
                        };
                        
                        // Create a mock response object to capture the result
                        let extractionResult = null;
                        let extractionError = null;
                        const mockRes = {
                            status: (code) => ({
                                json: (data) => {
                                    if (code >= 200 && code < 300) {
                                        extractionResult = data;
                                    } else {
                                        extractionError = data;
                                    }
                                }
                            }),
                            json: (data) => {
                                extractionResult = data;
                            }
                        };
                        
                        try {
                            await drawingController.extractDrawingInfo(mockReq, mockRes);
                            
                            if (!extractionResult || !extractionResult.saved || !extractionResult.drawingId) {
                                throw new Error(extractionError?.error || 'Drawing extraction did not produce a saved record');
                            }
                            
                            console.log(`[uploadFile] ✅ AI extraction succeeded for FileID=${fileIdInt}, DrawingID=${extractionResult.drawingId}`);
                        } catch (extractErr) {
                            console.warn(`[uploadFile] ⚠️ AI extraction failed for FileID=${fileIdInt}: ${extractErr.message}`);
                            // Fallback: always ensure a tenderDrawing record exists
                            try {
                                const existsCheck = await pool.request()
                                    .input('TenderID', tenderIdInt)
                                    .input('FileID', fileIdInt)
                                    .query(`SELECT DrawingID FROM tenderDrawing WHERE TenderID = @TenderID AND FileID = @FileID`);
                                if (existsCheck.recordset.length === 0) {
                                    const fileName = originalName || file.originalname || 'Unknown';
                                    const fallbackResult = await pool.request()
                                        .input('TenderID', tenderIdInt)
                                        .input('DrawingNumber', fileName.replace(/\.[^.]+$/, ''))
                                        .input('Title', fileName)
                                        .input('AddedBy', userId)
                                        .input('FileID', fileIdInt)
                                        .query(`
                                            INSERT INTO tenderDrawing (TenderID, DrawingNumber, Title, AddedBy, FileID)
                                            OUTPUT INSERTED.DrawingID
                                            VALUES (@TenderID, @DrawingNumber, @Title, @AddedBy, @FileID)
                                        `);
                                    console.log(`[uploadFile] ✅ Fallback: Created tenderDrawing record DrawingID=${fallbackResult.recordset[0]?.DrawingID} for FileID=${fileIdInt}`);
                                } else {
                                    console.log(`[uploadFile] ✅ tenderDrawing record already exists for FileID=${fileIdInt}`);
                                }
                            } catch (fallbackErr) {
                                console.warn(`[uploadFile] ⚠️ Fallback tenderDrawing insert also failed for FileID=${fileIdInt}:`, fallbackErr.message);
                            }
                        }
                    } else {
                        console.log(`[uploadFile] Skipping drawing extraction: File not in Drawings folder (FolderID=${folderId})`);
                    }
                } else {
                    console.log(`[uploadFile] Skipping drawing extraction: connectionTable=${connectionTable}, docId=${docId}, folderId=${folderId}`);
                }
            } catch (drawingErr) {
                console.warn('[uploadFile] ⚠️ Drawing extraction error (file kept):', drawingErr.message);
            }

            console.log('File upload completed successfully');

            res.status(201).json({
                message: 'File uploaded successfully',
                fileId: fileId,
                fileName: originalname,
                size: size,
                metadata: metadata
            });

        } catch (error) {
            console.error('Error uploading file:', error);
            res.status(500).json({ 
                message: 'Failed to upload file',
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    },

    // Convert Word document to PDF
    convertWordToPdf: async (req, res) => {
        try {
            const { fileId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            console.log(`🔍 PDF conversion request for file ID: ${fileId} by user: ${userId}`);

            // Get file info
            const result = await pool.request()
                .input('FileID', fileId)
                .input('UserID', userId)
                .query(`
                    SELECT DisplayName, BlobPath, ContentType
                    FROM tenderFile
                    WHERE FileID = @FileID AND AddBy = @UserID AND IsDeleted = 0
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            const file = result.recordset[0];
            const fileName = file.DisplayName.toLowerCase();
            
            // Check if it's a Word document
            if (!fileName.endsWith('.docx') && !fileName.endsWith('.doc')) {
                return res.status(400).json({ message: 'File is not a Word document' });
            }

            // Download from Azure Blob Storage
            const stream = await downloadFile(file.BlobPath);
            
            if (!stream) {
                return res.status(500).json({ message: 'Failed to get file stream' });
            }

            // Convert stream to buffer
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            // Try to convert using libreoffice-convert
            try {
                const libre = require('libreoffice-convert');
                const { promisify } = require('util');
                const convertAsync = promisify(libre.convert);
                
                const pdfBuffer = await convertAsync(buffer, '.pdf', undefined);
                
                // Return PDF
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename="${file.DisplayName.replace(/\.(docx?)$/i, '.pdf')}"`);
                return res.send(pdfBuffer);
            } catch (libreError) {
                console.error('LibreOffice conversion error:', libreError);
                console.log('⚠️ LibreOffice may not be installed. Returning original file.');
                // Fallback: return original file
                res.setHeader('Content-Type', file.ContentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                res.setHeader('Content-Disposition', `attachment; filename="${file.DisplayName}"`);
                return res.send(buffer);
            }
        } catch (error) {
            console.error('❌ Error converting Word to PDF:', error);
            res.status(500).json({ message: 'Failed to convert file', error: error.message });
        }
    },

    // Download file
    downloadFile: async (req, res) => {
        try {
            const { fileId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            console.log(`🔍 Download request for file ID: ${fileId} by user: ${userId}`);

            // Validate fileId
            if (!fileId || fileId === 'undefined' || isNaN(parseInt(fileId))) {
                console.error(`❌ Invalid file ID: ${fileId}`);
                return res.status(400).json({ error: 'Invalid file ID' });
            }

            const fileIdInt = parseInt(fileId);

            // Get file info - allow any authenticated user to download (same as viewing files in folders)
            // Authentication is already handled by the middleware, so we just check if file exists and isn't deleted
            const result = await pool.request()
                .input('FileID', fileIdInt)
                .query(`
                    SELECT DisplayName, BlobPath, ContentType
                    FROM tenderFile
                    WHERE FileID = @FileID AND IsDeleted = 0
                `);

            if (result.recordset.length === 0) {
                console.log(`❌ File not found: FileID=${fileId}, UserID=${userId}`);
                return res.status(404).json({ message: 'File not found' });
            }

            const file = result.recordset[0];
            console.log(`📁 File found: ${file.DisplayName}, BlobPath: ${file.BlobPath}, ContentType: ${file.ContentType}`);

            // Download from Azure Blob Storage
            const stream = await downloadFile(file.BlobPath);
            
            if (!stream) {
                console.error('❌ No stream returned from Azure Blob Storage');
                return res.status(500).json({ message: 'Failed to get file stream' });
            }

            // Set headers for download
            res.setHeader('Content-Type', file.ContentType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${file.DisplayName}"`);

            console.log(`✅ Starting file download: ${file.DisplayName}`);

            // Pipe the stream to response
            stream.pipe(res);
        } catch (error) {
            console.error('❌ Error downloading file:', error);
            res.status(500).json({ message: 'Failed to download file', error: error.message });
        }
    },

    // Delete file
    deleteFile: async (req, res) => {
        try {
            const { fileId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            // Get file info including blob path
            const result = await pool.request()
                .input('FileID', fileId)
                .input('UserID', userId)
                .query(`
                    SELECT BlobPath, DisplayName, ContentType
                    FROM tenderFile
                    WHERE FileID = @FileID AND AddBy = @UserID AND IsDeleted = 0
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            const file = result.recordset[0];

            try {
                // Delete from Azure Blob Storage first
                if (file.BlobPath) {
                    const { deleteFile: deleteBlobFile } = require('../../config/azureBlobService');
                    await deleteBlobFile(file.BlobPath);
                    console.log(`File deleted from blob storage: ${file.BlobPath}`);
                }
            } catch (blobError) {
                console.error('Warning: Failed to delete file from blob storage:', blobError);
                // Continue with database deletion even if blob deletion fails
            }

            // Delete associated drawing record first
            try {
                await pool.request()
                    .input('DrawingFileID', parseInt(fileId))
                    .query(`DELETE FROM tenderDrawing WHERE FileID = @DrawingFileID`);
            } catch (drawingErr) {
                console.warn('Could not delete associated drawing record for FileID', fileId, ':', (drawingErr && drawingErr.message) || drawingErr);
            }

            // Hard delete from database
            await pool.request()
                .input('FileID', fileId)
                .input('UserID', userId)
                .query(`
                    DELETE FROM tenderFile
                    WHERE FileID = @FileID AND AddBy = @UserID
                `);

            console.log(`File deleted from database: ${file.DisplayName} (ID: ${fileId})`);
            res.json({ message: 'File deleted successfully' });
        } catch (error) {
            console.error('Error deleting file:', error);
            res.status(500).json({ message: 'Failed to delete file' });
        }
    },

    // Update file name
    updateFileName: async (req, res) => {
        try {
            const { fileId } = req.params;
            const { displayName } = req.body;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            if (!displayName || displayName.trim() === '') {
                return res.status(400).json({ message: 'Display name is required' });
            }

            const result = await pool.request()
                .input('FileID', fileId)
                .input('UserID', userId)
                .input('DisplayName', displayName.trim())
                .query(`
                    UPDATE tenderFile
                    SET DisplayName = @DisplayName, UpdatedAt = GETDATE()
                    WHERE FileID = @FileID AND AddBy = @UserID AND IsDeleted = 0;
                    
                    SELECT @@ROWCOUNT as UpdatedRows;
                `);

            if (result.recordset[0].UpdatedRows === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            res.json({ message: 'File name updated successfully' });
        } catch (error) {
            console.error('Error updating file name:', error);
            res.status(500).json({ message: 'Failed to update file name' });
        }
    },

    moveFileToFolder: async (req, res) => {
        try {
            const { fileId } = req.params;
            const { folderId } = req.body;
            const pool = await getConnectedPool();

            if (!folderId) {
                return res.status(400).json({ message: 'folderId is required' });
            }

            const result = await pool.request()
                .input('FileID', parseInt(fileId))
                .input('FolderID', parseInt(folderId))
                .query(`
                    UPDATE tenderFile
                    SET FolderID = @FolderID, UpdatedAt = GETDATE()
                    WHERE FileID = @FileID AND IsDeleted = 0;
                    SELECT @@ROWCOUNT as UpdatedRows;
                `);

            if (result.recordset[0].UpdatedRows === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            res.json({ message: 'File moved successfully' });
        } catch (error) {
            console.error('Error moving file to folder:', error);
            res.status(500).json({ message: 'Failed to move file' });
        }
    },

    // Get file preview URL (for images, PDFs, etc.)
    getFilePreviewUrl: async (req, res) => {
        try {
            const { fileId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const result = await pool.request()
                .input('FileID', fileId)
                .input('UserID', userId)
                .query(`
                    SELECT BlobPath, ContentType
                    FROM tenderFile
                    WHERE FileID = @FileID AND AddBy = @UserID AND IsDeleted = 0
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            const file = result.recordset[0];

            // Generate SAS URL for preview (you might want to implement this)
            // For now, return the blob path
            res.json({
                previewUrl: file.BlobPath,
                contentType: file.ContentType
            });
        } catch (error) {
            console.error('Error getting file preview:', error);
            res.status(500).json({ message: 'Failed to get file preview' });
        }
    },

    // Generate SAS URL for file viewing (for Excel files)
    generateFileSASUrl: async (req, res) => {
        try {
            const { fileId } = req.params;
            const userId = req.user.UserID;

            console.log('generateFileSASUrl called with:', { fileId, userId });

            // Validate fileId
            if (!fileId || fileId === 'undefined' || isNaN(parseInt(fileId))) {
                return res.status(400).json({ error: 'Invalid file ID' });
            }

            const fileIdInt = parseInt(fileId);

            // Get the file details from database
            const pool = await getConnectedPool();
            const fileResult = await pool.request()
                .input('FileID', fileIdInt)
                .input('UserID', userId)
                .query(`
                    SELECT f.BlobPath, f.DisplayName, f.ContentType, f.AddBy, ta.Admin
                    FROM tenderFile f
                    LEFT JOIN tenderAccess ta ON ta.UserID = @UserID
                    WHERE f.FileID = @FileID AND f.IsDeleted = 0
                `);

            console.log('🔍 File query result:', {
                found: fileResult.recordset.length > 0,
                file: fileResult.recordset.length > 0 ? {
                    DisplayName: fileResult.recordset[0].DisplayName,
                    ContentType: fileResult.recordset[0].ContentType,
                    AddBy: fileResult.recordset[0].AddBy,
                    Admin: fileResult.recordset[0].Admin
                } : null
            });

            if (fileResult.recordset.length === 0) {
                return res.status(404).json({ error: 'File not found' });
            }

            const file = fileResult.recordset[0];
            const isOwner = file.AddBy === userId;
            const isAdmin = file.Admin === 1 || file.Admin === true || Number(file.Admin) === 1;

            if (!isOwner && !isAdmin) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Check if it's an Excel, Word, or PDF file
            const contentType = String(file.ContentType || '').toLowerCase();
            const isExcelFile = contentType.includes('spreadsheet') || 
                               contentType.includes('excel') ||
                               file.DisplayName.toLowerCase().endsWith('.xlsx') ||
                               file.DisplayName.toLowerCase().endsWith('.xls');
            
            const isWordFile = contentType && (
                               contentType.includes('wordprocessingml') ||
                               contentType.includes('msword') ||
                               contentType.includes('document')
                               ) || 
                               file.DisplayName.toLowerCase().endsWith('.docx') ||
                               file.DisplayName.toLowerCase().endsWith('.doc');

            const isPdfFile = contentType.includes('pdf') ||
                             file.DisplayName.toLowerCase().endsWith('.pdf');

            console.log('🔍 File type check:', {
                DisplayName: file.DisplayName,
                ContentType: file.ContentType,
                isExcelFile,
                isWordFile,
                isPdfFile,
                endsWithDocx: file.DisplayName.toLowerCase().endsWith('.docx'),
                endsWithDoc: file.DisplayName.toLowerCase().endsWith('.doc'),
                endsWithPdf: file.DisplayName.toLowerCase().endsWith('.pdf')
            });

            if (!isExcelFile && !isWordFile && !isPdfFile) {
                console.log('❌ File is not Excel, Word, or PDF:', file.DisplayName, file.ContentType);
                return res.status(400).json({ error: 'File is not an Excel, Word, or PDF file' });
            }

            // Generate SAS URL for the blob
            const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
            const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
            const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

            if (!account || !containerName) {
                console.error('Azure Storage configuration missing');
                return res.status(500).json({ error: 'Azure Storage configuration missing' });
            }

            const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
            const { DefaultAzureCredential } = require('@azure/identity');

            // Use account key by default (works on Heroku), use RBAC only if explicitly enabled
            let blobServiceClient;
            if (process.env.AZURE_USE_RBAC === 'true' && !accountKey) {
                const credential = new DefaultAzureCredential();
                blobServiceClient = new BlobServiceClient(
                    `https://${account}.blob.core.windows.net`,
                    credential
                );
            } else {
                if (!accountKey) {
                    throw new Error('AZURE_STORAGE_ACCOUNT_KEY is required when AZURE_USE_RBAC is not enabled');
                }
                const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
                blobServiceClient = new BlobServiceClient(
                    `https://${account}.blob.core.windows.net`,
                    sharedKeyCredential
                );
            }
            const containerClient = blobServiceClient.getContainerClient(containerName);
            const blobClient = containerClient.getBlobClient(file.BlobPath);

            // Check if blob exists
            const exists = await blobClient.exists();
            if (!exists) {
                return res.status(404).json({ error: 'File not found in storage' });
            }

            // Generate SAS URL with 1 hour expiry
            const sasUrl = await blobClient.generateSasUrl({
                permissions: 'r', // Read only
                expiresOn: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
                protocol: 'https'
            });

            console.log('SAS URL generated successfully for file:', file.DisplayName);

            // Return the SAS URL
            res.json({ 
                sasUrl: sasUrl,
                fileName: file.DisplayName,
                mimeType: file.ContentType
            });

        } catch (error) {
            console.error('Error generating SAS URL:', error);
            res.status(500).json({ error: 'Failed to generate SAS URL' });
        }
    },

    // Get file metadata for display
    getFileMetadata: async (req, res) => {
        try {
            const { fileId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const result = await pool.request()
                .input('FileID', fileId)
                .input('UserID', userId)
                .query(`
                    SELECT 
                        f.FileID,
                        f.DisplayName,
                        f.Metadata,
                        f.ExtractedText,
                        f.ContentType,
                        f.Size,
                        f.UploadedOn,
                        f.AddBy
                    FROM tenderFile f
                    WHERE f.FileID = @FileID AND f.AddBy = @UserID AND f.IsDeleted = 0
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'File not found' });
            }

            const file = result.recordset[0];
            const metadata = file.Metadata ? JSON.parse(file.Metadata) : null;

            res.json({
                fileId: file.FileID,
                fileName: file.DisplayName,
                contentType: file.ContentType,
                size: file.Size,
                uploadedOn: file.UploadedOn,
                metadata: metadata,
                extractedText: file.ExtractedText,
                hasMetadata: !!metadata,
                hasText: !!file.ExtractedText
            });
        } catch (error) {
            console.error('Error getting file metadata:', error);
            res.status(500).json({ message: 'Failed to get file metadata' });
        }
    },

    // Enhanced comprehensive search across all file metadata
    searchFiles: async (req, res) => {
        try {
            const { query, limit = 50 } = req.query;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            if (!query || query.trim().length < 2) {
                return res.json({ files: [], folders: [], totalResults: 0, query: '' });
            }

            const searchTerm = `%${query.trim()}%`;
            const searchTermExact = query.trim();

            // Enhanced search files with comprehensive metadata and relevance scoring
            const filesResult = await pool.request()
                .input('UserID', userId)
                .input('SearchTerm', searchTerm)
                .input('SearchTermExact', searchTermExact)
                .input('Limit', parseInt(limit))
                .query(`
                    SELECT TOP (@Limit)
                        f.FileID,
                        f.DisplayName,
                        f.BlobPath,
                        f.UploadedOn,
                        f.Size,
                        f.ContentType,
                        f.Status,
                        f.CreatedAt,
                        f.UpdatedAt,
                        f.DocID,
                        f.ConnectionTable,
                        f.Metadata,
                        f.ExtractedText,
                        u.Name as UploadedBy,
                        tf.FolderID,
                        tf.FolderName,
                        tf.FolderPath,
                        CASE WHEN ff.FileFavID IS NOT NULL THEN 1 ELSE 0 END as isStarred,
                        -- Enhanced relevance scoring (normalized to 0-100)
                        CASE 
                            WHEN f.DisplayName LIKE @SearchTermExact THEN 100
                            WHEN f.DisplayName LIKE @SearchTerm THEN 80
                            WHEN f.ContentType LIKE @SearchTerm THEN 60
                            WHEN f.Metadata LIKE @SearchTerm THEN 50
                            WHEN f.ExtractedText LIKE @SearchTerm THEN 45
                            WHEN u.Name LIKE @SearchTerm THEN 30
                            WHEN tf.FolderName LIKE @SearchTerm THEN 25
                            WHEN tf.FolderPath LIKE @SearchTerm THEN 15
                            WHEN CONVERT(VARCHAR, f.UploadedOn, 23) LIKE @SearchTerm THEN 20
                            WHEN CONVERT(VARCHAR, f.CreatedAt, 23) LIKE @SearchTerm THEN 20
                            WHEN CONVERT(VARCHAR, f.UploadedOn, 120) LIKE @SearchTerm THEN 15
                            WHEN CONVERT(VARCHAR, f.CreatedAt, 120) LIKE @SearchTerm THEN 15
                            WHEN CAST(f.Size AS VARCHAR) LIKE @SearchTerm THEN 10
                            ELSE 0
                        END as RelevanceScore
                    FROM tenderFile f
                    LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                    LEFT JOIN tenderFolder tf ON f.FolderID = tf.FolderID
                    LEFT JOIN tenderFileFav ff ON f.FileID = ff.FileID AND ff.UserID = @UserID
                    WHERE f.IsDeleted = 0 AND f.AddBy = @UserID
                    AND (
                        f.DisplayName LIKE @SearchTerm OR
                        f.ContentType LIKE @SearchTerm OR
                        f.Metadata LIKE @SearchTerm OR
                        f.ExtractedText LIKE @SearchTerm OR
                        u.Name LIKE @SearchTerm OR
                        tf.FolderName LIKE @SearchTerm OR
                        tf.FolderPath LIKE @SearchTerm OR
                        -- Date search (supports various formats)
                        CONVERT(VARCHAR, f.UploadedOn, 23) LIKE @SearchTerm OR
                        CONVERT(VARCHAR, f.CreatedAt, 23) LIKE @SearchTerm OR
                        CONVERT(VARCHAR, f.UploadedOn, 120) LIKE @SearchTerm OR
                        CONVERT(VARCHAR, f.CreatedAt, 120) LIKE @SearchTerm OR
                        -- Size search
                        CAST(f.Size AS VARCHAR) LIKE @SearchTerm
                    )
                    ORDER BY RelevanceScore DESC, f.UploadedOn DESC
                `);

            // Search folders with relevance scoring
            const foldersResult = await pool.request()
                .input('UserID', userId)
                .input('SearchTerm', searchTerm)
                .input('SearchTermExact', searchTermExact)
                .query(`
                    SELECT 
                        tf.FolderID,
                        tf.FolderName,
                        tf.FolderPath,
                        tf.ParentFolderID,
                        tf.FolderType,
                        tf.DisplayOrder,
                        tf.IsActive,
                        tf.CreatedAt,
                        tf.UpdatedAt,
                        tf.DocID,
                        tf.ConnectionTable,
                        tf.AddBy as CreatedBy,
                        -- Calculate relevance score for folders (normalized to 0-100)
                        CASE 
                            WHEN tf.FolderName LIKE @SearchTermExact THEN 100
                            WHEN tf.FolderName LIKE @SearchTerm THEN 80
                            WHEN tf.FolderPath LIKE @SearchTerm THEN 60
                            WHEN tf.FolderType LIKE @SearchTerm THEN 40
                            WHEN CONVERT(VARCHAR, tf.CreatedAt, 23) LIKE @SearchTerm THEN 20
                            WHEN CONVERT(VARCHAR, tf.UpdatedAt, 23) LIKE @SearchTerm THEN 20
                            ELSE 0
                        END as RelevanceScore
                    FROM tenderFolder tf
                    WHERE tf.IsActive = 1 AND tf.AddBy = @UserID
                    AND (
                        tf.FolderName LIKE @SearchTerm OR
                        tf.FolderPath LIKE @SearchTerm OR
                        tf.FolderType LIKE @SearchTerm OR
                        CONVERT(VARCHAR, tf.CreatedAt, 23) LIKE @SearchTerm OR
                        CONVERT(VARCHAR, tf.UpdatedAt, 23) LIKE @SearchTerm
                    )
                    ORDER BY RelevanceScore DESC, tf.CreatedAt DESC
                `);

            // Format files response
            const files = filesResult.recordset.map(file => ({
                fileId: file.FileID,
                fileName: file.DisplayName,
                size: file.Size,
                contentType: file.ContentType,
                uploadedOn: file.UploadedOn,
                uploadedBy: file.UploadedBy,
                folderId: file.FolderID,
                folderName: file.FolderName,
                folderPath: file.FolderPath,
                docId: file.DocID,
                connectionTable: file.ConnectionTable,
                metadata: file.Metadata ? JSON.parse(file.Metadata) : null,
                extractedText: file.ExtractedText,
                hasText: !!file.ExtractedText,
                isStarred: file.isStarred,
                relevanceScore: file.RelevanceScore
            }));

            // Format folders response
            const folders = foldersResult.recordset.map(folder => ({
                folderId: folder.FolderID,
                folderName: folder.FolderName,
                folderPath: folder.FolderPath,
                parentFolderId: folder.ParentFolderID,
                folderType: folder.FolderType,
                createdAt: folder.CreatedAt,
                updatedAt: folder.UpdatedAt,
                docId: folder.DocID,
                connectionTable: folder.ConnectionTable,
                createdBy: folder.CreatedBy,
                relevanceScore: folder.RelevanceScore
            }));

            res.json({ 
                files,
                folders,
                totalResults: files.length + folders.length,
                query: query.trim()
            });

        } catch (error) {
            console.error('Error searching files:', error);
            res.status(500).json({ message: 'Failed to search files' });
        }
    },

    // Search files with custom SQL filter (for suggestions)
    searchFilesWithFilter: async (req, res) => {
        try {
            const { sqlFilter } = req.body;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            if (!sqlFilter) {
                return res.status(400).json({ message: 'SQL filter is required' });
            }

            // Build the query with the custom filter
            const query = `
                SELECT TOP 50
                    f.FileID,
                    f.DisplayName,
                    f.BlobPath,
                    f.UploadedOn,
                    f.Size,
                    f.ContentType,
                    f.Status,
                    f.CreatedAt,
                    f.UpdatedAt,
                    f.DocID,
                    f.ConnectionTable,
                    f.Metadata,
                    f.ExtractedText,
                    u.Name as UploadedBy,
                    tf.FolderID,
                    tf.FolderName,
                    tf.FolderPath,
                    CASE WHEN ff.FileFavID IS NOT NULL THEN 1 ELSE 0 END as isStarred,
                    100 as RelevanceScore
                FROM tenderFile f
                LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                LEFT JOIN tenderFolder tf ON f.FolderID = tf.FolderID
                LEFT JOIN tenderFileFav ff ON f.FileID = ff.FileID AND ff.UserID = @UserID
                WHERE f.IsDeleted = 0 AND f.AddBy = @UserID
                ${sqlFilter}
            `;

            const filesResult = await pool.request()
                .input('UserID', userId)
                .query(query);

            // Format files response
            const files = filesResult.recordset.map(file => ({
                fileId: file.FileID,
                fileName: file.DisplayName,
                size: file.Size,
                contentType: file.ContentType,
                uploadedOn: file.UploadedOn,
                uploadedBy: file.UploadedBy,
                folderId: file.FolderID,
                folderName: file.FolderName,
                folderPath: file.FolderPath,
                docId: file.DocID,
                connectionTable: file.ConnectionTable,
                metadata: file.Metadata ? JSON.parse(file.Metadata) : null,
                extractedText: file.ExtractedText,
                hasText: !!file.ExtractedText,
                isStarred: file.isStarred,
                relevanceScore: file.RelevanceScore
            }));

            res.json({ 
                files,
                folders: [], // No folders for filtered searches
                totalResults: files.length,
                query: 'Filtered Results'
            });

        } catch (error) {
            console.error('Error searching files with filter:', error);
            res.status(500).json({ message: 'Failed to search files with filter' });
        }
    },

    // Download multiple files as ZIP (optionally preserving folder structure)
    downloadFilesAsZip: async (req, res) => {
        try {
            const { fileIds, zipName, fileEntries } = req.body;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const requestedFileIds = Array.isArray(fileEntries) && fileEntries.length > 0
                ? fileEntries.map((entry) => parseInt(entry.id)).filter((id) => !Number.isNaN(id))
                : (Array.isArray(fileIds) ? fileIds.map((id) => parseInt(id)).filter((id) => !Number.isNaN(id)) : []);

            if (!requestedFileIds || requestedFileIds.length === 0) {
                return res.status(400).json({ error: 'File IDs array is required (or fileEntries with ids)' });
            }

            console.log(`🔍 ZIP download request for ${requestedFileIds.length} files by user: ${userId}`);

            // Get file information for all requested files
            const fileIdsParam = requestedFileIds.map((id, index) => `@FileID${index}`).join(', ');
            const request = pool.request();
            requestedFileIds.forEach((id, index) => {
                request.input(`FileID${index}`, parseInt(id));
            });
            request.input('UserID', userId);

            const query = `
                SELECT FileID, DisplayName, BlobPath, ContentType
                FROM tenderFile
                WHERE FileID IN (${requestedFileIds.map((_, i) => `@FileID${i}`).join(', ')})
                  AND AddBy = @UserID
                  AND IsDeleted = 0
            `;

            const result = await request.query(query);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'No files found' });
            }

            const files = result.recordset;
            console.log(`📦 Found ${files.length} files to include in ZIP`);

            // Optional file path map from client to preserve folder structure
            const filePathMap = new Map();
            if (Array.isArray(fileEntries)) {
                fileEntries.forEach((entry) => {
                    const fileId = parseInt(entry?.id);
                    if (Number.isNaN(fileId)) return;
                    const rawPath = typeof entry?.path === 'string' ? entry.path : '';
                    // Normalize slashes and strip path traversal parts
                    const safePath = rawPath
                        .replace(/\\/g, '/')
                        .split('/')
                        .filter((segment) => segment && segment !== '.' && segment !== '..')
                        .join('/');
                    filePathMap.set(fileId, safePath);
                });
            }

            // Set headers for ZIP download
            const finalZipName = zipName || `drawings_${Date.now()}.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${finalZipName}"`);

            // Create ZIP archive
            const archive = archiver('zip', {
                zlib: { level: 9 } // Maximum compression
            });

            // Handle archive errors
            archive.on('error', (err) => {
                console.error('Archive error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to create ZIP archive' });
                }
            });

            // Pipe archive data to response
            archive.pipe(res);

            // Add each file to the archive
            const filePromises = files.map(async (file) => {
                try {
                    console.log(`📄 Adding file to ZIP: ${file.DisplayName}`);
                    const stream = await downloadFile(file.BlobPath);
                    
                    if (stream) {
                        // Use folder structure if provided; otherwise flat file name
                        const relativePath = filePathMap.get(file.FileID);
                        const archiveName = relativePath
                            ? `${relativePath}/${file.DisplayName}`
                            : file.DisplayName;
                        archive.append(stream, { name: archiveName });
                    } else {
                        console.warn(`⚠️ Could not get stream for file: ${file.DisplayName}`);
                    }
                } catch (fileError) {
                    console.error(`❌ Error adding file ${file.DisplayName} to ZIP:`, fileError);
                    // Continue with other files even if one fails
                }
            });

            // Wait for all files to be added
            await Promise.all(filePromises);

            // Finalize the archive
            await archive.finalize();
            console.log(`✅ ZIP archive created: ${finalZipName}`);

        } catch (error) {
            console.error('Error creating ZIP file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to create ZIP file', details: error.message });
            }
        }
    }
};

// Helper function to determine file type
function getFileType(contentType, fileName) {
    const extension = path.extname(fileName).toLowerCase();
    
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType.includes('pdf')) return 'pdf';
    if (contentType.includes('excel') || extension === '.xlsx' || extension === '.xls') return 'excel';
    if (contentType.includes('powerpoint') || extension === '.pptx' || extension === '.ppt') return 'powerpoint';
    if (contentType.includes('word') || extension === '.docx' || extension === '.doc') return 'word';
    if (extension === '.zip' || extension === '.rar' || extension === '.7z') return 'archive';
    
    return 'file';
}

module.exports = {
    fileController,
    upload
};