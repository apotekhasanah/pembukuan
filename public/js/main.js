import { handleLogout } from './auth.js';

/**
 * Mengambil dan menyuntikkan HTML navigasi, lalu mengatur fungsionalitasnya.
 */
async function loadNavbar() {
    const navbarPlaceholder = document.getElementById('navbar-placeholder');
    if (!navbarPlaceholder) return;

    try {
        const response = await fetch('_nav.html');
        if (!response.ok) throw new Error('Gagal memuat navigasi.');
        const navHtml = await response.text();
        navbarPlaceholder.innerHTML = navHtml;
        setupNavbar();
    } catch (error) {
        console.error('Gagal memuat navbar:', error);
        navbarPlaceholder.innerHTML = '<p class="text-center text-red-500">Gagal memuat navigasi.</p>';
    }
}

/**
 * Mengatur link aktif, menu mobile, dan fungsionalitas logout untuk navbar.
 */
function setupNavbar() {
    const mainNav = document.getElementById('mainNav');
    if (!mainNav) return;

    const navLinksDesktop = mainNav.querySelectorAll('#navLinks a.nav-link');
    const navLinksMobile = mainNav.querySelectorAll('#mobileMenu a.nav-link-mobile');
    const currentPath = window.location.pathname.split("/").pop() || 'dashboard.html';

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

    const hamburgerButton = document.getElementById('hamburgerButton');
    const mobileMenu = document.getElementById('mobileMenu');
    if (hamburgerButton && mobileMenu) {
        hamburgerButton.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
    }
    
    const logoutButton = document.getElementById('logoutButton');
    const logoutButtonMobile = document.getElementById('logoutButtonMobile');

    if (logoutButton) logoutButton.addEventListener('click', handleLogout);
    if (logoutButtonMobile) logoutButtonMobile.addEventListener('click', handleLogout);
}

document.addEventListener('DOMContentLoaded', () => {
    loadNavbar();
});

// --- FUNGSI UTILITAS YANG DIEKSPOR ---

export function displayMessage(message, type = 'success', containerId = 'messageContainer') {
    const messageContainer = document.getElementById(containerId);
    if (!messageContainer) {
        console.warn(`Message container '${containerId}' not found.`);
        alert(message);
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

/**
 * Memperbarui elemen UI berdasarkan peran pengguna yang login.
 * @param {string | null} role Peran pengguna ('superadmin', 'admin', 'kasir') atau null.
 */
export function updateUserInterfaceForRole(role) {
    console.log("MAIN.JS: Updating UI for role:", role);
    
    // Definisikan elemen berdasarkan peran
    const superadminElements = document.querySelectorAll('.superadmin-only-nav');
    const adminElements = document.querySelectorAll('.admin-only-nav');
    const adminFeatures = document.querySelectorAll('.admin-feature');
    const adminTableHeaders = document.querySelectorAll('.admin-only-table-header');
    // PENYEMPURNAAN: Tambahkan selektor untuk sel tabel
    const adminTableCells = document.querySelectorAll('.admin-only-table-cell');

    const isSuperAdmin = role === 'superadmin';
    const isAdmin = role === 'admin';

    // Logika visibilitas:
    superadminElements.forEach(el => el.style.display = isSuperAdmin ? '' : 'none');
    adminElements.forEach(el => el.style.display = (isSuperAdmin || isAdmin) ? '' : 'none');
    adminFeatures.forEach(el => el.style.display = (isSuperAdmin || isAdmin) ? '' : 'none');
    adminTableHeaders.forEach(th => th.style.display = (isSuperAdmin || isAdmin) ? '' : 'table-cell'); // Gunakan 'table-cell' untuk header
    adminTableCells.forEach(td => td.style.display = (isSuperAdmin || isAdmin) ? '' : 'table-cell'); // Gunakan 'table-cell' untuk sel
}
