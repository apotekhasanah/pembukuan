/**
 * =================================================================
 * File: public/js/inventaris.js (REVISI PENGHUBUNG PAGINASI)
 * =================================================================
 * Deskripsi: Modul ini disesuaikan untuk bekerja dengan sistem paginasi baru.
 * - Menambahkan event listener untuk tombol-tombol paginasi baru.
 * - Mengubah nama pemanggilan dari 'subscribeToInventoryUpdates' menjadi 'subscribeToInventoryStatusUpdates'.
 * - Logika rendering tabel utama kini sepenuhnya dikendalikan oleh inventory-logic.js.
 */

import { displayMessage, showLoading, formatDate, updateUserInterfaceForRole } from './main.js';
import { getCurrentUserRole, subscribeToAuthReady } from './auth.js';
import { 
    // Ganti nama fungsi subscribe
    subscribeToInventoryStatusUpdates, 
    initializeInventoryManagement,
    handleInventoryImport,
    // Impor fungsi navigasi halaman baru
    loadNextInventoryPage,
    loadPrevInventoryPage
} from './inventory-logic.js';
import { doc, deleteDoc, getInventoryCollectionRef } from './firestore_utils.js';

let lastReceivedInventoryData = [];

document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => {
        const loadingGlobal = document.getElementById('loadingOverlay');
        if (loadingGlobal) loadingGlobal.classList.add('hidden');
        
        const hasAccess = role === 'admin' || role === 'superadmin';

        if (userId && hasAccess) {
            // Panggil fungsi inisialisasi utama yang sudah termasuk paginasi
            initializeStatusInventarisPage(role);
            document.getElementById('mainContent')?.classList.remove('hidden');
            document.getElementById('accessDeniedMessage')?.classList.add('hidden');
        } else {
            document.getElementById('mainContent')?.classList.add('hidden');
            document.getElementById('accessDeniedMessage')?.classList.remove('hidden');
        }
    });
});

function initializeStatusInventarisPage(userRole) {
    const importFileInput = document.getElementById('importFile');
    const processImportButton = document.getElementById('processImportButton');
    const minStockThresholdInput = document.getElementById('minStockThreshold');
    const expiryWarningDaysInput = document.getElementById('expiryWarningDays');
    
    // --- PENAMBAHAN: Listener untuk tombol paginasi ---
    const prevBtn = document.getElementById('inventoryPrevPageButton');
    const nextBtn = document.getElementById('inventoryNextPageButton');
    if (prevBtn) prevBtn.addEventListener('click', () => loadPrevInventoryPage(userRole));
    if (nextBtn) nextBtn.addEventListener('click', () => loadNextInventoryPage(userRole));
    // --- AKHIR PENAMBAHAN ---

    if (importFileInput && processImportButton) {
        importFileInput.addEventListener('change', (e) => {
            processImportButton.disabled = !(e.target.files && e.target.files.length > 0);
        });
        processImportButton.addEventListener('click', () => {
            const file = importFileInput.files[0];
            if (file) {
                handleInventoryImport(file, importFileInput, processImportButton);
            } else {
                displayMessage("Silakan pilih file terlebih dahulu.", "error");
            }
        });
    }

    // Fungsi ini sekarang akan memuat halaman pertama dan menyiapkan logika tabel utama
    initializeInventoryManagement(userRole);
    
    // Fungsi subscribe ini sekarang hanya untuk tabel status
    subscribeToInventoryStatusUpdates(handleInventoryStatusUpdate);
    
    if(minStockThresholdInput) {
        minStockThresholdInput.addEventListener('change', () => renderStatusTables(lastReceivedInventoryData));
    }
    if(expiryWarningDaysInput) {
        expiryWarningDaysInput.addEventListener('change', () => renderStatusTables(lastReceivedInventoryData));
    }
}

/**
 * Memperbarui widget ringkasan dan tabel status (bukan tabel utama).
 * @param {Array} allItems - Data lengkap inventaris dari onSnapshot.
 */
function handleInventoryStatusUpdate(allItems) {
    lastReceivedInventoryData = allItems;
    
    const totalUniqueProductsEl = document.getElementById('totalUniqueProducts');
    const totalStockQuantityEl = document.getElementById('totalStockQuantity');

    if(totalUniqueProductsEl) totalUniqueProductsEl.textContent = allItems.length;
    const totalStock = allItems.reduce((sum, item) => sum + (item.stock || 0), 0);
    if(totalStockQuantityEl) totalStockQuantityEl.textContent = totalStock.toLocaleString('id-ID');

    // Render ulang tabel status setiap ada perubahan data
    renderStatusTables(lastReceivedInventoryData);
}

// Sisa file (renderStatusTables, confirmDeleteExpiredItem, dll.) TIDAK BERUBAH
function renderStatusTables(items) {
    const lowStockTableBody = document.getElementById('lowStockTableBody');
    const nearingExpiryTableBody = document.getElementById('nearingExpiryTableBody');
    const expiredTableBody = document.getElementById('expiredTableBody');
    const minStockThresholdInput = document.getElementById('minStockThreshold');
    const expiryWarningDaysInput = document.getElementById('expiryWarningDays');

    if (!lowStockTableBody || !nearingExpiryTableBody || !expiredTableBody || !minStockThresholdInput || !expiryWarningDaysInput) {
        return;
    }
    lowStockTableBody.innerHTML = '';
    nearingExpiryTableBody.innerHTML = '';
    expiredTableBody.innerHTML = '';
    
    const minStockThreshold = parseInt(minStockThresholdInput.value) || 0;
    const expiryWarningDays = parseInt(expiryWarningDaysInput.value) || 30;
    const today = new Date();
    today.setHours(0,0,0,0);
    
    let lowStockCount = 0, nearingExpiryCount = 0, expiredCount = 0;

    items.forEach(item => {
        if (item.stock <= minStockThreshold) {
            lowStockCount++;
            const row = lowStockTableBody.insertRow();
            row.insertCell().textContent = item.name;
            row.insertCell().textContent = item.category || '-';
            row.insertCell().textContent = item.stock;
        }

        if (item.expiryDate) {
            let expiryDate;
            if (typeof item.expiryDate === 'string') {
                const dateString = item.expiryDate.includes('T') ? item.expiryDate : item.expiryDate + "T00:00:00";
                expiryDate = new Date(dateString);
            } else if (item.expiryDate && typeof item.expiryDate.toDate === 'function') {
                expiryDate = item.expiryDate.toDate();
            } else { return; }

            if (isNaN(expiryDate.getTime())) return;
            expiryDate.setHours(0,0,0,0);
            
            const timeDiff = expiryDate.getTime() - today.getTime();
            const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
            
            if (dayDiff < 0) {
                expiredCount++;
                const row = expiredTableBody.insertRow();
                row.insertCell().textContent = item.name;
                row.insertCell().textContent = item.category || '-';
                row.insertCell().textContent = formatDate(expiryDate);
                row.insertCell().textContent = item.stock;
                const actionCell = row.insertCell();
                actionCell.classList.add('admin-only-table-cell');
                const deleteButton = document.createElement('button');
                deleteButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
                deleteButton.title = "Hapus Item Kedaluwarsa";
                deleteButton.classList.add('bg-red-500', 'hover:bg-red-700', 'text-white', 'p-1.5', 'rounded-md', 'text-xs');
                deleteButton.onclick = () => confirmDeleteExpiredItem(item.id, item.name);
                actionCell.appendChild(deleteButton);
            } else if (dayDiff <= expiryWarningDays) {
                nearingExpiryCount++;
                const row = nearingExpiryTableBody.insertRow();
                row.insertCell().textContent = item.name;
                row.insertCell().textContent = item.category || '-';
                row.insertCell().textContent = `${formatDate(expiryDate)} (${dayDiff} hari)`;
                row.insertCell().textContent = item.stock;
            }
        }
    });

    if (lowStockCount === 0) lowStockTableBody.innerHTML = `<tr><td colspan="3" class="text-center py-3 text-gray-500">Tidak ada produk stok rendah.</td></tr>`;
    if (nearingExpiryCount === 0) nearingExpiryTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-3 text-gray-500">Tidak ada produk mendekati ED.</td></tr>`;
    if (expiredCount === 0) expiredTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-gray-500">Tidak ada produk kedaluwarsa.</td></tr>`;
    
    updateUserInterfaceForRole(getCurrentUserRole());
}
function confirmDeleteExpiredItem(itemId, itemName) {
    // Menggunakan modal dari inventaris.html, bukan confirmationModalStatus
    const modal = document.getElementById('confirmationModal'); 
    const message = document.getElementById('confirmationMessage');
    const confirmBtn = document.getElementById('confirmDeleteButton');
    const cancelBtn = document.getElementById('cancelDeleteButton');

    if (!modal || !message || !confirmBtn || !cancelBtn) {
        if (confirm(`Yakin ingin menghapus "${itemName}" dari inventaris?`)) {
            performDeleteExpired(itemId, itemName);
        }
        return;
    }

    message.textContent = `Apakah Anda yakin ingin menghapus produk kedaluwarsa "${itemName}" secara permanen dari inventaris?`;
    modal.classList.remove('hidden');
    
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        performDeleteExpired(itemId, itemName);
    }, { once: true });
    
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    }, { once: true });
}
async function performDeleteExpired(itemId, itemName) {
    showLoading(true, 'loadingIndicatorStatus');
    try {
        await deleteDoc(doc(getInventoryCollectionRef(), itemId));
        displayMessage(`Produk "${itemName}" berhasil dihapus.`, 'success');
        // Tidak perlu reload halaman utama karena listener status akan menangani update
    } catch (error) {
        console.error("Error deleting expired item:", error);
        displayMessage(`Gagal menghapus item: ${error.message}`, 'error');
    } finally {
        showLoading(false, 'loadingIndicatorStatus');
    }
}
