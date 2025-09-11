const express = require('express');
const router = express.Router();
const rfiController = require('../controllers/rfi/rfiController');

// RFI Routes - Text Only
router.post('/:tenderId/text', rfiController.createRFIText);     // Create text-only RFI
router.get('/:tenderId', rfiController.getRFIs);                // Get all RFIs for tender
router.get('/:tenderId/:rfiId', rfiController.getRFI);           // Get specific RFI
router.put('/:tenderId/:rfiId', rfiController.updateRFI);        // Update RFI
router.delete('/:tenderId/:rfiId', rfiController.deleteRFI);     // Delete RFI

module.exports = router;