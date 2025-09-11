const express = require('express');
const router = express.Router();
const orgChartController = require('../controllers/tender/orgChartController');

// Get org chart for a tender
router.get('/:tenderId', orgChartController.getOrgChartByTenderId);

// Save/update org chart for a tender
router.post('/:tenderId', orgChartController.saveOrgChart);

// Get org chart history
router.get('/:tenderId/history', orgChartController.getOrgChartHistory);

// Restore a version
router.post('/:tenderId/restore/:version', orgChartController.restoreOrgChartVersion);

// Soft delete
router.delete('/:tenderId', orgChartController.deleteOrgChart);

module.exports = router; 
 
 