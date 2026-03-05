const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const emailVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    result: {
      result: 'unknown',
      message: 'Too many verification requests. Please try again later.',
      email: 'unknown'
    }
  }
});

// Test endpoint
router.get('/email-verification-test', (req, res) => {
  res.json({ message: 'Email verification route is working!' });
});

// Email verification endpoint
router.post('/email-verification', emailVerificationLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
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

    const response = await fetch(verificationUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

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


