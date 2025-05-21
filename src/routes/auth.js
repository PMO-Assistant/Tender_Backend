// auth.js
const express = require('express');
const router = express.Router();
const msal = require('@azure/msal-node');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const {
  msalConfig,
  REDIRECT_URI,
  POST_LOGOUT_REDIRECT_URI,
  FRONTEND_URI
} = require('../config/authConfig');

const msalInstance = new msal.ConfidentialClientApplication(msalConfig);

// 🧠 Microsoft JWKS setup
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function (err, key) {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

// 👉 Login route: return Microsoft login URL
router.get('/login', async (req, res) => {
  try {
    const authCodeUrlParameters = {
      scopes: ['openid', 'profile', 'email', 'User.Read', 'Sites.Read.All', 'Files.Read.All'],
      prompt: 'consent',
      redirectUri: REDIRECT_URI,
      responseType: 'code',
      responseMode: 'query',
      state: req.sessionID
    };

    const authUrl = await msalInstance.getAuthCodeUrl(authCodeUrlParameters);
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate login URL' });
  }
});

// 👉 Redirect route: exchange code for token and store in session
router.get('/redirect', async (req, res) => {
  if (!req.query.code) {
    return res.redirect(`${FRONTEND_URI}/login?error=no_code`);
  }

  const tokenRequest = {
    code: req.query.code,
    scopes: ['openid', 'profile', 'email', 'User.Read', 'Sites.Read.All', 'Files.Read.All'],
    redirectUri: REDIRECT_URI,
  };

  try {
    const response = await msalInstance.acquireTokenByCode(tokenRequest);
    
    // Store user info and tokens in session
    req.session.user = {
      id: response.account.homeAccountId,
      name: response.account.name,
      email: response.account.username,
      prompt: "consent",
      accessToken: response.accessToken,
      idToken: response.idToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + (response.expiresIn * 1000)
    };

    // Save the session before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect(`${FRONTEND_URI}/login?error=session_error`);
      }
      // Redirect to the complete dashboard
      res.redirect(`${FRONTEND_URI}/dashboard`);
    });
  } catch (error) {
    console.error('Token exchange failed:', error);
    res.redirect(`${FRONTEND_URI}/login?error=auth_failed`);
  }
});

// 👉 Logout route
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    const logoutUrl = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${POST_LOGOUT_REDIRECT_URI}`;
    res.redirect(logoutUrl);
  });
});

// 👉 Token refresh route
router.get('/refresh-token', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'No active session', redirect: true });
  }

  try {
    const response = await msalInstance.acquireTokenSilent({
      account: {
        homeAccountId: req.session.user.id,
        environment: 'login.microsoftonline.com',
        tenantId: process.env.AZURE_TENANT_ID,
        username: req.session.user.email
      },
      scopes: ['openid', 'profile', 'email', 'User.Read', 'Sites.Read.All', 'Files.Read.All'],
      forceRefresh: true
    });

    // Update session with new tokens
    req.session.user.accessToken = response.accessToken;
    req.session.user.idToken = response.idToken;
    req.session.user.refreshToken = response.refreshToken;
    req.session.user.expiresAt = Date.now() + (response.expiresIn * 1000);

    // Save the session
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Token refresh failed:', error);
    req.session.destroy();
    res.status(401).json({ error: 'Token refresh failed', redirect: true });
  }
});

// 👉 Check session route
router.get('/check-session', (req, res) => {
  if (req.session.user) {
    res.json({
      authenticated: true,
      user: {
        name: req.session.user.name,
        email: req.session.user.email,
        token: req.session.user.accessToken
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// 🔐 Middleware to protect backend API routes
const verifyToken = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'No active session' });
  }

  // Check if token needs refresh
  if (req.session.user.expiresAt - Date.now() < 15 * 60 * 1000) {
    return res.status(401).json({ error: 'Token needs refresh' });
  }

  next();
};

// 🔍 Verify token route (for frontend calls)
router.get('/api/verify-token', (req, res) => {
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
  verifyToken,
};