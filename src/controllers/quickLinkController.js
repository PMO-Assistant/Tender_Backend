const { pool, poolConnect } = require('../config/database');

const quickLinkController = {
    // Get all quick links
    getAllQuickLinks: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request().query('SELECT * FROM portalQuickLinks');
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get quick link by ID
    getQuickLinkById: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .query('SELECT * FROM portalQuickLinks WHERE id = @id');
            
            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Quick link not found' });
            }
            
            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Create new quick link
    createQuickLink: async (req, res) => {
        try {
            const { title, href, isexternal } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('title', title)
                .input('href', href)
                .input('isexternal', isexternal ? 1 : 0)
                .query(`
                    INSERT INTO portalQuickLinks (title, href, isexternal)
                    VALUES (@title, @href, @isexternal);
                    SELECT SCOPE_IDENTITY() as id;
                `);
            
            res.status(201).json({ 
                id: result.recordset[0].id,
                title,
                href,
                isexternal: isexternal ? 1 : 0
            });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Update quick link
    updateQuickLink: async (req, res) => {
        try {
            const { title, href, isexternal } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .input('title', title)
                .input('href', href)
                .input('isexternal', isexternal ? 1 : 0)
                .query(`
                    UPDATE portalQuickLinks 
                    SET title = @title,
                        href = @href,
                        isexternal = @isexternal,
                        updated_at = GETDATE()
                    WHERE id = @id
                `);
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Quick link not found' });
            }
            
            res.json({ 
                id: req.params.id,
                title,
                href,
                isexternal: isexternal ? 1 : 0
            });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Delete quick link
    deleteQuickLink: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .query('DELETE FROM portalQuickLinks WHERE id = @id');
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Quick link not found' });
            }
            
            res.json({ message: 'Quick link deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = quickLinkController; 