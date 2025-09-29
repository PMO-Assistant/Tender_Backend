const express = require('express');
const router = express.Router();
const { askTenderAIController } = require('../controllers/ai/tenderAIController');

// POST /api/ai/ask
router.post('/ask', askTenderAIController);

module.exports = router;
