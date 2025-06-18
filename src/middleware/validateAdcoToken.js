const jwt = require('jsonwebtoken');

const validateAdcoToken = (req, res, next) => {
  // Get the Authorization header
  const authHeader = req.headers.authorization;
  
  console.log('validateAdcoToken: Checking authorization header:', authHeader ? 'Present' : 'Missing');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('validateAdcoToken: Invalid authorization header format');
    return res.status(401).json({ message: 'Unauthorized: Invalid authorization header' });
  }

  // Extract the token
  const token = authHeader.split(' ')[1];
  console.log('validateAdcoToken: Token extracted, length:', token ? token.length : 0);

  try {
    // Decode the token without verification (for Azure AD tokens)
    const decoded = jwt.decode(token);
    
    console.log('validateAdcoToken: Token decoded successfully:', {
      hasDecoded: !!decoded,
      aud: decoded?.aud,
      iss: decoded?.iss,
      upn: decoded?.upn,
      email: decoded?.email,
      exp: decoded?.exp
    });
    
    if (!decoded) {
      console.log('validateAdcoToken: Failed to decode token');
      return res.status(401).json({ message: 'Unauthorized: Invalid token format' });
    }

    // Check if token is expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      console.log('validateAdcoToken: Token expired');
      return res.status(401).json({ message: 'Unauthorized: Token expired' });
    }

    // Get the email/upn from the token (Azure AD uses 'upn' field)
    const email = decoded.upn || decoded.email || decoded.preferred_username;

    console.log('validateAdcoToken: Email extracted:', email);

    if (!email) {
      console.log('validateAdcoToken: No email found in token');
      return res.status(401).json({ message: 'Unauthorized: No email found in token' });
    }

    // Check if email ends with @adco.ie
    if (!email.endsWith('@adco.ie')) {
      console.log('validateAdcoToken: Email domain not allowed:', email);
      return res.status(401).json({ message: 'Unauthorized: Email domain not allowed' });
    }

    // Add the decoded token to the request for potential future use
    req.decodedToken = decoded;
    req.userEmail = email;
    
    console.log('validateAdcoToken: Token validation successful for:', email);

    // ✅ OPTIONAL: Auto-launch desktop app using custom protocol (if needed)
    if (req.query.openApp === 'true') {
      const openUrl = req.query.link ? decodeURIComponent(req.query.link) : null;
    
      if (!openUrl) {
        console.warn('⚠️ openApp requested but no link provided.');
        return res.status(400).send('Missing protocol link.');
      }
    
      console.log('🚀 Attempting to launch app with:', openUrl);
      return res.send(`
        <html>
          <body>
            <script>
              window.location.href = "${openUrl}";
              setTimeout(() => {
                window.close();
              }, 1000);
            </script>
            <p>Launching desktop app...</p>
          </body>
        </html>
      `);
    }
    

    // Allow the request to proceed
    next();
  } catch (error) {
    console.error('validateAdcoToken: Error during validation:', error);
    return res.status(401).json({ message: 'Unauthorized: Token validation failed' });
  }
};

module.exports = validateAdcoToken;
