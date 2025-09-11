const { getConnectedPool } = require('../config/database');

// Permission middleware factory
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      // User should already be authenticated by authenticateToken middleware
      if (!req.user || !req.user.UserID) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Please log in to access this resource'
        });
      }

      const pool = await getConnectedPool();
      const result = await pool.request()
        .input('UserID', req.user.UserID)
        .query('SELECT * FROM tenderAccess WHERE UserID = @UserID');

      if (result.recordset.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to access this resource'
        });
      }

      const userAccess = result.recordset[0];
      
      // Check if user has the required permission
      if (!userAccess[permission]) {
        return res.status(403).json({
          error: 'Access denied',
          message: `You do not have permission to access ${permission} features`
        });
      }

      // Add user permissions to request for use in controllers
      req.userPermissions = userAccess;
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Error checking permissions'
      });
    }
  };
};

// Check if user has any permissions at all
const hasAnyPermission = async (req, res, next) => {
  try {
    if (!req.user || !req.user.UserID) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please log in to access this resource'
      });
    }

    const pool = await getConnectedPool();
    const result = await pool.request()
      .input('UserID', req.user.UserID)
      .query('SELECT * FROM tenderAccess WHERE UserID = @UserID');

    if (result.recordset.length === 0) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have any permissions assigned'
      });
    }

    const userAccess = result.recordset[0];
    
    // Check if user has at least one permission
    const hasPermission = userAccess.Contact || userAccess.Company || 
                         userAccess.AI || userAccess.File || 
                         userAccess.Task || userAccess.Admin;

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have any permissions to access this platform'
      });
    }

    req.userPermissions = userAccess;
    next();
  } catch (error) {
    console.error('Permission check error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Error checking permissions'
    });
  }
};

// Specific permission middleware
const requireContactPermission = requirePermission('Contact');
const requireCompanyPermission = requirePermission('Company');
const requireAIPermission = requirePermission('AI');
const requireFilePermission = requirePermission('File');
const requireTaskPermission = requirePermission('Task');
const requireAdminPermission = requirePermission('Admin');

module.exports = {
  requirePermission,
  hasAnyPermission,
  requireContactPermission,
  requireCompanyPermission,
  requireAIPermission,
  requireFilePermission,
  requireTaskPermission,
  requireAdminPermission
}; 
 