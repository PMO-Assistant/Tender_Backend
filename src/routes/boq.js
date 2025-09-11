const express = require('express');
const router = express.Router();
const boqController = require('../controllers/boq/boqController');

// GET propose breakdown for a BOQ file
router.get('/:tenderId/:fileId/propose', boqController.proposeBreakdown);

// POST process BOQ file and store items in database
router.post('/:tenderId/:fileId/process', boqController.processBOQ);

// GET BOQ items for a file
router.get('/:tenderId/:fileId/items', boqController.getBOQItems);

module.exports = router;


