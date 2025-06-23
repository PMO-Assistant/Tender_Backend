const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const validateAdcoToken = require('../middleware/validateAdcoToken');

// Get all employees
router.get('/', validateAdcoToken, employeeController.getAllEmployees);

// Get employee by ID
router.get('/:id', validateAdcoToken, employeeController.getEmployeeById);

// Create new employee
router.post('/', validateAdcoToken, employeeController.createEmployee);

// Update employee
router.put('/:id', validateAdcoToken, employeeController.updateEmployee);

// Delete employee
router.delete('/:id', validateAdcoToken, employeeController.deleteEmployee);

module.exports = router; 