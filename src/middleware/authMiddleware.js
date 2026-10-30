const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

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

    // Single query to verify user state, token version, and device session status
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.name, u.token_version, u.is_active, u.is_deleted,
              r.id AS session_id, r.is_revoked
       FROM users u
       LEFT JOIN refresh_tokens r ON r.id = ? AND r.user_id = u.id AND r.expires_at > NOW()
       WHERE u.id = ?`,
      [decoded.sid || 0, decoded.id]
    );

    if (rows.length === 0 || rows[0].is_deleted === 1) {
      return res.status(401).json({ error: 'Unauthorized: Account no longer exists' });
    }

    const user = rows[0];

    if (user.is_active === 0) {
      return res.status(403).json({ error: 'Forbidden: Account has been deactivated' });
    }

    // 1. Global token invalidation check (e.g., password changed, reset, or logout from all devices)
    if (decoded.version !== undefined && decoded.version !== user.token_version) {
      return res.status(401).json({ error: 'Unauthorized: Session has expired. Please log in again.' });
    }

    // 2. Single-device session revocation check (e.g., this specific device logged out)
    if (decoded.sid && (!user.session_id || user.is_revoked === 1)) {
      return res.status(401).json({ error: 'Unauthorized: Device session has been logged out.' });
    }

    // Attach user to request object
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      sessionId: user.session_id || decoded.sid,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Token expired' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

module.exports = {
  verifyToken,
};
