// Payment management
async function viewPayments() {
    loadPayments(); // From dashboard.js
}

// Payment methods form
function showPaymentForm(billId) {
    document.getElementById('content').innerHTML += `
        <div class="card">
            <h3>Make Payment</h3>
            <form id="paymentForm">
                <input type="hidden" id="billId" value="${billId}">
                <input type="number" id="paymentAmount" placeholder="Amount" step="0.01" required>
                <select id="paymentMethod">
                    <option value="card">Credit Card</option>
                    <option value="bank">Bank Transfer</option>
                    <option value="cash">Cash</option>
                </select>
                <button type="submit">Pay Now</button>
            </form>
        </div>
    `;
    
    document.getElementById('paymentForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = {
            bill_id: document.getElementById('billId').value,
            amount: parseFloat(document.getElementById('paymentAmount').value),
            method: document.getElementById('paymentMethod').value
        };
        
        try {
            const response = await fetch('http://localhost:3000/api/payments', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(formData)
            });
            
            if (response.ok) {
                alert('Payment processed!');
                viewPayments();
            }
        } catch (error) {
            alert('Payment failed');
        }
    });
}

window.showPaymentForm = showPaymentForm;
