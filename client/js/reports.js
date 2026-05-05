// Reports functionality
async function viewReports() {
    loadReports(); // From dashboard.js
}

// Export chart data
function exportReport(format = 'csv') {
    const reports = JSON.parse(localStorage.getItem('recentReports') || '[]');
    let csv = 'Date,Bill Amount,Paid,Method\n';
    
    reports.forEach(r => {
        csv += `"${new Date(r.created_at).toLocaleDateString()}",${r.bill_amount},${r.amount},"${r.method}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wasco-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
}

// Usage analytics
async function usageAnalytics() {
    try {
        const response = await fetch('http://localhost:3000/api/reports/usage-summary', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const analytics = await response.json();
        
        document.getElementById('content').innerHTML = `
            <div class="card">
                <h2>Usage Analytics</h2>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
                    <div>Avg Usage: ${analytics.avg_usage?.toFixed(1)} m³</div>
                    <div>Max Usage: ${analytics.max_usage} m³</div>
                    <div>Total Bills: ${analytics.total_bills}</div>
                </div>
                <button onclick="exportReport()">Export CSV</button>
            </div>
        `;
    } catch (error) {
        showError('Analytics unavailable for customers');
    }
}

window.exportReport = exportReport;
window.usageAnalytics = usageAnalytics;
