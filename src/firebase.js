import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBgJivAUjvBwLQ9mW8_4-_7e3STTsPfICM",
  authDomain: "mywatchparty-1e517.firebaseapp.com",
  projectId: "mywatchparty-1e517",
  storageBucket: "mywatchparty-1e517.firebasestorage.app",
  messagingSenderId: "257051863477",
  appId: "1:257051863477:web:f4d46cf7a76c9310fcd1fc",
  measurementId: "G-CMKWTYLB5F",
  databaseURL: "https://mywatchparty-1e517-default-rtdb.europe-west1.firebasedatabase.app",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
