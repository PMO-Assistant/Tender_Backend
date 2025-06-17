// middleware/validateToken.js
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { TOKEN_VALIDATION_CONFIG, JWKS_URI } = require('../config/azure'); // make sure this path is correct

const client = jwksClient({
  jwksUri: JWKS_URI,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function validateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, getKey, TOKEN_VALIDATION_CONFIG, (err, decoded) => {
    if (err) {
      console.error("Token validation error:", err.message);
      return res.status(401).json({ error: "Invalid token", message: err.message });
    }

    req.user = decoded; // you now have access to the claims
    next();
  });
}

module.exports = validateToken;
