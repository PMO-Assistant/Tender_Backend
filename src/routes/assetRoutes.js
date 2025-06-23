const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const validateAdcoToken = require('../middleware/validateAdcoToken');

// Get all assets
router.get('/', validateAdcoToken, assetController.getAllAssets);

// Get asset by ID
router.get('/:id', validateAdcoToken, assetController.getAssetById);

// Create new asset
router.post('/', validateAdcoToken, assetController.createAsset);

// Update asset
router.put('/:id', validateAdcoToken, assetController.updateAsset);

// Delete asset
router.delete('/:id', validateAdcoToken, assetController.deleteAsset);

// Get asset history
router.get('/history', validateAdcoToken, assetController.getAssetHistory);

module.exports = router; 