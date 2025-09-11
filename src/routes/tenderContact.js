const express = require('express');
const router = express.Router();
const tenderContactController = require('../controllers/tender/tenderContactController');

// Get all tenders where a contact is assigned (must come before /:tenderId/contacts)
router.get('/contact/:contactId', tenderContactController.getTendersByContact);

// Get all contacts assigned to a tender
router.get('/:tenderId/contacts', tenderContactController.getTenderContacts);

// Assign a contact to a tender
router.post('/:tenderId/contacts', tenderContactController.assignContactToTender);

// Remove a contact from a tender
router.delete('/:tenderId/contacts/:contactId', tenderContactController.removeContactFromTender);

// Update contact assignment (role, participation note)
router.put('/:tenderId/contacts/:contactId', tenderContactController.updateTenderContactAssignment);

module.exports = router;






