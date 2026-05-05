// Customer billing view
async function viewBills() {
    // Reuse loadBills from dashboard.js
    loadBills();
}

// Pay bill form
async function payBill(billId) {
    const amount = prompt('Enter payment amount:');
    if (!amount) return;
    
    try {
        const response = await fetch('http://localhost:3000/api/payments', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ bill_id: billId, amount: parseFloat(amount), method: 'card' })
        });
        
        if (response.ok) {
            alert('Payment successful!');
            loadBills();
        } else {
            const data = await response.json();
            alert('Payment failed: ' + data.error);
        }
    } catch (error) {
        alert('Payment error');
    }
}

// Export for app.js usage
window.viewBills = viewBills;
window.payBill = payBill;
