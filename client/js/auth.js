async function login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        showLoading();
        const response = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            app.currentUser = data.user;
            app.showDashboard();
        } else {
            showError(data.error);
        }
    } catch (error) {
        showError('Login failed. Is server running?');
    }
}

async function register() {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const role = document.getElementById('role').value;

    try {
        showLoading();
        const response = await fetch('http://localhost:3000/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, role })
        });

        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            app.currentUser = data.user;
            app.showDashboard();
        } else {
            showError(data.error);
        }
    } catch (error) {
        showError('Registration failed. Is server running?');
    }
}

function showLoading() {
    const content = document.querySelector('#content');
    content.innerHTML = '<div class="loading">Loading...</div>';
}

function showError(message) {
    const content = document.querySelector('#content');
    content.innerHTML = `<div class="error">${message}</div>`;
}
