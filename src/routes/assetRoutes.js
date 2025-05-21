const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');

// Get all assets
router.get('/', assetController.getAllAssets);

// Get asset by ID
router.get('/:id', assetController.getAssetById);

// Create new asset
router.post('/', assetController.createAsset);

// Update asset
router.put('/:id', assetController.updateAsset);

// Delete asset
router.delete('/:id', assetController.deleteAsset);

// Get asset history
router.get('/history', assetController.getAssetHistory);

module.exports = router; 