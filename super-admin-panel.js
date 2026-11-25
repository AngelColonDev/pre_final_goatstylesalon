/* ============================================================================
   Super Admin (PANEL) — GOAT Style Salon (PR #18, ítem G).
   FUSIÓN PR #18: este archivo se llama super-admin-panel.js en el repo
   porque el nombre super-admin.js es el módulo de integración de la app
   (ítem H: mantenimiento, permisos y tickets en las páginas). El panel es
   solo para super-admin.html, que carga este archivo.
   Usa SOLO el cliente Supabase ya cableado del repo: window.GabyCloud.getClient()
   (supabase-config.js + supabase-sync.js). No crea otro cliente ni guarda claves.
   NUNCA hay llaves de servidor ni tokens en este archivo.

   Tablas/RPCs que usa (migración 20261124230000_super_admin.sql, ítem F —
   nombres REALES verificados contra la migración en la fusión):
   profiles (nombre, estado, motivo, suspendido_hasta, ultimo_login_at,
   force_reauth), login_attempts (agregado por email: count, last_at,
   blocked_until, last_ip, last_device), audit_log (actor_email, action,
   target_type, target_id, before_data, after_data), maintenance (area,
   activa, mensaje, inicia_at, termina_at), area_permissions (barber_id,
   area, permitido), tickets (titulo, descripcion, categoria, prioridad,
   estado, reporter_name, reporter_email), ticket_messages (mensaje,
   author_role, is_internal), saved_replies (titulo, cuerpo), error_logs
   (mensaje, pagina), admin_settings, appointments, notifications, barbers,
   clients. RPCs: check_login_allowed, record_login_attempt (p_exito),
   log_audit (p_action, p_target_type, p_target_id, p_before, p_after),
   unlock_account, force_password_change, close_user_sessions,
   set_account_status, set_maintenance (p_activa, p_mensaje, p_inicia_at,
   p_termina_at), set_area_permission (p_permitido),
   apply_permission_template, send_mass_notification, add_ticket_reply,
   set_max_login_attempts, export_data.
   Si una RPC/tabla aún no existe, la acción muestra un error claro y NO
   finge haberlo hecho (ver README: límites honestos).
   ========================================================================== */
(function () {
    'use strict';

    var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min sin actividad
    var MAX_ATTEMPTS = 3;
    // Áreas del panel con su clave REAL en area_permissions (migración F):
    // son las claves de las plantillas del servidor (reservas, clientes,
    // servicios, avisos, pagos, reportes, ajustes) + calendario, que el
    // panel controla como área propia. La etiqueta es solo presentación.
    var AREAS = [
        { key: 'reservas', label: 'Citas' },
        { key: 'calendario', label: 'Calendario' },
        { key: 'clientes', label: 'Clientes' },
        { key: 'servicios', label: 'Servicios y precios' },
        { key: 'pagos', label: 'Pagos' },
        { key: 'reportes', label: 'Reportes' },
        { key: 'avisos', label: 'Notificaciones' },
        { key: 'ajustes', label: 'Configuración' }
    ];
    // Plantillas REALES del servidor (tabla permission_templates, F): se
    // aplican con la RPC apply_permission_template ('basico' | 'encargado').
    var TEMPLATES = {
        'basico': { nombre: 'Barbero básico', permisos: { reservas: true, clientes: true, servicios: true, avisos: true, productos: false, galeria: false, noticias: false, pagos: false, descuentos: false, ajustes: false, reportes: false } },
        'encargado': { nombre: 'Barbero encargado', permisos: { reservas: true, clientes: true, servicios: true, avisos: true, productos: true, galeria: true, noticias: true, pagos: true, descuentos: true, ajustes: false, reportes: true } }
    };
    var MODULES = ['dashboard', 'accounts', 'blocked', 'support', 'permissions', 'maintenance', 'notifications', 'tickets', 'appointments', 'audit', 'system'];

    var state = {
        session: null,          // { email, userId, lastActivity }
        support: null,          // { id, name, kind } — vista de soporte, NO suplantación
        supportCanEdit: false,
        auditLocal: [],         // respaldo local si audit_log no responde
        timers: [],
        currentModule: 'dashboard',
        accounts: [], perms: [], ticketsCache: [], apptsCache: []
    };
    var clientOverride = null; // solo para pruebas (harness jsdom)

    var $ = function (id) { return document.getElementById(id); };
    var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var fmtDate = function (iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('es-PR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return String(iso); } };
    var todayKey = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    // audit_log real (F): actor_email / after_data. El respaldo local usa
    // details / user_email: estos helpers leen ambas formas.
    var auditDetail = function (r) {
        if (!r) return '';
        if (r.details) return r.details;
        if (r.after_data && r.after_data.details) return r.after_data.details;
        return (r.target_type || '') + (r.target_id ? ' ' + r.target_id : '');
    };
    var auditUser = function (r) { return (r && (r.actor_email || r.user_email || r.actor_id || r.user_id)) || ''; };

    /* ------------------------------------------------------------------ */
    /* Cliente Supabase compartido (GabyCloud).                            */
    /* ------------------------------------------------------------------ */
    async function getClient() {
        if (clientOverride) return clientOverride;
        if (window.GabyCloud && typeof window.GabyCloud.getClient === 'function') {
            try { return await window.GabyCloud.getClient(); } catch (_) { return null; }
        }
        return null;
    }
    async function rpc(name, params) {
        var c = await getClient();
        if (!c || typeof c.rpc !== 'function') throw new Error('Sin conexión con el servidor.');
        var res = await c.rpc(name, params || {});
        if (res && res.error) throw new Error(res.error.message || ('Error en ' + name));
        return res ? res.data : null;
    }
    async function tableSelect(table, opts) {
        var c = await getClient();
        if (!c) throw new Error('Sin conexión con el servidor.');
        var q = c.from(table).select(opts && opts.columns ? opts.columns : '*');
        (opts && opts.eq || []).forEach(function (pair) { q = q.eq(pair[0], pair[1]); });
        if (opts && opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false });
        if (opts && opts.limit) q = q.limit(opts.limit);
        var res = await q;
        if (res && res.error) throw new Error(res.error.message || ('Error leyendo ' + table));
        return (res && res.data) || [];
    }

    /* ------------------------------------------------------------------ */
    /* Helpers puros (los verifica el harness).                            */
    /* ------------------------------------------------------------------ */
    function isSessionExpired(lastActivity, now) {
        return (now == null ? Date.now() : now) - lastActivity >= SESSION_TIMEOUT_MS;
    }
    function remainingMs(lastActivity, now) {
        return Math.max(0, SESSION_TIMEOUT_MS - ((now == null ? Date.now() : now) - lastActivity));
    }
    // Cancelar una cuenta exige escribir CANCELAR y un motivo.
    function validateCancel(typed, reason) {
        if (String(typed || '').trim() !== 'CANCELAR') return { ok: false, error: 'Escribe CANCELAR para confirmar la cancelación.' };
        if (!String(reason || '').trim()) return { ok: false, error: 'El motivo es obligatorio para cancelar una cuenta.' };
        return { ok: true, error: '' };
    }
    function csvCell(v) {
        var s = String(v == null ? '' : v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function buildCsv(columns, rows) {
        var head = columns.map(function (c) { return csvCell(c.label); }).join(',');
        var lines = (rows || []).map(function (r) {
            return columns.map(function (c) { return csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key]); }).join(',');
        });
        return [head].concat(lines).join('\r\n');
    }
    function downloadCsv(filename, csv) {
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    /* ------------------------------------------------------------------ */
    /* Toasts, modal y estados vacíos.                                     */
    /* ------------------------------------------------------------------ */
    function toast(msg, type) {
        var box = $('sa-toasts');
        if (!box) return;
        var el = document.createElement('div');
        el.className = 'sa-toast ' + (type || '');
        el.textContent = msg;
        box.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4500);
    }
    function emptyState(icon, text) {
        return '<div class="sa-empty"><i class="fas ' + icon + '"></i>' + esc(text) + '</div>';
    }
    function loadingState(text) {
        return '<div class="sa-loading"><i class="fas fa-circle-notch fa-spin"></i> ' + esc(text || 'Cargando…') + '</div>';
    }
    // Modal de confirmación. Opciones: title, body, requireReason, requireType
    // (p. ej. 'CANCELAR'), confirmLabel, danger. Resuelve {reason} o null.
    function confirmModal(opts) {
        return new Promise(function (resolve) {
            var root = $('sa-modal-root');
            root.innerHTML =
                '<div class="sa-modal-backdrop"><div class="sa-modal" role="dialog" aria-modal="true">' +
                '<h3>' + esc(opts.title || 'Confirmar') + '</h3>' +
                '<p class="sa-muted">' + esc(opts.body || '') + '</p>' +
                (opts.requireReason ? '<label class="sa-field"><span>Motivo (obligatorio)</span><textarea id="sa-modal-reason" rows="3" placeholder="Escribe el motivo…"></textarea></label>' : '') +
                (opts.requireType ? '<label class="sa-field"><span>Escribe ' + esc(opts.requireType) + ' para confirmar</span><input id="sa-modal-type" type="text" placeholder="' + esc(opts.requireType) + '" autocomplete="off"></label>' : '') +
                '<p id="sa-modal-error" class="sa-error" hidden></p>' +
                '<div class="sa-modal-actions"><button class="btn btn-ghost" id="sa-modal-cancel">Cancelar</button>' +
                '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" id="sa-modal-ok">' + esc(opts.confirmLabel || 'Confirmar') + '</button></div>' +
                '</div></div>';
            var done = function (value) { root.innerHTML = ''; resolve(value); };
            $('sa-modal-cancel').addEventListener('click', function () { done(null); });
            $('sa-modal-ok').addEventListener('click', function () {
                var reason = opts.requireReason ? String(($('sa-modal-reason') || {}).value || '').trim() : '';
                var typed = opts.requireType ? String(($('sa-modal-type') || {}).value || '').trim() : '';
                var err = $('sa-modal-error');
                if (opts.requireReason && !reason) { err.textContent = 'El motivo es obligatorio.'; err.hidden = false; return; }
                if (opts.requireType) {
                    var v = validateCancel(typed, reason || 'x');
                    if (!v.ok) { err.textContent = v.error; err.hidden = false; return; }
                }
                done({ reason: reason, typed: typed });
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Auditoría: toda acción del super admin queda registrada.            */
    /* ------------------------------------------------------------------ */
    async function audit(action, details) {
        var entry = { action: action, details: details || '', user_email: state.session ? state.session.email : '', created_at: new Date().toISOString() };
        state.auditLocal.unshift(entry);
        try { await rpc('log_audit', { p_action: action, p_target_type: 'super_admin_panel', p_target_id: '', p_before: null, p_after: { details: String(details || '') } }); }
        catch (_) { /* el registro local queda como respaldo; no se bloquea la acción */ }
    }

    /* ------------------------------------------------------------------ */
    /* Sesión: login solo con contraseña (sin código; decisión del dueño, */
    /* 25 Nov 2026) y cierre a los 30 min sin actividad.                   */
    /* ------------------------------------------------------------------ */
    function showLoginError(msg) { var e = $('sa-login-error'); e.textContent = msg; e.hidden = false; }

    async function handleLoginSubmit(ev) {
        ev.preventDefault();
        var email = $('sa-email').value.trim().toLowerCase();
        var password = $('sa-password').value;
        var btn = $('sa-login-btn');
        btn.disabled = true;
        try {
            var c = await getClient();
            if (!c) { showLoginError('Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); return; }
            // 1) ¿La cuenta puede intentar entrar? (bloqueo al 3er fallo, en servidor)
            var allowed = await rpc('check_login_allowed', { p_email: email });
            var isAllowed = allowed === true || (allowed && allowed.allowed !== false);
            if (!isAllowed) { showLoginError('Esta cuenta está bloqueada por intentos fallidos. Desbloquéala desde el panel de otro super administrador o espera a que se desbloquee.'); return; }
            // 2) Contraseña (Supabase Auth).
            var sign = await c.auth.signInWithPassword({ email: email, password: password });
            if (sign.error) {
                var rec = null;
                try { rec = await rpc('record_login_attempt', { p_email: email, p_exito: false, p_dispositivo: navigator.userAgent }); } catch (_) { /* sin conteo en servidor */ }
                var left = rec && typeof rec.attempts_left === 'number' ? rec.attempts_left : null;
                if (rec && rec.locked) showLoginError('3 intentos fallidos: la cuenta quedó bloqueada.');
                else showLoginError('Correo o contraseña incorrectos.' + (left !== null ? ' Intento ' + (MAX_ATTEMPTS - left) + ' de ' + MAX_ATTEMPTS + '.' : ''));
                return;
            }
            // 3) Solo super_admin entra aquí (el rol lo verifica el SQL en profiles).
            var prof = await c.from('profiles').select('role').eq('id', sign.data.user.id).maybeSingle();
            if (prof.error || !prof.data || prof.data.role !== 'super_admin') {
                await c.auth.signOut();
                showLoginError('Esta cuenta no es de super administrador.');
                return;
            }
            try { await rpc('record_login_attempt', { p_email: email, p_exito: true, p_dispositivo: navigator.userAgent }); } catch (_) {}
            // 4) Sin código de verificación: la contraseña y el rol
            // super_admin verificado en servidor son la entrada.
            startSession(email, sign.data.user.id);
            audit('login', 'Inicio de sesión de super admin (solo contraseña).');
            toast('Bienvenido al panel de Super Admin.', 'success');
        } catch (err) {
            showLoginError(err && err.message ? err.message : 'No se pudo iniciar sesión.');
        } finally { btn.disabled = false; }
    }

    function startSession(email, userId) {
        state.session = { email: email, userId: userId, lastActivity: Date.now() };
        $('sa-login').hidden = true;
        $('sa-app').hidden = false;
        $('sa-user-email').textContent = email;
        ['click', 'keydown', 'touchstart', 'mousemove'].forEach(function (evt) {
            document.addEventListener(evt, noteActivity, { passive: true });
        });
        state.timers.push(setInterval(tickCountdown, 1000));
        state.timers.push(setInterval(checkIdle, 15000));
        tickCountdown();
        showModule('dashboard');
    }
    function noteActivity() { if (state.session) state.session.lastActivity = Date.now(); }
    function tickCountdown() {
        if (!state.session) return;
        var ms = remainingMs(state.session.lastActivity);
        var s = Math.floor(ms / 1000);
        var el = $('sa-countdown');
        if (el) el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }
    function checkIdle() {
        if (state.session && isSessionExpired(state.session.lastActivity)) {
            toast('Sesión cerrada por 30 minutos sin actividad.', 'warning');
            logout(true);
        }
    }
    async function logout(auto) {
        state.timers.forEach(clearInterval);
        state.timers = [];
        state.session = null;
        state.support = null;
        state.supportCanEdit = false;
        document.body.classList.remove('sa-support-readonly');
        try { var c = await getClient(); if (c) await c.auth.signOut(); } catch (_) {}
        if (!auto) audit('logout', 'Cierre de sesión manual.');
        $('sa-app').hidden = true;
        $('sa-login').hidden = false;
        $('sa-login-form').hidden = false;
        $('sa-password').value = '';
    }

    /* ------------------------------------------------------------------ */
    /* Navegación entre módulos.                                           */
    /* ------------------------------------------------------------------ */
    var RENDERERS = {};
    function showModule(name) {
        state.currentModule = name;
        MODULES.forEach(function (m) { var s = $('module-' + m); if (s) s.hidden = m !== name; });
        document.querySelectorAll('#sa-nav .nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.module === name); });
        var sec = $('module-' + name);
        if (sec) {
            $('sa-module-title').textContent = sec.dataset.title || name;
            $('sa-module-subtitle').textContent = sec.dataset.subtitle || '';
        }
        if (RENDERERS[name]) RENDERERS[name]();
    }

    /* ------------------------------------------------------------------ */
    /* (1) Dashboard                                                        */
    /* ------------------------------------------------------------------ */
    RENDERERS.dashboard = async function () {
        var sec = $('module-dashboard');
        sec.innerHTML = loadingState('Cargando resumen…');
        try {
            var profiles = await tableSelect('profiles');
            var appts = await tableSelect('appointments');
            var tickets = await tableSelect('tickets');
            var maint = await tableSelect('maintenance');
            var today = todayKey();
            var barbersActive = profiles.filter(function (p) { return p.role === 'barbero' && p.estado !== 'bloqueado' && p.estado !== 'cancelado'; }).length;
            var blocked = profiles.filter(function (p) { return p.estado === 'bloqueado'; }).length;
            var todayCount = appts.filter(function (a) { return String(a.date_time || '').slice(0, 10) === today; }).length;
            var openTickets = tickets.filter(function (t) { return t.estado === 'abierto'; }).length;
            var maintAreas = maint.filter(function (m) { return m.activa; }).length;
            var recent = (await tableSelect('audit_log', { order: 'created_at', limit: 8 })).slice(0, 8);
            sec.innerHTML =
                '<div class="sa-cards">' +
                card(barbersActive, 'Barberos activos') +
                card(todayCount, 'Citas de hoy') +
                card(blocked, 'Cuentas bloqueadas', blocked > 0) +
                card(openTickets, 'Tickets abiertos', openTickets > 0) +
                card(maintAreas, 'Áreas en mantenimiento', maintAreas > 0) +
                card(profiles.length, 'Cuentas totales') +
                '</div>' +
                '<div class="sa-grid-2"><div class="sa-panel"><h3>Actividad reciente</h3>' +
                (recent.length ? '<div class="sa-list">' + recent.map(function (r) {
                    return '<div class="sa-list-item"><strong>' + esc(r.action || '') + '</strong><span class="sa-meta">' + esc(auditDetail(r)) + ' · ' + fmtDate(r.created_at) + '</span></div>';
                }).join('') + '</div>' : emptyState('fa-clipboard-list', 'Sin actividad registrada todavía.')) +
                '</div><div class="sa-panel"><h3>Alertas</h3>' +
                (blocked || openTickets || maintAreas
                    ? '<div class="sa-list">' +
                      (blocked ? '<div class="sa-list-item"><strong>' + blocked + ' cuenta(s) bloqueada(s).</strong><span class="sa-meta">Revisa el módulo Cuentas bloqueadas.</span></div>' : '') +
                      (openTickets ? '<div class="sa-list-item"><strong>' + openTickets + ' ticket(s) abierto(s).</strong><span class="sa-meta">Revisa el módulo Soporte y tickets.</span></div>' : '') +
                      (maintAreas ? '<div class="sa-list-item"><strong>' + maintAreas + ' área(s) en mantenimiento.</strong><span class="sa-meta">Los clientes ven el aviso de mantenimiento.</span></div>' : '') +
                      '</div>'
                    : emptyState('fa-circle-check', 'Todo en orden: sin cuentas bloqueadas, sin tickets abiertos y sin mantenimiento activo.')) +
                '</div></div>';
        } catch (err) {
            sec.innerHTML = '<div class="sa-panel">' + emptyState('fa-triangle-exclamation', 'No se pudo cargar el resumen: ' + (err.message || 'sin conexión.')) + '</div>';
        }
        function card(n, label, alert) {
            return '<div class="sa-card' + (alert ? ' sa-alert' : '') + '"><strong>' + n + '</strong><span>' + esc(label) + '</span></div>';
        }
    };

    /* ------------------------------------------------------------------ */
    /* (2) Gestión de barberos y cuentas                                    */
    /* ------------------------------------------------------------------ */
    RENDERERS.accounts = async function () {
        var sec = $('module-accounts');
        sec.innerHTML =
            '<div class="sa-panel"><div class="sa-toolbar">' +
            '<input id="sa-acct-search" type="search" placeholder="Buscar por nombre o correo…">' +
            '<select id="sa-acct-role"><option value="">Todos los roles</option><option value="barbero">Barbero</option><option value="cliente">Cliente</option><option value="admin">Admin</option><option value="super_admin">Super admin</option></select>' +
            '<select id="sa-acct-status"><option value="">Todos los estados</option><option value="activo">Activo</option><option value="bloqueado">Bloqueado</option><option value="suspendido">Suspendido</option><option value="cancelado">Cancelado</option></select>' +
            '</div><div id="sa-acct-list">' + loadingState('Cargando cuentas…') + '</div></div>';
        var render = async function () {
            var list = $('sa-acct-list');
            try {
                state.accounts = await tableSelect('profiles', { order: 'created_at' });
            } catch (err) {
                list.innerHTML = emptyState('fa-users', 'No se pudieron cargar las cuentas: ' + (err.message || 'sin conexión.'));
                return;
            }
            var q = ($('sa-acct-search').value || '').toLowerCase();
            var role = $('sa-acct-role').value, status = $('sa-acct-status').value;
            var rows = state.accounts.filter(function (p) {
                return (!q || (p.nombre || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q)) &&
                    (!role || p.role === role) && (!status || (p.estado || 'activo') === status);
            });
            if (!rows.length) { list.innerHTML = emptyState('fa-users', 'No hay cuentas que coincidan con esa búsqueda o filtro.'); return; }
            list.innerHTML = '<div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último login</th><th>Acciones</th></tr></thead><tbody>' +
                rows.map(function (p) {
                    return '<tr><td><strong>' + esc(p.nombre || '—') + '</strong></td><td>' + esc(p.email || '—') + '</td><td>' + esc(p.role || '') + '</td>' +
                        '<td>' + statusBadge(p.estado || 'activo') + '</td><td>' + fmtDate(p.ultimo_login_at) + '</td>' +
                        '<td><div class="sa-row-actions">' +
                        '<button class="btn btn-ghost btn-sm" data-act="view" data-id="' + esc(p.id) + '">Ver</button>' +
                        '<button class="btn btn-ghost btn-sm" data-act="support" data-id="' + esc(p.id) + '" data-name="' + esc(p.nombre || p.email || '') + '">Entrar como</button>' +
                        ((p.estado || 'activo') === 'activo' ? '<button class="btn btn-ghost btn-sm" data-act="suspend" data-id="' + esc(p.id) + '">Suspender</button>' : '') +
                        ((p.estado || 'activo') !== 'cancelado' ? '<button class="btn btn-danger btn-sm" data-act="cancel" data-id="' + esc(p.id) + '">Cancelar</button>' : '') +
                        ((p.estado || 'activo') !== 'activo' ? '<button class="btn btn-primary btn-sm" data-act="reactivate" data-id="' + esc(p.id) + '">Reactivar</button>' : '') +
                        '<button class="btn btn-ghost btn-sm" data-act="reset" data-id="' + esc(p.id) + '" data-email="' + esc(p.email || '') + '">Restablecer contraseña</button>' +
                        '<button class="btn btn-ghost btn-sm" data-act="reauth" data-id="' + esc(p.id) + '">Cerrar sesiones</button>' +
                        '</div></td></tr>';
                }).join('') + '</tbody></table></div>';
            list.querySelectorAll('[data-act]').forEach(function (b) {
                b.addEventListener('click', function () { accountAction(b.dataset.act, b.dataset.id, b.dataset); });
            });
        };
        ['sa-acct-search', 'sa-acct-role', 'sa-acct-status'].forEach(function (id) {
            $(id).addEventListener('input', render);
        });
        await render();
    };
    function statusBadge(s) {
        var map = { activo: 'green', bloqueado: 'red', suspendido: 'amber', cancelado: 'grey' };
        return '<span class="sa-badge ' + (map[s] || 'grey') + '">' + esc(s) + '</span>';
    }
    async function accountAction(act, id, ds) {
        var c = await getClient();
        if (!c) { toast('Sin conexión con el servidor.', 'error'); return; }
        try {
            if (act === 'view') {
                var p = state.accounts.find(function (x) { return String(x.id) === String(id); }) || {};
                var history = [];
                try { history = await tableSelect('audit_log', { eq: [['target_id', id]], order: 'created_at', limit: 10 }); } catch (_) {}
                var ok = await confirmModal({
                    title: 'Perfil de ' + (p.nombre || p.email || id),
                    body: 'Correo: ' + (p.email || '—') + ' · Rol: ' + (p.role || '—') + ' · Estado: ' + (p.estado || 'activo') + ' · Último login: ' + fmtDate(p.ultimo_login_at) + '. Historial en auditoría: ' + history.length + ' registro(s).',
                    confirmLabel: 'Cerrar'
                });
                return;
            }
            if (act === 'support') { enterSupportMode({ id: id, name: ds.name || id, kind: 'cuenta' }); return; }
            if (act === 'suspend') {
                var res = await confirmModal({ title: 'Suspender cuenta', body: 'La cuenta no podrá entrar hasta la fecha fin que indiques. Queda registrado en auditoría.', requireReason: true, confirmLabel: 'Suspender' });
                if (!res) return;
                var until = prompt('Fecha fin de la suspensión (AAAA-MM-DD). Es obligatoria: el servidor no acepta suspensiones sin fecha fin:');
                if (!until) { toast('La suspensión exige una fecha fin (la requiere el servidor).', 'error'); return; }
                await rpc('set_account_status', { p_user_id: id, p_estado: 'suspendido', p_motivo: res.reason, p_suspendido_hasta: new Date(until + 'T23:59:59').toISOString() });
                await audit('suspender_cuenta', 'Cuenta ' + id + ' suspendida. Motivo: ' + res.reason);
                toast('Cuenta suspendida.', 'success');
            }
            if (act === 'cancel') {
                var res2 = await confirmModal({ title: 'Cancelar cuenta', body: 'La cancelación es definitiva para esa cuenta. Escribe CANCELAR y el motivo obligatorio.', requireReason: true, requireType: 'CANCELAR', confirmLabel: 'Cancelar cuenta', danger: true });
                if (!res2) return;
                await rpc('set_account_status', { p_user_id: id, p_estado: 'cancelado', p_motivo: res2.reason });
                await audit('cancelar_cuenta', 'Cuenta ' + id + ' cancelada. Motivo: ' + res2.reason);
                toast('Cuenta cancelada.', 'success');
            }
            if (act === 'reactivate') {
                var res3 = await confirmModal({ title: 'Reactivar cuenta', body: 'La cuenta vuelve a estar activa.', requireReason: true, confirmLabel: 'Reactivar' });
                if (!res3) return;
                await rpc('set_account_status', { p_user_id: id, p_estado: 'activo', p_motivo: res3.reason });
                await audit('reactivar_cuenta', 'Cuenta ' + id + ' reactivada. Motivo: ' + res3.reason);
                toast('Cuenta reactivada.', 'success');
            }
            if (act === 'reset') {
                if (!ds.email) { toast('Esa cuenta no tiene correo registrado.', 'error'); return; }
                var res4 = await confirmModal({ title: 'Enviar correo de restablecer contraseña', body: 'Se envía un correo a ' + ds.email + ' para que cree una contraseña nueva.', confirmLabel: 'Enviar correo' });
                if (!res4) return;
                var rr = await c.auth.resetPasswordForEmail(ds.email);
                if (rr.error) throw new Error(rr.error.message);
                await audit('reset_password', 'Correo de restablecer contraseña enviado a ' + ds.email + '.');
                toast('Correo de restablecer contraseña enviado.', 'success');
            }
            if (act === 'reauth') {
                var res5 = await confirmModal({ title: 'Cerrar sesiones de esta cuenta', body: 'Se marca force_reauth: la próxima vez que la cuenta abra la página deberá volver a iniciar sesión. La revocación inmediata de sesiones en todos los dispositivos requiere la llave de servidor (no existe en el frontend) — ver README.', requireReason: true, confirmLabel: 'Cerrar sesiones' });
                if (!res5) return;
                var closed = await rpc('close_user_sessions', { p_user_id: id });
                await audit('force_reauth', 'force_reauth activado para ' + id + '. Motivo: ' + res5.reason);
                toast('La cuenta deberá volver a iniciar sesión. ' + ((closed && closed.message) || 'La revocación inmediata requiere la llave de servidor (ver README).'), 'warning');
            }
            RENDERERS.accounts();
        } catch (err) {
            toast('No se pudo completar la acción: ' + (err.message || 'error.'), 'error');
        }
    }

    /* ------------------------------------------------------------------ */
    /* (3) Cuentas bloqueadas por intentos fallidos                      */
    // Desbloqueo con las RPCs REALES de F: unlock_account(email) resetea el
    // contador y reactiva el perfil 'bloqueado'; el "forzar cambio de
    // contraseña" es otra RPC (force_password_change) sobre el usuario.
    var unblockAccount = async function (email, force) {
        await rpc('unlock_account', { p_email: email });
        if (force) {
            var profs = await tableSelect('profiles', { limit: 500 });
            var p = profs.filter(function (x) { return (x.email || '').toLowerCase() === String(email).toLowerCase(); })[0];
            if (!p) throw new Error('no hay un perfil con ese correo para forzar el cambio de contraseña.');
            await rpc('force_password_change', { p_user_id: p.id });
        }
    };

    /* ------------------------------------------------------------------ */
    // La tabla login_attempts de F es un AGREGADO por email (una fila por
    // correo): count, last_at, blocked_until, last_ip, last_device. No es
    // un registro intento por intento; el "historial" es la última
    // actividad agregada de cada correo.
    RENDERERS.blocked = async function () {
        var sec = $('module-blocked');
        var settings = [];
        try { settings = await tableSelect('admin_settings', { limit: 50 }); } catch (_) {}
        var maxRow = null;
        settings.forEach(function (r) { if (r.key === 'max_login_attempts') maxRow = r; });
        var maxVal = maxRow && typeof maxRow.value_int === 'number' ? maxRow.value_int : MAX_ATTEMPTS;
        var settingsPanel = '<div class="sa-panel"><h3>Intentos permitidos</h3>' +
            '<p class="sa-muted">Cuántos intentos fallidos seguidos se aceptan antes de bloquear el acceso (lo aplica el servidor con record_login_attempt). Hoy: <strong>' + maxVal + '</strong>. La duración del bloqueo (lockout_minutes) se ajusta en la tabla admin_settings desde el editor SQL.</p>' +
            '<div class="sa-form-row"><label class="sa-field"><span>Máximo de intentos (1–10)</span><input id="sa-max-attempts" type="number" min="1" max="10" value="' + maxVal + '"></label></div>' +
            '<div class="sa-row-actions"><button class="btn btn-ghost" id="sa-max-save">Guardar máximo</button></div></div>';
        var wireMax = function () {
            var btn = $('sa-max-save');
            if (!btn) return;
            btn.addEventListener('click', async function () {
                var n = parseInt($('sa-max-attempts').value, 10);
                if (!(n >= 1 && n <= 10)) { toast('El máximo debe estar entre 1 y 10.', 'error'); return; }
                try {
                    await rpc('set_max_login_attempts', { p_max: n });
                    await audit('max_intentos_login', 'Máximo de intentos de login actualizado a ' + n + '.');
                    toast('Máximo de intentos actualizado a ' + n + '.', 'success');
                } catch (err) { toast('No se pudo guardar el máximo: ' + (err.message || 'la RPC set_max_login_attempts no está disponible.'), 'error'); }
            });
        };
        var attempts = [];
        try { attempts = await tableSelect('login_attempts', { order: 'last_at', limit: 200 }); }
        catch (err) { sec.innerHTML = '<div class="sa-panel">' + emptyState('fa-lock', 'No se pudo leer login_attempts: ' + err.message) + '</div>' + settingsPanel; wireMax(); return; }
        var now = Date.now();
        var rows = attempts.filter(function (a) { return a.blocked_until && new Date(a.blocked_until).getTime() > now; });
        if (!rows.length) {
            sec.innerHTML = '<div class="sa-panel">' + emptyState('fa-lock', 'No hay cuentas bloqueadas por intentos fallidos.') + '</div>' + settingsPanel;
            wireMax();
            return;
        }
        var body = rows.map(function (a) {
            return '<tr><td>' + esc(a.email || a.user_id || '') + '</td><td>' + fmtDate(a.last_at) + '</td><td>' + (a.count || 0) + '</td><td>' + fmtDate(a.blocked_until) + '</td><td>' + esc(a.last_ip || '—') + '</td><td class="sa-muted">' + esc(a.last_device || '—') + '</td><td>' +
                '<button class="btn btn-ghost" data-unblock="' + esc(a.email || '') + '">Desbloquear</button>' +
                '<button class="btn btn-ghost" data-unblock-force="' + esc(a.email || '') + '">Desbloquear + forzar cambio de contraseña</button></td></tr>';
        }).join('');
        sec.innerHTML = '<div class="sa-panel"><div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Usuario</th><th>Último intento</th><th>Intentos</th><th>Bloqueado hasta</th><th>IP</th><th>Dispositivo</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div></div>' + settingsPanel;
        wireMax();
        sec.querySelectorAll('[data-unblock]').forEach(function (b) {
            b.addEventListener('click', async function () {
                var email = b.getAttribute('data-unblock');
                if (!await confirmModal({ title: 'Desbloquear', body: '¿Desbloquear ' + email + '?', confirmLabel: 'Desbloquear' })) return;
                try { await unblockAccount(email, false); await audit('desbloqueo', 'Cuenta ' + email + ' desbloqueada.'); toast('Cuenta desbloqueada.', 'success'); loadModule('blocked'); }
                catch (err) { toast('No se pudo desbloquear: ' + (err.message || 'la RPC unlock_account no está disponible.'), 'error'); }
            });
        });
        sec.querySelectorAll('[data-unblock-force]').forEach(function (b) {
            b.addEventListener('click', async function () {
                var email = b.getAttribute('data-unblock-force');
                if (!await confirmModal({ title: 'Desbloquear y forzar cambio', body: '¿Desbloquear ' + email + ' y obligar a cambiar la contraseña en el próximo inicio?', confirmLabel: 'Desbloquear + forzar' })) return;
                try { await unblockAccount(email, true); await audit('desbloqueo', 'Cuenta ' + email + ' desbloqueada con cambio de contraseña forzado.'); toast('Cuenta desbloqueada con cambio de contraseña forzado.', 'success'); loadModule('blocked'); }
                catch (err) { toast('No se pudo desbloquear: ' + (err.message || 'la RPC unlock_account no está disponible.'), 'error'); }
            });
        });
    };

    /* (4) Entrar como — VISTA DE SOPORTE (no suplantación real).          */
    /* ------------------------------------------------------------------ */
    function enterSupportMode(target) {
        state.support = target;
        state.supportCanEdit = false;
        var bar = $('sa-support-bar');
        $('sa-support-name').textContent = target.name || target.id;
        $('sa-support-edit').checked = false;
        bar.hidden = false;
        document.body.classList.add('sa-support-readonly');
        audit('modo_soporte_inicio', 'Vista de soporte sobre ' + target.kind + ' ' + target.name + ' (' + target.id + '). Solo lectura.');
        toast('Modo soporte: estás viendo como ' + (target.name || target.id) + '. Solo lectura por defecto.', 'warning');
        showModule('support');
    }
    function exitSupportMode() {
        if (!state.support) return;
        audit('modo_soporte_fin', 'Fin de la vista de soporte sobre ' + state.support.name + '.');
        state.support = null;
        state.supportCanEdit = false;
        $('sa-support-bar').hidden = true;
        document.body.classList.remove('sa-support-readonly');
        toast('Saliste del modo soporte.', 'success');
    }
    RENDERERS.support = async function () {
        var sec = $('module-support');
        sec.innerHTML = '<div class="sa-panel"><p class="sa-muted">Elige un barbero o una cuenta para ver su panel en modo soporte. Es una <strong>vista de soporte con acciones auditadas</strong>, no una suplantación de sesión real: el frontend no tiene llave de servidor y nunca inicia sesión como esa persona. Todo lo que hagas aquí queda en auditoría.</p>' +
            '<div class="sa-toolbar"><input id="sa-support-search" type="search" placeholder="Buscar barbero por nombre…"></div><div id="sa-support-list">' + loadingState('Cargando barberos…') + '</div></div>';
        var render = async function () {
            var list = $('sa-support-list');
            try {
                var barbers = await tableSelect('barbers');
                var q = ($('sa-support-search').value || '').toLowerCase();
                var rows = barbers.filter(function (b) { return !q || (b.name || '').toLowerCase().includes(q); });
                if (!rows.length) { list.innerHTML = emptyState('fa-user-shield', 'No hay barberos que coincidan con esa búsqueda.'); return; }
                list.innerHTML = '<div class="sa-list">' + rows.map(function (b) {
                    return '<div class="sa-list-item"><strong>' + esc(b.name || '') + '</strong><span class="sa-meta">' + esc(b.alias || '') + ' · ' + esc(b.email || 'sin correo') + '</span>' +
                        '<div class="sa-row-actions"><button class="btn btn-primary btn-sm" data-enter="' + esc(b.id) + '" data-name="' + esc(b.name || '') + '">Entrar como ' + esc(b.name || '') + '</button></div></div>';
                }).join('') + '</div>';
                list.querySelectorAll('[data-enter]').forEach(function (btn) {
                    btn.addEventListener('click', function () { enterSupportMode({ id: btn.dataset.enter, name: btn.dataset.name, kind: 'barbero' }); });
                });
            } catch (err) {
                list.innerHTML = emptyState('fa-user-shield', 'No se pudieron cargar los barberos: ' + (err.message || 'sin conexión.'));
            }
        };
        $('sa-support-search').addEventListener('input', render);
        await render();
    };

    /* ------------------------------------------------------------------ */
    /* (5) Permisos por área                                               */
    /* ------------------------------------------------------------------ */
    RENDERERS.permissions = async function () {
        var sec = $('module-permissions');
        sec.innerHTML = loadingState('Cargando permisos…');
        try {
            var barbers = await tableSelect('barbers');
            state.perms = await tableSelect('area_permissions');
            var grid = function (barberId) {
                return AREAS.map(function (area) {
                    var row = state.perms.find(function (p) { return String(p.barber_id) === String(barberId) && p.area === area.key; });
                    var on = row ? !!row.permitido : false;
                    return '<div class="sa-switch-row"><span>' + esc(area.label) + '</span><label class="sa-switch"><input type="checkbox" data-barber="' + esc(barberId) + '" data-area="' + esc(area.key) + '"' + (on ? ' checked' : '') + '><span class="sa-slider"></span></label></div>';
                }).join('');
            };
            sec.innerHTML = '<div class="sa-panel"><h3>Plantillas</h3><div class="sa-toolbar">' +
                Object.keys(TEMPLATES).map(function (t) { return '<button class="btn btn-ghost" data-template="' + esc(t) + '">Aplicar “' + esc(TEMPLATES[t].nombre) + '” a todos</button>'; }).join('') +
                '<span class="sa-muted">Los cambios se aplican de inmediato (Realtime).</span></div></div>' +
                (barbers.length ? barbers.map(function (b) {
                    return '<div class="sa-panel"><h3>' + esc(b.name || '') + '</h3>' + grid(b.id) + '</div>';
                }).join('') : emptyState('fa-key', 'No hay barberos para configurar permisos.'));
            sec.querySelectorAll('input[data-barber]').forEach(function (sw) {
                sw.addEventListener('change', async function () {
                    try {
                        await rpc('set_area_permission', { p_barber_id: sw.dataset.barber, p_area: sw.dataset.area, p_permitido: sw.checked });
                        await audit('permiso_area', 'Permiso ' + sw.dataset.area + ' = ' + (sw.checked ? 'sí' : 'no') + ' para barbero ' + sw.dataset.barber + '.');
                        toast('Permiso actualizado.', 'success');
                    } catch (err) {
                        sw.checked = !sw.checked;
                        toast('No se pudo guardar el permiso: ' + (err.message || 'la RPC set_area_permission no está disponible todavía.'), 'error');
                    }
                });
            });
            sec.querySelectorAll('[data-template]').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    var tpl = TEMPLATES[btn.dataset.template];
                    var ok = await confirmModal({ title: 'Aplicar plantilla “' + tpl.nombre + '”', body: 'Se aplican estos permisos a TODOS los barberos. Queda registrado en auditoría.', requireReason: true, confirmLabel: 'Aplicar plantilla' });
                    if (!ok) return;
                    try {
                        // Plantillas reales del servidor (F): una sola RPC por barbero.
                        for (var i = 0; i < barbers.length; i++) {
                            await rpc('apply_permission_template', { p_barber_id: barbers[i].id, p_template_id: btn.dataset.template });
                        }
                        await audit('plantilla_permisos', 'Plantilla “' + tpl.nombre + '” aplicada a todos los barberos. Motivo: ' + ok.reason);
                        toast('Plantilla aplicada.', 'success');
                        RENDERERS.permissions();
                    } catch (err) { toast('No se pudo aplicar la plantilla: ' + (err.message || 'error.'), 'error'); }
                });
            });
            subscribePermsRealtime();
        } catch (err) {
            sec.innerHTML = '<div class="sa-panel">' + emptyState('fa-key', 'No se pudieron cargar los permisos: ' + (err.message || 'sin conexión.')) + '</div>';
        }
    };
    var permsSubscribed = false;
    function subscribePermsRealtime() {
        if (permsSubscribed) return;
        getClient().then(function (c) {
            if (!c || typeof c.channel !== 'function') return;
            try {
                c.channel('sa-area-permissions')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'area_permissions' }, function () {
                        if (state.currentModule === 'permissions') RENDERERS.permissions();
                    })
                    .subscribe();
                permsSubscribed = true;
            } catch (_) { /* Realtime opcional */ }
        });
    }

    /* ------------------------------------------------------------------ */
    /* (6) Mantenimiento                                                    */
    /* ------------------------------------------------------------------ */
    RENDERERS.maintenance = async function () {
        var sec = $('module-maintenance');
        sec.innerHTML = loadingState('Cargando mantenimiento…');
        try {
            var rows = await tableSelect('maintenance');
            var globalRow = rows.find(function (r) { return r.scope === 'global' || r.area === 'global'; }) || {};
            var areaRows = {};
            AREAS.forEach(function (a) { areaRows[a.key] = rows.find(function (r) { return r.area === a.key; }); });
            sec.innerHTML = '<div class="sa-panel"><h3>Modo mantenimiento</h3>' +
                '<p class="sa-muted">El super administrador siempre entra, aunque el mantenimiento esté activo (lista blanca). Los clientes ven el mensaje que escribas.</p>' +
                '<div class="sa-switch-row"><span><strong>Global</strong> — toda la página en mantenimiento</span><label class="sa-switch"><input type="checkbox" id="sa-maint-global"' + (globalRow.activa ? ' checked' : '') + '><span class="sa-slider"></span></label></div>' +
                AREAS.map(function (a) {
                    var r = areaRows[a.key];
                    return '<div class="sa-switch-row"><span>' + esc(a.label) + '</span><label class="sa-switch"><input type="checkbox" data-maint-area="' + esc(a.key) + '"' + (r && r.activa ? ' checked' : '') + '><span class="sa-slider"></span></label></div>';
                }).join('') + '</div>' +
                '<div class="sa-panel"><h3>Mensaje e inicio / fin programados</h3><div class="sa-form">' +
                '<label class="sa-field"><span>Mensaje para los clientes</span><textarea id="sa-maint-msg" rows="3">' + esc(globalRow.mensaje || '') + '</textarea></label>' +
                '<div class="sa-form-row"><label class="sa-field"><span>Inicio programado</span><input type="datetime-local" id="sa-maint-start" value="' + esc(toLocalInput(globalRow.inicia_at)) + '"></label>' +
                '<label class="sa-field"><span>Fin programado</span><input type="datetime-local" id="sa-maint-end" value="' + esc(toLocalInput(globalRow.termina_at)) + '"></label></div>' +
                '<div><button class="btn btn-primary" id="sa-maint-save">Guardar mensaje y horario</button></div>' +
                '</div></div>';
            var saveOne = async function (area, enabled) {
                try {
                    await rpc('set_maintenance', { p_area: area, p_activa: enabled, p_mensaje: null, p_inicia_at: null, p_termina_at: null });
                    await audit('mantenimiento', 'Mantenimiento ' + area + ' = ' + (enabled ? 'activado' : 'desactivado') + '.');
                    toast('Mantenimiento actualizado.', 'success');
                } catch (err) { toast('No se pudo guardar: ' + (err.message || 'la RPC set_maintenance no está disponible todavía.'), 'error'); RENDERERS.maintenance(); }
            };
            $('sa-maint-global').addEventListener('change', function (e) { saveOne('global', e.target.checked); });
            sec.querySelectorAll('[data-maint-area]').forEach(function (sw) {
                sw.addEventListener('change', function () { saveOne(sw.dataset.maintArea, sw.checked); });
            });
            $('sa-maint-save').addEventListener('click', async function () {
                try {
                    await rpc('set_maintenance', {
                        p_area: 'global',
                        p_activa: $('sa-maint-global').checked,
                        p_mensaje: $('sa-maint-msg').value.trim() || null,
                        p_inicia_at: $('sa-maint-start').value ? new Date($('sa-maint-start').value).toISOString() : null,
                        p_termina_at: $('sa-maint-end').value ? new Date($('sa-maint-end').value).toISOString() : null
                    });
                    await audit('mantenimiento_mensaje', 'Mensaje y horario de mantenimiento actualizados.');
                    toast('Mensaje y horario guardados.', 'success');
                } catch (err) { toast('No se pudo guardar: ' + (err.message || 'error.'), 'error'); }
            });
        } catch (err) {
            sec.innerHTML = '<div class="sa-panel">' + emptyState('fa-screwdriver-wrench', 'No se pudo cargar el mantenimiento: ' + (err.message || 'sin conexión.')) + '</div>';
        }
    };
    function toLocalInput(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // Envío masivo con la RPC REAL de F: send_mass_notification solo
    // acepta audience 'client' o 'staff'. 'staff' sin lista = TODOS los
    // barberos activos; 'client' EXIGE una lista de clientes (ids 'cl-…' o
    // correos, que aquí se resuelven contra la tabla clients).
    var resolveClientIds = async function (target) {
        var raw = String(target || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        if (!raw.length) return [];
        var clients = await tableSelect('clients', { limit: 500 });
        var ids = [];
        raw.forEach(function (t) {
            var low = t.toLowerCase();
            var found = clients.filter(function (c) { return c.id === t || (c.email || '').toLowerCase() === low; })[0];
            if (found) ids.push(found.id);
        });
        return ids;
    };
    var sendMass = async function (opts) {
        var aud = opts.audience, target = opts.target || '';
        if (aud === 'barbers' || aud === 'all') {
            return await rpc('send_mass_notification', { p_title: opts.title, p_body: opts.body, p_audience: 'staff', p_client_ids: [], p_barber_ids: [] });
        }
        if (aud === 'barber') {
            var barbers = await tableSelect('barbers');
            var b = barbers.filter(function (x) { return x.id === target || (x.email || '').toLowerCase() === target.toLowerCase(); })[0];
            if (!b) throw new Error('no se encontró ese barbero (usa su id o su correo).');
            return await rpc('send_mass_notification', { p_title: opts.title, p_body: opts.body, p_audience: 'staff', p_client_ids: [], p_barber_ids: [b.id] });
        }
        if (aud === 'clients' || aud === 'user') {
            var ids = await resolveClientIds(target);
            if (!ids.length) throw new Error('el servidor exige una lista de clientes: escribe sus ids o correos separados por comas.');
            return await rpc('send_mass_notification', { p_title: opts.title, p_body: opts.body, p_audience: 'client', p_client_ids: ids, p_barber_ids: [] });
        }
        throw new Error('destinatarios no soportados: ' + aud);
    };

    /* ------------------------------------------------------------------ */
    /* (7) Centro de notificaciones                                         */
    /* ------------------------------------------------------------------ */
    RENDERERS.notifications = async function () {
        var sec = $('module-notifications');
        sec.innerHTML = '<div class="sa-grid-2"><div class="sa-panel"><h3>Enviar aviso</h3><div class="sa-form">' +
            '<label class="sa-field"><span>Destinatarios</span><select id="sa-ntf-audience"><option value="all">Todos (el servidor lo envía a los barberos; a clientes solo con lista)</option><option value="barbers">Todos los barberos</option><option value="clients">Clientes (lista de ids o correos)</option><option value="barber">Un barbero</option><option value="user">Un cliente</option></select></label>' +
            '<label class="sa-field"><span>Destinatario (id o correo; en “Clientes”, la lista separada por comas)</span><input id="sa-ntf-target" type="text" placeholder="correo o id"></label>' +
            '<label class="sa-field"><span>Título</span><input id="sa-ntf-title" type="text" placeholder="Título del aviso"></label>' +
            '<label class="sa-field"><span>Mensaje</span><textarea id="sa-ntf-body" rows="4" placeholder="Mensaje del aviso"></textarea></label>' +
            '<label class="sa-field"><span>Enlace (opcional, se añade al final del mensaje)</span><input id="sa-ntf-link" type="text" placeholder="notificaciones.html"></label>' +
            '<div class="sa-form-row"><label class="sa-field"><span>Cuándo</span><select id="sa-ntf-when"><option value="now">Ahora</option><option value="scheduled">Programado</option></select></label>' +
            '<label class="sa-field"><span>Fecha y hora (si es programado)</span><input id="sa-ntf-when-at" type="datetime-local"></label></div>' +
            '<div class="sa-row-actions"><button class="btn btn-primary" id="sa-ntf-send">Enviar aviso</button></div>' +
            '</div></div>' +
            '<div><div class="sa-panel"><h3>Vista previa</h3><div class="sa-preview" id="sa-ntf-preview"><strong>—</strong><p class="sa-muted">Escribe el título y el mensaje para ver la vista previa.</p></div></div>' +
            '<div class="sa-panel"><h3>Banner global</h3><p class="sa-muted">Un aviso fijo arriba de la página para todos los visitantes. Se guarda en admin_settings (clave global_banner); la app pública aún no lo muestra, así que activarlo aquí todavía no lo hace visible (ver README).</p>' +
            '<label class="sa-field"><span>Texto del banner</span><input id="sa-banner-text" type="text" placeholder="Texto del banner global"></label>' +
            '<div class="sa-row-actions" style="margin-top:.75rem"><button class="btn btn-ghost" id="sa-banner-on">Activar banner</button><button class="btn btn-ghost" id="sa-banner-off">Quitar banner</button></div></div></div></div>' +
            '<div class="sa-panel"><h3>Historial de avisos</h3><div id="sa-ntf-history">' + loadingState('Cargando historial…') + '</div></div>';
        var preview = function () {
            var t = $('sa-ntf-title').value.trim(), b = $('sa-ntf-body').value.trim();
            $('sa-ntf-preview').innerHTML = '<strong>' + esc(t || '—') + '</strong><p>' + esc(b || 'Escribe el título y el mensaje para ver la vista previa.') + '</p><p class="sa-muted">Para: ' + esc($('sa-ntf-audience').value) + '</p>';
        };
        ['sa-ntf-title', 'sa-ntf-body', 'sa-ntf-audience'].forEach(function (id) { $(id).addEventListener('input', preview); });
        var loadHistory = async function () {
            var box = $('sa-ntf-history');
            try {
                var rows = await tableSelect('notifications', { order: 'created_at', limit: 50 });
                if (!rows.length) { box.innerHTML = emptyState('fa-bell', 'Todavía no se ha enviado ningún aviso.'); return; }
                box.innerHTML = '<div class="sa-list">' + rows.map(function (n) {
                    return '<div class="sa-list-item"><strong>' + esc(n.title || '') + '</strong><span>' + esc(n.body || '') + '</span><span class="sa-meta">' + esc(n.audience || '') + ' · ' + fmtDate(n.created_at) + '</span></div>';
                }).join('') + '</div>';
            } catch (err) { box.innerHTML = emptyState('fa-bell', 'No se pudo cargar el historial: ' + (err.message || 'sin conexión.')); }
        };
        $('sa-ntf-send').addEventListener('click', async function () {
            var title = $('sa-ntf-title').value.trim(), body = $('sa-ntf-body').value.trim();
            if (!title || !body) { toast('El título y el mensaje son obligatorios.', 'error'); return; }
            var when = $('sa-ntf-when').value;
            // La migración F no tiene envío programado: send_mass_notification
            // envía al momento. No se finge programar nada.
            if (when === 'scheduled') { toast('El envío programado no está soportado por el servidor todavía: el aviso se enviaría ahora mismo. Cambia “Cuándo” a “Ahora” si quieres enviarlo.', 'error'); return; }
            var aud = $('sa-ntf-audience').value;
            var ok = await confirmModal({ title: 'Enviar aviso', body: 'Destinatarios: ' + aud + ' · Se envía ahora.', confirmLabel: 'Enviar' });
            if (!ok) return;
            try {
                var link = $('sa-ntf-link').value.trim();
                var fullBody = link ? body + '\nEnlace: ' + link : body;
                var sent = await sendMass({ audience: aud, target: $('sa-ntf-target').value.trim(), title: title, body: fullBody });
                var n = sent && typeof sent.inserted === 'number' ? sent.inserted : 0;
                await audit('enviar_aviso', 'Aviso “' + title + '” para ' + aud + ': ' + n + ' destinatario(s).');
                if (aud === 'all') toast('Aviso enviado a ' + n + ' barbero(s). A los clientes NO se les envió: el servidor exige una lista de clientes para enviarles.', 'warning');
                else toast('Aviso enviado a ' + n + ' destinatario(s).', 'success');
                loadHistory();
            } catch (err) { toast('No se pudo enviar: ' + (err.message || 'la RPC send_mass_notification no está disponible todavía.'), 'error'); }
        });
        var banner = async function (active) {
            var text = $('sa-banner-text').value.trim();
            if (active && !text) { toast('Escribe el texto del banner.', 'error'); return; }
            try {
                // F no tiene RPC de banner: el ajuste vive en admin_settings
                // (clave 'global_banner', JSON en value_text). La app pública
                // aún no lo lee: queda guardado, no visible (ver README).
                var c = await getClient();
                var up = await c.from('admin_settings').upsert([{ key: 'global_banner', value_text: JSON.stringify({ active: active, message: active ? text : '' }) }], { onConflict: 'key' });
                if (up.error) throw new Error(up.error.message);
                await audit('banner_global', 'Banner global ' + (active ? 'activado: ' + text : 'desactivado') + ' (guardado en admin_settings; la app aún no lo muestra).');
                toast(active ? 'Banner global guardado (la app pública aún no lo muestra).' : 'Banner global quitado.', 'warning');
            } catch (err) { toast('No se pudo cambiar el banner: ' + (err.message || 'la tabla admin_settings no aceptó el cambio.'), 'error'); }
        };
        $('sa-banner-on').addEventListener('click', function () { banner(true); });
        $('sa-banner-off').addEventListener('click', function () { banner(false); });
        await loadHistory();
    };

    /* ------------------------------------------------------------------ */
    /* (8) Soporte y tickets                                                */
    /* ------------------------------------------------------------------ */
    RENDERERS.tickets = async function () {
        var sec = $('module-tickets');
        sec.innerHTML = loadingState('Cargando tickets…');
        try {
            var tickets = await tableSelect('tickets', { order: 'created_at', limit: 100 });
            state.ticketsCache = tickets;
            if (!tickets.length) { sec.innerHTML = '<div class="sa-panel">' + emptyState('fa-life-ring', 'No hay tickets de soporte.') + '</div>'; return; }
            sec.innerHTML = '<div class="sa-panel"><div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Asunto</th><th>De</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>' +
                tickets.map(function (t) {
                    return '<tr><td><strong>' + esc(t.titulo || 'Sin asunto') + '</strong></td><td>' + esc(t.reporter_email || t.reporter_name || '—') + '</td><td>' + statusBadge(t.estado || 'abierto') + '</td><td>' + fmtDate(t.created_at) + '</td>' +
                        '<td><button class="btn btn-primary btn-sm" data-ticket="' + esc(t.id) + '">Abrir</button></td></tr>';
                }).join('') + '</tbody></table></div><div id="sa-ticket-detail" style="margin-top:1.25rem"></div></div>';
            sec.querySelectorAll('[data-ticket]').forEach(function (b) {
                b.addEventListener('click', function () { openTicket(b.dataset.ticket); });
            });
        } catch (err) {
            sec.innerHTML = '<div class="sa-panel">' + emptyState('fa-life-ring', 'No se pudieron cargar los tickets: ' + (err.message || 'sin conexión.')) + '</div>';
        }
    };
    async function openTicket(ticketId) {
        var box = $('sa-ticket-detail');
        var t = state.ticketsCache.find(function (x) { return String(x.id) === String(ticketId); }) || {};
        box.innerHTML = loadingState('Cargando conversación…');
        try {
            var msgs = await tableSelect('ticket_messages', { eq: [['ticket_id', ticketId]], order: 'created_at' });
            var replies = [];
            try { replies = await tableSelect('saved_replies'); } catch (_) {}
            box.innerHTML = '<div class="sa-panel"><h3>' + esc(t.titulo || 'Ticket') + '</h3>' +
                '<p class="sa-muted">De: ' + esc(t.reporter_email || t.reporter_name || '—') + ' · Estado: ' + esc(t.estado || 'abierto') + '</p>' +
                '<div class="sa-row-actions" style="margin:.75rem 0"><button class="btn btn-ghost btn-sm" id="sa-tk-support">Entrar como</button>' +
                '<button class="btn btn-ghost btn-sm" id="sa-tk-unblock">Desbloquear</button>' +
                '<button class="btn btn-ghost btn-sm" id="sa-tk-appts">Ver sus citas</button></div>' +
                (msgs.length ? '<div class="sa-list">' + msgs.map(function (m) {
                    return '<div class="sa-list-item"><strong>' + esc(m.author_role || 'usuario') + (m.is_internal ? ' (nota interna)' : '') + '</strong><span>' + esc(m.mensaje || '') + '</span><span class="sa-meta">' + fmtDate(m.created_at) + '</span></div>';
                }).join('') + '</div>' : emptyState('fa-comments', 'Sin mensajes en este ticket todavía.')) +
                '<div class="sa-form" style="margin-top:1rem"><label class="sa-field"><span>Respuesta</span><textarea id="sa-tk-reply" rows="3" placeholder="Escribe tu respuesta…"></textarea></label>' +
                (replies.length ? '<label class="sa-field"><span>Respuesta guardada</span><select id="sa-tk-saved"><option value="">— Elegir una respuesta guardada —</option>' + replies.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.titulo || r.cuerpo || '') + '</option>'; }).join('') + '</select></label>' : '') +
                '<div class="sa-row-actions"><button class="btn btn-primary" id="sa-tk-send">Enviar respuesta</button><button class="btn btn-ghost" id="sa-tk-note">Añadir nota interna</button></div></div></div>';
            $('sa-tk-support').addEventListener('click', function () { enterSupportMode({ id: t.created_by || t.reporter_email || ticketId, name: t.reporter_name || t.reporter_email || 'usuario del ticket', kind: 'cuenta' }); });
            $('sa-tk-unblock').addEventListener('click', function () { if (t.reporter_email) unblockAccount(t.reporter_email, false); else toast('Este ticket no tiene correo asociado.', 'error'); });
            $('sa-tk-appts').addEventListener('click', function () { showModule('appointments'); var s = $('sa-appt-search'); if (s) { s.value = t.reporter_name || t.reporter_email || ''; s.dispatchEvent(new Event('input')); } });
            var savedSel = $('sa-tk-saved');
            if (savedSel) savedSel.addEventListener('change', function () {
                var r = replies.find(function (x) { return String(x.id) === String(savedSel.value); });
                if (r) $('sa-tk-reply').value = r.cuerpo || '';
            });
            var sendMsg = async function (internal) {
                var body = $('sa-tk-reply').value.trim();
                if (!body) { toast('Escribe la respuesta primero.', 'error'); return; }
                try { await rpc('add_ticket_reply', { p_ticket_id: ticketId, p_mensaje: body, p_is_internal: !!internal }); }
                catch (err2) { toast('No se pudo guardar el mensaje: ' + (err2.message || 'la RPC add_ticket_reply no está disponible.'), 'error'); return; }
                await audit(internal ? 'ticket_nota_interna' : 'ticket_respuesta', 'Ticket ' + ticketId + ': ' + body.slice(0, 120));
                toast(internal ? 'Nota interna guardada.' : 'Respuesta enviada.', 'success');
                openTicket(ticketId);
            };
            $('sa-tk-send').addEventListener('click', function () { sendMsg(false); });
            $('sa-tk-note').addEventListener('click', function () { sendMsg(true); });
        } catch (err) {
            box.innerHTML = emptyState('fa-comments', 'No se pudo cargar la conversación: ' + (err.message || 'sin conexión.'));
        }
    }

    /* ------------------------------------------------------------------ */
    /* (9) Citas                                                            */
    /* ------------------------------------------------------------------ */
    RENDERERS.appointments = async function () {
        var sec = $('module-appointments');
        sec.innerHTML = '<div class="sa-panel"><div class="sa-toolbar"><input id="sa-appt-search" type="search" placeholder="Buscar por código (GS-…) o nombre del cliente…"></div><div id="sa-appt-list">' + loadingState('Busca una cita por su código o por el nombre del cliente.') + '</div></div>';
        var render = async function () {
            var q = ($('sa-appt-search').value || '').trim().toLowerCase();
            var list = $('sa-appt-list');
            if (!q) { list.innerHTML = emptyState('fa-calendar-check', 'Busca una cita por su código o por el nombre del cliente.'); return; }
            try {
                var all = await tableSelect('appointments', { order: 'date_time', limit: 200 });
                var rows = all.filter(function (a) {
                    return (a.code || '').toLowerCase().includes(q) || (a.client_name || '').toLowerCase().includes(q);
                });
                state.apptsCache = rows;
                if (!rows.length) { list.innerHTML = emptyState('fa-calendar-check', 'No se encontró ninguna cita con “' + q + '”.'); return; }
                list.innerHTML = '<div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Código</th><th>Cliente</th><th>Barbero</th><th>Fecha y hora</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' +
                    rows.map(function (a) {
                        return '<tr><td><strong>' + esc(a.code || '') + '</strong></td><td>' + esc(a.client_name || '—') + '</td><td>' + esc(a.barber_name || a.barber_id || '—') + '</td><td>' + fmtDate(a.date_time) + '</td><td>' + statusBadge(a.status || '') + '</td>' +
                            '<td><div class="sa-row-actions"><button class="btn btn-danger btn-sm" data-appt-cancel="' + esc(a.code) + '">Cancelar</button>' +
                            '<button class="btn btn-ghost btn-sm" data-appt-reassign="' + esc(a.code) + '">Reasignar</button>' +
                            '<button class="btn btn-ghost btn-sm" data-appt-time="' + esc(a.code) + '">Cambiar hora</button></div></td></tr>';
                    }).join('') + '</tbody></table></div>';
                list.querySelectorAll('[data-appt-cancel]').forEach(function (b) { b.addEventListener('click', function () { apptCancel(b.dataset.apptCancel); }); });
                list.querySelectorAll('[data-appt-reassign]').forEach(function (b) { b.addEventListener('click', function () { apptReassign(b.dataset.apptReassign); }); });
                list.querySelectorAll('[data-appt-time]').forEach(function (b) { b.addEventListener('click', function () { apptChangeTime(b.dataset.apptTime); }); });
            } catch (err) { list.innerHTML = emptyState('fa-calendar-check', 'No se pudieron buscar las citas: ' + (err.message || 'sin conexión.')); }
        };
        $('sa-appt-search').addEventListener('input', render);
        await render();
    };
    async function notifyClient(appt, title, body) {
        try {
            var c = await getClient();
            await c.from('notifications').insert([{
                audience: 'client', client_id: appt.client_id || null, appointment_code: appt.code || null,
                type: 'cita', title: title, body: body
            }]);
        } catch (_) { /* el aviso en la app es lo mejor que se puede sin Edge Function */ }
    }
    async function apptCancel(code) {
        var appt = state.apptsCache.find(function (a) { return String(a.code) === String(code); }) || { code: code };
        var res = await confirmModal({ title: 'Cancelar cita ' + code, body: 'Se cancela la cita y se avisa al cliente automáticamente.', requireReason: true, confirmLabel: 'Cancelar cita', danger: true });
        if (!res) return;
        try {
            var c = await getClient();
            var r = await c.from('appointments').update({ status: 'CANCELADA' }).eq('code', code);
            if (r.error) throw new Error(r.error.message);
            await notifyClient(appt, 'Cita cancelada', 'Tu cita ' + code + ' fue cancelada por el super administrador. Motivo: ' + res.reason);
            await audit('cancelar_cita', 'Cita ' + code + ' cancelada. Motivo: ' + res.reason);
            toast('Cita cancelada y cliente avisado.', 'success');
            RENDERERS.appointments();
        } catch (err) { toast('No se pudo cancelar: ' + (err.message || 'error.'), 'error'); }
    }
    async function apptReassign(code) {
        var appt = state.apptsCache.find(function (a) { return String(a.code) === String(code); }) || { code: code };
        try {
            var barbers = await tableSelect('barbers');
            if (!barbers.length) { toast('No hay barberos para reasignar.', 'error'); return; }
            var choice = prompt('Reasignar la cita ' + code + ' a:\n' + barbers.map(function (b, i) { return (i + 1) + '. ' + b.name; }).join('\n') + '\nEscribe el número:');
            var idx = parseInt(choice, 10) - 1;
            if (isNaN(idx) || !barbers[idx]) { toast('Reasignación cancelada.', 'warning'); return; }
            var res = await confirmModal({ title: 'Reasignar cita', body: 'La cita ' + code + ' pasa a ' + barbers[idx].name + '. Se avisa al cliente automáticamente.', requireReason: true, confirmLabel: 'Reasignar' });
            if (!res) return;
            var c = await getClient();
            var r = await c.from('appointments').update({ barber_id: barbers[idx].id, barber_name: barbers[idx].name }).eq('code', code);
            if (r.error) throw new Error(r.error.message);
            await notifyClient(appt, 'Cita reasignada', 'Tu cita ' + code + ' ahora es con ' + barbers[idx].name + '.');
            await audit('reasignar_cita', 'Cita ' + code + ' reasignada a ' + barbers[idx].name + '. Motivo: ' + res.reason);
            toast('Cita reasignada y cliente avisado.', 'success');
            RENDERERS.appointments();
        } catch (err) { toast('No se pudo reasignar: ' + (err.message || 'error.'), 'error'); }
    }
    async function apptChangeTime(code) {
        var appt = state.apptsCache.find(function (a) { return String(a.code) === String(code); }) || { code: code };
        var val = prompt('Nueva fecha y hora para la cita ' + code + ' (AAAA-MM-DDTHH:MM):', toLocalInput(appt.date_time));
        if (!val) return;
        var res = await confirmModal({ title: 'Cambiar hora de la cita', body: 'La cita ' + code + ' pasa a ' + val.replace('T', ' ') + '. Se avisa al cliente automáticamente.', requireReason: true, confirmLabel: 'Cambiar hora' });
        if (!res) return;
        try {
            var c = await getClient();
            var r = await c.from('appointments').update({ date_time: new Date(val).toISOString() }).eq('code', code);
            if (r.error) throw new Error(r.error.message);
            await notifyClient(appt, 'Cita reprogramada', 'Tu cita ' + code + ' cambió a ' + val.replace('T', ' ') + '.');
            await audit('cambiar_hora_cita', 'Cita ' + code + ' movida a ' + val + '. Motivo: ' + res.reason);
            toast('Hora cambiada y cliente avisado.', 'success');
            RENDERERS.appointments();
        } catch (err) { toast('No se pudo cambiar la hora: ' + (err.message || 'error.'), 'error'); }
    }

    /* ------------------------------------------------------------------ */
    /* (10) Auditoría                                                       */
    /* ------------------------------------------------------------------ */
    RENDERERS.audit = async function () {
        var sec = $('module-audit');
        sec.innerHTML = '<div class="sa-panel"><div class="sa-toolbar">' +
            '<input id="sa-audit-from" type="date"><input id="sa-audit-to" type="date">' +
            '<input id="sa-audit-action" type="search" placeholder="Filtrar por acción…">' +
            '<input id="sa-audit-user" type="search" placeholder="Filtrar por usuario…">' +
            '<button class="btn btn-primary" id="sa-audit-csv">Exportar CSV</button></div>' +
            '<p class="sa-muted">La auditoría no se puede borrar ni editar. Solo lectura.</p>' +
            '<div id="sa-audit-list">' + loadingState('Cargando auditoría…') + '</div></div>';
        var render = async function () {
            var list = $('sa-audit-list');
            var rows = [];
            try { rows = await tableSelect('audit_log', { order: 'created_at', limit: 200 }); }
            catch (_) { rows = []; }
            rows = state.auditLocal.concat(rows);
            var from = $('sa-audit-from').value, to = $('sa-audit-to').value;
            var act = ($('sa-audit-action').value || '').toLowerCase(), usr = ($('sa-audit-user').value || '').toLowerCase();
            rows = rows.filter(function (r) {
                var d = String(r.created_at || '').slice(0, 10);
                return (!from || d >= from) && (!to || d <= to) &&
                    (!act || (r.action || '').toLowerCase().includes(act)) &&
                    (!usr || auditUser(r).toLowerCase().includes(usr));
            });
            sec._auditRows = rows;
            if (!rows.length) { list.innerHTML = emptyState('fa-clipboard-list', 'No hay registros de auditoría con esos filtros.'); return; }
            list.innerHTML = '<div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>Detalle</th></tr></thead><tbody>' +
                rows.map(function (r) {
                    return '<tr><td>' + fmtDate(r.created_at) + '</td><td><strong>' + esc(r.action || '') + '</strong></td><td>' + esc(auditUser(r) || '—') + '</td><td>' + esc(auditDetail(r)) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        };
        ['sa-audit-from', 'sa-audit-to', 'sa-audit-action', 'sa-audit-user'].forEach(function (id) { $(id).addEventListener('input', render); });
        $('sa-audit-csv').addEventListener('click', function () {
            var rows = sec._auditRows || [];
            downloadCsv('auditoria-goat-' + todayKey() + '.csv', buildCsv([
                { label: 'fecha', get: function (r) { return r.created_at || ''; } },
                { label: 'accion', get: function (r) { return r.action || ''; } },
                { label: 'usuario', get: function (r) { return auditUser(r); } },
                { label: 'detalle', get: function (r) { return auditDetail(r); } }
            ], rows));
            toast('CSV de auditoría descargado (' + rows.length + ' registros).', 'success');
        });
        await render();
    };

    /* ------------------------------------------------------------------ */
    /* (11) Estado del sistema                                              */
    /* ------------------------------------------------------------------ */
    RENDERERS.system = async function () {
        var sec = $('module-system');
        sec.innerHTML = loadingState('Comprobando el estado del sistema…');
        var supaOk = false, supaMsg = 'Sin conexión';
        try { await tableSelect('profiles', { limit: 1 }); supaOk = true; supaMsg = 'Supabase responde'; } catch (e) { supaMsg = e.message || 'Sin conexión'; }
        var fcmOk = !!(window.GABY_FIREBASE && window.GABY_FIREBASE.apiKey);
        var errors = [];
        try { errors = await tableSelect('error_logs', { order: 'created_at', limit: 20 }); } catch (_) {}
        sec.innerHTML = '<div class="sa-cards">' +
            '<div class="sa-card"><strong><span class="sa-dot ' + (supaOk ? 'green' : 'red') + '"></span>' + (supaOk ? 'Verde' : 'Rojo') + '</strong><span>Supabase — ' + esc(supaMsg) + '</span></div>' +
            '<div class="sa-card"><strong><span class="sa-dot ' + (fcmOk ? 'green' : 'red') + '"></span>' + (fcmOk ? 'Verde' : 'Rojo') + '</strong><span>FCM (Firebase push) — ' + (fcmOk ? 'configurado' : 'sin configurar: no hay push con la página cerrada') + '</span></div>' +
            '<div class="sa-card"><strong>' + errors.length + '</strong><span>Errores recientes</span></div></div>' +
            '<div class="sa-panel"><h3>Últimos errores</h3>' +
            (errors.length ? '<div class="sa-list">' + errors.map(function (e) {
                return '<div class="sa-list-item"><strong>' + esc(e.mensaje || 'Error') + '</strong><span class="sa-meta">' + esc(e.pagina || '') + ' · ' + fmtDate(e.created_at) + '</span></div>';
            }).join('') + '</div>' : emptyState('fa-heart-pulse', 'Sin errores registrados.')) + '</div>' +
            '<div class="sa-panel"><h3>Exportar CSV</h3><div class="sa-row-actions">' +
            '<button class="btn btn-primary" data-export="barbers">Barberos</button>' +
            '<button class="btn btn-primary" data-export="appointments">Citas</button>' +
            '<button class="btn btn-primary" data-export="clients">Clientes</button></div></div>';
        sec.querySelectorAll('[data-export]').forEach(function (b) {
            b.addEventListener('click', async function () { await exportCsv(b.dataset.export); });
        });
    };
    async function exportCsv(kind) {
        try {
            var rows = [], cols = [], name = kind + '-' + todayKey() + '.csv';
            if (kind === 'barbers') {
                rows = await tableSelect('barbers');
                cols = [{ label: 'id', key: 'id' }, { label: 'nombre', key: 'name' }, { label: 'correo', key: 'email' }, { label: 'telefono', key: 'phone' }, { label: 'activo', key: 'active' }];
            } else if (kind === 'appointments') {
                rows = await tableSelect('appointments', { limit: 500 });
                cols = [{ label: 'codigo', key: 'code' }, { label: 'cliente', key: 'client_name' }, { label: 'barbero', key: 'barber_id' }, { label: 'fecha_hora', key: 'date_time' }, { label: 'estado', key: 'status' }];
            } else {
                // Clientes reales de la barbería (tabla clients) con la RPC
                // de exportación de F (solo super admin).
                rows = await rpc('export_data', { p_table: 'clients' }) || [];
                cols = [{ label: 'id', key: 'id' }, { label: 'nombre', key: 'name' }, { label: 'correo', key: 'email' }, { label: 'telefono', key: 'phone' }];
            }
            downloadCsv(name, buildCsv(cols, rows));
            toast('CSV descargado: ' + rows.length + ' fila(s).', 'success');
        } catch (err) { toast('No se pudo exportar: ' + (err.message || 'error.'), 'error'); }
    }

    /* ------------------------------------------------------------------ */
    /* Arranque.                                                            */
    /* ------------------------------------------------------------------ */
    var inited = false;
    function init() {
        if (inited) return;
        inited = true;
        $('sa-login-form').addEventListener('submit', handleLoginSubmit);
        var pwToggle = $('sa-password-toggle');
        if (pwToggle) pwToggle.addEventListener('click', function () {
            var pwInput = $('sa-password');
            var show = pwInput.type === 'password';
            pwInput.type = show ? 'text' : 'password';
            pwToggle.innerHTML = '<i class="fas ' + (show ? 'fa-eye-slash' : 'fa-eye') + '"></i>';
            pwToggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
            pwInput.focus();
        });
        document.querySelectorAll('#sa-nav .nav-btn').forEach(function (b) {
            b.addEventListener('click', function () { showModule(b.dataset.module); });
        });
        $('sa-refresh-btn').addEventListener('click', function () { if (RENDERERS[state.currentModule]) RENDERERS[state.currentModule](); });
        $('sa-logout-btn').addEventListener('click', function () { logout(false); });
        $('sa-support-exit').addEventListener('click', exitSupportMode);
        $('sa-support-edit').addEventListener('change', async function (e) {
            if (e.target.checked) {
                var ok = await confirmModal({
                    title: 'Activar edición en modo soporte',
                    body: 'Vas a poder cambiar datos viendo como ' + (state.support ? state.support.name : '') + '. Todo queda auditado con tu correo de super admin.',
                    requireReason: true, confirmLabel: 'Activar edición'
                });
                if (!ok) { e.target.checked = false; return; }
                state.supportCanEdit = true;
                document.body.classList.remove('sa-support-readonly');
                await audit('modo_soporte_edicion_on', 'Edición activada en modo soporte sobre ' + state.support.name + '. Motivo: ' + ok.reason);
                toast('Edición activada en modo soporte (auditada).', 'warning');
            } else {
                state.supportCanEdit = false;
                document.body.classList.add('sa-support-readonly');
                await audit('modo_soporte_edicion_off', 'Edición desactivada en modo soporte.');
            }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    /* API pública (para el harness y depuración). */
    window.SuperAdmin = {
        CONFIG: { SESSION_TIMEOUT_MS: SESSION_TIMEOUT_MS, MAX_ATTEMPTS: MAX_ATTEMPTS, AREAS: AREAS, TEMPLATES: TEMPLATES, MODULES: MODULES },
        init: init,
        state: state,
        isSessionExpired: isSessionExpired,
        remainingMs: remainingMs,
        validateCancel: validateCancel,
        buildCsv: buildCsv,
        csvCell: csvCell,
        canEdit: function () { return !state.support || state.supportCanEdit; },
        enterSupportMode: enterSupportMode,
        exitSupportMode: exitSupportMode,
        showModule: showModule,
        audit: audit,
        toast: toast,
        logout: logout,
        _setClient: function (c) { clientOverride = c; },
        _stopTimers: function () { state.timers.forEach(clearInterval); state.timers = []; }
    };
})();
