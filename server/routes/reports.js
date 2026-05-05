const express = require('express');
const router = express.Router();
const { pool } = require('../db/neon');
const { authenticateToken, authorize } = require('../middleware/auth');

// GET /api/reports/dashboard - Dashboard statistics
router.get('/dashboard', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const { district_id, period } = req.query;

    // Total customers
    const customersCount = await pool.query(
      `SELECT COUNT(*) AS total, 
              COUNT(CASE WHEN status = 'active' THEN 1 END) AS active,
              COUNT(CASE WHEN status = 'suspended' THEN 1 END) AS suspended,
              COUNT(CASE WHEN status = 'disconnected' THEN 1 END) AS disconnected
       FROM customers ${district_id ? 'WHERE district_id = \$1' : ''}`,
      district_id ? [district_id] : []
    );

    // Revenue summary
    const revenue = await pool.query(
      `SELECT 
         COALESCE(SUM(b.total_amount), 0) AS total_billed,
         COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END), 0) AS total_collected,
         COALESCE(SUM(CASE WHEN b.payment_status IN ('unpaid', 'overdue') THEN b.total_amount ELSE 0 END), 0) AS total_outstanding,
         COUNT(CASE WHEN b.payment_status = 'overdue' THEN 1 END) AS overdue_bills
       FROM bills b
       JOIN customers c ON b.customer_id = c.customer_id
       ${district_id ? 'WHERE c.district_id = \$1' : ''}`,
      district_id ? [district_id] : []
    );

    // Current month stats
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthlyStats = await pool.query(
      `SELECT 
         COUNT(b.bill_id) AS bills_generated,
         COALESCE(SUM(b.total_amount), 0) AS monthly_billed,
         COALESCE(SUM(b.consumption), 0) AS total_consumption,
         COALESCE(AVG(b.consumption), 0) AS avg_consumption
       FROM bills b
       JOIN customers c ON b.customer_id = c.customer_id
       WHERE b.billing_month = \$1 ${district_id ? 'AND c.district_id = \$2' : ''}`,
      district_id ? [currentMonth, district_id] : [currentMonth]
    );

    // Recent payments
    const recentPayments = await pool.query(
      `SELECT p.payment_reference, p.amount, p.payment_method, p.payment_date,
              c.account_number, c.first_name, c.last_name
       FROM payments p
       JOIN customers c ON p.customer_id = c.customer_id
       WHERE p.status = 'completed'
       ORDER BY p.payment_date DESC LIMIT 10`
    );

    // Leak reports
    const leakStats = await pool.query(
      `SELECT 
         COUNT(*) AS total_reports,
         COUNT(CASE WHEN status = 'reported' THEN 1 END) AS pending,
         COUNT(CASE WHEN status = 'investigating' THEN 1 END) AS investigating,
         COUNT(CASE WHEN status = 'resolved' THEN 1 END) AS resolved
       FROM leak_reports`
    );

    res.json({
      customers: customersCount.rows[0],
      revenue: revenue.rows[0],
      monthly: monthlyStats.rows[0],
      recent_payments: recentPayments.rows,
      leak_reports: leakStats.rows[0]
    });
  } catch (error) {
    console.error('[Reports] Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/reports/usage-patterns - Water usage patterns
router.get('/usage-patterns', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const { district_id, property_type, months = 12 } = req.query;

    let query = `
      SELECT * FROM vw_usage_patterns
      WHERE reading_month >= TO_CHAR(CURRENT_DATE - INTERVAL '${parseInt(months)} months', 'YYYY-MM')
    `;
    const params = [];
    let paramCount = 0;

    if (district_id) {
      // Get district name for the view
      const distResult = await pool.query('SELECT district_name FROM districts WHERE district_id = \$1', [district_id]);
      if (distResult.rows.length > 0) {
        paramCount++;
        query += ` AND district_name = $${paramCount}`;
        params.push(distResult.rows[0].district_name);
      }
    }
    if (property_type) {
      paramCount++;
      query += ` AND property_type = $${paramCount}`;
      params.push(property_type);
    }

    query += ` ORDER BY reading_month DESC, property_type`;

    const result = await pool.query(query, params);

    res.json({ usage_patterns: result.rows });
  } catch (error) {
    console.error('[Reports] Usage patterns error:', error);
    res.status(500).json({ error: 'Failed to fetch usage patterns' });
  }
});

// GET /api/reports/revenue - Revenue reports
router.get('/revenue', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const { period = 'monthly', district_id } = req.query;

    const result = await pool.query(
      `SELECT * FROM vw_monthly_revenue 
       ${district_id ? 'WHERE district_name = (SELECT district_name FROM districts WHERE district_id = \$1)' : ''}
       ORDER BY billing_month DESC LIMIT 24`,
      district_id ? [district_id] : []
    );

    res.json({ revenue: result.rows });
  } catch (error) {
    console.error('[Reports] Revenue error:', error);
    res.status(500).json({ error: 'Failed to fetch revenue report' });
  }
});

// GET /api/reports/outstanding - Outstanding balances
router.get('/outstanding', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const { district_id, min_days_overdue } = req.query;

    let query = `SELECT * FROM vw_outstanding_balances WHERE 1=1`;
    const params = [];
    let paramCount = 0;

    if (district_id) {
      const distResult = await pool.query('SELECT district_name FROM districts WHERE district_id = \$1', [district_id]);
      if (distResult.rows.length > 0) {
        paramCount++;
        query += ` AND district_name = $${paramCount}`;
        params.push(distResult.rows[0].district_name);
      }
    }
    if (min_days_overdue) {
      paramCount++;
      query += ` AND days_overdue >= $${paramCount}`;
      params.push(parseInt(min_days_overdue));
    }

    query += ` ORDER BY days_overdue DESC`;

    const result = await pool.query(query, params);

    // Summary
    const summary = await pool.query(
      `SELECT 
         COUNT(*) AS total_outstanding_bills,
         SUM(balance_due) AS total_outstanding_amount,
         AVG(days_overdue) AS avg_days_overdue,
         MAX(days_overdue) AS max_days_overdue
       FROM vw_outstanding_balances`
    );

    res.json({
      outstanding: result.rows,
      summary: summary.rows[0]
    });
  } catch (error) {
    console.error('[Reports] Outstanding error:', error);
    res.status(500).json({ error: 'Failed to fetch outstanding balances' });
  }
});

// GET /api/reports/district-summary - Summary by district
router.get('/district-summary', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        d.district_id,
        d.district_name,
        d.region,
        COUNT(DISTINCT c.customer_id) AS total_customers,
        COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.customer_id END) AS active_customers,
        COALESCE(SUM(b.total_amount), 0) AS total_billed,
        COALESCE(SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END), 0) AS total_paid,
        COALESCE(AVG(b.consumption), 0) AS avg_consumption,
        COUNT(DISTINCT lr.report_id) AS leak_reports
      FROM districts d
      LEFT JOIN customers c ON d.district_id = c.district_id
      LEFT JOIN bills b ON c.customer_id = b.customer_id
      LEFT JOIN leak_reports lr ON d.district_id = lr.district_id AND lr.status != 'resolved'
      GROUP BY d.district_id, d.district_name, d.region
      ORDER BY d.district_name
    `);

    res.json({ districts: result.rows });
  } catch (error) {
    console.error('[Reports] District summary error:', error);
    res.status(500).json({ error: 'Failed to fetch district summary' });
  }
});

// GET /api/reports/customer-segments - Usage patterns by customer segments
router.get('/customer-segments', authenticateToken, authorize('admin', 'branch_manager'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.property_type,
        d.district_name,
        COUNT(DISTINCT c.customer_id) AS customer_count,
        COALESCE(AVG(mr.current_reading - mr.previous_reading), 0) AS avg_monthly_consumption,
        COALESCE(SUM(b.total_amount), 0) AS total_revenue,
        COALESCE(AVG(b.total_amount), 0) AS avg_bill_amount,
        COUNT(CASE WHEN b.payment_status = 'overdue' THEN 1 END) AS overdue_count,
        ROUND(
          COUNT(CASE WHEN b.payment_status = 'paid' THEN 1 END)::DECIMAL / 
          NULLIF(COUNT(b.bill_id), 0) * 100, 2
        ) AS payment_rate_pct
      FROM customers c
      LEFT JOIN districts d ON c.district_id = d.district_id
      LEFT JOIN meter_readings mr ON c.customer_id = mr.customer_id
      LEFT JOIN bills b ON c.customer_id = b.customer_id
      WHERE c.status = 'active'
      GROUP BY c.property_type, d.district_name
      ORDER BY c.property_type, d.district_name
    `);

    res.json({ segments: result.rows });
  } catch (error) {
    console.error('[Reports] Segments error:', error);
    res.status(500).json({ error: 'Failed to fetch customer segments' });
  }
});

module.exports = router;
