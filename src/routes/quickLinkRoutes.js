const express = require('express');
const router = express.Router();
const quickLinkController = require('../controllers/quickLinkController');
const validateAdcoToken = require('../middleware/validateAdcoToken');

// Get all quick links
router.get('/', validateAdcoToken, quickLinkController.getAllQuickLinks);

// Get quick link by ID
router.get('/:id', validateAdcoToken, quickLinkController.getQuickLinkById);

// Create new quick link
router.post('/', validateAdcoToken, quickLinkController.createQuickLink);

// Update quick link
router.put('/:id', validateAdcoToken, quickLinkController.updateQuickLink);

// Delete quick link
router.delete('/:id', validateAdcoToken, quickLinkController.deleteQuickLink);

module.exports = router; 