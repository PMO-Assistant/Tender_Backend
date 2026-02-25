const express = require('express');
const router = express.Router();
const supplyoController = require('../controllers/supplyo/supplyoController');
const supplyoTagController = require('../controllers/supplyo/supplyoTagController');

router.get('/', supplyoController.getAllCompanies);
router.get('/contacts/all', supplyoController.getAllContacts); // Batch endpoint - must be before /:id
router.get('/:id', supplyoController.getCompanyById);
router.get('/:id/contacts', supplyoController.getCompanyContacts);
router.post('/', supplyoController.createCompany);
router.put('/:id', supplyoController.updateCompany);
router.delete('/:id', supplyoController.deleteCompany);
router.post('/:id/contacts', supplyoController.createContact);
router.delete('/contacts/:id', supplyoController.deleteContact);

// Tag routes
router.get('/tags/all', supplyoTagController.getAllTags);
router.post('/tags', supplyoTagController.createTag);
router.delete('/tags/:id', supplyoTagController.deleteTag);
router.get('/:id/tags', supplyoTagController.getCompanyTags);
router.post('/:id/tags', supplyoTagController.setCompanyTags);

module.exports = router;
