// firebase.client.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  initializeFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  enableNetwork
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/*
  Purpose:
  - Initialize Firebase.
  - Initialize Firestore with browser-safe network settings.
  - Export the Firestore helpers used by schema.controller.js.
  - Avoid the crash caused by using both:
    experimentalAutoDetectLongPolling and experimentalForceLongPolling together.
*/

const firebaseConfig = {
  apiKey: "AIzaSyArYR3yq01Arc2xuOfC28uzBGlBRuZxFlI",
  authDomain: "pdf-modifier-tool.firebaseapp.com",
  projectId: "pdf-modifier-tool",
  storageBucket: "pdf-modifier-tool.firebasestorage.app",
  messagingSenderId: "978099055692",
  appId: "1:978099055692:web:0c25b63096b257958298e9",
  measurementId: "G-ZWMG6FN7EK"
};

const app = initializeApp(firebaseConfig);

/*
  Important:
  Do NOT use experimentalForceLongPolling and
  experimentalAutoDetectLongPolling together.

  We are using auto-detect first because it is safer.
  If your network still blocks Firestore, we can later switch to force mode.
*/
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true
});

// Best-effort network enable.
// If already enabled, this will do nothing harmful.
enableNetwork(db).catch((error) => {
  console.warn("Firestore network enable warning:", error);
});

export {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
};
