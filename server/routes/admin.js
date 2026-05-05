const express = require('express');
const router = express.Router();
const { pool } = require('../db/neon');
const DualDatabase = require('../db/sync');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// GET /api/admin/users - List all users
router.get('/users', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, username, email, role, branch_id, is_active, last_login, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /api/admin/users/:userId - Update user
router.put('/users/:userId', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { role, is_active, branch_id } = req.body;
    const result = await pool.query(
      `UPDATE users SET role = COALESCE(\$1, role), is_active = COALESCE(\$2, is_active), 
       branch_id = COALESCE(\$3, branch_id), updated_at = CURRENT_TIMESTAMP
       WHERE user_id = \$4 RETURNING user_id, username, email, role, is_active, branch_id`,
      [role, is_active, branch_id, req.params.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { updateInFirebase } = require('../db/firebase');
    await updateInFirebase('users', `user_${req.params.userId}`, result.rows[0]);

    await logActivity(req.user.user_id, 'UPDATE_USER', 'users', parseInt(req.params.userId), null, req.body, req.ip);

    res.json({ message: 'User updated', user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// GET /api/admin/districts - List districts
router.get('/districts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM districts ORDER BY district_name');
    res.json({ districts: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch districts' });
  }
});

// GET /api/admin/branches - List branches
router.get('/branches', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, d.district_name FROM branches b
       LEFT JOIN districts d ON b.district_id = d.district_id
       ORDER BY b.branch_name`
    );
    res.json({ branches: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// POST /api/admin/branches - Create branch
router.post('/branches', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { branch_name, district_id, address, phone, email } = req.body;
    const result = await pool.query(
      `INSERT INTO branches (branch_name, district_id, address, phone, email)
       VALUES (\$1,\$2,\$3,\$4,\$5) RETURNING *`,
      [branch_name, district_id, address, phone, email]
    );
    res.status(201).json({ message: 'Branch created', branch: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create branch' });
  }
});

// POST /api/admin/send-notifications - Send notifications to district
router.post('/send-notifications', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { district_id, notification_type, title, message, sent_via } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    // Get all customers in district (or all if no district specified)
    let query = 'SELECT customer_id FROM customers WHERE status = \$1';
    const params = ['active'];

    if (district_id) {
      query += ' AND district_id = \$2';
      params.push(district_id);
    }

    const customers = await pool.query(query, params);
    let count = 0;

    for (const cust of customers.rows) {
      await DualDatabase.createNotification({
        customer_id: cust.customer_id,
        district_id: district_id || null,
        notification_type: notification_type || 'service_update',
        title,
        message,
        sent_via: sent_via || 'app'
      });
      count++;
    }

    res.json({ message: `Notifications sent to ${count} customers` });
  } catch (error) {
    console.error('[Admin] Notification error:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// GET /api/admin/audit-log
router.get('/audit-log', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const result = await pool.query(
      `SELECT al.*, u.username
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.user_id
       ORDER BY al.created_at DESC LIMIT \$1`,
      [parseInt(limit)]
    );
    res.json({ logs: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// POST /api/admin/sync-databases - Trigger full sync
router.post('/sync-databases', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    await DualDatabase.fullSyncToFirebase();
    res.json({ message: 'Full database sync completed' });
  } catch (error) {
    res.status(500).json({ error: 'Sync failed' });
  }
});

// GET /api/admin/services - Public services info (for unregistered users)
router.get('/services', async (req, res) => {
  try {
    const rates = await pool.query(
      `SELECT rate_name, property_type, tier_level, min_usage, max_usage, cost_per_unit, fixed_charge
       FROM billing_rates WHERE is_active = true ORDER BY property_type, tier_level`
    );

    const districts = await pool.query(
      'SELECT district_name, region FROM districts ORDER BY district_name'
    );

    res.json({
      company: 'Water and Sewerage Company (WASCO)',
      country: 'Lesotho',
      services: [
        'Water Supply',
        'Sewerage Services',
        'Water Quality Testing',
        'New Connection Applications',
        'Meter Installation & Maintenance',
        'Leak Detection & Repair'
      ],
      billing_rates: rates.rows,
      service_areas: districts.rows
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// GET /api/admin/pending-customers - List pending customer registrations
router.get('/pending-customers', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * parseInt(limit);

    const result = await pool.query(
      `SELECT c.*, d.district_name,
             u.username, u.email as user_email, u.role,
             CASE WHEN u.user_id IS NOT NULL THEN true ELSE false END as has_user
       FROM customers c
       LEFT JOIN districts d ON c.district_id = d.district_id
       LEFT JOIN users u ON c.user_id = u.user_id
       WHERE c.status = 'pending'
       ORDER BY c.created_at DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM customers WHERE status = 'pending'`
    );

    res.json({
      pending_customers: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending customers' });
  }
});

// PUT /api/admin/customers/:customerId/activate - Activate pending customer
router.put('/customers/:customerId/activate', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const customerIdNum = parseInt(customerId);

    // Verify pending
    const checkResult = await pool.query(
      'SELECT customer_id, account_number, status FROM customers WHERE customer_id = $1',
      [customerIdNum]
    );

    if (checkResult.rows.length === 0 || checkResult.rows[0].status !== 'pending') {
      return res.status(404).json({ error: 'Pending customer not found' });
    }

    const accountNumber = checkResult.rows[0].account_number;

    const DualDatabase = require('../db/sync');
    const updates = { status: 'active' };
    const customer = await DualDatabase.updateCustomer(accountNumber, updates);

    await logActivity(req.user.user_id, 'ACTIVATE_CUSTOMER', 'customers', customerIdNum, null, updates, req.ip);

    res.json({ message: 'Customer activated successfully', customer });
  } catch (error) {
    console.error('[Admin] Activate customer error:', error);
    res.status(500).json({ error: 'Failed to activate customer' });
  }
});

module.exports = router;
