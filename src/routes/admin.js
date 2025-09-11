const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin/adminController');

// Get all users with their permissions
router.get('/users', adminController.getAllUsers);

// Add new user with permissions
router.post('/users', adminController.addUser);

// Update user and permissions
router.put('/users/:userId', adminController.updateUser);

// Delete user and their permissions
router.delete('/users/:userId', adminController.deleteUser);

// Reactivate user and restore permissions
router.post('/users/:userId/reactivate', adminController.reactivateUser);

module.exports = router; 
 
 