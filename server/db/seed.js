/**
 * Seed script to populate the database with sample data
 * Run: node db/seed.js
 */
const bcrypt = require('bcryptjs');
const { pool, initializeDatabase, seedDistricts, seedBillingRates } = require('./neon');
const DualDatabase = require('./sync');
const BillCalculator = require('../utils/billCalculator');

async function seedDatabase() {
  try {
    console.log('=== WASCO Database Seeding ===\n');

    // Step 1: Initialize tables
    await initializeDatabase();
    await seedDistricts();
    await seedBillingRates();

    // Step 2: Create branches
    const branches = [
      { name: 'Maseru Central Branch', district_id: 1, address: 'Kingsway Road, Maseru', phone: '+266 2231 2449' },
      { name: 'Leribe Branch', district_id: 3, address: 'Main Street, Hlotse', phone: '+266 2240 0123' },
      { name: 'Butha-Buthe Branch', district_id: 4, address: 'Town Center, Butha-Buthe', phone: '+266 2246 0456' },
    ];

    for (const b of branches) {
      await pool.query(
        `INSERT INTO branches (branch_name, district_id, address, phone)
         VALUES (\$1,\$2,\$3,\$4) ON CONFLICT DO NOTHING`,
        [b.name, b.district_id, b.address, b.phone]
      );
    }
    console.log('Branches seeded');

    // Step 3: Create sample users
    const hash = await bcrypt.hash('password123', 12);
    const users = [
      { username: 'moabitech', email: 'tech1@gmail.com', role: 'customer' },
      { username: 'mphotsolo', email: 'mphotsolo@gmail.com', role: 'customer' },
      { username: 'koloi', email: 'koloi9i@gmail.com', role: 'customer' },
      { username: 'tech_user', email: 'tech@wasco.co.ls', role: 'technician' },
    ];

    for (const u of users) {
      await pool.query(
        `INSERT INTO users (username, email, password_hash, role)
         VALUES (\$1,\$2,\$3,\$4) ON CONFLICT (username) DO NOTHING`,
        [u.username, u.email, hash, u.role]
      );
    }
    console.log('Sample users seeded');

    // Step 4: Create sample customers
    const sampleCustomers = [
      { first_name: 'Lesiea', last_name: 'Mokhesi', phone: '+266 5800 1234', email: 'lesiea@gmail.com', address: '123 Kingsway, Maseru', district_id: 1, type: 'residential', meter: 'MTR-001-RES' },
      { first_name: 'Retshelisitsoe', last_name: 'Letsie', phone: '+266 5800 5678', email: 'mary@gmail.com', address: '45 Main Road, Hlotse', district_id: 3, type: 'residential', meter: 'MTR-002-RES' },
      { first_name: 'Phethang', last_name: 'Mohale', phone: '+266 5800 9012', email: 'peter@gmail.com', address: '78 Industrial Area, Maseru', district_id: 1, type: 'commercial', meter: 'MTR-003-COM' },
      { first_name: 'Thabo', last_name: 'Nkuebe', phone: '+266 5801 3456', address: '12 Church St, Butha-Buthe', district_id: 4, type: 'residential', meter: 'MTR-004-RES' },
      { first_name: 'Lerato', last_name: 'Moshoeshoe', phone: '+266 5801 7890', address: '90 Government Complex, Maseru', district_id: 1, type: 'government', meter: 'MTR-005-GOV' },
    ];

    // Get user IDs
    const userResults = await pool.query("SELECT user_id, username FROM users WHERE role = 'customer'");
    const userMap = {};
    userResults.rows.forEach(u => { userMap[u.username] = u.user_id; });

    for (let i = 0; i < sampleCustomers.length; i++) {
      const c = sampleCustomers[i];
      const accountNumber = await BillCalculator.generateAccountNumber(c.district_id);
      
      const usernames = ['techo_customer', 'techo_customer', 'peter_customer'];
      const userId = i < 3 ? userMap[usernames[i]] : null;

      try {
        await DualDatabase.createCustomer({
          account_number: accountNumber,
          first_name: c.first_name,
          last_name: c.last_name,
          phone: c.phone,
          email: c.email,
          physical_address: c.address,
          district_id: c.district_id,
          property_type: c.type,
          meter_number: c.meter,
          user_id: userId
        });
      } catch (e) {
        console.log(`Customer ${c.first_name} may already exist, skipping`);
      }
    }
    console.log('Sample customers seeded');

    // Step 5: Create sample meter readings
    const customers = await pool.query('SELECT customer_id, account_number FROM customers');
    const months = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05'];
    
    for (const cust of customers.rows) {
      let prevReading = Math.floor(Math.random() * 100) + 50;
      
      for (const month of months) {
        const consumption = Math.floor(Math.random() * 30) + 5;
        const currentReading = prevReading + consumption;
        
        try {
          await DualDatabase.createMeterReading({
            customer_id: cust.customer_id,
            account_number: cust.account_number,
            reading_date: `${month}-15`,
            reading_month: month,
            previous_reading: prevReading,
            current_reading: currentReading,
            reading_type: 'actual'
          });
        } catch (e) {
          // Skip if already exists
        }
        
        prevReading = currentReading;
      }
    }
    console.log('Sample meter readings seeded');

    // Step 6: Generate bills
    for (const cust of customers.rows) {
      for (const month of months) {
        try {
          const readingResult = await pool.query(
            `SELECT reading_id, (current_reading - previous_reading) AS consumption
             FROM meter_readings WHERE customer_id = \$1 AND reading_month = \$2`,
            [cust.customer_id, month]
          );

          if (readingResult.rows.length > 0) {
            const consumption = parseFloat(readingResult.rows[0].consumption);
            const billCalc = await BillCalculator.calculateBill(cust.customer_id, consumption);
            const billNumber = await BillCalculator.generateBillNumber(month);

            const dueDate = new Date(`${month}-15`);
            dueDate.setDate(dueDate.getDate() + 30);

            await DualDatabase.createBill({
              bill_number: billNumber,
              customer_id: cust.customer_id,
              account_number: cust.account_number,
              billing_month: month,
              reading_id: readingResult.rows[0].reading_id,
              consumption,
              water_charge: billCalc.water_charge,
              sewerage_charge: billCalc.sewerage_charge,
              fixed_charge: billCalc.fixed_charge,
              arrears: 0,
              vat_amount: billCalc.vat_amount,
              total_amount: billCalc.total_amount,
              due_date: dueDate.toISOString().split('T')[0]
            });
          }
        } catch (e) {
          // Skip if already exists
        }
      }
    }
    console.log('Sample bills generated');

    // Step 7: Create some sample payments
    const bills = await pool.query(
      `SELECT bill_id, customer_id, total_amount, bill_number 
       FROM bills ORDER BY billing_month LIMIT 10`
    );

    for (let i = 0; i < Math.min(7, bills.rows.length); i++) {
      const bill = bills.rows[i];
      try {
        await DualDatabase.createPayment({
          payment_reference: BillCalculator.generatePaymentReference(),
          bill_id: bill.bill_id,
          customer_id: bill.customer_id,
          amount: parseFloat(bill.total_amount),
          payment_method: ['cash', 'mobile_money', 'bank_transfer'][i % 3],
          status: 'completed'
        });
      } catch (e) {
        // Skip
      }
    }
    console.log('Sample payments seeded');

    console.log('\n=== Seeding Complete ===');
    console.log('Default logins:');
    console.log('  Admin: admin / admin123');
    console.log('  Manager: manager / manager123');
    console.log('  Customer: techo_customer / password123');
    console.log('  Customer: pata_customer / password123');

    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seedDatabase();
