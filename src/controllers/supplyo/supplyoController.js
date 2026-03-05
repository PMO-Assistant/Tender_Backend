const { getConnectedPool } = require('../../config/database');

const supplyoController = {
	// Get ALL Supplyo contacts (batch endpoint - single query for all contacts)
	getAllContacts: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.query(`
					SELECT 
						cont.ContactID,
						cont.CompanyID,
						cont.AddBy,
						cont.FullName,
						cont.Phone,
						cont.Email,
						cont.CreatedAt,
						cont.UpdatedAt,
						cont.Role,
						cont.ScanResult,
						c.CompanyName,
						c.PrimaryService
					FROM tenderSupplyoContact cont
					INNER JOIN tenderSupplyo c ON cont.CompanyID = c.CompanyID
					WHERE cont.Email IS NOT NULL AND cont.Email != ''
					ORDER BY cont.FullName
				`);
			console.log(`📊 Fetched ${result.recordset.length} Supplyo contacts in single query`);
			res.json(result.recordset);
		} catch (err) {
			console.error('Error fetching all Supplyo contacts:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Get all Supplyo companies
	getAllCompanies: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.query(`
					SELECT 
						c.CompanyID,
						c.AddBy,
						c.CompanyName as Name,
						c.CreatedAt,
						c.UpdatedAt,
						c.PrimaryService,
						c.Rating,
						c.Address,
						-- Count of contacts
						COALESCE(COUNT(DISTINCT cont.ContactID), 0) as ContactCount
					FROM tenderSupplyo c
					LEFT JOIN tenderSupplyoContact cont ON c.CompanyID = cont.CompanyID
					GROUP BY 
						c.CompanyID,
						c.AddBy,
						c.CompanyName,
						c.CreatedAt,
						c.UpdatedAt,
						c.PrimaryService,
						c.Rating,
						c.Address
					ORDER BY c.CompanyName
				`);
			res.json(result.recordset);
		} catch (err) {
			console.error('Error fetching Supplyo companies:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Get Supplyo company by ID
	getCompanyById: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.input('CompanyID', req.params.id)
				.query(`
					SELECT 
						c.CompanyID,
						c.AddBy,
						c.CompanyName as Name,
						c.CreatedAt,
						c.UpdatedAt,
						c.PrimaryService,
						c.Rating,
						c.Address
					FROM tenderSupplyo c
					WHERE c.CompanyID = @CompanyID
				`);

			if (result.recordset.length === 0) {
				return res.status(404).json({ message: 'Supplyo company not found' });
			}

			res.json(result.recordset[0]);
		} catch (err) {
			console.error('Error fetching Supplyo company:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Get contacts for a Supplyo company
	getCompanyContacts: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.input('CompanyID', req.params.id)
				.query(`
					SELECT 
						ContactID,
						CompanyID,
						AddBy,
						FullName,
						Phone,
						Email,
						CreatedAt,
						UpdatedAt,
						Role,
						ScanResult
					FROM tenderSupplyoContact
					WHERE CompanyID = @CompanyID
					ORDER BY FullName
				`);
			res.json(result.recordset);
		} catch (err) {
			console.error('Error fetching Supplyo company contacts:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Create Supplyo company
	createCompany: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const { PrimaryService, Rating, Address } = req.body;
			const rawCompanyName = req.body?.CompanyName ?? req.body?.Name ?? req.body?.companyName;
			const CompanyName = typeof rawCompanyName === 'string' ? rawCompanyName.trim() : '';
			const userId = req.user?.UserID;

			if (!CompanyName) {
				return res.status(400).json({ message: 'Company name is required' });
			}

			if (!userId) {
				return res.status(401).json({ message: 'User authentication required' });
			}

			const result = await pool.request()
				.input('CompanyName', CompanyName)
				.input('PrimaryService', PrimaryService || null)
				.input('Rating', Rating || null)
				.input('Address', Address || null)
				.input('AddBy', userId)
				.query(`
					INSERT INTO tenderSupplyo (CompanyName, PrimaryService, Rating, Address, AddBy, CreatedAt, UpdatedAt)
					OUTPUT INSERTED.CompanyID, INSERTED.CompanyName as Name, INSERTED.PrimaryService, INSERTED.Rating, INSERTED.Address, INSERTED.CreatedAt, INSERTED.UpdatedAt
					VALUES (@CompanyName, @PrimaryService, @Rating, @Address, @AddBy, GETDATE(), GETDATE())
				`);

			res.status(201).json({
				companyId: result.recordset[0].CompanyID,
				message: 'Supplyo company created successfully',
				company: result.recordset[0]
			});
		} catch (err) {
			console.error('Error creating Supplyo company:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Update Supplyo company
	updateCompany: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const { CompanyName, PrimaryService, Rating, Address } = req.body;

			// Build dynamic UPDATE query - only update fields that are provided
			const updates = [];
			const request = pool.request().input('CompanyID', req.params.id);

			if (CompanyName !== undefined) {
				updates.push('CompanyName = @CompanyName');
				request.input('CompanyName', CompanyName);
			}
			if (PrimaryService !== undefined) {
				updates.push('PrimaryService = @PrimaryService');
				request.input('PrimaryService', PrimaryService);
			}
			if (Rating !== undefined) {
				updates.push('Rating = @Rating');
				request.input('Rating', Rating);
			}
			if (Address !== undefined) {
				updates.push('Address = @Address');
				request.input('Address', Address);
			}

			// Always update UpdatedAt
			updates.push('UpdatedAt = GETDATE()');

			if (updates.length === 0) {
				return res.status(400).json({ message: 'No fields to update' });
			}

			const query = `
				UPDATE tenderSupplyo
				SET ${updates.join(', ')}
				WHERE CompanyID = @CompanyID
			`;

			const result = await request.query(query);

			if (result.rowsAffected[0] === 0) {
				return res.status(404).json({ message: 'Supplyo company not found' });
			}

			res.json({ message: 'Supplyo company updated successfully' });
		} catch (err) {
			console.error('Error updating Supplyo company:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Delete Supplyo company
	deleteCompany: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.input('CompanyID', req.params.id)
				.query(`
					DELETE FROM tenderSupplyo
					WHERE CompanyID = @CompanyID
				`);

			if (result.rowsAffected[0] === 0) {
				return res.status(404).json({ message: 'Supplyo company not found' });
			}

			res.json({ message: 'Supplyo company deleted successfully' });
		} catch (err) {
			console.error('Error deleting Supplyo company:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Create Supplyo contact
	createContact: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const { CompanyID, FullName, Phone, Email, Role } = req.body;
			const userId = req.user?.UserID;

			if (!CompanyID || !FullName) {
				return res.status(400).json({ message: 'Company ID and Full Name are required' });
			}

			if (!userId) {
				return res.status(401).json({ message: 'User authentication required' });
			}

			const result = await pool.request()
				.input('CompanyID', CompanyID)
				.input('FullName', FullName)
				.input('Phone', Phone || null)
				.input('Email', Email || null)
				.input('Role', Role || null)
				.input('AddBy', userId)
				.query(`
					INSERT INTO tenderSupplyoContact (CompanyID, FullName, Phone, Email, Role, AddBy, CreatedAt, UpdatedAt)
					OUTPUT INSERTED.ContactID, INSERTED.CompanyID, INSERTED.FullName, INSERTED.Phone, INSERTED.Email, INSERTED.Role, INSERTED.CreatedAt, INSERTED.UpdatedAt
					VALUES (@CompanyID, @FullName, @Phone, @Email, @Role, @AddBy, GETDATE(), GETDATE())
				`);

			res.status(201).json({
				contactId: result.recordset[0].ContactID,
				message: 'Supplyo contact created successfully',
				contact: result.recordset[0]
			});
		} catch (err) {
			console.error('Error creating Supplyo contact:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Delete Supplyo contact
	deleteContact: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.input('ContactID', req.params.id)
				.query(`
					DELETE FROM tenderSupplyoContact
					WHERE ContactID = @ContactID
				`);

			if (result.rowsAffected[0] === 0) {
				return res.status(404).json({ message: 'Supplyo contact not found' });
			}

			res.json({ message: 'Supplyo contact deleted successfully' });
		} catch (err) {
			console.error('Error deleting Supplyo contact:', err);
			res.status(500).json({ message: err.message });
		}
	}
};

module.exports = supplyoController;
