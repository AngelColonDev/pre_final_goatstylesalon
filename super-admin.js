// =========================================================================
// GabySuperAdmin — integración PR #18 (ítem H): super admin en la app.
// - Mantenimiento: lee la tabla `maintenance` (migración
//   20261124230000_super_admin.sql) y aplica sus filas activas sobre el
//   sistema que ya existe (site-guard.js + settings.maintenance): pantalla
//   completa si es global, aviso por sección si es por área. El super admin
//   (profiles.role = 'super_admin') nunca se bloquea.
// - Permisos por área: lee `area_permissions` por barbero y expone
//   canAccess(area); los paneles (staff/shared-admin.js) ocultan o bloquean
//   las áreas sin acceso. Los cambios llegan por Supabase Realtime.
// - Tickets: createTicket() inserta en `tickets` (categoría válida,
//   descripción, prioridad 'media').
// - Intentos de login: NO viven aquí; los registra security.js en el
//   servidor (RPCs check_login_allowed / record_login_attempt).
// Sin Supabase configurado no hace nada: la página funciona como antes.
// Nunca guarda conteos ni permisos en localStorage: todo se lee del servidor
// en cada carga y se actualiza por Realtime.
// =========================================================================
(function () {
    'use strict';

    var VERSION = '20261124f';

    // Áreas canónicas. Las usa el mantenimiento por área y los permisos por
    // área; los nombres que lleguen de la base de datos se normalizan aquí
    // (mayúsculas, acentos y sinónimos) para que 'Servicios y precios',
    // 'servicios' o 'services' signifiquen lo mismo.
    var AREAS = ['reservas', 'pagos', 'citas', 'calendario', 'clientes', 'servicios', 'reportes', 'notificaciones', 'configuracion', 'soporte'];
    var AREA_ALIASES = {
        global: 'global', todas: 'global', todo: 'global', all: 'global',
        reservas: 'reservas', reserva: 'reservas', booking: 'reservas',
        pagos: 'pagos', pago: 'pagos', payments: 'pagos', payment: 'pagos',
        citas: 'citas', cita: 'citas', appointments: 'citas', appointment: 'citas',
        calendario: 'calendario', calendar: 'calendario',
        clientes: 'clientes', cliente: 'clientes', clients: 'clientes', client: 'clientes',
        servicios: 'servicios', servicio: 'servicios', services: 'servicios', service: 'servicios',
        reportes: 'reportes', reporte: 'reportes', reports: 'reportes', report: 'reportes',
        notificaciones: 'notificaciones', notificacion: 'notificaciones', notifications: 'notificaciones',
        configuracion: 'configuracion', settings: 'configuracion', ajustes: 'configuracion',
        soporte: 'soporte', support: 'soporte',
        avisos: 'notificaciones', aviso: 'notificaciones',
        productos: 'productos', producto: 'productos',
        galeria: 'galeria', gallery: 'galeria',
        descuentos: 'descuentos', descuento: 'descuentos', discounts: 'descuentos',
        tienda: 'tienda', store: 'tienda',
        resenas: 'resenas', resena: 'resenas', reviews: 'resenas',
        noticias: 'noticias', noticia: 'noticias', news: 'noticias',
        barberos: 'barberos', barbero: 'barberos', barbers: 'barberos'
    };

    // Categorías permitidas para los tickets. No se inventa ninguna fuera de
    // esta lista (ver README de PR #18-H).
    // Valores EXACTOS del CHECK de la migración F (error_tecnico, con guion bajo).
    var TICKET_CATEGORIES = ['cuenta', 'citas', 'pagos', 'error_tecnico', 'otro'];

    // Áreas de la tabla de mantenimiento -> secciones que site-guard.js ya
    // sabe mostrar en la app pública (data-maintenance-section). 'pagos' no
    // tiene sección propia: el pago es presencial y se muestra dentro de la
    // reserva, así que un mantenimiento de pagos bloquea la sección reservas.
    // Las áreas de panel (citas, calendario, clientes, reportes,
    // notificaciones, configuracion) no tienen bloque público: solo afectan
    // al panel del barbero (ver maintenanceFor()).
    var GUARD_SECTION = {
        reservas: 'reservas', pagos: 'reservas', servicios: 'servicios',
        soporte: 'soporte', tienda: 'tienda', resenas: 'resenas',
        noticias: 'noticias', barberos: 'barberos'
    };

    function stripAccents(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function normalizeArea(value) {
        if (value === null || value === undefined || String(value).trim() === '') return 'global';
        var key = stripAccents(value).replace(/[^a-z]+/g, ' ');
        key = key.trim().replace(/\s+/g, ' ');
        // 'servicios y precios' -> 'servicios'
        if (key === 'servicios y precios') return 'servicios';
        if (AREA_ALIASES[key]) return AREA_ALIASES[key];
        var first = key.split(' ')[0];
        return AREA_ALIASES[first] || null;
    }

    // Equivalencias entre el nombre del panel y el de la migración F:
    // la sección Citas del panel es el área 'reservas' de las plantillas F,
    // y el área 'avisos' de F es la sección Notificaciones del panel.
    var AREA_EQUIV = { citas: 'reservas', reservas: 'citas', avisos: 'notificaciones', notificaciones: 'avisos' };

    function normalizeCategory(value) {
        if (value === null || value === undefined) return null;
        // 'error tecnico' / 'error técnico' -> 'error_tecnico' (valor real de F).
        var key = stripAccents(value).replace(/\s+/g, '_');
        for (var i = 0; i < TICKET_CATEGORIES.length; i += 1) {
            if (stripAccents(TICKET_CATEGORIES[i]) === key) return TICKET_CATEGORIES[i];
        }
        return null;
    }

    function pick(row, names) {
        for (var i = 0; i < names.length; i += 1) {
            if (row && row[names[i]] !== undefined && row[names[i]] !== null) return row[names[i]];
        }
        return undefined;
    }

    function toBool(value, fallback) {
        if (value === true || value === false) return value;
        if (typeof value === 'string') {
            var v = value.trim().toLowerCase();
            if (v === 'active' || v === 'activa' || v === 'activo' || v === 'true' || v === '1') return true;
            if (v === 'inactive' || v === 'inactiva' || v === 'inactivo' || v === 'false' || v === '0') return false;
        }
        return fallback;
    }

    // Una fila de maintenance -> { area, message, startsAt, endsAt, active }.
    // Tolera los nombres de columna que el SQL puede usar (ver README).
    function normalizeMaintenanceRow(row) {
        if (!row || typeof row !== 'object') return null;
        var area = normalizeArea(pick(row, ['area', 'area_key', 'seccion', 'section']));
        if (!area) return null;
        var active = toBool(pick(row, ['activa', 'active', 'is_active']), true);
        var status = pick(row, ['status', 'estado']);
        if (typeof status === 'string') active = active && /active|activa|activo/i.test(status);
        var startsAt = pick(row, ['inicia_at', 'starts_at', 'start_at', 'startsAt', 'inicio', 'starts']);
        var endsAt = pick(row, ['termina_at', 'ends_at', 'end_at', 'endsAt', 'fin', 'ends', 'eta']);
        var now = Date.now();
        if (startsAt && new Date(startsAt).getTime() > now) active = false;
        if (endsAt && new Date(endsAt).getTime() <= now) active = false;
        return {
            area: area,
            message: String(pick(row, ['message', 'mensaje', 'text']) || ''),
            startsAt: startsAt ? new Date(startsAt).toISOString() : '',
            endsAt: endsAt ? new Date(endsAt).toISOString() : '',
            active: active
        };
    }

    function isSuperAdmin() {
        try {
            var cloud = window.GabyCloud;
            if (!cloud) return false;
            if (cloud.isSuperAdmin === true || cloud.superAdmin === true) return true;
            var role = cloud.staffRole;
            if (role && (role.is_super_admin === true || role.role === 'super_admin')) return true;
            return false;
        } catch (_) {
            return false;
        }
    }

    function getStateMaintenance() {
        try {
            var state = window.GabyData && window.GabyData.getState();
            return (state && state.settings && state.settings.maintenance) || {};
        } catch (_) {
            return {};
        }
    }

    // Estado de mantenimiento que puso el panel privado (ops/, site_config):
    // se captura la primera vez, antes de aplicar las filas de la tabla, para
    // que al terminar un mantenimiento de la tabla vuelva lo que ops decía.
    // Si ops cambia mientras la página está abierta, el cambio llega por
    // 'gabydatachange' y la base se actualiza (ver abajo).
    var opsBaseline = null;
    var lastTableContribution = null;
    var applyingOwn = false;
    var currentRows = [];

    // Aplica las filas activas de la tabla sobre el mantenimiento que ya
    // existe. No borra lo de ops: el resultado es la unión (si cualquiera de
    // los dos dice mantenimiento, hay mantenimiento). Escribe con saveState
    // (solo local, sin commit): no se sube nada a Supabase. Al guardar,
    // site-guard.js se entera por 'gabydatachange' y repinta la pantalla.
    function applyMaintenance(rows) {
        var list = (Array.isArray(rows) ? rows : []).map(normalizeMaintenanceRow).filter(Boolean).filter(function (r) { return r.active; });
        currentRows = list;
        if (isSuperAdmin()) return { applied: false, reason: 'super_admin' };
        if (!window.GabyData) return { applied: false, reason: 'no-data' };
        var current = getStateMaintenance();
        if (!opsBaseline) opsBaseline = JSON.parse(JSON.stringify(current || {}));
        var sections = Object.assign({}, opsBaseline.sections || {});
        var globalRow = null;
        var firstRow = list[0] || null;
        list.forEach(function (row) {
            if (row.area === 'global') {
                if (!globalRow) globalRow = row;
                return;
            }
            var guardKey = GUARD_SECTION[row.area];
            if (guardKey) sections[guardKey] = true;
        });
        var enabled = Boolean(opsBaseline.enabled) || Boolean(globalRow);
        var message = (globalRow && globalRow.message) || (firstRow && firstRow.message) || opsBaseline.message || '';
        var eta = (globalRow && globalRow.endsAt) || (firstRow && firstRow.endsAt) || opsBaseline.eta || '';
        var contribution = { enabled: Boolean(globalRow), message: message, eta: eta, sections: {} };
        Object.keys(sections).forEach(function (key) {
            if (sections[key] && !(opsBaseline.sections || {})[key]) contribution.sections[key] = true;
        });
        lastTableContribution = contribution;
        var next = Object.assign({}, opsBaseline, {
            enabled: enabled,
            message: message,
            eta: eta,
            sections: sections,
            updatedAt: new Date().toISOString()
        });
        // Nada que cambiar: no se toca el estado.
        if (JSON.stringify(next) === JSON.stringify(current)) return { applied: true, changed: false, rows: list.length };
        try {
            applyingOwn = true;
            var state = window.GabyData.getState();
            state.settings.maintenance = next;
            window.GabyData.saveState(state);
        } finally {
            applyingOwn = false;
        }
        return { applied: true, changed: true, rows: list.length };
    }

    // Mantenimiento vigente para un área de panel (o null). El global NO
    // bloquea al personal: site-guard ya permite al personal trabajar cuando
    // allowStaff está activo, así que aquí solo cuentan las filas por área.
    function maintenanceFor(area) {
        var key = normalizeArea(area);
        if (!key || key === 'global') return null;
        if (isSuperAdmin()) return null;
        var found = null;
        currentRows.forEach(function (row) {
            if ((row.area === key || row.area === AREA_EQUIV[key]) && !found) found = row;
        });
        return found ? { area: found.area, message: found.message, endsAt: found.endsAt } : null;
    }

    async function fetchMaintenance() {
        try {
            var client = await window.GabyCloud.getClient();
            if (!client) return [];
            var res;
            try {
                res = await client.from('maintenance').select('*').eq('activa', true);
            } catch (_) {
                res = await client.from('maintenance').select('*');
            }
            if (res && res.error) {
                // La columna puede llamarse is_active: se reintenta sin filtro
                // y se filtra en el navegador (ver normalizeMaintenanceRow).
                if (/column|activa/i.test(String(res.error.message || ''))) {
                    res = await client.from('maintenance').select('*');
                }
                if (res && res.error) throw res.error;
            }
            return (res && res.data) || [];
        } catch (error) {
            console.warn('[GabySuperAdmin] No se pudo leer el mantenimiento:', error && error.message);
            return [];
        }
    }

    async function refreshMaintenance() {
        var rows = await fetchMaintenance();
        return applyMaintenance(rows);
    }

    // ---------------------------------------------------------------------
    // Permisos por área
    // ---------------------------------------------------------------------
    var permissions = { loaded: false, hasRows: false, byArea: {}, barberId: null };

    function currentBarberId() {
        try {
            var cloud = window.GabyCloud;
            if (cloud && cloud.staffRole && cloud.staffRole.barber_id) return cloud.staffRole.barber_id;
            if (window.AdminPortalConfig && window.AdminPortalConfig.role) return window.AdminPortalConfig.role;
        } catch (_) { /* sin barbero: no hay permisos que cargar */ }
        return null;
    }

    function normalizePermissionRow(row) {
        if (!row || typeof row !== 'object') return null;
        var area = normalizeArea(pick(row, ['area', 'area_key', 'seccion', 'section']));
        if (!area || area === 'global') return null;
        var allowed = toBool(pick(row, ['allowed', 'can_access', 'has_access', 'enabled', 'permitido']), true);
        return { area: area, allowed: allowed };
    }

    async function refreshPermissions(barberId) {
        var id = barberId || currentBarberId();
        permissions.barberId = id;
        if (!id || !window.GabyCloud || !window.GabyCloud.enabled) {
            permissions.loaded = false;
            return permissions;
        }
        try {
            var client = await window.GabyCloud.getClient();
            if (!client) {
                permissions.loaded = false;
                return permissions;
            }
            var res = await client.from('area_permissions').select('*').eq('barber_id', id);
            if (res && res.error) throw res.error;
            var byArea = {};
            ((res && res.data) || []).forEach(function (row) {
                var norm = normalizePermissionRow(row);
                if (norm) {
                    byArea[norm.area] = norm.allowed;
                    // La misma fila vale para el nombre equivalente (citas/reservas,
                    // avisos/notificaciones): las plantillas F usan el otro nombre.
                    if (AREA_EQUIV[norm.area]) byArea[AREA_EQUIV[norm.area]] = norm.allowed;
                }
            });
            permissions = { loaded: true, hasRows: Object.keys(byArea).length > 0, byArea: byArea, barberId: id };
        } catch (error) {
            // Sin tabla o sin permiso de lectura: no se bloquea nada (fail-open);
            // la validación real vive en RLS/RPC en el servidor.
            console.warn('[GabySuperAdmin] No se pudieron leer los permisos por área:', error && error.message);
            permissions.loaded = false;
        }
        window.dispatchEvent(new CustomEvent('gabysuperadminpermissions', { detail: { barberId: id, loaded: permissions.loaded } }));
        return permissions;
    }

    // ¿Puede este usuario entrar al área? Fail-open mientras no se hayan
    // cargado los permisos, si el barbero no tiene filas, o si el área no
    // está listada: el super admin aún no configuró nada para él. El super
    // admin siempre puede entrar. La validación real también vive en el
    // servidor (RLS/RPC); esto solo es el gating de la interfaz.
    function canAccess(area) {
        if (isSuperAdmin()) return true;
        var key = normalizeArea(area);
        if (!key || key === 'global') return true;
        if (!permissions.loaded || !permissions.hasRows) return true;
        if (permissions.byArea[key] === undefined) return true;
        return permissions.byArea[key] === true;
    }

    function permissionsLoaded() {
        return permissions.loaded;
    }

    // ---------------------------------------------------------------------
    // Tickets (Reportar un problema)
    // ---------------------------------------------------------------------
    function buildTicketDescription(input) {
        var parts = [];
        if (input.area) parts.push('Área: ' + input.area);
        if (input.reporterName) parts.push('Reportado por: ' + input.reporterName);
        if (input.reporterPhone) parts.push('Teléfono: ' + input.reporterPhone);
        if (input.reporterEmail) parts.push('Correo: ' + input.reporterEmail);
        if (input.device) parts.push('Dispositivo: ' + input.device);
        var head = parts.join(' · ');
        var body = String(input.description || '').trim();
        return head ? head + '\n\n' + body : body;
    }

    // Crea un ticket en la tabla `tickets`. Devuelve { ok, id } o
    // { ok: false, reason, message }. Nunca lanza: si no hay Supabase o el
    // servidor rechaza el ticket, el llamador muestra el mensaje y ofrece el
    // contacto por correo. Columnas REALES de la migración F: categoria,
    // descripcion, prioridad ('media', la automática de F), reporter_name y
    // reporter_email. Teléfono, área y dispositivo viajan en la descripción
    // porque F no tiene columnas para ellos.
    async function createTicket(input) {
        try {
            var category = normalizeCategory(input && input.category);
            var description = String((input && input.description) || '').trim();
            if (!category) return { ok: false, reason: 'category', message: 'Escoge una categoría válida para el reporte.' };
            if (description.length < 10) return { ok: false, reason: 'description', message: 'Describe el problema con al menos 10 caracteres.' };
            if (!window.GabyCloud || !window.GabyCloud.enabled) {
                return { ok: false, reason: 'no-supabase', message: 'No hay conexión con el servidor. Intenta de nuevo o escribe a soporte-tecnico@angeltechsolutions.dev.' };
            }
            var client = await window.GabyCloud.getClient();
            if (!client) return { ok: false, reason: 'no-supabase', message: 'No hay conexión con el servidor. Intenta de nuevo.' };
            var row = {
                categoria: category,
                descripcion: buildTicketDescription({
                    area: input.area || '',
                    reporterPhone: input.reporterPhone || '',
                    device: input.device || '',
                    description: description
                }),
                prioridad: 'media',
                reporter_name: String(input.reporterName || ''),
                reporter_email: String(input.reporterEmail || '')
            };
            var res = await client.from('tickets').insert([row]);
            if (res && res.error) throw res.error;
            var id = res && Array.isArray(res.data) && res.data[0] ? (res.data[0].id || null) : null;
            return { ok: true, id: id };
        } catch (error) {
            console.error('[GabySuperAdmin] No se pudo crear el ticket:', error);
            var raw = String((error && error.message) || '');
            var friendly = /row-level security|permission denied/i.test(raw)
                ? 'No tienes permiso para crear el reporte en este momento.'
                : 'No se pudo enviar el reporte. Intenta de nuevo.';
            return { ok: false, reason: 'error', message: friendly };
        }
    }

    // ---------------------------------------------------------------------
    // Realtime + inicio
    // ---------------------------------------------------------------------
    var realtimeStarted = false;
    var lastFocusRefresh = 0;

    function subscribeRealtime() {
        if (realtimeStarted) return;
        realtimeStarted = true;
        window.GabyCloud.getClient().then(function (client) {
            if (!client || typeof client.channel !== 'function') return;
            try {
                client.channel('gaby-super-admin-pr18')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance' }, function () { refreshMaintenance(); })
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'area_permissions' }, function () { refreshPermissions(); })
                    .subscribe();
            } catch (error) {
                console.warn('[GabySuperAdmin] No se pudo suscribir a Realtime:', error && error.message);
            }
        }).catch(function () { /* sin cliente: nada que suscribir */ });
    }

    var started = false;
    async function init() {
        if (started) return;
        started = true;
        if (!window.GabyCloud || !window.GabyCloud.enabled) return;
        try { await window.GabyCloud.ready; } catch (_) { /* sin datos del servidor: se sigue con lo local */ }
        await refreshMaintenance();
        await refreshPermissions();
        subscribeRealtime();
    }

    // Si el panel privado cambia el mantenimiento mientras la página está
    // abierta, la base se actualiza y se reaplican las filas de la tabla.
    window.addEventListener('gabydatachange', function () {
        if (applyingOwn || !opsBaseline) return;
        try {
            opsBaseline = JSON.parse(JSON.stringify(getStateMaintenance() || {}));
            // Quita de la base lo que puso la tabla, para no duplicarlo.
            if (lastTableContribution) {
                if (lastTableContribution.enabled) opsBaseline.enabled = false;
                Object.keys(lastTableContribution.sections || {}).forEach(function (key) {
                    if (opsBaseline.sections) opsBaseline.sections[key] = false;
                });
                if (lastTableContribution.message && opsBaseline.message === lastTableContribution.message) opsBaseline.message = '';
                if (lastTableContribution.eta && opsBaseline.eta === lastTableContribution.eta) opsBaseline.eta = '';
            }
        } catch (_) { /* se mantiene la base anterior */ }
        applyMaintenance(currentRows.map(function (r) { return r; }));
    });

    // Al volver a la página se vuelve a preguntar por el mantenimiento (por
    // si cambió sin Realtime). Como mucho una vez cada 30 segundos.
    function refreshOnFocus() {
        if (!window.GabyCloud || !window.GabyCloud.enabled) return;
        var now = Date.now();
        if (now - lastFocusRefresh < 30000) return;
        lastFocusRefresh = now;
        refreshMaintenance();
    }
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) refreshOnFocus();
    });

    window.GabySuperAdmin = {
        VERSION: VERSION,
        AREAS: AREAS,
        TICKET_CATEGORIES: TICKET_CATEGORIES,
        normalizeArea: normalizeArea,
        normalizeCategory: normalizeCategory,
        normalizeMaintenanceRow: normalizeMaintenanceRow,
        isSuperAdmin: isSuperAdmin,
        applyMaintenance: applyMaintenance,
        maintenanceFor: maintenanceFor,
        refreshMaintenance: refreshMaintenance,
        refreshPermissions: refreshPermissions,
        canAccess: canAccess,
        permissionsLoaded: permissionsLoaded,
        createTicket: createTicket,
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    window.addEventListener('gabycloudready', init);
})();
