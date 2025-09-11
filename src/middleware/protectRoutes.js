const { authenticateToken } = require('./auth');

// Middleware to protect routes that need authentication
const protectRoute = (router) => {
  // Add authentication middleware to all routes in the router
  router.use(authenticateToken);
  return router;
};

module.exports = { protectRoute }; 