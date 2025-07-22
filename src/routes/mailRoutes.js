const express = require('express');
const router = express.Router();
const mailController = require('../controllers/mailController');

// notify specifically Enos
router.post('/notify-enos', mailController.notifyEnos);

// notify anyone by name
router.post('/notify-by-name', mailController.notifyByName);

// manually trigger overdue asset check
router.post('/check-overdue-assets', mailController.checkAndNotifyOverdueAssets);

module.exports = router;
