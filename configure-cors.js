#!/usr/bin/env node
/**
 * Configure CORS on Firebase Storage bucket
 * Usage: node configure-cors.js
 */

const { Storage } = require('@google-cloud/storage');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'swash-app-436a1.firebasestorage.app'
});

const storage = new Storage({
  projectId: 'swash-app-436a1',
  keyFilename: './firebase-key.json'
});

const bucket = storage.bucket('swash-app-436a1.firebasestorage.app');

const corsConfiguration = [
  {
    origin: [
      'https://app.swashcleaning.co.uk',
      'https://swash-app-436a1.web.app',
      'https://swash-vt3nz4i6z-christopher-wessells-projects.vercel.app',
      'http://localhost:5000',
      'http://localhost:3000'
    ],
    method: ['GET', 'HEAD', 'DELETE', 'PUT', 'POST', 'PATCH', 'OPTIONS'],
    responseHeader: ['Content-Type', 'Authorization', 'x-goog-meta-*'],
    maxAgeSeconds: 3600
  }
];

async function setCors() {
  try {
    await bucket.setCorsConfiguration(corsConfiguration);
    console.log('✅ CORS configuration updated successfully!');
    console.log('Allowed origins:', corsConfiguration[0].origin);
    console.log('Allowed methods:', corsConfiguration[0].method);
  } catch (error) {
    console.error('❌ Error setting CORS configuration:', error);
    process.exit(1);
  }
}

setCors();
