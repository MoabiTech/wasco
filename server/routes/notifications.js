const express = require('express');
const router = express.Router();
const { pool } = require('../db/neon');
const DualDatabase = require('../db/sync');
const { authenticateToken } = require('../middleware/auth');

// GET /api/notifications - Get user's notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query;
    let params;

    if (req.user.role === 'customer') {
      const custResult = await pool.query(
        'SELECT customer_id FROM customers WHERE user_id = \$1', [req.user.user_id]
      );
      if (custResult.rows.length === 0) {
        return res.json({ notifications: [] });
      }
      query = `SELECT * FROM notifications WHERE customer_id = \$1 ORDER BY sent_at DESC LIMIT 50`;
      params = [custResult.rows[0].customer_id];
    } else {
      query = `SELECT n.*, c.account_number, c.first_name, c.last_name
               FROM notifications n
               LEFT JOIN customers c ON n.customer_id = c.customer_id
               ORDER BY n.sent_at DESC LIMIT 100`;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json({ notifications: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PUT /api/notifications/:id/read - Mark as read
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP 
       WHERE notification_id = \$1`,
      [req.params.id]
    );

    const { updateInFirebase } = require('../db/firebase');
    await updateInFirebase('notifications', `notif_${req.params.id}`, {
      is_read: true,
      read_at: new Date().toISOString()
    });

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// POST /api/notifications/leak-report - Report a water leak
router.post('/leak-report', authenticateToken, async (req, res) => {
  try {
    const { district_id, location_description, severity, notes } = req.body;

    if (!district_id || !location_description) {
      return res.status(400).json({ error: 'District and location description are required' });
    }

    let customerId = null;
    if (req.user.role === 'customer') {
      const custResult = await pool.query(
        'SELECT customer_id FROM customers WHERE user_id = \$1', [req.user.user_id]
      );
      if (custResult.rows.length > 0) {
        customerId = custResult.rows[0].customer_id;
      }
    }

    const report = await DualDatabase.createLeakReport({
      customer_id: customerId,
      district_id,
      location_description,
      severity: severity || 'medium',
      notes
    });

    res.status(201).json({ message: 'Leak report submitted', report });
  } catch (error) {
    console.error('[Notifications] Leak report error:', error);
    res.status(500).json({ error: 'Failed to submit leak report' });
  }
});

// GET /api/notifications/leak-reports - View leak reports
router.get('/leak-reports', authenticateToken, async (req, res) => {
  try {
    const { district_id, status } = req.query;

    let query = `
      SELECT lr.*, d.district_name, 
             c.first_name, c.last_name, c.account_number,
             u.username AS assigned_to_name
      FROM leak_reports lr
      LEFT JOIN districts d ON lr.district_id = d.district_id
      LEFT JOIN customers c ON lr.customer_id = c.customer_id
      LEFT JOIN users u ON lr.assigned_to = u.user_id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (district_id) {
      paramCount++;
      query += ` AND lr.district_id = $${paramCount}`;
      params.push(district_id);
    }
    if (status) {
      paramCount++;
      query += ` AND lr.status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY lr.reported_at DESC`;

    const result = await pool.query(query, params);
    res.json({ leak_reports: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leak reports' });
  }
});

module.exports = router;
