const express = require('express');
const router = express.Router();
const userController = require('../controllers/admin/userController');

// Get user by ID
router.get('/:userId', userController.getUserById);

// Get multiple users by IDs
router.post('/batch', userController.getUsersByIds);

// Get all active users
router.get('/', userController.getAllActiveUsers);

// Get all active users with new format for tenders list
router.get('/new-format', userController.getAllActiveUsersNewFormat);

module.exports = router; 