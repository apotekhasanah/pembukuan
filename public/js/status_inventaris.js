import { displayMessage, showLoading, formatDate, updateUserInterfaceForRole } from './main.js';
import { getCurrentUserId, getCurrentUserRole, subscribeToAuthReady } from './auth.js';
import { subscribeToInventoryUpdates } from './kasir.js'; 
import { getInventoryCollectionRef, getDb, doc, deleteDoc, serverTimestamp, query, where, getDocs, writeBatch } from './firestore_utils.js';

let lastReceivedInventoryData = [];

document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => {
        const loadingGlobal = document.getElementById('loadingOverlay');
        if (loadingGlobal) loadingGlobal.classList.add('hidden');

        if (userId && role === 'admin') {
            initializeStatusInventarisPage(); 
            const mainContent = document.getElementById('mainContent');
            if (mainContent) mainContent.classList.remove('hidden');
            const accessDenied = document.getElementById('accessDeniedMessage');
            if (accessDenied) accessDenied.classList.add('hidden');
        } else if (userId && role !== 'admin') {
            const mainContent = document.getElementById('mainContent');
            const accessDeniedMessage = document.getElementById('accessDeniedMessage');
            if (mainContent) mainContent.classList.add('hidden');
            if (accessDeniedMessage) accessDeniedMessage.classList.remove('hidden');
        } else {
            const mainContent = document.getElementById('mainContent');
            const accessDeniedMessage = document.getElementById('accessDeniedMessage');
            if (mainContent) mainContent.classList.add('hidden');
            if (accessDeniedMessage) accessDeniedMessage.classList.remove('hidden');
        }
    });
});

/**
 * Menangani proses impor inventaris dari file Excel/CSV.
 * @param {File} file - File yang diunggah oleh pengguna.
 */
async function handleInventoryImport(file) {
    const loadingIndicator = document.getElementById('importLoadingIndicator');
    if (loadingIndicator) loadingIndicator.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const json = XLSX.utils.sheet_to_json(worksheet);

            if (json.length === 0) {
                throw new Error("File Excel kosong atau format tidak sesuai.");
            }

            const { validatedData, errors } = validateImportData(json);

            if (errors.length > 0) {
                const errorMessage = "Beberapa data tidak valid:\n" + errors.slice(0, 5).join("\n");
                throw new Error(errorMessage);
            }

            await batchWriteToFirestore(validatedData);

            displayMessage(`${validatedData.length} produk berhasil diimpor/diperbarui! Halaman akan me-refresh data.`, 'success');
        } catch (error) {
            console.error("Error importing file:", error);
            displayMessage(`Gagal mengimpor: ${error.message}`, 'error');
        } finally {
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
            const importFileInput = document.getElementById('importFile');
            if(importFileInput) importFileInput.value = '';
            const processImportButton = document.getElementById('processImportButton');
            if(processImportButton) processImportButton.disabled = true;
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Memvalidasi data dari file Excel.
 * @returns {{validatedData: Array, errors: Array<string>}}
 */
function validateImportData(jsonData) {
    const validatedData = [];
    const errors = [];
    const requiredHeaders = ['NamaProduk', 'Kategori', 'Stok', 'HargaBeli', 'HargaJual', 'TglKedaluwarsa'];
    
    const headers = Object.keys(jsonData[0] || {});
    for (const requiredHeader of requiredHeaders) {
        if (!headers.includes(requiredHeader)) {
            errors.push(`Header kolom "${requiredHeader}" tidak ditemukan.`);
            return { validatedData: [], errors };
        }
    }

    jsonData.forEach((row, index) => {
        const rowNum = index + 2;
        let hasError = false;

        for (const header of requiredHeaders) {
            if (row[header] === undefined || row[header] === null || row[header] === '') {
                errors.push(`Baris ${rowNum}: Kolom "${header}" tidak boleh kosong.`);
                hasError = true;
            }
        }
        if(hasError) return;

        const stok = Number(row.Stok);
        const hargaBeli = Number(row.HargaBeli);
        const hargaJual = Number(row.HargaJual);

        if (isNaN(stok) || isNaN(hargaBeli) || isNaN(hargaJual)) {
            errors.push(`Baris ${rowNum}: Stok, HargaBeli, dan HargaJual harus berupa angka.`);
            hasError = true;
        }

        const tglKedaluwarsa = new Date(row.TglKedaluwarsa);
        if (isNaN(tglKedaluwarsa.getTime())) {
             errors.push(`Baris ${rowNum}: Format TglKedaluwarsa tidak valid.`);
             hasError = true;
        }
        
        if (!hasError) {
            validatedData.push({
                name: String(row.NamaProduk).trim(),
                category: String(row.Kategori).trim(),
                stock: stok,
                buyPrice: hargaBeli,
                sellPrice: hargaJual,
                arrivalDate: row.TglMasuk ? new Date(row.TglMasuk).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                expiryDate: tglKedaluwarsa.toISOString().split('T')[0],
                invoiceNumber: row.NoFaktur || null,
                distributor: row.Distributor || null
            });
        }
    });

    return { validatedData, errors };
}

/**
 * Menyimpan data inventaris ke Firestore menggunakan Batch Write.
 * @param {Array<Object>} inventoryData - Data yang sudah tervalidasi.
 */
async function batchWriteToFirestore(inventoryData) {
    const db = getDb();
    const inventoryCollectionRef = getInventoryCollectionRef();
    const userId = getCurrentUserId();
    const batch = writeBatch(db);

    for (const item of inventoryData) {
        const q = query(inventoryCollectionRef, where("name", "==", item.name));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            const existingDoc = snapshot.docs[0];
            const docRef = doc(inventoryCollectionRef, existingDoc.id);
            const updateData = {
                ...item,
                stock: (existingDoc.data().stock || 0) + item.stock,
                lastUpdated: serverTimestamp(),
                updatedBy: userId
            };
            batch.update(docRef, updateData);
        } else {
            const newDocRef = doc(inventoryCollectionRef);
             const createData = {
                ...item,
                createdAt: serverTimestamp(),
                createdBy: userId,
                lastUpdated: serverTimestamp(),
                updatedBy: userId
            };
            batch.set(newDocRef, createData);
        }
    }
    await batch.commit();
}

function initializeStatusInventarisPage() {
    // === PERBAIKAN LOGIKA TOMBOL IMPOR ===
    const importFileInput = document.getElementById('importFile');
    const processImportButton = document.getElementById('processImportButton');

    if (importFileInput && processImportButton) {
        // Event listener ini HANYA untuk mengaktifkan/menonaktifkan tombol.
        importFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                processImportButton.disabled = false;
            } else {
                processImportButton.disabled = true;
            }
        });

        // Event listener ini yang akan MENJALANKAN proses impor saat tombol diklik.
        processImportButton.addEventListener('click', () => {
            const file = importFileInput.files[0];
            if (file) {
                processImportButton.disabled = true; // Nonaktifkan tombol selama proses.
                handleInventoryImport(file);
            } else {
                displayMessage("Silakan pilih file terlebih dahulu.", "error");
            }
        });
    }
    // === AKHIR PERBAIKAN ===
    
    const lowStockTableBody = document.getElementById('lowStockTableBody');
    const nearingExpiryTableBody = document.getElementById('nearingExpiryTableBody');
    const expiredTableBody = document.getElementById('expiredTableBody');
    const minStockThresholdInput = document.getElementById('minStockThreshold');
    const expiryWarningDaysInput = document.getElementById('expiryWarningDays');
    const totalUniqueProductsEl = document.getElementById('totalUniqueProducts');
    const totalStockQuantityEl = document.getElementById('totalStockQuantity');

    function handleInventoryDataUpdate(allItemsFromKasir) {
        showLoading(true, 'loadingIndicatorStatus');
        lastReceivedInventoryData = allItemsFromKasir;
        if(totalUniqueProductsEl) totalUniqueProductsEl.textContent = allItemsFromKasir.length;
        const totalStock = allItemsFromKasir.reduce((sum, item) => sum + (item.stock || 0), 0);
        if(totalStockQuantityEl) totalStockQuantityEl.textContent = totalStock;
        renderStatusTables(lastReceivedInventoryData);
        showLoading(false, 'loadingIndicatorStatus');
    }

    subscribeToInventoryUpdates(handleInventoryDataUpdate);
    
    function renderStatusTables(items) { 
        if (!lowStockTableBody || !nearingExpiryTableBody || !expiredTableBody || !minStockThresholdInput || !expiryWarningDaysInput) {
            console.warn("Elemen tabel atau input untuk status rendering tidak ditemukan.");
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
                } else {
                    return;
                }

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
                    row.insertCell().textContent = formatDate(expiryDate) + ` (${dayDiff} hari)`; 
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
        const modal = document.getElementById('confirmationModalStatus');
        const message = document.getElementById('confirmationMessageStatus');
        const confirmBtn = document.getElementById('confirmActionButtonStatus');
        const cancelBtn = document.getElementById('cancelActionButtonStatus');

        if (!modal || !message || !confirmBtn || !cancelBtn) {
            console.error("Elemen modal konfirmasi status tidak ditemukan!");
            if (confirm(`Yakin ingin menghapus "${itemName}" dari inventaris?`)) {
                performDeleteExpired(itemId, itemName);
            }
            return;
        }

        message.textContent = `Apakah Anda yakin ingin menghapus produk kedaluwarsa "${itemName}" secara permanen dari inventaris?`;
        modal.classList.remove('hidden');
        
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        newConfirmBtn.addEventListener('click', async () => {
            modal.classList.add('hidden');
            await performDeleteExpired(itemId, itemName);
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
        } catch (error) {
            console.error("Error deleting expired item:", error);
            displayMessage(`Gagal menghapus item: ${error.message}`, 'error');
        } finally {
            showLoading(false, 'loadingIndicatorStatus');
        }
    }

    if(minStockThresholdInput) {
        minStockThresholdInput.addEventListener('change', () => renderStatusTables(lastReceivedInventoryData));
    }
    if(expiryWarningDaysInput) {
        expiryWarningDaysInput.addEventListener('change', () => renderStatusTables(lastReceivedInventoryData));
    }
}
