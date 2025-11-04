const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { askTenderAIController } = require('../controllers/ai/tenderAIController');
const { generatePresentationSlides } = require('../controllers/ai/presentationController');
const { importPowerPoint, uploadMiddleware } = require('../controllers/ai/importPowerPointController');
const { exportPowerPoint, loadPresentation } = require('../controllers/ai/exportPowerPointController');

// POST /api/ai/ask
router.post('/ask', askTenderAIController);

// POST /api/ai/presentation/generate
router.post('/presentation/generate', generatePresentationSlides);

// POST /api/ai/presentation/import-pptx
router.post('/presentation/import-pptx', uploadMiddleware, importPowerPoint);

// POST /api/ai/presentation/export-pptx - Export presentation to PowerPoint
router.post('/presentation/export-pptx', authenticateToken, exportPowerPoint);

// GET /api/ai/presentation/load/:tenderId - Load presentation from tender
router.get('/presentation/load/:tenderId', authenticateToken, loadPresentation);

module.exports = router;
