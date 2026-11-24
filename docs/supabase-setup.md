# Conectar el sitio con Supabase: paso a paso

Todo el código ya está preparado. Mientras `supabase-config.js` esté vacío, el sitio funciona como hoy (datos en el navegador). Cuando llenes la URL y la llave, el sitio empieza a usar Supabase **sin cambiar ninguna página**.

## Qué se preparó

| Archivo | Para qué sirve |
|---|---|
| `supabase/schema.sql` | Crea todas las tablas, la seguridad por filas (RLS), los triggers que validan las reservas y reseñas de visitantes, y los datos iniciales (barberos, servicios, productos y la noticia de apertura). Se puede volver a ejecutar sin romper nada. |
| `supabase-config.js` | Aquí van la **URL** y la **anon key**. Es lo único que hay que llenar. |
| `supabase-sync.js` | El puente: descarga lo que cada usuario puede ver, sube cada cambio guardado y maneja el inicio y cierre de sesión del personal con Supabase Auth. Los clientes no tienen cuenta. |

Quién puede ver y hacer qué (lo controla la RLS, no el navegador):

- **Visitante (cliente):** no tiene cuenta. Ve barberos, servicios, productos, noticias, galería y reseñas aprobadas. Reserva escribiendo su nombre completo (el trigger `appointments_online_guard` fija el estado y limpia los campos del personal), consulta el estado de su cita con el código (`appointment_status`), envía reseñas que entran como PENDIENTE y puede enviar una solicitud de empleo. No puede leer la tabla de citas ni las fichas de clientes.
- **Barbero:** ve y gestiona sus citas, las fichas de los clientes que tienen cita con él o lo prefieren, sus productos, su galería y sus noticias.
- **Admin (Gaby):** todo.

## Pasos

1. **Crea el proyecto** en https://supabase.com (región recomendada: East US).
2. **Ejecuta el esquema:** SQL Editor → New query → pega todo `supabase/schema.sql` → Run.
3. **Crea las cuentas del personal:** Authentication → Users → Add user → Create new user, con "Auto Confirm User" marcado:
   - `gaby@goatstylesalon.com` (admin)
   - `darialex@goatstylesalon.com`
   - `wilo@goatstylesalon.com`

   Luego vuelve a ejecutar **solo el bloque final** de `schema.sql` (el que inserta en `staff_roles`), para enlazar cada cuenta con su barbero. Las contraseñas las escoges tú en este paso; ya no se usan las de `index.html`.
4. **Configura Auth:** Authentication → URL Configuration → Site URL: la dirección real del sitio (por ejemplo `https://goatstylesalon.com`). Desactiva el registro público (Authentication → Providers → Email → "Allow new users to sign up"): las únicas cuentas son las del personal, que creas tú.
5. **Llena `supabase-config.js`** con Project Settings → API: `url` = Project URL y `anonKey` = la anon/publishable key. **Nunca** pongas la `service_role` key en el sitio.
6. **Prueba:** reserva como visitante escribiendo un nombre, entra al panel de Darialex con su cuenta, aprueba la cita, y comprueba desde **otro teléfono** que el código de la cita aparece como APROBADA. Este es justo el problema que resuelve Supabase: hoy cada dispositivo tiene sus propios datos.

## Avisos y notificaciones (Firebase + Supabase)

El centro de avisos (`notificaciones.html`, campana en el header) funciona **sin
configurar nada**: los avisos se guardan en el navegador. Con Supabase se
sincronizan, y con Firebase llega el push con la página cerrada.

| Pieza | Para qué sirve |
|---|---|
| `notifications.js` | Campana con contador, recordatorios 24 h y 1 h (barrido al abrir la página y cada 15 minutos), y registro del push. |
| `notificaciones.html` | Centro de avisos del cliente (filtros Todas/Sin leer, marcar leídas). |
| `settings-notifications.html` | Interruptores de avisos, push y botón **Instalar app**. |
| `firebase-config.js` | Configuración web de Firebase (vacía por ahora). **Nunca** la clave del servidor de FCM. |
| `sw.js` | Service worker: caché + receptor del push con la página cerrada. |
| `manifest.webmanifest` | Nombre, colores negro/dorado e iconos para instalar la app. |
| `supabase/migrations/20261124120000_notifications.sql` | Tablas `notifications` y `push_tokens`, RLS y la función `my_notifications()`. |
| `supabase/functions/send-push/index.ts` | Edge Function que envía el push con FCM (también hace el barrido de recordatorios con la página cerrada). |

### Pasos para el push (Firebase)

1. **Crea el proyecto** en https://console.firebase.google.com → Add project.
2. **Registra la app web:** Project settings → Your apps → Web app (`</>`). Copia la configuración en `firebase-config.js` (`apiKey`, `authDomain`, `projectId`, `messagingSenderId`, `appId`).
3. **Clave VAPID:** Project settings → Cloud Messaging → Web Push certificates → Generate key pair. Pégala en `vapidKey` de `firebase-config.js`.
4. **Cuenta de servicio para el envío:** Project settings → Service accounts → Generate new private key. Guarda ese JSON como secreto `FCM_SERVICE_ACCOUNT_JSON` de la Edge Function (abajo). **Nunca** va en la página.
5. **Prueba:** abre `settings-notifications.html`, activa el push, acepta el permiso, reserva una cita y comprueba que el aviso llega a la campana. El push con la página cerrada solo llega cuando la Edge Function está desplegada.

### Pasos para la Edge Function (recordatorios con la página cerrada)

1. Ejecuta la migración `20261124120000_notifications.sql` en SQL Editor (o vuelve a ejecutar `schema.sql`, que ya trae las mismas tablas).
2. Despliega la función (con Supabase CLI, desde la raíz del repo):
   `supabase functions deploy send-push --no-verify-jwt`
3. Pon los secretos:
   `supabase secrets set FCM_SERVICE_ACCOUNT_JSON='<contenido del JSON de la cuenta de servicio>'`
   `supabase secrets set SUPABASE_URL='https://<proyecto>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='<service_role key>'`
4. **Barrido cada 15 minutos** (pg_cron, Dashboard → Database → Cron Jobs):
   `select net.http_post(url := 'https://<proyecto>.supabase.co/functions/v1/send-push', headers := '{"Content-Type": "application/json", "Authorization": "Bearer <service_role key>"}'::jsonb, body := '{"mode": "reminders"}'::jsonb);`
5. El personal también puede probar el envío directo con `{"mode": "send", "notificationId": "ntf-..."}`.

### Instalar la app

El botón **Instalar app** (en `settings-notifications.html`) usa el aviso del sistema en Android/Chrome y enseña los pasos (Compartir → Añadir a pantalla de inicio) en iPhone. Ningún navegador permite instalar en silencio: siempre pide la confirmación del usuario.

## Después de conectar

- Fotos de referencia de las citas: hoy se guardan como texto base64 dentro de la cita. Para producción conviene subirlas a Supabase Storage y guardar solo la URL.
- Los datos que ya existían en el navegador de cada dispositivo **no se migran solos**. Los barberos, servicios, productos y la noticia se cargan con el SQL. Las citas de prueba no hace falta pasarlas.
- Actualiza `privacidad.html` §7 ("Dónde se guarda") y llena `database` y `hosting` en `legal.js`.

## Seguridad de las cuentas del personal (contraseñas, bloqueos y panel técnico)

**Reglas de contraseña en el servidor.** El sitio valida las reglas en el formulario y otra vez en `security.js`. En Supabase hay que activarlas también en el servidor, para que nadie las pueda saltar: Authentication → Providers → Email → Password requirements:
- Minimum length: **10**
- Required characters: **lowercase, uppercase, digits and symbols**
- Leaked password protection: actívala si tu plan lo incluye.

**Bloqueo tras 3 intentos.** El esquema crea `login_attempts`, `account_locks` y las funciones `login_guard`, `register_failed_login` y `resolve_account_lock`. El sitio las llama en cada inicio de sesión. Hay dos limitaciones que debes conocer:
1. Un atacante que llame directamente a la API de Supabase Auth se salta el contador del sitio. Para bloquearlo también ahí, configura un **Auth Hook "Password Verification Attempt"** (Authentication → Hooks, si tu plan lo permite) que consulte `login_guard`.
2. Bloquear una cuenta después de 3 intentos permite que alguien bloquee a propósito la cuenta de otra persona escribiendo mal su contraseña. Por eso el desbloqueo pasa por verificación en el panel técnico.

**Tu cuenta de desarrollador.** Crea tu usuario en Authentication → Users y ejecuta el bloque comentado al final de `schema.sql` con tu correo (marca `is_developer = true`). Con Supabase conectado, el panel `ops/` te pide correo y contraseña de esa cuenta.

**Reservas y reseñas sin sesión.** Como los visitantes reservan y reseñan sin cuenta, cualquiera puede enviar solicitudes. El servidor valida el nombre, fija el estado y no deja leer datos de otros clientes, pero conviene activar un límite de solicitudes (por ejemplo, Cloudflare o el rate limiting de Supabase) para frenar envíos automáticos. Las reseñas no se publican hasta que el administrador las aprueba.
