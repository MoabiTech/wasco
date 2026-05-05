const express = require('express');
const router = express.Router();
const { pool } = require('../db/neon');
const DualDatabase = require('../db/sync');
const BillCalculator = require('../utils/billCalculator');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// POST /api/payments - Make a payment
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { bill_id, amount, payment_method, transaction_id, notes } = req.body;

    if (!bill_id || !amount || !payment_method) {
      return res.status(400).json({ error: 'Bill ID, amount, and payment method are required' });
    }

    // Verify bill exists and belongs to user (if customer)
    const billResult = await pool.query(
      `SELECT b.*, c.account_number, c.first_name, c.last_name, c.user_id
       FROM bills b JOIN customers c ON b.customer_id = c.customer_id
       WHERE b.bill_id = \$1`,
      [bill_id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const bill = billResult.rows[0];

    // Customers can only pay their own bills
    if (req.user.role === 'customer' && bill.user_id !== req.user.user_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if bill is already fully paid
    if (bill.payment_status === 'paid') {
      return res.status(400).json({ error: 'This bill is already fully paid' });
    }

    // Generate payment reference
    const paymentReference = BillCalculator.generatePaymentReference();

    // Process payment via DualDatabase (saves to both PostgreSQL and Firebase)
    const payment = await DualDatabase.createPayment({
      payment_reference: paymentReference,
      bill_id: parseInt(bill_id),
      customer_id: bill.customer_id,
      amount: parseFloat(amount),
      payment_method,
      transaction_id: transaction_id || null,
      status: 'completed',
      processed_by: req.user.user_id,
      notes
    });

    // Send payment confirmation notification
    await DualDatabase.createNotification({
      customer_id: bill.customer_id,
      notification_type: 'payment_received',
      title: 'Payment Received',
      message: `Payment of M${parseFloat(amount).toFixed(2)} received for bill ${bill.bill_number}. Reference: ${paymentReference}`,
      sent_via: 'app'
    });

    await logActivity(req.user.user_id, 'PAYMENT', 'payments', payment.payment_id, null, payment, req.ip);

    res.status(201).json({
      message: 'Payment processed successfully',
      payment: {
        ...payment,
        bill_number: bill.bill_number,
        customer_name: `${bill.first_name} ${bill.last_name}`
      }
    });
  } catch (error) {
    console.error('[Payments] Create error:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// GET /api/payments - List payments
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { customer_id, bill_id, status, from_date, to_date, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT p.*, b.bill_number, b.billing_month, b.total_amount AS bill_total,
             c.account_number, c.first_name, c.last_name
      FROM payments p
      JOIN bills b ON p.bill_id = b.bill_id
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Customers see only their payments
    if (req.user.role === 'customer') {
      const custResult = await pool.query(
        'SELECT customer_id FROM customers WHERE user_id = \$1', [req.user.user_id]
      );
      if (custResult.rows.length > 0) {
        paramCount++;
        query += ` AND p.customer_id = $${paramCount}`;
        params.push(custResult.rows[0].customer_id);
      }
    } else {
      if (customer_id) {
        paramCount++;
        query += ` AND p.customer_id = $${paramCount}`;
        params.push(customer_id);
      }
    }

    if (bill_id) {
      paramCount++;
      query += ` AND p.bill_id = $${paramCount}`;
      params.push(bill_id);
    }
    if (status) {
      paramCount++;
      query += ` AND p.status = $${paramCount}`;
      params.push(status);
    }
    if (from_date) {
      paramCount++;
      query += ` AND p.payment_date >= $${paramCount}`;
      params.push(from_date);
    }
    if (to_date) {
      paramCount++;
      query += ` AND p.payment_date <= $${paramCount}`;
      params.push(to_date);
    }

    query += ` ORDER BY p.payment_date DESC`;
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await pool.query(query, params);

    res.json({ payments: result.rows });
  } catch (error) {
    console.error('[Payments] List error:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// GET /api/payments/history/:accountNumber - Payment history for a customer
router.get('/history/:accountNumber', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.payment_reference, p.amount, p.payment_method, p.payment_date, p.status,
              b.bill_number, b.billing_month, b.total_amount AS bill_total,
              b.total_amount - COALESCE(
                (SELECT SUM(amount) FROM payments WHERE bill_id = b.bill_id AND status = 'completed'), 0
              ) AS remaining_balance
       FROM payments p
       JOIN bills b ON p.bill_id = b.bill_id
       WHERE b.account_number = \$1
       ORDER BY p.payment_date DESC`,
      [req.params.accountNumber]
    );

    // Summary
    const summaryResult = await pool.query(
      `SELECT 
         COUNT(*) AS total_payments,
         SUM(CASE WHEN p.status = 'completed' THEN p.amount ELSE 0 END) AS total_paid,
         SUM(CASE WHEN p.payment_date >= CURRENT_DATE - INTERVAL '30 days' THEN p.amount ELSE 0 END) AS paid_last_30_days,
         SUM(CASE WHEN p.payment_date >= CURRENT_DATE - INTERVAL '90 days' THEN p.amount ELSE 0 END) AS paid_last_90_days
       FROM payments p
       JOIN bills b ON p.bill_id = b.bill_id
       WHERE b.account_number = \$1 AND p.status = 'completed'`,
      [req.params.accountNumber]
    );

    res.json({
      payments: result.rows,
      summary: summaryResult.rows[0]
    });
  } catch (error) {
    console.error('[Payments] History error:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

// Simulated payment gateway endpoint
router.post('/gateway/process', authenticateToken, async (req, res) => {
  try {
    const { bill_id, amount, card_number, expiry, cvv, payment_method } = req.body;

    // Simulate payment gateway processing
    // In production, integrate with real payment gateway (e.g., PayGate, DPO, etc.)
    const simulatedResponse = {
      success: true,
      transaction_id: `TXN-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      gateway: 'WASCO-PAY',
      message: 'Payment processed successfully',
      timestamp: new Date().toISOString()
    };

    // Mask card number for security
    const maskedCard = card_number ? `****${card_number.slice(-4)}` : 'N/A';

    if (simulatedResponse.success) {
      // Create the actual payment
      const paymentReference = BillCalculator.generatePaymentReference();

      const billResult = await pool.query(
        'SELECT customer_id FROM bills WHERE bill_id = \$1', [bill_id]
      );

      if (billResult.rows.length === 0) {
        return res.status(404).json({ error: 'Bill not found' });
      }

      const payment = await DualDatabase.createPayment({
        payment_reference: paymentReference,
        bill_id: parseInt(bill_id),
        customer_id: billResult.rows[0].customer_id,
        amount: parseFloat(amount),
        payment_method: payment_method || 'online',
        transaction_id: simulatedResponse.transaction_id,
        status: 'completed',
        processed_by: req.user.user_id,
        notes: `Online payment via ${simulatedResponse.gateway}. Card: ${maskedCard}`
      });

      res.json({
        message: 'Payment processed successfully',
        payment,
        gateway_response: simulatedResponse
      });
    } else {
      res.status(402).json({
        error: 'Payment failed',
        gateway_response: simulatedResponse
      });
    }
  } catch (error) {
    console.error('[Payments] Gateway error:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

module.exports = router;
