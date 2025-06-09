// === PERUBAHAN DI SINI: Impor fungsi handleLogout ===
import { handleLogout } from './auth.js';
// === AKHIR PERUBAHAN ===

/**
 * Fetches and injects the navigation bar HTML, then sets up its functionality.
 */
async function loadNavbar() {
    const navbarPlaceholder = document.getElementById('navbar-placeholder');
    if (!navbarPlaceholder) return;

    try {
        const response = await fetch('_nav.html');
        if (!response.ok) throw new Error('Gagal memuat navigasi.');
        const navHtml = await response.text();
        navbarPlaceholder.innerHTML = navHtml;
        
        // Setelah navbar dimuat, jalankan setup untuk semua fungsionalitas di dalamnya.
        setupNavbar();
    } catch (error) {
        console.error('Gagal memuat navbar:', error);
        navbarPlaceholder.innerHTML = '<p class="text-center text-red-500">Gagal memuat navigasi.</p>';
    }
}

/**
 * Sets up active links, mobile menu, and logout functionality for the dynamically loaded navbar.
 */
function setupNavbar() {
    const mainNav = document.getElementById('mainNav');
    if (!mainNav) return;

    const navLinksDesktop = document.querySelectorAll('#navLinks a.nav-link');
    const navLinksMobile = document.querySelectorAll('#mobileMenu a.nav-link-mobile');
    const currentPath = window.location.pathname.split("/").pop() || 'dashboard.html';

    // Fungsi untuk menandai link yang aktif
    function setActiveLink(links, activeClass) {
        links.forEach(link => {
            const linkHref = link.getAttribute('href');
            if (!linkHref) return;
            const linkPath = linkHref.split("/").pop() || 'dashboard.html';
            
            if (linkPath === currentPath) {
                link.classList.add(activeClass);
            } else {
                link.classList.remove(activeClass);
            }
        });
    }

    setActiveLink(navLinksDesktop, 'active-nav');
    setActiveLink(navLinksMobile, 'active-nav-mobile');

    // Fungsi untuk tombol hamburger di layar kecil
    const hamburgerButton = document.getElementById('hamburgerButton');
    const mobileMenu = document.getElementById('mobileMenu');
    if (hamburgerButton && mobileMenu) {
        hamburgerButton.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
    }
    
    // === PERUBAHAN DI SINI: Menambahkan event listener untuk tombol logout ===
    const logoutButton = document.getElementById('logoutButton');
    const logoutButtonMobile = document.getElementById('logoutButtonMobile');

    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
    if (logoutButtonMobile) {
        logoutButtonMobile.addEventListener('click', handleLogout);
    }
    // === AKHIR PERUBAHAN ===
}

document.addEventListener('DOMContentLoaded', () => {
    // Memanggil fungsi untuk memuat navbar saat halaman siap.
    loadNavbar();
});

// ... (sisa fungsi seperti displayMessage, showLoading, formatRupiah, dll. tetap sama) ...
export function displayMessage(message, type = 'success', containerId = 'messageContainer') {
    const messageContainer = document.getElementById(containerId);
    if (!messageContainer) {
        console.warn(`Message container '${containerId}' not found.`);
        return;
    }
    messageContainer.textContent = message;
    messageContainer.className = `p-3 rounded-md text-sm mb-4 ${type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`;
    messageContainer.classList.remove('hidden');
    setTimeout(() => {
        if (messageContainer) {
            messageContainer.classList.add('hidden');
        }
    }, 5000);
}

export function showLoading(isLoading, indicatorId) {
    const loadingIndicator = document.getElementById(indicatorId);
    if (loadingIndicator) {
        loadingIndicator.classList.toggle('hidden', !isLoading);
    }
}

export function formatRupiah(angka) {
    if (angka === null || angka === undefined || isNaN(Number(angka))) return 'Rp 0';
    return `Rp ${Number(angka).toLocaleString('id-ID')}`;
}

export function formatDate(dateObject) {
    if (!dateObject) return 'N/A';
    let date;
    if (typeof dateObject === 'string') {
        if (dateObject.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parts = dateObject.split('-');
            date = new Date(parts[0], parts[1] - 1, parts[2]);
        } else {
            date = new Date(dateObject);
        }
    } else if (dateObject && typeof dateObject.toDate === 'function') { 
        date = dateObject.toDate();
    } else if (dateObject instanceof Date) {
        date = dateObject;
    } else {
        return 'Invalid Date';
    }
    if (isNaN(date.getTime())) { 
        return 'Invalid Date';
    }
    return date.toLocaleDateString('id-ID', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

export function updateUserInterfaceForRole(role) {
    // Fungsi ini akan dipanggil dari auth.js setelah status login diketahui
    // dan juga setelah navbar dimuat untuk memastikan elemen UI yang benar ditampilkan/disembunyikan.
    console.log("MAIN.JS: Updating UI for role:", role);
    const adminFeatures = document.querySelectorAll('.admin-feature');
    const adminOnlyNavLinks = document.querySelectorAll('.admin-only-nav');
    const adminOnlyTableHeaders = document.querySelectorAll('.admin-only-table-header');
    const adminOnlyTableCells = document.querySelectorAll('.admin-only-table-cell');

    const isAdmin = role === 'admin';

    adminFeatures.forEach(el => el.classList.toggle('hidden', !isAdmin));
    adminOnlyNavLinks.forEach(el => el.style.display = isAdmin ? '' : 'none');
    adminOnlyTableHeaders.forEach(th => th.style.display = isAdmin ? '' : 'none');
    adminOnlyTableCells.forEach(td => td.style.display = isAdmin ? '' : 'table-cell');
    
    const kasirSectionEl = document.getElementById('kasirSection');
    const inventoryFormSectionEl = document.getElementById('inventoryFormSection');
    if (kasirSectionEl && inventoryFormSectionEl) {
        const inventoryFormIsHidden = inventoryFormSectionEl.classList.contains('hidden') || getComputedStyle(inventoryFormSectionEl).display === 'none';
        if (inventoryFormIsHidden && window.innerWidth >= 1024) { 
            kasirSectionEl.classList.add('lg:col-span-2');
        } else {
            kasirSectionEl.classList.remove('lg:col-span-2');
        }
    }

    const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";
    const mainContentEl = document.getElementById('mainContent'); 
    const accessDeniedMessageEl = document.getElementById('accessDeniedMessage');
    const isAdminOnlyPage = ["laporan.html", "keuangan.html", "status_inventaris.html"].includes(currentPage);

    if (isAdminOnlyPage) {
        if (mainContentEl) mainContentEl.classList.toggle('hidden', !isAdmin);
        if (accessDeniedMessageEl) accessDeniedMessageEl.classList.toggle('hidden', isAdmin);
    }
}
