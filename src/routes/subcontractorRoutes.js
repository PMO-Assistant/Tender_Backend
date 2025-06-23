const express = require('express');
const router = express.Router();
const subcontractorController = require('../controllers/subcontractorController');
const validateAdcoToken = require('../middleware/validateAdcoToken');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const rateLimit = require('express-rate-limit');

// Configure rate limiter
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many upload requests from this IP, please try again after 15 minutes'
});

// --- Subcontractors ---
router.get('/', validateAdcoToken, subcontractorController.getAll);
router.get('/:id', validateAdcoToken, subcontractorController.getById);
router.post('/', validateAdcoToken, subcontractorController.create);
router.put('/:id', validateAdcoToken, subcontractorController.update);
router.delete('/:id', validateAdcoToken, subcontractorController.delete);

// Bulk upload endpoints
router.post('/bulk', validateAdcoToken, subcontractorController.bulkCreate);
router.post('/ratings/bulk', validateAdcoToken, subcontractorController.bulkCreateReviews);

// CSV Upload
router.post('/upload-csv', validateAdcoToken, uploadLimiter, upload.single('file'), subcontractorController.uploadCSV);

// CSV Upload for Ratings
router.post('/upload-ratings-csv', validateAdcoToken, uploadLimiter, upload.single('file'), subcontractorController.uploadRatingsCSV);

// CSV Upload for Reviews
router.post('/upload-reviews-csv', validateAdcoToken, uploadLimiter, upload.single('file'), subcontractorController.uploadReviewsCSV);

// --- Reviews ---
router.get('/:subid/reviews', validateAdcoToken, subcontractorController.getAllReviews);
router.get('/reviews/:reviewid', validateAdcoToken, subcontractorController.getReviewById);
router.post('/:subid/reviews', validateAdcoToken, subcontractorController.createReview);
router.put('/reviews/:reviewid', validateAdcoToken, subcontractorController.updateReview);
router.delete('/reviews/:reviewid', validateAdcoToken, subcontractorController.deleteReview);

// --- Comments ---
router.get('/:subid/comments', validateAdcoToken, subcontractorController.getAllComments);
router.get('/comments/:commentid', validateAdcoToken, subcontractorController.getCommentById);
router.post('/:subid/comments', validateAdcoToken, subcontractorController.createComment);
router.put('/comments/:commentid', validateAdcoToken, subcontractorController.updateComment);
router.delete('/comments/:commentid', validateAdcoToken, subcontractorController.deleteComment);

// Add new route for checking SubID
router.get('/check/:subID', validateAdcoToken, subcontractorController.checkSubID);

// Add route for checking multiple SubIDs
router.post('/check-multiple', validateAdcoToken, subcontractorController.checkMultipleSubIDs);

module.exports = router; 