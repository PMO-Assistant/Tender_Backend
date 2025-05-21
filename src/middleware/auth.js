const express = require("express");
const router = express.Router();
const msal = require("@azure/msal-node");
const session = require("express-session");
require("dotenv").config();

// 🔐 MSAL config
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

// 🔐 Session middleware setup (make sure you also add this in your main app.js/server.js)
router.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);

// 👉 Login route
router.get("/login", async (req, res) => {
  const authCodeUrlParameters = {
    scopes: ['openid', 'profile', 'email', 'User.Read', 'Sites.Read.All', 'Files.Read.All', 'Calendars.Read'],
    redirectUri: REDIRECT_URI,
    responseType: 'code',
    responseMode: 'query',
    prompt: 'consent',
    state: req.sessionID
  };
  

  try {
    const authUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
    res.redirect(authUrl);
  } catch (error) {
    console.error("Error generating auth URL:", error);
    res.status(500).send("Failed to initiate authentication.");
  }
});

// 👉 Redirect route (after Entra login)
router.get("/redirect", async (req, res) => {
  const tokenRequest = {
    code: req.query.code,
    scopes: ["openid", "profile", "email", "User.Read", "Sites.Read.All", "Files.Read.All", "Calendars.Read"], // 🔥 Match exactly!
    redirectUri: process.env.AZURE_REDIRECT_URI,
  };

  try {
    const response = await cca.acquireTokenByCode(tokenRequest);
    req.session.user = {
      ...response.account,
      accessToken: response.accessToken, // 💡 So you can use it later with Graph
    };
    res.redirect(process.env.AZURE_POST_LOGOUT_REDIRECT_URI || "/dashboard");
  } catch (error) {
    console.error("Token acquisition failed:", error);
    res.status(500).send("Authentication failed.");
  }
});


// 👉 Logout route
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect(
      `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${process.env.AZURE_POST_LOGOUT_REDIRECT_URI}`
    );
  });
});

// 🔐 Auth middleware to protect other routes
const sessionAuthMiddleware = (req, res, next) => {
  console.log('Session user in sessionAuthMiddleware:', req.session.user);
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Export the router and middleware
module.exports = {
  authRouter: router,
  sessionAuthMiddleware,
};
