# Documentos legales: pendientes antes de publicar

Documentos creados (todos leen sus datos de `legal.js` → `config`):

| Documento | Archivo |
|---|---|
| 1. Términos y Condiciones | `terminos.html` |
| 2. Política de Privacidad | `privacidad.html` |
| 3. Política de Cookies + 9. Preferencias de cookies | `cookies.html` (sección `#preferencias`) |
| 4. Política de Reservaciones | `policies.html` |
| 5. Aviso de reseñas · 6. Aviso de reserva · 7. Casillas · 8. Banner · 10. Menores · 11. Eliminación de datos · 12. Cambios | `avisos.html` (cada uno con su ancla) |
| Banner y administrador de cookies, footer legal, resumen antes de reservar | `legal.js` (se carga en todas las páginas públicas) |

Mientras `config.draft` sea `true`, cada documento muestra un aviso de "borrador". Cambiarlo a `false` **solo** después de completar esta lista y de la revisión legal.

> Esto no es asesoría legal. Los documentos son un modelo de trabajo que debe revisar un abogado licenciado en Puerto Rico.

---

## ⚠️ Bloqueos: no publicar las políticas como definitivas hasta resolver esto

Las políticas deben corresponder **exactamente** con lo que hace la plataforma. Hoy hay diferencias importantes. Los puntos 1 a 4 se resuelven al conectar Supabase: el código ya está listo, solo faltan las credenciales (ver `docs/supabase-setup.md`).

1. ~~Contraseñas de clientes~~ **Resuelto:** desde el 2026-11-18 los clientes no tienen cuenta ni contraseña; reservan y reseñan con su nombre completo. Las contraseñas del personal se guardan con hash PBKDF2-SHA256 (600,000 iteraciones); con Supabase, Auth las guarda con bcrypt.
2. **Los datos viven en el navegador de cada dispositivo**, no en un servidor. Por eso, al consultar su código, un cliente **no ve en su teléfono el estado que el barbero cambió desde el suyo**. La sección 7 de `privacidad.html` describe esto con honestidad y se debe actualizar al migrar.
3. ~~Credenciales del staff en el código~~ **Resuelto en parte:** se quitaron de `index.html`; ahora solo existen como hash en `security.js` y cada barbero debe crear su propia contraseña en el primer acceso. Sin servidor, los datos siguen viviendo en cada navegador.
4. La **recuperación de contraseña del personal** no existe todavía. Los términos no la prometen; si se añade, usar tokens seguros que expiren.

---

## INFORMACIÓN QUE EL PROPIETARIO DEBE COMPLETAR ANTES DE PUBLICAR

Todo se edita en `legal.js` → `const config = { ... }`, salvo lo indicado.

**Identidad del negocio**
- [x] `legalName`: Gabriel Andres Ortiz.
- [x] `tradeName`: Goat Style Salon.
- [x] `owner`: Gabriel Andres Ortiz.
- [ ] `address` y `municipality`: dirección exacta. **También** ponerla en `shared-data.js` → `SHOP_LOCATION.address` (y, si se puede, `lat`/`lng`) para que funcionen los botones "Cómo llegar" y el mapa
- [x] Contacto del operador y reclamaciones: gaby@goatstylesalon.com. También se usa como contacto de privacidad.
- [ ] Confirmar el teléfono publicado.
- [ ] `effectiveDate`: fecha de entrada en vigor

**Reglas de reservación**
- [x] Cancelación gratuita con 2 horas o más de anticipación. Con menos de 2 horas se cobra el precio total de los servicios reservados.
- [ ] Confirmar cómo se cobrará el cargo por cancelación tardía y cómo se registrará la hora en que el cliente avisa.
- [ ] `graceMinutes`: periodo de tolerancia (hoy 10)
- [ ] `noShowConsequence`: qué pasa en un no-show
- [x] Los servicios no requieren depósito.
- [ ] Confirmar el plazo de reprogramación.
- [ ] Identificar quién atiende las devoluciones de productos y confirmar sus condiciones y plazos (Términos §14).
- [ ] Cargos de traslado del servicio VIP a domicilio

**Proveedores** (lista exacta de los que se usen en producción)
- [ ] Confirmar que InterServer aloja el sitio en producción.
- [x] `database`: Supabase.
- [ ] Formspark está identificado. Confirmar cuáles formularios de producción lo usan.
- [x] La plataforma no procesa pagos.
- [ ] `emailProvider`: plataforma de email transaccional
- [ ] `smsProvider`: plataforma de SMS
- [ ] `analytics`: analítica (hoy ninguna)
- [ ] `otherProviders`
- [ ] Ubicación de los servidores de cada proveedor principal (Privacidad §7)

**Cookies**
- [ ] Confirmar que la tabla de cookies coincide con las integraciones activas.

**Retención** (Privacidad §8)
- [ ] `retentionAppointments`, `retentionBilling`, `retentionLogs`, `retentionDeleted`
- [ ] Periodos de comunicaciones, solicitudes de empleo y copias de seguridad
- [ ] Plazo de respuesta a solicitudes de privacidad y de eliminación por email

**Otras decisiones**
- [ ] Métodos para pedir que se borren los datos: hoy por email o llamando a la barbería (no hay cuentas de clientes)
- [ ] Confirmar el criterio del borrador para las citas infantiles. Los adolescentes pueden reservar en línea y la cita de un niño menor de 13 años la hace su padre, madre o tutor.
- [ ] Consentimiento de fotos y videos: crear el formulario real (texto en `avisos.html#imagen`) y guardar la respuesta firmada
- [ ] Jurisdicciones donde opera el negocio (¿solo Puerto Rico? ¿clientes de otros estados o países?)
- [ ] Relación con Angel Tech Solutions (acceso a datos para soporte): acuerdo de confidencialidad o de procesamiento de datos

---

## LISTA TÉCNICA PARA EL PROGRAMADOR

Estado: ✅ hecho en este cambio · ⬜ pendiente (la mayoría requiere el backend)

**Transporte y sesiones**
- ⬜ HTTPS obligatorio en todo el sitio y redirigir HTTP a HTTPS (depende del hosting)
- ⬜ Cookies de sesión con `Secure`, `HttpOnly` y `SameSite=Lax/Strict`
- ⬜ Expiración de las sesiones del personal e invalidación al cerrar sesión o cambiar la contraseña
- ⬜ Content Security Policy (permitir solo los dominios usados: fonts.googleapis.com, fonts.gstatic.com, cdnjs.cloudflare.com, res.cloudinary.com, images.unsplash.com, i.pravatar.cc, google.com/maps)

**Autenticación**
- ⬜ Hash de contraseñas con Argon2id o bcrypt bien configurado (Supabase Auth lo hace). Que nunca se pueda recuperar la contraseña original
- ⬜ Recuperar la contraseña del personal con tokens seguros, de un solo uso y que expiren
- ⬜ Protección contra credential stuffing: rate limiting y bloqueo o ralentización después de varios intentos fallidos
- ⬜ 2FA para administradores cuando sea posible
- ⬜ Sacar `staffCredentials` de `index.html`; los roles deben salir del servidor

**Datos y endpoints**
- ⬜ Validación en el frontend **y** en el backend
- ⬜ Sanitizar y escapar todo el texto del usuario antes de insertarlo en HTML (prevención de XSS). Hoy hay muchos `innerHTML` con datos de clientes, reseñas y noticias
- ⬜ Prevención de inyección SQL: consultas parametrizadas o el cliente de Supabase, nunca SQL concatenado
- ⬜ Protección CSRF si se usan cookies de sesión
- ⬜ Proteger los endpoints con roles y permisos (Row Level Security en Supabase): visitante / barbero / admin
- ⬜ Proteger el panel administrativo en el servidor, no solo ocultándolo en la interfaz
- ⬜ Rate limiting en el login del personal, las reservas, las reseñas y los formularios (los visitantes no inician sesión)
- ⬜ Secretos y API keys en variables de entorno, nunca en el código fuente ni en el repositorio
- ⬜ Actualizar dependencias con regularidad (`crm/` con `npm audit`)
- ⬜ No almacenar tarjetas; usar el checkout o los tokens del procesador de pagos

**Operación**
- ⬜ Logs de seguridad (inicios de sesión, cambios de rol, eliminaciones) sin guardar contraseñas ni datos sensibles
- ⬜ Backups cifrados y una prueba de restauración
- ⬜ Plan de respuesta a incidentes: contener, evaluar, notificar según la ley aplicable (Ley 111-2005 de PR) y documentar
- ⬜ Exportación razonable de datos del cliente (JSON o PDF) a petición

**Consentimiento** (hecho en esta versión, sobre localStorage)
- ✅ Casilla de la cita no premarcada
- ✅ Registro de la política aceptada en cada cita: `appointment.policyAcceptance`
- ✅ Versionado: `termsVersion`, `privacyVersion`, `bookingPolicyVersion` y `cookieVersion` en `legal.js`
- ⬜ Mostrar la versión vigente de los términos al reservar cuando cambie `termsVersion`
- ✅ Administrador de cookies: "Aceptar todas", "Rechazar no esenciales" y "Personalizar", categorías opcionales apagadas, elección guardada y "Preferencias de cookies" en el footer
- ✅ Google Maps solo se carga con consentimiento funcional o al pulsar "Mostrar mapa"
- ⬜ Borrado de datos a petición (por email o teléfono): hoy lo hace el personal a mano desde el panel

---

## REVISIÓN LEGAL RECOMENDADA

Puntos concretos para consultar antes de publicar:

1. **Términos §22, Limitación de responsabilidad:** alcance y redacción permitidos en PR para servicios al consumidor.
2. **Términos §23, Indemnización:** si es exigible y si es razonable frente a consumidores.
3. **Términos §6 y Política de Reservaciones:** que los cargos por cancelación tardía y no-show, y su forma de cobro, sean válidos y se divulguen bien; cómo se cobra un cargo si no hay depósito ni tarjeta guardada.
4. **Términos §11–12, Salud y reacciones:** el lenguaje sobre alergias y reacciones, sin exenciones absolutas.
5. **Términos §17 y Avisos §8, Fotos y videos:** el formulario de consentimiento de imagen y la revocación.
6. **Privacidad §5, Terceros:** la lista final de proveedores y la relación con Angel Tech Solutions.
7. **Privacidad §7, Dónde se guarda:** transferencias fuera de PR.
8. **Privacidad §8, Retención:** plazos legales de conservación de registros contables y fiscales en PR.
9. **Privacidad §12, Incidentes:** las obligaciones de la Ley 111-2005, según enmendada (plazos, a quién notificar y el contenido del aviso).
10. **Privacidad §13 y Avisos §5, Menores:** la reserva por tutores para niños menores de 13 años y el manejo de datos que esos niños pudieran enviar directamente.
11. **Avisos §6, Eliminación de cuenta:** qué datos deben conservarse por obligación legal.
