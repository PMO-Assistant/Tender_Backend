const express = require('express');
const router = express.Router();
const { fileFavController } = require('../controllers/files/fileFavController');

// Add file to favorites
router.post('/:fileId', fileFavController.addToFavorites);

// Remove file from favorites
router.delete('/:fileId', fileFavController.removeFromFavorites);

// Get user's favorite files
router.get('/', fileFavController.getFavoriteFiles);

// Check if file is favorited by user
router.get('/:fileId/status', fileFavController.checkFavoriteStatus);

module.exports = router; 