const express = require('express');
const router = express.Router();

// Load the LinkedIn Finder controller
const {
  findLinkedInProfilesPlayground,
  getSearchHistory,
  testTableCreation
} = require('../controllers/contact/linkedinFinderController');

const { authenticateToken } = require('../middleware/auth');
const { hasAnyPermission } = require('../middleware/permissions');

console.log('[LINKEDIN ROUTES] LinkedIn Finder routes loaded');
console.log('[LINKEDIN ROUTES] findLinkedInProfilesPlayground type:', typeof findLinkedInProfilesPlayground);
console.log('[LINKEDIN ROUTES] getSearchHistory type:', typeof getSearchHistory);
console.log('[LINKEDIN ROUTES] testTableCreation type:', typeof testTableCreation);

// Test endpoint to create table
router.get('/test-table', authenticateToken, hasAnyPermission, (req, res) => {
  if (typeof testTableCreation === 'function') {
    testTableCreation(req, res);
  } else {
    res.status(500).json({ error: 'testTableCreation is not a function' });
  }
});

// Find LinkedIn profiles for a contact using Mistral AI (playground/web_search flow)
router.post('/contact/:contactId/find', authenticateToken, hasAnyPermission, (req, res) => {
  console.log('[LINKEDIN ROUTES] /contact/:contactId/find invoked with body:', req.body);
  if (typeof findLinkedInProfilesPlayground === 'function') {
    findLinkedInProfilesPlayground(req, res);
  } else {
    res.status(500).json({ error: 'findLinkedInProfilesPlayground is not a function' });
  }
});

// Get search history for a contact
router.get('/contact/:contactId/history', authenticateToken, hasAnyPermission, (req, res) => {
  if (typeof getSearchHistory === 'function') {
    getSearchHistory(req, res);
  } else {
    res.status(500).json({ error: 'getSearchHistory is not a function' });
  }
});

// Test endpoint
router.get('/test', authenticateToken, hasAnyPermission, (req, res) => {
  res.json({ message: 'LinkedIn Finder API is working with Mistral AI' });
});

module.exports = router;











