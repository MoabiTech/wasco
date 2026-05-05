const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('[Neon PostgreSQL] Connected successfully');
});

pool.on('error', (err) => {
  console.error('[Neon PostgreSQL] Unexpected error:', err);
});

// ─── DDL: Create all tables ───
async function initializeDatabase() {
  console.log('[Neon PostgreSQL] Initializing schema (no transaction to avoid FK issues)...');
  
  // Create tables in strict dependency order, no transaction
  const tables = [
    // 1. Independent tables first
    `CREATE TABLE IF NOT EXISTS districts (
      district_id SERIAL PRIMARY KEY,
      district_name VARCHAR(100) NOT NULL UNIQUE,
      region VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS billing_rates (
      rate_id SERIAL PRIMARY KEY,
      rate_name VARCHAR(100) NOT NULL,
      property_type VARCHAR(30) NOT NULL
        CHECK (property_type IN ('residential', 'commercial', 'industrial', 'government')),
      tier_level INTEGER NOT NULL,
      min_usage DECIMAL(10,2) NOT NULL,
      max_usage DECIMAL(10,2),
      cost_per_unit DECIMAL(10,4) NOT NULL,
      fixed_charge DECIMAL(10,2) DEFAULT 0,
      sewerage_rate DECIMAL(5,4) DEFAULT 0.50,
      effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
      effective_to DATE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(property_type, tier_level, effective_from)
    )`,
    
    `CREATE TABLE IF NOT EXISTS branches (
      branch_id SERIAL PRIMARY KEY,
      branch_name VARCHAR(150) NOT NULL,
      district_id INTEGER REFERENCES districts(district_id) ON DELETE SET NULL,
      address TEXT,
      phone VARCHAR(20),
      email VARCHAR(100),
      manager_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS users (
      user_id SERIAL PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'customer' 
        CHECK (role IN ('customer', 'admin', 'branch_manager', 'technician')),
      branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE,
      firebase_uid VARCHAR(128),
      last_login TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS customers (
      customer_id SERIAL PRIMARY KEY,
      account_number VARCHAR(20) NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      first_name VARCHAR(50) NOT NULL,
      last_name VARCHAR(50) NOT NULL,
      id_number VARCHAR(20),
      phone VARCHAR(20),
      email VARCHAR(100),
      physical_address TEXT NOT NULL,
      district_id INTEGER REFERENCES districts(district_id) ON DELETE SET NULL,
      property_type VARCHAR(30) DEFAULT 'residential'
        CHECK (property_type IN ('residential', 'commercial', 'industrial', 'government')),
      meter_number VARCHAR(30) UNIQUE,
      connection_date DATE DEFAULT CURRENT_DATE,
      status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'disconnected', 'pending')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS meter_readings (
      reading_id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
      account_number VARCHAR(20) NOT NULL,
      reading_date DATE NOT NULL,
      reading_month VARCHAR(7) NOT NULL,
      previous_reading DECIMAL(12,2) NOT NULL,
      current_reading DECIMAL(12,2) NOT NULL,
      consumption DECIMAL(12,2) GENERATED ALWAYS AS (current_reading - previous_reading) STORED,
      reading_type VARCHAR(20) DEFAULT 'actual'
        CHECK (reading_type IN ('actual', 'estimated')),
      recorded_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(customer_id, reading_month)
    )`,
    
    `CREATE TABLE IF NOT EXISTS bills (
      bill_id SERIAL PRIMARY KEY,
      bill_number VARCHAR(20) NOT NULL UNIQUE,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
      account_number VARCHAR(20) NOT NULL,
      billing_month VARCHAR(7) NOT NULL,
      reading_id INTEGER REFERENCES meter_readings(reading_id) ON DELETE SET NULL,
      consumption DECIMAL(12,2) NOT NULL,
      water_charge DECIMAL(12,2) NOT NULL,
      sewerage_charge DECIMAL(12,2) DEFAULT 0,
      fixed_charge DECIMAL(12,2) DEFAULT 0,
      arrears DECIMAL(12,2) DEFAULT 0,
      vat_amount DECIMAL(12,2) DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL,
      due_date DATE NOT NULL,
      payment_status VARCHAR(20) DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overdue')),
      generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(customer_id, billing_month)
    )`,
    
    `CREATE TABLE IF NOT EXISTS payments (
      payment_id SERIAL PRIMARY KEY,
      payment_reference VARCHAR(30) NOT NULL UNIQUE,
      bill_id INTEGER REFERENCES bills(bill_id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
      amount DECIMAL(12,2) NOT NULL,
      payment_method VARCHAR(30) NOT NULL
        CHECK (payment_method IN ('cash', 'bank_transfer', 'mobile_money', 'online', 'cheque')),
      payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      transaction_id VARCHAR(100),
      gateway_response TEXT,
      status VARCHAR(20) DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
      processed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS notifications (
      notification_id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
      district_id INTEGER REFERENCES districts(district_id) ON DELETE SET NULL,
      notification_type VARCHAR(30) NOT NULL
        CHECK (notification_type IN ('bill_ready', 'payment_due', 'payment_received', 
               'overdue', 'disconnection_warning', 'service_update', 'leak_report')),
      title VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      sent_via VARCHAR(20) DEFAULT 'app'
        CHECK (sent_via IN ('app', 'sms', 'email', 'all')),
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS leak_reports (
      report_id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
      district_id INTEGER REFERENCES districts(district_id) ON DELETE CASCADE,
      location_description TEXT NOT NULL,
      severity VARCHAR(20) DEFAULT 'medium'
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      status VARCHAR(20) DEFAULT 'reported'
        CHECK (status IN ('reported', 'investigating', 'repairing', 'resolved')),
      reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP,
      assigned_to INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      notes TEXT
    )`,
    
    `CREATE TABLE IF NOT EXISTS audit_log (
      log_id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      action VARCHAR(50) NOT NULL,
      table_name VARCHAR(50),
      record_id INTEGER,
      old_values JSONB,
      new_values JSONB,
      ip_address VARCHAR(45),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (let i = 0; i < tables.length; i++) {
    try {
      await pool.query(tables[i]);
      console.log(`[Neon] Table ${i+1}/${tables.length} created`);
    } catch (err) {
      console.warn(`[Neon] Table ${i+1} skip:`, err.message);
    }
  }

  // ─── VIEWS (safe with OR REPLACE) ───
  const views = [
    `CREATE OR REPLACE VIEW vw_customer_billing_summary AS
     SELECT c.customer_id, c.account_number, c.first_name || ' ' || c.last_name AS full_name,
            c.property_type, d.district_name, COUNT(DISTINCT b.bill_id) AS total_bills,
            COALESCE(SUM(b.total_amount), 0) AS total_billed, COALESCE(SUM(p.total_paid), 0) AS total_paid,
            COALESCE(SUM(b.total_amount), 0) - COALESCE(SUM(p.total_paid), 0) AS outstanding_balance
     FROM customers c LEFT JOIN districts d ON c.district_id = d.district_id
     LEFT JOIN bills b ON c.customer_id = b.customer_id
     LEFT JOIN (SELECT bill_id, SUM(amount) AS total_paid FROM payments WHERE status = 'completed' GROUP BY bill_id) p ON b.bill_id = p.bill_id
     GROUP BY c.customer_id, c.account_number, c.first_name, c.last_name, c.property_type, d.district_name`,
     
    `CREATE OR REPLACE VIEW vw_monthly_revenue AS
     SELECT d.district_name, b.billing_month, COUNT(b.bill_id) AS bills_count, SUM(b.consumption) AS total_consumption,
            SUM(b.total_amount) AS total_billed, COALESCE(SUM(pay.paid_amount), 0) AS total_collected,
            COUNT(CASE WHEN b.payment_status = 'overdue' THEN 1 END) AS overdue_count
     FROM bills b JOIN customers c ON b.customer_id = c.customer_id JOIN districts d ON c.district_id = d.district_id
     LEFT JOIN (SELECT bill_id, SUM(amount) AS paid_amount FROM payments WHERE status = 'completed' GROUP BY bill_id) pay ON b.bill_id = pay.bill_id
     GROUP BY d.district_name, b.billing_month ORDER BY b.billing_month DESC, d.district_name`,
     
    `CREATE OR REPLACE VIEW vw_usage_patterns AS
     SELECT c.property_type, d.district_name, mr.reading_month, COUNT(mr.reading_id) AS readings_count,
            AVG(mr.current_reading - mr.previous_reading) AS avg_consumption,
            MIN(mr.current_reading - mr.previous_reading) AS min_consumption,
            MAX(mr.current_reading - mr.previous_reading) AS max_consumption
     FROM meter_readings mr JOIN customers c ON mr.customer_id = c.customer_id
     JOIN districts d ON c.district_id = d.district_id GROUP BY c.property_type, d.district_name, mr.reading_month ORDER BY mr.reading_month DESC`,
     
    `CREATE OR REPLACE VIEW vw_outstanding_balances AS
     SELECT c.customer_id, c.account_number, c.first_name || ' ' || c.last_name AS full_name, c.phone, c.email,
            d.district_name, b.bill_number, b.billing_month, b.total_amount, COALESCE(p.paid, 0) AS amount_paid,
            b.total_amount - COALESCE(p.paid, 0) AS balance_due, b.due_date, b.payment_status,
            CASE WHEN b.due_date < CURRENT_DATE AND b.payment_status != 'paid' THEN CURRENT_DATE - b.due_date ELSE 0 END AS days_overdue
     FROM bills b JOIN customers c ON b.customer_id = c.customer_id JOIN districts d ON c.district_id = d.district_id
     LEFT JOIN (SELECT bill_id, SUM(amount) AS paid FROM payments WHERE status = 'completed' GROUP BY bill_id) p ON b.bill_id = p.bill_id
     WHERE b.payment_status != 'paid' ORDER BY days_overdue DESC`
  ];

  for (let i = 0; i < views.length; i++) {
    try {
      await pool.query(views[i]);
    } catch (err) {
      console.warn(`[Neon] View ${i+1} skip:`, err.message);
    }
  }

  // ─── INDEXES ───
  const indexes = [
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_account ON customers(account_number)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_district ON customers(district_id)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bills_customer ON bills(customer_id)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bills_month ON bills(billing_month)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bills_status ON bills(payment_status)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_bill ON payments(bill_id)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_customer ON payments(customer_id)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meter_readings_customer ON meter_readings(customer_id)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_customer ON notifications(customer_id)'
  ];

  for (let i = 0; i < indexes.length; i++) {
    try {
      await pool.query(indexes[i]);
    } catch (err) {
      console.warn(`[Neon] Index ${i+1} skip:`, err.message);
    }
  }

  console.log('[Neon PostgreSQL] Schema initialization complete!');
}

// Seed Lesotho districts
async function seedDistricts() {
  const districts = [
    { name: 'Maseru', region: 'Lowlands' },
    { name: 'Berea', region: 'Lowlands' },
    { name: 'Leribe', region: 'Lowlands' },
    { name: 'Butha-Buthe', region: 'Highlands' },
    { name: 'Mokhotlong', region: 'Highlands' },
    { name: 'Thaba-Tseka', region: 'Highlands' },
    { name: 'Qacha\'s Nek', region: 'Highlands' },
    { name: 'Quthing', region: 'Lowlands' },
    { name: 'Mohale\'s Hoek', region: 'Lowlands' },
    { name: 'Mafeteng', region: 'Lowlands' }
  ];

  for (const d of districts) {
    await pool.query(
      `INSERT INTO districts (district_name, region) VALUES (\$1, \$2)
       ON CONFLICT (district_name) DO NOTHING`,
      [d.name, d.region]
    );
  }
  console.log('[Neon PostgreSQL] Districts seeded');
}

// Seed billing rates
async function seedBillingRates() {
  const rates = [
    // Residential tiered rates (Maloti per kilolitre)
    { name: 'Residential Tier 1', type: 'residential', tier: 1, min: 0, max: 5, cost: 5.50, fixed: 25.00, sewerage: 0.40 },
    { name: 'Residential Tier 2', type: 'residential', tier: 2, min: 5.01, max: 20, cost: 9.75, fixed: 25.00, sewerage: 0.40 },
    { name: 'Residential Tier 3', type: 'residential', tier: 3, min: 20.01, max: 50, cost: 15.20, fixed: 25.00, sewerage: 0.40 },
    { name: 'Residential Tier 4', type: 'residential', tier: 4, min: 50.01, max: null, cost: 22.50, fixed: 25.00, sewerage: 0.40 },
    // Commercial rates
    { name: 'Commercial Tier 1', type: 'commercial', tier: 1, min: 0, max: 50, cost: 18.00, fixed: 75.00, sewerage: 0.50 },
    { name: 'Commercial Tier 2', type: 'commercial', tier: 2, min: 50.01, max: null, cost: 25.00, fixed: 75.00, sewerage: 0.50 },
    // Industrial rates
    { name: 'Industrial Tier 1', type: 'industrial', tier: 1, min: 0, max: 100, cost: 14.50, fixed: 150.00, sewerage: 0.55 },
    { name: 'Industrial Tier 2', type: 'industrial', tier: 2, min: 100.01, max: null, cost: 20.00, fixed: 150.00, sewerage: 0.55 },
    // Government rates
    { name: 'Government Flat', type: 'government', tier: 1, min: 0, max: null, cost: 12.00, fixed: 50.00, sewerage: 0.45 },
  ];

  for (const r of rates) {
    await pool.query(
      `INSERT INTO billing_rates (rate_name, property_type, tier_level, min_usage, max_usage, cost_per_unit, fixed_charge, sewerage_rate, effective_from)
       VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, '2024-01-01')
       ON CONFLICT (property_type, tier_level, effective_from) DO NOTHING`,
      [r.name, r.type, r.tier, r.min, r.max, r.cost, r.fixed, r.sewerage]
    );
  }
  console.log('[Neon PostgreSQL] Billing rates seeded');
}

module.exports = {
  pool,
  initializeDatabase,
  seedDistricts,
  seedBillingRates
};
