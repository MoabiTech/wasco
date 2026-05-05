// Admin panel functionality
async function adminPanel() {
    loadAdmin(); // From dashboard.js
}

// Load pending registrations for admin approval
async function loadPendingRegistrations() {
    try {
        const response = await fetch('http://localhost:3000/api/admin/pending-customers', {
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        const pending = data.pending_customers || [];

        let html = `
            <div class="card">
                <h2>Pending Registrations <span class="badge badge-warning">${data.pagination.total}</span></h2>
                <p>Approve customer registrations by activating them.</p>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Account</th>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>District</th>
                            <th>Property</th>
                            <th>Meter</th>
                            <th>Registered</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (pending.length === 0) {
            html += '<tr><td colspan="8" class="text-center py-4">No pending registrations</td></tr>';
        } else {
            pending.forEach(c => {
                const name = c.first_name + ' ' + c.last_name;
                const date = new Date(c.created_at).toLocaleDateString();
                html += `
                    <tr>
                        <td><strong>${c.account_number}</strong></td>
                        <td>${name}</td>
                        <td>${c.phone || 'N/A'}</td>
                        <td>${c.district_name}</td>
                        <td><span class="badge badge-${c.property_type}">${c.property_type}</span></td>
                        <td>${c.meter_number || 'N/A'}</td>
                        <td>${date}</td>
                        <td>
                            <button class="btn btn-success btn-sm" onclick="activatePending(${c.customer_id})">
                                ✅ Activate
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="rejectPending(${c.customer_id})" style="margin-left: 5px;">
                                ❌ Reject
                            </button>
                        </td>
                    </tr>
                `;
            });
        }

        html += `
                    </tbody>
                </table>
                <div class="pagination">
                    Total: ${data.pagination.total} | Page ${data.pagination.page}
                </div>
            </div>
        `;
        document.getElementById('content').innerHTML = html;
    } catch (error) {
        console.error('Load pending error:', error);
        showError('Failed to load pending registrations');
    }
}

// Activate pending customer
async function activatePending(customerId) {
    if (!confirm('Activate this customer registration? They will receive full access.')) return;

    try {
        const response = await fetch(`http://localhost:3000/api/admin/customers/${customerId}/activate`, {
            method: 'PUT',
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            alert('Customer activated successfully!');
            loadPendingRegistrations(); // Reload
        } else {
            const err = await response.json();
            alert('Activation failed: ' + err.error);
        }
    } catch (error) {
        alert('Network error: ' + error.message);
    }
}

// Reject pending (simple delete or status= rejected)
async function rejectPending(customerId) {
    if (!confirm('Reject and delete this registration?')) return;

    try {
        // TODO: Add reject endpoint or set status='rejected'
        alert('Reject feature coming soon (TODO)');
    } catch (error) {
        alert('Reject failed');
    }
}

// Legacy functions
async function manageCustomers() {
    // Redirect to pending view
    loadPendingRegistrations();
}

window.loadPendingRegistrations = loadPendingRegistrations;
window.activatePending = activatePending;
window.rejectPending = rejectPending;
window.adminPanel = adminPanel;
window.manageCustomers = manageCustomers;
window.editCustomer = function(id) { alert(`Edit customer ${id} (TODO)`); };
window.deleteCustomer = function(id) { alert('Delete TODO'); };
