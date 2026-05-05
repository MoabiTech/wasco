const { pool } = require('./neon');
const { writeToFirebase, updateInFirebase, deleteFromFirebase, readFromFirebase } = require('./firebase');

/**
 * DualDB: Ensures every write operation goes to BOTH PostgreSQL and Firebase
 * This is the core of the heterogeneous distributed database system
 */
class DualDatabase {

  // ─── CUSTOMERS ───
  static async createCustomer(customerData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO customers (account_number, first_name, last_name, id_number, phone, email, 
         physical_address, district_id, property_type, meter_number, user_id)
         VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11)
         RETURNING *`,
        [
          customerData.account_number, customerData.first_name, customerData.last_name,
          customerData.id_number, customerData.phone, customerData.email,
          customerData.physical_address, customerData.district_id, customerData.property_type,
          customerData.meter_number, customerData.user_id
        ]
      );

      const customer = result.rows[0];

      // Simultaneously write to Firebase
      await writeToFirebase('customers', customer.account_number, {
        customer_id: customer.customer_id,
        account_number: customer.account_number,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        email: customer.email,
        physical_address: customer.physical_address,
        district_id: customer.district_id,
        property_type: customer.property_type,
        meter_number: customer.meter_number,
        status: customer.status,
        connection_date: customer.connection_date,
        created_at: customer.created_at
      });

      await client.query('COMMIT');
      console.log(`[DualDB] Customer ${customer.account_number} saved to both databases`);
      return customer;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[DualDB] Error creating customer:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async updateCustomer(accountNumber, updates) {
    const fields = [];
    const values = [];
    let paramCount = 0;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && !['account_number', 'customer_id'].includes(key)) {
        paramCount++;
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
      }
    });

    if (fields.length === 0) throw new Error('No fields to update');

    paramCount++;
    values.push(accountNumber);

    const result = await pool.query(
      `UPDATE customers SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE account_number = $${paramCount} RETURNING *`,
      values
    );

    if (result.rows.length > 0) {
      await updateInFirebase('customers', accountNumber, updates);
    }

    return result.rows[0];
  }

  // ─── METER READINGS ───
  static async createMeterReading(readingData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO meter_readings (customer_id, account_number, reading_date, reading_month,
         previous_reading, current_reading, reading_type, recorded_by, notes)
         VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9)
         RETURNING *, (current_reading - previous_reading) AS consumption`,
        [
          readingData.customer_id, readingData.account_number, readingData.reading_date,
          readingData.reading_month, readingData.previous_reading, readingData.current_reading,
          readingData.reading_type || 'actual', readingData.recorded_by, readingData.notes
        ]
      );

      const reading = result.rows[0];
      const firebaseKey = `${readingData.account_number}_${readingData.reading_month}`;

      await writeToFirebase('meterReadings', firebaseKey, {
        reading_id: reading.reading_id,
        customer_id: reading.customer_id,
        account_number: reading.account_number,
        reading_date: reading.reading_date,
        reading_month: reading.reading_month,
        previous_reading: parseFloat(reading.previous_reading),
        current_reading: parseFloat(reading.current_reading),
        consumption: parseFloat(reading.current_reading) - parseFloat(reading.previous_reading),
        reading_type: reading.reading_type,
        created_at: reading.created_at
      });

      await client.query('COMMIT');
      console.log(`[DualDB] Meter reading saved for ${readingData.account_number}`);
      return reading;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── BILLS ───
  static async createBill(billData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO bills (bill_number, customer_id, account_number, billing_month, reading_id,
         consumption, water_charge, sewerage_charge, fixed_charge, arrears, vat_amount, 
         total_amount, due_date)
         VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13)
         RETURNING *`,
        [
          billData.bill_number, billData.customer_id, billData.account_number,
          billData.billing_month, billData.reading_id, billData.consumption,
          billData.water_charge, billData.sewerage_charge, billData.fixed_charge,
          billData.arrears, billData.vat_amount, billData.total_amount, billData.due_date
        ]
      );

      const bill = result.rows[0];

      await writeToFirebase('bills', bill.bill_number, {
        bill_id: bill.bill_id,
        bill_number: bill.bill_number,
        customer_id: bill.customer_id,
        account_number: bill.account_number,
        billing_month: bill.billing_month,
        consumption: parseFloat(bill.consumption),
        water_charge: parseFloat(bill.water_charge),
        sewerage_charge: parseFloat(bill.sewerage_charge),
        fixed_charge: parseFloat(bill.fixed_charge),
        arrears: parseFloat(bill.arrears),
        vat_amount: parseFloat(bill.vat_amount),
        total_amount: parseFloat(bill.total_amount),
        due_date: bill.due_date,
        payment_status: bill.payment_status,
        generated_at: bill.generated_at
      });

      await client.query('COMMIT');
      console.log(`[DualDB] Bill ${bill.bill_number} saved to both databases`);
      return bill;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── PAYMENTS ───
  static async createPayment(paymentData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert payment
      const result = await client.query(
        `INSERT INTO payments (payment_reference, bill_id, customer_id, amount, payment_method,
         transaction_id, status, processed_by, notes)
         VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9)
         RETURNING *`,
        [
          paymentData.payment_reference, paymentData.bill_id, paymentData.customer_id,
          paymentData.amount, paymentData.payment_method, paymentData.transaction_id,
          paymentData.status || 'completed', paymentData.processed_by, paymentData.notes
        ]
      );

      const payment = result.rows[0];

      // Update bill payment status
      const billResult = await client.query(
        `SELECT b.total_amount, COALESCE(SUM(p.amount), 0) AS total_paid
         FROM bills b
         LEFT JOIN payments p ON b.bill_id = p.bill_id AND p.status = 'completed'
         WHERE b.bill_id = \$1
         GROUP BY b.total_amount`,
        [paymentData.bill_id]
      );

      if (billResult.rows.length > 0) {
        const { total_amount, total_paid } = billResult.rows[0];
        const newTotalPaid = parseFloat(total_paid) + parseFloat(paymentData.amount);
        let newStatus = 'partial';
        if (newTotalPaid >= parseFloat(total_amount)) newStatus = 'paid';

        await client.query(
          `UPDATE bills SET payment_status = \$1, updated_at = CURRENT_TIMESTAMP WHERE bill_id = \$2`,
          [newStatus, paymentData.bill_id]
        );

        // Get bill number for Firebase update
        const billInfo = await client.query(
          `SELECT bill_number FROM bills WHERE bill_id = \$1`, [paymentData.bill_id]
        );
        if (billInfo.rows.length > 0) {
          await updateInFirebase('bills', billInfo.rows[0].bill_number, {
            payment_status: newStatus
          });
        }
      }

      // Write payment to Firebase
      await writeToFirebase('payments', payment.payment_reference, {
        payment_id: payment.payment_id,
        payment_reference: payment.payment_reference,
        bill_id: payment.bill_id,
        customer_id: payment.customer_id,
        amount: parseFloat(payment.amount),
        payment_method: payment.payment_method,
        transaction_id: payment.transaction_id,
        status: payment.status,
        payment_date: payment.payment_date,
        created_at: payment.created_at
      });

      await client.query('COMMIT');
      console.log(`[DualDB] Payment ${payment.payment_reference} saved to both databases`);
      return payment;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── NOTIFICATIONS ───
  static async createNotification(notifData) {
    const result = await pool.query(
      `INSERT INTO notifications (customer_id, district_id, notification_type, title, message, sent_via)
       VALUES (\$1,\$2,\$3,\$4,\$5,\$6) RETURNING *`,
      [notifData.customer_id, notifData.district_id, notifData.notification_type,
       notifData.title, notifData.message, notifData.sent_via || 'app']
    );

    const notif = result.rows[0];
    const key = `notif_${notif.notification_id}`;

    await writeToFirebase('notifications', key, {
      notification_id: notif.notification_id,
      customer_id: notif.customer_id,
      district_id: notif.district_id,
      notification_type: notif.notification_type,
      title: notif.title,
      message: notif.message,
      is_read: false,
      sent_via: notif.sent_via,
      sent_at: notif.sent_at
    });

    return notif;
  }

  // ─── LEAK REPORTS ───
  static async createLeakReport(reportData) {
    const result = await pool.query(
      `INSERT INTO leak_reports (customer_id, district_id, location_description, severity, notes)
       VALUES (\$1,\$2,\$3,\$4,\$5) RETURNING *`,
      [reportData.customer_id, reportData.district_id, reportData.location_description,
       reportData.severity, reportData.notes]
    );

    const report = result.rows[0];
    await writeToFirebase('leakReports', `leak_${report.report_id}`, {
      ...report,
      reported_at: report.reported_at
    });

    return report;
  }

  // ─── SYNC UTILITIES ───
  static async fullSyncToFirebase() {
    console.log('[DualDB] Starting full sync to Firebase...');

    // Sync districts
    const districts = await pool.query('SELECT * FROM districts');
    for (const d of districts.rows) {
      await writeToFirebase('districts', `district_${d.district_id}`, d);
    }

    // Sync billing rates
    const rates = await pool.query('SELECT * FROM billing_rates WHERE is_active = true');
    for (const r of rates.rows) {
      await writeToFirebase('billingRates', `rate_${r.rate_id}`, r);
    }

    // Sync customers
    const customers = await pool.query('SELECT * FROM customers');
    for (const c of customers.rows) {
      await writeToFirebase('customers', c.account_number, c);
    }

    // Sync bills
    const bills = await pool.query('SELECT * FROM bills');
    for (const b of bills.rows) {
      await writeToFirebase('bills', b.bill_number, b);
    }

    // Sync payments
    const payments = await pool.query('SELECT * FROM payments');
    for (const p of payments.rows) {
      await writeToFirebase('payments', p.payment_reference, p);
    }

    console.log('[DualDB] Full sync completed');
  }
}

module.exports = DualDatabase;
