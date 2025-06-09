        // Fungsi untuk menyembunyikan halaman pemuatan
        function hideLoadingOverlay() {
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.classList.add('hidden');
                // Hapus elemen dari DOM setelah transisi selesai agar tidak mengganggu
                setTimeout(() => {
                    if (loadingOverlay.parentNode) {
                         loadingOverlay.parentNode.removeChild(loadingOverlay);
                    }
                }, 500); // Sesuaikan dengan durasi transisi CSS (0.5s)
            }
        }

        // Cara 1: Sembunyikan setelah semua konten halaman (termasuk gambar, dll.) dimuat
        window.addEventListener('load', () => {
            // Tambahkan sedikit penundaan agar pengguna sempat melihat animasi jika pemuatan sangat cepat
            setTimeout(hideLoadingOverlay, 500); // Penundaan 0.5 detik
        });

        // Cara 2 (Alternatif): Sembunyikan setelah DOM siap, bisa lebih cepat tapi mungkin beberapa gambar belum termuat
        // document.addEventListener('DOMContentLoaded', () => {
        //     setTimeout(hideLoadingOverlay, 500);
        // });

        // Fallback: Jika event 'load' tidak terpicu karena suatu alasan (misalnya, koneksi lambat dan ada resource yang gagal dimuat),
        // sembunyikan overlay setelah batas waktu tertentu.
        setTimeout(hideLoadingOverlay, 5000); // Sembunyikan setelah 5 detik sebagai fallback