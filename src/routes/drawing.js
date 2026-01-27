const express = require('express');
const router = express.Router();
const drawingController = require('../controllers/drawing/drawingController');
const { authenticateToken } = require('../middleware/auth');
const { hasAnyPermission } = require('../middleware/permissions');

// Extract drawing information using AI
router.post('/extract/:fileId', authenticateToken, hasAnyPermission, drawingController.extractDrawingInfo);

// Save drawing information
router.post('/:tenderId', authenticateToken, hasAnyPermission, drawingController.saveDrawing);

// Get drawing by file ID
router.get('/file/:fileId', authenticateToken, hasAnyPermission, drawingController.getDrawingByFileId);

// Get all drawings for a tender
router.get('/tender/:tenderId', authenticateToken, hasAnyPermission, drawingController.getDrawingsByTenderId);

// Delete a drawing
router.delete('/:drawingId', authenticateToken, hasAnyPermission, drawingController.deleteDrawing);

// Create a new package
router.post('/package/:tenderId', authenticateToken, hasAnyPermission, drawingController.createPackage);

// Get all packages for a tender
router.get('/packages/:tenderId', authenticateToken, hasAnyPermission, drawingController.getAllPackages);

module.exports = router;

