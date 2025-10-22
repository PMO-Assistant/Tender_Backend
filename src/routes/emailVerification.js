const express = require('express');
const router = express.Router();

// Test endpoint
router.get('/email-verification-test', (req, res) => {
  res.json({ message: 'Email verification route is working!' });
});

// Email verification endpoint
router.post('/email-verification', async (req, res) => {
  try {
    console.log('=== BACKEND EMAIL VERIFICATION DEBUG ===');
    console.log('Request body:', req.body);
    
    const { email } = req.body;
    console.log('Email to verify:', email);
    
    if (!email || !email.includes('@')) {
      return res.json({
        success: true,
        result: {
          result: 'unknown',
          message: 'Valid email address is required',
          email: email || 'unknown'
        }
      });
    }

    const apiKey = process.env.EMAIL_CHECK_API;
    console.log('API Key found:', apiKey ? 'Yes' : 'No');
    
    if (!apiKey) {
      return res.json({
        success: true,
        result: {
          result: 'unknown',
          message: 'Email verification API key not configured',
          email: email
        }
      });
    }

    // Use direct HTTP request to quickemailverification API
    const verificationUrl = `https://api.quickemailverification.com/v1/verify?email=${encodeURIComponent(email)}&apikey=${apiKey}`;
    console.log('Making request to:', verificationUrl);

    const response = await fetch(verificationUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', errorText);
      
      return res.json({
        success: true,
        result: {
          result: 'unknown',
          message: `Email verification service error (${response.status})`,
          email: email
        }
      });
    }

    const result = await response.json();
    console.log('Verification result:', result);
    
    res.json({
      success: true,
      result: result
    });

  } catch (error) {
    console.error('Error in email verification API:', error);
    
    res.json({
      success: true,
      result: {
        result: 'unknown',
        message: `Email verification service error: ${error.message || 'Unknown error'}`,
        email: 'unknown'
      }
    });
  }
});

module.exports = router;


