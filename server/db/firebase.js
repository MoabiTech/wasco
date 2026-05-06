const admin = require('firebase-admin');
require('dotenv').config();


const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// Firebase data structure mirrors
const refs = {
  customers: db.ref('customers'),
  bills: db.ref('bills'),
  payments: db.ref('payments'),
  meterReadings: db.ref('meter_readings'),
  notifications: db.ref('notifications'),
  billingRates: db.ref('billing_rates'),
  districts: db.ref('districts'),
  leakReports: db.ref('leak_reports'),
  users: db.ref('users'),
  syncLog: db.ref('sync_log')
};

// Helper: Write data to Firebase
async function writeToFirebase(refName, key, data) {
  try {
    const timestamp = new Date().toISOString();
    await refs[refName].child(key).set({
      ...data,
      _synced_at: timestamp,
      _source: 'postgresql'
    });
    console.log(`[Firebase] Written to ${refName}/${key}`);
    return true;
  } catch (error) {
    console.error(`[Firebase] Error writing to ${refName}/${key}:`, error);
    return false;
  }
}

// Helper: Read data from Firebase
async function readFromFirebase(refName, key = null) {
  try {
    const ref = key ? refs[refName].child(key) : refs[refName];
    const snapshot = await ref.once('value');
    return snapshot.val();
  } catch (error) {
    console.error(`[Firebase] Error reading ${refName}:`, error);
    return null;
  }
}

// Helper: Update data in Firebase
async function updateInFirebase(refName, key, data) {
  try {
    await refs[refName].child(key).update({
      ...data,
      _updated_at: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error(`[Firebase] Error updating ${refName}/${key}:`, error);
    return false;
  }
}

// Helper: Delete data from Firebase
async function deleteFromFirebase(refName, key) {
  try {
    await refs[refName].child(key).remove();
    return true;
  } catch (error) {
    console.error(`[Firebase] Error deleting ${refName}/${key}:`, error);
    return false;
  }
}

// Helper: Query Firebase with filters
async function queryFirebase(refName, field, value) {
  try {
    const snapshot = await refs[refName]
      .orderByChild(field)
      .equalTo(value)
      .once('value');
    return snapshot.val();
  } catch (error) {
    console.error(`[Firebase] Error querying ${refName}:`, error);
    return null;
  }
}

module.exports = {
  admin,
  db,
  refs,
  writeToFirebase,
  readFromFirebase,
  updateInFirebase,
  deleteFromFirebase,
  queryFirebase
};
