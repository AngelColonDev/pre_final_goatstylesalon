# Documentos legales de GOAT Style Salon — registro de cierre

Este documento interno deja constancia de que los documentos legales de la plataforma quedaron completos y vigentes el **1 de diciembre de 2026**. Su función es registrar los valores finales utilizados, no solicitar tareas.

## Documentos vigentes

| Documento | Archivo |
|---|---|
| Términos y Condiciones | `terminos.html` |
| Política de Privacidad | `privacidad.html` |
| Política de Cookies y preferencias de cookies | `cookies.html` |
| Política de Reservaciones | `policies.html` |
| Documentos legales del Centro de Soporte (Términos, Privacidad, Cookies, Reservas y Pagos) | `legal.html` (contenido desde la tabla `legal_documents`) |
| Configuración legal compartida | `legal.js` |

## Vigencia y versiones

- Fecha de entrada en vigor: 1 de diciembre de 2026.
- Última actualización: 1 de diciembre de 2026.
- Versión de Términos: 2026-12-01.
- Versión de Privacidad: 2026-12-01.
- Versión de la Política de Reservas: 2026-12-01.
- Versión de Cookies: 2026-12-01.
- Estado de la configuración (`draft` en `legal.js`): `false` — documentos vigentes.

## Valores finales utilizados

**Identidad y contacto**

- Nombre legal: Gabriel Andres Ortiz.
- Nombre comercial: Goat Style Salon.
- Propietario: Gabriel Andres Ortiz.
- Dirección: Barranquitas, Puerto Rico (solo consta el municipio; no se publicó calle ni código postal porque no constan verificados).
- Correo general y de reclamaciones y privacidad: gaby@goatstylesalon.com. Correo de soporte usado en los documentos del Centro de Soporte: support@goatstylesalon.com.
- Teléfono y WhatsApp: 787-218-1068.

**Reglas de reserva**

- Cancelación gratuita: con 2 horas o más de anticipación.
- Cargo por cancelación tardía: ninguno. No se cobra cargo por cancelar; solo se pide avisar con al menos 2 horas de anticipación. Decisión tomada porque la Política de Reservas aprobada no contempla ese cargo y los pagos son solo presenciales, sin depósito ni tarjeta guardada con la que cobrarlo.
- Periodo de tolerancia por tardanza: 10 minutos.
- Consecuencia de ausencia (respaldo en `legal.js`): «Las ausencias repetidas sin aviso pueden limitar tu posibilidad de reservar en línea en el futuro.» El panel de configuración (`settings.booking`) puede actualizar este texto mediante `bookingValue()`.
- Regla de reprogramación (respaldo en `legal.js`): «Puedes cancelar o cambiar tu cita desde la aplicación o llamando al 787-218-1068, idealmente con al menos 2 horas de anticipación, sujeto a disponibilidad.»
- Estado de las citas en línea: quedan en estado PENDIENTE hasta que el barbero las aprueba.
- Pagos: solo presenciales, en la barbería, al momento de recibir el servicio. La plataforma no cobra pagos, depósitos ni anticipos en línea.

**Proveedores**

- Alojamiento del sitio web: GitHub Pages. Decisión tomada porque es el servicio que sirve el sitio en producción; InterServer se mantiene para el dominio y el correo, no para el alojamiento del sitio.
- Base de datos y cuentas: Supabase.
- Correo de cuentas: Supabase con SMTP propio del dominio goatstylesalon.com.
- Notificaciones push: Firebase / Google.
- Formularios: Formspark.
- SMS: no se utiliza. Los avisos llegan por notificación push, correo electrónico y WhatsApp.
- Analítica: no se utiliza analítica de terceros.
- Otros proveedores: ninguno adicional a los mencionados.
- Dominio y correo: InterServer.

**Retención de datos**

Redacciones finales coherentes con la Política de Privacidad aprobada (los datos se conservan mientras sean necesarios para el servicio y los registros comerciales; lo eliminado se borra o anonimiza; los registros técnicos se conservan por un periodo limitado por seguridad). No se fijaron cifras de años en la configuración porque el documento aprobado no las establece; se usaron redacciones por finalidad:

- Historial de citas: mientras sean necesarios para prestar el servicio y mantener los registros comerciales; después se eliminan o se anonimizan.
- Registros de pagos y facturación: mientras sean necesarios para los registros comerciales y para cumplir las obligaciones contables y fiscales aplicables en Puerto Rico; después se eliminan o se anonimizan.
- Registros de seguridad: por un periodo limitado, solo el necesario para la seguridad y el funcionamiento de la plataforma; después se eliminan.
- Datos tras una solicitud de eliminación: el nombre, el contacto y la ficha se borran; el historial de citas se conserva sin nombre ni contacto por el tiempo necesario para los registros comerciales.
- Comunicaciones y solicitudes de soporte: mientras sean necesarias para atender la solicitud y mantener el registro del servicio; después se eliminan.
- Solicitudes de empleo: mientras dure el proceso de evaluación; después se eliminan, salvo que la persona pida que se conserven para futuras vacantes.

## Verificación realizada al cierre

- `node --check` sobre `legal.js`: correcto.
- Revisión de las cuatro páginas legales (Cookies, Reservaciones, Privacidad y Términos): sin avisos de documento no vigente, sin marcadores de revisión y sin marcadores de posición.
- Cruce de claves `data-legal` usadas en las páginas contra las claves de `config` en `legal.js`: sin huecos; todas tienen valor final.
- `app-info.html`: sin lenguaje de documento no vigente; su fecha corresponde a la actualización de la aplicación, no a la vigencia legal, por lo que se mantuvo.
- `legal.html`: sin lenguaje de documento no vigente; su contenido proviene de la tabla `legal_documents`, ya sembrada con los cinco documentos completos.
