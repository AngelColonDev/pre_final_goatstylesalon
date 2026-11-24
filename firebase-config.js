// Conexión con Firebase (solo notificaciones push).
// Mientras apiKey esté vacío, el sitio funciona igual que antes: los avisos se ven
// en la página (notificaciones.html) y no hay push con la página cerrada.
// Cuando llenes los datos, notifications.js activa el push y sw.js lo recibe en segundo plano.
//   Dónde se consigue cada dato: Firebase Console → Project settings → Your apps → Web app.
//   vapidKey: Firebase Console → Project settings → Cloud Messaging → Web Push certificates.
// La configuración web de Firebase es pública por diseño (la seguridad la dan las reglas
// de Firebase y que el envío real solo lo hace el servidor con la clave de servicio).
// NUNCA pongas aquí la clave del servidor de FCM, la cuenta de servicio ni ninguna clave secreta.
self.GABY_FIREBASE = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    messagingSenderId: '',
    appId: '',
    vapidKey: ''
};
