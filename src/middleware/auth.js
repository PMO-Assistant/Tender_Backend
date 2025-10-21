const jwt = require('jsonwebtoken');
const { getConnectedPool } = require('../config/database');

// JWT Secret - should be in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Enhanced authentication middleware with redirect support
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      message: 'Please provide a valid authentication token',
      redirect: '/login',
      code: 'AUTH_REQUIRED'
    });
  }

  try {
    // Explicitly specify the algorithm to avoid "invalid algorithm" error
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    
    // Verify user still exists in database and is active
    const pool = await getConnectedPool();
    const result = await pool.request()
      .input('email', decoded.email)
      .query('SELECT UserID, Name, Email, Status FROM tenderEmployee WHERE Email = @email');
    
    if (result.recordset.length === 0) {
      return res.status(401).json({ 
        error: 'User not found',
        message: 'User account no longer exists',
        redirect: '/login',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user is active (Status = 1)
    if (!result.recordset[0].Status) {
      return res.status(401).json({ 
        error: 'Account deactivated',
        message: 'Your account has been deactivated. Please contact an administrator.',
        redirect: '/login',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    req.user = result.recordset[0];
    // Quiet auth logs unless explicitly enabled
    if (process.env.VERBOSE_AUTH === 'true' && !req.user._logged) {
      console.log(`[AUTH] User authenticated: ${req.user.Name} (${req.user.Email})`);
      req.user._logged = true;
    }
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    
    // Enhanced error response with redirect information
    let errorCode = 'TOKEN_INVALID';
    let errorMessage = 'Token is invalid or expired';
    
    if (error.name === 'TokenExpiredError') {
      errorCode = 'TOKEN_EXPIRED';
      errorMessage = 'Your session has expired. Please login again.';
    } else if (error.name === 'JsonWebTokenError') {
      errorCode = 'TOKEN_MALFORMED';
      errorMessage = 'Invalid token format. Please login again.';
    }
    
    return res.status(403).json({ 
      error: 'Authentication failed',
      message: errorMessage,
      redirect: '/login',
      code: errorCode
    });
  }
};

// New middleware for handling authentication redirects
const handleAuthRedirect = (req, res, next) => {
  // Add redirect information to response headers for frontend
  res.set('X-Auth-Redirect', '/login');
  res.set('X-Auth-Required', 'true');
  next();
};

// Middleware to check if user needs to be redirected to login
const checkAuthStatus = async (req, res, next) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please login to access this resource',
        redirect: '/login',
        code: 'LOGIN_REQUIRED'
      });
    }
    
    // Verify token without throwing error
    try {
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      
      // Quick check if user exists
      const pool = await getConnectedPool();
      const result = await pool.request()
        .input('email', decoded.email)
        .query('SELECT UserID, Status FROM tenderEmployee WHERE Email = @email');
      
      if (result.recordset.length === 0 || !result.recordset[0].Status) {
        return res.status(401).json({
          error: 'Account invalid',
          message: 'Your account is no longer valid. Please login again.',
          redirect: '/login',
          code: 'ACCOUNT_INVALID'
        });
      }
      
      // Token is valid, continue
      next();
    } catch (jwtError) {
      return res.status(401).json({
        error: 'Session expired',
        message: 'Your session has expired. Please login again.',
        redirect: '/login',
        code: 'SESSION_EXPIRED'
      });
    }
  } catch (error) {
    console.error('Auth status check error:', error);
    return res.status(500).json({
      error: 'Authentication check failed',
      message: 'Unable to verify authentication status',
      redirect: '/login',
      code: 'AUTH_CHECK_FAILED'
    });
  }
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { 
      userId: user.UserID, 
      email: user.Email,
      name: user.Name 
    },
    JWT_SECRET,
    { 
      expiresIn: '24h',
      algorithm: 'HS256' // Explicitly specify algorithm
    }
  );
};

// Rate limiting for login attempts
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many login attempts',
    message: 'Please try again in 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authenticateToken,
  handleAuthRedirect,
  checkAuthStatus,
  generateToken,
  loginLimiter
}; 