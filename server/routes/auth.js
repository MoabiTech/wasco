const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { pool } = require('../db/neon');
const { writeToFirebase } = require('../db/firebase');
const { generateToken, authenticateToken, logActivity } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role, branch_id } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    // Check existing user
    const existing = await pool.query(
      'SELECT user_id FROM users WHERE username = \$1 OR email = \$2',
      [username, email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, branch_id)
       VALUES (\$1, \$2, \$3, \$4, \$5) RETURNING user_id, username, email, role, branch_id, created_at`,
      [username, email, passwordHash, role || 'customer', branch_id || null]
    );

    const user = result.rows[0];

    // Sync to Firebase
    await writeToFirebase('users', `user_${user.user_id}`, {
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id,
      is_active: true,
      created_at: user.created_at
    });

    // Generate token
    const token = generateToken(user);

    await logActivity(user.user_id, 'REGISTER', 'users', user.user_id, null, { username, email, role: user.role }, req.ip);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE (username = \$1 OR email = \$1) AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = \$1',
      [user.user_id]
    );

    const token = generateToken(user);

    await logActivity(user.user_id, 'LOGIN', 'users', user.user_id, null, null, req.ip);

    // Get customer info if applicable
    let customerInfo = null;
    if (user.role === 'customer') {
      const custResult = await pool.query(
        'SELECT * FROM customers WHERE user_id = \$1',
        [user.user_id]
      );
      if (custResult.rows.length > 0) {
        customerInfo = custResult.rows[0];
      }
    }

    res.json({
      message: 'Login successful',
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role,
        branch_id: user.branch_id,
        customer: customerInfo
      }
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.user_id, u.username, u.email, u.role, u.branch_id, u.last_login, u.created_at,
              c.customer_id, c.account_number, c.first_name, c.last_name, c.phone,
              c.physical_address, c.property_type, c.meter_number, c.status,
              d.district_name
       FROM users u
       LEFT JOIN customers c ON u.user_id = c.user_id
       LEFT JOIN districts d ON c.district_id = d.district_id
       WHERE u.user_id = \$1`,
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('[Auth] Profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    const result = await pool.query(
      'SELECT password_hash FROM users WHERE user_id = \$1',
      [req.user.user_id]
    );

    const validPassword = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(12);
    const newHash = await bcrypt.hash(new_password, salt);

    await pool.query(
      'UPDATE users SET password_hash = \$1, updated_at = CURRENT_TIMESTAMP WHERE user_id = \$2',
      [newHash, req.user.user_id]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('[Auth] Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
