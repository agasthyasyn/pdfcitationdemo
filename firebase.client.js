// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyArYR3yq01Arc2xuOfC28uzBGlBRuZxFlI",
  authDomain: "pdf-modifier-tool.firebaseapp.com",
  projectId: "pdf-modifier-tool",
  storageBucket: "pdf-modifier-tool.firebasestorage.app",
  messagingSenderId: "978099055692",
  appId: "1:978099055692:web:0c25b63096b257958298e9",
  measurementId: "G-ZWMG6FN7EK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
