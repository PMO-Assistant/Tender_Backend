const express = require('express');
const router = express.Router();
const controller = require('../controllers/contact/contactHistoryController');

router.get('/', controller.getAllHistory);
router.get('/:id', controller.getHistoryById);
router.post('/', controller.createHistory);
router.put('/:id', controller.updateHistory);
router.delete('/:id', controller.deleteHistory);

module.exports = router;
