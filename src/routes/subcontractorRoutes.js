const express = require('express');
const router = express.Router();
const subcontractorController = require('../controllers/subcontractorController');
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
router.get('/', subcontractorController.getAll);
router.get('/:id', subcontractorController.getById);
router.post('/', subcontractorController.create);
router.put('/:id', subcontractorController.update);
router.delete('/:id', subcontractorController.delete);

// CSV Upload
router.post('/upload-csv', uploadLimiter, upload.single('file'), subcontractorController.uploadCSV);

// CSV Upload for Ratings
router.post('/upload-ratings-csv', uploadLimiter, upload.single('file'), subcontractorController.uploadRatingsCSV);

// CSV Upload for Reviews
router.post('/upload-reviews-csv', uploadLimiter, upload.single('file'), subcontractorController.uploadReviewsCSV);

// --- Reviews ---
router.get('/:subid/reviews', subcontractorController.getAllReviews);
router.get('/reviews/:reviewid', subcontractorController.getReviewById);
router.post('/:subid/reviews', subcontractorController.createReview);
router.put('/reviews/:reviewid', subcontractorController.updateReview);
router.delete('/reviews/:reviewid', subcontractorController.deleteReview);

// --- Comments ---
router.get('/:subid/comments', subcontractorController.getAllComments);
router.get('/comments/:commentid', subcontractorController.getCommentById);
router.post('/:subid/comments', subcontractorController.createComment);
router.put('/comments/:commentid', subcontractorController.updateComment);
router.delete('/comments/:commentid', subcontractorController.deleteComment);

// Add new route for checking SubID
router.get('/check/:subID', subcontractorController.checkSubID);

module.exports = router; 