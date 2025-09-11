const { getConnectedPool } = require('../../config/database');

const tenderController = {
    // Get next tender number (preview)
    getNextTenderNumber: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            
            // Get the highest tender number and add 1
            const maxResult = await pool.request().query(`
                SELECT ISNULL(MAX(CAST(SUBSTRING(tenderNo, 9, LEN(tenderNo)) AS INT)), 0) + 1 AS nextNumber 
                FROM tenderTender 
                WHERE tenderNo LIKE 'TND-%' AND ISNUMERIC(SUBSTRING(tenderNo, 9, LEN(tenderNo))) = 1
            `);
            
            const nextNumber = maxResult.recordset[0]?.nextNumber || 1;
            const year = new Date().getFullYear();
            const nextTenderNo = `TND-${year}-${nextNumber.toString().padStart(3, '0')}`;
            
            res.json({ 
                nextTenderId: nextNumber,
                nextTenderNo: nextTenderNo
            });
        } catch (err) {
            console.error('Error getting next tender number:', err);
            res.status(500).json({ message: err.message });
        }
    },
    // Get all tenders (excluding deleted) with managing tender data
    getAllTenders: async (req, res) => {
        try {
            console.log('🚀 getAllTenders called - fetching all tenders with managing data');
            const pool = await getConnectedPool();
            
            // Get basic tender data
            const result = await pool.request()
                .query(`
                    SELECT 
                        t.*,
                        c.CompanyName as CompanyName
                    FROM tenderTender t
                    LEFT JOIN tenderCompany c ON t.CompanyID = c.CompanyID
                    WHERE t.IsDeleted = 0
                    ORDER BY t.TenderID DESC
                `);
            
            console.log(`📊 Found ${result.recordset.length} tenders`);
            
            // Get all managing tender data in one query
            console.log('🔍 Querying tenderTenderManaging table...');
            const managingResult = await pool.request()
                .query(`
                    SELECT 
                        ttm.TenderID,
                        ttm.UserID,
                        e.Name,
                        e.Email
                    FROM tenderTenderManaging ttm
                    INNER JOIN tenderEmployee e ON ttm.UserID = e.UserID
                    WHERE e.Status = 1
                    ORDER BY ttm.TenderID, e.Name
                `);
            
            console.log(`👥 Found ${managingResult.recordset.length} managing tender assignments`);
            console.log('📋 Sample managing data:', managingResult.recordset.slice(0, 3));
            
            // Also check if the table exists and has any data at all
            const tableCheckResult = await pool.request()
                .query(`
                    SELECT COUNT(*) as total_records
                    FROM tenderTenderManaging
                `);
            console.log(`📊 Total records in tenderTenderManaging table: ${tableCheckResult.recordset[0].total_records}`);
            
            // Group managing tender data by TenderID
            const managingByTender = {};
            managingResult.recordset.forEach(row => {
                if (!managingByTender[row.TenderID]) {
                    managingByTender[row.TenderID] = [];
                }
                managingByTender[row.TenderID].push({
                    UserID: row.UserID,
                    Name: row.Name,
                    Email: row.Email
                });
            });
            
            // Note: ManagingTender column has been dropped from tenderTender table
            // All managing data now comes from tenderTenderManaging table only
            // No fallback needed since the column no longer exists
            
            // Merge managing tender data with tender data
            const tendersWithManaging = result.recordset.map(tender => ({
                ...tender,
                managingTenders: managingByTender[tender.TenderID] || []
            }));
            
            console.log('📊 Final data structure:');
            console.log(`   - Total tenders: ${tendersWithManaging.length}`);
            console.log(`   - Tenders with managing data: ${tendersWithManaging.filter(t => t.managingTenders.length > 0).length}`);
            console.log('📋 Sample tender with managing data:', tendersWithManaging.find(t => t.managingTenders.length > 0));
            
            console.log('✅ getAllTenders completed successfully');
            res.json(tendersWithManaging);
        } catch (err) {
            console.error('❌ getAllTenders error:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get tender report data for charts - FAST VERSION
    getTenderReportData: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const { dateRange = 'all', category = 'all' } = req.query;
            
            console.log('📊 getTenderReportData called with:', { dateRange, category });
            
            // Calculate start date based on date range (limit to reasonable ranges)
            let startDate = new Date();
            if (dateRange === '30d') {
                startDate.setDate(startDate.getDate() - 30);
            } else if (dateRange === '90d') {
                startDate.setDate(startDate.getDate() - 90);
            } else if (dateRange === '6m') {
                startDate.setMonth(startDate.getMonth() - 6);
            } else if (dateRange === '1y') {
                startDate.setFullYear(startDate.getFullYear() - 1);
            } else {
                // For 'all', limit to last 5 years to avoid timeouts
                startDate.setFullYear(startDate.getFullYear() - 5);
            }
            
            const startDateStr = startDate.toISOString().split('T')[0];
            
            // Build category filter
            const categoryFilter = category !== 'all' ? `AND t.Type = '${category}'` : '';
            
            // Simple query that groups by month directly - ONLY use ReturnDate
            const result = await pool.request()
                .query(`
                    SELECT 
                        FORMAT(t.ReturnDate, 'yyyy-MM') AS MonthKey,
                        COALESCE(SUM(t.Value), 0) AS TotalValue,
                        COUNT(t.TenderID) AS TenderCount,
                        COALESCE(SUM(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.Value ELSE 0 END), 0) AS AwardedValue,
                        COUNT(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.TenderID END) AS AwardedCount,
                        CASE 
                            WHEN COUNT(t.TenderID) > 0 THEN COALESCE(SUM(t.Value), 0) / COUNT(t.TenderID)
                            ELSE 0 
                        END AS AverageValue
                    FROM tenderTender t
                    WHERE t.IsDeleted = 0
                    ${categoryFilter}
                    AND t.ReturnDate >= '${startDateStr}'
                    AND t.ReturnDate IS NOT NULL
                    GROUP BY FORMAT(t.ReturnDate, 'yyyy-MM')
                    ORDER BY MonthKey
                `);
            
            console.log(`📊 Query returned ${result.recordset.length} months of data`);
            
            // Convert to chart data format
            const chartData = result.recordset.map(row => ({
                date: row.MonthKey,
                value: row.TotalValue,
                tenderCount: row.TenderCount,
                awardedValue: row.AwardedValue,
                awardedCount: row.AwardedCount,
                averageValue: row.AverageValue
            }));
            
            // Get summary statistics - ONLY use ReturnDate
            const summaryResult = await pool.request()
                .query(`
                    SELECT 
                        COALESCE(SUM(t.Value), 0) AS TotalValue,
                        COUNT(t.TenderID) AS TotalTenders,
                        COALESCE(SUM(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.Value ELSE 0 END), 0) AS TotalAwardedValue,
                        COUNT(CASE WHEN t.Status LIKE '%awarded%' OR t.Status LIKE '%won%' OR t.Status LIKE '%success%' THEN t.TenderID END) AS TotalAwardedTenders,
                        CASE 
                            WHEN COUNT(t.TenderID) > 0 THEN COALESCE(SUM(t.Value), 0) / COUNT(t.TenderID)
                            ELSE 0 
                        END AS AverageValue
                    FROM tenderTender t
                    WHERE t.IsDeleted = 0
                    ${categoryFilter}
                    AND t.ReturnDate >= '${startDateStr}'
                    AND t.ReturnDate IS NOT NULL
                `);
            
            const summaryData = summaryResult.recordset[0];
            
            console.log('📊 Chart data sample:', chartData.slice(0, 3));
            console.log('📊 Summary data:', summaryData);
            
            res.json({
                success: true,
                data: {
                    tenders: [], // We don't need individual tender data for the chart
                    chartData: chartData,
                    summary: {
                        totalValue: summaryData.TotalValue,
                        totalTenders: summaryData.TotalTenders,
                        totalAwardedValue: summaryData.TotalAwardedValue,
                        totalAwardedTenders: summaryData.TotalAwardedTenders,
                        averageValue: summaryData.AverageValue,
                        valueChange: 0, // We'll calculate this if needed
                        dateRange: {
                            firstTenderDate: startDateStr,
                            lastTenderDate: new Date().toISOString().split('T')[0]
                        }
                    }
                }
            });
            
        } catch (err) {
            console.error('Error getting tender report data:', err);
            res.status(500).json({ 
                success: false, 
                message: err.message 
            });
        }
    },

    // Get available tender categories
    getTenderCategories: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            
            const result = await pool.request()
                .query(`
                    SELECT DISTINCT Type as category
                    FROM tenderTender
                    WHERE IsDeleted = 0 
                    AND Type IS NOT NULL 
                    AND Type != ''
                    ORDER BY Type
                `);
            
            const categories = result.recordset.map(row => row.category);
            
            res.json({
                success: true,
                data: categories
            });
            
        } catch (err) {
            console.error('Error getting tender categories:', err);
            res.status(500).json({ 
                success: false, 
                message: err.message 
            });
        }
    },

    // Get tender by ID
    getTenderById: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            
            // Get tender basic info
            const tenderResult = await pool.request()
                .input('TenderID', req.params.id)
                .query(`
                    SELECT 
                        t.*,
                        e.Name as AddedByName,
                        e.Email as AddedByEmail,
                        c.CompanyName as CompanyName
                    FROM tenderTender t
                    LEFT JOIN tenderEmployee e ON t.AddBy = e.UserID
                    LEFT JOIN tenderCompany c ON t.CompanyID = c.CompanyID
                    WHERE t.TenderID = @TenderID AND t.IsDeleted = 0
                `);

            if (tenderResult.recordset.length === 0) {
                return res.status(404).json({ message: 'Tender not found' });
            }

            const tender = tenderResult.recordset[0];
            
            // Get managing tender data from tenderTenderManaging table
            let managingTenders = [];
            try {
                const managingResult = await pool.request()
                    .input('TenderID', req.params.id)
                    .query(`
                        SELECT 
                            ttm.UserID,
                            e.Name,
                            e.Email
                        FROM tenderTenderManaging ttm
                        INNER JOIN tenderEmployee e ON ttm.UserID = e.UserID
                        WHERE ttm.TenderID = @TenderID AND e.Status = 1
                        ORDER BY e.Name
                    `);
                managingTenders = managingResult.recordset;
                console.log('Fetched managing tenders:', managingTenders);
            } catch (managingErr) {
                console.error('Error fetching managing tenders:', managingErr);
                managingTenders = [];
            }
            
            tender.managingTenders = managingTenders;
            
            // Get assigned contacts from bridge table
            let assignedContacts = [];
            try {
                const contactsResult = await pool.request()
                    .input('TenderID', req.params.id)
                    .query(`
                        SELECT 
                            ttc.id as assignmentId,
                            ttc.contactId,
                            ttc.role,
                            ttc.participationNote,
                            c.FullName,
                            c.Email,
                            c.Phone,
                            comp.CompanyName as CompanyName
                        FROM tenderTenderContact ttc
                        INNER JOIN tenderContact c ON ttc.contactId = c.ContactID
                        LEFT JOIN tenderCompany comp ON c.CompanyID = comp.CompanyID
                        WHERE ttc.tenderId = @TenderID
                        ORDER BY c.FullName
                    `);
                assignedContacts = contactsResult.recordset;
                console.log('Fetched assigned contacts:', assignedContacts);
            } catch (contactsErr) {
                console.error('Error fetching assigned contacts:', contactsErr);
                assignedContacts = [];
            }
            
            tender.assignedContacts = assignedContacts;

            res.json(tender);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get tenders by company ID
    getTendersByCompany: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const companyId = req.params.id;

            const result = await pool.request()
                .input('CompanyID', companyId)
                .query(`
                    SELECT 
                        t.TenderID,
                        t.ProjectName,
                        t.Value,
                        t.Status,
                        t.Type,
                        t.OpenDate,
                        t.ReturnDate,
                        t.CreatedAt,
                        c.CompanyName
                    FROM tenderTender t
                    LEFT JOIN tenderCompany c ON t.CompanyID = c.CompanyID
                    WHERE t.CompanyID = @CompanyID AND t.IsDeleted = 0
                    ORDER BY t.CreatedAt DESC
                `);

            res.json({
                success: true,
                tenders: result.recordset
            });
        } catch (err) {
            console.error('Error fetching tenders by company:', err);
            res.status(500).json({ 
                success: false,
                message: err.message 
            });
        }
    },

    // Create new tender
    createTender: async (req, res) => {
        try {
            const {
                CompanyID,
                AddBy,
                ProjectName,
                OpenDate,
                ApplyTo,
                Value,
                ReturnDate,
                Status,
                Type,
                Source,
                Consultant,
                Notes
            } = req.body;

            const pool = await getConnectedPool();

            // 1) Insert tender and get new TenderID
            const addByUser = AddBy || (req.user && req.user.UserID) || null;

            const insertTenderResult = await pool.request()
                .input('CompanyID', CompanyID)
                .input('AddBy', addByUser)
                .input('ProjectName', ProjectName)
                .input('OpenDate', OpenDate)
                .input('ApplyTo', ApplyTo)
                .input('Value', Value)
                .input('ReturnDate', ReturnDate)
                .input('Status', Status)
                .input('Type', Type)
                .input('Source', Source)
                .input('Consultant', Consultant)
                .input('Notes', Notes)
                .query(`
                    INSERT INTO tenderTender (
                        CompanyID, AddBy, ProjectName, OpenDate, ApplyTo, Value, ReturnDate, Status, Type, Source,
                        Consultant, Notes, CreatedAt
                    )
                    OUTPUT INSERTED.TenderID as TenderID
                    VALUES (
                        @CompanyID, @AddBy, @ProjectName, @OpenDate, @ApplyTo, @Value, @ReturnDate, @Status, @Type, @Source,
                        @Consultant, @Notes, GETDATE()
                    )
                `);

            const newTenderId = insertTenderResult.recordset?.[0]?.TenderID;

            // 2) Handle ManagingTender - insert into tenderTenderManaging table
            if (newTenderId && req.body.ManagingTender && req.body.ManagingTender.trim() !== '') {
                try {
                    const userIds = req.body.ManagingTender.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
                    console.log('👥 Creating tender with managing UserIDs:', userIds);
                    
                    for (const userId of userIds) {
                        await pool.request()
                            .input('TenderID', newTenderId)
                            .input('UserID', userId)
                            .query(`
                                INSERT INTO tenderTenderManaging (TenderID, UserID)
                                VALUES (@TenderID, @UserID)
                            `);
                    }
                    console.log(`✅ Inserted ${userIds.length} managing assignments for new tender`);
                } catch (managingErr) {
                    console.error('Warning: Tender created but failed to create managing assignments:', managingErr);
                    // Continue without failing the tender creation
                }
            }

            // 4) Create folder structure for the tender under FolderID 2 ("Tender")
            //    Folder name format: "{TenderID} - {ProjectName}"
            //    Subfolders: General, RFI, BOQ, SAQ
            try {
                if (newTenderId) {
                    const rootTenderFolderId = 2; // As specified: Parent folder is Tender (FolderID 2)
                    const safeProjectName = String(ProjectName || '').trim();
                    const tenderFolderName = `${newTenderId} - ${safeProjectName}`;
                    const tenderFolderPath = `/Tender/${tenderFolderName}`;
                    const connectionTable = 'tenderTender';
                    const addByUser = AddBy || req.user?.UserID || null;

                    // 4.1) Create folder structure for the tender under FolderID 2 ("Tender")
                    const existingFolder = await pool.request()
                        .input('DocID', newTenderId)
                        .input('ConnectionTable', connectionTable)
                        .input('ParentFolderID', rootTenderFolderId)
                        .query(`
                            SELECT TOP 1 FolderID
                            FROM tenderFolder
                            WHERE DocID = @DocID
                              AND ConnectionTable = @ConnectionTable
                              AND ParentFolderID = @ParentFolderID
                        `);

                    let tenderFolderId;
                    if (existingFolder.recordset.length > 0) {
                        tenderFolderId = existingFolder.recordset[0].FolderID;
                    } else {
                        const insertTenderFolder = await pool.request()
                            .input('FolderName', tenderFolderName)
                            .input('FolderPath', tenderFolderPath)
                            .input('FolderType', 'sub')
                            .input('ParentFolderID', rootTenderFolderId)
                            .input('AddBy', addByUser)
                            .input('DocID', newTenderId)
                            .input('ConnectionTable', connectionTable)
                            .query(`
                                INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                                OUTPUT INSERTED.FolderID
                                VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                            `);
                        tenderFolderId = insertTenderFolder.recordset[0].FolderID;
                    }

                    // Subfolders to create
                    const subfolders = ['General', 'RFI', 'BOQ', 'SAQ'];
                    for (const sub of subfolders) {
                        // Check existence (by ParentFolderID + FolderName)
                        const existsSub = await pool.request()
                            .input('ParentFolderID', tenderFolderId)
                            .input('FolderName', sub)
                            .query(`
                                SELECT TOP 1 FolderID FROM tenderFolder
                                WHERE ParentFolderID = @ParentFolderID AND FolderName = @FolderName
                            `);
                        if (existsSub.recordset.length === 0) {
                            const subPath = `${tenderFolderPath}/${sub}`;
                            await pool.request()
                                .input('FolderName', sub)
                                .input('FolderPath', subPath)
                                .input('FolderType', 'sub')
                                .input('ParentFolderID', tenderFolderId)
                                .input('AddBy', addByUser)
                                .input('DocID', newTenderId)
                                .input('ConnectionTable', connectionTable)
                                .query(`
                                    INSERT INTO tenderFolder (FolderName, FolderPath, FolderType, ParentFolderID, AddBy, DocID, ConnectionTable)
                                    VALUES (@FolderName, @FolderPath, @FolderType, @ParentFolderID, @AddBy, @DocID, @ConnectionTable)
                                `);
                        }
                    }
                }
            } catch (folderErr) {
                console.error('Warning: Tender created but failed to create folders:', folderErr);
                // Continue without failing the tender creation
            }

            res.status(201).json({ message: 'Tender created successfully', tenderId: newTenderId });
        } catch (err) {
            console.error('Error creating tender:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update tender
    updateTender: async (req, res) => {
        try {
            const tenderId = req.params.id;
            const updateFields = req.body;
            
            console.log('🔄 updateTender called with fields:', Object.keys(updateFields));
            
            // Remove AddBy from updateFields if it's not provided (to avoid NULL constraint)
            if (!updateFields.AddBy) {
                delete updateFields.AddBy;
            }

            const pool = await getConnectedPool();
            
            // Handle ManagingTender field specially - update tenderTenderManaging table
            if (updateFields.ManagingTender !== undefined) {
                console.log('🔧 Handling ManagingTender update for tender:', tenderId);
                console.log('📋 ManagingTender value:', updateFields.ManagingTender);
                console.log('📋 ManagingTender type:', typeof updateFields.ManagingTender);
                console.log('📋 ManagingTender length:', updateFields.ManagingTender ? updateFields.ManagingTender.length : 'null/undefined');
                
                // First, delete existing managing assignments for this tender
                await pool.request()
                    .input('TenderID', tenderId)
                    .query(`
                        DELETE FROM tenderTenderManaging
                        WHERE TenderID = @TenderID
                    `);
                console.log('🗑️ Deleted existing managing assignments');
                
                // Parse the ManagingTender string and insert into tenderTenderManaging table
                if (updateFields.ManagingTender && updateFields.ManagingTender.trim() !== '') {
                    const userIds = updateFields.ManagingTender.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
                    console.log('👥 Parsed UserIDs:', userIds);
                    
                    if (userIds.length > 0) {
                        // Insert new managing assignments
                        for (const userId of userIds) {
                            await pool.request()
                                .input('TenderID', tenderId)
                                .input('UserID', userId)
                                .query(`
                                    INSERT INTO tenderTenderManaging (TenderID, UserID)
                                    VALUES (@TenderID, @UserID)
                                `);
                        }
                        console.log(`✅ Inserted ${userIds.length} new managing assignments`);
                    } else {
                        console.log('⚠️ No valid UserIDs found in ManagingTender string');
                    }
                } else {
                    console.log('ℹ️ ManagingTender is empty, no assignments to insert');
                }
                
                // Remove ManagingTender from updateFields since we handled it separately
                delete updateFields.ManagingTender;
            }
            
            // Build dynamic UPDATE query based on remaining fields
            const fieldsToUpdate = Object.keys(updateFields).filter(key => key !== 'TenderID');
            
            if (fieldsToUpdate.length === 0) {
                console.log('✅ No other fields to update, tender managing assignments updated successfully');
                return res.json({ message: 'Tender updated successfully' });
            }

            let updateQuery = `
                UPDATE tenderTender
                SET UpdatedAt = GETDATE()
            `;
            
            const request = pool.request().input('TenderID', tenderId);
            
            // Add each field to the update query
            fieldsToUpdate.forEach(field => {
                updateQuery += `, ${field} = @${field}`;
                request.input(field, updateFields[field]);
            });
            
            updateQuery += ` WHERE TenderID = @TenderID AND IsDeleted = 0`;

            const result = await request.query(updateQuery);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Tender not found or already deleted' });
            }

            console.log('✅ Tender updated successfully');
            res.json({ message: 'Tender updated successfully' });
        } catch (err) {
            console.error('❌ Error updating tender:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Soft delete tender
    deleteTender: async (req, res) => {
        try {
            const tenderId = req.params.id;
            const pool = await getConnectedPool();
            
            // First, get all files associated with this tender
            const filesResult = await pool.request()
                .input('TenderID', tenderId)
                .query(`
                    SELECT FileID, BlobPath, DisplayName
                    FROM tenderFile
                    WHERE DocID = @TenderID AND ConnectionTable = 'tenderTender' AND IsDeleted = 0
                `);

            const files = filesResult.recordset;
            console.log(`Found ${files.length} files to delete for tender ${tenderId}`);

            // Delete each file from blob storage and database
            for (const file of files) {
                try {
                    // Delete from Azure Blob Storage
                    if (file.BlobPath) {
                        const { deleteFile: deleteBlobFile } = require('../../config/azureBlobService');
                        await deleteBlobFile(file.BlobPath);
                        console.log(`File deleted from blob storage: ${file.BlobPath}`);
                    }
                } catch (blobError) {
                    console.error(`Warning: Failed to delete file ${file.DisplayName} from blob storage:`, blobError);
                    // Continue with other files even if one fails
                }

                // Delete from database
                await pool.request()
                    .input('FileID', file.FileID)
                    .query(`
                        DELETE FROM tenderFile
                        WHERE FileID = @FileID
                    `);
                console.log(`File deleted from database: ${file.DisplayName} (ID: ${file.FileID})`);
            }

            // Now delete the tender folders
            const foldersResult = await pool.request()
                .input('TenderID', tenderId)
                .query(`
                    SELECT FolderID, FolderPath
                    FROM tenderFolder
                    WHERE DocID = @TenderID AND ConnectionTable = 'tenderTender' AND IsActive = 1
                `);

            const folders = foldersResult.recordset;
            console.log(`Found ${folders.length} folders to delete for tender ${tenderId}`);

            // Delete folders (they will be automatically deleted due to foreign key constraints)
            for (const folder of folders) {
                await pool.request()
                    .input('FolderID', folder.FolderID)
                    .query(`
                        DELETE FROM tenderFolder
                        WHERE FolderID = @FolderID
                    `);
                console.log(`Folder deleted: ${folder.FolderPath} (ID: ${folder.FolderID})`);
            }

            // Finally, soft delete the tender
            const result = await pool.request()
                .input('TenderID', tenderId)
                .query(`
                    UPDATE tenderTender
                    SET IsDeleted = 1,
                        DeletedAt = GETDATE()
                    WHERE TenderID = @TenderID AND IsDeleted = 0
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Tender not found or already deleted' });
            }

            console.log(`Tender ${tenderId} and all associated files/folders deleted successfully`);
            res.json({ message: 'Tender deleted successfully' });
        } catch (err) {
            console.error('Error deleting tender:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Test endpoint to check tenderTenderManaging table data
    testManagingTable: async (req, res) => {
        try {
            console.log('🧪 Testing tenderTenderManaging table...');
            const pool = await getConnectedPool();
            
            // First, check raw data in tenderTenderManaging table
            const rawResult = await pool.request()
                .query(`
                    SELECT 
                        ManagingID,
                        TenderID,
                        UserID
                    FROM tenderTenderManaging
                    ORDER BY TenderID, UserID
                `);
            
            console.log(`📊 Raw tenderTenderManaging data: ${rawResult.recordset.length} records`);
            console.log('📋 Raw data:', rawResult.recordset);
            
            // Then check with employee join
            const result = await pool.request()
                .query(`
                    SELECT 
                        ttm.TenderID,
                        ttm.UserID,
                        e.Name,
                        e.Email,
                        COUNT(*) as count
                    FROM tenderTenderManaging ttm
                    INNER JOIN tenderEmployee e ON ttm.UserID = e.UserID
                    WHERE e.Status = 1
                    GROUP BY ttm.TenderID, ttm.UserID, e.Name, e.Email
                    ORDER BY ttm.TenderID
                `);
            
            console.log(`📊 Found ${result.recordset.length} managing tender records with employee data`);
            console.log('📋 Sample data:', result.recordset.slice(0, 5));
            
            res.json({
                message: 'Managing table test completed',
                rawCount: rawResult.recordset.length,
                rawData: rawResult.recordset,
                joinedCount: result.recordset.length,
                sampleData: result.recordset.slice(0, 10)
            });
        } catch (err) {
            console.error('❌ Test managing table error:', err);
            res.status(500).json({ message: err.message });
        }
    }
};
module.exports = tenderController;

