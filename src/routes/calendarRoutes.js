const express = require('express');
const router = express.Router();
const { sessionAuthMiddleware } = require('../middleware/auth');
const fetch = require('node-fetch'); // Assuming node-fetch is available


// GET /api/calendar/events - Fetch events from the specified shared calendar
router.get('/events', sessionAuthMiddleware, async (req, res) => {
  try {
    const accessToken = req.session.user?.accessToken;

    if (!accessToken) {
      return res.status(401).json({ error: 'No access token found in session.' });
    }

    
    const calendarId = process.env.GRAPH_CALENDAR_ID;
    const graphApiUrl = `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`;
    


    const graphResponse = await fetch(graphApiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'outlook.timezone="Europe/Dublin"',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!graphResponse.ok) {
      const errorData = await graphResponse.json();
      console.error('Microsoft Graph API Error:', errorData);
      return res.status(graphResponse.status).json({ error: errorData.error?.message || 'Failed to fetch events from Graph API' });
    }

    const graphData = await graphResponse.json();
    res.json(graphData);

  } catch (error) {
    console.error('Error in backend calendar route:', error);
    res.status(500).json({ error: 'Internal server error fetching calendar events.' });
  }
});

module.exports = router; 