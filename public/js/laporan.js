import { displayMessage, showLoading, formatRupiah, formatDate } from './main.js';
import { subscribeToAuthReady } from './auth.js';
// Pastikan APOTEK_ID diekspor dari firebase-config.js
// contoh di firebase-config.js: export const APOTEK_ID = 'nama_apotek_unik';
import { APOTEK_ID } from './firebase-config.js'; 
import { getSalesCollectionRef, query, where, getDocs, Timestamp } from './firestore_utils.js';

let salesAndProfitChartInstance = null;
let currentSalesDataForExport = [];

document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => {
        const loadingGlobal = document.getElementById('loadingOverlay');
        if (loadingGlobal) loadingGlobal.classList.add('hidden');

        if (userId && role === 'admin') {
            initializeLaporanPage();
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
        const loadingLaporan = document.getElementById('loadingIndicatorLaporan');
        if (loadingLaporan) loadingLaporan.classList.add('hidden');
    });
});

function initializeLaporanPage() {
    const reportTypeSelect = document.getElementById('reportType');
    const datePickerGroups = document.querySelectorAll('.date-picker-group');
    const dailyDateInput = document.getElementById('dailyDate');
    const weeklyDateInput = document.getElementById('weeklyDate');
    const monthlyDateInput = document.getElementById('monthlyDate');
    const startDateCustomInput = document.getElementById('startDateCustom');
    const endDateCustomInput = document.getElementById('endDateCustom');
    const generateReportButton = document.getElementById('generateReportButton');
    const downloadExcelButton = document.getElementById('downloadExcelButton');
    const reportResultsDiv = document.getElementById('reportResults');
    const noReportDataDiv = document.getElementById('noReportData');
    const reportTableBody = document.getElementById('reportTableBody');
    const totalSalesAmountEl = document.getElementById('totalSalesAmount');
    const totalProfitAmountEl = document.getElementById('totalProfitAmount');
    const totalTransactionsEl = document.getElementById('totalTransactions');
    const bestSellingProductEl = document.getElementById('bestSellingProduct');

    const today = new Date();
    const todayISO = today.toISOString().split('T')[0];
    if (dailyDateInput) dailyDateInput.value = todayISO;
    if (weeklyDateInput) weeklyDateInput.value = todayISO;
    if (monthlyDateInput) monthlyDateInput.value = today.toISOString().slice(0, 7);
    if (startDateCustomInput) startDateCustomInput.value = todayISO;
    if (endDateCustomInput) endDateCustomInput.value = todayISO;

    if (reportTypeSelect) {
        reportTypeSelect.addEventListener('change', (e) => {
            datePickerGroups.forEach(group => group.classList.add('hidden'));
            const selectedPickerId = `datePicker${e.target.value.charAt(0).toUpperCase() + e.target.value.slice(1)}`;
            const selectedPicker = document.getElementById(selectedPickerId);
            if (selectedPicker) selectedPicker.classList.remove('hidden');
        });
        reportTypeSelect.dispatchEvent(new Event('change'));
    }

    if (generateReportButton) {
        generateReportButton.addEventListener('click', fetchAndDisplayReport);
    }

    if (downloadExcelButton) {
        downloadExcelButton.addEventListener('click', exportReportToExcel);
    }

    async function fetchAndDisplayReport() {
        showLoading(true, 'loadingIndicatorLaporan');
        if (reportResultsDiv) reportResultsDiv.classList.add('hidden');
        if (noReportDataDiv) noReportDataDiv.classList.add('hidden');
        if (reportTableBody) reportTableBody.innerHTML = '';
        if (downloadExcelButton) downloadExcelButton.classList.add('hidden');
        currentSalesDataForExport = [];

        const salesCollectionRef = getSalesCollectionRef();
        if (!salesCollectionRef) {
            displayMessage("Gagal mendapatkan referensi database penjualan.", "error");
            showLoading(false, 'loadingIndicatorLaporan');
            return;
        }

        const type = reportTypeSelect.value;
        let startDate, endDate;

        try {
            switch (type) {
                case 'daily':
                    const dailyVal = dailyDateInput.value;
                    if (!dailyVal) throw new Error("Tanggal harian harus diisi.");
                    startDate = new Date(dailyVal + "T00:00:00");
                    endDate = new Date(dailyVal + "T23:59:59.999");
                    break;
                case 'weekly':
                    const weeklyVal = weeklyDateInput.value;
                    if (!weeklyVal) throw new Error("Tanggal mingguan harus diisi.");
                    const selectedWeekDate = new Date(weeklyVal + "T00:00:00");
                    const dayOfWeek = selectedWeekDate.getDay();
                    const diffToMonday = selectedWeekDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
                    startDate = new Date(selectedWeekDate.setDate(diffToMonday));
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 6);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'monthly':
                    const monthlyVal = monthlyDateInput.value;
                    if (!monthlyVal) throw new Error("Bulan dan tahun harus diisi.");
                    const [year, month] = monthlyVal.split('-').map(Number);
                    startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
                    endDate = new Date(year, month, 0, 23, 59, 59, 999);
                    break;
                case 'custom':
                    const startCustom = startDateCustomInput.value;
                    const endCustom = endDateCustomInput.value;
                    if (!startCustom || !endCustom) throw new Error("Rentang tanggal kustom harus diisi lengkap.");
                    startDate = new Date(startCustom + "T00:00:00");
                    endDate = new Date(endCustom + "T23:59:59.999");
                    if (startDate > endDate) throw new Error("Tanggal mulai tidak boleh setelah tanggal akhir.");
                    break;
                default:
                    throw new Error("Jenis laporan tidak valid.");
            }
        } catch (error) {
            displayMessage(error.message, "error");
            showLoading(false, 'loadingIndicatorLaporan');
            return;
        }
        
        try {
            const q = query(salesCollectionRef,
                where("saleDate", ">=", Timestamp.fromDate(startDate)),
                where("saleDate", "<=", Timestamp.fromDate(endDate))
            );
            const querySnapshot = await getDocs(q);
            const salesData = [];
            querySnapshot.forEach((doc) => salesData.push({ firestoreId: doc.id, ...doc.data() }));
            
            salesData.sort((a, b) => {
                const dateA = a.saleDate && a.saleDate.toDate ? a.saleDate.toDate() : new Date(0);
                const dateB = b.saleDate && b.saleDate.toDate ? b.saleDate.toDate() : new Date(0);
                return dateB - dateA;
            });

            currentSalesDataForExport = salesData;

            if (salesData.length === 0) {
                if (noReportDataDiv) noReportDataDiv.classList.remove('hidden');
                if (reportResultsDiv) reportResultsDiv.classList.add('hidden');
            } else {
                if (reportResultsDiv) reportResultsDiv.classList.remove('hidden');
                if (noReportDataDiv) noReportDataDiv.classList.add('hidden');
                if (downloadExcelButton) downloadExcelButton.classList.remove('hidden');
                renderReportTable(salesData);
                calculateAndDisplaySummary(salesData);
                renderSalesAndProfitChart(salesData, startDate, endDate, type);
            }
        } catch (error) {
            console.error("Error fetching sales report: ", error);
            displayMessage(`Gagal mengambil laporan: ${error.message}`, "error");
        } finally {
            showLoading(false, 'loadingIndicatorLaporan');
        }
    }

    function renderReportTable(sales) {
        if (!reportTableBody) return;
        reportTableBody.innerHTML = '';
        sales.forEach(sale => {
            const row = reportTableBody.insertRow();
            const saleDate = sale.saleDate && sale.saleDate.toDate ? 
                             sale.saleDate.toDate().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';
            row.insertCell().textContent = saleDate;
            row.insertCell().textContent = `NOTA-${sale.receiptId || sale.firestoreId.substring(0, 6).toUpperCase()}`;
            
            const itemsSummary = sale.items.map(i => `${i.name} (x${i.quantity})`).join(', ');
            const itemsCell = row.insertCell();
            itemsCell.textContent = itemsSummary.length > 50 ? itemsSummary.substring(0, 47) + '...' : itemsSummary;
            itemsCell.title = itemsSummary;

            row.insertCell().textContent = formatRupiah(sale.totalAmount);
            
            let profitThisSale = 0;
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const buyPrice = item.buyPriceAtSale !== undefined ? item.buyPriceAtSale : (item.buyPrice || 0);
                    const price = item.priceAtSale !== undefined ? item.priceAtSale : (item.price || 0);
                    profitThisSale += (price - buyPrice) * item.quantity;
                });
            }
            row.insertCell().textContent = formatRupiah(profitThisSale);
        });
    }

    function calculateAndDisplaySummary(sales) {
        if (!totalSalesAmountEl || !totalProfitAmountEl || !totalTransactionsEl || !bestSellingProductEl) return;
        
        const totalSales = sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
        let totalProfit = 0;
        const productQuantities = {};

        sales.forEach(sale => {
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const buyPrice = item.buyPriceAtSale !== undefined ? item.buyPriceAtSale : (item.buyPrice || 0);
                    const price = item.priceAtSale !== undefined ? item.priceAtSale : (item.price || 0);
                    totalProfit += (price - buyPrice) * item.quantity;
                    productQuantities[item.name] = (productQuantities[item.name] || 0) + item.quantity;
                });
            }
        });

        totalSalesAmountEl.textContent = formatRupiah(totalSales);
        totalProfitAmountEl.textContent = formatRupiah(totalProfit);
        totalTransactionsEl.textContent = sales.length;

        let maxQty = 0;
        let bestSeller = '-';
        for (const productName in productQuantities) {
            if (productQuantities[productName] > maxQty) {
                maxQty = productQuantities[productName];
                bestSeller = productName;
            }
        }
        bestSellingProductEl.textContent = maxQty > 0 ? `${bestSeller} (x${maxQty})` : '-';
    }

    function renderSalesAndProfitChart(salesData, startDate, endDate, reportType) {
        const ctx = document.getElementById('salesAndProfitChart')?.getContext('2d');
        if (!ctx) {
            console.error("Elemen canvas 'salesAndProfitChart' tidak ditemukan.");
            return;
        }

        if (salesAndProfitChartInstance) {
            salesAndProfitChartInstance.destroy();
        }

        let labels = [];
        const salesByTime = {};
        const profitByTime = {};

        const rangeInDays = (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);
        
        if (rangeInDays <= 1.5) { // Laporan harian (tunggal) -> per jam
            for (let i = 0; i < 24; i++) {
                const hour = i.toString().padStart(2, '0');
                labels.push(`${hour}:00`);
                salesByTime[`${hour}:00`] = 0;
                profitByTime[`${hour}:00`] = 0;
            }
        } else if (rangeInDays <= 31) { // Laporan < 1 bulan -> per tanggal
            let currentDate = new Date(startDate);
            while(currentDate <= endDate) {
                const key = currentDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
                labels.push(key);
                salesByTime[key] = 0;
                profitByTime[key] = 0;
                currentDate.setDate(currentDate.getDate() + 1);
            }
        } else { // Laporan > 1 bulan -> per bulan
             let currentMonthIter = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
             while(currentMonthIter <= endDate) {
                const key = currentMonthIter.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
                labels.push(key);
                salesByTime[key] = 0;
                profitByTime[key] = 0;
                currentMonthIter.setMonth(currentMonthIter.getMonth() + 1);
             }
        }
        
        salesData.forEach(sale => {
            if (!sale.saleDate || !sale.saleDate.toDate) return;
            const date = sale.saleDate.toDate();
            let key;
            if (rangeInDays <= 1.5) key = `${date.getHours().toString().padStart(2, '0')}:00`;
            else if (rangeInDays <= 31) key = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
            else key = date.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });

            if (salesByTime.hasOwnProperty(key)) {
                salesByTime[key] += (sale.totalAmount || 0);
                let saleProfit = 0;
                if (sale.items && Array.isArray(sale.items)) {
                    sale.items.forEach(item => {
                        const buyPrice = item.buyPriceAtSale !== undefined ? item.buyPriceAtSale : (item.buyPrice || 0);
                        const price = item.priceAtSale !== undefined ? item.priceAtSale : (item.price || 0);
                        saleProfit += (price - buyPrice) * item.quantity;
                    });
                }
                profitByTime[key] += saleProfit;
            }
        });
        
        const salesPoints = labels.map(label => salesByTime[label] || 0);
        const profitPoints = labels.map(label => profitByTime[label] || 0);

        salesAndProfitChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Total Penjualan (Rp)',
                        data: salesPoints,
                        backgroundColor: 'rgba(34, 197, 94, 0.7)', // Green-600
                        borderColor: 'rgba(22, 163, 74, 1)',     // Green-700
                        borderWidth: 1,
                        yAxisID: 'y', // Menggunakan sumbu Y utama
                        order: 2 // Bar digambar di belakang line
                    },
                    {
                        label: 'Total Keuntungan (Rp)',
                        data: profitPoints,
                        type: 'line',
                        borderColor: 'rgba(79, 70, 229, 1)',   // Indigo-600
                        backgroundColor: 'rgba(79, 70, 229, 0.3)', // Lebih transparan
                        tension: 0.2,
                        fill: true,
                        borderWidth: 2.5,
                        pointRadius: 4,
                        pointBackgroundColor: 'rgba(79, 70, 229, 1)',
                        yAxisID: 'y', // Menggunakan sumbu Y utama
                        order: 1 // Line digambar di atas bar
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Periode' }
                    },
                    y: { // Hanya satu sumbu Y utama
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Jumlah (Rp)' // Judul sumbu Y yang lebih generik
                        },
                        ticks: {
                            callback: function(value) { return formatRupiah(value); }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) label += formatRupiah(context.parsed.y);
                                return label;
                            }
                        }
                    },
                    legend: {
                        position: 'top',
                    }
                }
            }
        });
    }

    function exportReportToExcel() {
        if (currentSalesDataForExport.length === 0) {
            displayMessage("Tidak ada data laporan untuk di-download.", "error");
            return;
        }

        const reportTitle = "Laporan Keuangan Apotek Hasanah Rahayu";
        const periode = document.getElementById('reportType').selectedOptions[0].text;
        let tanggalLaporan = "";
        const type = reportTypeSelect.value;
        if (type === 'daily') tanggalLaporan = dailyDateInput.value;
        else if (type === 'weekly') tanggalLaporan = `Minggu ${weeklyDateInput.value}`;
        else if (type === 'monthly') tanggalLaporan = monthlyDateInput.value;
        else if (type === 'custom') tanggalLaporan = `${startDateCustomInput.value} s/d ${endDateCustomInput.value}`;

        const summaryData = [
            [reportTitle],
            [`Periode: ${periode} (${tanggalLaporan})`],
            [], 
            ["Ringkasan:"],
            ["Total Penjualan", totalSalesAmountEl.textContent],
            ["Total Keuntungan", totalProfitAmountEl.textContent],
            ["Jumlah Transaksi", totalTransactionsEl.textContent],
            ["Produk Terlaris", bestSellingProductEl.textContent],
            [], 
            ["Detail Transaksi:"]
        ];
        
        const headers = ["Tanggal", "ID Nota", "Item Terjual", "Total Penjualan (Rp)", "Total Keuntungan (Rp)"];
        const dataRows = currentSalesDataForExport.map(sale => {
            const saleDate = sale.saleDate && sale.saleDate.toDate ? 
                             sale.saleDate.toDate().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';
            const receiptId = `NOTA-${sale.receiptId || sale.firestoreId.substring(0, 6).toUpperCase()}`;
            const itemsSummary = sale.items.map(i => `${i.name} (x${i.quantity})`).join(', ');
            const totalAmount = parseFloat(sale.totalAmount) || 0;
            
            let profitThisSale = 0;
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                     const buyPrice = item.buyPriceAtSale !== undefined ? item.buyPriceAtSale : (item.buyPrice || 0);
                    const price = item.priceAtSale !== undefined ? item.priceAtSale : (item.price || 0);
                    profitThisSale += (price - buyPrice) * item.quantity;
                });
            }
            
            return [
                saleDate,
                receiptId,
                itemsSummary,
                totalAmount,
                profitThisSale
            ];
        });

        const excelData = summaryData.concat([headers], dataRows);
        const ws = XLSX.utils.aoa_to_sheet(excelData);
        const numFmt = '#,##0'; // Format angka tanpa desimal untuk Rupiah
        const range = XLSX.utils.decode_range(ws['!ref']);

        for (let R = range.s.r; R <= range.e.r; ++R) {
            if (R >= summaryData.length) { 
                const cellAddressSales = XLSX.utils.encode_cell({c: 3, r: R});
                const cellAddressProfit = XLSX.utils.encode_cell({c: 4, r: R});
                if(ws[cellAddressSales] && typeof ws[cellAddressSales].v === 'number') ws[cellAddressSales].z = numFmt;
                if(ws[cellAddressProfit] && typeof ws[cellAddressProfit].v === 'number') ws[cellAddressProfit].z = numFmt;
            }
        }
        const colWidths = [
            { wch: 22 }, { wch: 18 }, { wch: 55 }, { wch: 20 }, { wch: 20 }
        ];
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Laporan Keuangan");
        
        // Gunakan APOTEK_ID dari impor
        const safeApotekId = (typeof APOTEK_ID === 'string' && APOTEK_ID) ? APOTEK_ID.replace(/[^a-zA-Z0-9]/g, '_') : 'Apotek';
        const safeTanggalLaporan = tanggalLaporan.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `Laporan_Keuangan_${safeApotekId}_${safeTanggalLaporan}.xlsx`;
        
        XLSX.writeFile(wb, fileName);
        displayMessage("Laporan berhasil diunduh sebagai Excel.", "success");
    }
}
