const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const controller = require('../controllers/blobController'); 

router.get('/list', controller.listFiles);
router.post('/upload', upload.single('file'), controller.uploadFile);
router.delete('/:name', controller.deleteFile);
router.post('/rename', controller.renameFile);
router.post('/move', controller.moveFile);

module.exports = router;
