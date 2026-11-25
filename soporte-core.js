/* ============================================================================
   Centro de Soporte Técnico — GOAT Style Salon (núcleo).
   Es el Super Admin mejorado (reemplaza como entrada principal a
   super-admin.html del PR #18). Login SOLO con contraseña (patrón PR #21):
   check_login_allowed -> signInWithPassword -> profiles role='super_admin'
   y estado='activo' -> record_login_attempt -> sesión con cierre a los
   30 min sin actividad. Usa SOLO window.GabyCloud.getClient()
   (supabase-config.js + supabase-sync.js). Sin OTP. Sin llaves de servidor.
   Contrato: window.GOATSupport { register, api, sections, _test, boot }.
   Las secciones se registran desde soporte-secciones.js con register(def).
   ========================================================================== */
(function () {
    'use strict';

    var SESSION_TIMEOUT_MS = 30 * 60 * 1000;
    var MAX_ATTEMPTS = 3;
    var VERSION = '1.0.0';
    var QUEUE_DB = 'goat-support-queue';
    var QUEUE_STORE = 'pending';

    var state = {
        session: null, // {email, userId, nombre, lastActivity}
        timers: [],
        booted: false,
        currentSection: null,
        sectionQueries: {}, // id -> query pendiente de la búsqueda global
        badges: {}, // id -> badge|null
        queueToastShown: false
    };

    var $ = function (id) { return document.getElementById(id); };

    /* ------------------------- helpers puros ------------------------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function h(tag, attrs) {
        var el = document.createElement(tag);
        attrs = attrs || {};
        Object.keys(attrs).forEach(function (k) {
            var v = attrs[k];
            if (v == null || v === false) return;
            if (k === 'class' || k === 'className') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k === 'style' && typeof v === 'object') { Object.keys(v).forEach(function (sk) { el.style[sk] = v[sk]; }); }
            else if (k.indexOf('data-') === 0 || k.indexOf('aria-') === 0) el.setAttribute(k, v);
            else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (k in el) { try { el[k] = v; } catch (_) { el.setAttribute(k, v); } }
            else el.setAttribute(k, v);
        });
        for (var i = 2; i < arguments.length; i++) appendChild(el, arguments[i]);
        return el;
    }
    function appendChild(el, child) {
        if (child == null || child === false) return;
        if (Array.isArray(child)) { child.forEach(function (c) { appendChild(el, c); }); return; }
        if (typeof child === 'string' || typeof child === 'number') el.appendChild(document.createTextNode(String(child)));
        else if (child.nodeType) el.appendChild(child);
    }
    function pad2(n) { return String(n).padStart(2, '0'); }
    function fmtFecha(ts) {
        if (!ts) return '—';
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '—';
        try {
            return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
        } catch (_) { return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
    }
    function fmtHora(ts) {
        if (!ts) return '—';
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '—';
        var hrs = d.getHours(), mins = d.getMinutes();
        var suffix = hrs >= 12 ? 'p. m.' : 'a. m.';
        var h12 = hrs % 12; if (h12 === 0) h12 = 12;
        return h12 + ':' + pad2(mins) + ' ' + suffix;
    }
    function fmtFechaHora(ts) {
        if (!ts) return '—';
        return fmtFecha(ts) + ' · ' + fmtHora(ts);
    }
    function fmtReloj(d) {
        var hrs = d.getHours(), suffix = hrs >= 12 ? 'p. m.' : 'a. m.';
        var h12 = hrs % 12; if (h12 === 0) h12 = 12;
        return h12 + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ' ' + suffix;
    }
    function uuid() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (_) {} }
        return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    function refreshIcons() {
        try { if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); } catch (_) {}
    }

    /* ------------------------- cliente Supabase ------------------------- */
    async function client() {
        if (typeof window !== 'undefined' && window.GabyCloud && typeof window.GabyCloud.getClient === 'function') {
            try { return await window.GabyCloud.getClient(); } catch (_) { return null; }
        }
        return null;
    }
    async function rpc(name, params) {
        var c = await client();
        if (!c || typeof c.rpc !== 'function') throw new Error('Sin conexión con el servidor.');
        var res = await c.rpc(name, params || {});
        if (res && res.error) throw new Error(res.error.message || ('Error en ' + name));
        return res ? res.data : null;
    }
    function applyFilters(q, opts) {
        opts = opts || {};
        (opts.eq || []).forEach(function (p) { q = q.eq(p[0], p[1]); });
        (opts.gte || []).forEach(function (p) { q = q.gte(p[0], p[1]); });
        (opts.lte || []).forEach(function (p) { q = q.lte(p[0], p[1]); });
        (opts.ilike || []).forEach(function (p) { q = q.ilike(p[0], p[1]); });
        if (opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false });
        if (opts.limit) q = q.limit(opts.limit);
        return q;
    }
    async function select(table, opts) {
        var c = await client();
        if (!c) throw new Error('Sin conexión con el servidor.');
        var q = applyFilters(c.from(table).select((opts && opts.columns) || '*'), opts);
        var res = await q;
        if (res && res.error) throw new Error(res.error.message || ('Error leyendo ' + table));
        return (res && res.data) || [];
    }
    async function insert(table, row) {
        var c = await client();
        if (!c) throw new Error('Sin conexión con el servidor.');
        var res = await c.from(table).insert(row).select();
        if (res && res.error) throw new Error(res.error.message || ('Error guardando en ' + table));
        return res ? res.data : null;
    }
    async function update(table, patch, eq) {
        var c = await client();
        if (!c) throw new Error('Sin conexión con el servidor.');
        var q = c.from(table).update(patch);
        (eq || []).forEach(function (p) { q = q.eq(p[0], p[1]); });
        var res = await q;
        if (res && res.error) throw new Error(res.error.message || ('Error actualizando ' + table));
        return res ? res.data : null;
    }
    async function remove(table, eq) {
        var c = await client();
        if (!c) throw new Error('Sin conexión con el servidor.');
        var q = c.from(table).delete();
        (eq || []).forEach(function (p) { q = q.eq(p[0], p[1]); });
        var res = await q;
        if (res && res.error) throw new Error(res.error.message || ('Error borrando en ' + table));
        return res ? res.data : null;
    }

    /* ------------------------- UI: toast / confirm / error ------------------------- */
    function toast(msg, type) {
        var box = $('cs-toasts');
        if (!box) return;
        var el = h('div', { 'class': 'cs-toast ' + (type || 'info'), role: 'status' }, String(msg == null ? '' : msg));
        box.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4000);
    }
    function confirmModal(opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var root = $('cs-modal-root');
            if (!root) { resolve(false); return; }
            var okBtn = h('button', { 'class': 'cs-btn ' + (opts.danger ? 'cs-btn-danger' : 'cs-btn-primary'), type: 'button' }, opts.confirmText || 'Confirmar');
            var cancelBtn = h('button', { 'class': 'cs-btn cs-btn-ghost', type: 'button' }, 'Cancelar');
            var modal = h('div', { 'class': 'cs-modal', role: 'dialog', 'aria-modal': 'true' },
                h('h3', {}, opts.title || 'Confirmar'),
                h('p', { 'class': 'cs-muted' }, opts.body || ''),
                h('div', { 'class': 'cs-modal-actions' }, cancelBtn, okBtn));
            var backdrop = h('div', { 'class': 'cs-modal-backdrop' }, modal);
            root.innerHTML = '';
            root.appendChild(backdrop);
            var done = function (v) {
                document.removeEventListener('keydown', onKey, true);
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                resolve(v);
            };
            var onKey = function (e) { if (e.key === 'Escape') done(false); };
            document.addEventListener('keydown', onKey, true);
            cancelBtn.addEventListener('click', function () { done(false); });
            okBtn.addEventListener('click', function () { done(true); });
            backdrop.addEventListener('click', function (e) { if (e.target === backdrop) done(false); });
            try { okBtn.focus(); } catch (_) {}
        });
    }
    function errorHtml(err, msgSencillo) {
        var tech = err ? (err.stack || err.message || String(err)) : 'Sin detalles.';
        return h('div', { 'class': 'cs-error-box' },
            h('p', {}, msgSencillo || 'Algo salió mal. Inténtalo de nuevo.'),
            h('details', {},
                h('summary', {}, 'Ver detalles'),
                h('pre', {}, String(tech))));
    }

    /* ------------------------- auditoría ------------------------- */
    async function audit(action, details) {
        try {
            await rpc('log_audit', {
                p_action: action, p_target_type: 'centro_soporte', p_target_id: '',
                p_before: null, p_after: { details: String(details || '') }
            });
        } catch (_) { /* best-effort: nunca bloquea la acción */ }
    }

    /* ------------------------- cola offline (queue) ------------------------- */
    function memoryBackend() {
        var map = new Map();
        return {
            kind: 'memory',
            getAll: async function () { return Array.from(map.values()); },
            put: async function (item) { map.set(item.id, item); },
            delete: async function (id) { map.delete(id); }
        };
    }
    function idbBackend() {
        function open() {
            return new Promise(function (resolve, reject) {
                if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB no disponible')); return; }
                var req = indexedDB.open(QUEUE_DB, 1);
                req.onupgradeneeded = function () {
                    var db = req.result;
                    if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error || new Error('IndexedDB falló')); };
            });
        }
        function tx(mode, fn) {
            return open().then(function (db) {
                return new Promise(function (resolve, reject) {
                    var t = db.transaction(QUEUE_STORE, mode);
                    var store = t.objectStore(QUEUE_STORE);
                    var out;
                    t.oncomplete = function () { try { db.close(); } catch (_) {} resolve(out); };
                    t.onerror = function () { reject(t.error || new Error('IndexedDB falló')); };
                    out = fn(store);
                    if (out && typeof out.then === 'function') out.then(function (v) { out = v; }, reject);
                });
            });
        }
        return {
            kind: 'indexeddb',
            getAll: function () {
                return tx('readonly', function (store) {
                    return new Promise(function (resolve, reject) {
                        var req = store.getAll();
                        req.onsuccess = function () { resolve(req.result || []); };
                        req.onerror = function () { reject(req.error); };
                    });
                });
            },
            put: function (item) { return tx('readwrite', function (store) { store.put(item); }); },
            delete: function (id) { return tx('readwrite', function (store) { store.delete(id); }); }
        };
    }

    var queueListeners = [];
    var queueBackend = null;
    var queueBackendPromise = null;
    function getQueueBackend() {
        if (queueBackend) return Promise.resolve(queueBackend);
        if (queueBackendPromise) return queueBackendPromise;
        var idb = idbBackend();
        queueBackendPromise = idb.getAll().then(function () {
            queueBackend = idb;
            return queueBackend;
        }).catch(function () {
            queueBackend = memoryBackend();
            if (!state.queueToastShown) {
                state.queueToastShown = true;
                toast('La cola sin conexión usará memoria: si cierras la página, lo pendiente se pierde.', 'warning');
            }
            return queueBackend;
        });
        return queueBackendPromise;
    }
    function queueNotify() {
        queue.count().then(function (n) {
            queueListeners.slice().forEach(function (cb) { try { cb(n); } catch (_) {} });
        }).catch(function () {});
    }
    async function logSyncResult(item, ok, errorMsg) {
        try {
            var c = await client();
            if (!c) return;
            var res = await c.from('sync_queue_log').insert({
                queue_id: String(item.id), tipo: item.tipo || '', tabla: item.tabla || '',
                resultado: ok ? 'subido' : 'fallido',
                motivo: ok ? '' : String(errorMsg || '')
            });
            if (res && res.error) { /* best-effort */ }
        } catch (_) { /* best-effort */ }
    }
    async function runQueueItem(c, item) {
        var res;
        if (item.operacion === 'insert') {
            var payload = item.payload || {};
            if (payload && payload.id) res = await c.from(item.tabla).upsert(payload);
            else res = await c.from(item.tabla).insert(payload);
        } else if (item.operacion === 'update') {
            var p = item.payload || {};
            var q = c.from(item.tabla).update(p.patch || {});
            (p.eq || []).forEach(function (pair) { q = q.eq(pair[0], pair[1]); });
            res = await q;
        } else if (item.operacion === 'delete') {
            var q2 = c.from(item.tabla).delete();
            ((item.payload && item.payload.eq) || []).forEach(function (pair) { q2 = q2.eq(pair[0], pair[1]); });
            res = await q2;
        } else {
            throw new Error('Operación no reconocida: ' + item.operacion);
        }
        if (res && res.error) throw new Error(res.error.message || 'Error del servidor');
        return res ? res.data : null;
    }
    var queue = {
        add: async function (item) {
            var backend = await getQueueBackend();
            var full = {
                id: (item && item.id) || uuid(),
                tipo: (item && item.tipo) || '',
                tabla: (item && item.tabla) || '',
                operacion: (item && item.operacion) || 'insert',
                payload: (item && item.payload) || null,
                error: (item && item.error) || '',
                created_at: (item && item.created_at) || new Date().toISOString(),
                intentos: (item && typeof item.intentos === 'number') ? item.intentos : 0
            };
            await backend.put(full);
            queueNotify();
            return full.id;
        },
        list: async function () {
            var backend = await getQueueBackend();
            var items = await backend.getAll();
            return (items || []).slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
        },
        remove: async function (id) {
            var backend = await getQueueBackend();
            await backend.delete(id);
            queueNotify();
        },
        count: async function () {
            var backend = await getQueueBackend();
            var items = await backend.getAll();
            return (items || []).length;
        },
        flush: async function (onProgress) {
            var backend = await getQueueBackend();
            var items = await queue.list();
            var c = await client();
            var subidos = 0, fallidos = 0;
            if (!c) {
                return { subidos: 0, fallidos: items.length };
            }
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                try {
                    await runQueueItem(c, item);
                    await backend.delete(item.id);
                    subidos++;
                    await logSyncResult(item, true, null);
                } catch (err) {
                    item.intentos = (item.intentos || 0) + 1;
                    item.error = err && err.message ? err.message : String(err || 'Error');
                    try { await backend.put(item); } catch (_) {}
                    fallidos++;
                    await logSyncResult(item, false, item.error);
                }
                if (typeof onProgress === 'function') {
                    try { onProgress({ subidos: subidos, fallidos: fallidos, total: items.length, item: item }); } catch (_) {}
                }
            }
            queueNotify();
            return { subidos: subidos, fallidos: fallidos };
        },
        onChange: function (cb) { if (typeof cb === 'function') queueListeners.push(cb); },
        _setBackend: function (b) {
            queueBackend = b;
            queueBackendPromise = Promise.resolve(b);
            queueNotify();
        }
    };

    /* ------------------------- estado general (badges) ------------------------- */
    /* Las secciones pueden devolver {status, count} o {level, count}:
       se normaliza a {status, count} para la tarjeta y la barra. */
    function normalizeBadge(b) {
        if (!b) return null;
        var status = b.status || (b.level === 'error' ? 'error' : (b.level === 'warn' ? 'warn' : null));
        return { status: status, count: typeof b.count === 'number' ? b.count : 0 };
    }
    function computeStatus(badgesMap) {
        var names = { error: [], warn: [] };
        var hasError = false, hasWarn = false;
        Object.keys(badgesMap || {}).forEach(function (id) {
            var b = badgesMap[id];
            if (!b) return;
            var title = (GOATSupport.sections[id] && GOATSupport.sections[id].title) || id;
            if (b.status === 'error') { hasError = true; names.error.push(title); }
            else if (b.status === 'warn') { hasWarn = true; names.warn.push(title); }
        });
        if (hasError) return { level: 'error', text: 'Hay problemas: ' + names.error.join(', '), errorNames: names.error, warnNames: names.warn };
        if (hasWarn) return { level: 'warn', text: 'Con avisos: ' + names.warn.join(', '), errorNames: [], warnNames: names.warn };
        return { level: 'ok', text: 'Todo funcionando', errorNames: [], warnNames: [] };
    }
    function refreshStatusBar() {
        var bar = $('cs-statusbar');
        if (!bar) return;
        var st = computeStatus(state.badges);
        bar.className = 'cs-statusbar ' + st.level;
        bar.textContent = st.text;
    }
    async function refreshBadges() { await renderGrid(); }

    /* ------------------------- grid / secciones ------------------------- */
    async function renderGrid() {
        var grid = $('cs-grid');
        if (!grid) return;
        var ids = Object.keys(GOATSupport.sections);
        grid.innerHTML = '';
        var badges = {};
        for (var i = 0; i < ids.length; i++) {
            var def = GOATSupport.sections[ids[i]];
            var badge = null;
            if (typeof def.badge === 'function') {
                try { badge = normalizeBadge(await def.badge(api)); } catch (_) { badge = null; }
            }
            badges[def.id] = badge;
            grid.appendChild(buildCard(def, badge));
        }
        state.badges = badges;
        refreshStatusBar();
        refreshIcons();
    }
    function buildCard(def, badge) {
        var status = badge && badge.status ? badge.status : null;
        var count = badge && typeof badge.count === 'number' ? badge.count : 0;
        var iconWrap = h('span', { 'class': 'cs-card-icon' },
            h('i', { 'data-lucide': def.icon || 'circle', style: { color: def.color || '#d4af37' } }));
        var children = [iconWrap,
            h('span', { 'class': 'cs-card-name' }, def.title || def.id),
            h('span', { 'class': 'cs-dot ' + (status || ''), 'aria-label': status ? ('Estado: ' + status) : 'Sin avisos' })];
        if (count > 0) children.push(h('span', { 'class': 'cs-pill' }, String(count)));
        var card = h('button', { 'class': 'cs-card', type: 'button', 'data-section': def.id }, children);
        card.addEventListener('click', function () { openSection(def.id); });
        return card;
    }
    function openSection(id) {
        var def = GOATSupport.sections[id];
        if (!def) { toast('Esa sección no está disponible.', 'error'); return; }
        state.currentSection = id;
        var home = $('cs-home-view'); if (home) home.hidden = true;
        var win = $('cs-section'); if (win) win.hidden = false;
        var title = $('cs-section-title'); if (title) title.textContent = def.title || id;
        var body = $('cs-section-body');
        if (body) {
            body.innerHTML = '';
            body.appendChild(h('div', { 'class': 'cs-loading' }, 'Cargando…'));
            try {
                var result = def.render(body, api);
                if (result && typeof result.catch === 'function') {
                    result.catch(function (err) {
                        body.innerHTML = '';
                        body.appendChild(errorHtml(err, 'No se pudo abrir esta sección.'));
                        toast('No se pudo abrir la sección.', 'error');
                    });
                }
            } catch (err) {
                body.innerHTML = '';
                body.appendChild(errorHtml(err, 'No se pudo abrir esta sección.'));
                toast('No se pudo abrir la sección.', 'error');
            }
        }
        refreshIcons();
    }
    function goHome() {
        state.currentSection = null;
        var win = $('cs-section'); if (win) win.hidden = true;
        var home = $('cs-home-view'); if (home) home.hidden = false;
        refreshBadges();
    }
    function setSectionQuery(id, q) { state.sectionQueries[id] = String(q == null ? '' : q); }
    function takeSectionQuery(id) {
        var q = state.sectionQueries[id] || '';
        delete state.sectionQueries[id];
        return q;
    }

    /* ------------------------- búsqueda global ------------------------- */
    var searchTimer = null;
    async function globalSearch(q) {
        var panel = $('cs-search-panel');
        if (!panel) return;
        q = String(q || '').trim();
        if (!q) { panel.hidden = true; panel.innerHTML = ''; return; }
        panel.hidden = false;
        panel.innerHTML = '';
        panel.appendChild(h('div', { 'class': 'cs-search-empty' }, 'Buscando…'));
        var like = '%' + q + '%';
        try {
            var memosA = await select('support_memos', { ilike: [['titulo', like]], limit: 5 }).catch(function () { return []; });
            var memosB = await select('support_memos', { ilike: [['mensaje', like]], limit: 5 }).catch(function () { return []; });
            var seen = {};
            var memos = [];
            memosA.concat(memosB).forEach(function (m) { var k = m.id || m.titulo; if (!seen[k]) { seen[k] = 1; memos.push(m); } });
            memos = memos.slice(0, 5);
            var usersA = await select('profiles', { ilike: [['nombre', like]], limit: 5 }).catch(function () { return []; });
            var usersB = await select('profiles', { ilike: [['email', like]], limit: 5 }).catch(function () { return []; });
            var seenU = {};
            var users = [];
            usersA.concat(usersB).forEach(function (u) { var k = u.id || u.email; if (!seenU[k]) { seenU[k] = 1; users.push(u); } });
            users = users.slice(0, 5);
            var apptsA = await select('appointments', { ilike: [['code', like]], limit: 5 }).catch(function () { return []; });
            var apptsB = await select('appointments', { ilike: [['client_name', like]], limit: 5 }).catch(function () { return []; });
            var seenA = {};
            var appts = [];
            apptsA.concat(apptsB).forEach(function (a) { var k = a.id || a.code; if (!seenA[k]) { seenA[k] = 1; appts.push(a); } });
            appts = appts.slice(0, 5);

            panel.innerHTML = '';
            if (!memos.length && !users.length && !appts.length) {
                panel.appendChild(h('div', { 'class': 'cs-search-empty' }, 'Sin resultados para esa búsqueda.'));
                return;
            }
            function group(label, rows, tag, textOf, onPick) {
                if (!rows.length) return;
                panel.appendChild(h('div', { 'class': 'cs-search-group' }, label));
                rows.forEach(function (r) {
                    var btn = h('button', { 'class': 'cs-search-item', type: 'button' },
                        h('span', { 'class': 'cs-search-tag' }, tag),
                        h('span', {}, textOf(r)));
                    btn.addEventListener('click', function () {
                        panel.hidden = true;
                        onPick(r);
                    });
                    panel.appendChild(btn);
                });
            }
            group('Memos', memos, 'Memo', function (m) { return m.titulo || m.mensaje || 'Memo'; }, function () {
                setSectionQuery('buscar-memos', q);
                openSection('buscar-memos');
            });
            group('Usuarios', users, 'Usuario', function (u) { return (u.nombre || '') + (u.email ? ' · ' + u.email : ''); }, function () {
                setSectionQuery('usuarios', q);
                openSection('usuarios');
            });
            group('Citas', appts, 'Cita', function (a) { return (a.code || 'Cita') + (a.client_name ? ' · ' + a.client_name : ''); }, function (a) {
                setSectionQuery('usuarios', a.client_name || q);
                openSection('usuarios');
            });
        } catch (err) {
            panel.innerHTML = '';
            toast('No se pudo completar la búsqueda.', 'error');
            panel.appendChild(h('div', { 'class': 'cs-search-empty' }, 'No se pudo buscar. Revisa tu conexión.'));
        }
    }

    /* ------------------------- conexión y reloj ------------------------- */
    function updateConn() {
        var on = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
        var dot = $('cs-conn-dot'), txt = $('cs-conn-text');
        if (dot) dot.className = 'cs-conn-dot' + (on ? '' : ' off');
        if (txt) txt.textContent = on ? 'En línea' : 'Sin conexión';
        return on;
    }
    function tickClock() {
        var el = $('cs-clock');
        if (el) el.textContent = fmtReloj(new Date());
    }

    /* ------------------------- sesión / login ------------------------- */
    function showLoginError(msg) {
        var e = $('cs-login-error');
        if (e) { e.textContent = msg; e.hidden = false; }
    }
    function sessionInfo() {
        if (!state.session) return null;
        return { email: state.session.email, userId: state.session.userId, nombre: state.session.nombre || '' };
    }
    function noteActivity() { if (state.session) state.session.lastActivity = Date.now(); }
    function isSessionExpired(lastActivity, now) {
        return ((now == null ? Date.now() : now) - lastActivity) >= SESSION_TIMEOUT_MS;
    }
    function checkIdle() {
        if (state.session && isSessionExpired(state.session.lastActivity)) {
            toast('Sesión cerrada por 30 minutos sin actividad.', 'warning');
            logout(true);
        }
    }
    function startSession(email, userId, nombre) {
        if (email && typeof email === 'object') {
            nombre = email.nombre || email.name || '';
            userId = email.userId || email.id || '';
            email = email.email || '';
        }
        state.session = { email: email || '', userId: userId || '', nombre: nombre || '', lastActivity: Date.now() };
        var login = $('cs-login'); if (login) login.hidden = true;
        var app = $('cs-app'); if (app) app.hidden = false;
        var nameEl = $('cs-user-name'); if (nameEl) nameEl.textContent = state.session.nombre || 'Super Admin';
        var emailEl = $('cs-user-email'); if (emailEl) emailEl.textContent = state.session.email;
        ['click', 'keydown', 'touchstart', 'mousemove'].forEach(function (evt) {
            document.addEventListener(evt, noteActivity, { passive: true });
        });
        state.timers.push(setInterval(checkIdle, 15000));
        updateConn();
        renderGrid();
        // Subida silenciosa de lo que haya quedado en la cola.
        queue.flush().catch(function () {});
    }
    async function logout(auto) {
        state.timers.forEach(clearInterval);
        state.timers = [];
        var wasSession = state.session;
        state.session = null;
        state.currentSection = null;
        try { var c = await client(); if (c && c.auth) await c.auth.signOut(); } catch (_) {}
        if (!auto && wasSession) { try { await audit('logout', 'Cierre de sesión manual del Centro de Soporte.'); } catch (_) {} }
        var app = $('cs-app'); if (app) app.hidden = true;
        var login = $('cs-login'); if (login) login.hidden = false;
        var pw = $('cs-password'); if (pw) pw.value = '';
        var win = $('cs-section'); if (win) win.hidden = true;
        var home = $('cs-home-view'); if (home) home.hidden = false;
    }
    async function handleLoginSubmit(ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        var emailEl = $('cs-email'), pwEl = $('cs-password'), btn = $('cs-login-btn');
        var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
        var password = pwEl ? pwEl.value : '';
        if (btn) btn.disabled = true;
        try {
            var c = await client();
            if (!c) { showLoginError('Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); return; }
            // 1) ¿La cuenta puede intentar entrar? (bloqueo en servidor)
            var allowed = await rpc('check_login_allowed', { p_email: email });
            var isAllowed = allowed === true || (allowed && allowed.allowed !== false);
            if (!isAllowed) {
                showLoginError('Esta cuenta está bloqueada por intentos fallidos. Pide a otro super administrador que la desbloquee o espera a que se desbloquee.');
                return;
            }
            // 2) Contraseña (Supabase Auth). Sin código OTP (PR #21).
            var sign = await c.auth.signInWithPassword({ email: email, password: password });
            if (sign.error) {
                var rec = null;
                try { rec = await rpc('record_login_attempt', { p_email: email, p_exito: false, p_dispositivo: navigator.userAgent }); } catch (_) {}
                var left = rec && typeof rec.attempts_left === 'number' ? rec.attempts_left : null;
                if (rec && rec.locked) showLoginError('3 intentos fallidos: la cuenta quedó bloqueada.');
                else showLoginError('Correo o contraseña incorrectos.' + (left !== null ? ' Intento ' + (MAX_ATTEMPTS - left) + ' de ' + MAX_ATTEMPTS + '.' : ''));
                return;
            }
            var userId = sign.data && sign.data.user ? sign.data.user.id : '';
            // 3) Solo super_admin activo entra (verificado en profiles).
            var prof = await c.from('profiles').select('role, estado, nombre, email').eq('id', userId).maybeSingle();
            var pdata = prof && prof.data;
            if (!prof || prof.error || !pdata || pdata.role !== 'super_admin' || (pdata.estado && pdata.estado !== 'activo')) {
                try { await c.auth.signOut(); } catch (_) {}
                showLoginError('Esta cuenta no es de super administrador activo.');
                return;
            }
            try { await rpc('record_login_attempt', { p_email: email, p_exito: true, p_dispositivo: navigator.userAgent }); } catch (_) {}
            startSession(email, userId, pdata.nombre || '');
            audit('login', 'Inicio de sesión en el Centro de Soporte (solo contraseña).');
            toast('Bienvenido al Centro de Soporte Técnico.', 'success');
        } catch (err) {
            showLoginError(err && err.message ? err.message : 'No se pudo iniciar sesión.');
        } finally { if (btn) btn.disabled = false; }
    }

    /* ------------------------- api pública ------------------------- */
    var api = {
        client: client,
        rpc: rpc,
        select: select,
        insert: insert,
        update: update,
        remove: remove,
        toast: toast,
        confirm: confirmModal,
        audit: audit,
        session: sessionInfo,
        queue: queue,
        h: h,
        esc: esc,
        fmtFecha: fmtFecha,
        fmtHora: fmtHora,
        fmtFechaHora: fmtFechaHora,
        openSection: openSection,
        goHome: goHome,
        setSectionQuery: setSectionQuery,
        takeSectionQuery: takeSectionQuery,
        refreshBadges: refreshBadges,
        refreshStatusBar: refreshStatusBar,
        errorHtml: errorHtml,
        version: VERSION
    };

    var GOATSupport = {
        register: function (def) {
            if (!def || !def.id) return;
            GOATSupport.sections[def.id] = def;
            if (state.session) renderGrid();
        },
        api: api,
        sections: {},
        boot: boot,
        _test: {
            startSession: startSession,
            handleLoginSubmit: handleLoginSubmit,
            computeStatus: computeStatus,
            logout: logout,
            isSessionExpired: isSessionExpired
        },
        version: VERSION
    };

    /* ------------------------- arranque ------------------------- */
    function boot() {
        if (state.booted) return;
        state.booted = true;
        var form = $('cs-login-form');
        if (form) form.addEventListener('submit', handleLoginSubmit);
        var toggle = $('cs-password-toggle');
        if (toggle) toggle.addEventListener('click', function () {
            var pw = $('cs-password');
            if (!pw) return;
            var show = pw.type === 'password';
            pw.type = show ? 'text' : 'password';
            toggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
            toggle.innerHTML = '';
            toggle.appendChild(h('i', { 'data-lucide': show ? 'eye-off' : 'eye' }));
            refreshIcons();
            pw.focus();
        });
        var logoutBtn = $('cs-logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', function () { logout(false); });
        var backBtn = $('cs-section-back');
        if (backBtn) backBtn.addEventListener('click', goHome);
        var searchInput = $('cs-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                clearTimeout(searchTimer);
                var q = searchInput.value;
                searchTimer = setTimeout(function () { globalSearch(q); }, 300);
            });
            searchInput.addEventListener('focus', function () {
                if (searchInput.value.trim()) globalSearch(searchInput.value);
            });
        }
        var searchBtn = $('cs-search-btn');
        if (searchBtn && searchInput) searchBtn.addEventListener('click', function () { globalSearch(searchInput.value); });
        document.addEventListener('click', function (e) {
            var panel = $('cs-search-panel');
            if (!panel || panel.hidden) return;
            var wrap = panel.parentNode;
            if (wrap && !wrap.contains(e.target)) panel.hidden = true;
        });
        if (typeof window !== 'undefined') {
            window.addEventListener('online', function () {
                updateConn();
                queue.flush().catch(function () {});
                toast('Volvió la conexión. Sincronizando lo pendiente…', 'info');
            });
            window.addEventListener('offline', function () { updateConn(); });
        }
        updateConn();
        tickClock();
        setInterval(tickClock, 1000);
        refreshIcons();
        if (state.session) renderGrid();
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }

    if (typeof window !== 'undefined') window.GOATSupport = GOATSupport;
})();
