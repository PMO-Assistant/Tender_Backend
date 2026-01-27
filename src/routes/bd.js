const express = require('express');
const router = express.Router();
const bdController = require('../controllers/bd/bdController');
const { authenticateToken } = require('../middleware/auth');

// All BD routes require authentication
router.use(authenticateToken);

// Get all BD entries
router.get('/', bdController.getAllBD);

// Get a single BD entry
router.get('/:id', bdController.getBDById);

// Create a new BD entry
router.post('/', bdController.createBD);

// Update a BD entry
router.put('/:id', bdController.updateBD);

// Delete a BD entry
router.delete('/:id', bdController.deleteBD);

module.exports = router;




