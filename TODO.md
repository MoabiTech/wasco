












# Admin Pending Users Activation Feature

## Steps:
1. [x] Add backend APIs in server/routes/admin.js:
   - GET /api/admin/pending-customers (list status='pending')
   - PUT /api/admin/customers/:customerId/activate (set status='active')

2. [x] Update frontend in client/js/admin.js:
   - Add Pending Registrations table with activate buttons
   - Integrate with new APIs

3. [ ] Restart server: Ctrl+C then npm start

4. [ ] Test:
   - Login admin@admin123
   - Navigate to admin panel / manage customers
   - View pending registrations (if any, or create pending first)
   - Activate one
   - Verify status change via API ?status=pending

5. [x] Added activation for manager (button in manager.js, API access)

6. [ ] Restart server & test
