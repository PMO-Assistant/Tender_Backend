const express = require('express');
const router = express.Router();
const tenderController = require('../controllers/tender/tenderController');

router.get('/', tenderController.getAllTenders);
// Preview next tender number (must be before dynamic :id route)
router.get('/preview/next-number', tenderController.getNextTenderNumber);
// Test endpoint for managing tender table
router.get('/test/managing', tenderController.testManagingTable);
// Get available tender categories (must be before :id route)
router.get('/categories', tenderController.getTenderCategories);
// Get tender report data for charts (must be before :id route)
router.get('/report/data', tenderController.getTenderReportData);
// Get tenders by company (must be before :id route)
router.get('/company/:id', tenderController.getTendersByCompany);
router.get('/:id', tenderController.getTenderById);
router.post('/', tenderController.createTender);
router.put('/:id', tenderController.updateTender);
router.delete('/:id', tenderController.deleteTender);

module.exports = router;
