import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// PENAMBAHAN: Impor fungsi paginasi dan tambahkan ke 'export'
import { 
    getFirestore, collection, doc, serverTimestamp, runTransaction, 
    setLogLevel, addDoc, updateDoc, deleteDoc, onSnapshot, 
    query, where, getDocs, Timestamp, getDoc, writeBatch, setDoc,
    orderBy, limit, startAfter, endBefore, limitToLast // <- Fungsi baru diimpor
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 
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

// PERBAIKAN: Tambahkan fungsi paginasi ke dalam pernyataan export
export { 
    collection, doc, serverTimestamp, runTransaction, addDoc, updateDoc, deleteDoc, onSnapshot, 
    query, where, getDocs, Timestamp, getDoc, writeBatch, setDoc,
    orderBy, limit, startAfter, endBefore, limitToLast // <- Fungsi baru diekspor
};
