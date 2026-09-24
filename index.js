const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// Setup Express for API Routing
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

/**
 * POST /api/scan
 * Called instantly when a user opens the public /install?ref=... page
 */
app.post('/scan', async (req, res) => {
  try {
    const { ref_code, device_fp } = req.body;
    
    if (!ref_code || !device_fp) {
      return res.status(400).json({ error: 'Missing ref_code or device_fp' });
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    // 1. Log the individual scan event
    await db.collection('scans').add({
      driver_id: ref_code,
      device_fp: device_fp,
      ip_address: req.ip,
      timestamp: timestamp
    });

    // 2. Increment the driver's total scan count
    const driverRef = db.collection('drivers').doc(ref_code);
    await driverRef.set({
      total_scans: admin.firestore.FieldValue.increment(1)
    }, { merge: true });

    res.status(200).json({ success: true, message: 'Scan logged' });
  } catch (error) {
    console.error('Scan Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/install
 * Called by the mobile app on FIRST OPEN, passing the session/device ID
 */
app.post('/install', async (req, res) => {
  try {
    const { driver_id, device_fp } = req.body;

    if (!driver_id || !device_fp) {
      return res.status(400).json({ error: 'Missing driver_id or device_fp' });
    }

    // ANTI-FRAUD: Check if this device fingerprint has ALREADY installed
    const existingInstall = await db.collection('installs')
      .where('device_fp', '==', device_fp)
      .limit(1)
      .get();

    if (!existingInstall.empty) {
      // Fraud prevention: Do not count duplicates, return silently to not tip off fraudsters
      return res.status(200).json({ success: true, message: 'Duplicate ignored' });
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    // 1. Log the verified install
    await db.collection('installs').add({
      driver_id: driver_id,
      device_fp: device_fp,
      verified: true,
      timestamp: timestamp
    });

    // 2. Increment the driver's install count
    const driverRef = db.collection('drivers').doc(driver_id);
    await driverRef.set({
      verified_installs: admin.firestore.FieldValue.increment(1)
    }, { merge: true });

    res.status(200).json({ success: true, message: 'Install logged & credited' });
  } catch (error) {
    console.error('Install Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/admin/drivers
 * Admin endpoint to generate a new driver profile
 */
app.post('/admin/drivers', async (req, res) => {
  try {
    const { name, phone, vehicle_no, upi_id } = req.body;
    
    // Generate a simple readable ID (e.g., DRV_9823)
    const driverId = 'DRV_' + Math.floor(1000 + Math.random() * 9000);

    const newDriver = {
      name,
      phone,
      vehicle_no,
      upi_id,
      total_scans: 0,
      verified_installs: 0,
      status: 'active',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      qr_url: `https://install.globvai.com/install?ref=${driverId}` // Adjust to your actual subdomain
    };

    await db.collection('drivers').doc(driverId).set(newDriver);

    res.status(201).json({ success: true, driver_id: driverId, data: newDriver });
  } catch (error) {
    console.error('Create Driver Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Export the express app as a Firebase Cloud Function called "api"
exports.api = functions.https.onRequest(app);
