const express = require('express');
const router = express.Router();
const boqController = require('../controllers/boq/boqController');

// GET propose breakdown for a BOQ file
router.get('/:tenderId/:fileId/propose', boqController.proposeBreakdown);

// POST process BOQ file and store items in database
router.post('/:tenderId/:fileId/process', boqController.processBOQ);

// GET BOQ items for a file
router.get('/:tenderId/:fileId/items', boqController.getBOQItems);

// GET BOQ structure for range selection
router.get('/:tenderId/:fileId/structure', boqController.getBoqStructure);

// GET full Excel data with formatting
router.get('/:tenderId/:fileId/excel-data', boqController.getExcelData);

// POST split BOQ file into separate Excel files
router.post('/:tenderId/:fileId/split', boqController.splitBOQ);

// PUT update packages for a BOQ file
router.put('/:tenderId/:fileId/packages', boqController.updatePackages);

module.exports = router;


