/**
 * =================================================================
 * File: public/js/inventory-logic.js (REVISI PAGINASI & PERBAIKAN)
 * =================================================================
 * Deskripsi: 
 * - PERBAIKAN: Mengembalikan fungsi `getInventoryCache` untuk digunakan oleh halaman kasir.
 * - Mengganti onSnapshot pada tabel utama dengan getDocs untuk memuat data per halaman.
 * - Menambahkan state dan fungsi untuk navigasi halaman (sebelumnya, berikutnya).
 */

import { displayMessage, showLoading, formatRupiah, formatDate, updateUserInterfaceForRole } from './main.js';
import { getCurrentUserId, getCurrentUserRole } from './auth.js';
import { 
    getInventoryCollectionRef, getDb, doc, getDoc, serverTimestamp, addDoc, updateDoc, deleteDoc, 
    onSnapshot, query, where, getDocs, writeBatch,
    orderBy, limit, startAfter, endBefore, limitToLast // Impor fungsi paginasi
} from './firestore_utils.js';

// --- Variabel State Global untuk Paginasi & Data ---
const INVENTORY_PAGE_SIZE = 15; // Jumlah item per halaman
let inventoryFirstVisibleDoc = null; // Dokumen pertama di halaman saat ini
let inventoryLastVisibleDoc = null; // Dokumen terakhir di halaman saat ini
let inventoryCurrentPageNumber = 1; // Nomor halaman saat ini
let isInventorySearchActive = false; // Flag untuk mode pencarian

let inventoryCacheForStatus = []; // Cache terpisah untuk tabel status (real-time)
let inventoryUpdateSubscribers = []; // Subscriber untuk tabel status
let unsubscribeInventoryListener = null; // Listener untuk tabel status

let currentInventorySortKey = 'name'; // Kunci pengurutan default
let currentInventorySortDirection = 'asc'; // Arah pengurutan default

// --- Fungsi Publik yang Diekspor ---

/**
 * =====================================================================
 * PERBAIKAN: Mengembalikan fungsi getInventoryCache agar halaman kasir berfungsi.
 * Fungsi ini sekarang mengembalikan cache yang digunakan untuk tabel status,
 * yang juga berisi semua data inventaris secara real-time.
 * =====================================================================
 */
export function getInventoryCache() {
    return inventoryCacheForStatus;
}


/**
 * Berlangganan pembaruan real-time untuk tabel status (stok rendah, ED).
 * @param {Function} callback - Fungsi yang akan dipanggil dengan data inventaris lengkap.
 */
export function subscribeToInventoryStatusUpdates(callback) {
    if (inventoryCacheForStatus.length > 0) {
        callback(inventoryCacheForStatus);
    }
    inventoryUpdateSubscribers.push(callback);
}

/**
 * Menginisialisasi semua fitur manajemen inventaris, termasuk pemuatan halaman pertama.
 * @param {string} userRole - Peran pengguna yang sedang login.
 */
export function initializeInventoryManagement(userRole) {
    initializeInventoryTable(userRole);
    if (userRole === 'admin' || userRole === 'superadmin') {
        initializeAdminInventoryFeatures();
    }
    // Muat halaman pertama saat inisialisasi
    loadInventoryPage(userRole); 
    // Tetap jalankan listener real-time untuk tabel status
    if (!unsubscribeInventoryListener) {
        listenForInventoryStatusUpdates();
    }
}

/**
 * Memuat halaman data inventaris berikutnya.
 * @param {string} userRole - Peran pengguna.
 */
export function loadNextInventoryPage(userRole) {
    if (!inventoryLastVisibleDoc) return;
    inventoryCurrentPageNumber++;
    const nextQuery = query(getInventoryCollectionRef(), 
        orderBy(currentInventorySortKey, currentInventorySortDirection), 
        startAfter(inventoryLastVisibleDoc), 
        limit(INVENTORY_PAGE_SIZE));
    loadInventoryPage(userRole, nextQuery);
}

/**
 * Memuat halaman data inventaris sebelumnya.
 * @param {string} userRole - Peran pengguna.
 */
export function loadPrevInventoryPage(userRole) {
    if (!inventoryFirstVisibleDoc) return;
    inventoryCurrentPageNumber--;
    const prevQuery = query(getInventoryCollectionRef(), 
        orderBy(currentInventorySortKey, currentInventorySortDirection), 
        endBefore(inventoryFirstVisibleDoc), 
        limitToLast(INVENTORY_PAGE_SIZE));
    loadInventoryPage(userRole, prevQuery);
}

// ... Fungsi handleInventoryFormSubmit, handleInventoryImport, dll. (TIDAK BERUBAH) ...
async function handleInventoryFormSubmit(e) {
    e.preventDefault();
    const userId = getCurrentUserId();
    const editItemId = document.getElementById('editItemId')?.value;

    const itemData = {
        name: document.getElementById('itemName').value.trim(),
        category: document.getElementById('itemCategory').value.trim(),
        stock: parseInt(document.getElementById('itemStock').value),
        buyPrice: parseFloat(document.getElementById('itemBuyPrice').value),
        sellPrice: parseFloat(document.getElementById('itemSellPrice').value),
        arrivalDate: document.getElementById('itemArrivalDate').value,
        expiryDate: document.getElementById('itemExpiryDate').value,
        invoiceNumber: document.getElementById('itemInvoiceNumber').value.trim() || null,
        distributor: document.getElementById('itemDistributor').value.trim() || null,
    };
    
    if (!itemData.name || !itemData.category) {
        displayMessage('Nama Produk dan Kategori wajib diisi.', 'error'); return;
    }
    if (isNaN(itemData.stock) || itemData.stock < 0) {
        displayMessage('Jumlah stok tidak valid.', 'error'); return;
    }
    if (isNaN(itemData.buyPrice) || itemData.buyPrice < 0 || isNaN(itemData.sellPrice) || itemData.sellPrice < 0) {
        displayMessage('Harga Beli dan Harga Jual tidak valid.', 'error'); return;
    }
    if (itemData.sellPrice < itemData.buyPrice) {
        displayMessage('Harga Jual tidak boleh lebih rendah dari Harga Beli.', 'error'); return;
    }
    if (!itemData.arrivalDate || !itemData.expiryDate) {
        displayMessage('Tanggal Masuk dan Kedaluwarsa wajib diisi.', 'error'); return;
    }
    if (itemData.expiryDate < new Date().toISOString().split('T')[0]) {
        displayMessage('Tanggal Kedaluwarsa tidak boleh tanggal yang sudah lewat.', 'error'); return;
    }

    showLoading(true, 'loadingIndicatorInventory');
    const inventoryCollectionRef = getInventoryCollectionRef();

    try {
        if (editItemId) {
            await updateDoc(doc(inventoryCollectionRef, editItemId), { ...itemData, lastUpdated: serverTimestamp(), updatedBy: userId });
            displayMessage(`Produk "${itemData.name}" berhasil diupdate!`);
            loadInventoryPage(getCurrentUserRole()); // Reload halaman saat ini setelah edit
        } else {
            const q = query(inventoryCollectionRef, where("name", "==", itemData.name));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const existingDoc = querySnapshot.docs[0];
                const newStock = (existingDoc.data().stock || 0) + itemData.stock;
                await updateDoc(doc(inventoryCollectionRef, existingDoc.id), { ...itemData, stock: newStock, lastUpdated: serverTimestamp(), updatedBy: userId });
                displayMessage(`Stok untuk "${itemData.name}" berhasil ditambahkan. Stok baru: ${newStock}.`, 'success');
            } else {
                await addDoc(inventoryCollectionRef, { ...itemData, createdAt: serverTimestamp(), createdBy: userId, lastUpdated: serverTimestamp(), updatedBy: userId });
                displayMessage(`Produk baru "${itemData.name}" berhasil ditambahkan!`);
            }
             loadInventoryPage(getCurrentUserRole(), null, true); // Reload ke halaman pertama setelah tambah
        }
        document.getElementById('inventoryForm').reset();
        document.getElementById('editItemId').value = '';
        document.getElementById('formTitle').textContent = 'Tambah / Update Produk Manual';
        document.getElementById('submitButton').textContent = 'Simpan Produk';
    } catch (error) {
        displayMessage(`Terjadi kesalahan: ${error.message}`, 'error');
    } finally {
        showLoading(false, 'loadingIndicatorInventory');
    }
}
export function handleInventoryImport(file, importFileInput, processButton) {
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
                throw new Error("Ditemukan error pada file:\n" + errors.slice(0, 5).join("\n"));
            }
            await batchWriteToFirestore(validatedData);
            displayMessage(`${validatedData.length} produk berhasil diimpor/diperbarui!`, 'success');
            loadInventoryPage(getCurrentUserRole(), null, true); // Reload ke halaman pertama setelah impor
        } catch (error) {
            displayMessage(`Gagal mengimpor: ${error.message}`, 'error');
        } finally {
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
            if (importFileInput) importFileInput.value = '';
            if (processButton) processButton.disabled = true;
        }
    };
    reader.readAsArrayBuffer(file);
}
// --- Fungsi Inti Baru untuk Paginasi ---

/**
 * Fungsi utama untuk memuat dan merender satu halaman data inventaris.
 * @param {string} userRole - Peran pengguna.
 * @param {Query | null} queryOverride - Query Firestore spesifik (untuk next/prev page).
 * @param {boolean} resetToFirstPage - Apakah akan mereset ke halaman 1.
 */
async function loadInventoryPage(userRole, queryOverride = null, resetToFirstPage = false) {
    const inventoryTableBody = document.getElementById('inventoryTableBody');
    const colsForPlaceholder = (userRole === 'admin' || userRole === 'superadmin') ? 10 : 6;
    if (inventoryTableBody) {
        inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-8 text-gray-500"><i>Memuat data halaman...</i></td></tr>`;
    }
    
    if (resetToFirstPage) {
        inventoryCurrentPageNumber = 1;
        inventoryFirstVisibleDoc = null;
        inventoryLastVisibleDoc = null;
    }
    
    let inventoryQuery;
    if (queryOverride) {
        inventoryQuery = queryOverride;
    } else {
        // Query default untuk halaman pertama
        inventoryQuery = query(getInventoryCollectionRef(), 
            orderBy(currentInventorySortKey, currentInventorySortDirection), 
            limit(INVENTORY_PAGE_SIZE));
    }

    try {
        const documentSnapshots = await getDocs(inventoryQuery);
        const inventoryData = documentSnapshots.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

        // Update state paginasi
        inventoryFirstVisibleDoc = documentSnapshots.docs[0];
        inventoryLastVisibleDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1];

        renderInventoryTable(inventoryData, userRole);
        updatePaginationControls(documentSnapshots.docs.length);

    } catch (error) {
        console.error("inventory-logic.js: Error di loadInventoryPage:", error);
        displayMessage("Gagal memuat data inventaris. Cek console.", "error");
        if (inventoryTableBody) inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-red-500">Gagal memuat.</td></tr>`;
    }
}

/**
 * Memperbarui status tombol dan teks info paginasi.
 * @param {number} fetchedDocsCount - Jumlah dokumen yang baru saja diambil.
 */
function updatePaginationControls(fetchedDocsCount) {
    const prevBtn = document.getElementById('inventoryPrevPageButton');
    const nextBtn = document.getElementById('inventoryNextPageButton');
    const pageInfo = document.getElementById('inventoryPageInfo');

    if (prevBtn) prevBtn.disabled = inventoryCurrentPageNumber === 1;
    if (nextBtn) nextBtn.disabled = fetchedDocsCount < INVENTORY_PAGE_SIZE;
    if (pageInfo) pageInfo.textContent = `Halaman ${inventoryCurrentPageNumber}`;
}


// --- Fungsi Lainnya (Direvisi atau Disesuaikan) ---

/**
 * Menjalankan listener onSnapshot untuk memperbarui data status secara real-time.
 */
function listenForInventoryStatusUpdates() {
    if (unsubscribeInventoryListener) unsubscribeInventoryListener();
    
    const q = query(getInventoryCollectionRef());
    unsubscribeInventoryListener = onSnapshot(q, (querySnapshot) => {
        inventoryCacheForStatus = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        // Notifikasi subscriber (yaitu, halaman inventaris) untuk memperbarui tabel status
        inventoryUpdateSubscribers.forEach(callback => callback(inventoryCacheForStatus));
    }, (error) => {
        console.error("inventory-logic.js: Error di onSnapshot (status):", error);
    });
}

/**
 * Merender data ke dalam tabel inventaris utama.
 * @param {Array} itemsToRender - Array data produk untuk ditampilkan.
 * @param {string} role - Peran pengguna.
 */
function renderInventoryTable(itemsToRender, role) {
    const inventoryTableBody = document.getElementById('inventoryTableBody');
    if (!inventoryTableBody) return;
    
    const hasAdminAccess = role === 'admin' || role === 'superadmin';
    const colsForPlaceholder = hasAdminAccess ? 10 : 6;
    inventoryTableBody.innerHTML = '';

    if (itemsToRender.length === 0) {
        inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-6 text-gray-500">${isInventorySearchActive ? `Produk tidak ditemukan.` : 'Belum ada produk.'}</td></tr>`;
        return;
    }

    itemsToRender.forEach((item) => {
        const row = inventoryTableBody.insertRow();
        row.insertCell().textContent = item.name;
        row.insertCell().textContent = item.category || '-';
        row.insertCell().textContent = item.stock;
        if (hasAdminAccess) { row.insertCell().textContent = formatRupiah(item.buyPrice); }
        row.insertCell().textContent = formatRupiah(item.sellPrice);
        row.insertCell().textContent = formatDate(item.arrivalDate);
        row.insertCell().textContent = formatDate(item.expiryDate);
        if (hasAdminAccess) {
            row.insertCell().textContent = item.invoiceNumber || '-';
            row.insertCell().textContent = item.distributor || '-';
            const actionsCell = row.insertCell();
            actionsCell.className = 'space-x-2 whitespace-nowrap';
            const editButton = document.createElement('button');
            editButton.textContent = 'Edit';
            editButton.className = 'bg-yellow-500 hover:bg-yellow-600 text-white py-1 px-3 rounded-md text-sm';
            editButton.onclick = () => populateFormForEdit(item.id, item);
            actionsCell.appendChild(editButton);
            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Hapus';
            deleteButton.className = 'bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded-md text-sm';
            deleteButton.onclick = () => confirmDeleteItem(item.id, item.name);
            actionsCell.appendChild(deleteButton);
        }
    });
    updateUserInterfaceForRole(role);
}

/**
 * Menangani logika pencarian inventaris.
 * @param {Event} e - Event input dari kotak pencarian.
 */
async function handleInventorySearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    const userRole = getCurrentUserRole();
    const paginationControls = document.getElementById('inventoryPaginationControls');

    if (!searchTerm) {
        isInventorySearchActive = false;
        if (paginationControls) paginationControls.classList.remove('hidden');
        loadInventoryPage(userRole, null, true); // Kembali ke halaman 1
        return;
    }

    isInventorySearchActive = true;
    if (paginationControls) paginationControls.classList.add('hidden');
    
    // Firestore tidak mendukung pencarian substring. Cara paling sederhana adalah 'starts-with'.
    const searchQuery = query(getInventoryCollectionRef(),
        orderBy("name"),
        where("name", ">=", searchTerm),
        where("name", "<=", searchTerm + '\uf8ff')
    );

    try {
        const querySnapshot = await getDocs(searchQuery);
        const searchResults = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderInventoryTable(searchResults, userRole);
    } catch (error) {
        console.error("Error during inventory search:", error);
        displayMessage("Pencarian gagal. Cek console.", "error");
    }
}


function initializeInventoryTable(userRole) {
    const searchInputInventory = document.getElementById('searchInputInventory');
    const inventoryTableHeaders = document.querySelectorAll('#inventoryTableContainer .sortable-header');
    
    inventoryTableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.dataset.sortKey;
            if (!sortKey) return;
            if (currentInventorySortKey === sortKey) {
                currentInventorySortDirection = currentInventorySortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentInventorySortKey = sortKey;
                currentInventorySortDirection = 'asc';
            }
            updateInventorySortIndicators(inventoryTableHeaders);
            loadInventoryPage(userRole, null, true); // Reload ke halaman 1 dengan urutan baru
        });
    });

    updateInventorySortIndicators(inventoryTableHeaders);
    if (searchInputInventory) {
        searchInputInventory.addEventListener('input', handleInventorySearch);
    }
}

function initializeAdminInventoryFeatures() {
    const inventoryForm = document.getElementById('inventoryForm');
    const clearInventoryFormButton = document.getElementById('clearInventoryFormButton');
    if (inventoryForm) {
        inventoryForm.addEventListener('submit', handleInventoryFormSubmit);
    }
    if (clearInventoryFormButton) {
        clearInventoryFormButton.addEventListener('click', () => {
            inventoryForm.reset();
            document.getElementById('editItemId').value = '';
            document.getElementById('formTitle').textContent = 'Tambah / Update Produk Manual';
            document.getElementById('submitButton').textContent = 'Simpan Produk';
        });
    }
}

// ... Fungsi utilitas lainnya seperti sort indicators, populate form, delete, dll. (TIDAK BERUBAH) ...
function updateInventorySortIndicators(headers) {
    if (!headers) return;
    headers.forEach(header => {
        const indicator = header.querySelector('.sort-indicator');
        if (!indicator) return;
        if (header.dataset.sortKey === currentInventorySortKey) {
            indicator.textContent = currentInventorySortDirection === 'asc' ? '▲' : '▼';
        } else {
            indicator.textContent = '\u00A0';
        }
    });
}
function populateFormForEdit(id, item) {
    const inventoryForm = document.getElementById('inventoryForm');
    if (!inventoryForm) return;
    
    document.getElementById('editItemId').value = id;
    document.getElementById('itemName').value = item.name || '';
    document.getElementById('itemCategory').value = item.category || '';
    document.getElementById('itemStock').value = item.stock || 0;
    document.getElementById('itemBuyPrice').value = item.buyPrice || 0;
    document.getElementById('itemSellPrice').value = item.sellPrice || 0;
    document.getElementById('itemArrivalDate').value = item.arrivalDate || '';
    document.getElementById('itemExpiryDate').value = item.expiryDate || '';
    document.getElementById('itemInvoiceNumber').value = item.invoiceNumber || '';
    document.getElementById('itemDistributor').value = item.distributor || '';
    document.getElementById('formTitle').textContent = 'Edit Produk';
    document.getElementById('submitButton').textContent = 'Simpan Perubahan';
    inventoryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function confirmDeleteItem(id, itemName) {
    const role = getCurrentUserRole();
    if (role !== 'admin' || role !== 'superadmin') return;
    const modal = document.getElementById('confirmationModal');
    const confirmBtn = document.getElementById('confirmDeleteButton');
    const cancelBtn = document.getElementById('cancelDeleteButton');
    const message = document.getElementById('confirmationMessage');
    if (!modal) {
        if (confirm(`Yakin ingin menghapus produk "${itemName}"?`)) {
            performDelete(id, itemName);
        }
        return;
    }
    message.textContent = `Apakah Anda yakin ingin menghapus produk "${itemName}" dari inventaris? Tindakan ini tidak dapat dibatalkan.`;
    modal.classList.remove('hidden');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.addEventListener('click', () => { modal.classList.add('hidden'); performDelete(id, itemName); }, { once: true });
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener('click', () => modal.classList.add('hidden'), { once: true });
}
async function performDelete(itemId, itemName) {
    showLoading(true, 'loadingIndicatorInventory');
    try {
        await deleteDoc(doc(getInventoryCollectionRef(), itemId));
        displayMessage(`Produk "${itemName}" berhasil dihapus!`);
        loadInventoryPage(getCurrentUserRole()); // Reload halaman setelah hapus
    } catch (error) {
        displayMessage(`Gagal menghapus item: ${error.message}`, 'error');
    } finally {
        showLoading(false, 'loadingIndicatorInventory');
    }
}
//...
function validateImportData(jsonData) {
    const validatedData = [];
    const errors = [];
    const requiredHeaders = ['NamaProduk', 'Kategori', 'Stok', 'HargaBeli', 'HargaJual', 'TglKedaluwarsa'];
    
    const productNamesInFile = new Set();

    const headers = Object.keys(jsonData[0] || {});
    for (const requiredHeader of requiredHeaders) {
        const actualHeader = headers.find(h => h.toLowerCase() === requiredHeader.toLowerCase());
        if (!actualHeader) {
            errors.push(`Header kolom wajib "${requiredHeader}" tidak ditemukan.`);
            return { validatedData: [], errors };
        }
    }

    jsonData.forEach((row, index) => {
        const rowNum = index + 2;
        let hasError = false;
        const insensitiveRow = {};
        for (const key in row) {
            insensitiveRow[key.toLowerCase()] = row[key];
        }

        for (const header of requiredHeaders) {
            if (insensitiveRow[header.toLowerCase()] === undefined || insensitiveRow[header.toLowerCase()] === null || insensitiveRow[header.toLowerCase()] === '') {
                errors.push(`Baris ${rowNum}: Kolom "${header}" tidak boleh kosong.`);
                hasError = true;
            }
        }
        if (hasError) return;

        const productName = String(insensitiveRow.namaproduk).trim().toLowerCase();
        
        if (productNamesInFile.has(productName)) {
            errors.push(`Baris ${rowNum}: Nama produk "${insensitiveRow.namaproduk}" duplikat di dalam file.`);
            hasError = true;
        } else {
            productNamesInFile.add(productName);
        }

        const stok = Number(insensitiveRow.stok);
        const hargaBeli = Number(insensitiveRow.hargabeli);
        const hargaJual = Number(insensitiveRow.hargajual);
        if (isNaN(stok) || isNaN(hargaBeli) || isNaN(hargaJual)) {
            errors.push(`Baris ${rowNum}: Stok, HargaBeli, dan HargaJual harus berupa angka.`);
            hasError = true;
        }

        const tglKedaluwarsa = new Date(insensitiveRow.tglkedaluwarsa);
        if (isNaN(tglKedaluwarsa.getTime())) {
            errors.push(`Baris ${rowNum}: Format TglKedaluwarsa tidak valid.`);
            hasError = true;
        }
        
        if (!hasError) {
            validatedData.push({
                name: String(insensitiveRow.namaproduk).trim(),
                category: String(insensitiveRow.kategori).trim(),
                stock: stok, buyPrice: hargaBeli, sellPrice: hargaJual,
                arrivalDate: insensitiveRow.tglmasuk ? new Date(insensitiveRow.tglmasuk).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                expiryDate: tglKedaluwarsa.toISOString().split('T')[0],
                invoiceNumber: insensitiveRow.nofaktur || null,
                distributor: insensitiveRow.distributor || null
            });
        }
    });

    return { validatedData, errors };
}
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
                ...item, stock: (existingDoc.data().stock || 0) + item.stock,
                lastUpdated: serverTimestamp(), updatedBy: userId
            };
            batch.update(docRef, updateData);
        } else {
            const newDocRef = doc(inventoryCollectionRef);
            const createData = {
                ...item, createdAt: serverTimestamp(), createdBy: userId,
                lastUpdated: serverTimestamp(), updatedBy: userId
            };
            batch.set(newDocRef, createData);
        }
    }
    await batch.commit();
}
