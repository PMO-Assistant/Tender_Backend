const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const shareController = require('../controllers/share/shareController');
const { authenticateToken } = require('../middleware/auth');
const { hasAnyPermission } = require('../middleware/permissions');

const publicShareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

const publicFileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many file requests. Please try again later.' }
});

// Create a new share link (requires authentication)
router.post('/', authenticateToken, hasAnyPermission, shareController.createShareLink);

// Get all share links for a tender (requires authentication)
router.get('/tender/:tenderId', authenticateToken, hasAnyPermission, shareController.getShareLinksByTender);

// Delete/deactivate a share link (requires authentication)
router.delete('/:shareLinkId', authenticateToken, hasAnyPermission, shareController.deleteShareLink);

// Get share link details by token (public access - no auth required)
router.get('/access/:token', publicShareLimiter, shareController.getShareLinkByToken);

// Get shared drawings/files (public access - no auth required)
router.get('/access/:token/drawings', publicShareLimiter, shareController.getSharedDrawings);

// Download a file from share link (public access - no auth required, but checks permission)
router.get('/access/:token/download/:fileId', publicFileLimiter, shareController.downloadSharedFile);
router.get('/access/:token/download-all', publicFileLimiter, shareController.downloadAllSharedFiles);

// Get view URL for a file from share link (public access - no auth required)
router.get('/access/:token/view/:fileId', publicFileLimiter, shareController.getSharedFileViewUrl);

// Stream file directly for viewing (public access - no auth required, fallback if SAS fails)
router.get('/access/:token/stream/:fileId', publicFileLimiter, shareController.streamSharedFile);

module.exports = router;

