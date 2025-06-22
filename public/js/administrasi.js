/**
 * =================================================================
 * File: public/js/administrasi.js (DENGAN FITUR REGISTRASI)
 * =================================================================
 * Deskripsi: Modul ini menangani semua logika untuk halaman Administrasi.
 * - Menampilkan daftar pengguna.
 * - Mengedit peran dan status pengguna.
 * - BARU: Mendaftarkan pengguna baru langsung oleh Superadmin.
 */

import { displayMessage, showLoading } from './main.js';
import { subscribeToAuthReady, getCurrentUserId } from './auth.js';
import { 
    getUsersCollectionRef, 
    onSnapshot, 
    doc, 
    updateDoc,
    setDoc
} from './firestore_utils.js';

// ========================================================
// PERBAIKAN: Impor Firebase Auth & Config dari sumber yang benar
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { firebaseConfig, APOTEK_ID } from './firebase-config.js';


// --- Inisialisasi Halaman ---
document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => {
        const loadingGlobal = document.getElementById('loadingOverlay');
        if (loadingGlobal) loadingGlobal.classList.add('hidden');

        if (userId && role === 'superadmin') {
            initializePage();
            document.getElementById('mainContent')?.classList.remove('hidden');
        } else {
            document.getElementById('mainContent')?.classList.add('hidden');
            document.getElementById('accessDeniedMessage')?.classList.remove('hidden');
        }
    });
});

/**
 * Menginisialisasi semua listener dan event handler di halaman.
 */
function initializePage() {
    // Listener untuk tabel pengguna
    const usersCollectionRef = getUsersCollectionRef();
    onSnapshot(usersCollectionRef, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderUsersTable(users);
    }, (error) => {
        console.error("Error fetching users:", error);
        displayMessage("Gagal memuat data pengguna.", "error");
    });

    // Listener untuk form edit
    document.getElementById('editUserForm')?.addEventListener('submit', handleSaveChanges);
    document.getElementById('cancelEditUserButton')?.addEventListener('click', closeEditModal);

    // --- Listener untuk form registrasi BARU ---
    document.getElementById('registerUserForm')?.addEventListener('submit', handleRegistration);
}

// --- Fungsi Registrasi Pengguna oleh Superadmin ---

/**
 * Menangani pembuatan akun baru oleh superadmin.
 * @param {Event} e Event submit form
 */
async function handleRegistration(e) {
    e.preventDefault();
    showLoading(true, 'registerLoadingIndicator');
    const registerButton = e.target.querySelector('button[type="submit"]');
    if(registerButton) registerButton.disabled = true;

    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const role = document.getElementById('registerRole').value;

    if (password !== confirmPassword) {
        displayMessage('Password dan konfirmasi password tidak cocok.', 'error');
        showLoading(false, 'registerLoadingIndicator');
        if(registerButton) registerButton.disabled = false;
        return;
    }

    // Buat instance aplikasi Firebase sementara agar tidak mengganggu sesi Superadmin
    let tempApp;
    try {
        tempApp = initializeApp(firebaseConfig, 'temp-registration-app');
    } catch (error) {
        // Jika instance sudah ada karena error sebelumnya, coba gunakan yang sudah ada
        if (error.code === 'duplicate-app') {
            tempApp = initializeApp(firebaseConfig, 'temp-registration-app', true);
        } else {
            console.error("Firebase initialization error:", error);
            displayMessage("Gagal menginisialisasi layanan registrasi.", "error");
            showLoading(false, 'registerLoadingIndicator');
            if(registerButton) registerButton.disabled = false;
            return;
        }
    }

    const tempAuth = getAuth(tempApp);

    try {
        // Buat pengguna di Firebase Authentication menggunakan instance sementara
        const userCredential = await createUserWithEmailAndPassword(tempAuth, email, password);
        const newUser = userCredential.user;

        // Buat dokumen untuk pengguna baru di Firestore
        const userDocRef = doc(getUsersCollectionRef(), newUser.uid);
        const newUserData = {
            email: newUser.email,
            role: role,
            status: 'aktif', // Langsung aktif karena dibuat oleh Superadmin
            apotekId: APOTEK_ID,
            createdAt: new Date()
        };
        await setDoc(userDocRef, newUserData);

        displayMessage(`Akun untuk ${email} berhasil dibuat dengan peran ${role}.`, 'success');
        e.target.reset(); // Reset form

    } catch (error) {
        console.error("Admin registration error:", error);
        let friendlyMessage = "Gagal mendaftarkan pengguna.";
        if (error.code === 'auth/email-already-in-use') {
            friendlyMessage = "Email ini sudah terdaftar.";
        } else if (error.code === 'auth/weak-password') {
            friendlyMessage = "Password terlalu lemah (minimal 6 karakter).";
        }
        displayMessage(friendlyMessage, "error");
    } finally {
        showLoading(false, 'registerLoadingIndicator');
        if(registerButton) registerButton.disabled = false;
        // Hapus aplikasi sementara untuk membersihkan resource
        // (Meskipun di client-side, ini praktik yang baik jika memungkinkan)
    }
}


// --- Fungsi Administrasi Eksisting ---

function renderUsersTable(users) {
    const tableBody = document.getElementById('usersTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = ''; 
    if (users.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-gray-500">Tidak ada data pengguna.</td></tr>';
        return;
    }
    users.sort((a, b) => a.email.localeCompare(b.email));
    users.forEach(user => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = user.email || 'N/A';
        const roleCell = row.insertCell();
        const roleBadge = document.createElement('span');
        roleBadge.textContent = user.role || 'N/A';
        roleBadge.className = 'px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize';
        if (user.role === 'superadmin') roleBadge.classList.add('bg-purple-100', 'text-purple-800');
        else if (user.role === 'admin') roleBadge.classList.add('bg-blue-100', 'text-blue-800');
        else roleBadge.classList.add('bg-green-100', 'text-green-800');
        roleCell.appendChild(roleBadge);
        const statusCell = row.insertCell();
        const statusBadge = document.createElement('span');
        statusBadge.textContent = user.status || 'nonaktif';
        statusBadge.className = `px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${user.status === 'aktif' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
        statusCell.appendChild(statusBadge);
        const actionCell = row.insertCell();
        if (user.id !== getCurrentUserId()) {
            const editButton = document.createElement('button');
            editButton.textContent = 'Edit';
            editButton.classList.add('bg-yellow-500', 'hover:bg-yellow-600', 'text-white', 'py-1', 'px-3', 'rounded-md', 'text-sm');
            editButton.onclick = () => openEditModal(user);
            actionCell.appendChild(editButton);
        } else {
            actionCell.textContent = "-";
        }
    });
}

function openEditModal(user) {
    const modal = document.getElementById('editUserModal');
    if (!modal) return;
    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUserEmail').textContent = user.email;
    document.getElementById('editUserRole').value = user.role || 'kasir';
    document.getElementById('editUserStatus').value = user.status || 'nonaktif';
    modal.classList.remove('hidden');
}

function closeEditModal() {
    const modal = document.getElementById('editUserModal');
    if (modal) modal.classList.add('hidden');
}

async function handleSaveChanges(e) {
    e.preventDefault();
    showLoading(true, 'editLoadingIndicator');
    const userId = document.getElementById('editUserId').value;
    const newRole = document.getElementById('editUserRole').value;
    const newStatus = document.getElementById('editUserStatus').value;
    if (!userId) {
        displayMessage("ID Pengguna tidak ditemukan.", "error");
        showLoading(false, 'editLoadingIndicator');
        return;
    }
    try {
        const userDocRef = doc(getUsersCollectionRef(), userId);
        await updateDoc(userDocRef, { role: newRole, status: newStatus });
        displayMessage("Data pengguna berhasil diperbarui.", "success");
        closeEditModal();
    } catch (error) {
        console.error("Error updating user:", error);
        displayMessage(`Gagal memperbarui pengguna: ${error.message}`, "error");
    } finally {
        showLoading(false, 'editLoadingIndicator');
    }
}
