const { getConnectedPool } = require('../../config/database');

const formController = {
    // Get all forms (excluding deleted)
    getAllForms: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .query('SELECT * FROM tenderForm WHERE IsDeleted = 0');
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get form by ID
    getFormById: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FormID', req.params.id)
                .query('SELECT * FROM tenderForm WHERE FormID = @FormID AND IsDeleted = 0');

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Form not found' });
            }

            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Create new form
    createForm: async (req, res) => {
        try {
            const { TenderID, AddBy, Title, Status, Type } = req.body;

            const pool = await getConnectedPool();
            await pool.request()
                .input('TenderID', TenderID)
                .input('AddBy', AddBy)
                .input('Title', Title)
                .input('Status', Status)
                .input('Type', Type)
                .query(`
                    INSERT INTO tenderForm (
                        TenderID, AddBy, Title, Status, Type, CreatedAt
                    )
                    VALUES (
                        @TenderID, @AddBy, @Title, @Status, @Type, GETDATE()
                    )
                `);

            res.status(201).json({ message: 'Form created successfully' });
        } catch (err) {
            console.error('Error creating form:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update form
    updateForm: async (req, res) => {
        try {
            const { TenderID, AddBy, Title, Status, Type } = req.body;

            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FormID', req.params.id)
                .input('TenderID', TenderID)
                .input('AddBy', AddBy)
                .input('Title', Title)
                .input('Status', Status)
                .input('Type', Type)
                .query(`
                    UPDATE tenderForm
                    SET TenderID = @TenderID,
                        AddBy = @AddBy,
                        Title = @Title,
                        Status = @Status,
                        Type = @Type,
                        UpdatedAt = GETDATE()
                    WHERE FormID = @FormID AND IsDeleted = 0
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Form not found or already deleted' });
            }

            res.json({ message: 'Form updated successfully' });
        } catch (err) {
            console.error('Error updating form:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Soft delete form
    deleteForm: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FormID', req.params.id)
                .query(`
                    UPDATE tenderForm
                    SET IsDeleted = 1,
                        DeletedAt = GETDATE()
                    WHERE FormID = @FormID AND IsDeleted = 0
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Form not found or already deleted' });
            }

            res.json({ message: 'Form deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = formController;
