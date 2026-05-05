async function loadProfile() {
    try {
        const response = await fetch('http://localhost:3000/api/customers/me', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const profile = await response.json();
        document.getElementById('content').innerHTML = `
            <div class="card">
                <h2>Profile</h2>
                <p><strong>Name:</strong> ${profile.name}</p>
                <p><strong>Email:</strong> ${profile.email}</p>
                <p><strong>Account #:</strong> ${profile.account_number}</p>
                <p><strong>Address:</strong> ${profile.address}</p>
            </div>
        `;
    } catch (error) {
        showError('Failed to load profile');
    }
}

async function loadBills() {
    try {
        const response = await fetch('http://localhost:3000/api/billing/me', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const bills = await response.json();
        let html = '<div class="card"><h2>My Bills</h2>';
        
        if (bills.length === 0) {
            html += '<p>No bills yet.</p>';
        } else {
            html += '<table><tr><th>Period</th><th>Usage</th><th>Amount</th><th>Status</th><th>Due Date</th></tr>';
            bills.forEach(bill => {
                html += `
                    <tr>
                        <td>${bill.period}</td>
                        <td>${bill.usage} m³</td>
                        <td>$${bill.amount}</td>
                        <td class="status-${bill.status}">${bill.status}</td>
                        <td>${bill.due_date}</td>
                    </tr>
                `;
            });
            html += '</table>';
        }
        html += '</div>';
        document.getElementById('content').innerHTML = html;
    } catch (error) {
        showError('Failed to load bills');
    }
}

async function loadPayments() {
    try {
        const response = await fetch('http://localhost:3000/api/payments/me', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const payments = await response.json();
        let html = '<div class="card"><h2>Payment History</h2>';
        html += '<table><tr><th>Date</th><th>Bill Amount</th><th>Paid</th><th>Method</th></tr>';
        payments.forEach(p => {
            html += `
                <tr>
                    <td>${new Date(p.created_at).toLocaleDateString()}</td>
                    <td>$${p.bill_amount}</td>
                    <td>$${p.amount}</td>
                    <td>${p.method}</td>
                </tr>
            `;
        });
        html += '</table></div>';
        document.getElementById('content').innerHTML = html;
    } catch (error) {
        showError('Failed to load payments');
    }
}

async function loadReports() {
    try {
        const response = await fetch('http://localhost:3000/api/reports/my-payments', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const reports = await response.json();
        let html = '<div class="card"><h2>Payment Reports</h2>';
        html += '<table><tr><th>Date</th><th>Bill Amount</th><th>Paid</th><th>Method</th></tr>';
        reports.slice(0, 10).forEach(r => {
            html += `
                <tr>
                    <td>${new Date(r.created_at).toLocaleDateString()}</td>
                    <td>$${r.bill_amount}</td>
                    <td>$${r.amount}</td>
                    <td>${r.method}</td>
                </tr>
            `;
        });
        html += '</table></div>';
        document.getElementById('content').innerHTML = html;
    } catch (error) {
        showError('Failed to load reports');
    }
}

async function loadAdmin() {
    if (app.currentUser.role !== 'admin') return showError('Admin access required');
    
    try {
        const response = await fetch('http://localhost:3000/api/admin/stats', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const stats = await response.json();
        document.getElementById('content').innerHTML = `
            <div class="card">
                <h2>Admin Dashboard</h2>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                    <div class="card">
                        <h3>Total Customers</h3>
                        <span style="font-size: 2rem; color: #4299e1;">${stats.total_customers}</span>
                    </div>
                    <div class="card">
                        <h3>Pending Bills</h3>
                        <span style="font-size: 2rem; color: #ed8936;">${stats.pending_bills}</span>
                    </div>
                    <div class="card">
                        <h3>Paid Bills</h3>
                        <span style="font-size: 2rem; color: #48bb78;">${stats.paid_bills}</span>
                    </div>
                    <div class="card">
                        <h3>Total Revenue</h3>
                        <span style="font-size: 2rem; color: #805ad5;">$${stats.total_revenue || 0}</span>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        showError('Failed to load admin dashboard');
    }
}
