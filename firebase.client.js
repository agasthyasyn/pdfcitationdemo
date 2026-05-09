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
  - Initialize Firestore with safer browser/network settings.
  - Export the Firestore helpers used by schema.controller.js.
  - This is useful when Firestore shows:
    "Failed to get document because the client is offline."
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
  initializeFirestore must be called before any getFirestore-style access.
  Long polling helps when Firestore's default streaming connection is blocked
  or unreliable on some browsers/networks.
*/
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  experimentalForceLongPolling: true,
  ignoreUndefinedProperties: true
});

// Best effort: explicitly enable network.
// This will not hurt if the network is already enabled.
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
