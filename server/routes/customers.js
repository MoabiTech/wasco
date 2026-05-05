const express = require('express');
const router = express.Router();
const { pool } = require('../db/neon');
const DualDatabase = require('../db/sync');
const BillCalculator = require('../utils/billCalculator');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// GET /api/customers - List all customers (admin/manager)
router.get('/', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const { district_id, status, property_type, search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT c.*, d.district_name,
             u.username, u.email AS user_email
      FROM customers c
      LEFT JOIN districts d ON c.district_id = d.district_id
      LEFT JOIN users u ON c.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (district_id) {
      paramCount++;
      query += ` AND c.district_id = $${paramCount}`;
      params.push(district_id);
    }
    if (status) {
      paramCount++;
      query += ` AND c.status = $${paramCount}`;
      params.push(status);
    }
    if (property_type) {
      paramCount++;
      query += ` AND c.property_type = $${paramCount}`;
      params.push(property_type);
    }
    if (search) {
      paramCount++;
      query += ` AND (c.first_name ILIKE $${paramCount} OR c.last_name ILIKE $${paramCount} 
                  OR c.account_number ILIKE $${paramCount} OR c.meter_number ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    // Branch manager can only see customers in their district
    if (req.user.role === 'branch_manager' && req.user.branch_id) {
      const branchResult = await pool.query(
        'SELECT district_id FROM branches WHERE branch_id = \$1', [req.user.branch_id]
      );
      if (branchResult.rows.length > 0) {
        paramCount++;
        query += ` AND c.district_id = $${paramCount}`;
        params.push(branchResult.rows[0].district_id);
      }
    }

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM customers c WHERE 1=1 ${query.split('WHERE 1=1')[1]?.split('ORDER')[0] || ''}`,
      params
    );

    paramCount++;
    query += ` ORDER BY c.created_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await pool.query(query, params);

    res.json({
      customers: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0]?.count || result.rows.length),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil((countResult.rows[0]?.count || result.rows.length) / limit)
      }
    });
  } catch (error) {
    console.error('[Customers] List error:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// GET /api/customers/:accountNumber
router.get('/:accountNumber', authenticateToken, async (req, res) => {
  try {
    const { accountNumber } = req.params;

    // Customers can only view their own account
    if (req.user.role === 'customer') {
      const custCheck = await pool.query(
        'SELECT account_number FROM customers WHERE user_id = \$1',
        [req.user.user_id]
      );
      if (custCheck.rows.length === 0 || custCheck.rows[0].account_number !== accountNumber) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await pool.query(
      `SELECT c.*, d.district_name, d.region
       FROM customers c
       LEFT JOIN districts d ON c.district_id = d.district_id
       WHERE c.account_number = \$1`,
      [accountNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ customer: result.rows[0] });
  } catch (error) {
    console.error('[Customers] Get error:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// POST /api/customers - Create new customer (admin)
router.post('/', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const {
      first_name, last_name, id_number, phone, email,
      physical_address, district_id, property_type, meter_number, user_id
    } = req.body;

    if (!first_name || !last_name || !physical_address || !district_id) {
      return res.status(400).json({ error: 'Required fields: first_name, last_name, physical_address, district_id' });
    }

    // Generate account number
    const account_number = await BillCalculator.generateAccountNumber(district_id);

    const customer = await DualDatabase.createCustomer({
      account_number, first_name, last_name, id_number, phone, email,
      physical_address, district_id, property_type: property_type || 'residential',
      meter_number, user_id
    });

    await logActivity(req.user.user_id, 'CREATE', 'customers', customer.customer_id, null, customer, req.ip);

    res.status(201).json({ message: 'Customer created successfully', customer });
  } catch (error) {
    console.error('[Customers] Create error:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// PUT /api/customers/:accountNumber
router.put('/:accountNumber', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const customer = await DualDatabase.updateCustomer(req.params.accountNumber, req.body);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    await logActivity(req.user.user_id, 'UPDATE', 'customers', customer.customer_id, null, req.body, req.ip);

    res.json({ message: 'Customer updated successfully', customer });
  } catch (error) {
    console.error('[Customers] Update error:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// GET /api/customers/:accountNumber/bills
router.get('/:accountNumber/bills', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, 
              COALESCE(p.total_paid, 0) AS amount_paid,
              b.total_amount - COALESCE(p.total_paid, 0) AS balance_due
       FROM bills b
       LEFT JOIN (
         SELECT bill_id, SUM(amount) AS total_paid
         FROM payments WHERE status = 'completed'
         GROUP BY bill_id
       ) p ON b.bill_id = p.bill_id
       WHERE b.account_number = \$1
       ORDER BY b.billing_month DESC`,
      [req.params.accountNumber]
    );

    res.json({ bills: result.rows });
  } catch (error) {
    console.error('[Customers] Bills error:', error);
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
});

// GET /api/customers/:accountNumber/payments
router.get('/:accountNumber/payments', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, b.bill_number, b.billing_month
       FROM payments p
       JOIN bills b ON p.bill_id = b.bill_id
       WHERE b.account_number = \$1
       ORDER BY p.payment_date DESC`,
      [req.params.accountNumber]
    );

    res.json({ payments: result.rows });
  } catch (error) {
    console.error('[Customers] Payments error:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

module.exports = router;
