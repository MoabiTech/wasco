const { pool } = require('./db/neon');
const BillCalculator = require('./utils/billCalculator');
require('dotenv').config();

(async () => {
  try {
    // Generate account number
    const district_id = 1;
    const account_number = await BillCalculator.generateAccountNumber(district_id);

    // Insert pending customer
    const result = await pool.query(`
      INSERT INTO customers (account_number, first_name, last_name, phone, physical_address, district_id, property_type, status, meter_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
      RETURNING *
    `, [
      account_number,
      'Test',
      'Pending',
      '+266 9999 9999',
      'Test Address, Maseru',
      district_id,
      'residential',
      'TEST-MTR-PENDING-001'
    ]);

    console.log('Pending customer created:', result.rows[0]);
    console.log('Now login admin/manager to activate!');
  } catch (error) {
    console.error('Error:', error);
  }
})();

