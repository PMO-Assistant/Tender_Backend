const { getConnectedPool } = require('../../config/database');

const tenderFormFieldController = {
    // Get all fields (optional: filter by FormID if needed)
    getAllFields: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .query('SELECT * FROM tenderFormField');
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get field by ID
    getFieldById: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FieldID', req.params.id)
                .query('SELECT * FROM tenderFormField WHERE FieldID = @FieldID');

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Field not found' });
            }

            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Create new field
    createField: async (req, res) => {
        try {
            const { FormID, Label, FieldType } = req.body;

            const pool = await getConnectedPool();
            await pool.request()
                .input('FormID', FormID)
                .input('Label', Label)
                .input('FieldType', FieldType)
                .query(`
                    INSERT INTO tenderFormField (
                        FormID, Label, FieldType
                    )
                    VALUES (
                        @FormID, @Label, @FieldType
                    )
                `);

            res.status(201).json({ message: 'Field created successfully' });
        } catch (err) {
            console.error('Error creating field:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update field
    updateField: async (req, res) => {
        try {
            const { FormID, Label, FieldType } = req.body;

            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FieldID', req.params.id)
                .input('FormID', FormID)
                .input('Label', Label)
                .input('FieldType', FieldType)
                .query(`
                    UPDATE tenderFormField
                    SET FormID = @FormID,
                        Label = @Label,
                        FieldType = @FieldType
                    WHERE FieldID = @FieldID
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Field not found' });
            }

            res.json({ message: 'Field updated successfully' });
        } catch (err) {
            console.error('Error updating field:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Delete field
    deleteField: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FieldID', req.params.id)
                .query(`
                    DELETE FROM tenderFormField
                    WHERE FieldID = @FieldID
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Field not found or already deleted' });
            }

            res.json({ message: 'Field deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = tenderFormFieldController;
