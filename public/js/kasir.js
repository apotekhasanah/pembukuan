import { displayMessage, showLoading, formatRupiah, formatDate, updateUserInterfaceForRole } from './main.js';
import { getCurrentUserId, getCurrentUserRole, subscribeToAuthReady, getFirebaseAuth } from './auth.js'; 
// Impor fungsi helper dari file Anda
import { getInventoryCollectionRef, getSalesCollectionRef, getDb } from './firestore_utils.js';
// Impor fungsi inti dari Firebase SDK
import { doc, serverTimestamp, runTransaction, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// --- Variabel State Global untuk Modul Ini ---
let inventoryCache = [];
let salesHistoryCache = [];
let inventoryUpdateSubscribers = [];
let unsubscribeInventoryListener = null;
let unsubscribeSalesListener = null; 

// Variabel untuk status sorting tabel inventaris
let currentInventorySortKey = 'name'; 
let currentInventorySortDirection = 'asc';

// --- Fungsi Subscriber untuk Inventaris ---
export function subscribeToInventoryUpdates(callback) {
    if (inventoryCache.length > 0) {
        callback(inventoryCache);
    }
    inventoryUpdateSubscribers.push(callback);
}

function notifyInventorySubscribers(updatedInventory) {
    inventoryCache = updatedInventory; 
    inventoryUpdateSubscribers.forEach(callback => {
        try { callback(updatedInventory); } 
        catch (error) { console.error("Error in inventory update subscriber:", error); }
    });
}

// --- Inisialisasi Utama ---
document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => { 
        if (userId) {
            const currentPage = window.location.pathname.split("/").pop();
            // Skrip ini sekarang relevan untuk kedua halaman
            if (currentPage === "dashboard.html" || currentPage === "status_inventaris.html") {
                initializeKasirPage(role, currentPage); 
            }
        } else {
            console.log("Kasir.js: User not logged in. Clearing tables.");
            const invTableBody = document.getElementById('inventoryTableBody');
            const salesHistTableBody = document.getElementById('salesHistoryTableBody');
            const colsInv = 10; 
            const colsSales = 6;
            if(invTableBody) invTableBody.innerHTML = `<tr><td colspan="${colsInv}" class="text-center py-4 text-gray-500">Silakan login untuk melihat data.</td></tr>`;
            if(salesHistTableBody) salesHistTableBody.innerHTML = `<tr><td colspan="${colsSales}" class="text-center py-4 text-gray-500">Silakan login untuk melihat data.</td></tr>`;
        }
    });
});

function initializeKasirPage(userRole, currentPage) { 
    // === Referensi Elemen DOM ===
    const inventoryTableBody = document.getElementById('inventoryTableBody');
    const searchInputInventory = document.getElementById('searchInputInventory');
    
    const inventoryForm = document.getElementById('inventoryForm');
    const clearInventoryFormButton = document.getElementById('clearInventoryFormButton');
    
    // PERBAIKAN: Referensi ke tombol yang sudah dihapus, dihilangkan dari sini.
    // const toggleInventoryFormSmallScreenButton = document.getElementById('toggleInventoryFormSmallScreenButton');
    
    const inventoryFormSection = document.getElementById('inventoryFormSection');

    const saleItemSearchInput = document.getElementById('saleItemSearchInput');
    const saleItemSearchResults = document.getElementById('saleItemSearchResults');
    const currentSaleTableBody = document.getElementById('currentSaleTableBody');
    const saleTotalAmount = document.getElementById('saleTotalAmount');
    const finalizeSaleButton = document.getElementById('finalizeSaleButton');
    const salesHistoryTableBody = document.getElementById('salesHistoryTableBody'); 
    const patientNameInput = document.getElementById('patientName');
    const searchSalesHistoryInput = document.getElementById('searchSalesHistory');

    const auth = getFirebaseAuth(); 
    let currentSaleItems = [];
    let editItemId = null; 

    // === Inisialisasi Berdasarkan Halaman & Peran ===
    if (currentPage === "dashboard.html") {
        initializeDashboardFeatures();
    }
    
    if (userRole === 'admin') {
        initializeAdminInventoryFeatures();
    }

    initializeInventoryTable();

    // --- Fungsi Inisialisasi Fitur ---

    function initializeDashboardFeatures() {
        if (saleItemSearchInput) saleItemSearchInput.addEventListener('input', handleSaleItemSearch);
        
        document.addEventListener('click', (event) => {
            if (saleItemSearchInput && saleItemSearchResults && !saleItemSearchInput.contains(event.target) && !saleItemSearchResults.contains(event.target)) {
                saleItemSearchResults.classList.add('hidden');
            }
        });

        if (finalizeSaleButton) finalizeSaleButton.addEventListener('click', handleFinalizeSale);
        if (searchSalesHistoryInput) searchSalesHistoryInput.addEventListener('input', handleSalesHistorySearch);
        loadSalesHistory(); 
    }

    function initializeAdminInventoryFeatures() {
        if (inventoryForm) inventoryForm.addEventListener('submit', handleInventoryFormSubmit);
        if (clearInventoryFormButton) clearInventoryFormButton.addEventListener('click', () => {
            if(inventoryForm) inventoryForm.reset();
            editItemId = null;
            const formTitle = document.getElementById('formTitle');
            if(formTitle) formTitle.textContent = 'Tambah / Update Produk Manual';
            const submitButton = document.getElementById('submitButton');
            if(submitButton) submitButton.textContent = 'Simpan Produk';
        });

        // PERBAIKAN: Seluruh blok logika untuk event listener tombol toggle dihapus.
        /*
        if (toggleInventoryFormSmallScreenButton && inventoryFormSection) {
            toggleInventoryFormSmallScreenButton.addEventListener('click', () => {
                inventoryFormSection.classList.toggle('hidden');
            });
        }
        */
    }

    function initializeInventoryTable() {
        if (inventoryTableBody) { 
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
        }
        if (searchInputInventory) {
            searchInputInventory.addEventListener('input', (e) => {
                const sortedData = sortInventoryData([...inventoryCache], currentInventorySortKey, currentInventorySortDirection);
                filterAndRenderInventoryTable(sortedData, e.target.value, userRole);
            });
        }
        loadInventoryAndNotify();
    }

    // --- Handler untuk Form Inventaris ---

    async function handleInventoryFormSubmit(e) {
        e.preventDefault();
        const userId = getCurrentUserId(); 
        if (!userId) {
            displayMessage("Anda harus login untuk menambah/mengubah item.", "error");
            return;
        }
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

        if (!itemData.name || !itemData.category || isNaN(itemData.stock) || itemData.stock < 0 || isNaN(itemData.buyPrice) || isNaN(itemData.sellPrice) || !itemData.arrivalDate || !itemData.expiryDate) {
            displayMessage('Nama, Kategori, Stok, Harga, Tgl Masuk, dan Tgl Kedaluwarsa harus diisi.', 'error');
            return;
        }

        showLoading(true, 'loadingIndicatorInventory');
        const inventoryCollectionRef = getInventoryCollectionRef();

        try {
            if (editItemId) {
                // Logic untuk Update
                const itemDocRef = doc(inventoryCollectionRef, editItemId);
                await updateDoc(itemDocRef, {
                    ...itemData,
                    lastUpdated: serverTimestamp(),
                    updatedBy: userId
                });
                displayMessage(`Produk "${itemData.name}" berhasil diupdate!`);
            } else {
                // Logic untuk Create
                const q = query(inventoryCollectionRef, where("name", "==", itemData.name));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    // Jika produk sudah ada, update stok dan data lainnya (tambahkan stok, bukan replace)
                    const existingDoc = querySnapshot.docs[0];
                    const currentStock = existingDoc.data().stock || 0;
                    await updateDoc(doc(inventoryCollectionRef, existingDoc.id), {
                         ...itemData,
                         stock: currentStock + itemData.stock, // Menambahkan stok
                         lastUpdated: serverTimestamp(),
                         updatedBy: userId
                    });
                    displayMessage(`Produk "${itemData.name}" sudah ada. Stok telah ditambahkan.`, 'success');
                } else {
                    // Jika produk baru, buat dokumen baru
                    await addDoc(inventoryCollectionRef, {
                        ...itemData,
                        createdAt: serverTimestamp(),
                        createdBy: userId,
                        lastUpdated: serverTimestamp(),
                        updatedBy: userId
                    });
                    displayMessage(`Produk "${itemData.name}" berhasil ditambahkan!`);
                }
            }
            inventoryForm.reset();
            editItemId = null; 
            document.getElementById('formTitle').textContent = 'Tambah / Update Produk Manual';
            document.getElementById('submitButton').textContent = 'Simpan Produk';
        } catch (error) {
            console.error("Error adding/updating inventory document: ", error);
            displayMessage(`Error inventaris: ${error.message}`, 'error');
        } finally {
            showLoading(false, 'loadingIndicatorInventory');
        }
    }
    
    // --- Listener & Handler Functions (Kasir & Penjualan) ---
    function handleSaleItemSearch(e) {
        const searchTerm = e.target.value.toLowerCase();
        if(saleItemSearchResults) saleItemSearchResults.innerHTML = '';
        if (searchTerm.length < 1) { 
            if(saleItemSearchResults) saleItemSearchResults.classList.add('hidden');
            return;
        }
        const results = inventoryCache.filter(item => 
            item.name.toLowerCase().includes(searchTerm) && item.stock > 0
        );
        if (results.length > 0 && saleItemSearchResults) {
            results.forEach(item => {
                const div = document.createElement('div');
                div.textContent = `${item.name} (Stok: ${item.stock}, Harga: ${formatRupiah(item.sellPrice)})`;
                div.classList.add('p-2', 'hover:bg-gray-200', 'cursor-pointer', 'border-b');
                div.onclick = () => addProductToSale(item);
                saleItemSearchResults.appendChild(div);
            });
            saleItemSearchResults.classList.remove('hidden');
        } else if(saleItemSearchResults) {
            saleItemSearchResults.classList.add('hidden');
        }
    }

    async function handleFinalizeSale() {
        const userId = getCurrentUserId();
        if (currentSaleItems.length === 0 || !userId) {
            displayMessage('Tidak ada item dalam penjualan atau user tidak login.', 'error'); return;
        }
        showLoading(true, 'saleLoadingIndicator');
        const salesCollectionRef = getSalesCollectionRef();
        const inventoryCollectionRef = getInventoryCollectionRef();
        const db = getDb();
        if (!salesCollectionRef || !inventoryCollectionRef || !db) {
            displayMessage('Gagal mendapatkan referensi database.', 'error');
            showLoading(false, 'saleLoadingIndicator'); return;
        }

        const patientNameValue = patientNameInput ? patientNameInput.value.trim() : null;

        const saleData = {
            items: currentSaleItems.map(item => ({ 
                productId: item.id, name: item.name, quantity: item.quantity,
                priceAtSale: item.sellPrice, 
                buyPriceAtSale: item.buyPriceAtSale || item.buyPrice, 
                subtotal: item.quantity * item.sellPrice
            })),
            totalAmount: currentSaleItems.reduce((sum, item) => sum + (item.quantity * item.sellPrice), 0),
            saleDate: serverTimestamp(), 
            soldBy: userId, 
            kasirEmail: auth.currentUser ? auth.currentUser.email : 'N/A',
            receiptId: `NOTA-${Date.now().toString().slice(-6)}${Math.random().toString(36).substr(2, 3).toUpperCase()}`,
            patientName: patientNameValue || null
        };
        try {
            await runTransaction(db, async (transaction) => {
                for (const item of currentSaleItems) {
                    const productDocRef = doc(inventoryCollectionRef, item.id);
                    const productSnapshot = await transaction.get(productDocRef);
                    if (!productSnapshot.exists()) throw new Error(`Produk ${item.name} tidak ditemukan.`);
                    const currentStock = productSnapshot.data().stock;
                    const newStock = currentStock - item.quantity;
                    if (newStock < 0) throw new Error(`Stok ${item.name} tidak cukup.`);
                    transaction.update(productDocRef, { stock: newStock, lastUpdated: serverTimestamp(), updatedBy: userId });
                }
                const saleDocRef = doc(salesCollectionRef); 
                transaction.set(saleDocRef, saleData);
            });
            displayMessage('Penjualan berhasil! Stok telah diperbarui.', 'success');
            generateAndPrintReceipt(saleData, new Date()); 
            currentSaleItems = [];
            if(patientNameInput) patientNameInput.value = '';
            renderCurrentSale();
        } catch (error) {
            console.error("Error finalizing sale: ", error);
            displayMessage(`Error penjualan: ${error.message}`, 'error');
        } finally {
            showLoading(false, 'saleLoadingIndicator');
        }
    }
    
    function handleSalesHistorySearch(e) {
        const searchTerm = e.target.value.toLowerCase();
        const filteredSales = salesHistoryCache.filter(sale => {
            const receiptIdMatch = sale.receiptId && sale.receiptId.toLowerCase().includes(searchTerm);
            const patientNameMatch = sale.patientName && sale.patientName.toLowerCase().includes(searchTerm);
            return receiptIdMatch || patientNameMatch;
        });
        renderSalesHistoryTable(filteredSales);
    }
    
    // --- Fungsi Logika Inti & Rendering ---
    async function loadInventoryAndNotify() {
        const colsForPlaceholder = userRole === 'admin' ? 10 : 6;
        if (!inventoryTableBody) {
            console.warn("kasir.js: inventoryTableBody not found! (Mungkin di halaman yang tidak relevan)");
            return; 
        }
        inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-gray-400 text-sm"><i>Memproses data inventaris...</i></td></tr>`;
        
        if (unsubscribeInventoryListener) unsubscribeInventoryListener();
        
        const inventoryCollectionRef = getInventoryCollectionRef();
        if (!inventoryCollectionRef) { 
            inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-gray-500">Gagal memuat. (Ref DB tidak valid)</td></tr>`;
            return; 
        }

        const q = query(inventoryCollectionRef); 
        unsubscribeInventoryListener = onSnapshot(q, (querySnapshot) => {
            const newInventoryCacheUnsorted = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            const sortedInitialData = sortInventoryData(newInventoryCacheUnsorted, currentInventorySortKey, currentInventorySortDirection);
            
            notifyInventorySubscribers(sortedInitialData);
            filterAndRenderInventoryTable(sortedInitialData, searchInputInventory ? searchInputInventory.value : '', userRole);
            updateInventorySortIndicators(document.querySelectorAll('#inventoryTableContainer .sortable-header'));
        }, (error) => {
            console.error("kasir.js: Error in inventory onSnapshot:", error);
            if(inventoryTableBody) inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-red-500">Gagal memuat data inventaris. Periksa console.</td></tr>`;
        });
    }

    async function loadSalesHistory() { 
        if (!salesHistoryTableBody) return;
        salesHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-400 text-sm"><i>Memproses riwayat penjualan...</i></td></tr>`;

        const salesCollectionRef = getSalesCollectionRef();
        if (!salesCollectionRef) { 
            if(salesHistoryTableBody) salesHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Gagal memuat riwayat. Ref DB tidak valid.</td></tr>`;
            return; 
        }
        if (unsubscribeSalesListener) unsubscribeSalesListener();
        
        const qSales = query(salesCollectionRef, orderBy("saleDate", "desc"), limit(25));
        
        unsubscribeSalesListener = onSnapshot(qSales, (querySnapshot) => {
            salesHistoryCache = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            renderSalesHistoryTable(salesHistoryCache);
        }, (error) => {
            console.error("kasir.js: Error in sales history onSnapshot:", error);
            displayMessage(`Error memuat riwayat penjualan: ${error.message}`, 'error');
            if(salesHistoryTableBody) salesHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">Gagal memuat riwayat. Periksa console.</td></tr>`;
        });
    }
    
    function renderSalesHistoryTable(salesData) {
        if (!salesHistoryTableBody) return;
        salesHistoryTableBody.innerHTML = ''; 
        if (salesData.length === 0) {
            salesHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Tidak ada data untuk ditampilkan.</td></tr>`;
            return;
        }

        salesData.forEach(sale => {
            const row = salesHistoryTableBody.insertRow();
            const saleDate = sale.saleDate && sale.saleDate.toDate ? sale.saleDate.toDate().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short'}) : 'N/A';
            row.insertCell().textContent = saleDate;
            row.insertCell().textContent = sale.receiptId || `SALE-${sale.id.substring(0,8).toUpperCase()}`; 
            row.insertCell().textContent = sale.patientName || 'Umum';
            const itemsSold = sale.items.map(item => `${item.name} (x${item.quantity})`).join(', ');
            const itemsDisplayCell = row.insertCell();
            itemsDisplayCell.textContent = itemsSold.length > 40 ? itemsSold.substring(0, 37) + '...' : itemsSold;
            itemsDisplayCell.title = itemsSold; 
            row.insertCell().textContent = formatRupiah(sale.totalAmount);
            const actionsCell = row.insertCell();
            const viewReceiptButton = document.createElement('button');
            viewReceiptButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>`;
            viewReceiptButton.title = "Lihat Nota";
            viewReceiptButton.classList.add('bg-blue-500', 'hover:bg-blue-600', 'text-white', 'p-1.5', 'rounded-md', 'text-sm');
            viewReceiptButton.onclick = () => generateAndPrintReceipt(sale, sale.saleDate && sale.saleDate.toDate ? sale.saleDate.toDate() : null);
            actionsCell.appendChild(viewReceiptButton);
        });
    }

    function addProductToSale(product) {
        if(saleItemSearchInput) saleItemSearchInput.value = '';
        if(saleItemSearchResults) saleItemSearchResults.classList.add('hidden');
        const existingItem = currentSaleItems.find(item => item.id === product.id);
        if (existingItem) {
            if (existingItem.quantity < product.stock) existingItem.quantity++;
            else displayMessage(`Stok ${product.name} tidak mencukupi.`, 'error');
        } else {
            if (product.stock > 0) {
                currentSaleItems.push({ ...product, quantity: 1, buyPriceAtSale: product.buyPrice });
            }
            else displayMessage(`Stok ${product.name} habis.`, 'error');
        }
        renderCurrentSale();
    }

    function renderCurrentSale() {
        if(!currentSaleTableBody) return;
        currentSaleTableBody.innerHTML = '';
        let total = 0;
        if (currentSaleItems.length === 0) {
            currentSaleTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-gray-500">Belum ada item.</td></tr>`;
        } else {
            currentSaleItems.forEach((item, index) => {
                const row = currentSaleTableBody.insertRow();
                row.insertCell().textContent = item.name;
                const qtyCell = row.insertCell();
                const qtyInput = document.createElement('input');
                qtyInput.type = 'number'; qtyInput.value = item.quantity; qtyInput.min = 1;
                const productInCache = inventoryCache.find(p => p.id === item.id);
                qtyInput.max = productInCache ? productInCache.stock : item.quantity;
                qtyInput.classList.add('w-16', 'px-2', 'py-1', 'border', 'rounded-md', 'text-sm');
                qtyInput.onchange = (e) => updateSaleItemQuantity(index, parseInt(e.target.value));
                qtyCell.appendChild(qtyInput);
                row.insertCell().textContent = formatRupiah(item.sellPrice);
                const subtotal = item.quantity * item.sellPrice;
                row.insertCell().textContent = formatRupiah(subtotal);
                total += subtotal;
                const removeButton = document.createElement('button');
                removeButton.textContent = 'Hapus';
                removeButton.classList.add('bg-red-500', 'hover:bg-red-600', 'text-white', 'py-1', 'px-2', 'rounded-md', 'text-xs');
                removeButton.onclick = () => removeSaleItem(index);
                const actionCell = row.insertCell();
                actionCell.appendChild(removeButton);
            });
        }
        if(saleTotalAmount) saleTotalAmount.textContent = formatRupiah(total);
        if(finalizeSaleButton) finalizeSaleButton.disabled = currentSaleItems.length === 0;
    }

    function updateSaleItemQuantity(index, newQuantity) {
        const item = currentSaleItems[index];
        const productInCache = inventoryCache.find(p => p.id === item.id); 
        if (!productInCache) {
            displayMessage(`Produk ${item.name} tidak ditemukan di inventaris cache.`, 'error');
            removeSaleItem(index); return;
        }
        if (newQuantity <= 0) { removeSaleItem(index); return; }
        if (newQuantity <= productInCache.stock) item.quantity = newQuantity;
        else {
            displayMessage(`Stok ${item.name} tidak mencukupi (tersedia: ${productInCache.stock}).`, 'error');
            item.quantity = productInCache.stock > 0 ? productInCache.stock : 1;
        }
        renderCurrentSale();
    }

    function removeSaleItem(index) {
        currentSaleItems.splice(index, 1);
        renderCurrentSale();
    }
        
    function generateAndPrintReceipt(saleData, saleTimestamp) {
        const receiptModal = document.getElementById('receiptModal');
        const receiptContent = document.getElementById('receiptContent');
        const printReceiptButton = document.getElementById('printReceiptButton');
        const closeReceiptButton = document.getElementById('closeReceiptButton');
        if (!receiptModal || !receiptContent || !printReceiptButton || !closeReceiptButton) return;
        let itemsHtml = saleData.items.map(item => `
            <tr><td class="py-1 px-2">${item.name}</td><td class="py-1 px-2 text-center">${item.quantity}</td>
            <td class="py-1 px-2 text-right">${formatRupiah(item.priceAtSale)}</td><td class="py-1 px-2 text-right">${formatRupiah(item.subtotal)}</td></tr>`).join('');
        const receiptDate = saleTimestamp ? saleTimestamp.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short'}) : new Date().toLocaleString('id-ID');
        
        receiptContent.innerHTML = `
            <div class="text-center mb-4"><h3 class="text-xl font-semibold">Apotek Hasanah Rahayu</h3>
            <p class="text-sm">Kp. Babakan, RT 02 RW 04, Curug Bitung</p><p class="text-sm">Nanggung, Kab. Bogor, 16650</p><p class="text-sm">HP: 081717150696</p></div>
            <p class="text-sm mb-1">Tanggal: ${receiptDate}</p>
            <p class="text-sm mb-1">No. Nota: ${saleData.receiptId}</p> 
            <p class="text-sm mb-1">Kasir: ${saleData.kasirEmail || (auth.currentUser ? auth.currentUser.email : 'N/A')}</p>
            <p class="text-sm mb-2">Pasien: ${saleData.patientName || 'Umum'}</p> 
            <hr class="my-2 border-dashed">
            <table class="w-full text-sm"><thead><tr><th class="py-1 px-2 text-left">Produk</th><th class="py-1 px-2 text-center">Qty</th>
            <th class="py-1 px-2 text-right">Harga</th><th class="py-1 px-2 text-right">Subtotal</th></tr></thead><tbody>${itemsHtml}</tbody></table>
            <hr class="my-2 border-dashed">
            <div class="text-right font-semibold text-base mt-2">Total: ${formatRupiah(saleData.totalAmount)}</div>
            <p class="text-center text-xs mt-4">Terima kasih atas kunjungan Anda!</p>`;
        receiptModal.classList.remove('hidden');
        printReceiptButton.onclick = () => { 
            const printableArea = receiptContent.innerHTML;
            const printWindow = window.open('', '_blank', 'height=600,width=400');
            printWindow.document.write('<html><head><title>Nota Pembelian</title>');
            printWindow.document.write(`<style>body { font-family: 'Arial', sans-serif; margin: 10px; font-size: 9pt; width: 280px; } table { width: 100%; border-collapse: collapse; } th, td { padding: 2px; text-align: left; } .text-center { text-align: center; } .text-right { text-align: right; } .font-semibold { font-weight: bold; } hr { border: 0; border-top: 1px dashed #ccc; margin: 5px 0; } h3 { font-size: 1.1em; margin-bottom: 5px;} p { margin: 2px 0; } @media print { body { margin: 0; width: auto;} .no-print { display: none; }}</style>`);
            printWindow.document.write('</head><body>');
            printWindow.document.write(printableArea);
            printWindow.document.write('</body></html>');
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
        };
        closeReceiptButton.onclick = () => receiptModal.classList.add('hidden');
    }
    
    // --- Fungsi Utilitas & Rendering Tabel Inventaris ---
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
        if (!inventoryTableBody) return;
        inventoryTableBody.innerHTML = ''; 
        let dataToDisplay = [...itemsToRender]; 
        const searchTermLower = searchTerm.toLowerCase();
        if (searchTerm) {
            dataToDisplay = dataToDisplay.filter(item => item.name.toLowerCase().includes(searchTermLower) || (item.category && item.category.toLowerCase().includes(searchTermLower)));
        }
        const isAdmin = role === 'admin';
        const colsForPlaceholder = isAdmin ? 10 : 6;

        if (dataToDisplay.length === 0) {
            inventoryTableBody.innerHTML = `<tr><td colspan="${colsForPlaceholder}" class="text-center py-4 text-gray-500">${searchTerm ? `Produk "${searchTerm}" tidak ditemukan.` : 'Belum ada produk.'}</td></tr>`;
            return;
        }

        dataToDisplay.forEach((item) => {
            const row = inventoryTableBody.insertRow();
            row.insertCell().textContent = item.name;
            row.insertCell().textContent = item.category || '-';
            row.insertCell().textContent = item.stock;
            if (isAdmin) {
                row.insertCell().textContent = formatRupiah(item.buyPrice);
            }
            row.insertCell().textContent = formatRupiah(item.sellPrice);
            row.insertCell().textContent = formatDate(item.arrivalDate); 
            row.insertCell().textContent = formatDate(item.expiryDate); 
            if (isAdmin) { 
                row.insertCell().textContent = item.invoiceNumber || '-';
                row.insertCell().textContent = item.distributor || '-';
                const actionsCell = row.insertCell();
                actionsCell.classList.add('space-x-2', 'whitespace-nowrap'); 
                const editButton = document.createElement('button');
                editButton.textContent = 'Edit';
                editButton.classList.add('bg-yellow-500', 'hover:bg-yellow-600', 'text-white', 'py-1', 'px-3', 'rounded-md', 'text-sm');
                editButton.onclick = () => populateFormForEdit(item.id, item);

                const deleteButton = document.createElement('button');
                deleteButton.textContent = 'Hapus';
                deleteButton.classList.add('bg-red-500', 'hover:bg-red-600', 'text-white', 'py-1', 'px-3', 'rounded-md', 'text-sm');
                deleteButton.onclick = () => confirmDeleteItem(item.id, item.name);
                
                actionsCell.appendChild(editButton);
                actionsCell.appendChild(deleteButton);
            }
        });
        updateUserInterfaceForRole(role); 
    }

    // --- Fungsi Helper untuk Admin ---
    function populateFormForEdit(id, item) { 
        if (userRole !== 'admin' || !inventoryForm || !inventoryFormSection) {
            alert("Fungsi edit hanya tersedia untuk admin di halaman 'Status Inventaris'.");
            window.location.href = 'status_inventaris.html';
            return;
        };
        editItemId = id; 
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

        if (inventoryFormSection.classList.contains('hidden')) {
            inventoryFormSection.classList.remove('hidden');
        }
        inventoryFormSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); 
    }

    function confirmDeleteItem(id, itemName) {
        if (userRole !== 'admin') return;

        const modal = document.getElementById('confirmationModal') || document.getElementById('confirmationModalStatus'); 
        const confirmBtn = document.getElementById('confirmDeleteButton') || document.getElementById('confirmActionButtonStatus');
        const cancelBtn = document.getElementById('cancelDeleteButton') || document.getElementById('cancelActionButtonStatus');
        const message = document.getElementById('confirmationMessage') || document.getElementById('confirmationMessageStatus');
        
        if (!modal || !confirmBtn || !cancelBtn || !message) {
            if (confirm(`Yakin ingin menghapus produk "${itemName}"? (Modal tidak ditemukan)`)) {
                performDelete(id, itemName);
            }
            return;
        }

        message.textContent = `Apakah Anda yakin ingin menghapus produk "${itemName}" dari inventaris? Tindakan ini tidak dapat dibatalkan.`;
        modal.classList.remove('hidden');

        const newConfirmHandler = () => {
            modal.classList.add('hidden');
            performDelete(id, itemName);
        };
        const newCancelHandler = () => modal.classList.add('hidden');

        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        newConfirmBtn.addEventListener('click', newConfirmHandler, { once: true });

        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.addEventListener('click', newCancelHandler, { once: true });
    }

    async function performDelete(itemId, itemName) { 
        showLoading(true, 'loadingIndicatorInventory');
        try {
            await deleteDoc(doc(getInventoryCollectionRef(), itemId));
            displayMessage(`Produk "${itemName}" berhasil dihapus dari inventaris!`);
        } catch (error) {
            console.error("Error deleting inventory document: ", error);
            displayMessage(`Gagal menghapus item: ${error.message}`, 'error');
        } finally {
            const loadingIndicator = document.getElementById('loadingIndicatorInventory');
            if (loadingIndicator) showLoading(false, 'loadingIndicatorInventory');
        }
    }
}
