require("dotenv").config();

const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

const REDIRECT_URI = process.env.AZURE_REDIRECT_URI;
const POST_LOGOUT_REDIRECT_URI = process.env.AZURE_POST_LOGOUT_REDIRECT_URI;
const FRONTEND_URI = process.env.FRONTEND_URI;

// MSAL configuration
const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    clientSecret: CLIENT_SECRET,
    knownAuthorities: [`login.microsoftonline.com`],
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        if (!containsPii) console.log(`[MSAL] ${message}`);
      },
      piiLoggingEnabled: false,
      logLevel: 3, // Info
    }
  }
};

// JWKS for validating Access Tokens
const JWKS_URI = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

// Token validation parameters
const TOKEN_VALIDATION_CONFIG = {
  issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
  audience: CLIENT_ID,
  algorithms: ['RS256']
};

module.exports = {
  msalConfig,
  REDIRECT_URI,
  POST_LOGOUT_REDIRECT_URI,
  FRONTEND_URI,
  JWKS_URI,
  TOKEN_VALIDATION_CONFIG
};
