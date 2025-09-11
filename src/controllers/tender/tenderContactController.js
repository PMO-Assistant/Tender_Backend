const { getConnectedPool } = require('../../config/database');

const tenderContactController = {
    // Get all contacts assigned to a tender
    getTenderContacts: async (req, res) => {
        try {
            const { tenderId } = req.params;
            const pool = await getConnectedPool();

            const result = await pool.request()
                .input('TenderId', tenderId)
                .query(`
                    SELECT 
                        ttc.id,
                        ttc.tenderId,
                        ttc.contactId,
                        ttc.role,
                        ttc.participationNote,
                        c.FirstName,
                        c.Surname,
                        c.Email,
                        c.Phone,
                        c.Company
                    FROM tenderTenderContact ttc
                    INNER JOIN tenderContact c ON ttc.contactId = c.ContactID
                    WHERE ttc.tenderId = @TenderId
                    ORDER BY c.FirstName, c.Surname
                `);

            res.json(result.recordset);
        } catch (err) {
            console.error('Error fetching tender contacts:', err);
            res.status(500).json({ 
                error: 'Database error',
                message: 'Failed to fetch tender contacts'
            });
        }
    },

    // Assign a contact to a tender
    assignContactToTender: async (req, res) => {
        try {
            const { tenderId } = req.params;
            const { contactId, role, participationNote } = req.body;

            if (!contactId) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Contact ID is required'
                });
            }

            const pool = await getConnectedPool();

            // Check if tender exists
            const tenderCheck = await pool.request()
                .input('TenderId', tenderId)
                .query('SELECT TenderID FROM tenderTender WHERE TenderID = @TenderId');

            if (tenderCheck.recordset.length === 0) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'Tender not found'
                });
            }

            // Check if contact exists
            const contactCheck = await pool.request()
                .input('ContactId', contactId)
                .query('SELECT ContactID FROM tenderContact WHERE ContactID = @ContactId');

            if (contactCheck.recordset.length === 0) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'Contact not found'
                });
            }

            // Insert the assignment (the unique constraint will handle duplicates)
            await pool.request()
                .input('TenderId', tenderId)
                .input('ContactId', contactId)
                .input('Role', role || null)
                .input('ParticipationNote', participationNote || null)
                .query(`
                    INSERT INTO tenderTenderContact (tenderId, contactId, role, participationNote)
                    VALUES (@TenderId, @ContactId, @Role, @ParticipationNote)
                `);

            res.status(201).json({ 
                message: 'Contact assigned to tender successfully'
            });
        } catch (err) {
            if (err.number === 2627) { // Unique constraint violation
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'Contact is already assigned to this tender'
                });
            }
            console.error('Error assigning contact to tender:', err);
            res.status(500).json({ 
                error: 'Database error',
                message: 'Failed to assign contact to tender'
            });
        }
    },

    // Remove a contact from a tender
    removeContactFromTender: async (req, res) => {
        try {
            const { tenderId, contactId } = req.params;

            const pool = await getConnectedPool();

            const result = await pool.request()
                .input('TenderId', tenderId)
                .input('ContactId', contactId)
                .query(`
                    DELETE FROM tenderTenderContact 
                    WHERE tenderId = @TenderId AND contactId = @ContactId
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'Contact assignment not found'
                });
            }

            res.json({ 
                message: 'Contact removed from tender successfully'
            });
        } catch (err) {
            console.error('Error removing contact from tender:', err);
            res.status(500).json({ 
                error: 'Database error',
                message: 'Failed to remove contact from tender'
            });
        }
    },

    // Update contact assignment (role, participation note)
    updateTenderContactAssignment: async (req, res) => {
        try {
            const { tenderId, contactId } = req.params;
            const { role, participationNote } = req.body;

            const pool = await getConnectedPool();

            const result = await pool.request()
                .input('TenderId', tenderId)
                .input('ContactId', contactId)
                .input('Role', role || null)
                .input('ParticipationNote', participationNote || null)
                .query(`
                    UPDATE tenderTenderContact 
                    SET role = @Role, participationNote = @ParticipationNote
                    WHERE tenderId = @TenderId AND contactId = @ContactId
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'Contact assignment not found'
                });
            }

            res.json({ 
                message: 'Contact assignment updated successfully'
            });
        } catch (err) {
            console.error('Error updating contact assignment:', err);
            res.status(500).json({ 
                error: 'Database error',
                message: 'Failed to update contact assignment'
            });
        }
    },

    // Get all tenders where a contact is assigned as key contact
    getTendersByContact: async (req, res) => {
        try {
            const { contactId } = req.params;
            const pool = await getConnectedPool();

            const result = await pool.request()
                .input('ContactId', contactId)
                .query(`
                    SELECT 
                        t.TenderID,
                        t.ProjectName,
                        t.Type,
                        t.Status,
                        t.Value,
                        t.OpenDate,
                        t.ReturnDate,
                        t.CreatedAt,
                        ttc.role as ContactRole,
                        ttc.participationNote,
                        comp.CompanyName
                    FROM tenderTenderContact ttc
                    INNER JOIN tenderTender t ON ttc.tenderId = t.TenderID
                    LEFT JOIN tenderCompany comp ON t.CompanyID = comp.CompanyID
                    WHERE ttc.contactId = @ContactId 
                        AND t.IsDeleted = 0
                    ORDER BY t.CreatedAt DESC
                `);

            console.log(`Found ${result.recordset.length} tenders for contact ${contactId}`);
            res.json(result.recordset);
        } catch (err) {
            console.error('Error fetching tenders by contact:', err);
            res.status(500).json({ 
                error: 'Database error',
                message: 'Failed to fetch tenders for contact'
            });
        }
    }
};

module.exports = tenderContactController;