import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js'; 
import { displayMessage, showLoading, updateUserInterfaceForRole } from './main.js'; 

const app = initializeApp(firebaseConfig); 
const auth = getAuth(app);
const db = getFirestore(app);

let currentUserId = null;
let currentUserRole = null; 
let authReady = false;
const authSubscribers = [];

export function getFirebaseAuth() { return auth; } 
export function getCurrentUserId() { return currentUserId; }
export function getCurrentUserRole() { return currentUserRole; }
export function isAuthReady() { return authReady; }

export function subscribeToAuthReady(callback) {
    if (authReady) callback({ userId: currentUserId, role: currentUserRole });
    else authSubscribers.push(callback);
}

function notifyAuthSubscribers() {
    authSubscribers.forEach(callback => callback({ userId: currentUserId, role: currentUserRole }));
    authSubscribers.length = 0;
}

async function fetchUserRole(userId) {
    if (!userId) return null;
    try {
        const userDocRef = doc(db, "users", userId);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            return userDocSnap.data().role || 'kasir'; 
        } else {
            console.warn(`Dokumen pengguna tidak ditemukan untuk UID: ${userId}.`);
            return 'kasir'; 
        }
    } catch (error) {
        console.error("Error fetching user role:", error);
        return 'kasir';
    }
}

onAuthStateChanged(auth, async (user) => {
    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    const isLoginPage = currentPage === "index.html" || currentPage === "";
    const authSection = document.getElementById('authSection');
    const mainNav = document.getElementById('mainNav'); // Note: mainNav might not be in DOM yet
    const userInfoEl = document.getElementById('userInfo'); 
    
    if (user) {
        currentUserId = user.uid;
        currentUserRole = await fetchUserRole(user.uid);
        console.log("AUTH.JS: Pengguna terautentikasi:", user.email, "Peran:", currentUserRole);

        if (isLoginPage) {
            window.location.href = "dashboard.html";
            return; 
        }
        
        // This logic remains, to be acted upon once the navbar is loaded
        if (userInfoEl) userInfoEl.textContent = `Login sebagai: ${user.email} (Peran: ${currentUserRole})`;
        
    } else {
        currentUserId = null;
        currentUserRole = null;
        console.log("AUTH.JS: Pengguna logout.");

        if (!isLoginPage) {
            window.location.href = "index.html";
            return;
        }

        if (authSection) authSection.classList.remove('hidden');
    }
    
    updateUserInterfaceForRole(currentUserRole);
    authReady = true;
    notifyAuthSubscribers();
});

// === PERUBAHAN DI SINI: Fungsi logout diekspor agar bisa dipanggil dari main.js ===
/**
 * Handles the user logout process.
 */
export async function handleLogout() {
    try {
        await signOut(auth);
        // `onAuthStateChanged` will automatically handle the redirect to index.html
        console.log("AUTH.JS: Logout dipicu manual.");
    } catch (error) {
        console.error("Logout error:", error);
        // Display message on the current page if there's an error
        displayMessage(`Logout gagal: ${error.message}`, "error"); 
    }
}
// === AKHIR PERUBAHAN ===

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginButtonSubmit = loginForm.querySelector('button[type="submit"]');
            if(loginButtonSubmit) loginButtonSubmit.disabled = true;
            
            showLoading(true, 'authLoadingIndicator');
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            try {
                await signInWithEmailAndPassword(auth, email, password);
                displayMessage("Login berhasil! Mengarahkan...", "success", "messageContainer");
            } catch (error) {
                console.error("Login error:", error);
                let friendlyMessage = "Login gagal. Periksa kembali email dan password Anda.";
                if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                    friendlyMessage = "Email atau password salah.";
                } else if (error.code === 'auth/too-many-requests') {
                    friendlyMessage = "Terlalu banyak percobaan login. Silakan coba lagi nanti.";
                }
                displayMessage(friendlyMessage, "error", "messageContainer");
            } finally {
                showLoading(false, 'authLoadingIndicator');
                if(loginButtonSubmit) loginButtonSubmit.disabled = false;
            }
        });
    }

    // Event listener untuk logout dipindahkan ke main.js agar berjalan setelah nav dimuat.
});
