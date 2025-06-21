import { displayMessage, formatRupiah, formatDate } from './main.js';
import { subscribeToAuthReady } from './auth.js';
import {
    getExpensesCollectionRef,
    getSalesCollectionRef,
    getInventoryCollectionRef,
    query,
    where,
    getDocs
} from './firestore_utils.js';

let allSdmExpenses = [];
let allPatientSales = [];
let allInventoryItems = [];

document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => {
        const loadingGlobal = document.getElementById('loadingOverlay');
        if (loadingGlobal) loadingGlobal.classList.add('hidden');

        // =================================================================
        // PERBAIKAN DI SINI: Izinkan akses untuk 'admin' atau 'superadmin'
        // =================================================================
        const hasAccess = role === 'admin' || role === 'superadmin';

        if (userId && hasAccess) {
            initializeManajemenPage();
            document.getElementById('mainContent')?.classList.remove('hidden');
            document.getElementById('accessDeniedMessage')?.classList.add('hidden');
        } else {
            document.getElementById('mainContent')?.classList.add('hidden');
            document.getElementById('accessDeniedMessage')?.classList.remove('hidden');
        }
    });
});

function initializeManajemenPage() {
    setupTabNavigation();
    fetchAllData();
}

function setupTabNavigation() {
    const tabs = document.querySelectorAll('.tab-button-manajemen');
    const tabContents = document.querySelectorAll('.tab-content-manajemen');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(item => {
                item.classList.remove('text-green-600', 'border-green-500');
                item.classList.add('text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300', 'border-transparent');
            });
            tab.classList.add('text-green-600', 'border-green-500');
            tabContents.forEach(content => content.classList.add('hidden'));
            document.getElementById(tab.dataset.tabTarget + 'Content')?.classList.remove('hidden');
        });
    });
}

async function fetchAllData() {
    const loadingIndicator = document.getElementById('loadingIndicatorManajemen');
    if (loadingIndicator) loadingIndicator.classList.remove('hidden');

    try {
        const expensesQuery = query(getExpensesCollectionRef(), where("category", "==", "Gaji & Upah"));
        const salesQuery = query(getSalesCollectionRef(), where("patientName", ">", ""));
        const inventoryQuery = query(getInventoryCollectionRef(), where("distributor", ">", ""));

        const [sdmSnapshot, pasienSnapshot, distributorSnapshot] = await Promise.all([
            getDocs(expensesQuery),
            getDocs(salesQuery),
            getDocs(inventoryQuery)
        ]);

        allSdmExpenses = sdmSnapshot.docs.map(doc => doc.data());
        allPatientSales = pasienSnapshot.docs.map(doc => doc.data());
        allInventoryItems = distributorSnapshot.docs.map(doc => doc.data());

        initializeAllTabs();

    } catch (error) {
        console.error("Gagal mengambil data untuk manajemen:", error);
        displayMessage(`Terjadi kesalahan: ${error.message}`, 'error');
    } finally {
        if (loadingIndicator) loadingIndicator.classList.add('hidden');
    }
}

function initializeAllTabs() {
    initializeSdmTab();
    initializePasienTab();
    initializeDistributorTab();
}

function createSearchableDropdown(containerId, data, onSelectCallback, emptyStateId) {
    const container = document.getElementById(containerId);
    const emptyState = document.getElementById(emptyStateId);
    if (!container) return;

    if (data.length === 0) {
        container.classList.add('hidden');
        if(emptyState) emptyState.classList.remove('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    if(emptyState) emptyState.classList.add('hidden');

    const input = container.querySelector('input[type="text"]');
    const button = container.querySelector('button');
    const list = container.querySelector('.custom-dropdown-list');
    const svgIcon = button.querySelector('svg');

    const toggleDropdown = (show) => {
        if (show) {
            list.classList.remove('hidden');
            svgIcon.classList.add('rotate-180');
        } else {
            list.classList.add('hidden');
            svgIcon.classList.remove('rotate-180');
        }
    };

    const populateList = (filter = '') => {
        list.innerHTML = '';
        const filteredData = data.filter(item => item.toLowerCase().includes(filter.toLowerCase()));
        if (filteredData.length === 0) {
            list.innerHTML = `<div class="px-3 py-2 text-gray-500">Tidak ditemukan.</div>`;
        }
        filteredData.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.textContent = item;
            itemEl.className = 'px-3 py-2 hover:bg-green-100 cursor-pointer';
            itemEl.onclick = () => {
                input.value = item;
                toggleDropdown(false);
                onSelectCallback(item);
            };
            list.appendChild(itemEl);
        });
    };

    input.addEventListener('input', () => {
        populateList(input.value);
        toggleDropdown(true);
    });
    input.addEventListener('focus', () => {
        populateList(input.value);
        toggleDropdown(true);
    });
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown(!list.classList.contains('hidden'));
    });
    
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            toggleDropdown(false);
        }
    });

    populateList();
}

function initializeSdmTab() {
    const sdmNames = [...new Set(allSdmExpenses.map(item => item.description.trim()))].sort();
    createSearchableDropdown('sdmDropdownContainer', sdmNames, renderSdmDetails, 'sdmEmptyState');
}

function renderSdmDetails(name) {
    const detailsDiv = document.getElementById('sdmDetails');
    if (!name) { detailsDiv?.classList.add('hidden'); return; }
    
    const tableBody = document.getElementById('gajiTableBody');
    const totalGajiEl = document.getElementById('sdmTotalGaji');
    const rataGajiEl = document.getElementById('sdmRataGaji');

    const filteredExpenses = allSdmExpenses.filter(item => item.description.trim() === name);
    tableBody.innerHTML = '';
    let totalGaji = 0;

    filteredExpenses.sort((a,b) => b.date.toDate() - a.date.toDate()).forEach(expense => {
        tableBody.insertRow().innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${formatDate(expense.date)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${expense.description}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-medium">${formatRupiah(expense.amount)}</td>`;
        totalGaji += expense.amount;
    });

    const monthlyData = {};
    filteredExpenses.forEach(exp => {
        const monthYear = exp.date.toDate().toLocaleDateString('id-ID', { month: '2-digit', year: 'numeric' });
        monthlyData[monthYear] = (monthlyData[monthYear] || 0) + exp.amount;
    });
    const months = Object.keys(monthlyData).length;
    const rataGaji = months > 0 ? totalGaji / months : 0;
    
    totalGajiEl.textContent = formatRupiah(totalGaji);
    rataGajiEl.textContent = formatRupiah(rataGaji);
    detailsDiv.classList.remove('hidden');
}

function initializePasienTab() {
    const patientNames = [...new Set(allPatientSales.map(sale => sale.patientName.trim()))].sort();
    createSearchableDropdown('pasienDropdownContainer', patientNames, renderPasienDetails, 'pasienEmptyState');
}

function renderPasienDetails(name) {
    const detailsDiv = document.getElementById('pasienDetails');
    if (!name) { detailsDiv?.classList.add('hidden'); return; }

    const tableBody = document.getElementById('pasienTableBody');
    const totalBelanjaEl = document.getElementById('pasienTotalBelanja');
    const produkFavoritEl = document.getElementById('pasienProdukFavorit');

    const filteredSales = allPatientSales.filter(sale => sale.patientName.trim() === name);
    tableBody.innerHTML = '';
    let totalBelanja = 0;
    const allItemsBought = [];

    filteredSales.sort((a, b) => b.saleDate.toDate() - a.saleDate.toDate()).forEach(sale => {
        totalBelanja += sale.totalAmount;
        sale.items.forEach(item => {
            tableBody.insertRow().innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${formatDate(sale.saleDate)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${item.name}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${item.quantity}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-medium">${formatRupiah(item.priceAtSale)}</td>`;
            let existingItem = allItemsBought.find(i => i.name === item.name);
            if (existingItem) existingItem.quantity += item.quantity;
            else allItemsBought.push({ name: item.name, quantity: item.quantity });
        });
    });

    let favorit = '-';
    if (allItemsBought.length > 0) {
        const sortedItems = allItemsBought.sort((a,b) => b.quantity - a.quantity);
        favorit = `${sortedItems[0].name} (x${sortedItems[0].quantity})`;
    }

    totalBelanjaEl.textContent = formatRupiah(totalBelanja);
    produkFavoritEl.textContent = favorit;
    detailsDiv.classList.remove('hidden');
}

function initializeDistributorTab() {
    const distributorNames = [...new Set(allInventoryItems.map(item => item.distributor.trim()))].sort();
    createSearchableDropdown('distributorDropdownContainer', distributorNames, renderDistributorDetails, 'distributorEmptyState');
}

function renderDistributorDetails(name) {
    const detailsDiv = document.getElementById('distributorDetails');
    if (!name) { detailsDiv?.classList.add('hidden'); return; }

    const tableBody = document.getElementById('distributorTableBody');
    const totalProdukEl = document.getElementById('distributorTotalProduk');
    const nilaiStokEl = document.getElementById('distributorNilaiStok');
    
    const filteredItems = allInventoryItems.filter(item => item.distributor.trim() === name);
    tableBody.innerHTML = '';
    let nilaiStok = 0;

    filteredItems.sort((a,b) => a.name.localeCompare(b.name)).forEach(item => {
        tableBody.insertRow().innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${item.name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${item.category}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${item.stock}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-medium">${formatRupiah(item.buyPrice)}</td>`;
        nilaiStok += (item.stock * item.buyPrice);
    });

    totalProdukEl.textContent = filteredItems.length;
    nilaiStokEl.textContent = formatRupiah(nilaiStok);
    detailsDiv.classList.remove('hidden');
}
