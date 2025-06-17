// auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// 🔐 JWT verification setup
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10 minutes
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function (err, key) {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

// 👉 Logout route (for frontend logout)
router.get('/logout', (req, res) => {
  // Since we're using frontend tokens, just return success
  // The frontend will handle clearing the tokens
  res.json({ success: true, message: 'Logout successful' });
});

// 🔍 Verify token route (for frontend token validation)
router.get('/verify-token', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ valid: false, error: 'Missing token' });

  const token = authHeader.split(' ')[1];

  jwt.verify(
    token,
    getKey,
    {
      audience: process.env.AZURE_CLIENT_ID,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
      algorithms: ['RS256'],
    },
    (err, decoded) => {
      if (err) {
        console.error('❌ Token verification failed:', err.message);
        return res.status(401).json({ valid: false, error: 'Invalid token' });
      }

      // ✅ Log basic data for debugging
      console.log("✅ Token verified for:", decoded.upn || decoded.email || decoded.name);
      console.log("🔐 Expires at:", new Date(decoded.exp * 1000).toISOString());

      // Optional: check if token expired manually
      const isExpired = Date.now() / 1000 > decoded.exp;
      if (isExpired) {
        console.warn("⚠️ Token is expired");
        return res.status(401).json({ valid: false, error: "Token expired" });
      }

      // Optional: check if user belongs to correct domain
      if (!decoded.upn?.endsWith("@adco.ie")) {
        console.warn("⚠️ User not from ADCO domain:", decoded.upn);
        return res.status(403).json({ valid: false, error: "Invalid domain" });
      }

      return res.status(200).json({ valid: true, user: decoded });
    }
  );
});

module.exports = {
  authRouter: router,
};