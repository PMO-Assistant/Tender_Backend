const jwt = require('jsonwebtoken');

const validateAdcoToken = (req, res, next) => {
  // Get the Authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: Email domain not allowed' });
  }

  // Extract the token
  const token = authHeader.split(' ')[1];

  try {
    // Decode the token without verification
    const decoded = jwt.decode(token);
    
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized: Email domain not allowed' });
    }

    // Get the email/upn from the token
    const email = decoded.upn || decoded.email;

    if (!email || !email.endsWith('@adco.ie')) {
      return res.status(401).json({ message: 'Unauthorized: Email domain not allowed' });
    }

    // Add the decoded token to the request for potential future use
    req.decodedToken = decoded;
    
    // Allow the request to proceed
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized: Email domain not allowed' });
  }
};

module.exports = validateAdcoToken; 