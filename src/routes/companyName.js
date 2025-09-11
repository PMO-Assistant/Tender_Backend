const express = require('express');
const router = express.Router();
const companyNameController = require('../controllers/company/companyNameController');

// Get company name by ID
router.get('/:companyId', companyNameController.getCompanyNameById);

// Get multiple company names by IDs (batch operation)
router.post('/batch', companyNameController.getCompanyNamesByIds);

module.exports = router;



