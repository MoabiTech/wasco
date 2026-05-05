/* ═══════════════════════════════════════════════════════
   WASCO Water Billing System - Main Application JS
   ═══════════════════════════════════════════════════════ */

// ─── Firebase Client Config ───
const firebaseConfig = {
  apiKey: "AIzaSyDAmXYsD30iL-FdEJMFjy91dG0VsoZXBWs",
  authDomain: "waterbill-8df52.firebaseapp.com",
  databaseURL: "https://waterbill-8df52-default-rtdb.firebaseio.com",
  projectId: "waterbill-8df52",
  storageBucket: "waterbill-8df52.firebasestorage.app",
  messagingSenderId: "966249811511",
  appId: "1:966249811511:web:43ec3a16839e71d08cb9b2",
  measurementId: "G-VD8TXQK8P1"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const firebaseDB = firebase.database();

// ─── API Base URL ───
const API_BASE = '/api';

// ─── State ───
let currentUser = null;
let currentToken = null;

// ─── Initialize App ───
document.addEventListener('DOMContentLoaded', () => {
  // Check for saved session
  const savedToken = localStorage.getItem('wasco_token');
  const savedUser = localStorage.getItem('wasco_user');
  
  if (savedToken && savedUser) {
    currentToken = savedToken;
    currentUser = JSON.parse(savedUser);
    updateUIForAuth();
  }

  // Setup navigation
  setupNavigation();
  
  // Setup tabs
  setupTabs();

  // Setup payment method toggle
  document.getElementById('payMethod')?.addEventListener('change', (e) => {
    document.getElementById('cardFields').style.display = 
      e.target.value === 'online' ? 'block' : 'none';
  });

  // Load initial data
  loadPublicStats();

  // Listen to Firebase for real-time updates
  setupFirebaseListeners();
});

// ─── API Helper ───
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// ─── Navigation ───
function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      navigateTo(page);
    });
  });
}

function navigateTo(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  
  // Show target page
  const targetPage = document.getElementById(`page-${page}`);
  if (targetPage) {
    targetPage.classList.add('active');
  }

  // Update nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.nav-link[data-page="${page}"]`)?.classList.add('active');

  // Load page data
  loadPageData(page);

  // Close mobile nav
  document.querySelector('.nav-links')?.classList.remove('active');
}

function toggleNav() {
  document.querySelector('.nav-links')?.classList.toggle('active');
}

function loadPageData(page) {
  switch(page) {
    case 'services': loadServices(); break;
    case 'rates': loadRates(); break;
    case 'dashboard': loadDashboard(); break;
    case 'bills': loadMyBills(); break;
    case 'payments': loadPaymentHistory(); break;
    case 'admin': loadAdminPanel(); break;
    case 'manager': loadManagerReports(); break;
  }
}

// ─── Tabs ───
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabGroup = btn.closest('.admin-tabs, .report-tabs');
      tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const tab = btn.dataset.tab;
      if (tab.startsWith('admin-')) loadAdminTab(tab);
      else if (tab.startsWith('report-')) loadReportTab(tab);
    });
  });
}

// ─── Auth Functions ───
async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errorDiv = document.getElementById('loginError');
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
  errorDiv.style.display = 'none';

  try {
    const data = await apiCall('/auth/login', 'POST', {
      username: document.getElementById('loginUsername').value,
      password: document.getElementById('loginPassword').value
    });

    currentToken = data.token;
    currentUser = data.user;
    
    localStorage.setItem('wasco_token', currentToken);
    localStorage.setItem('wasco_user', JSON.stringify(currentUser));

    closeModal('loginModal');
    updateUIForAuth();
    showToast('Login successful! Welcome back.', 'success');
    navigateTo('dashboard');
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('registerBtn');
  const errorDiv = document.getElementById('registerError');
  
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;

  if (password !== confirmPassword) {
    errorDiv.textContent = 'Passwords do not match';
    errorDiv.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...';
  errorDiv.style.display = 'none';

  try {
    const data = await apiCall('/auth/register', 'POST', {
      username: document.getElementById('regUsername').value,
      email: document.getElementById('regEmail').value,
      password: password
    });

    currentToken = data.token;
    currentUser = data.user;
    
    localStorage.setItem('wasco_token', currentToken);
    localStorage.setItem('wasco_user', JSON.stringify(currentUser));

    closeModal('registerModal');
    updateUIForAuth();
    showToast('Account created successfully!', 'success');
    navigateTo('dashboard');
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
  }
}

function logout() {
  currentUser = null;
  currentToken = null;
  localStorage.removeItem('wasco_token');
  localStorage.removeItem('wasco_user');
  updateUIForAuth();
  navigateTo('home');
  showToast('Logged out successfully', 'success');
}

function updateUIForAuth() {
  const isLoggedIn = !!currentUser;
  
  // Toggle visibility
  document.querySelectorAll('.guest-only').forEach(el => {
    el.style.display = isLoggedIn ? 'none' : 'flex';
  });
  document.querySelectorAll('.auth-only').forEach(el => {
    el.style.display = isLoggedIn ? 'flex' : 'none';
  });

  if (isLoggedIn) {
    document.getElementById('userDisplayName').textContent = currentUser.username;
    
    // Role-based visibility
    const isAdmin = currentUser.role === 'admin';
    const isManager = currentUser.role === 'branch_manager';
    const isCustomer = currentUser.role === 'customer';

    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = isAdmin ? 'flex' : 'none';
    });
    document.querySelectorAll('.manager-only').forEach(el => {
      el.style.display = (isManager || isAdmin) ? 'flex' : 'none';
    });
    document.querySelectorAll('.customer-only').forEach(el => {
      el.style.display = isCustomer ? 'flex' : 'none';
    });
  }
}

// ─── Modal Functions ───
function showModal(modalId) {
  document.getElementById(modalId)?.classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove('active');
}

// ─── Toast Notifications ───
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
  
  toast.innerHTML = `
    <i class="fas fa-${icons[type] || icons.info}"></i>
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─── Public Data Loading ───
async function loadPublicStats() {
  try {
    const health = await apiCall('/health');
    if (health.status === 'healthy') {
      document.querySelector('.status-dot').className = 'status-dot green';
    }
  } catch (e) {
    console.log('Health check failed');
  }
}

async function loadServices() {
  const container = document.getElementById('servicesContainer');
  try {
    const data = await apiCall('/admin/services');
    
    const serviceIcons = {
      'Water Supply': 'fa-tint',
      'Sewerage Services': 'fa-water',
      'Water Quality Testing': 'fa-flask',
      'New Connection Applications': 'fa-plug',
      'Meter Installation & Maintenance': 'fa-tachometer-alt',
      'Leak Detection & Repair': 'fa-tools'
    };

    container.innerHTML = `
      <div class="card" style="margin-bottom:2rem; text-align:center;">
        <h2 style="color:var(--primary); margin-bottom:0.5rem;">${data.company}</h2>
        <p style="color:var(--gray-500);">Serving all districts of ${data.country}</p>
      </div>
      <div class="services-grid">
        ${data.services.map(service => `
          <div class="service-card">
            <h3><i class="fas ${serviceIcons[service] || 'fa-check-circle'}" style="color:var(--primary);margin-right:0.5rem;"></i>${service}</h3>
            <p>Available across all WASCO service areas in Lesotho.</p>
          </div>
        `).join('')}
      </div>
      <div class="card" style="margin-top:2rem;">
        <h3 style="margin-bottom:1rem;"><i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> Service Areas</h3>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:0.75rem;">
          ${data.service_areas.map(d => `
            <div style="padding:0.75rem; background:var(--gray-50); border-radius:var(--radius); display:flex; justify-content:space-between;">
              <span style="font-weight:500;">${d.district_name}</span>
              <span class="badge badge-active">${d.region}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = `<div class="error-message">Failed to load services: ${error.message}</div>`;
  }
}

async function loadRates() {
  const container = document.getElementById('ratesContainer');
  try {
    const data = await apiCall('/billing/rates');
    
    // Group by property type
    const grouped = {};
    data.rates.forEach(rate => {
      if (!grouped[rate.property_type]) grouped[rate.property_type] = [];
      grouped[rate.property_type].push(rate);
    });

    const typeIcons = {
      residential: 'fa-home',
      commercial: 'fa-building',
      industrial: 'fa-industry',
      government: 'fa-landmark'
    };

    container.innerHTML = Object.entries(grouped).map(([type, rates]) => `
      <div class="rate-group card">
        <h3><i class="fas ${typeIcons[type] || 'fa-tag'}"></i> ${type.charAt(0).toUpperCase() + type.slice(1)} Rates</h3>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Usage Range (kL)</th>
                <th>Cost per kL (Maloti)</th>
                <th>Fixed Charge</th>
                <th>Sewerage Rate</th>
              </tr>
            </thead>
            <tbody>
              ${rates.map(r => `
                <tr>
                  <td>Tier ${r.tier_level}</td>
                  <td>${r.min_usage} - ${r.max_usage || '∞'} kL</td>
                  <td><strong>M ${parseFloat(r.cost_per_unit).toFixed(2)}</strong></td>
                  <td>M ${parseFloat(r.fixed_charge).toFixed(2)}</td>
                  <td>${(parseFloat(r.sewerage_rate) * 100).toFixed(0)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('');

    container.innerHTML += `
      <div class="card" style="background:var(--primary-light); border:1px solid var(--primary);">
        <p style="color:var(--primary-dark); font-size:0.9rem;">
          <i class="fas fa-info-circle"></i> 
          <strong>Note:</strong> All prices are in Lesotho Maloti (M). 
          VAT of 15% is applied to the subtotal. Bills include water charges, sewerage charges, and fixed monthly charges.
          Rates are effective from January 2024.
        </p>
      </div>
    `;
  } catch (error) {
    container.innerHTML = `<div class="error-message">Failed to load rates: ${error.message}</div>`;
  }
}

// ─── Dashboard ───
async function loadDashboard() {
  const content = document.getElementById('dashboardContent');
  document.getElementById('dashboardUserName').textContent = currentUser?.username || '';

  if (currentUser?.role === 'customer') {
    await loadCustomerDashboard(content);
  } else if (currentUser?.role === 'admin' || currentUser?.role === 'branch_manager') {
    await loadAdminDashboard(content);
  } else {
    content.innerHTML = `<div class="container"><div class="card"><p>Welcome to WASCO. Your role: ${currentUser?.role}</p></div></div>`;
  }
}

async function loadCustomerDashboard(content) {
  try {
    const profile = await apiCall('/auth/profile');
    const user = profile.user;

    if (!user.account_number) {
      content.innerHTML = `
        <div class="container">
          <div class="card">
            <h3><i class="fas fa-info-circle" style="color:var(--info);"></i> Account Not Linked</h3>
            <p style="margin-top:0.5rem;">Your user account is not yet linked to a WASCO customer account. 
            Please contact your nearest WASCO branch to link your account.</p>
          </div>
          <div class="card">
            <h3><i class="fas fa-exclamation-triangle" style="color:var(--warning);"></i> Report a Leak</h3>
            <form onsubmit="submitLeakReport(event)">
              <div class="form-group">
                <label>District</label>
                <select id="leakDistrict" required></select>
              </div>
              <div class="form-group">
                <label>Location Description</label>
                <textarea id="leakLocation" required placeholder="Describe the location of the leak"></textarea>
              </div>
              <div class="form-group">
                <label>Severity</label>
                <select id="leakSeverity">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Submit Report</button>
            </form>
          </div>
        </div>
      `;
      loadDistrictsDropdown('leakDistrict');
      return;
    }

    // Get bills
    const billsData = await apiCall(`/customers/${user.account_number}/bills`);
    const bills = billsData.bills || [];
    
    // Get payments
    const paymentsData = await apiCall(`/payments/history/${user.account_number}`);
    
    const latestBill = bills[0];
    const totalOutstanding = bills.filter(b => b.payment_status !== 'paid')
      .reduce((sum, b) => sum + parseFloat(b.balance_due || b.total_amount), 0);

    content.innerHTML = `
      <div class="container">
        <div class="summary-cards">
          <div class="summary-card">
            <h4>Account Number</h4>
            <div class="value" style="font-size:1.1rem;">${user.account_number}</div>
            <div class="sub-value">${user.first_name} ${user.last_name}</div>
          </div>
          <div class="summary-card green">
            <h4>Property Type</h4>
            <div class="value" style="font-size:1.1rem;">${(user.property_type || 'N/A').toUpperCase()}</div>
            <div class="sub-value">${user.district_name || 'N/A'}</div>
          </div>
          <div class="summary-card ${totalOutstanding > 0 ? 'red' : 'green'}">
            <h4>Outstanding Balance</h4>
            <div class="value">M ${totalOutstanding.toFixed(2)}</div>
            <div class="sub-value">${bills.filter(b => b.payment_status !== 'paid').length} unpaid bills</div>
          </div>
          <div class="summary-card blue">
            <h4>Latest Bill</h4>
            <div class="value">${latestBill ? `M ${parseFloat(latestBill.total_amount).toFixed(2)}` : 'N/A'}</div>
            <div class="sub-value">${latestBill ? latestBill.billing_month : 'No bills yet'}</div>
          </div>
        </div>

        ${latestBill ? `
        <div class="bill-card">
          <div class="bill-header">
            <div>
              <strong>${latestBill.bill_number}</strong>
              <span style="color:var(--gray-500); margin-left:0.5rem;">${latestBill.billing_month}</span>
            </div>
            <span class="badge badge-${latestBill.payment_status}">${latestBill.payment_status.toUpperCase()}</span>
          </div>
          <div class="bill-body">
            <div class="bill-detail-row"><span>Water Consumption</span><span>${parseFloat(latestBill.consumption).toFixed(2)} kL</span></div>
            <div class="bill-detail-row"><span>Water Charges</span><span>M ${parseFloat(latestBill.water_charge).toFixed(2)}</span></div>
            <div class="bill-detail-row"><span>Sewerage Charges</span><span>M ${parseFloat(latestBill.sewerage_charge).toFixed(2)}</span></div>
            <div class="bill-detail-row"><span>Fixed Charge</span><span>M ${parseFloat(latestBill.fixed_charge).toFixed(2)}</span></div>
            <div class="bill-detail-row"><span>VAT (15%)</span><span>M ${parseFloat(latestBill.vat_amount).toFixed(2)}</span></div>
            ${parseFloat(latestBill.arrears) > 0 ? `<div class="bill-detail-row" style="color:var(--danger);"><span>Arrears</span><span>M ${parseFloat(latestBill.arrears).toFixed(2)}</span></div>` : ''}
            <div class="bill-detail-row total"><span>Total Amount Due</span><span>M ${parseFloat(latestBill.total_amount).toFixed(2)}</span></div>
            <div class="bill-detail-row"><span>Due Date</span><span>${new Date(latestBill.due_date).toLocaleDateString()}</span></div>
          </div>
          ${latestBill.payment_status !== 'paid' ? `
          <div class="bill-actions">
            <button class="btn btn-primary" onclick="openPaymentModal(${latestBill.bill_id}, '${latestBill.bill_number}', ${latestBill.total_amount}, ${parseFloat(latestBill.balance_due || latestBill.total_amount)})">
              <i class="fas fa-credit-card"></i> Pay Now
            </button>
          </div>
          ` : ''}
        </div>
        ` : '<div class="card"><p>No bills generated yet.</p></div>'}

        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-history"></i> Recent Payments</h3>
          </div>
          ${paymentsData.payments && paymentsData.payments.length > 0 ? `
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Reference</th><th>Amount</th><th>Method</th><th>Date</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${paymentsData.payments.slice(0, 5).map(p => `
                  <tr>
                    <td>${p.payment_reference}</td>
                    <td><strong>M ${parseFloat(p.amount).toFixed(2)}</strong></td>
                    <td>${p.payment_method.replace('_', ' ')}</td>
                    <td>${new Date(p.payment_date).toLocaleDateString()}</td>
                    <td><span class="badge badge-${p.status}">${p.status}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : '<p style="color:var(--gray-500);">No payment history yet.</p>'}
        </div>

        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-exclamation-triangle" style="color:var(--warning);"></i> Report Water Leak</h3>
          </div>
          <form onsubmit="submitLeakReport(event)">
            <div class="form-row">
              <div class="form-group">
                <label>District</label>
                <select id="leakDistrict" required></select>
              </div>
              <div class="form-group">
                <label>Severity</label>
                <select id="leakSeverity">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Location Description</label>
              <textarea id="leakLocation" required placeholder="Describe where the leak is located"></textarea>
            </div>
            <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Submit Report</button>
          </form>
        </div>
      </div>
    `;

    loadDistrictsDropdown('leakDistrict');
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">Failed to load dashboard: ${error.message}</div></div>`;
  }
}

async function loadAdminDashboard(content) {
  try {
    const data = await apiCall('/reports/dashboard');

    content.innerHTML = `
      <div class="container">
        <div class="summary-cards">
          <div class="summary-card">
            <h4>Total Customers</h4>
            <div class="value">${data.customers.total}</div>
            <div class="sub-value">${data.customers.active} active</div>
          </div>
          <div class="summary-card green">
            <h4>Total Collected</h4>
            <div class="value">M ${parseFloat(data.revenue.total_collected).toLocaleString()}</div>
            <div class="sub-value">of M ${parseFloat(data.revenue.total_billed).toLocaleString()} billed</div>
          </div>
          <div class="summary-card red">
            <h4>Outstanding</h4>
            <div class="value">M ${parseFloat(data.revenue.total_outstanding).toLocaleString()}</div>
            <div class="sub-value">${data.revenue.overdue_bills} overdue bills</div>
          </div>
          <div class="summary-card blue">
            <h4>This Month</h4>
            <div class="value">M ${parseFloat(data.monthly.monthly_billed).toLocaleString()}</div>
            <div class="sub-value">${data.monthly.bills_generated} bills, ${parseFloat(data.monthly.total_consumption).toFixed(0)} kL total</div>
          </div>
        </div>

        <div class="card-grid">
          <div class="card">
            <div class="card-header">
              <h3><i class="fas fa-credit-card"></i> Recent Payments</h3>
            </div>
            ${data.recent_payments.length > 0 ? `
            <div class="table-container">
              <table>
                <thead><tr><th>Reference</th><th>Customer</th><th>Amount</th><th>Method</th><th>Date</th></tr></thead>
                <tbody>
                  ${data.recent_payments.map(p => `
                    <tr>
                      <td style="font-size:0.8rem;">${p.payment_reference}</td>
                      <td>${p.first_name} ${p.last_name}</td>
                      <td><strong>M ${parseFloat(p.amount).toFixed(2)}</strong></td>
                      <td>${p.payment_method.replace('_', ' ')}</td>
                      <td>${new Date(p.payment_date).toLocaleDateString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ` : '<p>No recent payments</p>'}
          </div>

          <div class="card">
            <div class="card-header">
              <h3><i class="fas fa-tools"></i> Leak Reports</h3>
            </div>
            <div class="summary-cards" style="margin-bottom:0;">
              <div class="summary-card orange">
                <h4>Pending</h4>
                <div class="value">${data.leak_reports.pending}</div>
              </div>
              <div class="summary-card blue">
                <h4>Investigating</h4>
                <div class="value">${data.leak_reports.investigating}</div>
              </div>
              <div class="summary-card green">
                <h4>Resolved</h4>
                <div class="value">${data.leak_reports.resolved}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="text-align:center; background:var(--primary-light); border:1px solid var(--primary);">
          <p style="color:var(--primary-dark);">
            <i class="fas fa-database"></i> 
            <strong>Distributed Database Status:</strong> 
            PostgreSQL (Neon Cloud) <span class="status-dot green" style="margin:0 4px;"></span> Active | 
            Firebase Realtime DB <span class="status-dot green" style="margin:0 4px;"></span> Active | 
            Sync: Real-time bidirectional
          </p>
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">Failed to load dashboard: ${error.message}</div></div>`;
  }
}

// ─── My Bills ───
async function loadMyBills() {
  const content = document.getElementById('billsContent');
  try {
    const profile = await apiCall('/auth/profile');
    if (!profile.user.account_number) {
      content.innerHTML = '<div class="container"><div class="card"><p>No customer account linked.</p></div></div>';
      return;
    }

    const data = await apiCall(`/customers/${profile.user.account_number}/bills`);
    
    content.innerHTML = `
      <div class="container">
        ${data.bills.length > 0 ? data.bills.map(bill => `
          <div class="bill-card">
            <div class="bill-header">
              <div>
                <strong>${bill.bill_number}</strong>
                <span style="color:var(--gray-500); margin-left:0.75rem;">${bill.billing_month}</span>
              </div>
              <span class="badge badge-${bill.payment_status}">${bill.payment_status.toUpperCase()}</span>
            </div>
            <div class="bill-body">
              <div class="bill-detail-row"><span>Consumption</span><span>${parseFloat(bill.consumption).toFixed(2)} kL</span></div>
              <div class="bill-detail-row"><span>Water Charges</span><span>M ${parseFloat(bill.water_charge).toFixed(2)}</span></div>
              <div class="bill-detail-row"><span>Sewerage Charges</span><span>M ${parseFloat(bill.sewerage_charge).toFixed(2)}</span></div>
              <div class="bill-detail-row"><span>Fixed Charge</span><span>M ${parseFloat(bill.fixed_charge).toFixed(2)}</span></div>
              <div class="bill-detail-row"><span>VAT (15%)</span><span>M ${parseFloat(bill.vat_amount).toFixed(2)}</span></div>
              ${parseFloat(bill.arrears) > 0 ? `<div class="bill-detail-row" style="color:var(--danger);"><span>Arrears</span><span>M ${parseFloat(bill.arrears).toFixed(2)}</span></div>` : ''}
              <div class="bill-detail-row total"><span>Total</span><span>M ${parseFloat(bill.total_amount).toFixed(2)}</span></div>
              <div class="bill-detail-row"><span>Paid</span><span>M ${parseFloat(bill.amount_paid || 0).toFixed(2)}</span></div>
              <div class="bill-detail-row" style="color:${parseFloat(bill.balance_due) > 0 ? 'var(--danger)' : 'var(--success)'};">
                <span>Balance Due</span><span>M ${parseFloat(bill.balance_due || 0).toFixed(2)}</span>
              </div>
              <div class="bill-detail-row"><span>Due Date</span><span>${new Date(bill.due_date).toLocaleDateString()}</span></div>
            </div>
            ${bill.payment_status !== 'paid' ? `
            <div class="bill-actions">
              <button class="btn btn-primary" onclick="openPaymentModal(${bill.bill_id}, '${bill.bill_number}', ${bill.total_amount}, ${parseFloat(bill.balance_due || bill.total_amount)})">
                <i class="fas fa-credit-card"></i> Pay Now
              </button>
            </div>
            ` : ''}
          </div>
        `).join('') : '<div class="card"><p>No bills found.</p></div>'}
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">Failed to load bills: ${error.message}</div></div>`;
  }
}

// ─── Payment Functions ───
function openPaymentModal(billId, billNumber, totalAmount, balanceDue) {
  document.getElementById('payBillId').value = billId;
  document.getElementById('payAmount').value = balanceDue.toFixed(2);
  document.getElementById('payAmount').max = balanceDue.toFixed(2);
  
  document.getElementById('paymentDetails').innerHTML = `
    <p><strong>Bill:</strong> ${billNumber}</p>
    <p><strong>Total Amount:</strong> M ${parseFloat(totalAmount).toFixed(2)}</p>
    <p><strong>Balance Due:</strong> M ${balanceDue.toFixed(2)}</p>
  `;
  
  showModal('paymentModal');
}

async function handlePayment(e) {
  e.preventDefault();
  const btn = document.getElementById('payBtn');
  const errorDiv = document.getElementById('paymentError');
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
  errorDiv.style.display = 'none';

  try {
    const paymentMethod = document.getElementById('payMethod').value;
    
    let endpoint = '/payments';
    let body = {
      bill_id: parseInt(document.getElementById('payBillId').value),
      amount: parseFloat(document.getElementById('payAmount').value),
      payment_method: paymentMethod,
      notes: document.getElementById('payNotes').value
    };

    // If online payment, use gateway
    if (paymentMethod === 'online') {
      endpoint = '/payments/gateway/process';
      body.card_number = document.getElementById('cardNumber').value;
      body.expiry = document.getElementById('cardExpiry').value;
      body.cvv = document.getElementById('cardCvv').value;
    }

    const data = await apiCall(endpoint, 'POST', body);

    closeModal('paymentModal');
    showToast(`Payment of M ${body.amount.toFixed(2)} processed successfully! Ref: ${data.payment.payment_reference}`, 'success');
    
    // Reload current page
    if (document.getElementById('page-bills').classList.contains('active')) {
      loadMyBills();
    } else {
      loadDashboard();
    }
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Process Payment';
  }
}

async function loadPaymentHistory() {
  const content = document.getElementById('paymentsContent');
  try {
    const data = await apiCall('/payments');
    
    content.innerHTML = `
      <div class="container">
        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-history"></i> Payment History</h3>
          </div>
          ${data.payments.length > 0 ? `
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Bill</th>
                  <th>Month</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${data.payments.map(p => `
                  <tr>
                    <td style="font-size:0.8rem;">${p.payment_reference}</td>
                    <td>${p.bill_number}</td>
                    <td>${p.billing_month}</td>
                    <td><strong>M ${parseFloat(p.amount).toFixed(2)}</strong></td>
                    <td>${p.payment_method.replace('_', ' ')}</td>
                    <td>${new Date(p.payment_date).toLocaleDateString()}</td>
                    <td><span class="badge badge-${p.status}">${p.status}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : '<p style="color:var(--gray-500);">No payment history found.</p>'}
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">${error.message}</div></div>`;
  }
}

// ─── Admin Panel ───
async function loadAdminPanel() {
  loadAdminTab('admin-customers');
}

async function loadAdminTab(tab) {
  const content = document.getElementById('adminContent');
  content.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

  switch(tab) {
    case 'admin-customers':
      await loadAdminCustomers(content);
      break;
    case 'admin-billing':
      await loadAdminBilling(content);
      break;
    case 'admin-rates':
      await loadAdminRates(content);
      break;
    case 'admin-notifications':
      await loadAdminNotifications(content);
      break;
    case 'admin-users':
      await loadAdminUsers(content);
      break;
    case 'admin-sync':
      await loadAdminSync(content);
      break;
  }
}

async function loadAdminCustomers(content) {
  manageCustomers();
}

async function addCustomer(e) {
  e.preventDefault();
  try {
    const data = await apiCall('/customers', 'POST', {
      first_name: document.getElementById('custFirstName').value,
      last_name: document.getElementById('custLastName').value,
      id_number: document.getElementById('custIdNumber').value,
      phone: document.getElementById('custPhone').value,
      email: document.getElementById('custEmail').value,
      physical_address: document.getElementById('custAddress').value,
      district_id: parseInt(document.getElementById('custDistrict').value),
      property_type: document.getElementById('custPropertyType').value,
      meter_number: document.getElementById('custMeter').value
    });

    showToast(`Customer ${data.customer.account_number} created successfully!`, 'success');
    loadAdminTab('admin-customers');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadAdminBilling(content) {
  try {
    const districts = await apiCall('/admin/districts');

    content.innerHTML = `
      <div class="container">
        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-tachometer-alt"></i> Record Meter Reading</h3>
          </div>
          <form onsubmit="recordMeterReading(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Account Number *</label>
                <input type="text" id="mrAccount" required placeholder="WAS-XX-XXXXX">
              </div>
              <div class="form-group">
                <label>Reading Date</label>
                <input type="date" id="mrDate" value="${new Date().toISOString().split('T')[0]}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Current Meter Reading (kL) *</label>
                <input type="number" id="mrCurrent" required step="0.01" min="0">
              </div>
              <div class="form-group">
                <label>Reading Type</label>
                <select id="mrType">
                  <option value="actual">Actual Reading</option>
                  <option value="estimated">Estimated</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea id="mrNotes" placeholder="Optional notes"></textarea>
            </div>
            <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Record Reading</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-file-invoice"></i> Generate Bill</h3>
          </div>
          <form onsubmit="generateBill(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Account Number *</label>
                <input type="text" id="gbAccount" required placeholder="WAS-XX-XXXXX">
              </div>
              <div class="form-group">
                <label>Billing Month *</label>
                <input type="month" id="gbMonth" required value="${new Date().toISOString().slice(0, 7)}">
              </div>
            </div>
            <button type="submit" class="btn btn-primary"><i class="fas fa-calculator"></i> Generate Bill</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-layer-group"></i> Bulk Bill Generation</h3>
          </div>
          <form onsubmit="generateBulkBills(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Billing Month *</label>
                <input type="month" id="bulkMonth" required value="${new Date().toISOString().slice(0, 7)}">
              </div>
              <div class="form-group">
                <label>District (Optional)</label>
                <select id="bulkDistrict">
                  <option value="">All Districts</option>
                  ${districts.districts.map(d => `<option value="${d.district_id}">${d.district_name}</option>`).join('')}
                </select>
              </div>
            </div>
            <button type="submit" class="btn btn-secondary"><i class="fas fa-cogs"></i> Generate All Bills</button>
          </form>
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">${error.message}</div></div>`;
  }
}

async function recordMeterReading(e) {
  e.preventDefault();
  try {
    const data = await apiCall('/billing/meter-reading', 'POST', {
      account_number: document.getElementById('mrAccount').value,
      reading_date: document.getElementById('mrDate').value,
      current_reading: parseFloat(document.getElementById('mrCurrent').value),
      reading_type: document.getElementById('mrType').value,
      notes: document.getElementById('mrNotes').value
    });
    showToast('Meter reading recorded successfully!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function generateBill(e) {
  e.preventDefault();
  try {
    const data = await apiCall('/billing/generate-bill', 'POST', {
      account_number: document.getElementById('gbAccount').value,
      billing_month: document.getElementById('gbMonth').value
    });
    showToast(`Bill ${data.bill.bill_number} generated! Total: M ${parseFloat(data.bill.total_amount).toFixed(2)}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function generateBulkBills(e) {
  e.preventDefault();
  try {
    const districtVal = document.getElementById('bulkDistrict').value;
    const body = { billing_month: document.getElementById('bulkMonth').value };
    if (districtVal) body.district_id = parseInt(districtVal);

    const data = await apiCall('/billing/generate-bulk', 'POST', body);
    showToast(`Bulk generation: ${data.results.success} bills generated, ${data.results.failed} failed`, 
              data.results.failed > 0 ? 'warning' : 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadAdminRates(content) {
  try {
    const data = await apiCall('/billing/rates');
    
    content.innerHTML = `
      <div class="container">
        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-plus-circle"></i> Add/Update Billing Rate</h3>
          </div>
          <form onsubmit="saveBillingRate(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Rate Name *</label>
                <input type="text" id="rateName" required placeholder="e.g., Residential Tier 1">
              </div>
              <div class="form-group">
                <label>Property Type *</label>
                <select id="rateType" required>
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="industrial">Industrial</option>
                  <option value="government">Government</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Tier Level *</label>
                <input type="number" id="rateTier" required min="1">
              </div>
              <div class="form-group">
                <label>Cost per kL (Maloti) *</label>
                <input type="number" id="rateCost" required step="0.01" min="0">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Min Usage (kL) *</label>
                <input type="number" id="rateMin" required step="0.01" min="0">
              </div>
              <div class="form-group">
                <label>Max Usage (kL)</label>
                <input type="number" id="rateMax" step="0.01" placeholder="Leave empty for unlimited">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Fixed Charge (Maloti)</label>
                <input type="number" id="rateFixed" step="0.01" value="0">
              </div>
              <div class="form-group">
                <label>Sewerage Rate (%)</label>
                <input type="number" id="rateSewerage" step="0.01" value="50" min="0" max="100">
              </div>
            </div>
            <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Save Rate</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-list"></i> Current Rates</h3>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Name</th><th>Type</th><th>Tier</th><th>Range (kL)</th><th>Cost/kL</th><th>Fixed</th><th>Sewerage</th></tr>
              </thead>
              <tbody>
                ${data.rates.map(r => `
                  <tr>
                    <td>${r.rate_name}</td>
                    <td>${r.property_type}</td>
                    <td>${r.tier_level}</td>
                    <td>${r.min_usage} - ${r.max_usage || '∞'}</td>
                    <td><strong>M ${parseFloat(r.cost_per_unit).toFixed(2)}</strong></td>
                    <td>M ${parseFloat(r.fixed_charge).toFixed(2)}</td>
                    <td>${(parseFloat(r.sewerage_rate) * 100).toFixed(0)}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">${error.message}</div></div>`;
  }
}

async function saveBillingRate(e) {
  e.preventDefault();
  try {
    const maxVal = document.getElementById('rateMax').value;
    await apiCall('/billing/rates', 'POST', {
      rate_name: document.getElementById('rateName').value,
      property_type: document.getElementById('rateType').value,
      tier_level: parseInt(document.getElementById('rateTier').value),
      min_usage: parseFloat(document.getElementById('rateMin').value),
      max_usage: maxVal ? parseFloat(maxVal) : null,
      cost_per_unit: parseFloat(document.getElementById('rateCost').value),
      fixed_charge: parseFloat(document.getElementById('rateFixed').value || 0),
      sewerage_rate: parseFloat(document.getElementById('rateSewerage').value || 50) / 100
    });
    showToast('Billing rate saved successfully!', 'success');
    loadAdminTab('admin-rates');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadAdminNotifications(content) {
  try {
    const districts = await apiCall('/admin/districts');
    
    content.innerHTML = `
      <div class="container">
        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-bullhorn"></i> Send Notification to Customers</h3>
          </div>
          <form onsubmit="sendBulkNotification(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Target District</label>
                <select id="notifDistrict">
                  <option value="">All Districts</option>
                  ${districts.districts.map(d => `<option value="${d.district_id}">${d.district_name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Notification Type</label>
                <select id="notifType">
                  <option value="service_update">Service Update</option>
                  <option value="payment_due">Payment Reminder</option>
                  <option value="disconnection_warning">Disconnection Warning</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Title *</label>
              <input type="text" id="notifTitle" required placeholder="Notification title">
            </div>
            <div class="form-group">
              <label>Message *</label>
              <textarea id="notifMessage" required placeholder="Notification message" rows="4"></textarea>
            </div>
            <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Send Notification</button>
          </form>
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">${error.message}</div></div>`;
  }
}

async function sendBulkNotification(e) {
  e.preventDefault();
  try {
    const districtVal = document.getElementById('notifDistrict').value;
    const body = {
      notification_type: document.getElementById('notifType').value,
      title: document.getElementById('notifTitle').value,
      message: document.getElementById('notifMessage').value
    };
    if (districtVal) body.district_id = parseInt(districtVal);

    const data = await apiCall('/admin/send-notifications', 'POST', body);
    showToast(data.message, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadAdminUsers(content) {
  try {
    const data = await apiCall('/admin/users');
    
    content.innerHTML = `
      <div class="container">
        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-user-cog"></i> System Users (${data.users.length})</h3>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>ID</th><th>Username</th><th>Email</th><th>Role</th><th>Active</th><th>Last Login</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${data.users.map(u => `
                  <tr>
                    <td>${u.user_id}</td>
                    <td><strong>${u.username}</strong></td>
                    <td>${u.email}</td>
                    <td><span class="badge badge-${u.role === 'admin' ? 'active' : 'pending'}">${u.role}</span></td>
                    <td>${u.is_active ? '<span class="status-dot green"></span> Yes' : '<span class="status-dot red"></span> No'}</td>
                    <td>${u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                    <td>
                      <select onchange="updateUserRole(${u.user_id}, this.value)" style="padding:0.25rem; border-radius:4px; border:1px solid var(--gray-300);">
                        <option value="" disabled selected>Change Role</option>
                        <option value="customer">Customer</option>
                        <option value="admin">Admin</option>
                        <option value="branch_manager">Manager</option>
                        <option value="technician">Technician</option>
                      </select>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">${error.message}</div></div>`;
  }
}

async function updateUserRole(userId, role) {
  try {
    await apiCall(`/admin/users/${userId}`, 'PUT', { role });
    showToast(`User role updated to ${role}`, 'success');
    loadAdminTab('admin-users');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadAdminSync(content) {
  content.innerHTML = `
    <div class="container">
      <div class="card" style="text-align:center;">
        <h3 style="margin-bottom:1rem;"><i class="fas fa-database" style="color:var(--primary);"></i> Heterogeneous Database Synchronization</h3>
        <div class="summary-cards">
          <div class="summary-card blue">
            <h4>Primary Database</h4>
            <div class="value" style="font-size:1rem;">PostgreSQL</div>
            <div class="sub-value">Neon Cloud (AWS)</div>
            <div class="db-status"><span class="status-dot green"></span> Connected</div>
          </div>
          <div class="summary-card orange">
            <h4>Secondary Database</h4>
            <div class="value" style="font-size:1rem;">Firebase RTDB</div>
            <div class="sub-value">Google Cloud</div>
            <div class="db-status"><span class="status-dot green"></span> Connected</div>
          </div>
        </div>
        <p style="color:var(--gray-600); margin:1rem 0;">
          Both databases are synchronized in real-time. Every write operation goes to both PostgreSQL and Firebase simultaneously.
          This ensures data redundancy and enables real-time client updates via Firebase.
        </p>
        <button class="btn btn-primary btn-lg" onclick="triggerFullSync()">
          <i class="fas fa-sync"></i> Trigger Full Sync
        </button>
        <div id="syncResult" style="margin-top:1rem;"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-sitemap"></i> Data Distribution Map</h3>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr><th>Data Entity</th><th>PostgreSQL (Neon)</th><th>Firebase RTDB</th><th>Sync Mode</th></tr>
            </thead>
            <tbody>
              <tr><td>Customers</td><td>Full (Primary)</td><td>Full (Replica)</td><td>Real-time</td></tr>
              <tr><td>Bills</td><td>Full (Primary)</td><td>Full (Replica)</td><td>Real-time</td></tr>
              <tr><td>Payments</td><td>Full (Primary)</td><td>Full (Replica)</td><td>Real-time</td></tr>
              <tr><td>Meter Readings</td><td>Full (Primary)</td><td>Full (Replica)</td><td>Real-time</td></tr>
              <tr><td>Billing Rates</td><td>Full (Primary)</td><td>Full (Replica)</td><td>On-change</td></tr>
              <tr><td>Notifications</td><td>Full (Primary)</td><td>Full (Replica)</td><td>Real-time</td></tr>
              <tr><td>Districts</td><td>Full (Primary)</td><td>Full (Replica)</td><td>On-demand</td></tr>
              <tr><td>Users (Auth)</td><td>Full (Credentials)</td><td>Partial (No passwords)</td><td>On-change</td></tr>
              <tr><td>Audit Log</td><td>Full</td><td>Not replicated</td><td>N/A</td></tr>
              <tr><td>Views/Reports</td><td>Computed (SQL Views)</td><td>Not applicable</td><td>N/A</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function triggerFullSync() {
  const resultDiv = document.getElementById('syncResult');
  resultDiv.innerHTML = '<p style="color:var(--info);"><i class="fas fa-spinner fa-spin"></i> Syncing databases...</p>';
  try {
    const data = await apiCall('/admin/sync-databases', 'POST');
    resultDiv.innerHTML = `<div class="success-message"><i class="fas fa-check-circle"></i> ${data.message}</div>`;
    showToast('Full database sync completed!', 'success');
  } catch (error) {
    resultDiv.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle"></i> ${error.message}</div>`;
  }
}

// ─── Manager Reports ───
async function loadManagerReports() {
  loadReportTab('report-overview');
}

async function loadReportTab(tab) {
  const content = document.getElementById('managerContent');
  content.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading reports...</div>';

  try {
    switch(tab) {
      case 'report-overview':
        const dashboard = await apiCall('/reports/dashboard');
        content.innerHTML = `
          <div class="container">
            <div class="summary-cards">
              <div class="summary-card">
                <h4>Total Customers</h4>
                <div class="value">${dashboard.customers.total}</div>
                <div class="sub-value">Active: ${dashboard.customers.active} | Suspended: ${dashboard.customers.suspended}</div>
              </div>
              <div class="summary-card green">
                <h4>Revenue Collected</h4>
                <div class="value">M ${parseFloat(dashboard.revenue.total_collected).toLocaleString()}</div>
                <div class="sub-value">of M ${parseFloat(dashboard.revenue.total_billed).toLocaleString()} billed</div>
              </div>
              <div class="summary-card red">
                <h4>Outstanding Amount</h4>
                <div class="value">M ${parseFloat(dashboard.revenue.total_outstanding).toLocaleString()}</div>
                <div class="sub-value">${dashboard.revenue.overdue_bills} overdue bills</div>
              </div>
              <div class="summary-card blue">
                <h4>Avg. Monthly Consumption</h4>
                <div class="value">${parseFloat(dashboard.monthly.avg_consumption).toFixed(1)} kL</div>
                <div class="sub-value">Total: ${parseFloat(dashboard.monthly.total_consumption).toFixed(0)} kL this month</div>
              </div>
            </div>
          </div>
        `;
        break;

      case 'report-usage':
        const usage = await apiCall('/reports/usage-patterns');
        content.innerHTML = `
          <div class="container">
            <div class="card">
              <div class="card-header">
                <h3><i class="fas fa-chart-line"></i> Water Usage Patterns</h3>
              </div>
              <div class="table-container">
                <table>
                  <thead>
                    <tr><th>Month</th><th>District</th><th>Property Type</th><th>Readings</th><th>Avg (kL)</th><th>Min (kL)</th><th>Max (kL)</th><th>Median (kL)</th></tr>
                  </thead>
                  <tbody>
                    ${usage.usage_patterns.map(u => `
                      <tr>
                        <td>${u.reading_month}</td>
                        <td>${u.district_name}</td>
                        <td>${u.property_type}</td>
                        <td>${u.readings_count}</td>
                        <td>${parseFloat(u.avg_consumption).toFixed(2)}</td>
                        <td>${parseFloat(u.min_consumption).toFixed(2)}</td>
                        <td>${parseFloat(u.max_consumption).toFixed(2)}</td>
                        <td>${parseFloat(u.median_consumption).toFixed(2)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              ${usage.usage_patterns.length === 0 ? '<p style="padding:1rem; color:var(--gray-500);">No usage data available yet.</p>' : ''}
            </div>
          </div>
        `;
        break;

      case 'report-revenue':
        const revenue = await apiCall('/reports/revenue');
        content.innerHTML = `
          <div class="container">
            <div class="card">
              <div class="card-header">
                <h3><i class="fas fa-money-bill-wave"></i> Revenue Report by District & Month</h3>
              </div>
              <div class="table-container">
                <table>
                  <thead>
                    <tr><th>Month</th><th>District</th><th>Bills</th><th>Consumption (kL)</th><th>Billed (M)</th><th>Collected (M)</th><th>Overdue</th></tr>
                  </thead>
                  <tbody>
                    ${revenue.revenue.map(r => `
                      <tr>
                        <td>${r.billing_month}</td>
                        <td>${r.district_name}</td>
                        <td>${r.bills_count}</td>
                        <td>${parseFloat(r.total_consumption).toFixed(0)}</td>
                        <td><strong>M ${parseFloat(r.total_billed).toLocaleString()}</strong></td>
                        <td style="color:var(--success);">M ${parseFloat(r.total_collected).toLocaleString()}</td>
                        <td><span class="badge badge-overdue">${r.overdue_count}</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              ${revenue.revenue.length === 0 ? '<p style="padding:1rem; color:var(--gray-500);">No revenue data available yet.</p>' : ''}
            </div>
          </div>
        `;
        break;

      case 'report-outstanding':
        const outstanding = await apiCall('/reports/outstanding');
        content.innerHTML = `
          <div class="container">
            <div class="summary-cards">
              <div class="summary-card red">
                <h4>Total Outstanding Bills</h4>
                <div class="value">${outstanding.summary.total_outstanding_bills}</div>
              </div>
              <div class="summary-card red">
                <h4>Total Outstanding Amount</h4>
                <div class="value">M ${parseFloat(outstanding.summary.total_outstanding_amount || 0).toLocaleString()}</div>
              </div>
              <div class="summary-card orange">
                <h4>Avg Days Overdue</h4>
                <div class="value">${parseFloat(outstanding.summary.avg_days_overdue || 0).toFixed(0)}</div>
              </div>
              <div class="summary-card orange">
                <h4>Max Days Overdue</h4>
                <div class="value">${outstanding.summary.max_days_overdue || 0}</div>
              </div>
            </div>
            <div class="card">
              <div class="card-header">
                <h3><i class="fas fa-exclamation-triangle"></i> Outstanding Balances</h3>
              </div>
              <div class="table-container">
                <table>
                  <thead>
                    <tr><th>Account</th><th>Customer</th><th>District</th><th>Bill</th><th>Month</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Days Overdue</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    ${outstanding.outstanding.map(o => `
                      <tr>
                        <td>${o.account_number}</td>
                        <td>${o.full_name}</td>
                        <td>${o.district_name}</td>
                        <td>${o.bill_number}</td>
                        <td>${o.billing_month}</td>
                        <td>M ${parseFloat(o.total_amount).toFixed(2)}</td>
                        <td>M ${parseFloat(o.amount_paid).toFixed(2)}</td>
                        <td><strong style="color:var(--danger);">M ${parseFloat(o.balance_due).toFixed(2)}</strong></td>
                        <td>${o.days_overdue}</td>
                        <td><span class="badge badge-${o.payment_status}">${o.payment_status}</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              ${outstanding.outstanding.length === 0 ? '<p style="padding:1rem; color:var(--gray-500);">No outstanding balances.</p>' : ''}
            </div>
          </div>
        `;
        break;

      case 'report-districts':
        const districts = await apiCall('/reports/district-summary');
        content.innerHTML = `
          <div class="container">
            <div class="card">
              <div class="card-header">
                <h3><i class="fas fa-map"></i> District-wise Summary</h3>
              </div>
              <div class="table-container">
                <table>
                  <thead>
                    <tr><th>District</th><th>Region</th><th>Customers</th><th>Active</th><th>Total Billed</th><th>Total Paid</th><th>Avg Consumption</th><th>Leak Reports</th></tr>
                  </thead>
                  <tbody>
                    ${districts.districts.map(d => `
                      <tr>
                        <td><strong>${d.district_name}</strong></td>
                        <td>${d.region}</td>
                        <td>${d.total_customers}</td>
                        <td>${d.active_customers}</td>
                        <td>M ${parseFloat(d.total_billed).toLocaleString()}</td>
                        <td style="color:var(--success);">M ${parseFloat(d.total_paid).toLocaleString()}</td>
                        <td>${parseFloat(d.avg_consumption).toFixed(1)} kL</td>
                        <td>${d.leak_reports > 0 ? `<span class="badge badge-overdue">${d.leak_reports}</span>` : '0'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
        break;
    }
  } catch (error) {
    content.innerHTML = `<div class="container"><div class="error-message">Failed to load report: ${error.message}</div></div>`;
  }
}

// ─── Helper Functions ───
async function loadDistrictsDropdown(selectId) {
  try {
    const data = await apiCall('/admin/districts');
    const select = document.getElementById(selectId);
    if (select) {
      select.innerHTML = '<option value="">Select District</option>' +
        data.districts.map(d => `<option value="${d.district_id}">${d.district_name}</option>`).join('');
    }
  } catch (error) {
    console.error('Failed to load districts:', error);
  }
}

async function submitLeakReport(e) {
  e.preventDefault();
  try {
    await apiCall('/notifications/leak-report', 'POST', {
      district_id: parseInt(document.getElementById('leakDistrict').value),
      location_description: document.getElementById('leakLocation').value,
      severity: document.getElementById('leakSeverity').value
    });
    showToast('Leak report submitted successfully! Our team will investigate.', 'success');
    document.getElementById('leakLocation').value = '';
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ─── Firebase Real-time Listeners ───
function setupFirebaseListeners() {
  // Listen for new notifications (real-time from Firebase)
  firebaseDB.ref('notifications').limitToLast(1).on('child_added', (snapshot) => {
    const notif = snapshot.val();
    if (notif && currentUser) {
      // Only show if relevant to current user
      if (notif._synced_at && Date.now() - new Date(notif._synced_at).getTime() < 30000) {
        // Notification was just created (within 30 seconds)
        console.log('[Firebase] New notification:', notif.title);
      }
    }
  });

  // Listen for payment updates
  firebaseDB.ref('payments').limitToLast(1).on('child_added', (snapshot) => {
    const payment = snapshot.val();
    if (payment && currentUser && currentUser.role === 'admin') {
      if (payment._synced_at && Date.now() - new Date(payment._synced_at).getTime() < 10000) {
        console.log('[Firebase] New payment received:', payment.payment_reference);
      }
    }
  });
}

// Close modal on outside click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
  }
});

console.log('WASCO Water Billing System loaded');
console.log('Distributed DB: PostgreSQL (Neon) + Firebase Realtime DB');
