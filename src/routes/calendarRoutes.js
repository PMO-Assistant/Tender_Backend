const express = require('express');
const router = express.Router();
const validateAdcoToken = require('../middleware/validateAdcoToken');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// GET /api/calendar/events - Fetch events from the calendar@adco.ie shared calendar
router.get('/events', validateAdcoToken, async (req, res) => {
  try {
    // Extract token from Authorization header (set by validateAdcoToken middleware)
    const authHeader = req.headers.authorization;
    const accessToken = authHeader.split(' ')[1];

    if (!accessToken) {
      console.error('No access token found in Authorization header');
      return res.status(401).json({ error: 'No access token found.' });
    }

    // Use the shared calendar for calendar@adco.ie
    const calendarEmail = process.env.CALENDAR_EMAIL || 'calendar@adco.ie';
    const timezone = process.env.CALENDAR_TIMEZONE || 'Europe/Dublin';
    const graphApiUrl = `https://graph.microsoft.com/v1.0/users/${calendarEmail}/calendar/events`;
    console.log('Fetching calendar events from:', graphApiUrl);

    const graphResponse = await fetch(graphApiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': `outlook.timezone="${timezone}"`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!graphResponse.ok) {
      const errorData = await graphResponse.json();
      console.error('Microsoft Graph API Error Details:', {
        status: graphResponse.status,
        statusText: graphResponse.statusText,
        error: errorData,
        headers: Object.fromEntries(graphResponse.headers.entries())
      });
      return res.status(graphResponse.status).json({ 
        error: errorData.error?.message || 'Failed to fetch events from Graph API',
        details: errorData
      });
    }

    const graphData = await graphResponse.json();
    console.log('Successfully fetched calendar events:', {
      eventCount: graphData.value?.length || 0,
      firstEvent: graphData.value?.[0]?.subject
    });
    res.json(graphData);

  } catch (error) {
    console.error('Error in backend calendar route:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: 'Internal server error fetching calendar events.',
      details: error.message
    });
  }
});

module.exports = router; 
