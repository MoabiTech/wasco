const jwt = require('jsonwebtoken');
const { pool } = require('../db/neon');
require('dotenv').config();

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    {
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

// Verify JWT token middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Role-based authorization middleware
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Log user activity
async function logActivity(userId, action, tableName, recordId, oldValues, newValues, ipAddress) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values, ip_address)
       VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7)`,
      [userId, action, tableName, recordId,
       oldValues ? JSON.stringify(oldValues) : null,
       newValues ? JSON.stringify(newValues) : null,
       ipAddress]
    );
  } catch (error) {
    console.error('[Audit] Error logging activity:', error);
  }
}

module.exports = {
  generateToken,
  authenticateToken,
  authorize,
  logActivity
};
