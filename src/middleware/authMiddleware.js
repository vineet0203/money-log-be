const jwt = require('jsonwebtoken');

const verifyToken = async (req, res, next) => {
  let token = null;

  // 1. Try to get token from cookies (Web client)
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  } 
  // 2. Try to get token from Authorization header (Mobile client)
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split('Bearer ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    
    // Attach the user ID to the request object
    req.user = {
      id: decoded.id
    };
    
    next();
  } catch (error) {
    console.error('Error verifying auth token middleware:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Token expired' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

module.exports = {
  verifyToken
};
