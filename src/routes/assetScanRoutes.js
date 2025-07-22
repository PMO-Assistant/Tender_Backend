const express = require('express');
const router = express.Router();
const assetScanController = require('../controllers/assetScanController');
const validateAdcoToken = require('../middleware/validateAdcoToken');

// Create new asset scans (one or many)
router.post('/', validateAdcoToken, assetScanController.createScans);

module.exports = router;
