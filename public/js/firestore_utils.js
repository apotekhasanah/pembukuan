import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// === PERUBAHAN DI SINI: Tambahkan 'writeBatch' ke dalam impor ===
import { getFirestore, collection, doc, serverTimestamp, runTransaction, setLogLevel, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs, Timestamp, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 
import { firebaseConfig, APOTEK_ID } from './firebase-config.js'; 

const app = initializeApp(firebaseConfig); 
const db = getFirestore(app);
setLogLevel('debug');

export function getDb() {
    return db;
}

function getApotekSubCollection(collectionName) {
    if (!APOTEK_ID) {
        console.error(`APOTEK_ID not available for ${collectionName} collection.`);
        return null;
    }
    return collection(db, "apotekData", APOTEK_ID, collectionName);
}

export function getInventoryCollectionRef() {
    return getApotekSubCollection("inventory");
}

export function getSalesCollectionRef() {
    return getApotekSubCollection("sales");
}

export function getExpensesCollectionRef() {
    return getApotekSubCollection("expenses");
}

export function getAccountsCollectionRef() {
    return getApotekSubCollection("accounts");
}

export function getOtherIncomesCollectionRef() {
    return getApotekSubCollection("otherIncomes");
}

export function getUsersCollectionRef() {
    return collection(db, "users");
}

// === PERUBAHAN DI SINI: Tambahkan 'writeBatch' ke dalam ekspor ===
export { collection, doc, serverTimestamp, runTransaction, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs, Timestamp, getDoc, writeBatch }; 
