import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { firebaseConfig, APOTEK_ID } from './firebase-config.js'; 
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

async function fetchAndProvisionUser(user) {
    if (!user) return null;
    const userDocRef = doc(db, "users", user.uid);
    try {
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            return {
                role: data.role || 'kasir',
                status: data.status || 'nonaktif'
            };
        } else {
            // Logika ini tetap penting jika Superadmin mendaftarkan pengguna via Firebase Console
            console.log(`Pengguna baru terdeteksi: ${user.email}. Membuat profil default...`);
            const defaultUserData = {
                email: user.email,
                role: 'kasir',
                status: 'nonaktif',
                apotekId: APOTEK_ID, 
                createdAt: new Date()
            };
            await setDoc(userDocRef, defaultUserData);
            return {
                role: defaultUserData.role,
                status: defaultUserData.status
            };
        }
    } catch (error) {
        console.error("Error fetching or provisioning user:", error);
        return null;
    }
}

onAuthStateChanged(auth, async (user) => {
    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    const isLoginPage = currentPage === "index.html" || currentPage === "";
    
    if (user) {
        const metadata = await fetchAndProvisionUser(user);

        if (!metadata || metadata.status !== 'aktif') {
            if (!isLoginPage) {
                displayMessage("Akun Anda nonaktif atau menunggu persetujuan. Hubungi Superadmin.", "error");
            }
            await signOut(auth);
            return; 
        }

        currentUserId = user.uid;
        currentUserRole = metadata.role;
        console.log("AUTH.JS: Pengguna terautentikasi:", user.email, "Peran:", currentUserRole);

        if (isLoginPage) {
            window.location.href = "kasir.html";
            return; 
        }
        
        const userInfoEl = document.getElementById('userInfo');
        if (userInfoEl) userInfoEl.textContent = `Login sebagai: ${user.email} (Peran: ${currentUserRole})`;
        
    } else {
        currentUserId = null;
        currentUserRole = null;
        console.log("AUTH.JS: Pengguna logout.");

        if (!isLoginPage) {
            window.location.href = "index.html";
            return;
        }

        const authSection = document.getElementById('authSection');
        if (authSection) authSection.classList.remove('hidden');
    }
    
    updateUserInterfaceForRole(currentUserRole);
    authReady = true;
    notifyAuthSubscribers();
});

export async function handleLogout() {
    try {
        await signOut(auth);
        console.log("AUTH.JS: Logout berhasil.");
    } catch (error) {
        console.error("Logout error:", error);
        displayMessage(`Logout gagal: ${error.message}`, "error"); 
    }
}

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
});
