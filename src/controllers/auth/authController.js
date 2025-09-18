const { getConnectedPool } = require('../../config/database');
const { generateToken, loginLimiter } = require('../../middleware/auth');
const { body, validationResult } = require('express-validator');

// Microsoft authentication endpoint
const microsoftLogin = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please provide valid Microsoft account information',
        details: errors.array()
      });
    }

    const { email, name, accessToken } = req.body;

    console.log('🔐 Backend Microsoft login request:', {
      email: email ? email.substring(0, 3) + '***' : 'Missing',
      name: name ? name.substring(0, 3) + '***' : 'Missing',
      tokenLength: accessToken ? accessToken.length : 0
    });

    // If accessToken looks like an auth code, reject and require popup flow
    if (accessToken && accessToken.length < 200 && /\./.test(accessToken) === false) {
      return res.status(400).json({
        error: 'Invalid token type',
        message: 'Authorization code received. Use MSAL popup/redirect to exchange in browser and send access token to backend.'
      })
    }

    // Get database connection
    const pool = await getConnectedPool();
    
    // Check if user exists in our database and is active
    const result = await pool.request()
      .input('email', email)
      .query('SELECT UserID, Name, Email, Status FROM tenderEmployee WHERE Email = @email');
    
    if (result.recordset.length === 0) {
      // Optional: auto-provision users for a specific domain in development
      const allowedDomain = process.env.AUTH_ALLOWED_DOMAIN || ''
      if (allowedDomain && typeof email === 'string' && email.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`)) {
        try {
          const insert = await pool.request()
            .input('name', name || email)
            .input('email', email)
            .query(`INSERT INTO tenderEmployee (Name, Email, Status) OUTPUT INSERTED.UserID, INSERTED.Name, INSERTED.Email, INSERTED.Status VALUES (@name, @email, 1)`)
          const user = insert.recordset[0]
          const token = generateToken(user)
          console.log('🔐 Token generated (auto-provisioned):', token ? token.substring(0, 60) + '...' : 'EMPTY')
          return res.json({
            success: true,
            message: 'Login successful (auto-provisioned)',
            user: { id: user.UserID, name: user.Name, email: user.Email },
            token
          })
        } catch (e) {
          console.error('Auto-provision failed:', e)
          return res.status(401).json({
            error: 'Access denied',
            message: 'Your email is not authorized to access this platform. Please contact info@adco.ie for access.'
          })
        }
      }
      return res.status(401).json({
        error: 'Access denied',
        message: 'Your email is not authorized to access this platform. Please contact info@adco.ie for access.'
      })
    }

    // Check if user is active (Status = 1)
    if (!result.recordset[0].Status) {
      return res.status(401).json({
        error: 'Account deactivated',
        message: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    const user = result.recordset[0];

    // Update last login
    await pool.request()
      .input('userId', user.UserID)
      .query('UPDATE tenderEmployee SET LastLogin = GETDATE() WHERE UserID = @userId');

    // Generate JWT token
    const token = generateToken(user);
    console.log('🔐 Token generated:', token ? token.substring(0, 60) + '...' : 'EMPTY')

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.UserID,
        name: user.Name,
        email: user.Email
      },
      token
    });

  } catch (error) {
    console.error('Microsoft login error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred during login'
    });
  }
};

// Verify token endpoint
const verifyToken = async (req, res) => {
  try {
    // User is already verified by middleware
    res.json({
      success: true,
      message: 'Token is valid',
      user: req.user
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred during token verification'
    });
  }
};

// Get current user endpoint
const getCurrentUser = async (req, res) => {
  try {
    const pool = await getConnectedPool();
    const result = await pool.request()
      .input('userId', req.user.UserID)
      .query('SELECT UserID, Name, Email, LastLogin FROM tenderEmployee WHERE UserID = @userId');
    
    if (result.recordset.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account no longer exists'
      });
    }

    res.json({
      success: true,
      user: result.recordset[0]
    });

  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred while fetching user data'
    });
  }
};

// Get current user permissions endpoint
const getCurrentUserPermissions = async (req, res) => {
  try {
    const pool = await getConnectedPool();
    const result = await pool.request()
      .input('userId', req.user.UserID)
      .query(`
        SELECT 
          a.AccessID,
          a.UserID,
          a.Contact,
          a.Company,
          a.AI,
          a.[File],
          a.Task,
          a.[Admin]
        FROM tenderAccess a
        WHERE a.UserID = @userId
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({
        error: 'Permissions not found',
        message: 'User permissions not configured'
      });
    }

    const permissions = result.recordset[0];
    res.json({
      success: true,
      permissions: {
        AccessID: permissions.AccessID,
        UserID: permissions.UserID,
        Contact: permissions.Contact || false,
        Company: permissions.Company || false,
        AI: permissions.AI || false,
        File: permissions.File || false,
        Task: permissions.Task || false,
        Admin: permissions.Admin || false
      }
    });

  } catch (error) {
    console.error('Get current user permissions error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred while fetching user permissions'
    });
  }
};

// Validation middleware for Microsoft login
const validateMicrosoftLogin = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('name')
    .isLength({ min: 1 })
    .withMessage('Name is required'),
  body('accessToken')
    .isLength({ min: 1 })
    .withMessage('Microsoft access token is required')
];

module.exports = {
  microsoftLogin,
  verifyToken,
  getCurrentUser,
  getCurrentUserPermissions,
  validateMicrosoftLogin
}; 