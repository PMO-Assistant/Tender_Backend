const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact/contactController');

router.get('/test', contactController.test);
router.get('/test-db', contactController.testDb);
router.post('/test-update', contactController.testUpdate);
router.get('/', contactController.getAllContacts);
router.get('/company', contactController.getContactsByCompany);
router.get('/company/count', contactController.getContactCountByCompany);
// Place specific routes BEFORE generic "/:id" routes
router.get('/:id', contactController.getContactById);
router.post('/', contactController.createContact);
router.put('/:id', contactController.updateContact);
router.delete('/:id', contactController.deleteContact);

module.exports = router;
