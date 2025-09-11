const { getConnectedPool } = require('../../config/database');

const companyNameController = {
	getCompanyNameById: async (req, res) => {
		try {
			const pool = await getConnectedPool();
			const result = await pool.request()
				.input('CompanyID', req.params.CompanyID || req.params.id)
				.query(`
					SELECT CompanyID, CompanyName AS Name
					FROM tenderCompany
					WHERE CompanyID = @CompanyID AND IsDeleted = 0
				`);

			if (result.recordset.length === 0) {
				return res.status(404).json({ 
					error: 'Not found',
					message: 'Company not found'
				});
			}

			res.json({
				CompanyID: result.recordset[0].CompanyID,
				Name: result.recordset[0].Name
			});
		} catch (error) {
			console.error('Error fetching company name:', error);
			res.status(500).json({ error: 'Failed to fetch company name' });
		}
	},

	getCompanyNamesByIds: async (req, res) => {
		try {
			const { ids } = req.body;
			if (!Array.isArray(ids) || ids.length === 0) {
				return res.status(400).json({ error: 'Invalid or empty ids array' });
			}

			const placeholders = ids.map((_, idx) => `@id${idx}`).join(',');
			const pool = await getConnectedPool();
			const request = pool.request();
			ids.forEach((id, idx) => request.input(`id${idx}`, id));

			const result = await request.query(`
				SELECT CompanyID, CompanyName AS Name
				FROM tenderCompany
				WHERE CompanyID IN (${placeholders}) AND IsDeleted = 0
				ORDER BY CompanyName
			`);

			res.json(result.recordset);
		} catch (error) {
			console.error('Error fetching company names by ids:', error);
			res.status(500).json({ error: 'Failed to fetch company names' });
		}
	}
};

module.exports = companyNameController;



