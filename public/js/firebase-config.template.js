    // File ini adalah template dan aman untuk diunggah ke GitHub.
    // GitHub Actions akan menggunakan file ini untuk membuat firebase-config.js yang sebenarnya.

    export const firebaseConfig = {
        apiKey: "__FIREBASE_API_KEY__",
        authDomain: "__FIREBASE_AUTH_DOMAIN__",
        projectId: "__FIREBASE_PROJECT_ID__",
        storageBucket: "__FIREBASE_STORAGE_BUCKET__",
        messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
        appId: "__FIREBASE_APP_ID__"
    };

    // APOTEK_ID bisa tetap di sini jika tidak dianggap rahasia,
    // atau bisa juga dijadikan secret jika perlu.
    export const APOTEK_ID = (typeof __app_id !== 'undefined' && __app_id) ? __app_id : 'apotekHasanahDefault';
    