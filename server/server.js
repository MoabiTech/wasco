const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

const { initializeDatabase, seedDistricts, seedBillingRates, pool } = require('./db/neon');
const DualDatabase = require('./db/sync');
const { writeToFirebase } = require('./db/firebase');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Serve static files
app.use(express.static(path.join(__dirname, '../client')));

// ─── API Routes ───
app.use('/api/auth', require('./routes/auth'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const pgResult = await pool.query('SELECT NOW() AS server_time');
    res.json({
      status: 'healthy',
      postgresql: 'connected',
      firebase: 'connected',
      server_time: pgResult.rows[0].server_time,
      database_type: 'Heterogeneous Distributed (PostgreSQL + Firebase Realtime DB)'
    });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ─── Scheduled Tasks ───

// Check for overdue bills daily at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('[CRON] Checking for overdue bills...');
    const result = await pool.query(
      `UPDATE bills SET payment_status = 'overdue', updated_at = CURRENT_TIMESTAMP
       WHERE payment_status = 'unpaid' AND due_date < CURRENT_DATE
       RETURNING bill_id, customer_id, bill_number, total_amount`
    );

    for (const bill of result.rows) {
      await DualDatabase.createNotification({
        customer_id: bill.customer_id,
        notification_type: 'overdue',
        title: 'Overdue Bill Notice',
        message: `Your bill ${bill.bill_number} of M${bill.total_amount} is overdue. Please make payment immediately to avoid disconnection.`,
        sent_via: 'app'
      });
    }
    console.log(`[CRON] ${result.rows.length} bills marked as overdue`);
  } catch (error) {
    console.error('[CRON] Overdue check error:', error);
  }
});

// ─── Initialize and Start ───
async function startServer() {
  try {
    // Initialize PostgreSQL tables
    await initializeDatabase();
    await seedDistricts();
    await seedBillingRates();

    // Seed default admin user
    const bcrypt = require('bcryptjs');
    const adminExists = await pool.query("SELECT user_id FROM users WHERE username = 'admin'");
    if (adminExists.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 12);
      const userResult = await pool.query(
        `INSERT INTO users (username, email, password_hash, role) 
         VALUES ('admin', 'admin@wasco.co.ls', \$1, 'admin')
         RETURNING user_id, username, email, role, branch_id, created_at`,
        [hash]
      );
      const user = userResult.rows[0];

      // Sync to Firebase as required
      await writeToFirebase('users', `user_${user.user_id}`, {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role,
        branch_id: user.branch_id,
        is_active: true,
        created_at: user.created_at
      });

      console.log('[Server] Default admin user created (admin/admin123) and synced to Firebase');
    }

    // Seed default branch manager
    const managerExists = await pool.query("SELECT user_id FROM users WHERE username = 'manager'");
    if (managerExists.rows.length === 0) {
      const hash = await bcrypt.hash('manager123', 12);
      const userResult = await pool.query(
        `INSERT INTO users (username, email, password_hash, role) 
         VALUES ('manager', 'manager@wasco.co.ls', \$1, 'branch_manager')
         RETURNING user_id, username, email, role, branch_id, created_at`,
        [hash]
      );
      const user = userResult.rows[0];

      // Sync to Firebase as required
      await writeToFirebase('users', `user_${user.user_id}`, {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role,
        branch_id: user.branch_id,
        is_active: true,
        created_at: user.created_at
      });

      console.log('[Server] Default branch manager created (manager/manager123) and synced to Firebase');
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  WASCO Water Billing System`);
      console.log(`  Running on http://localhost:${PORT}`);
      console.log(`  PostgreSQL: Neon (Connected)`);
      console.log(`  Firebase: Realtime DB (Connected)`);
      console.log(`  Mode: ${process.env.NODE_ENV || 'development'}`);
      console.log(`========================================\n`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

startServer();
