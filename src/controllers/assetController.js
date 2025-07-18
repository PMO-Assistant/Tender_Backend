const { pool, poolConnect } = require('../config/database');

const assetController = {
    // Get all assets
    getAllAssets: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request().query('SELECT * FROM portalAssets');
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get asset by ID
    getAssetById: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('AssetID', req.params.id)
                .query('SELECT * FROM portalAssets WHERE AssetID = @AssetID');
            
            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Asset not found' });
            }
            
            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Create new asset
    createAsset: async (req, res) => {
        try {
            const { 
                AssetID, 
                Description, 
                AssetType, 
                Location, 
                Status, 
                Owner, 
                Comments, 
                Responsible, 
                Purchase_Date, 
                Finish_Date, 
                ScanFrequency 
            } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('AssetID', AssetID)
                .input('Description', Description)
                .input('AssetType', AssetType)
                .input('Location', Location)
                .input('Status', Status)
                .input('Owner', Owner)
                .input('Comments', Comments)
                .input('Responsible', Responsible)
                .input('Purchase_Date', Purchase_Date)
                .input('Finish_Date', Finish_Date)
                .input('ScanFrequency', ScanFrequency)
                .query(`
                    INSERT INTO portalAssets (
                        AssetID, 
                        Description, 
                        AssetType, 
                        Location, 
                        Status, 
                        Owner, 
                        Comments, 
                        Responsible, 
                        Purchase_Date, 
                        Finish_Date, 
                        ScanFrequency,
                        created_at,
                        updated_at,
                        Last_Updated
                    )
                    VALUES (
                        @AssetID, 
                        @Description, 
                        @AssetType, 
                        @Location, 
                        @Status, 
                        @Owner, 
                        @Comments, 
                        @Responsible, 
                        @Purchase_Date, 
                        @Finish_Date, 
                        @ScanFrequency,
                        GETDATE(),
                        GETDATE(),
                        GETDATE()
                    )
                `);
            
            res.status(201).json({ 
                message: 'Asset created successfully',
                AssetID
            });
        } catch (err) {
            console.error('Error creating asset:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update asset
    updateAsset: async (req, res) => {
        try {
            const { 
                Description, 
                AssetType, 
                Location, 
                Status, 
                Owner, 
                Comments, 
                Responsible, 
                Purchase_Date, 
                Finish_Date, 
                ScanFrequency 
            } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('AssetID', req.params.id)
                .input('Description', Description)
                .input('AssetType', AssetType)
                .input('Location', Location)
                .input('Status', Status)
                .input('Owner', Owner)
                .input('Comments', Comments)
                .input('Responsible', Responsible)
                .input('Purchase_Date', Purchase_Date)
                .input('Finish_Date', Finish_Date)
                .input('ScanFrequency', ScanFrequency)
                .query(`
                    UPDATE portalAssets 
                    SET Description = @Description,
                        AssetType = @AssetType,
                        Location = @Location,
                        Status = @Status,
                        Owner = @Owner,
                        Comments = @Comments,
                        Responsible = @Responsible,
                        Purchase_Date = @Purchase_Date,
                        Finish_Date = @Finish_Date,
                        ScanFrequency = @ScanFrequency,
                        updated_at = GETDATE(),
                        Last_Updated = GETDATE()
                    WHERE AssetID = @AssetID
                `);
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Asset not found' });
            }
            
            res.json({ message: 'Asset updated successfully' });
        } catch (err) {
            console.error('Error updating asset:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Delete asset
    deleteAsset: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('AssetID', req.params.id)
                .query('DELETE FROM portalAssets WHERE AssetID = @AssetID');
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Asset not found' });
            }
            
            res.json({ message: 'Asset deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get asset history
    getAssetHistory: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request().query(`
                SELECT 
                    ah.id,
                    ah.AssetID,
                    a.Description as asset_name,
                    ah.Location,
                    ah.Status,
                    ah.updated_at,
                    ah.updated_by
                FROM portalAssetHistory ah
                JOIN portalAssets a ON ah.AssetID = a.AssetID
                ORDER BY ah.updated_at DESC
            `);
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = assetController; 