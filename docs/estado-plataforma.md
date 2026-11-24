# Estado de la plataforma

Se conserva la web existente: negro, dorado, Cinzel e Inter. No se configuró ni se conectó Supabase, por indicación del propietario. Los datos actuales siguen guardándose en el navegador de cada dispositivo.

## Funciones que ya tienen implementación local

| Área | Implementación |
| --- | --- |
| Clientes sin cuenta | No hay registro ni inicio de sesión de clientes. Para reservar y reseñar se escribe el nombre completo. El estado de una cita se consulta con su código. |
| Reservas | Servicio, barbero, fecha, horas calculadas, nombre completo, revisión, confirmación y precios informativos. |
| Disponibilidad | Duración, horario semanal, apertura del negocio, descansos, bloqueos, días libres y citas activas del estado local. |
| Gestión | Calendario de día/semana/mes, alta manual, edición, cancelación, reprogramación conservando código, completadas y no-shows. |
| Fichas de clientes | Las crea el personal: historial, preferencias, notas internas, visitas, bloqueo con motivo y reglas configurables de no-shows. Una reserva en línea se une a la ficha si el nombre coincide con una sola. |
| Comunicación | Notificaciones para el personal. Al cliente se le avisa por WhatsApp, llamada o correo desde el panel. |
| Reseñas | Nombre completo, servicio, barbero, 1–5 estrellas y comentario de hasta 600 caracteres. Llegan pendientes y el personal las publica u oculta. |
| Reseñas públicas | Solo las aprobadas, con servicio, barbero y fecha de envío en inicio y perfil del barbero. |
| Administración | Servicios, categorías, horarios, inventario, reportes y configuración en el panel existente. |
| Calendarios externos | Enlace a Google Calendar y archivo ICS para Apple Calendar y otros calendarios. |
| Ficha CRM | Acceso del personal, filtro por clientes asignados, citas por ID, historial de cambios, notas, impresión/PDF y acceso al formulario real de nueva cita. |
| Importes | Ingreso estimado de citas completadas. Se retiraron las acciones de registrar pagos y crear recibos del CRM. Los datos históricos existentes se conservan. |

## Cambios del 2026-11-18: sin cuentas de clientes

- Se eliminó todo el registro e inicio de sesión de clientes: `profile.html`, `security.html`, `client-account.js`, la función `delete-account` de Supabase, el formulario de registro/acceso del inicio, "Mi cuenta" en el menú y en Configuración, y los textos legales sobre cuentas.
- **Reservar:** en el último paso se pide el nombre completo. Al terminar se muestra el código de la cita; con él se consulta el estado. Cambios y cancelaciones se hacen llamando a la barbería (el personal los hace desde el panel).
- **Reseñas:** formulario abierto en el inicio (sección Reseñas) con nombre completo, servicio, barbero, estrellas y comentario. Entran como *Pendientes*; se publican desde Reseñas en el panel.
- Se quitó la **lista de espera** (solo funcionaba avisando dentro de la cuenta del cliente).
- Al abrir el sitio se borran del navegador los datos de las cuentas viejas: contraseñas o hashes de clientes, sesión, favoritos, notificaciones de clientes y bloqueos o intentos de inicio de sesión de clientes.
- El inicio de sesión del **personal**, el panel `ops/` y el CRM no cambiaron.

## Cambios del 2026-10-20 (segunda entrega)

- **Aprobación del barbero:** las citas en línea quedan *Pendientes* y el horario queda apartado desde que el cliente la pide, así que nadie más puede reservar esa misma hora. El barbero la aprueba o la rechaza; si la rechaza, el horario vuelve a quedar libre y el cliente recibe el aviso con el motivo (opcional). Las barberías que tenían confirmación automática pasan una sola vez a este modo; se puede volver a activar en Configuración → Reglas.
- **Tres puntos:** en Citas, Inicio y el detalle de la cita solo se ven *Aprobar* y *Rechazar*; el resto (ver, completar, no-show, editar, avisar, llamar, WhatsApp, correo, cancelar) está en el menú ⋮.
- **"No sé cómo se llama el recorte":** opción al reservar (40 min, precio "A consultar"; los minutos se cambian con `settings.booking.unknownCutMinutes`). El barbero escoge el servicio real al editar la cita.
- **Foto de referencia (opcional):** se reduce en el navegador (máx. 900 px, JPEG) y solo la ve el personal en la cita.
- **Reseñas públicas:** nombre, barbero, servicio y fecha en que se envió la reseña. Si el cliente escogió "No sé…", esa parte del servicio no aparece.
- **Menú del panel:** agrupado en Agenda, Clientes, Barbería, Negocio y Cuenta. *Cambiar contraseña* y *Cerrar sesión* están en Configuración. *Cerrar sesión* también aparece al final del menú, en rojo. El menú ya no se redibuja ni vuelve arriba al escoger una opción. En el celular se abre con el botón ☰. Proveedores y Barberos solo los ve el administrador.

## Correcciones del 2026-10-20 (tercera entrega)

- **Un solo toque en el panel:** algunas secciones (Clientes) eran más anchas que la pantalla del celular. El teléfono alejaba la página y el primer toque se perdía como zoom. Ahora ninguna sección se sale de la pantalla (las tablas se desplazan dentro de su tarjeta), los botones no esperan el doble toque de zoom y el panel no se redibuja mientras se está presionando un botón.
- **Reseñas anteriores:** las que se dejaron con el formulario viejo (sin cita ni permiso guardado) y que la barbería ya había aprobado vuelven a mostrarse con foto, barbero y fecha. Las que el cliente marcó como "No" siguen ocultas. El barbero guardado como "gabriel" se muestra como "Gaby".

## Correcciones de esta entrega

- Una cita confirmada cuya fecha ya pasó no cuenta como completada automáticamente.
- Los estados Completada y No-Show se reconocen en la ficha CRM. Marcar No Show usa el motor de citas y sus avisos/reglas.
- Dos clientes con el mismo nombre ya no comparten historial por coincidencia de nombre.
- La búsqueda de fichas requiere una sesión del personal; teléfono y nombre sirven para buscar, no para autenticarse.
- Las pestañas sin implementación no se presentan como funciones disponibles. Los menús visibles conducen a vistas reales.
- Las reseñas se publican únicamente con `publishConsent === true`. La moderación no puede conceder permiso por el cliente.
- Un guardado rechazado revierte el cambio local si no hubo otra edición posterior e intenta recuperar el estado del servidor cuando está conectado.
- Los IDs nuevos usan UUID aleatorios.

## Supabase: etapa final pendiente

Los cambios de `supabase/schema.sql` y `supabase-sync.js` están preparados en archivos, **sin ejecutar ni validar contra una base de datos real**. Incluyen la tabla `clients` (fichas del personal, sin Supabase Auth), reservas y reseñas de visitantes sin sesión, la consulta `appointment_status` por código, columnas ampliadas de citas y servicios; datos de publicación de reseñas; guardas de reseñas; estados nuevos; ocupación sin identidad de otros clientes y restricción de solapamientos entre citas activas.

Antes de activar la conexión hay que completar y probar lo siguiente:

1. Configurar el proyecto, crear las cuentas del personal y asignar roles. Las contraseñas de Auth no se recuperan leyendo hashes.
2. Completar la persistencia y políticas de `timeBlocks`, `notifications`, `clientNotes`, `clientBlocks`, `inventory`, `clientChangeLog` y `loyaltyAccounts`. Estas colecciones todavía funcionan localmente; no están incluidas en el puente de sincronización actual.
3. Aplicar también en el servidor todas las reglas de horarios, descansos, bloqueos, servicios autorizados, antelación máxima y límite de citas. La restricción de solapamientos por sí sola no cubre esas reglas.
4. Probar como visitante sin sesión, barbero y administrador la privacidad de fichas, notas, estadísticas y reseñas. El filtro del navegador no sustituye la seguridad del servidor.
5. Probar reservas simultáneas desde dos dispositivos, reprogramación, cancelación y recuperación tras fallos parciales. Las escrituras del puente actual se hacen por tabla, sin una transacción global.
6. Migrar explícitamente los datos locales que se quieran conservar; la conexión no los migra automáticamente.
7. Los recordatorios externos o SMS requieren un proveedor y una tarea de servidor.
8. Verificar HTTPS, límites de solicitudes (las reservas y reseñas de visitantes no piden sesión) y configuración de Auth del personal en el entorno de publicación.

No ejecutar el esquema sobre datos existentes sin revisarlos: si ya hay citas activas solapadas, la restricción detendrá la migración para que se resuelva el conflicto sin eliminar citas.

## Accesos

| Persona | Usuario | Entrada |
| --- | --- | --- |
| Gaby | `gaby@goatstylesalon.com` | Inicio → acceso del personal |
| Darialex / Tazmania | `darialex@goatstylesalon.com` | Inicio → acceso del personal |
| Wilo | `wilo@goatstylesalon.com` | Inicio → acceso del personal |
| Angel | No necesita usuario en el modo local | `ops/index.html` |

Las claves temporales del personal se reemplazaron el 2026-11-18 (versión 2 de las claves iniciales; reemplazan cualquier clave guardada antes en un navegador) y se entregaron en la conversación; aquí solo se guarda su hash. La clave de Angel no cambió. El primer acceso con la clave inicial obliga a crear una clave personal. Si alguien ya creó su clave personal en ese navegador, esa clave sigue valiendo y tiene prioridad sobre la inicial. Las claves no se pueden obtener en texto legible a partir de sus hashes. Los clientes no tienen cuenta.

## Verificación local

```text
node --test tests/booking-engine.test.cjs
node --test tests/ui.test.cjs
cd crm
npm.cmd run build
```

Las pruebas de interfaz requieren Playwright y Chromium instalados. Cubren la reserva y la reseña sin cuenta (nombre obligatorio, pendientes hasta aprobar), que no quede registro ni inicio de sesión de clientes, contenido público escapado, acceso al CRM y separación por ID, y apertura de una cita con el cliente seleccionado. No equivalen a una auditoría ni a pruebas de Supabase.

Resultado del 2026-11-18 (sin cuentas de clientes): 22 pruebas aprobadas (12 del motor y 10 de interfaz). Resultado de la tercera entrega: 20 pruebas aprobadas (10 del motor y 10 de interfaz). Resultado de la entrega anterior: 11 pruebas aprobadas, compilación TypeScript/Vite correcta y sintaxis verificada en 41 archivos o bloques JavaScript/HTML. Vite conserva los scripts compartidos como recursos externos al paquete del CRM; deben publicarse junto con el sitio principal.
