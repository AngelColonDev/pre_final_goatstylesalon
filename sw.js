// Service worker de GOAT Style Salon: caché básica + push de Firebase (FCM).
// - Sin Firebase configurado, solo hace la caché: la página funciona igual.
// - Con Firebase (firebase-config.js con claves), recibe el push con la página
//   cerrada y abre notificaciones.html al tocar el aviso.
// - Las páginas HTML se piden siempre a la red primero (para no servir una versión
//   vieja después de publicar cambios); los archivos estáticos salen de la caché.
const CACHE = 'goat-style-v8'; // PR #17 (v6): paneles (un solo botón) + inicio con canceladas/rechazadas. PR #18 (v7): super admin. PR #19 (v8): [hidden] manda en el CSS del super admin.
const CORE = ['index.html', 'booking.html', 'services.html', 'barbers.html', 'news.html', 'settings.html', 'notificaciones.html', 'manifest.webmanifest', 'shared-theme.css', 'shared-data.js', 'site-chrome.js', 'staff/gaby/index.html', 'staff/darialex/index.html', 'staff/wilo/index.html', 'staff/shared-admin.css', 'staff/shared-admin.js', 'staff/admin-pro.js', 'super-admin.js', 'super-admin.html', 'super-admin.css', 'super-admin-panel.js'];
const LOGO = 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972135/b3a13ac1-cac2-4367-9c0d-5946397d4ff9-removebg-preview_xhkncw.png';

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    // Navegación: red primero, caché solo si no hay conexión.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.ok && url.origin === self.location.origin) {
                        const copy = response.clone();
                        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
                    }
                    return response;
                })
                .catch(() => caches.match(event.request).then(cached => cached || caches.match('index.html')))
        );
        return;
    }
    // Archivos estáticos del mismo origen: caché primero.
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
            if (response && response.ok && url.origin === self.location.origin) {
                const copy = response.clone();
                caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
            }
            return response;
        }))
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || 'notificaciones.html';
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(list => {
            const open = list.find(client => 'focus' in client);
            if (open) return open.navigate(url).then(client => client.focus());
            return self.clients.openWindow(url);
        })
    );
});

// Firebase Cloud Messaging (solo si firebase-config.js tiene claves).
try {
    importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
    importScripts('firebase-config.js');
    if (self.GABY_FIREBASE && self.GABY_FIREBASE.apiKey) {
        firebase.initializeApp(self.GABY_FIREBASE);
        const messaging = firebase.messaging();
        messaging.onBackgroundMessage(payload => {
            // Firebase ya muestra el aviso cuando el mensaje trae `notification`
            // (el propio SDK lo muestra antes de llamar a este manejador);
            // mostrarlo aquí también lo duplicaría. Solo se muestra algo para
            // mensajes de solo datos, que el SDK no muestra por sí mismo.
            if (payload && payload.notification) return;
            const data = (payload && payload.data) || {};
            const title = data.title || 'GOAT Style Salon';
            const options = {
                body: data.body || '',
                icon: LOGO,
                badge: LOGO,
                tag: data.tag || 'goat-style',
                data: { url: data.url || 'notificaciones.html' }
            };
            return self.registration.showNotification(title, options);
        });
    }
} catch (error) {
    // Sin Firebase configurado no hay push con la página cerrada. La página sigue igual.
}
