const express = require('express');
const router = express.Router();
const shareController = require('../controllers/share/shareController');
const { authenticateToken } = require('../middleware/auth');
const { hasAnyPermission } = require('../middleware/permissions');

// Create a new share link (requires authentication)
router.post('/', authenticateToken, hasAnyPermission, shareController.createShareLink);

// Get all share links for a tender (requires authentication)
router.get('/tender/:tenderId', authenticateToken, hasAnyPermission, shareController.getShareLinksByTender);

// Delete/deactivate a share link (requires authentication)
router.delete('/:shareLinkId', authenticateToken, hasAnyPermission, shareController.deleteShareLink);

// Get share link details by token (public access - no auth required)
router.get('/access/:token', shareController.getShareLinkByToken);

// Get shared drawings/files (public access - no auth required)
router.get('/access/:token/drawings', shareController.getSharedDrawings);

// Download a file from share link (public access - no auth required, but checks permission)
router.get('/access/:token/download/:fileId', shareController.downloadSharedFile);

// Get view URL for a file from share link (public access - no auth required)
router.get('/access/:token/view/:fileId', shareController.getSharedFileViewUrl);

// Stream file directly for viewing (public access - no auth required, fallback if SAS fails)
router.get('/access/:token/stream/:fileId', shareController.streamSharedFile);

module.exports = router;

