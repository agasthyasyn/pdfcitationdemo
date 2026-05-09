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
  - Initialize Firestore with force long polling only.
  - Do not use experimentalAutoDetectLongPolling and experimentalForceLongPolling together.
  - Export Firestore helpers used by schema.controller.js.
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
  We are using force long polling only.

  Do not add:
  experimentalAutoDetectLongPolling: true

  Firebase does not allow force mode and auto-detect mode together.
*/
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  ignoreUndefinedProperties: true
});

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
