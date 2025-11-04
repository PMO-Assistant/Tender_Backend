const { getConnectedPool } = require('../../config/database');

const contactController = {
    // Test endpoint
    test: async (req, res) => {
        try {
            res.json({ message: 'Contact controller is working', timestamp: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Test database connection and table structure
    testDb: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            
            // Test basic connection
            const connectionTest = await pool.request().query('SELECT 1 as test');
            
            // Check if tenderContact table exists
            const tableCheck = await pool.request().query(`
                SELECT COUNT(*) as count 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_NAME = 'tenderContact'
            `);
            
            // Get table structure
            const structure = await pool.request().query(`
                SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'tenderContact'
                ORDER BY ORDINAL_POSITION
            `);
            
            res.json({ 
                message: 'Database test completed',
                connection: connectionTest.recordset[0],
                tableExists: tableCheck.recordset[0].count > 0,
                tableStructure: structure.recordset,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.error('Database test error:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Simple test update endpoint
    testUpdate: async (req, res) => {
        try {
            const { ContactID, field, value } = req.body;
            
            if (!ContactID || !field || value === undefined) {
                return res.status(400).json({ message: 'ContactID, field, and value are required' });
            }

            const pool = await getConnectedPool();
            
            // Simple update with just the field and value
            const result = await pool.request()
                .input('ContactID', ContactID)
                .input('value', value)
                .query(`
                    UPDATE tenderContact
                    SET ${field} = @value, UpdatedAt = GETDATE()
                    WHERE ContactID = @ContactID AND IsDeleted = 0
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Contact not found or already deleted' });
            }

            res.json({ message: `Field ${field} updated successfully` });
        } catch (err) {
            console.error('Test update error:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get all contacts (excluding deleted) with company names
    getAllContacts: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .query(`
                    SELECT 
                        c.ContactID,
                        c.FullName,
                        c.Email,
                        c.Phone,
                        c.CompanyID,
                        c.CreatedAt,
                        c.UpdatedAt,
                        comp.CompanyName as CompanyName
                    FROM tenderContact c
                    LEFT JOIN tenderCompany comp ON c.CompanyID = comp.CompanyID
                    WHERE c.IsDeleted = 0
                    ORDER BY c.FullName
                `);
            console.log(`[getAllContacts] Returning ${result.recordset.length} contacts`);
            // Log sample to verify CompanyID is included
            if (result.recordset.length > 0) {
                const sample = result.recordset[0];
                console.log(`[getAllContacts] Sample contact:`, {
                    ContactID: sample.ContactID,
                    FullName: sample.FullName,
                    Email: sample.Email,
                    CompanyID: sample.CompanyID,
                    CompanyName: sample.CompanyName
                });
            }
            res.json(result.recordset);
        } catch (err) {
            console.error('[getAllContacts] Error:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get contact by ID
    getContactById: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('ContactID', req.params.id)
                .query(`
                    SELECT 
                        c.*,
                        comp.CompanyName as CompanyName,
                        u.Name as AddedByName
                    FROM tenderContact c
                    LEFT JOIN tenderCompany comp ON c.CompanyID = comp.CompanyID
                    LEFT JOIN tenderEmployee u ON c.AddBy = u.UserID
                    WHERE c.ContactID = @ContactID AND c.IsDeleted = 0
                `);
            
            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Contact not found' });
            }

            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get contacts by company ID
    getContactsByCompany: async (req, res) => {
        try {
            const { companyId } = req.query;
            
            if (!companyId) {
                return res.status(400).json({ message: 'Company ID is required' });
            }

            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('CompanyID', companyId)
                .query(`
                    SELECT 
                        c.*,
                        comp.CompanyName as CompanyName
                    FROM tenderContact c
                    LEFT JOIN tenderCompany comp ON c.CompanyID = comp.CompanyID
                    WHERE c.CompanyID = @CompanyID AND c.IsDeleted = 0
                    ORDER BY c.FullName
                `);
            
            res.json(result.recordset);
        } catch (err) {
            console.error('Error fetching contacts by company:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get contact count by company ID
    getContactCountByCompany: async (req, res) => {
        try {
            const { companyId } = req.query;
            
            if (!companyId) {
                return res.status(400).json({ message: 'Company ID is required' });
            }

            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('CompanyID', companyId)
                .query(`
                    SELECT COUNT(*) as ContactCount
                    FROM tenderContact c
                    WHERE c.CompanyID = @CompanyID AND c.IsDeleted = 0
                `);
            
            res.json({ 
                companyId: parseInt(companyId),
                contactCount: result.recordset[0].ContactCount 
            });
        } catch (err) {
            console.error('Error fetching contact count by company:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Create new contact
    createContact: async (req, res) => {
        try {
            const {
                CompanyID,
                AddBy,
                FullName,
                Phone,
                Email,
                Status,
                Role,
                LinkedIn
            } = req.body;

            // Validate required fields
            if (!FullName || !FullName.trim()) {
                return res.status(400).json({ message: 'FullName is required' });
            }

            if (!CompanyID) {
                return res.status(400).json({ message: 'CompanyID is required' });
            }

            if (!AddBy) {
                return res.status(400).json({ message: 'AddBy is required' });
            }

            const pool = await getConnectedPool();
            await pool.request()
                .input('CompanyID', CompanyID)
                .input('AddBy', AddBy)
                .input('FullName', FullName.trim())
                .input('Phone', Phone || null)
                .input('Email', Email || null)
                .input('Status', Status || 'active')
                .input('Role', Role || null)
                .input('LinkedIn', LinkedIn || null)
                .query(`
                    INSERT INTO tenderContact (
                        CompanyID, AddBy, FullName, Phone, Email, Status, Role, LinkedIn, CreatedAt
                    )
                    VALUES (
                        @CompanyID, @AddBy, @FullName, @Phone, @Email, @Status, @Role, @LinkedIn, GETDATE()
                    )
                `);

            res.status(201).json({ message: 'Contact created successfully' });
        } catch (err) {
            console.error('Error creating contact:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Update contact
    updateContact: async (req, res) => {
        try {
            const { ContactID, ...updateFields } = req.body;
            const contactId = req.params.id;

            console.log('🔄 Updating contact:', contactId, 'with fields:', updateFields);

            // Build dynamic UPDATE query based on provided fields
            const fieldsToUpdate = [];
            const inputs = [];
            
            // Map frontend field names to database column names
            const fieldMapping = {
                'FullName': 'FullName',
                'Email': 'Email', 
                'Phone': 'Phone',
                'Role': 'Role',
                'Status': 'Status',
                'CompanyID': 'CompanyID',
                'LinkedIn': 'LinkedIn'
            };

            // Handle FullName specially - check if we need to split it
            if (updateFields.FullName) {
                // Check if FullName column exists, otherwise split into FirstName and Surname
                try {
                    const pool = await getConnectedPool();
                    const columnCheck = await pool.request()
                        .query(`
                            SELECT COLUMN_NAME 
                            FROM INFORMATION_SCHEMA.COLUMNS 
                            WHERE TABLE_NAME = 'tenderContact' AND COLUMN_NAME = 'FullName'
                        `);
                    
                    if (columnCheck.recordset.length === 0) {
                        // FullName column doesn't exist, split the name
                        const nameParts = updateFields.FullName.trim().split(' ');
                        const firstName = nameParts[0] || '';
                        const surname = nameParts.slice(1).join(' ') || '';
                        
                        fieldsToUpdate.push('FirstName = @FirstName', 'Surname = @Surname');
                        inputs.push({ name: 'FirstName', value: firstName });
                        inputs.push({ name: 'Surname', value: surname });
                        
                        // Remove FullName from updateFields since we're handling it specially
                        delete updateFields.FullName;
                    } else {
                        // FullName column exists, use it directly
                        fieldsToUpdate.push('FullName = @FullName');
                        inputs.push({ name: 'FullName', value: updateFields.FullName });
                    }
                } catch (err) {
                    console.error('Error checking column structure:', err);
                    // Fallback: assume FullName column exists
                    fieldsToUpdate.push('FullName = @FullName');
                    inputs.push({ name: 'FullName', value: updateFields.FullName });
                }
            }

            // Handle other fields
            Object.keys(updateFields).forEach(field => {
                if (fieldMapping[field] && updateFields[field] !== undefined && field !== 'FullName') {
                    fieldsToUpdate.push(`${fieldMapping[field]} = @${field}`);
                    inputs.push({ name: field, value: updateFields[field] });
                }
            });

            if (fieldsToUpdate.length === 0) {
                return res.status(400).json({ message: 'No valid fields to update' });
            }

            // Add UpdatedAt to the update
            fieldsToUpdate.push('UpdatedAt = GETDATE()');

            const pool = await getConnectedPool();
            const request = pool.request();
            
            // Add ContactID input
            request.input('ContactID', contactId);
            
            // Add all other inputs
            inputs.forEach(input => {
                request.input(input.name, input.value);
            });

            console.log('📝 SQL Update fields:', fieldsToUpdate);
            console.log('📝 SQL Inputs:', inputs);

            const result = await request.query(`
                UPDATE tenderContact
                SET ${fieldsToUpdate.join(', ')}
                WHERE ContactID = @ContactID AND IsDeleted = 0
            `);

            console.log('✅ Update result:', result.rowsAffected);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Contact not found or already deleted' });
            }

            res.json({ message: 'Contact updated successfully' });
        } catch (err) {
            console.error('❌ Error updating contact:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Delete contact (soft delete)
    deleteContact: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('ContactID', req.params.id)
                .query(`
                    UPDATE tenderContact
                    SET IsDeleted = 1,
                        DeletedAt = GETDATE()
                    WHERE ContactID = @ContactID AND IsDeleted = 0
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Contact not found or already deleted' });
            }

            res.json({ message: 'Contact deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = contactController;

                .input('ContactID', req.params.id)
                .query(`
                    UPDATE tenderContact
                    SET IsDeleted = 1,
                        DeletedAt = GETDATE()
                    WHERE ContactID = @ContactID AND IsDeleted = 0
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Contact not found or already deleted' });
            }

            res.json({ message: 'Contact deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = contactController;
