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
                .input('id', req.params.id)
                .query('SELECT * FROM portalAssets WHERE id = @id');
            
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
            const { id, name, type, location, status, owner, comments } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('id', id)
                .input('name', name)
                .input('type', type)
                .input('location', location)
                .input('status', status)
                .input('owner', owner)
                .input('comments', comments)
                .query(`
                    INSERT INTO portalAssets (id, name, type, location, status, Owner, Comments)
                    VALUES (@id, @name, @type, @location, @status, @owner, @comments)
                `);
            
            res.status(201).json({ 
                id,
                name,
                type,
                location,
                status,
                owner,
                comments
            });
        } catch (err) {
            console.error('Error creating asset:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update asset
    updateAsset: async (req, res) => {
        try {
            const { name, type, location, status, owner, comments } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .input('name', name)
                .input('type', type)
                .input('location', location)
                .input('status', status)
                .input('owner', owner)
                .input('comments', comments)
                .query(`
                    UPDATE portalAssets 
                    SET name = @name,
                        type = @type,
                        location = @location,
                        status = @status,
                        Owner = @owner,
                        Comments = @comments,
                        updated_at = GETDATE()
                    WHERE id = @id
                `);
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Asset not found' });
            }
            
            res.json({ message: 'Asset updated successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Delete asset
    deleteAsset: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .query('DELETE FROM portalAssets WHERE id = @id');
            
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
                    ah.asset_id,
                    a.name as asset_name,
                    ah.location,
                    ah.status,
                    ah.updated_at,
                    ah.updated_by
                FROM portalAssetHistory ah
                JOIN portalAssets a ON ah.asset_id = a.id
                ORDER BY ah.updated_at DESC
            `);
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = assetController; 