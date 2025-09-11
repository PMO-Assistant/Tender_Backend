const express = require('express');
const router = express.Router();

console.log('[LINKEDIN TEST] Test routes file loaded successfully');

// Basic test route
router.get('/', (req, res) => {
  res.json({ message: 'LinkedIn Finder Test API is working' });
});

// Test route
router.get('/test', (req, res) => {
  res.json({ message: 'Test route working' });
});

// Frontend expects this endpoint for finding profiles
router.post('/contact/:contactId/find', (req, res) => {
  try {
    const { name, company } = req.body;
    const contactId = req.params.contactId;
    
    console.log(`[LINKEDIN] Finding profiles for contact ${contactId}`);
    console.log(`[LINKEDIN] Search criteria: Name: ${name}, Company: ${company}`);
    
    // Generate dynamic mock data based on the actual contact being searched
    const mockProfiles = [
      {
        id: 1,
        name: name, // Use the actual contact name from the request
        company: company, // Use the actual company from the request
        position: 'Senior Manager - Operations',
        linkedInUrl: `https://linkedin.com/in/demo-profile-${contactId}-1`,
        photo: {
          type: 'initials',
          initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          color: 'bg-blue-500'
        },
        confidence: 95,
        analysis: `High confidence match: Name matches exactly, currently employed at ${company} in Dublin, Ireland. Position aligns with company operations.`,
        location: 'Dublin, Ireland',
        currentRole: true,
        companyVerified: true
      },
      {
        id: 2,
        name: name,
        company: company,
        position: 'Operations Director',
        linkedInUrl: `https://linkedin.com/in/demo-profile-${contactId}-2`,
        photo: {
          type: 'initials',
          initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          color: 'bg-green-500'
        },
        confidence: 88,
        analysis: `Good match: Name matches, currently at ${company} in Ireland. Previous experience in operations management.`,
        location: 'Ireland',
        currentRole: true,
        companyVerified: true
      },
      {
        id: 3,
        name: name,
        company: company,
        position: 'Project Manager',
        linkedInUrl: `https://linkedin.com/in/demo-profile-${contactId}-3`,
        photo: {
          type: 'initials',
          initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          color: 'bg-purple-500'
        },
        confidence: 82,
        analysis: `Reasonable match: Name matches, currently at ${company}. Project management background.`,
        location: 'United Kingdom',
        currentRole: true,
        companyVerified: true
      }
    ];

    // Filter and prioritize by location and company verification
    const prioritizedProfiles = mockProfiles
      .filter(profile => profile.companyVerified) // Only show profiles with verified company experience
      .sort((a, b) => {
        // Priority 1: Dublin, Ireland
        if (a.location === 'Dublin, Ireland' && b.location !== 'Dublin, Ireland') return -1;
        if (b.location === 'Dublin, Ireland' && a.location !== 'Dublin, Ireland') return 1;
        
        // Priority 2: Ireland (anywhere)
        if (a.location.includes('Ireland') && !b.location.includes('Ireland')) return -1;
        if (b.location.includes('Ireland') && !a.location.includes('Ireland')) return 1;
        
        // Priority 3: Confidence score
        return b.confidence - a.confidence;
      });

    res.json({
      success: true,
      message: 'LinkedIn profiles found successfully',
      profiles: prioritizedProfiles,
      searchCriteria: {
        name,
        company,
        contactId,
        locationPriority: 'Dublin → Ireland → Other locations',
        companyVerification: '100% verified company experience required'
      }
    });
  } catch (error) {
    console.error('[LINKEDIN] Error in find endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Frontend expects this endpoint for getting search history
router.get('/contact/:contactId/history', (req, res) => {
  try {
    const contactId = req.params.contactId;
    console.log(`[LINKEDIN] Getting history for contact ${contactId}`);
    
    // Return mock history with dynamic contact info
    res.json({
      success: true,
      searchHistory: [
        {
          SearchID: 1,
          ContactName: 'Contact Name', // This will be populated by the frontend
          Company: 'Company Name', // This will be populated by the frontend
          SearchResults: 'Found 3 profiles (2 in Ireland, 1 in UK)',
          ConfidenceScore: 95,
          LocationPriority: 'Dublin, Ireland',
          CompanyVerified: true,
          CreatedAt: new Date().toISOString()
        }
      ]
    });
  } catch (error) {
    console.error('[LINKEDIN] Error in history endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;


console.log('[LINKEDIN TEST] Test routes file loaded successfully');

// Basic test route
router.get('/', (req, res) => {
  res.json({ message: 'LinkedIn Finder Test API is working' });
});

// Test route
router.get('/test', (req, res) => {
  res.json({ message: 'Test route working' });
});

// Frontend expects this endpoint for finding profiles
router.post('/contact/:contactId/find', (req, res) => {
  try {
    const { name, company } = req.body;
    const contactId = req.params.contactId;
    
    console.log(`[LINKEDIN] Finding profiles for contact ${contactId}`);
    console.log(`[LINKEDIN] Search criteria: Name: ${name}, Company: ${company}`);
    
    // Generate dynamic mock data based on the actual contact being searched
    const mockProfiles = [
      {
        id: 1,
        name: name, // Use the actual contact name from the request
        company: company, // Use the actual company from the request
        position: 'Senior Manager - Operations',
        linkedInUrl: `https://linkedin.com/in/demo-profile-${contactId}-1`,
        photo: {
          type: 'initials',
          initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          color: 'bg-blue-500'
        },
        confidence: 95,
        analysis: `High confidence match: Name matches exactly, currently employed at ${company} in Dublin, Ireland. Position aligns with company operations.`,
        location: 'Dublin, Ireland',
        currentRole: true,
        companyVerified: true
      },
      {
        id: 2,
        name: name,
        company: company,
        position: 'Operations Director',
        linkedInUrl: `https://linkedin.com/in/demo-profile-${contactId}-2`,
        photo: {
          type: 'initials',
          initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          color: 'bg-green-500'
        },
        confidence: 88,
        analysis: `Good match: Name matches, currently at ${company} in Ireland. Previous experience in operations management.`,
        location: 'Ireland',
        currentRole: true,
        companyVerified: true
      },
      {
        id: 3,
        name: name,
        company: company,
        position: 'Project Manager',
        linkedInUrl: `https://linkedin.com/in/demo-profile-${contactId}-3`,
        photo: {
          type: 'initials',
          initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          color: 'bg-purple-500'
        },
        confidence: 82,
        analysis: `Reasonable match: Name matches, currently at ${company}. Project management background.`,
        location: 'United Kingdom',
        currentRole: true,
        companyVerified: true
      }
    ];

    // Filter and prioritize by location and company verification
    const prioritizedProfiles = mockProfiles
      .filter(profile => profile.companyVerified) // Only show profiles with verified company experience
      .sort((a, b) => {
        // Priority 1: Dublin, Ireland
        if (a.location === 'Dublin, Ireland' && b.location !== 'Dublin, Ireland') return -1;
        if (b.location === 'Dublin, Ireland' && a.location !== 'Dublin, Ireland') return 1;
        
        // Priority 2: Ireland (anywhere)
        if (a.location.includes('Ireland') && !b.location.includes('Ireland')) return -1;
        if (b.location.includes('Ireland') && !a.location.includes('Ireland')) return 1;
        
        // Priority 3: Confidence score
        return b.confidence - a.confidence;
      });

    res.json({
      success: true,
      message: 'LinkedIn profiles found successfully',
      profiles: prioritizedProfiles,
      searchCriteria: {
        name,
        company,
        contactId,
        locationPriority: 'Dublin → Ireland → Other locations',
        companyVerification: '100% verified company experience required'
      }
    });
  } catch (error) {
    console.error('[LINKEDIN] Error in find endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Frontend expects this endpoint for getting search history
router.get('/contact/:contactId/history', (req, res) => {
  try {
    const contactId = req.params.contactId;
    console.log(`[LINKEDIN] Getting history for contact ${contactId}`);
    
    // Return mock history with dynamic contact info
    res.json({
      success: true,
      searchHistory: [
        {
          SearchID: 1,
          ContactName: 'Contact Name', // This will be populated by the frontend
          Company: 'Company Name', // This will be populated by the frontend
          SearchResults: 'Found 3 profiles (2 in Ireland, 1 in UK)',
          ConfidenceScore: 95,
          LocationPriority: 'Dublin, Ireland',
          CompanyVerified: true,
          CreatedAt: new Date().toISOString()
        }
      ]
    });
  } catch (error) {
    console.error('[LINKEDIN] Error in history endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
