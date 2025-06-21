/**
 * =================================================================
 * File: public/js/manajemen_pengguna.js (BARU)
 * =================================================================
 * Deskripsi: Modul ini menangani semua logika untuk halaman Manajemen Pengguna.
 * Termasuk menampilkan daftar pengguna, membuka modal edit, dan menyimpan
 * perubahan peran atau status pengguna ke Firestore.
 */

import { displayMessage, showLoading } from './main.js';
import { subscribeToAuthReady, getCurrentUserId } from './auth.js';
import { getUsersCollectionRef, onSnapshot, doc, updateDoc } from './firestore_utils.js';

// Inisialisasi utama saat DOM siap
document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => {
        const loadingGlobal = document.getElementById('loadingOverlay');
        if (loadingGlobal) loadingGlobal.classList.add('hidden');

        // Hanya superadmin yang dapat mengakses fungsionalitas halaman ini
        if (userId && role === 'superadmin') {
            initializePage();
            document.getElementById('mainContent')?.classList.remove('hidden');
        } else {
            // Tampilkan pesan akses ditolak jika bukan superadmin
            document.getElementById('mainContent')?.classList.add('hidden');
            document.getElementById('accessDeniedMessage')?.classList.remove('hidden');
        }
    });
});

/**
 * Menginisialisasi listener dan event handler di halaman.
 */
function initializePage() {
    const usersCollectionRef = getUsersCollectionRef();
    
    // Mulai mendengarkan perubahan pada koleksi pengguna
    onSnapshot(usersCollectionRef, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderUsersTable(users);
    }, (error) => {
        console.error("Error fetching users:", error);
        displayMessage("Gagal memuat data pengguna.", "error");
    });

    // Event listener untuk form edit
    const editUserForm = document.getElementById('editUserForm');
    if (editUserForm) {
        editUserForm.addEventListener('submit', handleSaveChanges);
    }
    
    // Event listener untuk tombol batal di modal
    const cancelEditButton = document.getElementById('cancelEditUserButton');
    if (cancelEditButton) {
        cancelEditButton.addEventListener('click', closeEditModal);
    }
}

/**
 * Merender data pengguna ke dalam tabel HTML.
 * @param {Array<Object>} users - Array objek pengguna dari Firestore.
 */
function renderUsersTable(users) {
    const tableBody = document.getElementById('usersTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = ''; // Kosongkan tabel sebelum mengisi
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
        if (user.role === 'superadmin') {
            roleBadge.classList.add('bg-purple-100', 'text-purple-800');
        } else if (user.role === 'admin') {
            roleBadge.classList.add('bg-blue-100', 'text-blue-800');
        } else {
            roleBadge.classList.add('bg-green-100', 'text-green-800');
        }
        roleCell.appendChild(roleBadge);
        
        const statusCell = row.insertCell();
        const statusBadge = document.createElement('span');
        statusBadge.textContent = user.status || 'nonaktif';
        statusBadge.className = `px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${user.status === 'aktif' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
        statusCell.appendChild(statusBadge);

        const actionCell = row.insertCell();
        // Superadmin tidak dapat mengedit dirinya sendiri untuk mencegah terkunci
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

/**
 * Membuka modal dan mengisinya dengan data pengguna yang akan diedit.
 * @param {Object} user - Objek pengguna yang akan diedit.
 */
function openEditModal(user) {
    const modal = document.getElementById('editUserModal');
    if (!modal) return;

    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUserEmail').textContent = user.email;
    document.getElementById('editUserRole').value = user.role || 'kasir';
    document.getElementById('editUserStatus').value = user.status || 'nonaktif';

    modal.classList.remove('hidden');
}

/**
 * Menutup modal edit.
 */
function closeEditModal() {
    const modal = document.getElementById('editUserModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Menangani penyimpanan perubahan dari form edit.
 * @param {Event} e - Event submit form.
 */
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
        await updateDoc(userDocRef, {
            role: newRole,
            status: newStatus
        });
        displayMessage("Data pengguna berhasil diperbarui.", "success");
        closeEditModal();
    } catch (error) {
        console.error("Error updating user:", error);
        displayMessage(`Gagal memperbarui pengguna: ${error.message}`, "error");
    } finally {
        showLoading(false, 'editLoadingIndicator');
    }
}
