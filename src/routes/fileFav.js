const express = require('express');
const router = express.Router();
const { fileFavController } = require('../controllers/files/fileFavController');

// Get user's favorite files (must be before /:fileId routes)
router.get('/', fileFavController.getFavoriteFiles);

// Check if file is favorited by user (more specific route, must be before /:fileId)
router.get('/:fileId/status', fileFavController.checkFavoriteStatus);

// Add file to favorites
router.post('/:fileId', fileFavController.addToFavorites);

// Remove file from favorites
router.delete('/:fileId', fileFavController.removeFromFavorites);

module.exports = router; 