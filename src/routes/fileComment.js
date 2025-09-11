const express = require('express');
const router = express.Router();
const fileCommentController = require('../controllers/files/fileCommentController');

router.get('/', fileCommentController.getAllComments);
router.get('/:id', fileCommentController.getCommentById);
router.get('/file/:fileId', fileCommentController.getCommentsByFileId);
router.post('/', fileCommentController.createComment);
router.put('/:id', fileCommentController.updateComment);
router.delete('/:id', fileCommentController.deleteComment);

module.exports = router;
