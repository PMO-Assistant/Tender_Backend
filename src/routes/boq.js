const express = require('express');
const router = express.Router();
const boqController = require('../controllers/boq/boqController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

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

// List BOQ records for a tender (new schema)
router.get('/tender/:tenderId', boqController.listTenderBoQ);

// RFQ: list, create, update, and delete quotations for a package
router.get('/:tenderId/:fileId/packages/:packageName/rfq', boqController.listPackageRFQ);
router.post('/:tenderId/:fileId/packages/:packageName/rfq', boqController.createPackageRFQ);
router.put('/:tenderId/:fileId/packages/:packageName/rfq/:rfqId', boqController.updatePackageRFQ);
router.delete('/:tenderId/:fileId/packages/:packageName/rfq/:rfqId', boqController.deletePackageRFQ);

// GET split files derived from a BOQ
router.get('/:tenderId/:fileId/split-files', boqController.getSplitFiles);

// GET package dashboard stats
router.get('/:tenderId/:fileId/packages/dashboard', boqController.getPackageDashboardStats);

// GET breakdown coverage report
router.get('/:tenderId/:fileId/breakdown-report', boqController.breakdownReport);

// POST compare Excel quotation with original package file
router.post('/:tenderId/:fileId/packages/:packageName/rfq/:rfqId/compare-excel', 
  upload.single('file'), 
  boqController.compareExcelQuotation
);

// DELETE BOQ and its file (soft-delete file)
router.delete('/:tenderId/:fileId', boqController.deleteBoQ);

module.exports = router;
