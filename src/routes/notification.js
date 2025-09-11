const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notifications/notificationController');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication to all notification routes
router.use(authenticateToken);

// Test database connection
router.get('/test-connection', notificationController.testConnection);

// Get user's notifications
router.get('/', notificationController.getUserNotifications);

// Mark notification as read
router.patch('/:notificationId/read', notificationController.markAsRead);

// Mark all notifications as read
router.patch('/mark-all-read', notificationController.markAllAsRead);

// Delete a notification
router.delete('/:notificationId', notificationController.deleteNotification);

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Notification routes are working' });
});

module.exports = router;


module.exports = router;
