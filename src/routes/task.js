const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task/taskController');

// Test endpoint
router.get('/test', taskController.testTaskEndpoint);

// Test notification system
router.get('/test-notifications', taskController.testNotificationSystem);

// Test email notifications
router.post('/test-email', taskController.testEmailNotification);

// Test email notifications with real user data
router.get('/test-email-users', taskController.testEmailWithUsers);

// Debug employee table
router.get('/debug-employees', taskController.debugEmployeeTable);

// Get all tasks for the logged-in user
router.get('/', taskController.getAllTasks);

// Get tasks by tender/project ID
router.get('/tender/:tenderId', taskController.getTasksByTenderId);

// Get available users for assignment (must come before /:taskId)
router.get('/available-users', taskController.getAvailableUsers);

// Get available tenders for task creation (must come before /:taskId)
router.get('/tenders/available', taskController.getAvailableTenders);

// Get task by ID
router.get('/:taskId', taskController.getTaskById);

// Create new task
router.post('/', taskController.createTask);

// Update task
router.put('/:taskId', taskController.updateTask);

// Update task status
router.patch('/:taskId/status', taskController.updateTaskStatus);

// New: Task assignees management (tenderTaskAssignee)
router.get('/:taskId/assignees', taskController.getTaskAssignees);
router.post('/:taskId/assignees', taskController.addTaskAssignee);
router.delete('/:taskId/assignees/:userId', taskController.removeTaskAssignee);

// Complete task
router.post('/:taskId/complete', taskController.completeTask);

// Delete task
router.delete('/:taskId', taskController.deleteTask);

module.exports = router;
 