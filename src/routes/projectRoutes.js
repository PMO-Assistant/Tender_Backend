const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const validateAdcoToken = require('../middleware/validateAdcoToken');

// Get all projects
router.get('/', validateAdcoToken, projectController.getAllProjects);

// Get active projects only
router.get('/active', validateAdcoToken, projectController.getActiveProjects);

// Get project by ID
router.get('/:id', validateAdcoToken, projectController.getProjectById);

// Create new project
router.post('/', validateAdcoToken, projectController.createProject);

// Update project
router.put('/:id', validateAdcoToken, projectController.updateProject);

// Delete project
router.delete('/:id', validateAdcoToken, projectController.deleteProject);

module.exports = router; 