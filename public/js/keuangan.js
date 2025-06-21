import { displayMessage, showLoading, formatRupiah, formatDate, updateUserInterfaceForRole } from './main.js';
import { getCurrentUserId, getCurrentUserRole, subscribeToAuthReady } from './auth.js';
import { 
    getSalesCollectionRef, 
    getExpensesCollectionRef, 
    getAccountsCollectionRef, 
    getOtherIncomesCollectionRef,
    getDb, 
    query, 
    where, 
    getDocs, 
    Timestamp, 
    addDoc, 
    updateDoc, 
    doc, 
    serverTimestamp, 
    onSnapshot 
} from './firestore_utils.js';

document.addEventListener('DOMContentLoaded', () => {
    subscribeToAuthReady(({ userId, role }) => {
        const loadingGlobal = document.getElementById('loadingOverlay');
        if (loadingGlobal) loadingGlobal.classList.add('hidden');

        // =================================================================
        // PERBAIKAN DI SINI: Izinkan akses untuk 'admin' atau 'superadmin'
        // =================================================================
        const hasAccess = role === 'admin' || role === 'superadmin';

        if (userId && hasAccess) {
            initializeKeuanganPage();
            document.getElementById('mainContent')?.classList.remove('hidden');
            document.getElementById('accessDeniedMessage')?.classList.add('hidden');
        } else {
            document.getElementById('mainContent')?.classList.add('hidden');
            document.getElementById('accessDeniedMessage')?.classList.remove('hidden');
        }
    });
});

function initializeKeuanganPage() {
    const tabs = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    // Tab Logic
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(item => {
                item.classList.remove('text-green-600', 'border-green-500');
                item.classList.add('text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300', 'border-transparent');
            });
            tab.classList.add('text-green-600', 'border-green-500');
            tab.classList.remove('text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300', 'border-transparent');

            tabContents.forEach(content => {
                content.classList.add('hidden');
            });
            const targetTab = document.getElementById(tab.dataset.tabTarget);
            if (targetTab) {
                targetTab.classList.remove('hidden');
            }
        });
    });

    // Inisialisasi setiap tab
    initializePencatatan();
    initializeUtangPiutang();
    initializeLabaRugi();
    initializeArusKas();
    
    const defaultTab = document.querySelector('button[data-tab-target="labaRugi"]');
    if (defaultTab) {
        defaultTab.click();
    }
}

function initializePencatatan() {
    const incomeForm = document.getElementById('incomeForm');
    const expenseForm = document.getElementById('expenseForm');
    const accountForm = document.getElementById('accountForm');
    
    const incomeDateEl = document.getElementById('incomeDate');
    const expenseDateEl = document.getElementById('expenseDate');
    const accountDueDateEl = document.getElementById('accountDueDate');
    if(incomeDateEl) incomeDateEl.valueAsDate = new Date();
    if(expenseDateEl) expenseDateEl.valueAsDate = new Date();
    if(accountDueDateEl) accountDueDateEl.valueAsDate = new Date();


    if (incomeForm) {
        incomeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const incomeData = {
                date: Timestamp.fromDate(new Date(document.getElementById('incomeDate').value)),
                description: document.getElementById('incomeDescription').value.trim(),
                amount: parseFloat(document.getElementById('incomeAmount').value)
            };
            if (!incomeData.description || isNaN(incomeData.amount) || incomeData.amount <= 0) {
                displayMessage("Deskripsi dan jumlah pendapatan harus diisi dengan benar.", "error"); return;
            }

            try {
                await addDoc(getOtherIncomesCollectionRef(), incomeData);
                displayMessage("Pendapatan lain-lain berhasil dicatat.", "success");
                incomeForm.reset();
                if(incomeDateEl) incomeDateEl.valueAsDate = new Date(); 
            } catch (error) {
                console.error("Error saving income:", error);
                displayMessage(`Gagal menyimpan pendapatan: ${error.message}`, "error");
            }
        });
    }

    if (expenseForm) {
        expenseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const expenseData = {
                date: Timestamp.fromDate(new Date(document.getElementById('expenseDate').value)),
                description: document.getElementById('expenseDescription').value.trim(),
                category: document.getElementById('expenseCategory').value,
                amount: parseFloat(document.getElementById('expenseAmount').value)
            };
            if (!expenseData.description || isNaN(expenseData.amount) || expenseData.amount <= 0) {
                displayMessage("Deskripsi dan jumlah biaya harus diisi dengan benar.", "error"); return;
            }

            try {
                await addDoc(getExpensesCollectionRef(), expenseData);
                displayMessage("Biaya operasional berhasil dicatat.", "success");
                expenseForm.reset();
                if(expenseDateEl) expenseDateEl.valueAsDate = new Date(); 
            } catch (error) {
                console.error("Error saving expense:", error);
                displayMessage(`Gagal menyimpan biaya: ${error.message}`, "error");
            }
        });
    }

    if (accountForm) {
        accountForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const accountData = {
                type: document.getElementById('accountType').value,
                partyName: document.getElementById('partyName').value.trim(),
                description: document.getElementById('accountDescription').value.trim(),
                amount: parseFloat(document.getElementById('accountAmount').value),
                dueDate: Timestamp.fromDate(new Date(document.getElementById('accountDueDate').value)),
                status: 'belum_lunas',
                createdAt: serverTimestamp()
            };
            if (!accountData.partyName || !accountData.description || isNaN(accountData.amount) || accountData.amount <= 0) {
                displayMessage("Semua field utang/piutang harus diisi dengan benar.", "error"); return;
            }

            try {
                await addDoc(getAccountsCollectionRef(), accountData);
                displayMessage("Transaksi utang/piutang berhasil dicatat.", "success");
                accountForm.reset();
                if(accountDueDateEl) accountDueDateEl.valueAsDate = new Date(); 
            } catch (error) {
                console.error("Error saving account:", error);
                displayMessage(`Gagal menyimpan transaksi: ${error.message}`, "error");
            }
        });
    }
}

function initializeUtangPiutang() {
    let unsubscribeUtang = null;
    let unsubscribePiutang = null;
    const utangTableBody = document.getElementById('utangTableBody');
    const piutangTableBody = document.getElementById('piutangTableBody');

    if (!utangTableBody || !piutangTableBody) return;

    if (unsubscribeUtang) unsubscribeUtang();
    const qUtang = query(getAccountsCollectionRef(), where("type", "==", "utang"));
    unsubscribeUtang = onSnapshot(qUtang, snapshot => {
        renderAccountsTable(snapshot, utangTableBody, 'utang');
    }, err => console.error("Error listening to utang:", err));

    if (unsubscribePiutang) unsubscribePiutang();
    const qPiutang = query(getAccountsCollectionRef(), where("type", "==", "piutang"));
    unsubscribePiutang = onSnapshot(qPiutang, snapshot => {
        renderAccountsTable(snapshot, piutangTableBody, 'piutang');
    }, err => console.error("Error listening to piutang:", err));
}

function renderAccountsTable(snapshot, tableBody, type) {
    tableBody.innerHTML = '';
    if (snapshot.empty) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Tidak ada data ${type}.</td></tr>`;
        return;
    }
    const docs = snapshot.docs.sort((a,b) => b.data().createdAt.toDate() - a.data().createdAt.toDate());
    docs.forEach(docSnap => {
        const data = docSnap.data();
        const row = tableBody.insertRow();
        row.insertCell().textContent = data.partyName;
        row.insertCell().textContent = data.description;
        row.insertCell().textContent = formatRupiah(data.amount);
        row.insertCell().textContent = formatDate(data.dueDate);
        
        const statusCell = row.insertCell();
        const statusBadge = document.createElement('span');
        statusBadge.textContent = data.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
        statusBadge.className = `px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${data.status === 'lunas' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
        statusCell.appendChild(statusBadge);

        const actionCell = row.insertCell();
        if (data.status === 'belum_lunas') {
            const payButton = document.createElement('button');
            payButton.textContent = 'Tandai Lunas';
            payButton.className = 'bg-green-500 hover:bg-green-600 text-white text-xs py-1 px-2 rounded';
            payButton.onclick = () => confirmMarkAsPaid(docSnap.id, data);
            actionCell.appendChild(payButton);
        } else {
             actionCell.textContent = data.paidDate ? formatDate(data.paidDate) : 'Lunas';
        }
    });
}

function confirmMarkAsPaid(id, data) {
    const modal = document.getElementById('confirmationModalKeuangan');
    const message = document.getElementById('confirmationMessageKeuangan');
    const confirmBtn = document.getElementById('confirmActionButtonKeuangan');
    const cancelBtn = document.getElementById('cancelActionButtonKeuangan');
    if(!modal || !message || !confirmBtn || !cancelBtn) return;

    message.textContent = `Apakah Anda yakin ingin menandai "${data.description}" sejumlah ${formatRupiah(data.amount)} sebagai lunas?`;
    modal.classList.remove('hidden');

    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.addEventListener('click', async () => {
        modal.classList.add('hidden');
        try {
            const accountDocRef = doc(getAccountsCollectionRef(), id);
            await updateDoc(accountDocRef, {
                status: 'lunas',
                paidDate: serverTimestamp()
            });
            displayMessage("Status berhasil diubah menjadi lunas.", "success");
        } catch (error) {
            console.error("Error marking as paid:", error);
            displayMessage(`Gagal mengubah status: ${error.message}`, "error");
        }
    }, { once: true });

    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    }, { once: true });
}

let cachedLabaRugiData = []; 

function initializeLabaRugi() {
    const startDateInput = document.getElementById('labaRugiStartDate');
    const endDateInput = document.getElementById('labaRugiEndDate');
    const generateBtn = document.getElementById('generateLabaRugiButton');
    const exportBtn = document.getElementById('exportLabaRugiToExcel');
    
    if(!startDateInput || !endDateInput || !generateBtn || !exportBtn) return;
    
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    startDateInput.value = firstDayOfMonth.toISOString().split('T')[0];
    endDateInput.value = lastDayOfMonth.toISOString().split('T')[0];
    
    generateBtn.addEventListener('click', generateLabaRugiReport);
    exportBtn.addEventListener('click', exportLabaRugiToExcel);
    generateLabaRugiReport();
}

async function generateLabaRugiReport() {
    const startDateVal = document.getElementById('labaRugiStartDate').value;
    const endDateVal = document.getElementById('labaRugiEndDate').value;
    if (!startDateVal || !endDateVal) {
        displayMessage("Silakan pilih rentang tanggal.", "error"); return;
    }
    const startDate = new Date(startDateVal); startDate.setHours(0,0,0,0);
    const endDate = new Date(endDateVal); endDate.setHours(23,59,59,999);
    
    document.getElementById('labaRugiResult').classList.add('hidden');
    cachedLabaRugiData = [];

    try {
        const salesQuery = query(getSalesCollectionRef(), where("saleDate", ">=", startDate), where("saleDate", "<=", endDate));
        const salesSnapshot = await getDocs(salesQuery);
        let totalPenjualan = 0;
        let totalHpp = 0;
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            totalPenjualan += sale.totalAmount;
            if (Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    totalHpp += (item.buyPriceAtSale || 0) * item.quantity;
                });
            }
        });

        const expensesQuery = query(getExpensesCollectionRef(), where("date", ">=", startDate), where("date", "<=", endDate));
        const expensesSnapshot = await getDocs(expensesQuery);
        let totalBiaya = 0;
        const detailBiaya = {};
        expensesSnapshot.forEach(doc => {
            const expense = doc.data();
            totalBiaya += expense.amount;
            detailBiaya[expense.category] = (detailBiaya[expense.category] || 0) + expense.amount;
        });

        const incomesQuery = query(getOtherIncomesCollectionRef(), where("date", ">=", startDate), where("date", "<=", endDate));
        const incomesSnapshot = await getDocs(incomesQuery);
        let totalPendapatanLain = 0;
        incomesSnapshot.forEach(doc => {
            totalPendapatanLain += doc.data().amount;
        });

        const labaKotor = totalPenjualan - totalHpp;
        const labaBersih = labaKotor + totalPendapatanLain - totalBiaya;

        document.getElementById('lrTotalPenjualan').textContent = formatRupiah(totalPenjualan);
        document.getElementById('lrTotalHpp').textContent = `(${formatRupiah(totalHpp)})`;
        document.getElementById('lrLabaKotor').textContent = formatRupiah(labaKotor);
        document.getElementById('lrPendapatanLain').textContent = formatRupiah(totalPendapatanLain);
        document.getElementById('lrTotalBiaya').textContent = `(${formatRupiah(totalBiaya)})`;
        document.getElementById('lrLabaBersih').textContent = formatRupiah(labaBersih);
        
        const labaBersihEl = document.getElementById('lrLabaBersih');
        if(labaBersih < 0) {
            labaBersihEl.classList.remove('text-blue-600');
            labaBersihEl.classList.add('text-red-600');
        } else {
            labaBersihEl.classList.remove('text-red-600');
            labaBersihEl.classList.add('text-blue-600');
        }

        const lrDetailBiayaEl = document.getElementById('lrDetailBiaya');
        lrDetailBiayaEl.innerHTML = '';
        Object.keys(detailBiaya).sort().forEach(category => {
            const el = document.createElement('div');
            el.className = 'flex justify-between';
            el.innerHTML = `<span>- ${category}</span><span>(${formatRupiah(detailBiaya[category])})</span>`;
            lrDetailBiayaEl.appendChild(el);
        });
        
        cachedLabaRugiData = [
            ["Laporan Laba Rugi", `Periode: ${formatDate(startDate)} - ${formatDate(endDate)}`],
            [], 
            ["Total Penjualan", "", totalPenjualan],
            ["Harga Pokok Penjualan (HPP)", "", -totalHpp],
            ["Laba Kotor", "", labaKotor],
            ["Pendapatan Lain-lain", "", totalPendapatanLain],
            [], 
            ["Biaya Operasional"],
            ...Object.keys(detailBiaya).sort().map(cat => [`- ${cat}`, `(${formatRupiah(detailBiaya[cat])})`]),
            ["Total Biaya Operasional", "", -totalBiaya],
            [], 
            ["LABA BERSIH", "", labaBersih]
        ];

        document.getElementById('labaRugiPeriod').textContent = `(${formatDate(startDate)} - ${formatDate(endDate)})`;
        document.getElementById('labaRugiResult').classList.remove('hidden');

    } catch(error) {
        console.error("Error generating profit loss report:", error);
        displayMessage(`Gagal membuat laporan: ${error.message}`, "error");
    }
}

function exportLabaRugiToExcel() {
    if (cachedLabaRugiData.length === 0) {
        displayMessage("Tidak ada data untuk diexport. Tampilkan laporan terlebih dahulu.", "error");
        return;
    }
    const worksheet = XLSX.utils.aoa_to_sheet(cachedLabaRugiData);
    worksheet['!cols'] = [{wch: 30}, {wch: 20}, {wch: 20}];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Laba Rugi");
    XLSX.writeFile(workbook, `Laporan_Laba_Rugi_${new Date().toISOString().split('T')[0]}.xlsx`);
    displayMessage("Laporan Laba Rugi berhasil diexport.", "success");
}

function initializeArusKas() {
    const startDateInput = document.getElementById('arusKasStartDate');
    const endDateInput = document.getElementById('arusKasEndDate');
    const generateBtn = document.getElementById('generateArusKasButton');
    const exportBtn = document.getElementById('exportArusKasToExcel');
    
    if(!startDateInput || !endDateInput || !generateBtn || !exportBtn) return;

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    startDateInput.value = firstDayOfMonth.toISOString().split('T')[0];
    endDateInput.value = lastDayOfMonth.toISOString().split('T')[0];
    
    generateBtn.addEventListener('click', generateArusKasReport);
    exportBtn.addEventListener('click', exportArusKasToExcel);
    generateArusKasReport();
}

let cachedArusKasData = []; 

async function generateArusKasReport() {
    const startDateVal = document.getElementById('arusKasStartDate').value;
    const endDateVal = document.getElementById('arusKasEndDate').value;
    const kasAwal = parseFloat(document.getElementById('kasAwal').value) || 0;

    if (!startDateVal || !endDateVal) {
        displayMessage("Silakan pilih rentang tanggal.", "error"); return;
    }
    const startDate = new Date(startDateVal); startDate.setHours(0,0,0,0);
    const endDate = new Date(endDateVal); endDate.setHours(23,59,59,999);
    
    const arusKasResultDiv = document.getElementById('arusKasResult');
    const tableBody = document.getElementById('arusKasTableBody');
    arusKasResultDiv.classList.add('hidden');
    tableBody.innerHTML = '';
    cachedArusKasData = [];

    try {
        let allTransactions = [];

        const salesQuery = query(getSalesCollectionRef(), where("saleDate", ">=", startDate), where("saleDate", "<=", endDate));
        const salesSnapshot = await getDocs(salesQuery);
        salesSnapshot.forEach(doc => {
            const sale = doc.data();
            allTransactions.push({
                date: sale.saleDate.toDate(),
                description: `Penjualan (Nota SALE-${doc.id.substring(0,6)})`,
                type: 'in',
                amount: sale.totalAmount
            });
        });
        
        const incomesQuery = query(getOtherIncomesCollectionRef(), where("date", ">=", startDate), where("date", "<=", endDate));
        const incomesSnapshot = await getDocs(incomesQuery);
        incomesSnapshot.forEach(doc => {
            const income = doc.data();
            allTransactions.push({
                date: income.date.toDate(),
                description: `Pendapatan: ${income.description}`,
                type: 'in',
                amount: income.amount
            });
        });

        const expensesQuery = query(getExpensesCollectionRef(), where("date", ">=", startDate), where("date", "<=", endDate));
        const expensesSnapshot = await getDocs(expensesQuery);
        expensesSnapshot.forEach(doc => {
            const expense = doc.data();
            allTransactions.push({
                date: expense.date.toDate(),
                description: `Biaya: ${expense.description}`,
                type: 'out',
                amount: expense.amount
            });
        });

        const accountsQuery = query(getAccountsCollectionRef(), where("status", "==", "lunas"), where("paidDate", ">=", startDate), where("paidDate", "<=", endDate));
        const accountsSnapshot = await getDocs(accountsQuery);
        accountsSnapshot.forEach(doc => {
            const account = doc.data();
            allTransactions.push({
                date: account.paidDate.toDate(),
                description: account.type === 'utang' ? `Pembayaran Utang: ${account.description}` : `Penerimaan Piutang: ${account.description}`,
                type: account.type === 'utang' ? 'out' : 'in',
                amount: account.amount
            });
        });

        allTransactions.sort((a, b) => a.date - b.date);
        cachedArusKasData = allTransactions;

        let saldoBerjalan = kasAwal;
        let totalKasMasuk = 0;
        let totalKasKeluar = 0;
        
        const initialRow = tableBody.insertRow();
        initialRow.innerHTML = `<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900" colspan="2">Saldo Awal</td>
                               <td></td><td></td>
                               <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-right">${formatRupiah(saldoBerjalan)}</td>`;


        allTransactions.forEach(trx => {
            const row = tableBody.insertRow();
            let kasMasuk = 0, kasKeluar = 0;
            if (trx.type === 'in') {
                kasMasuk = trx.amount;
                totalKasMasuk += kasMasuk;
                saldoBerjalan += kasMasuk;
            } else {
                kasKeluar = trx.amount;
                totalKasKeluar += kasKeluar;
                saldoBerjalan -= kasKeluar;
            }

            row.insertCell().textContent = formatDate(trx.date);
            const descCell = row.insertCell();
            descCell.textContent = trx.description;
            descCell.classList.add('max-w-xs', 'truncate');
            descCell.title = trx.description;

            const kasMasukCell = row.insertCell();
            kasMasukCell.textContent = formatRupiah(kasMasuk);
            kasMasukCell.className = 'text-right text-green-600';

            const kasKeluarCell = row.insertCell();
            kasKeluarCell.textContent = formatRupiah(kasKeluar);
            kasKeluarCell.className = 'text-right text-red-600';

            const saldoCell = row.insertCell();
            saldoCell.textContent = formatRupiah(saldoBerjalan);
            saldoCell.className = 'text-right font-medium';
        });

        document.getElementById('akTotalKasMasuk').textContent = formatRupiah(totalKasMasuk);
        document.getElementById('akTotalKasKeluar').textContent = formatRupiah(totalKasKeluar);
        document.getElementById('akSaldoKasAkhir').textContent = formatRupiah(saldoBerjalan);
        
        document.getElementById('arusKasPeriod').textContent = `(${formatDate(startDate)} - ${formatDate(endDate)})`;
        arusKasResultDiv.classList.remove('hidden');

    } catch (error) {
        console.error("Error generating cash flow report:", error);
        displayMessage(`Gagal membuat Laporan Arus Kas: ${error.message}`, "error");
    }
}

function exportArusKasToExcel() {
    const kasAwal = parseFloat(document.getElementById('kasAwal').value) || 0;
    if (cachedArusKasData.length === 0) {
        displayMessage("Tidak ada data untuk diexport. Tampilkan laporan terlebih dahulu.", "error");
        return;
    }

    const dataForSheet = [
        ["Tanggal", "Deskripsi", "Kas Masuk", "Kas Keluar", "Saldo"],
        ["", "Saldo Awal", "", "", kasAwal]
    ];
    let saldoBerjalan = kasAwal;

    cachedArusKasData.forEach(trx => {
        let kasMasuk = 0, kasKeluar = 0;
        if (trx.type === 'in') {
            kasMasuk = trx.amount;
            saldoBerjalan += kasMasuk;
        } else {
            kasKeluar = trx.amount;
            saldoBerjalan -= kasKeluar;
        }
        dataForSheet.push([
            formatDate(trx.date),
            trx.description,
            kasMasuk,
            kasKeluar,
            saldoBerjalan
        ]);
    });
    
    const worksheet = XLSX.utils.aoa_to_sheet(dataForSheet);
    worksheet['!cols'] = [ {wch:15}, {wch:50}, {wch:20}, {wch:20}, {wch:20} ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Arus Kas");

    XLSX.writeFile(workbook, `Laporan_Arus_Kas_${new Date().toISOString().split('T')[0]}.xlsx`);
    displayMessage("Laporan Arus Kas berhasil diexport.", "success");
}
