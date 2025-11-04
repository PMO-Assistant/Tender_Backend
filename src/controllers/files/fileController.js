const { getConnectedPool } = require('../../config/database');
const { uploadFile, downloadFile, deleteFile } = require('../../config/azureBlobService');
const multer = require('multer');
const path = require('path');
const openAIService = require('../../config/openAIService');

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

const fileController = {
    // Get all folders for the authenticated user
    getAllFolders: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            console.log('Getting folders for user:', userId);

            const result = await pool.request()
                .input('UserID', userId)
                .query(`
                    SELECT DISTINCT
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
                        f.ConnectionTable,
                        u.Name as CreatedBy
                    FROM tenderFolder f
                    LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                    WHERE f.IsActive = 1
                    ORDER BY f.DisplayOrder, f.FolderName
                `);

            console.log('Raw folders from DB:', result.recordset);

            // Build folder hierarchy
            const folders = result.recordset;
            const folderMap = {};
            const rootFolders = [];

            // Create a map of folders by ID with correct property names
            folders.forEach(folder => {
                folderMap[folder.FolderID] = {
                    id: folder.FolderID,
                    name: folder.FolderName,
                    path: folder.FolderPath,
                    type: folder.FolderType,
                    parentId: folder.ParentFolderID,
                    displayOrder: folder.DisplayOrder,
                    isActive: folder.IsActive,
                    createdAt: folder.CreatedAt,
                    updatedAt: folder.UpdatedAt,
                    docId: folder.DocID,
                    connectionTable: folder.ConnectionTable,
                    createdBy: folder.CreatedBy,
                    children: []
                };
            });

            // Build the hierarchy
            folders.forEach(folder => {
                if (folder.ParentFolderID === null) {
                    rootFolders.push(folderMap[folder.FolderID]);
                } else if (folderMap[folder.ParentFolderID]) {
                    folderMap[folder.ParentFolderID].children.push(folderMap[folder.FolderID]);
                }
            });

            console.log('Processed folders:', rootFolders);

            // Return all folders in a flat structure for frontend filtering
            const allFolders = Object.values(folderMap).map(folder => ({
                id: folder.id,
                name: folder.name,
                path: folder.path,
                parentFolderId: folder.parentId,
                folderType: folder.type,
                displayOrder: folder.displayOrder,
                isActive: folder.isActive,
                createdAt: folder.createdAt,
                updatedAt: folder.updatedAt,
                docId: folder.docId,
                connectionTable: folder.connectionTable,
                createdBy: folder.createdBy
            }));

            res.json({ folders: allFolders });
        } catch (error) {
            console.error('Error getting folders:', error);
            res.status(500).json({ message: 'Failed to get folders' });
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
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            if (!tenderId || !projectName) {
                return res.status(400).json({ message: 'tenderId and projectName are required' });
            }

            const rootTenderFolderId = 2; // Parent "Tender" folder
            const safeProjectName = String(projectName || '').trim();
            const tenderFolderName = `${tenderId} - ${safeProjectName}`;
            const tenderFolderPath = `/Tender/${tenderFolderName}`;

            // Check if exists by DocID + ConnectionTable + Parent
            const existingFolderResult = await pool.request()
                .input('DocID', tenderId)
                .input('ConnectionTable', 'tenderTender')
                .input('ParentFolderID', rootTenderFolderId)
                .query(`
                    SELECT FolderID, FolderPath, FolderName
                    FROM tenderFolder 
                    WHERE DocID = @DocID 
                      AND ConnectionTable = @ConnectionTable 
                      AND ParentFolderID = @ParentFolderID
                `);

            let tenderFolderId;
            if (existingFolderResult.recordset.length > 0) {
                tenderFolderId = existingFolderResult.recordset[0].FolderID;
            } else {
                const insertResult = await pool.request()
                    .input('FolderName', tenderFolderName)
                    .input('FolderPath', tenderFolderPath)
                    .input('FolderType', 'sub')
                    .input('ParentFolderID', rootTenderFolderId)
                    .input('AddBy', userId)
                    .input('DocID', tenderId)
                    .input('ConnectionTable', 'tenderTender')
                    .query(`
                        INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                        OUTPUT INSERTED.FolderID
                        VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                    `);
                tenderFolderId = insertResult.recordset[0].FolderID;
            }

            const subNames = ['General', 'RFI', 'BOQ', 'SAQ'];
            const subfolderIds = {};
            for (const name of subNames) {
                const existsSub = await pool.request()
                    .input('ParentFolderID', tenderFolderId)
                    .input('FolderName', name)
                    .query(`
                        SELECT TOP 1 FolderID FROM tenderFolder
                        WHERE ParentFolderID = @ParentFolderID AND FolderName = @FolderName
                    `);
                if (existsSub.recordset.length > 0) {
                    subfolderIds[name] = existsSub.recordset[0].FolderID;
                } else {
                    const subPath = `${tenderFolderPath}/${name}`;
                    const insertedSub = await pool.request()
                        .input('FolderName', name)
                        .input('FolderPath', subPath)
                        .input('FolderType', 'sub')
                        .input('ParentFolderID', tenderFolderId)
                        .input('AddBy', userId)
                        .input('DocID', tenderId)
                        .input('ConnectionTable', 'tenderTender')
                        .query(`
                            INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                            OUTPUT INSERTED.FolderID
                            VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                        `);
                    subfolderIds[name] = insertedSub.recordset[0].FolderID;
                }
            }

            res.json({
                folderId: tenderFolderId,
                folderPath: tenderFolderPath,
                subfolders: subfolderIds
            });
        } catch (error) {
            console.error('Error ensuring tender folder:', error);
            res.status(500).json({ message: 'Failed to ensure tender folder' });
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

            // Check if subfolder with same name already exists
            const existingFolderResult = await pool.request()
                .input('ParentFolderID', parentFolderId)
                .input('FolderName', folderName.trim())
                .query(`
                    SELECT FolderID 
                    FROM tenderFolder 
                    WHERE ParentFolderID = @ParentFolderID AND FolderName = @FolderName AND IsActive = 1
                `);

            if (existingFolderResult.recordset.length > 0) {
                return res.status(409).json({ message: 'A folder with this name already exists' });
            }

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
                    INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                    OUTPUT INSERTED.FolderID, INSERTED.FolderPath, INSERTED.FolderName
                    VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                `);

            const newFolder = insertResult.recordset[0];
            
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

    // Delete folder (only user-created folders). Deletes all files inside first; still blocks if subfolders exist
    deleteFolder: async (req, res) => {
        try {
            const { folderId } = req.params;
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            // First, get folder details to check if it can be deleted
            const folderResult = await pool.request()
                .input('FolderID', folderId)
                .query(`
                    SELECT FolderID, FolderName, FolderPath, FolderType, AddBy, DocID, ConnectionTable
                    FROM tenderFolder 
                    WHERE FolderID = @FolderID AND IsActive = 1
                `);

            if (folderResult.recordset.length === 0) {
                return res.status(404).json({ message: 'Folder not found' });
            }

            const folder = folderResult.recordset[0];

            // Check if user owns this folder (only creator can delete)
            if (folder.AddBy !== userId) {
                return res.status(403).json({ message: 'You can only delete folders you created' });
            }

            // Check if this is a system folder (has DocID and ConnectionTable - these are tender/task folders)
            // Only allow deletion of user-created subfolders (those without DocID/ConnectionTable or with different structure)
            if (folder.DocID && folder.ConnectionTable) {
                // This is a system-generated folder (tender/task folder), check if it's a subfolder
                // Allow deletion only if it's a subfolder within a tender/task folder
                const parentResult = await pool.request()
                    .input('FolderID', folderId)
                    .query(`
                        SELECT ParentFolderID FROM tenderFolder WHERE FolderID = @FolderID
                    `);
                
                if (parentResult.recordset.length === 0) {
                    return res.status(400).json({ message: 'Cannot delete system folders' });
                }
            }

            // Check if this is a protected system subfolder (BOQ, General, RFI, SAQ)
            const protectedFolderNames = ['BOQ', 'General', 'RFI', 'SAQ'];
            if (protectedFolderNames.includes(folder.FolderName)) {
                return res.status(400).json({ 
                    message: `Cannot delete system folder "${folder.FolderName}". This folder is required for tender organization.` 
                });
            }

            // Load all files inside this folder for this user and delete them first
            const filesInFolder = await pool.request()
                .input('FolderID', folderId)
                .input('UserID', userId)
                .query(`
                    SELECT FileID, BlobPath, DisplayName
                    FROM tenderFile
                    WHERE FolderID = @FolderID AND AddBy = @UserID AND IsDeleted = 0
                `);

            let deletedFiles = 0;
            for (const f of filesInFolder.recordset) {
                try {
                    if (f.BlobPath) {
                        const { deleteFile: deleteBlobFile } = require('../../config/azureBlobService');
                        await deleteBlobFile(f.BlobPath);
                    }
                } catch (blobErr) {
                    console.warn('Warning: Failed to delete file from blob storage during folder delete:', blobErr?.message);
                }

                await pool.request()
                    .input('FileID', f.FileID)
                    .input('UserID', userId)
                    .query(`
                        DELETE FROM tenderFile
                        WHERE FileID = @FileID AND AddBy = @UserID
                    `);
                deletedFiles += 1;
            }

            // Check if folder has any subfolders
            const subfoldersResult = await pool.request()
                .input('ParentFolderID', folderId)
                .query(`
                    SELECT COUNT(*) as SubfolderCount
                    FROM tenderFolder 
                    WHERE ParentFolderID = @ParentFolderID AND IsActive = 1
                `);

            const subfolderCount = subfoldersResult.recordset[0].SubfolderCount;
            if (subfolderCount > 0) {
                return res.status(400).json({ 
                    message: `Cannot delete folder. It contains ${subfolderCount} subfolder(s). Please delete all subfolders first.` 
                });
            }

            // Delete the folder (soft delete by setting IsActive = 0)
            await pool.request()
                .input('FolderID', folderId)
                .input('UserID', userId)
                .query(`
                    UPDATE tenderFolder 
                    SET IsActive = 0, UpdatedAt = GETDATE()
                    WHERE FolderID = @FolderID AND AddBy = @UserID
                `);

            res.json({
                message: 'Folder deleted successfully',
                folderName: folder.FolderName,
                deletedFiles
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
            
            // Validate parameters
            if (!docId || docId === 'undefined' || !connectionTable || connectionTable === 'undefined') {
                return res.json({ files: [] });
            }
            
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const result = await pool.request()
                .input('DocID', docId)
                .input('ConnectionTable', connectionTable)
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
    f.DocID as docId,                 -- add
    f.ConnectionTable as connectionTable,  -- add
    f.Metadata as metadata,           -- add
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
            const pool = await getConnectedPool();
            const userId = req.user.UserID;

            const result = await pool.request()
                .input('UserID', userId)
                .query(`
                    SELECT TOP 10
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
                    FROM tenderFile f
                    LEFT JOIN tenderEmployee u ON f.AddBy = u.UserID
                    LEFT JOIN tenderFolder tf ON f.FolderID = tf.FolderID
                    LEFT JOIN tenderFileFav ff ON f.FileID = ff.FileID AND ff.UserID = @UserID
                    WHERE f.IsDeleted = 0 AND f.AddBy = @UserID
                    ORDER BY f.CreatedAt DESC
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
                metadata: file.Metadata ? JSON.parse(file.Metadata) : null,
                type: getFileType(file.ContentType, file.DisplayName),
                isStarred: file.isStarred === 1
            }));

            res.json({ files });
        } catch (error) {
            console.error('Error getting files:', error);
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
                    WHERE f.FileID = @FileID AND f.AddBy = @UserID AND f.IsDeleted = 0
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
                hasText: !!metadata?.extractedText,
                textLength: metadata?.textLength || 0
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
                .input('ExtractedText', metadata?.extractedText || null)
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
                hasText: !!metadata?.extractedText,
                textLength: metadata?.textLength || 0
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
                    const tenderRootId = tenderRoot.recordset?.[0]?.FolderID || null;

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
                    console.warn('Warning: failed to resolve Tender/RFI folder, will require explicit FolderID', resolveErr?.message);
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
                    const rfqTenderId = rfqLookup.recordset[0]?.TenderID || null;
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
                            const tenderRootId = tenderRoot.recordset?.[0]?.FolderID || null;
                            const tenderRootPath = tenderRoot.recordset?.[0]?.FolderPath || null;
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
                                            INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                                            OUTPUT INSERTED.FolderID
                                            VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                                        `);
                                    folderId = insertBoq.recordset[0].FolderID;
                                }
                            }
                        }
                    }
                }
            } catch (rfqFolderErr) {
                console.warn('Warning: failed to resolve BOQ folder for RFQ upload:', rfqFolderErr?.message);
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
                        const rfqTenderId2 = rfqLookup2.recordset[0]?.TenderID || null;
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
                hasText: !!metadata?.extractedText,
                textLength: metadata?.textLength || 0
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
                .input('ExtractedText', metadata?.extractedText || null)
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
                    
                    const folderName = folderCheck.recordset[0]?.FolderName || '';
                    const parentFolderId = folderCheck.recordset[0]?.ParentFolderID;
                    
                    // Check if it's a BOQ folder (direct or nested)
                    let isBoqFolder = folderName === 'BOQ';
                    if (!isBoqFolder && parentFolderId) {
                        // Check parent folder
                        const parentCheck = await pool.request()
                            .input('ParentFolderID', parentFolderId)
                            .query(`SELECT FolderName FROM tenderFolder WHERE FolderID = @ParentFolderID`);
                        isBoqFolder = parentCheck.recordset[0]?.FolderName === 'BOQ';
                    }
                    
                    if (isBoqFolder) {
                        const tenderIdInt = parseInt(docId);
                        const fileIdInt = parseInt(fileId);
                        console.log(`[uploadFile] Creating tenderBoQ record: TenderID=${tenderIdInt}, FileID=${fileIdInt}, FolderName=${folderName}`);
                        
                        const boqResult = await pool.request()
                            .input('TenderID', tenderIdInt)
                            .input('FileID', fileIdInt)
                        .input('UploadedAt', new Date())
                        .input('Description', metadata?.title || originalname)
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

            // Upload to Azure Blob Storage
            try {
                const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
                
                const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
                const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
                const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

                if (!account || !accountKey || !containerName) {
                    console.error('Azure Storage configuration missing');
                    return res.status(500).json({ error: 'Azure Storage configuration missing' });
                }

                const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
                const blobServiceClient = new BlobServiceClient(
                    `https://${account}.blob.core.windows.net`,
                    sharedKeyCredential
                );
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
                // Don't fail the entire request if Azure upload fails
                // The file record is already saved in the database
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

            // Get the file details from database
            const pool = await getConnectedPool();
            const fileResult = await pool.request()
                .input('FileID', fileId)
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
            const isAdmin = file.Admin === 1;

            if (!isOwner && !isAdmin) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Check if it's an Excel or Word file
            const isExcelFile = file.ContentType.includes('spreadsheet') || 
                               file.ContentType.includes('excel') ||
                               file.DisplayName.toLowerCase().endsWith('.xlsx') ||
                               file.DisplayName.toLowerCase().endsWith('.xls');
            
            const isWordFile = file.ContentType && (
                               file.ContentType.includes('wordprocessingml') ||
                               file.ContentType.includes('msword') ||
                               file.ContentType.includes('document')
                               ) || 
                               file.DisplayName.toLowerCase().endsWith('.docx') ||
                               file.DisplayName.toLowerCase().endsWith('.doc');

            console.log('🔍 File type check:', {
                DisplayName: file.DisplayName,
                ContentType: file.ContentType,
                isExcelFile,
                isWordFile,
                endsWithDocx: file.DisplayName.toLowerCase().endsWith('.docx'),
                endsWithDoc: file.DisplayName.toLowerCase().endsWith('.doc')
            });

            if (!isExcelFile && !isWordFile) {
                console.log('❌ File is not Excel or Word:', file.DisplayName, file.ContentType);
                return res.status(400).json({ error: 'File is not an Excel or Word file' });
            }

            // Generate SAS URL for the blob
            const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
            const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
            const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

            if (!account || !accountKey || !containerName) {
                console.error('Azure Storage configuration missing');
                return res.status(500).json({ error: 'Azure Storage configuration missing' });
            }

            const { BlobServiceClient } = require('@azure/storage-blob');
            const { StorageSharedKeyCredential } = require('@azure/storage-blob');

            const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
            const blobServiceClient = new BlobServiceClient(
                `https://${account}.blob.core.windows.net`,
                sharedKeyCredential
            );
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