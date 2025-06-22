/**
 * =================================================================
 * File: public/js/inventory-logic.js (VALIDASI FORM DITINGKATKAN)
 * =================================================================
 * Deskripsi: Modul ini telah diperbarui dengan validasi di sisi klien yang lebih
 * kuat pada fungsi `handleInventoryFormSubmit` untuk memastikan integritas data
 * sebelum dikirim ke Firestore.
 */

import { displayMessage, showLoading, formatRupiah, formatDate, updateUserInterfaceForRole } from './main.js';
import { getCurrentUserId, getCurrentUserRole } from './auth.js';
import { getInventoryCollectionRef, getDb, doc, getDoc, serverTimestamp, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs, writeBatch } from './firestore_utils.js';

// --- Variabel State Global ---
let inventoryCache = [];
let inventoryUpdateSubscribers = [];
let unsubscribeInventoryListener = null;

let currentInventorySortKey = 'name';
let currentInventorySortDirection = 'asc';

// --- Fungsi Publik ---

export function subscribeToInventoryUpdates(callback) {
    if (inventoryCache.length > 0) {
        callback(inventoryCache);
    }
    inventoryUpdateSubscribers.push(callback);
}

export function getInventoryCache() {
    return inventoryCache;
}

export function initializeInventoryManagement(userRole) {
    initializeInventoryTable(userRole);
    if (userRole === 'admin' || userRole === 'superadmin') {
        initializeAdminInventoryFeatures();
    }
    if (!unsubscribeInventoryListener) {
        listenForInventoryUpdates(userRole);
    }
}

// ... (Fungsi logika impor dan lainnya tidak berubah) ...

// --- FUNGSI DENGAN VALIDASI YANG DIPERBARUI ---
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
    
    // ==================================================================
    // PERUBAHAN: Blok Validasi Input yang Lebih Ketat
    // ==================================================================
    if (!itemData.name || !itemData.category) {
        displayMessage('Nama Produk dan Kategori wajib diisi.', 'error');
        return;
    }
    if (isNaN(itemData.stock) || itemData.stock < 0) {
        displayMessage('Jumlah stok tidak valid. Harus angka dan tidak boleh negatif.', 'error');
        return;
    }
    if (isNaN(itemData.buyPrice) || itemData.buyPrice < 0) {
        displayMessage('Harga Beli tidak valid. Harus angka dan tidak boleh negatif.', 'error');
        return;
    }
    if (isNaN(itemData.sellPrice) || itemData.sellPrice < 0) {
        displayMessage('Harga Jual tidak valid. Harus angka dan tidak boleh negatif.', 'error');
        return;
    }
    if (itemData.sellPrice < itemData.buyPrice) {
        displayMessage('Harga Jual tidak boleh lebih rendah dari Harga Beli.', 'error');
        return;
    }
    if (!itemData.arrivalDate || !itemData.expiryDate) {
        displayMessage('Tanggal Masuk dan Tanggal Kedaluwarsa wajib diisi.', 'error');
        return;
    }
    const today = new Date().toISOString().split('T')[0];
    if (itemData.expiryDate < today) {
        displayMessage('Tanggal Kedaluwarsa tidak boleh tanggal yang sudah lewat.', 'error');
        return;
    }
    // ==================================================================
    // AKHIR PERUBAHAN
    // ==================================================================

    showLoading(true, 'loadingIndicatorInventory');
    const inventoryCollectionRef = getInventoryCollectionRef();

    try {
        if (editItemId) {
            // Logika untuk update
            await updateDoc(doc(inventoryCollectionRef, editItemId), { ...itemData, lastUpdated: serverTimestamp(), updatedBy: userId });
            displayMessage(`Produk "${itemData.name}" berhasil diupdate!`);
        } else {
            // Logika untuk membuat produk baru atau menambah stok yang ada
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
        }
        document.getElementById('inventoryForm').reset();
        if (document.getElementById('editItemId')) document.getElementById('editItemId').value = '';
        document.getElementById('formTitle').textContent = 'Tambah / Update Produk Manual';
        document.getElementById('submitButton').textContent = 'Simpan Produk';
    } catch (error) {
        displayMessage(`Terjadi kesalahan: ${error.message}`, 'error');
    } finally {
        showLoading(false, 'loadingIndicatorInventory');
    }
}


// --- Sisa file `inventory-logic.js` tidak ada perubahan ---
// (Fungsi handleImport, listenForUpdates, renderTable, dll. tetap sama)
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

function notifyInventorySubscribers(updatedInventory) {
    inventoryCache = updatedInventory;
    inventoryUpdateSubscribers.forEach(callback => callback(updatedInventory));
}

function listenForInventoryUpdates(userRole) {
    const inventoryTableBody = document.getElementById('inventoryTableBody');
    const colsForPlaceholder = (userRole === 'admin' || userRole === 'superadmin') ? 10 : 6;
    if (inventoryTableBody) {
        inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-gray-400"><i>Memproses data...</i></td></tr>`;
    }
    if (unsubscribeInventoryListener) unsubscribeInventoryListener();
    const inventoryCollectionRef = getInventoryCollectionRef();
    if (!inventoryCollectionRef) {
        if (inventoryTableBody) inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-red-500">Gagal memuat.</td></tr>`;
        return;
    }
    const q = query(inventoryCollectionRef);
    unsubscribeInventoryListener = onSnapshot(q, (querySnapshot) => {
        const newInventory = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        const sortedData = sortInventoryData(newInventory, currentInventorySortKey, currentInventorySortDirection);
        notifyInventorySubscribers(sortedData);
        if (inventoryTableBody) {
            const searchInput = document.getElementById('searchInputInventory');
            filterAndRenderInventoryTable(sortedData, searchInput ? searchInput.value : '', userRole);
            updateInventorySortIndicators(document.querySelectorAll('#inventoryTableContainer .sortable-header'));
        }
    }, (error) => {
        console.error("inventory-logic.js: Error di onSnapshot:", error);
        if (inventoryTableBody) inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-red-500">Gagal memuat data.</td></tr>`;
    });
}

function initializeAdminInventoryFeatures() {
    const inventoryForm = document.getElementById('inventoryForm');
    const clearInventoryFormButton = document.getElementById('clearInventoryFormButton');
    if (inventoryForm) {
        inventoryForm.addEventListener('submit', handleInventoryFormSubmit);
    }
    if (clearInventoryFormButton) {
        clearInventoryFormButton.addEventListener('click', () => {
            if (inventoryForm) inventoryForm.reset();
            const editItemIdInput = document.getElementById('editItemId');
            if (editItemIdInput) editItemIdInput.value = '';
            document.getElementById('formTitle').textContent = 'Tambah / Update Produk Manual';
            document.getElementById('submitButton').textContent = 'Simpan Produk';
        });
    }
}

function initializeInventoryTable(userRole) {
    const inventoryTableBody = document.getElementById('inventoryTableBody');
    if (!inventoryTableBody) {
        return;
    }
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
            const sortedData = sortInventoryData([...inventoryCache], currentInventorySortKey, currentInventorySortDirection);
            filterAndRenderInventoryTable(sortedData, searchInputInventory ? searchInputInventory.value : '', userRole);
            updateInventorySortIndicators(inventoryTableHeaders);
        });
    });
    updateInventorySortIndicators(inventoryTableHeaders);
    if (searchInputInventory) {
        searchInputInventory.addEventListener('input', (e) => {
            const sortedData = sortInventoryData([...inventoryCache], currentInventorySortKey, currentInventorySortDirection);
            filterAndRenderInventoryTable(sortedData, e.target.value, userRole);
        });
    }
}

function sortInventoryData(data, key, direction) {
    const sortedData = [...data];
    sortedData.sort((a, b) => {
        let valA = a[key]; let valB = b[key];
        if (key === 'expiryDate' || key === 'arrivalDate') {
            const parseDate = (dateStr) => {
                if (!dateStr || typeof dateStr !== 'string') return new Date(0);
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr + "T00:00:00");
                const parsed = new Date(dateStr);
                return isNaN(parsed.getTime()) ? new Date(0) : parsed;
            };
            valA = parseDate(a[key]); valB = parseDate(b[key]);
        } else if (typeof valA === 'string' && typeof valB === 'string') {
            valA = valA.toLowerCase(); valB = valB.toLowerCase();
        } else {
            valA = String(valA || '').toLowerCase();
            valB = String(valB || '').toLowerCase();
        }
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
    return sortedData;
}

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

function filterAndRenderInventoryTable(itemsToRender, searchTerm, role) {
    const inventoryTableBody = document.getElementById('inventoryTableBody');
    if (!inventoryTableBody) return;
    let dataToDisplay = itemsToRender;
    if (searchTerm) {
        const searchTermLower = searchTerm.toLowerCase();
        dataToDisplay = itemsToRender.filter(item =>
            item.name.toLowerCase().includes(searchTermLower) ||
            (item.category && item.category.toLowerCase().includes(searchTermLower))
        );
    }
    const hasAdminAccess = role === 'admin' || role === 'superadmin';
    const colsForPlaceholder = hasAdminAccess ? 10 : 6;
    inventoryTableBody.innerHTML = '';
    if (dataToDisplay.length === 0) {
        inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-gray-500">${searchTerm ? `Produk "${searchTerm}" tidak ditemukan.` : 'Belum ada produk.'}</td></tr>`;
        return;
    }
    dataToDisplay.forEach((item) => {
        const row = inventoryTableBody.insertRow();
        row.insertCell().textContent = item.name;
        row.insertCell().textContent = item.category || '-';
        row.insertCell().textContent = item.stock;
        if (hasAdminAccess) {
            row.insertCell().textContent = formatRupiah(item.buyPrice);
        }
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
            editButton.onclick = () => handleEditRequest(item.id);
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

function handleEditRequest(itemId) {
    const inventoryForm = document.getElementById('inventoryForm');
    if (inventoryForm) {
        const itemToEdit = inventoryCache.find(item => item.id === itemId);
        if (itemToEdit) {
            populateFormForEdit(itemId, itemToEdit);
        } else {
            displayMessage("Gagal menemukan item untuk diedit. Coba refresh halaman.", "error");
        }
    } else {
        window.location.href = `inventaris.html?editId=${itemId}`;
    }
}

function populateFormForEdit(id, item) {
    const inventoryForm = document.getElementById('inventoryForm');
    if (!inventoryForm) return;
    let editItemIdInput = document.getElementById('editItemId');
    if (!editItemIdInput) {
        editItemIdInput = document.createElement('input');
        editItemIdInput.type = 'hidden';
        editItemIdInput.id = 'editItemId';
        inventoryForm.appendChild(editItemIdInput);
    }
    editItemIdInput.value = id;
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
    if (role !== 'admin' && role !== 'superadmin') return;
    const modal = document.getElementById('confirmationModal') || document.getElementById('confirmationModalStatus');
    const confirmBtn = document.getElementById('confirmDeleteButton') || document.getElementById('confirmActionButtonStatus');
    const cancelBtn = document.getElementById('cancelDeleteButton') || document.getElementById('cancelActionButtonStatus');
    const message = document.getElementById('confirmationMessage') || document.getElementById('confirmationMessageStatus');
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
    } catch (error) {
        displayMessage(`Gagal menghapus item: ${error.message}`, 'error');
    } finally {
        showLoading(false, 'loadingIndicatorInventory');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('editId');
    if (editId) {
        try {
            const itemDocRef = doc(getInventoryCollectionRef(), editId);
            const itemDocSnap = await getDoc(itemDocRef);
            if (itemDocSnap.exists()) {
                window.history.replaceState({}, document.title, window.location.pathname);
                populateFormForEdit(editId, itemDocSnap.data());
            } else {
                displayMessage("Item yang akan diedit tidak ditemukan.", "error");
            }
        } catch (error) {
            displayMessage("Gagal memuat data untuk diedit.", "error");
        }
    }
});
