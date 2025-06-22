/**
 * =================================================================
 * File: public/js/kasir.js (REVISI PENCARIAN & DEBOUNCE)
 * =================================================================
 * Deskripsi: Modul ini telah direvisi untuk memperbaiki fitur pencarian
 * riwayat penjualan.
 * - Menambahkan fungsi `debounce` untuk mencegah query berlebihan saat pengguna mengetik.
 * - `handleSalesHistorySearch` kini mencari berdasarkan ID Nota DAN Nama Pasien.
 * - Menggunakan `Promise.all` untuk menjalankan dua query secara paralel.
 * - Menggabungkan hasil query dan menghapus duplikat di sisi klien.
 */

import { displayMessage, showLoading, formatRupiah, formatDate } from './main.js';
import { getCurrentUserId, getCurrentUserRole, getFirebaseAuth, subscribeToAuthReady } from './auth.js';
import { subscribeToInventoryUpdates, getInventoryCache, initializeInventoryManagement } from './inventory-logic.js';
import { getSalesCollectionRef, getInventoryCollectionRef, getDb } from './firestore_utils.js';
// Impor fungsi tambahan untuk paginasi dan query
import { doc, runTransaction, query, orderBy, limit, getDocs, updateDoc, deleteDoc, startAfter, endBefore, limitToLast, where } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// --- Variabel State Global untuk Modul Kasir ---
const SALES_PAGE_SIZE = 15; // Jumlah item per halaman
let salesHistoryFirstVisibleDoc = null; // Dokumen pertama di halaman saat ini
let salesHistoryLastVisibleDoc = null; // Dokumen terakhir di halaman saat ini
let currentPageNumber = 1;
let isSearchActive = false;

/**
 * Utility function to delay execution of a function until after a certain time has passed
 * without it being called again.
 * @param {Function} func The function to debounce.
 * @param {number} delay The delay in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(func, delay = 500) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}


// --- Inisialisasi Utama ---
document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => {
        if (userId) {
            const currentPage = window.location.pathname.split("/").pop();
            if (currentPage === "kasir.html" || currentPage === "") {
                initializeKasirPage(role);
            }
        } else {
            const salesHistTableBody = document.getElementById('salesHistoryTableBody');
            if (salesHistTableBody) salesHistTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Silakan login untuk melihat data.</td></tr>`;
        }
    });
});

/**
 * Fungsi utama yang menginisialisasi semua logika untuk halaman kasir.
 * @param {string} userRole - Peran pengguna yang login.
 */
function initializeKasirPage(userRole) {
    // --- Referensi Elemen DOM ---
    const saleItemSearchInput = document.getElementById('saleItemSearchInput');
    const saleItemSearchResults = document.getElementById('saleItemSearchResults');
    const finalizeSaleButton = document.getElementById('finalizeSaleButton');
    const searchSalesHistoryInput = document.getElementById('searchSalesHistory');
    const editSaleForm = document.getElementById('editSaleForm');
    const cancelEditSaleButton = document.getElementById('cancelEditSaleButton');
    const currentSaleTableBody = document.getElementById('currentSaleTableBody');
    const saleTotalAmount = document.getElementById('saleTotalAmount');
    const patientNameInput = document.getElementById('patientName');
    const prevPageButton = document.getElementById('prevPageButton');
    const nextPageButton = document.getElementById('nextPageButton');
    const paginationControls = document.getElementById('paginationControls');

    // --- State Lokal untuk Halaman Kasir ---
    let currentSaleItems = [];
    const auth = getFirebaseAuth();

    // ... (Fungsi renderCurrentSale, updateSaleItemQuantity, removeSaleItem, addProductToSale, handleSaleItemSearch tidak berubah) ...
    function renderCurrentSale() {
        if(!currentSaleTableBody) return;
        currentSaleTableBody.innerHTML = '';
        let total = 0;
        if (currentSaleItems.length === 0) {
            currentSaleTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-gray-500">Belum ada item.</td></tr>`;
        } else {
            const inventory = getInventoryCache();
            currentSaleItems.forEach((item, index) => {
                const row = currentSaleTableBody.insertRow();
                row.insertCell().textContent = item.name;
                const qtyCell = row.insertCell();
                const qtyInput = document.createElement('input');
                qtyInput.type = 'number'; qtyInput.value = item.quantity; qtyInput.min = 1;
                const productInCache = inventory.find(p => p.id === item.id);
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
        const inventory = getInventoryCache();
        const productInCache = inventory.find(p => p.id === item.id);
        if (!productInCache) {
            displayMessage(`Produk ${item.name} tidak ditemukan di inventaris.`, 'error');
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
    function addProductToSale(product) {
        if(saleItemSearchInput) saleItemSearchInput.value = '';
        if(saleItemSearchResults) saleItemSearchResults.classList.add('hidden');
        const existingItem = currentSaleItems.find(item => item.id === product.id);
        if (existingItem) {
            if (existingItem.quantity < product.stock) existingItem.quantity++;
            else displayMessage(`Stok ${product.name} tidak mencukupi.`, 'error');
        } else {
            if (product.stock > 0) {
                currentSaleItems.push({ ...product, quantity: 1, buyPriceAtSale: product.buyPrice, priceAtSale: product.sellPrice });
            }
            else displayMessage(`Stok ${product.name} habis.`, 'error');
        }
        renderCurrentSale();
    }
    function handleSaleItemSearch(e) {
        const searchTerm = e.target.value.toLowerCase();
        if(saleItemSearchResults) saleItemSearchResults.innerHTML = '';
        if (searchTerm.length < 1) {
            if(saleItemSearchResults) saleItemSearchResults.classList.add('hidden');
            return;
        }
        const inventory = getInventoryCache();
        const results = inventory.filter(item =>
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

    /**
     * Memfinalisasi penjualan, menyimpan ke DB, dan mengurangi stok.
     */
    async function handleFinalizeSale() {
        const userId = getCurrentUserId();
        if (currentSaleItems.length === 0 || !userId) {
            displayMessage('Tidak ada item dalam penjualan atau pengguna tidak login.', 'error'); return;
        }
        showLoading(true, 'saleLoadingIndicator');
        
        const db = getDb();
        const salesCollectionRef = getSalesCollectionRef();
        const inventoryCollectionRef = getInventoryCollectionRef();

        const patientNameValue = patientNameInput ? patientNameInput.value.trim() : null;
        const totalAmount = currentSaleItems.reduce((sum, item) => sum + (item.quantity * item.priceAtSale), 0);
        const saleData = {
            items: currentSaleItems.map(item => ({
                productId: item.id, name: item.name, quantity: item.quantity,
                priceAtSale: item.priceAtSale,
                buyPriceAtSale: item.buyPriceAtSale,
                subtotal: item.quantity * item.priceAtSale
            })),
            totalAmount: totalAmount,
            saleDate: new Date(),
            soldBy: userId,
            kasirEmail: auth.currentUser ? auth.currentUser.email : 'N/A',
            receiptId: `NOTA-${Date.now().toString().slice(-6)}${Math.random().toString(36).substr(2, 3).toUpperCase()}`,
            patientName: patientNameValue || null
        };

        try {
            await runTransaction(db, async (transaction) => {
                for (const item of saleData.items) {
                    const productDocRef = doc(inventoryCollectionRef, item.productId);
                    const productSnapshot = await transaction.get(productDocRef);
                    if (!productSnapshot.exists()) throw new Error(`Produk ${item.name} tidak ditemukan.`);
                    const currentStock = productSnapshot.data().stock;
                    const newStock = currentStock - item.quantity;
                    if (newStock < 0) throw new Error(`Stok ${item.name} tidak cukup.`);
                    transaction.update(productDocRef, { stock: newStock, lastUpdated: new Date() });
                }
                const saleDocRef = doc(salesCollectionRef);
                transaction.set(saleDocRef, saleData);
            });

            displayMessage('Penjualan berhasil! Stok telah diperbarui.', 'success');
            showAndPrintReceipt(saleData, true); 
            currentSaleItems = []; 
            if(patientNameInput) patientNameInput.value = '';
            renderCurrentSale();
            loadSalesHistory(userRole); // Muat ulang halaman pertama setelah penjualan
        } catch (error) {
            console.error("Error finalizing sale: ", error);
            displayMessage(`Error penjualan: ${error.message}`, 'error');
        } finally {
            showLoading(false, 'saleLoadingIndicator');
        }
    }
    
    // --- Bagian Riwayat Penjualan (DIREVISI UNTUK PAGINASI & PENCARIAN) ---
    
    /**
     * Memuat halaman pertama atau halaman yang ditentukan dari riwayat penjualan.
     * @param {string} userRole - Peran pengguna.
     * @param {Query | null} queryToRun - Kueri Firestore yang akan dijalankan.
     */
    async function loadSalesHistory(userRole, queryToRun = null) {
        const salesHistoryTableBody = document.getElementById('salesHistoryTableBody');
        if (!salesHistoryTableBody) return;
        salesHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-400 text-sm"><i>Memproses riwayat penjualan...</i></td></tr>`;

        isSearchActive = false;
        if(paginationControls) paginationControls.style.display = 'flex';

        try {
            // Jika tidak ada query spesifik, buat query untuk halaman pertama
            if (!queryToRun) {
                currentPageNumber = 1;
                queryToRun = query(getSalesCollectionRef(), orderBy("saleDate", "desc"), limit(SALES_PAGE_SIZE));
            }

            const documentSnapshots = await getDocs(queryToRun);
            const salesData = documentSnapshots.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

            if (salesData.length === 0 && currentPageNumber > 1) {
                // Jika halaman saat ini kosong (misalnya, setelah menghapus item terakhir)
                currentPageNumber--;
                loadSalesHistory(userRole); // Coba muat halaman sebelumnya
                return;
            }
            
            renderSalesHistoryTable(salesData, userRole);

            // Perbarui state paginasi
            salesHistoryFirstVisibleDoc = documentSnapshots.docs[0];
            salesHistoryLastVisibleDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1];

            // Update UI Tombol Paginasi
            if(prevPageButton) prevPageButton.disabled = currentPageNumber === 1;
            if(nextPageButton) nextPageButton.disabled = documentSnapshots.docs.length < SALES_PAGE_SIZE;
            const pageInfo = document.getElementById('pageInfo');
            if(pageInfo) pageInfo.textContent = `Halaman ${currentPageNumber}`;

        } catch (error) {
            console.error("kasir.js: Error fetching sales history:", error);
            displayMessage(`Error memuat riwayat penjualan: ${error.message}`, 'error');
            if(salesHistoryTableBody) salesHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">Gagal memuat riwayat. Periksa console.</td></tr>`;
        }
    }

    function loadNextPage(userRole) {
        if (!salesHistoryLastVisibleDoc) return;
        currentPageNumber++;
        const nextQuery = query(getSalesCollectionRef(), orderBy("saleDate", "desc"), startAfter(salesHistoryLastVisibleDoc), limit(SALES_PAGE_SIZE));
        loadSalesHistory(userRole, nextQuery);
    }

    function loadPrevPage(userRole) {
        if (!salesHistoryFirstVisibleDoc) return;
        currentPageNumber--;
        const prevQuery = query(getSalesCollectionRef(), orderBy("saleDate", "desc"), endBefore(salesHistoryFirstVisibleDoc), limitToLast(SALES_PAGE_SIZE));
        loadSalesHistory(userRole, prevQuery);
    }

    function renderSalesHistoryTable(salesData, role) {
        const salesHistoryTableBody = document.getElementById('salesHistoryTableBody');
        if (!salesHistoryTableBody) return;
        salesHistoryTableBody.innerHTML = '';
        if (salesData.length === 0) {
            salesHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">${isSearchActive ? 'Data tidak ditemukan.' : 'Tidak ada data untuk ditampilkan.'}</td></tr>`;
            return;
        }

        salesData.forEach(sale => {
            const row = salesHistoryTableBody.insertRow();
            row.insertCell().textContent = formatDate(sale.saleDate);
            row.insertCell().textContent = sale.receiptId || `SALE-${sale.id.substring(0,8).toUpperCase()}`;
            row.insertCell().textContent = sale.patientName || 'Umum';
            const itemsSold = sale.items.map(item => `${item.name} (x${item.quantity})`).join(', ');
            const itemsDisplayCell = row.insertCell();
            itemsDisplayCell.textContent = itemsSold.length > 40 ? itemsSold.substring(0, 37) + '...' : itemsSold;
            itemsDisplayCell.title = itemsSold;
            row.insertCell().textContent = formatRupiah(sale.totalAmount);
            
            const actionsCell = row.insertCell();
            actionsCell.className = 'space-x-2 whitespace-nowrap';
            const viewReceiptButton = document.createElement('button');
            viewReceiptButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>`;
            viewReceiptButton.title = "Lihat Struk";
            viewReceiptButton.classList.add('bg-blue-500', 'hover:bg-blue-600', 'text-white', 'p-1.5', 'rounded-md', 'text-sm');
            viewReceiptButton.onclick = () => showAndPrintReceipt(sale, false);
            actionsCell.appendChild(viewReceiptButton);
            
            if (role === 'superadmin') {
                const editButton = document.createElement('button');
                editButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>`;
                editButton.title = "Edit Penjualan";
                editButton.className = 'bg-yellow-500 hover:bg-yellow-600 text-white p-1.5 rounded-md text-sm';
                editButton.onclick = () => openEditSaleModal(sale);
                actionsCell.appendChild(editButton);

                const deleteButton = document.createElement('button');
                deleteButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
                deleteButton.title = "Hapus Penjualan";
                deleteButton.className = 'bg-red-500 hover:bg-red-700 text-white p-1.5 rounded-md text-sm';
                deleteButton.onclick = () => confirmDeleteSale(sale, userRole);
                actionsCell.appendChild(deleteButton);
            }
        });
    }
    
    /**
     * ======================================================================
     * FUNGSI PENCARIAN YANG DIPERBAIKI
     * Mencari berdasarkan ID Nota dan Nama Pasien, lalu menggabungkan hasil.
     * ======================================================================
     */
    async function handleSalesHistorySearch(e) {
        const searchTerm = e.target.value.trim();
        const salesHistoryTableBody = document.getElementById('salesHistoryTableBody');
        const paginationControls = document.getElementById('paginationControls');

        if (!searchTerm) {
            isSearchActive = false;
            if (paginationControls) paginationControls.style.display = 'flex';
            loadSalesHistory(userRole); // Kembali ke mode paginasi
            return;
        }

        isSearchActive = true;
        if (paginationControls) paginationControls.style.display = 'none';
        if (salesHistoryTableBody) salesHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-400 text-sm"><i>Mencari data untuk "${searchTerm}"...</i></td></tr>`;

        try {
            // Firestore tidak mendukung 'OR' pada field berbeda, jadi kita lakukan 2 query dan gabungkan hasilnya.
            
            // Query 1: Cari berdasarkan ID Nota (case-insensitive)
            const receiptQuery = query(getSalesCollectionRef(),
                orderBy("receiptId"),
                where("receiptId", ">=", searchTerm.toUpperCase()),
                where("receiptId", "<=", searchTerm.toUpperCase() + '\uf8ff')
            );
            
            // Query 2: Cari berdasarkan Nama Pasien (case-insensitive-like)
            const capitalizedTerm = searchTerm.charAt(0).toUpperCase() + searchTerm.slice(1).toLowerCase();
            const patientNameQuery = query(getSalesCollectionRef(),
                orderBy("patientName"),
                where("patientName", ">=", capitalizedTerm),
                where("patientName", "<=", capitalizedTerm + '\uf8ff')
            );

            // Jalankan kedua query secara paralel
            const [receiptSnapshots, patientSnapshots] = await Promise.all([
                getDocs(receiptQuery),
                getDocs(patientNameQuery)
            ]);

            // Gunakan Map untuk menggabungkan hasil dan menghapus duplikat (berdasarkan ID dokumen)
            const resultsMap = new Map();
            receiptSnapshots.forEach(doc => {
                resultsMap.set(doc.id, { id: doc.id, ...doc.data() });
            });
            patientSnapshots.forEach(doc => {
                if (!resultsMap.has(doc.id)) {
                    resultsMap.set(doc.id, { id: doc.id, ...doc.data() });
                }
            });
            
            // Ubah Map kembali menjadi array dan urutkan berdasarkan tanggal terbaru
            const finalResults = Array.from(resultsMap.values());
            finalResults.sort((a, b) => (b.saleDate?.toDate() || 0) - (a.saleDate?.toDate() || 0));

            renderSalesHistoryTable(finalResults, userRole);

        } catch (error) {
            console.error("Error during search:", error);
            displayMessage("Pencarian gagal. Mungkin diperlukan pembuatan indeks di Firestore. Periksa console untuk detail.", "error");
            if (salesHistoryTableBody) renderSalesHistoryTable([], userRole);
        }
    }
    
    // ... (fungsi showAndPrintReceipt, printContent, dan semua fungsi superadmin tidak berubah) ...
    function showAndPrintReceipt(saleData, autoPrint = false) {
        const receiptModal = document.getElementById('receiptModal');
        const receiptContentEl = document.getElementById('receiptContent');
        const printReceiptButton = document.getElementById('printReceiptButton');
        const closeReceiptButton = document.getElementById('closeReceiptButton');
        if (!receiptModal || !receiptContentEl || !printReceiptButton || !closeReceiptButton) return;
        
        const receiptDate = (saleData.saleDate instanceof Date) 
            ? saleData.saleDate.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
            : formatDate(saleData.saleDate); 

        let itemsHtml = saleData.items.map(item => `
            <div>${item.name}</div>
            <div style="display: flex; justify-content: space-between;">
                <span>&nbsp;${item.quantity} x ${item.priceAtSale.toLocaleString('id-ID')}</span>
                <span>${item.subtotal.toLocaleString('id-ID')}</span>
            </div>
        `).join('');

        const thermalHtml = `
            <div style="text-align: center; margin-bottom: 8px;">
                <strong style="font-size: 1.1em;">Apotek Hasanah Rahayu</strong><br>
                Kp. Babakan, RT 02 RW 04, Curug Bitung<br>
                Nanggung, Kab. Bogor, 16650<br>
                HP: 081717150696
            </div>
            <hr>
            <div>Tanggal: ${receiptDate}</div>
            <div>No. Nota: ${saleData.receiptId}</div>
            <div>Kasir: ${saleData.kasirEmail}</div>
            <div>Pasien: ${saleData.patientName || 'Umum'}</div>
            <hr>
            ${itemsHtml}
            <hr>
            <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 1.1em;">
                <span>TOTAL</span>
                <span>${formatRupiah(saleData.totalAmount)}</span>
            </div>
            <hr>
            <div style="text-align: center; margin-top: 8px;">Terima kasih atas kunjungan Anda!</div>
        `;
        
        const fullHtmlForPrint = `
            <html><head><title>Struk Pembelian</title>
            <style>
                @media print { @page { size: auto; margin: 0; } body { margin: 4mm; color-adjust: exact; -webkit-print-color-adjust: exact; } }
                body { font-family: 'Courier New', Courier, monospace; font-size: 10pt; line-height: 1.4; }
                hr { border: 0; border-top: 1px dashed black; margin: 8px 0; }
            </style></head><body>${thermalHtml}</body></html>
        `;

        receiptContentEl.innerHTML = thermalHtml;
        receiptModal.classList.remove('hidden');
        printReceiptButton.onclick = () => printContent(fullHtmlForPrint);
        closeReceiptButton.onclick = () => receiptModal.classList.add('hidden');
        if (autoPrint) printContent(fullHtmlForPrint);
    }
    function printContent(receiptHtml) {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute'; iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
        document.body.appendChild(iframe);
        const doc = iframe.contentWindow.document;
        doc.open(); doc.write(receiptHtml); doc.close();
        iframe.onload = function() {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => document.body.removeChild(iframe), 1000);
        };
    }
    function openEditSaleModal(sale) {
        const modal = document.getElementById('editSaleModal');
        if (!modal) return;
        document.getElementById('editSaleId').value = sale.id;
        document.getElementById('editPatientName').value = sale.patientName || '';
        const saleDate = sale.saleDate.toDate ? sale.saleDate.toDate() : new Date(sale.saleDate);
        document.getElementById('editSaleDate').value = saleDate.toISOString().split('T')[0];
        modal.classList.remove('hidden');
    }
    function closeEditSaleModal() {
        const modal = document.getElementById('editSaleModal');
        if (modal) modal.classList.add('hidden');
    }
    async function handleUpdateSale(e) {
        e.preventDefault();
        const saleId = document.getElementById('editSaleId').value;
        const patientName = document.getElementById('editPatientName').value;
        const saleDate = document.getElementById('editSaleDate').value;
        if (!saleId) return;

        showLoading(true, 'editSaleLoadingIndicator');
        const saleDocRef = doc(getSalesCollectionRef(), saleId);
        try {
            await updateDoc(saleDocRef, { patientName: patientName, saleDate: new Date(saleDate) });
            displayMessage("Data penjualan berhasil diperbarui.", "success");
            closeEditSaleModal();
            loadSalesHistory(userRole); // Muat ulang halaman saat ini
        } catch (error) {
            console.error("Error updating sale:", error);
            displayMessage("Gagal memperbarui data: " + error.message, "error");
        } finally {
            showLoading(false, 'editSaleLoadingIndicator');
        }
    }
    function confirmDeleteSale(sale, userRole) {
        const modal = document.getElementById('confirmationModal');
        const message = document.getElementById('confirmationMessage');
        const confirmBtn = document.getElementById('confirmDeleteButton');
        const cancelBtn = document.getElementById('cancelDeleteButton');
        if (!modal || !message || !confirmBtn || !cancelBtn) return;
        
        message.textContent = `Anda yakin ingin menghapus nota ${sale.receiptId}? Stok barang yang terjual akan dikembalikan ke inventaris. Tindakan ini tidak dapat dibatalkan.`;
        modal.classList.remove('hidden');

        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        newConfirmBtn.addEventListener('click', () => {
            performDeleteSale(sale, userRole);
            modal.classList.add('hidden');
        }, { once: true });

        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.addEventListener('click', () => modal.classList.add('hidden'), { once: true });
    }
    async function performDeleteSale(sale, userRole) {
        showLoading(true, 'saleLoadingIndicator');
        const db = getDb();
        const saleDocRef = doc(getSalesCollectionRef(), sale.id);
        const inventoryCollectionRef = getInventoryCollectionRef();

        try {
            await runTransaction(db, async (transaction) => {
                const saleDoc = await transaction.get(saleDocRef);
                if (!saleDoc.exists()) throw new Error("Dokumen penjualan tidak ditemukan.");
                for (const item of sale.items) {
                    const productDocRef = doc(inventoryCollectionRef, item.productId);
                    const productDoc = await transaction.get(productDocRef);
                    if (productDoc.exists()) {
                        const newStock = (productDoc.data().stock || 0) + item.quantity;
                        transaction.update(productDocRef, { stock: newStock });
                    }
                }
                transaction.delete(saleDocRef);
            });
            displayMessage(`Nota ${sale.receiptId} berhasil dihapus dan stok telah dikembalikan.`, 'success');
            loadSalesHistory(userRole); // Muat ulang halaman saat ini
        } catch (error) {
            console.error("Error deleting sale:", error);
            displayMessage("Gagal menghapus penjualan: " + error.message, "error");
        } finally {
            showLoading(false, 'saleLoadingIndicator');
        }
    }
    
    // --- Inisialisasi Event Listener Utama ---
    if (saleItemSearchInput) saleItemSearchInput.addEventListener('input', handleSaleItemSearch);
    document.addEventListener('click', (event) => {
        if (saleItemSearchInput && saleItemSearchResults && !saleItemSearchInput.contains(event.target) && !saleItemSearchResults.contains(event.target)) {
            saleItemSearchResults.classList.add('hidden');
        }
    });

    if (finalizeSaleButton) finalizeSaleButton.addEventListener('click', handleFinalizeSale);
    // PERUBAHAN DI SINI: Terapkan debounce pada listener pencarian
    if (searchSalesHistoryInput) searchSalesHistoryInput.addEventListener('input', debounce(handleSalesHistorySearch, 500));
    if (editSaleForm) editSaleForm.addEventListener('submit', (e) => handleUpdateSale(e, userRole));
    if (cancelEditSaleButton) cancelEditSaleButton.addEventListener('click', closeEditSaleModal);
    if (nextPageButton) nextPageButton.addEventListener('click', () => loadNextPage(userRole));
    if (prevPageButton) prevPageButton.addEventListener('click', () => loadPrevPage(userRole));
    
    // Inisialisasi data
    initializeInventoryManagement(userRole);
    loadSalesHistory(userRole); // Memuat halaman pertama dari riwayat penjualan
}
