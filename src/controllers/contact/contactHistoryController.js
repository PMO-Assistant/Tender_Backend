const { getConnectedPool } = require('../../config/database');

const contactHistoryController = {
    // Get all contact history records
    getAllHistory: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request().query('SELECT * FROM tenderContactHistory');
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get history record by ID
    getHistoryById: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('ID', req.params.id)
                .query('SELECT * FROM tenderContactHistory WHERE ID = @ID');

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'History record not found' });
            }

            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Create new contact history record
    createHistory: async (req, res) => {
        try {
            const { ContactedBy, ContactID, Type, Date } = req.body;

            const pool = await getConnectedPool();
            await pool.request()
                .input('ContactedBy', ContactedBy)
                .input('ContactID', ContactID)
                .input('Type', Type)
                .input('Date', Date)
                .query(`
                    INSERT INTO tenderContactHistory (ContactedBy, ContactID, Type, Date)
                    VALUES (@ContactedBy, @ContactID, @Type, @Date)
                `);

            res.status(201).json({ message: 'Contact history created successfully' });
        } catch (err) {
            console.error('Error creating contact history:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update contact history record
    updateHistory: async (req, res) => {
        try {
            const { ContactedBy, ContactID, Type, Date } = req.body;

            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('ID', req.params.id)
                .input('ContactedBy', ContactedBy)
                .input('ContactID', ContactID)
                .input('Type', Type)
                .input('Date', Date)
                .query(`
                    UPDATE tenderContactHistory
                    SET ContactedBy = @ContactedBy,
                        ContactID = @ContactID,
                        Type = @Type,
                        Date = @Date
                    WHERE ID = @ID
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'History record not found' });
            }

            res.json({ message: 'Contact history updated successfully' });
        } catch (err) {
            console.error('Error updating contact history:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Delete contact history record
    deleteHistory: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('ID', req.params.id)
                .query('DELETE FROM tenderContactHistory WHERE ID = @ID');

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'History record not found' });
            }

            res.json({ message: 'Contact history deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = contactHistoryController;
