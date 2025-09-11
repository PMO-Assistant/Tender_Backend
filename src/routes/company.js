const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company/companyController');

router.get('/', companyController.getAllCompanies);
router.get('/stats', companyController.getCompanyStats);
router.get('/:id', companyController.getCompanyById);
router.get('/:id/tender-analysis', companyController.getCompanyTenderAnalysis);
router.post('/', companyController.createCompany);
router.put('/:id', companyController.updateCompany);
router.delete('/:id', companyController.deleteCompany);

// Hunter.io suggestions (Dublin-only) for a company
router.get('/:id/hunter-suggestions', companyController.getHunterSuggestions);

module.exports = router;
