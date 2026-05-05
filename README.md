# WASCO Water Billing System

A full-stack web application for WASCO (Water and Sewerage Company) water billing management.

## Features
- Customer registration and management
- Meter readings and bill calculation
- Online payments
- Admin dashboard for reports and notifications
- Manager views
- Secure authentication

## Tech Stack
- **Backend**: Node.js, Express, Neon (Postgres), Firebase
- **Frontend**: Vanilla HTML/CSS/JS
- **Database**: Postgres (Neon) synced with Firebase

## Setup
1. Backend: `cd server && npm install && npm start`
2. Frontend: Open `client/index.html` in browser
3. Set up `.env` with DB creds

## Structure
```
wasco-water-billing/
├── server/          # Node.js API
├── client/          # Frontend
└── README.md
```

## Deployment
- Client: GitHub Pages (settings > Pages > main/root)
- Server: Render.com (env: DATABASE_URL, FIREBASE_DATABASE_URL, JWT_SECRET=your_secret)
