const { pool } = require('../db/neon');

/**
 * Calculates water bill based on tiered consumption rates
 * Uses embedded SQL queries to fetch applicable rates
 */
class BillCalculator {

  /**
   * Calculate bill for a given customer and consumption
   * Implements tiered pricing: different rates for different usage ranges
   */
  static async calculateBill(customerId, consumption) {
    // Get customer property type
    const customerResult = await pool.query(
      `SELECT property_type, account_number FROM customers WHERE customer_id = \$1`,
      [customerId]
    );

    if (customerResult.rows.length === 0) {
      throw new Error('Customer not found');
    }

    const { property_type, account_number } = customerResult.rows[0];

    // Get applicable billing rates (tiered, ordered by tier level)
    const ratesResult = await pool.query(
      `SELECT * FROM billing_rates 
       WHERE property_type = \$1 AND is_active = true 
         AND effective_from <= CURRENT_DATE 
         AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
       ORDER BY tier_level ASC`,
      [property_type]
    );

    if (ratesResult.rows.length === 0) {
      throw new Error(`No billing rates found for property type: ${property_type}`);
    }

    const rates = ratesResult.rows;
    let waterCharge = 0;
    let remainingConsumption = parseFloat(consumption);
    const fixedCharge = parseFloat(rates[0].fixed_charge);
    const sewerageRate = parseFloat(rates[0].sewerage_rate);

    // Calculate tiered water charges
    for (const rate of rates) {
      if (remainingConsumption <= 0) break;

      const minUsage = parseFloat(rate.min_usage);
      const maxUsage = rate.max_usage ? parseFloat(rate.max_usage) : Infinity;
      const costPerUnit = parseFloat(rate.cost_per_unit);

      const tierRange = maxUsage === Infinity ? remainingConsumption : (maxUsage - minUsage);
      const tierConsumption = Math.min(remainingConsumption, tierRange);

      waterCharge += tierConsumption * costPerUnit;
      remainingConsumption -= tierConsumption;
    }

    // Calculate sewerage charge (percentage of water charge)
    const sewerageCharge = waterCharge * sewerageRate;

    // Calculate arrears (outstanding balance from previous bills)
    const arrearsResult = await pool.query(
      `SELECT COALESCE(SUM(b.total_amount) - SUM(COALESCE(p.paid, 0)), 0) AS arrears
       FROM bills b
       LEFT JOIN (
         SELECT bill_id, SUM(amount) AS paid
         FROM payments WHERE status = 'completed'
         GROUP BY bill_id
       ) p ON b.bill_id = p.bill_id
       WHERE b.customer_id = \$1 AND b.payment_status != 'paid'`,
      [customerId]
    );

    const arrears = parseFloat(arrearsResult.rows[0]?.arrears || 0);

    // Calculate VAT (15% - Lesotho standard rate)
    const subtotal = waterCharge + sewerageCharge + fixedCharge;
    const vatAmount = subtotal * 0.15;

    // Total amount
    const totalAmount = subtotal + vatAmount + arrears;

    return {
      account_number,
      consumption: parseFloat(consumption),
      water_charge: Math.round(waterCharge * 100) / 100,
      sewerage_charge: Math.round(sewerageCharge * 100) / 100,
      fixed_charge: fixedCharge,
      arrears: Math.round(arrears * 100) / 100,
      vat_amount: Math.round(vatAmount * 100) / 100,
      total_amount: Math.round(totalAmount * 100) / 100,
      property_type,
      rates_applied: rates.map(r => ({
        tier: r.tier_level,
        range: `${r.min_usage} - ${r.max_usage || '∞'} kL`,
        cost_per_unit: parseFloat(r.cost_per_unit)
      }))
    };
  }

  /**
   * Generate bill number: WASCO-YYYYMM-XXXXX
   */
  static async generateBillNumber(billingMonth) {
    const result = await pool.query(
      `SELECT COUNT(*) + 1 AS next_num FROM bills WHERE billing_month = \$1`,
      [billingMonth]
    );
    const num = String(result.rows[0].next_num).padStart(5, '0');
    return `WASCO-${billingMonth.replace('-', '')}-${num}`;
  }

  /**
   * Generate payment reference: PAY-TIMESTAMP-RANDOM
   */
  static generatePaymentReference() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `PAY-${timestamp}-${random}`;
  }

  /**
   * Generate account number: WAS-DISTRICT-XXXXX
   */
  static async generateAccountNumber(districtId) {
    const result = await pool.query(
      `SELECT COUNT(*) + 1 AS next_num FROM customers WHERE district_id = \$1`,
      [districtId]
    );
    const num = String(result.rows[0].next_num).padStart(5, '0');
    return `WAS-${String(districtId).padStart(2, '0')}-${num}`;
  }
}

module.exports = BillCalculator;
