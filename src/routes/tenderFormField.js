const express = require('express');
const router = express.Router();
const controller = require('../controllers/files/formFieldController');

router.get('/', controller.getAllFields);
router.get('/:id', controller.getFieldById);
router.post('/', controller.createField);
router.put('/:id', controller.updateField);
router.delete('/:id', controller.deleteField);

module.exports = router;
