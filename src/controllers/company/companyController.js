const { getConnectedPool } = require('../../config/database');

const companyController = {
	// Get all companies
	getAllCompanies: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.query(`
					SELECT 
						c.CompanyID,
						c.AddBy,
						e.Name as AddedByName,
						c.CompanyName as Name,
						c.Phone,
						c.Email,
						c.Website,
						c.CreatedAt,
						c.UpdatedAt,
						c.Status,
						c.Type,
						-- Calculate total value from awarded tenders
						COALESCE(SUM(CASE WHEN t.Status = 'Awarded' THEN t.Value ELSE 0 END), 0) as TotalValue,
						-- Count of contacts
						COALESCE(COUNT(DISTINCT cont.ContactID), 0) as ContactCount,
						-- Count of tenders
						COALESCE(COUNT(DISTINCT t.TenderID), 0) as TenderCount
					FROM tenderCompany c
					LEFT JOIN tenderEmployee e ON c.AddBy = e.UserID
					LEFT JOIN tenderContact cont ON c.CompanyID = cont.CompanyID AND cont.IsDeleted = 0
					LEFT JOIN tenderTenderContact ttc ON cont.ContactID = ttc.contactId
					LEFT JOIN tenderTender t ON ttc.tenderId = t.TenderID AND t.IsDeleted = 0
					GROUP BY 
						c.CompanyID,
						c.AddBy,
						e.Name,
						c.CompanyName,
						c.Phone,
						c.Email,
						c.Website,
						c.CreatedAt,
						c.UpdatedAt,
						c.Status,
						c.Type
					ORDER BY c.CompanyName
				`);
			res.json(result.recordset);
		} catch (err) {
			console.error('Error fetching companies:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Get company by ID
	getCompanyById: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.input('CompanyID', req.params.id)
				.query(`
					SELECT 
						c.CompanyID,
						c.AddBy,
						e.Name as AddedByName,
						c.CompanyName as Name,
						c.Phone,
						c.Email,
						c.Website,
						c.CreatedAt,
						c.UpdatedAt,
						c.Status,
						c.Type,
						-- Calculate total value from awarded tenders
						COALESCE(SUM(CASE WHEN t.Status = 'Awarded' THEN t.Value ELSE 0 END), 0) as TotalValue,
						-- Count of contacts
						COALESCE(COUNT(DISTINCT cont.ContactID), 0) as ContactCount,
						-- Count of tenders
						COALESCE(COUNT(DISTINCT t.TenderID), 0) as TenderCount
					FROM tenderCompany c
					LEFT JOIN tenderEmployee e ON c.AddBy = e.UserID
					LEFT JOIN tenderContact cont ON c.CompanyID = cont.CompanyID AND cont.IsDeleted = 0
					LEFT JOIN tenderTenderContact ttc ON cont.ContactID = ttc.contactId
					LEFT JOIN tenderTender t ON ttc.tenderId = t.TenderID AND t.IsDeleted = 0
					WHERE c.CompanyID = @CompanyID
					GROUP BY 
						c.CompanyID,
						c.AddBy,
						e.Name,
						c.CompanyName,
						c.Phone,
						c.Email,
						c.Website,
						c.CreatedAt,
						c.UpdatedAt,
						c.Status,
						c.Type
				`);

			if (result.recordset.length === 0) {
				return res.status(404).json({ message: 'Company not found' });
			}

			res.json(result.recordset[0]);
		} catch (err) {
			console.error('Error fetching company:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Create new company
	createCompany: async (req, res) => {
		try {
			const { Name, Phone, Email, Status, Type, Website } = req.body;
			const AddBy = req.user?.UserID || req.body.AddBy;

			if (!Name) {
				return res.status(400).json({ message: 'Company name is required' });
			}

			const pool = await getConnectedPool();
			const result = await pool.request()
				.input('AddBy', AddBy)
				.input('CompanyName', Name)
				.input('Phone', Phone || null)
				.input('Email', Email || null)
				.input('Status', Status || 'Active')
				.input('Type', Type || 'Client')
				.input('Website', Website || null)
				.query(`
					INSERT INTO tenderCompany (AddBy, CompanyName, Phone, Email, Status, Type, Website, CreatedAt)
					OUTPUT INSERTED.CompanyID
					VALUES (@AddBy, @CompanyName, @Phone, @Email, @Status, @Type, @Website, GETDATE())
				`);

			const companyId = result.recordset[0].CompanyID;
			res.status(201).json({ 
				message: 'Company created successfully', 
				companyId: companyId 
			});
		} catch (err) {
			console.error('Error creating company:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Update company
	updateCompany: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const { id } = req.params;
			const updateFields = req.body;
			const setClauses = Object.keys(updateFields)
				.filter(key => updateFields[key] !== undefined)
				.map(key => `${key} = @${key}`);
			if (setClauses.length === 0) {
				return res.status(400).json({ message: 'No valid fields to update' });
			}
			const request = pool.request();
			Object.entries(updateFields).forEach(([key, value]) => {
				if (value !== undefined) request.input(key, value);
			});
			request.input('CompanyID', id);
			const result = await request.query(`
				UPDATE tenderCompany
				SET ${setClauses.join(', ')}, UpdatedAt = GETDATE()
				WHERE CompanyID = @CompanyID AND IsDeleted = 0
			`);
			if (result.rowsAffected[0] === 0) {
				return res.status(404).json({ message: 'Company not found or already deleted' });
			}
			res.json({ message: 'Company updated successfully' });
		} catch (err) {
			console.error('Error updating company:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Find candidate people via Hunter.io for a company's domain (Dublin only)
	getHunterSuggestions: async (req, res) => {
		try {
			const { id } = req.params;
			if (!id) return res.status(400).json({ message: 'Company ID is required' });

			const HUNTER_API_KEY = process.env.HUNTER_API_KEY || process.env.NEXT_PUBLIC_HUNTER_API_KEY;
			if (!HUNTER_API_KEY) {
				return res.status(500).json({ message: 'Hunter API key not configured' });
			}

			const pool = await getConnectedPool();

			// Ensure company has at least one contact (employee) to infer domain
			const contactsResult = await pool.request()
				.input('CompanyID', id)
				.query(`
					SELECT TOP 50 Email
					FROM tenderContact
					WHERE CompanyID = @CompanyID AND IsDeleted = 0 AND Email IS NOT NULL AND LEN(LTRIM(RTRIM(Email))) > 3
				`);

			const emails = (contactsResult.recordset || [])
				.map(r => (r.Email || '').trim())
				.filter(e => /@/.test(e));

			if (emails.length === 0) {
				return res.status(400).json({ message: 'No employees with emails found to infer domain' });
			}

			// Extract corporate domain from existing emails (skip common webmails)
			const webmailDomains = new Set(['gmail.com','yahoo.com','outlook.com','hotmail.com','live.com','aol.com','icloud.com','proton.me','protonmail.com']);
			let inferredDomain = null;
			for (const e of emails) {
				const d = e.split('@')[1].toLowerCase();
				if (!webmailDomains.has(d)) { inferredDomain = d; break; }
			}

			if (!inferredDomain) {
				return res.status(400).json({ message: 'Could not infer a corporate domain from employee emails' });
			}

			// Call Hunter.io Domain Search
			const axios = require('axios');
			const url = `https://api.hunter.io/v2/domain-search`;
			const params = { domain: inferredDomain, api_key: HUNTER_API_KEY, type: 'personal', limit: 10 };
			const apiResp = await axios.get(url, { params });
			const payload = apiResp.data || {};
			const companyData = payload.data || {};
			const emailEntries = Array.isArray(companyData.emails) ? companyData.emails : [];

			// Filter to Dublin only using best-effort heuristics
			const isDublinMatch = (entry) => {
				const city = (entry.city || entry.location || '').toString().toLowerCase();
				if (city.includes('dublin')) return true;
				const sources = Array.isArray(entry.sources) ? entry.sources : [];
				return sources.some(s => {
					const uri = (s.uri || s.domain || '').toString().toLowerCase();
					return uri.includes('dublin') || uri.includes('.ie/');
				});
			};

			const suggestions = emailEntries
				.filter(e => isDublinMatch(e))
				.map(e => ({
					name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim() || null,
					email: e.value || null,
					position: e.position || e.position_raw || null,
					department: e.department || null,
					seniority: e.seniority || null,
					confidence: e.confidence || null,
					sources: e.sources || [],
				}));

			return res.json({
				success: true,
				inferredDomain,
				results: suggestions,
				meta: {
					totalFromHunter: emailEntries.length,
					dublinFiltered: suggestions.length
				}
			});
		} catch (err) {
			console.error('Error fetching Hunter suggestions:', err?.response?.data || err.message || err);
			return res.status(500).json({ success: false, message: 'Failed to fetch Hunter suggestions' });
		}
	},

	// Delete company
	deleteCompany: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.input('CompanyID', req.params.id)
				.query('DELETE FROM tenderCompany WHERE CompanyID = @CompanyID');

			if (result.rowsAffected[0] === 0) {
				return res.status(404).json({ message: 'Company not found' });
			}

			res.json({ message: 'Company deleted successfully' });
		} catch (err) {
			console.error('Error deleting company:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Get company statistics
	getCompanyStats: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.query(`
					SELECT 
						COUNT(*) as totalCompanies,
						COUNT(CASE WHEN Status = 'Active' THEN 1 END) as activeCompanies,
						COUNT(CASE WHEN Status = 'Inactive' THEN 1 END) as inactiveCompanies,
						COUNT(CASE WHEN Type = 'Client' THEN 1 END) as clientCompanies,
						COUNT(CASE WHEN Type = 'Prospect' THEN 1 END) as prospectCompanies
					FROM tenderCompany
				`);
			
			res.json(result.recordset[0]);
		} catch (err) {
			console.error('Error fetching company stats:', err);
			res.status(500).json({ message: err.message });
		}
	},

	// Get comprehensive tender analysis for a company
	getCompanyTenderAnalysis: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const companyId = req.params.id;

			// Get direct company tenders (where CompanyID directly matches in tenderTender)
			const directTendersResult = await pool.request()
				.input('CompanyID', companyId)
				.query(`
					SELECT 
						t.TenderID, t.ProjectName, t.Value, t.Status, t.Type, t.OpenDate, t.ReturnDate, t.CreatedAt,
						'Direct Company Tender' as TenderType, 'Company Direct' as ContactRole, 'Company' as ContactName
					FROM tenderTender t
					WHERE t.CompanyID = @CompanyID AND t.IsDeleted = 0
					ORDER BY t.CreatedAt DESC
				`);

			// Debug: Check raw tender data for this company
			const debugResult = await pool.request()
				.input('CompanyID', companyId)
				.query(`
					SELECT TenderID, ProjectName, Value, Status, Type, CompanyID
					FROM tenderTender 
					WHERE CompanyID = @CompanyID AND IsDeleted = 0
				`);
			console.log('🔍 Debug - Raw tender data for CompanyID', companyId, ':', debugResult.recordset);

			// Get tenders where company contacts are involved through tenderTenderContact
			const contactTendersResult = await pool.request()
				.input('CompanyID', companyId)
				.query(`
					SELECT 
						t.TenderID, t.ProjectName, t.Value, t.Status, t.Type, t.OpenDate, t.ReturnDate, t.CreatedAt,
						'Contact Involvement Tender' as TenderType, ttc.role as ContactRole, cont.FullName as ContactName
					FROM tenderTender t
					INNER JOIN tenderTenderContact ttc ON t.TenderID = ttc.tenderId
					INNER JOIN tenderContact cont ON ttc.contactId = cont.ContactID AND cont.IsDeleted = 0
					WHERE cont.CompanyID = @CompanyID AND t.IsDeleted = 0
					ORDER BY t.CreatedAt DESC
				`);

			// Get summary statistics with proper deduplication and robust value parsing
			const summaryResult = await pool.request()
				.input('CompanyID', companyId)
				.query(`
					-- First, get all unique tenders for this company (direct + contact involvement)
					WITH AllCompanyTenders AS (
						SELECT DISTINCT t.TenderID, t.ProjectName, t.Value, t.Status, t.Type, t.OpenDate, t.ReturnDate, t.CreatedAt
						FROM tenderTender t
						WHERE t.CompanyID = @CompanyID AND t.IsDeleted = 0
						
						UNION
						
						SELECT DISTINCT t.TenderID, t.ProjectName, t.Value, t.Status, t.Type, t.OpenDate, t.ReturnDate, t.CreatedAt
						FROM tenderTender t
						INNER JOIN tenderTenderContact ttc ON t.TenderID = ttc.tenderId
						INNER JOIN tenderContact cont ON ttc.contactId = cont.ContactID AND cont.IsDeleted = 0
						WHERE cont.CompanyID = @CompanyID AND t.IsDeleted = 0
					),
					-- Parse the Value field safely
					ParsedTenders AS (
						SELECT 
							TenderID, ProjectName, Status, Type, OpenDate, ReturnDate, CreatedAt,
							CASE 
								WHEN Value IS NULL OR LTRIM(RTRIM(Value)) = '' THEN 0
								ELSE COALESCE(
									TRY_CONVERT(
										DECIMAL(18,2),
										REPLACE(
											REPLACE(
												REPLACE(
													REPLACE(
														REPLACE(REPLACE(Value, '€', ''), 'EUR', ''), ',', ''
													), ' ', ''
												), CHAR(160), ''
											), CHAR(9), ''
										)
									),
									0
								)
							END as ParsedValue
						FROM AllCompanyTenders
					)
					SELECT 
						COUNT(*) as TotalTenders,
						COUNT(CASE WHEN Status = 'Awarded' THEN 1 END) as TotalAwardedTenders,
						COALESCE(SUM(CASE WHEN Status = 'Awarded' THEN ParsedValue ELSE 0 END), 0) as TotalRevenue,
						
						-- Direct company tenders
						(SELECT COUNT(DISTINCT t.TenderID) FROM tenderTender t WHERE t.CompanyID = @CompanyID AND t.IsDeleted = 0) as DirectTenders,
						
						-- Direct awarded tenders
						(SELECT COUNT(DISTINCT t.TenderID) FROM tenderTender t WHERE t.CompanyID = @CompanyID AND t.Status = 'Awarded' AND t.IsDeleted = 0) as DirectAwardedTenders,
						
						-- Direct revenue
						(SELECT COALESCE(SUM(
							COALESCE(
								TRY_CONVERT(
									DECIMAL(18,2),
									REPLACE(
										REPLACE(
											REPLACE(
												REPLACE(
													REPLACE(REPLACE(t.Value, '€', ''), 'EUR', ''), ',', ''
												), ' ', ''
											), CHAR(160), ''
										), CHAR(9), ''
									)
								),
								0
							)
						), 0) FROM tenderTender t WHERE t.CompanyID = @CompanyID AND t.Status = 'Awarded' AND t.IsDeleted = 0) as DirectRevenue,
						
						-- Contact involvement tenders
						(SELECT COUNT(DISTINCT t.TenderID) FROM tenderTender t 
						 INNER JOIN tenderTenderContact ttc ON t.TenderID = ttc.tenderId
						 INNER JOIN tenderContact cont ON ttc.contactId = cont.ContactID AND cont.IsDeleted = 0
						 WHERE cont.CompanyID = @CompanyID AND t.IsDeleted = 0) as ContactInvolvementTenders,
						
						-- Contact awarded tenders
						(SELECT COUNT(DISTINCT t.TenderID) FROM tenderTender t 
						 INNER JOIN tenderTenderContact ttc ON t.TenderID = ttc.tenderId
						 INNER JOIN tenderContact cont ON ttc.contactId = cont.ContactID AND cont.IsDeleted = 0
						 WHERE cont.CompanyID = @CompanyID AND t.Status = 'Awarded' AND t.IsDeleted = 0) as ContactAwardedTenders,
						
						-- Contact revenue
						(SELECT COALESCE(SUM(
							COALESCE(
								TRY_CONVERT(
									DECIMAL(18,2),
									REPLACE(
										REPLACE(
											REPLACE(
												REPLACE(
													REPLACE(REPLACE(t.Value, '€', ''), 'EUR', ''), ',', ''
												), ' ', ''
											), CHAR(160), ''
										), CHAR(9), ''
									)
								),
								0
							)
						), 0) FROM tenderTender t 
						   INNER JOIN tenderTenderContact ttc ON t.TenderID = ttc.tenderId
						   INNER JOIN tenderContact cont ON ttc.contactId = cont.ContactID AND cont.IsDeleted = 0
						   WHERE cont.CompanyID = @CompanyID AND t.Status = 'Awarded' AND t.IsDeleted = 0) as ContactRevenue
					  FROM ParsedTenders
				  `);

			// Calculate success rates
			const summary = summaryResult.recordset[0];
			const directSuccessRate = summary.DirectTenders > 0 ? (summary.DirectAwardedTenders / summary.DirectTenders) * 100 : 0;
			const contactSuccessRate = summary.ContactInvolvementTenders > 0 ? (summary.ContactAwardedTenders / summary.ContactInvolvementTenders) * 100 : 0;

			// Debug logging
			console.log('Company Tender Analysis for CompanyID:', companyId);
			console.log('Raw Summary Data:', summary);
			console.log('Direct Tenders:', directTendersResult.recordset);
			console.log('Contact Involvement Tenders:', contactTendersResult.recordset);
			console.log('Calculated Success Rates:', { directSuccessRate, contactSuccessRate });
			console.log('🔍 Summary Calculation Debug:');
			console.log('  - TotalTenders:', summary.TotalTenders);
			console.log('  - TotalAwardedTenders:', summary.TotalAwardedTenders);
			console.log('  - TotalRevenue:', summary.TotalRevenue);
			console.log('  - DirectTenders:', summary.DirectTenders);
			console.log('  - DirectAwardedTenders:', summary.DirectAwardedTenders);
			console.log('  - DirectRevenue:', summary.DirectRevenue);

			res.json({
				summary: {
					...summary,
					DirectSuccessRate: directSuccessRate,
					ContactSuccessRate: contactSuccessRate
				},
				directTenders: directTendersResult.recordset,
				contactInvolvementTenders: contactTendersResult.recordset
			});

		} catch (err) {
			console.error('Error fetching company tender analysis:', err);
			res.status(500).json({ message: err.message });
		}
	}
};

module.exports = companyController;

