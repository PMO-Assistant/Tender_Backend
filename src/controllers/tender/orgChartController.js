const { getConnectedPool } = require('../../config/database');

const orgChartController = {
    // Get org chart by tender ID
    getOrgChartByTenderId: async (req, res) => {
        try {
            const { tenderId } = req.params;
            const pool = await getConnectedPool();
            
            const result = await pool.request()
                .input('TenderID', tenderId)
                .query(`
                    SELECT TOP 1 
                        OrgChartID,
                        TenderID,
                        AddBy,
                        CreatedAt,
                        UpdatedAt,
                        Version,
                        Content,
                        ChangeReason
                    FROM tenderOrgChart 
                    WHERE TenderID = @TenderID AND IsActive = 1
                    ORDER BY Version DESC
                `);

            if (result.recordset.length === 0) {
                return res.json({ 
                    nodes: [], 
                    edges: [], 
                    metadata: { zoom: 1, pan: { x: 0, y: 0 } }
                });
            }

            const orgChart = result.recordset[0];
            const content = JSON.parse(orgChart.Content);
            
            // Get user information
            let updatedBy = `User ${orgChart.AddBy}`;
            try {
                const userResult = await pool.request()
                    .input('UserID', orgChart.AddBy)
                    .query(`
                        SELECT Name
                        FROM tenderEmployee 
                        WHERE UserID = @UserID AND Status = 1
                    `);
                
                if (userResult.recordset.length > 0) {
                    const user = userResult.recordset[0];
                    updatedBy = user.Name;
                }
            } catch (userErr) {
                console.error('Error getting user info:', userErr);
            }
            
            res.json({
                orgChartId: orgChart.OrgChartID,
                tenderId: orgChart.TenderID,
                version: orgChart.Version,
                createdAt: orgChart.CreatedAt,
                updatedAt: orgChart.UpdatedAt,
                changeReason: orgChart.ChangeReason,
                updatedBy: updatedBy,
                ...content
            });
        } catch (err) {
            console.error('Error getting org chart:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Save org chart
    saveOrgChart: async (req, res) => {
        try {
            const { tenderId } = req.params;
            const { nodes, edges, metadata, changeReason } = req.body;
            const addBy = req.user?.UserID || 1; // Get from auth middleware

            const content = JSON.stringify({
                nodes: nodes || [],
                edges: edges || [],
                metadata: metadata || { zoom: 1, pan: { x: 0, y: 0 } }
            });

            const pool = await getConnectedPool();
            
            // Check if org chart already exists for this tender
            const existingResult = await pool.request()
                .input('TenderID', tenderId)
                .query(`
                    SELECT OrgChartID, Version 
                    FROM tenderOrgChart 
                    WHERE TenderID = @TenderID AND IsActive = 1
                `);

            if (existingResult.recordset.length > 0) {
                // Update existing org chart
                const existing = existingResult.recordset[0];
                
                // Check if content has actually changed
                const currentContent = existing.Content;
                if (currentContent === content) {
                    // Content is identical, no need to create new version
                    res.json({ 
                        message: 'Org chart content unchanged - no new version created',
                        orgChartId: existing.OrgChartID,
                        version: existing.Version,
                        unchanged: true
                    });
                    return;
                }
                
                // Use a single transaction to update both history and main record
                const transaction = pool.transaction();
                await transaction.begin();
                
                try {
                    // Save to history first
                    await transaction.request()
                        .input('OrgChartID', existing.OrgChartID)
                        .input('TenderID', tenderId)
                        .input('AddBy', addBy)
                        .input('Version', existing.Version)
                        .input('Content', content)
                        .input('ChangeReason', changeReason || 'Updated org chart')
                        .query(`
                            INSERT INTO tenderOrgChartHistory (
                                OrgChartID, TenderID, AddBy, Version, Content, ChangeReason
                            )
                            VALUES (
                                @OrgChartID, @TenderID, @AddBy, @Version, @Content, @ChangeReason
                            )
                        `);

                    // Update the main record
                    await transaction.request()
                        .input('OrgChartID', existing.OrgChartID)
                        .input('Content', content)
                        .input('ChangeReason', changeReason || 'Updated org chart')
                        .input('AddBy', addBy)
                        .query(`
                            UPDATE tenderOrgChart
                            SET Content = @Content,
                                ChangeReason = @ChangeReason,
                                UpdatedAt = GETDATE(),
                                Version = Version + 1
                            WHERE OrgChartID = @OrgChartID
                        `);

                    await transaction.commit();

                    res.json({ 
                        message: 'Org chart updated successfully',
                        orgChartId: existing.OrgChartID,
                        version: existing.Version + 1
                    });
                } catch (transactionError) {
                    await transaction.rollback();
                    throw transactionError;
                }
            } else {
                // Create new org chart
                const result = await pool.request()
                    .input('TenderID', tenderId)
                    .input('AddBy', addBy)
                    .input('Content', content)
                    .input('ChangeReason', changeReason || 'Created org chart')
                    .query(`
                        INSERT INTO tenderOrgChart (
                            TenderID, AddBy, Content, ChangeReason
                        )
                        OUTPUT INSERTED.OrgChartID
                        VALUES (
                            @TenderID, @AddBy, @Content, @ChangeReason
                        )
                    `);

                res.status(201).json({ 
                    message: 'Org chart created successfully',
                    orgChartId: result.recordset[0].OrgChartID,
                    version: 1
                });
            }
        } catch (err) {
            console.error('Error saving org chart:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get org chart history
    getOrgChartHistory: async (req, res) => {
        try {
            const { tenderId } = req.params;
            const pool = await getConnectedPool();
            
            const result = await pool.request()
                .input('TenderID', tenderId)
                .query(`
                    SELECT 
                        h.HistoryID,
                        h.OrgChartID,
                        h.TenderID,
                        h.AddBy,
                        h.CreatedAt,
                        h.Version,
                        h.Content,
                        h.ChangeReason
                    FROM tenderOrgChartHistory h
                    WHERE h.TenderID = @TenderID
                    ORDER BY h.Version DESC
                `);

            // Get unique user IDs from the history
            const userIds = [...new Set(result.recordset.map(record => record.AddBy))];
            
            // Fetch user information for all unique user IDs
            let users = {};
            if (userIds.length > 0) {
                const userIdList = userIds.map((_, index) => `@UserID${index}`).join(',');
                const userRequest = pool.request();
                userIds.forEach((userId, index) => {
                    userRequest.input(`UserID${index}`, userId);
                });
                
                const userResult = await userRequest.query(`
                    SELECT 
                        UserID,
                        Name
                    FROM tenderEmployee 
                    WHERE UserID IN (${userIdList}) AND Status = 1
                `);
                
                userResult.recordset.forEach(user => {
                    users[user.UserID] = user.Name;
                });
            }

            const history = result.recordset.map(record => ({
                historyId: record.HistoryID,
                orgChartId: record.OrgChartID,
                version: record.Version,
                createdAt: record.CreatedAt,
                changeReason: record.ChangeReason,
                updatedBy: users[record.AddBy] || `User ${record.AddBy}`,
                content: JSON.parse(record.Content)
            }));

            res.json(history);
        } catch (err) {
            console.error('Error getting org chart history:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Restore org chart version
    restoreOrgChartVersion: async (req, res) => {
        try {
            const { tenderId, version } = req.params;
            const addBy = req.user?.UserID || 1;

            const pool = await getConnectedPool();
            
            // Get the specific version
            const historyResult = await pool.request()
                .input('TenderID', tenderId)
                .input('Version', version)
                .query(`
                    SELECT Content, ChangeReason
                    FROM tenderOrgChartHistory
                    WHERE TenderID = @TenderID AND Version = @Version
                `);

            if (historyResult.recordset.length === 0) {
                return res.status(404).json({ message: 'Version not found' });
            }

            const historyRecord = historyResult.recordset[0];
            const content = historyRecord.Content;
            const changeReason = `Restored to version ${version}`;

            // Update the current org chart
            await pool.request()
                .input('TenderID', tenderId)
                .input('Content', content)
                .input('ChangeReason', changeReason)
                .input('AddBy', addBy)
                .query(`
                    UPDATE tenderOrgChart
                    SET Content = @Content,
                        ChangeReason = @ChangeReason,
                        UpdatedAt = GETDATE()
                    WHERE TenderID = @TenderID AND IsActive = 1
                `);

            res.json({ 
                message: `Org chart restored to version ${version} successfully`,
                content: JSON.parse(content)
            });
        } catch (err) {
            console.error('Error restoring org chart version:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Delete org chart (soft delete)
    deleteOrgChart: async (req, res) => {
        try {
            const { tenderId } = req.params;
            const pool = await getConnectedPool();
            
            const result = await pool.request()
                .input('TenderID', tenderId)
                .query(`
                    UPDATE tenderOrgChart
                    SET IsActive = 0,
                        UpdatedAt = GETDATE()
                    WHERE TenderID = @TenderID AND IsActive = 1
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Org chart not found' });
            }

            res.json({ message: 'Org chart deleted successfully' });
        } catch (err) {
            console.error('Error deleting org chart:', err);
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = orgChartController; 