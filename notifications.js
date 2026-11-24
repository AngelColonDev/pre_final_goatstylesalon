(function () {
    // =========================================================================
    // GabyNotifications: centro de avisos, recordatorios y push (Firebase).
    // - Sin Firebase ni Supabase configurados, todo funciona en este navegador:
    //   los avisos se guardan en los datos locales y la campana los muestra.
    // - Con Supabase: los avisos se sincronizan (supabase-sync.js); el cliente
    //   lee los suyos por su código de cita (RPC my_notifications).
    // - Con Firebase: push con la página cerrada (FCM) y notificaciones del
    //   navegador. La clave del servidor de FCM NUNCA va en este código.
    // - Los recordatorios se generan con un barrido al abrir la página y cada
    //   15 minutos mientras esté abierta. Con la página cerrada los genera la
    //   Edge Function supabase/functions/send-push (ver docs/supabase-setup.md).
    // =========================================================================
    const MY_KEY = 'gs_my_appointments';
    const TOKEN_KEY = 'gs_push_token_id';
    const FIREBASE_APP = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
    const FIREBASE_MSG = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js';
    const SWEEP_MINUTES = 15;
    const LOGO = 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972135/b3a13ac1-cac2-4367-9c0d-5946397d4ff9-removebg-preview_xhkncw.png';

    const SCRIPT_BASE = (() => {
        try {
            const src = document.currentScript && document.currentScript.src;
            if (src) return src.slice(0, src.lastIndexOf('/') + 1);
        } catch (_) { /* sin currentScript: rutas relativas */ }
        return '';
    })();

    function lang() {
        try { return window.GabyData.getState().settings.defaultLanguage === 'en' ? 'en' : 'es'; } catch (_) { return 'es'; }
    }

    // Preferencias del cliente (settings-notifications.html). Por defecto todo activo, push apagado.
    function prefs() {
        try {
            const p = window.GabyData.getState().settings.notifications || {};
            return {
                reminders: p.reminders !== false,
                bookings: p.bookings !== false,
                cancellations: p.cancellations !== false,
                messages: p.messages !== false,
                push: p.push === true
            };
        } catch (_) {
            return { reminders: true, bookings: true, cancellations: true, messages: true, push: false };
        }
    }

    // Códigos de las citas reservadas desde este navegador (sin cuenta).
    function myCodes() {
        try {
            const list = JSON.parse(localStorage.getItem(MY_KEY) || '[]');
            return Array.isArray(list) ? list.map(item => item && item.code).filter(Boolean) : [];
        } catch (_) { return []; }
    }

    function isStaff() {
        try { return Boolean(window.GabyCloud && window.GabyCloud.staffRole); } catch (_) { return false; }
    }

    function myBarberId() {
        try { return (window.GabyCloud && window.GabyCloud.staffRole && window.GabyCloud.staffRole.barber_id) || null; } catch (_) { return null; }
    }

    function allNotifications() {
        try { return window.GabyData.getState().notifications || []; } catch (_) { return []; }
    }

    // Avisos que puede ver quien está usando este navegador.
    function visibleNotifications() {
        const list = allNotifications();
        if (isStaff()) {
            const mine = myBarberId();
            const admin = Boolean(window.GabyCloud.staffRole && window.GabyCloud.staffRole.is_admin);
            return list.filter(n => n.audience === 'staff' && (admin || !n.barberId || n.barberId === mine));
        }
        const codes = myCodes();
        if (!codes.length) return [];
        return list.filter(n => n.audience === 'client' && n.appointmentCode && codes.includes(n.appointmentCode));
    }

    function unreadCount() {
        return visibleNotifications().filter(n => !n.readAt).length;
    }

    function updateBell() {
        const count = unreadCount();
        document.querySelectorAll('[data-bell-badge]').forEach(badge => {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.hidden = count === 0;
            badge.classList.toggle('show', count > 0);
        });
    }

    function markRead(id) {
        if (!id) return;
        window.GabyData.updateState(state => {
            const item = (state.notifications || []).find(n => n.id === id);
            if (item && !item.readAt) item.readAt = new Date().toISOString();
        });
        updateBell();
    }

    function markAllRead() {
        const ids = new Set(visibleNotifications().map(n => n.id));
        if (!ids.size) return;
        window.GabyData.updateState(state => {
            (state.notifications || []).forEach(n => { if (ids.has(n.id) && !n.readAt) n.readAt = new Date().toISOString(); });
        });
        updateBell();
    }

    // -------------------------------------------------------------------------
    // Recordatorios: barrido al abrir la página y cada 15 minutos.
    // 24 h antes (settings.booking.reminderHours) y 1 h antes, sin repetir:
    // se marca en la cita (reminderSentAt / reminder1hSentAt) y se comprueba que
    // no exista ya el aviso. El recordatorio de 1 h al barbero también se genera
    // aquí cuando el personal tiene la página abierta.
    // -------------------------------------------------------------------------
    function addNotification(state, { audience, barberId, clientId, type, title, body, code }) {
        // Misma forma que booking-engine.js notify(): no duplicar el formato.
        state.notifications = state.notifications || [];
        state.notifications.unshift({
            id: window.GabyData.makeId('ntf'), audience: audience || 'client', barberId: barberId || null, clientId: clientId || null,
            type, title, body, appointmentCode: code || null, createdAt: new Date().toISOString(), readAt: null
        });
        if (state.notifications.length > 500) state.notifications.length = 500;
    }

    function formatWhen(dateTime) {
        const d = new Date(dateTime);
        if (isNaN(d.getTime())) return String(dateTime || '');
        const en = lang() === 'en';
        const date = d.toLocaleDateString(en ? 'en-US' : 'es-PR', { weekday: 'short', day: 'numeric', month: 'short' });
        const time = d.toLocaleTimeString(en ? 'en-US' : 'es-PR', { hour: 'numeric', minute: '2-digit' });
        return `${date} · ${time}`;
    }

    function showBrowserNotification(title, body) {
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            new Notification(title, { body, icon: LOGO });
        } catch (_) { /* la campana de la página sigue funcionando */ }
    }

    // Lista de recordatorios pendientes según el estado actual (sin escribir nada).
    function dueReminders(state) {
        const p = prefs();
        if (!p.reminders) return [];
        const out = [];
        const now = Date.now();
        const hours = Number(state.settings.booking.reminderHours) || 24;
        const staff = isStaff();
        const mine = myBarberId();
        const codes = staff ? [] : myCodes();
        (state.appointments || []).forEach(appt => {
            if (!appt || !appt.code || !['PENDIENTE', 'APROBADA'].includes(appt.status)) return;
            const start = new Date(appt.dateTime).getTime();
            if (!start || start <= now) return;
            const hoursUntil = (start - now) / 3600000;
            const exists = (type, audience) => (state.notifications || []).some(n => n.appointmentCode === appt.code && n.type === type && n.audience === audience);
            // Cliente: 24 h y 1 h antes (solo sus citas, por código).
            if (!staff && codes.includes(appt.code)) {
                const when = `${appt.service} con ${appt.barberName || ''} · ${formatWhen(appt.dateTime)}`;
                if (hoursUntil <= hours && !appt.reminderSentAt && !exists('recordatorio-24h', 'client')) {
                    out.push({ appt, type: 'recordatorio-24h', audience: 'client', title: lang() === 'en' ? 'Reminder: your appointment' : 'Recordatorio de tu cita', body: when });
                }
                if (hoursUntil <= 1 && !appt.reminder1hSentAt && !exists('recordatorio-1h', 'client')) {
                    out.push({ appt, type: 'recordatorio-1h', audience: 'client', title: lang() === 'en' ? 'Your appointment is in 1 hour' : 'Tu cita es en 1 hora', body: when });
                }
            }
            // Barbero: 1 h antes de sus citas.
            if (staff && appt.barber === mine) {
                if (hoursUntil <= 1 && !appt.reminder1hSentAt && !exists('recordatorio-1h', 'staff')) {
                    out.push({ appt, type: 'recordatorio-1h', audience: 'staff', title: lang() === 'en' ? 'Appointment in 1 hour' : 'Cita en 1 hora', body: `${appt.client} · ${appt.service} · ${formatWhen(appt.dateTime)}` });
                }
            }
        });
        return out;
    }

    function checkReminders() {
        let due = [];
        try { due = dueReminders(window.GabyData.getState()); } catch (_) { return; }
        if (!due.length) return;
        const created = [];
        window.GabyData.updateState(state => {
            due.forEach(item => {
                const current = (state.appointments || []).find(a => a.code === item.appt.code);
                if (!current) return;
                // Re-comprobación dentro del cambio: otra pestaña pudo generarlo antes.
                if (item.type === 'recordatorio-24h' && current.reminderSentAt) return;
                if (item.type === 'recordatorio-1h' && current.reminder1hSentAt) return;
                if ((state.notifications || []).some(n => n.appointmentCode === current.code && n.type === item.type && n.audience === item.audience)) return;
                addNotification(state, { audience: item.audience, barberId: item.audience === 'staff' ? current.barber : null, clientId: current.clientId, type: item.type, code: current.code, title: item.title, body: item.body });
                created.push(item);
                if (item.type === 'recordatorio-24h') current.reminderSentAt = new Date().toISOString();
                else current.reminder1hSentAt = new Date().toISOString();
            });
        });
        created.forEach(item => showBrowserNotification(item.title, item.body));
        if (created.length) updateBell();
    }

    // -------------------------------------------------------------------------
    // Push (Firebase Cloud Messaging). Solo se pide el permiso desde
    // settings-notifications.html; aquí solo se reanuda si ya estaba activo.
    // -------------------------------------------------------------------------
    let messagingPromise = null;

    function firebaseConfig() {
        try { return (typeof self !== 'undefined' && self.GABY_FIREBASE) || null; } catch (_) { return null; }
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('script'));
            document.head.appendChild(script);
        });
    }

    async function loadFirebaseConfig() {
        if (firebaseConfig()) return firebaseConfig();
        try { await loadScript(`${SCRIPT_BASE}firebase-config.js`); } catch (_) { /* sin config: no hay push */ }
        return firebaseConfig();
    }

    async function getMessaging() {
        if (messagingPromise) return messagingPromise;
        messagingPromise = (async () => {
            const config = await loadFirebaseConfig();
            if (!config || !config.apiKey) return null;
            if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;
            try {
                if (!window.firebase || !window.firebase.messaging) {
                    await loadScript(FIREBASE_APP);
                    await loadScript(FIREBASE_MSG);
                }
                if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) {
                    window.firebase.initializeApp(config);
                }
                const messaging = window.firebase.messaging();
                messaging.onMessage(payload => {
                    const data = payload.notification || {};
                    const note = { title: data.title || 'GOAT Style Salon', body: data.body || '' };
                    try {
                        window.GabyData.updateState(state => {
                            const code = payload.data && payload.data.code;
                            const type = (payload.data && payload.data.type) || 'mensaje';
                            const exists = (state.notifications || []).some(n =>
                                (payload.data && payload.data.id && n.id === payload.data.id) ||
                                (code && n.appointmentCode === code && n.type === type));
                            if (exists) return;
                            addNotification(state, { audience: 'client', clientId: null, type, code: code || null, title: note.title, body: note.body });
                        });
                    } catch (_) { /* el aviso queda en el servidor para la próxima apertura */ }
                    showBrowserNotification(note.title, note.body);
                    updateBell();
                });
                return messaging;
            } catch (_) { return null; }
        })();
        return messagingPromise;
    }

    function pushStatus() {
        const config = firebaseConfig();
        let tokenId = null;
        try { tokenId = localStorage.getItem(TOKEN_KEY); } catch (_) { /* almacenamiento bloqueado */ }
        return {
            configured: Boolean(config && config.apiKey),
            permission: ('Notification' in window) ? Notification.permission : 'unsupported',
            enabled: Boolean(tokenId),
            supported: ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window)
        };
    }

    // Activa el push en este dispositivo: pide el permiso y guarda el token FCM
    // en push_tokens (con los códigos de cita de este navegador, para que el
    // servidor solo le mande sus avisos). El token se guarda como endpoint;
    // el envío lo hace la Edge Function con la clave de servicio (nunca aquí).
    async function enablePush() {
        const messaging = await getMessaging();
        if (!messaging) return { ok: false, reason: 'no-config' };
        if (!('Notification' in window)) return { ok: false, reason: 'unsupported' };
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return { ok: false, reason: 'denied' };
        const config = firebaseConfig();
        let token = null;
        try { token = await messaging.getToken({ vapidKey: config.vapidKey }); } catch (_) { return { ok: false, reason: 'token' }; }
        if (!token) return { ok: false, reason: 'token' };
        let id = null;
        try { id = localStorage.getItem(TOKEN_KEY); } catch (_) { /* almacenamiento bloqueado */ }
        window.GabyData.updateState(state => {
            state.pushTokens = state.pushTokens || [];
            const existing = (id && state.pushTokens.find(t => t.id === id)) || state.pushTokens.find(t => t.endpoint === token);
            const row = {
                id: existing ? existing.id : window.GabyData.makeId('tok'),
                endpoint: token,
                keys: { p256dh: '', auth: '' },
                appointmentCodes: myCodes(),
                barberId: isStaff() ? myBarberId() : null,
                userAgent: navigator.userAgent || '',
                createdAt: new Date().toISOString()
            };
            if (existing) Object.assign(existing, row);
            else state.pushTokens.push(row);
            id = row.id;
        });
        try { if (id) localStorage.setItem(TOKEN_KEY, id); } catch (_) { /* almacenamiento bloqueado */ }
        return { ok: true };
    }

    async function disablePush() {
        try {
            const messaging = await getMessaging();
            if (messaging) { try { await messaging.deleteToken(); } catch (_) { /* el token queda inválido en el servidor y se limpia solo */ } }
        } catch (_) { /* sin Firebase: solo se borra el registro local */ }
        let id = null;
        try { id = localStorage.getItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch (_) { /* almacenamiento bloqueado */ }
        window.GabyData.updateState(state => {
            state.pushTokens = (state.pushTokens || []).filter(t => t.id !== id);
        });
        return { ok: true };
    }

    // -------------------------------------------------------------------------
    // Instalar la app (PWA). Ningún navegador instala en silencio: en
    // Android/Chrome se muestra el aviso del sistema; en iPhone se enseña
    // Compartir → Añadir a pantalla de inicio. El aviso lo captura site-chrome.js.
    // -------------------------------------------------------------------------
    function isIOS() {
        const ua = navigator.userAgent || '';
        return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    }

    // En iPhone, "Añadir a pantalla de inicio" solo existe en Safari: Chrome
    // (CriOS), Firefox (FxiOS), Edge (EdgiOS) y Opera (OPiOS) usan WebKit pero
    // no tienen esa opción, y tampoco la tienen los navegadores dentro de
    // otras apps. El UA de Safari trae "Version/... Safari/..."; el de los
    // demás, no.
    function isIOSSafari() {
        if (!isIOS()) return false;
        const ua = navigator.userAgent || '';
        if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return false;
        return /Version\//i.test(ua) && /Safari\//i.test(ua);
    }

    function isStandalone() {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    }

    function canInstall() {
        return Boolean(window.__gabyInstallPrompt) || isIOS();
    }

    async function installApp() {
        if (isStandalone()) return { ok: false, reason: 'installed' };
        const prompt = window.__gabyInstallPrompt;
        if (prompt) {
            prompt.prompt();
            const choice = await prompt.userChoice;
            const accepted = Boolean(choice && choice.outcome === 'accepted');
            window.__gabyInstallPrompt = null;
            return { ok: accepted, reason: accepted ? 'accepted' : 'dismissed' };
        }
        if (isIOS()) return { ok: false, reason: 'ios-manual' };
        return { ok: false, reason: 'unsupported' };
    }

    // -------------------------------------------------------------------------
    function init() {
        updateBell();
        if (window.GabyCloud && window.GabyCloud.ready) {
            window.GabyCloud.ready.then(() => { updateBell(); checkReminders(); }).catch(() => {});
        } else {
            checkReminders();
        }
        window.setInterval(checkReminders, SWEEP_MINUTES * 60 * 1000);
        window.addEventListener('gabydatachange', updateBell);
        window.addEventListener('load', updateBell);
        window.addEventListener('gabycloudready', () => { updateBell(); checkReminders(); });
        if (prefs().push) getMessaging().catch(() => {});
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.GabyNotifications = {
        myCodes, visibleNotifications, unreadCount, updateBell, markRead, markAllRead,
        checkReminders, pushStatus, enablePush, disablePush,
        installApp, canInstall, isIOS, isIOSSafari, isStandalone, prefs
    };
})();
