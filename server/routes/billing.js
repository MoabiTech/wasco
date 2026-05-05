const express = require('express');
const router = express.Router();
const { pool } = require('../db/neon');
const DualDatabase = require('../db/sync');
const BillCalculator = require('../utils/billCalculator');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// GET /api/billing/rates - View billing rates (public)
router.get('/rates', async (req, res) => {
  try {
    const { property_type } = req.query;
    let query = `SELECT * FROM billing_rates WHERE is_active = true`;
    const params = [];

    if (property_type) {
      query += ` AND property_type = \$1`;
      params.push(property_type);
    }

    query += ` ORDER BY property_type, tier_level`;

    const result = await pool.query(query, params);
    res.json({ rates: result.rows });
  } catch (error) {
    console.error('[Billing] Rates error:', error);
    res.status(500).json({ error: 'Failed to fetch billing rates' });
  }
});

// POST /api/billing/rates - Add/Update billing rate (admin)
router.post('/rates', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { rate_name, property_type, tier_level, min_usage, max_usage, cost_per_unit, fixed_charge, sewerage_rate } = req.body;

    const result = await pool.query(
      `INSERT INTO billing_rates (rate_name, property_type, tier_level, min_usage, max_usage, cost_per_unit, fixed_charge, sewerage_rate)
       VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8)
       ON CONFLICT (property_type, tier_level, effective_from) 
       DO UPDATE SET cost_per_unit = \$6, fixed_charge = \$7, sewerage_rate = \$8, rate_name = \$1
       RETURNING *`,
      [rate_name, property_type, tier_level, min_usage, max_usage, cost_per_unit, fixed_charge || 0, sewerage_rate || 0.5]
    );

    const rate = result.rows[0];

    // Sync to Firebase
    const { writeToFirebase } = require('../db/firebase');
    await writeToFirebase('billingRates', `rate_${rate.rate_id}`, rate);

    await logActivity(req.user.user_id, 'CREATE_RATE', 'billing_rates', rate.rate_id, null, rate, req.ip);

    res.status(201).json({ message: 'Billing rate saved', rate });
  } catch (error) {
    console.error('[Billing] Rate create error:', error);
    res.status(500).json({ error: 'Failed to save billing rate' });
  }
});

// POST /api/billing/meter-reading - Record meter reading (admin/technician)
router.post('/meter-reading', authenticateToken, authorize('admin', 'technician'), async (req, res) => {
  try {
    const { account_number, reading_date, current_reading, reading_type, notes } = req.body;

    if (!account_number || !current_reading) {
      return res.status(400).json({ error: 'Account number and current reading are required' });
    }

    // Get customer
    const custResult = await pool.query(
      'SELECT customer_id, account_number FROM customers WHERE account_number = \$1',
      [account_number]
    );
    if (custResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const customer = custResult.rows[0];

    // Get previous reading
    const prevResult = await pool.query(
      `SELECT current_reading, reading_month FROM meter_readings 
       WHERE customer_id = \$1 ORDER BY reading_date DESC LIMIT 1`,
      [customer.customer_id]
    );

    const previousReading = prevResult.rows.length > 0 ? parseFloat(prevResult.rows[0].current_reading) : 0;

    // Determine reading month
    const readingDate = new Date(reading_date || Date.now());
    const readingMonth = `${readingDate.getFullYear()}-${String(readingDate.getMonth() + 1).padStart(2, '0')}`;

    const reading = await DualDatabase.createMeterReading({
      customer_id: customer.customer_id,
      account_number: customer.account_number,
      reading_date: readingDate.toISOString().split('T')[0],
      reading_month: readingMonth,
      previous_reading: previousReading,
      current_reading: parseFloat(current_reading),
      reading_type: reading_type || 'actual',
      recorded_by: req.user.user_id,
      notes
    });

    await logActivity(req.user.user_id, 'METER_READING', 'meter_readings', reading.reading_id, null, reading, req.ip);

    res.status(201).json({ message: 'Meter reading recorded', reading });
  } catch (error) {
    console.error('[Billing] Meter reading error:', error);
    res.status(500).json({ error: 'Failed to record meter reading' });
  }
});

// POST /api/billing/generate-bill - Generate bill for a customer (admin)
router.post('/generate-bill', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { account_number, billing_month } = req.body;

    if (!account_number || !billing_month) {
      return res.status(400).json({ error: 'Account number and billing month are required' });
    }

    // Get customer
    const custResult = await pool.query(
      'SELECT customer_id, account_number, property_type FROM customers WHERE account_number = \$1',
      [account_number]
    );
    if (custResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const customer = custResult.rows[0];

    // Get meter reading for the month
    const readingResult = await pool.query(
      `SELECT reading_id, (current_reading - previous_reading) AS consumption
       FROM meter_readings
       WHERE customer_id = \$1 AND reading_month = \$2`,
      [customer.customer_id, billing_month]
    );

    if (readingResult.rows.length === 0) {
      return res.status(404).json({ error: 'No meter reading found for this billing month' });
    }

    const reading = readingResult.rows[0];
    const consumption = parseFloat(reading.consumption);

    // Calculate bill
    const billCalc = await BillCalculator.calculateBill(customer.customer_id, consumption);

    // Generate bill number
    const billNumber = await BillCalculator.generateBillNumber(billing_month);

    // Due date: 30 days from now
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    // Create bill in both databases
    const bill = await DualDatabase.createBill({
      bill_number: billNumber,
      customer_id: customer.customer_id,
      account_number: customer.account_number,
      billing_month,
      reading_id: reading.reading_id,
      consumption,
      water_charge: billCalc.water_charge,
      sewerage_charge: billCalc.sewerage_charge,
      fixed_charge: billCalc.fixed_charge,
      arrears: billCalc.arrears,
      vat_amount: billCalc.vat_amount,
      total_amount: billCalc.total_amount,
      due_date: dueDate.toISOString().split('T')[0]
    });

    // Send notification
    await DualDatabase.createNotification({
      customer_id: customer.customer_id,
      notification_type: 'bill_ready',
      title: `Water Bill for ${billing_month}`,
      message: `Your water bill of M${billCalc.total_amount.toFixed(2)} for ${billing_month} is ready. Due date: ${dueDate.toISOString().split('T')[0]}`,
      sent_via: 'app'
    });

    await logActivity(req.user.user_id, 'GENERATE_BILL', 'bills', bill.bill_id, null, bill, req.ip);

    res.status(201).json({
      message: 'Bill generated successfully',
      bill,
      breakdown: billCalc
    });
  } catch (error) {
    console.error('[Billing] Generate bill error:', error);
    res.status(500).json({ error: 'Failed to generate bill' });
  }
});

// POST /api/billing/generate-bulk - Generate bills for all customers in a month (admin)
router.post('/generate-bulk', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { billing_month, district_id } = req.body;

    if (!billing_month) {
      return res.status(400).json({ error: 'Billing month is required' });
    }

    // Get all customers with readings for this month
    let query = `
      SELECT c.customer_id, c.account_number, c.property_type,
             mr.reading_id, (mr.current_reading - mr.previous_reading) AS consumption
      FROM customers c
      JOIN meter_readings mr ON c.customer_id = mr.customer_id AND mr.reading_month = \$1
      LEFT JOIN bills b ON c.customer_id = b.customer_id AND b.billing_month = \$1
      WHERE c.status = 'active' AND b.bill_id IS NULL
    `;
    const params = [billing_month];

    if (district_id) {
      query += ` AND c.district_id = \$2`;
      params.push(district_id);
    }

    const customers = await pool.query(query, params);

    const results = { success: 0, failed: 0, errors: [] };

    for (const cust of customers.rows) {
      try {
        const consumption = parseFloat(cust.consumption);
        const billCalc = await BillCalculator.calculateBill(cust.customer_id, consumption);
        const billNumber = await BillCalculator.generateBillNumber(billing_month);

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30);

        await DualDatabase.createBill({
          bill_number: billNumber,
          customer_id: cust.customer_id,
          account_number: cust.account_number,
          billing_month,
          reading_id: cust.reading_id,
          consumption,
          water_charge: billCalc.water_charge,
          sewerage_charge: billCalc.sewerage_charge,
          fixed_charge: billCalc.fixed_charge,
          arrears: billCalc.arrears,
          vat_amount: billCalc.vat_amount,
          total_amount: billCalc.total_amount,
          due_date: dueDate.toISOString().split('T')[0]
        });

        await DualDatabase.createNotification({
          customer_id: cust.customer_id,
          notification_type: 'bill_ready',
          title: `Water Bill for ${billing_month}`,
          message: `Your water bill of M${billCalc.total_amount.toFixed(2)} for ${billing_month} is ready.`,
          sent_via: 'app'
        });

        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ account: cust.account_number, error: err.message });
      }
    }

    res.json({ message: 'Bulk bill generation completed', results });
  } catch (error) {
    console.error('[Billing] Bulk generate error:', error);
    res.status(500).json({ error: 'Failed to generate bulk bills' });
  }
});

// GET /api/billing/calculate-preview - Preview bill calculation
router.get('/calculate-preview', authenticateToken, async (req, res) => {
  try {
    const { account_number, consumption } = req.query;

    const custResult = await pool.query(
      'SELECT customer_id FROM customers WHERE account_number = \$1',
      [account_number]
    );
    if (custResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const billCalc = await BillCalculator.calculateBill(
      custResult.rows[0].customer_id,
      parseFloat(consumption)
    );

    res.json({ preview: billCalc });
  } catch (error) {
    console.error('[Billing] Preview error:', error);
    res.status(500).json({ error: 'Failed to calculate preview' });
  }
});

module.exports = router;
