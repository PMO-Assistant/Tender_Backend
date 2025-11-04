const express = require('express');
const router = express.Router();
const { getLatestPlanningNews } = require('../controllers/planningNewsController');

// GET /api/planning-news/latest - Get latest Area 1 planning list
// Public endpoint (no auth required) since it's just fetching public information
router.get('/latest', getLatestPlanningNews);

module.exports = router;

