const express = require('express');
const router = express.Router();
const { microsoftLogin, verifyToken, getCurrentUser, validateMicrosoftLogin } = require('../controllers/auth/authController');
const { authenticateToken, loginLimiter } = require('../middleware/auth');

// Microsoft login route with rate limiting
router.post('/microsoft-login', loginLimiter, validateMicrosoftLogin, microsoftLogin);

// Verify token route
router.get('/verify', authenticateToken, verifyToken);

// Get current user route
router.get('/me', authenticateToken, getCurrentUser);

// Logout route (client-side token removal)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

module.exports = router; 