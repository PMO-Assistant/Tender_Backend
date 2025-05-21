const express = require('express');
const router = express.Router();
const quickLinkController = require('../controllers/quickLinkController');

// Get all quick links
router.get('/', quickLinkController.getAllQuickLinks);

// Get quick link by ID
router.get('/:id', quickLinkController.getQuickLinkById);

// Create new quick link
router.post('/', quickLinkController.createQuickLink);

// Update quick link
router.put('/:id', quickLinkController.updateQuickLink);

// Delete quick link
router.delete('/:id', quickLinkController.deleteQuickLink);

module.exports = router; 