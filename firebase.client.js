// firebase.client.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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
const db = getFirestore(app);

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
