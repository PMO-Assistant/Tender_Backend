const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const watchlistController = require('../controllers/watchlist/watchlistController');

// Watchlist routes
router.get('/test', authenticateToken, watchlistController.testWatchlistTable);
router.get('/', authenticateToken, watchlistController.getAllWatchlistItems);
router.get('/:id', authenticateToken, watchlistController.getWatchlistItem);
router.post('/', authenticateToken, watchlistController.createWatchlistItem);
router.put('/:id', authenticateToken, watchlistController.updateWatchlistItem);
router.delete('/:id', authenticateToken, watchlistController.deleteWatchlistItem);

module.exports = router;


