/* soporte-secciones.js — Centro de Soporte Técnico · GOAT Style Salon
   Las 13 secciones del panel Super Admin. Se carga DESPUÉS de soporte-core.js
   y se registra en window.GOATSupport. Sin core (p. ej. jsdom) solo expone
   window.GOATSupportSections._test con los helpers puros. */
(function () {
  'use strict';

  /* ================= Helpers puros (testeables) ================= */
  function normalizarTexto(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  var NIVELES_VEL = ['Muy lenta', 'Lenta', 'Buena', 'Excelente'];
  function veredictoVelocidad(mbps, latenciaMs) {
    var i = mbps >= 25 ? 3 : mbps >= 10 ? 2 : mbps >= 3 ? 1 : 0;
    if (latenciaMs != null && latenciaMs > 300 && i > 0) i--;
    return NIVELES_VEL[i];
  }
  var PESO_PRIORIDAD = { urgente: 3, importante: 2, normal: 1 };
  function filtrarMemos(memos, f) {
    f = f || {};
    return (memos || []).filter(function (m) {
      if (f.texto) {
        var hay = normalizarTexto((m.titulo || '') + ' ' + (m.mensaje || ''));
        if (hay.indexOf(normalizarTexto(f.texto)) === -1) return false;
      }
      var d = m.created_at ? new Date(m.created_at) : null;
      if (f.fechaExacta && d) {
        var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        if (iso !== f.fechaExacta) return false;
      }
      if (f.desde && d && d < new Date(f.desde + 'T00:00:00')) return false;
      if (f.hasta && d && d > new Date(f.hasta + 'T23:59:59')) return false;
      if (f.diaSemana != null && f.diaSemana !== '' && d && d.getDay() !== Number(f.diaSemana)) return false;
      if (f.mes != null && f.mes !== '' && d && (d.getMonth() + 1) !== Number(f.mes)) return false;
      if (f.anio != null && f.anio !== '' && d && d.getFullYear() !== Number(f.anio)) return false;
      if (f.destinatario_tipo && m.destinatario_tipo !== f.destinatario_tipo) return false;
      if (f.prioridad && m.prioridad !== f.prioridad) return false;
      if (f.estado && m.estado !== f.estado) return false;
      if (f.etiqueta) {
        var et = (m.etiquetas || []).map(normalizarTexto);
        if (et.indexOf(normalizarTexto(f.etiqueta)) === -1) return false;
      }
      return true;
    });
  }
  function ordenarMemos(memos, modo) {
    var arr = (memos || []).slice();
    if (modo === 'antiguo') arr.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    else if (modo === 'prioridad') arr.sort(function (a, b) {
      var p = (PESO_PRIORIDAD[b.prioridad] || 0) - (PESO_PRIORIDAD[a.prioridad] || 0);
      return p !== 0 ? p : new Date(b.created_at) - new Date(a.created_at);
    });
    else arr.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    return arr;
  }
  /* Resaltado seguro: busca el término normalizado y envuelve en <mark> el
     tramo equivalente del texto original (mapa índice normalizado→original). */
  function resaltar(texto, termino) {
    var original = String(texto == null ? '' : texto);
    var q = normalizarTexto(termino || '');
    if (!q) return null; // el llamador usa esc() normal
    var norm = '', mapa = [];
    for (var i = 0; i < original.length; i++) {
      var n = normalizarTexto(original[i]);
      for (var j = 0; j < n.length; j++) { norm += n[j]; mapa.push(i); }
    }
    if (norm.indexOf(q) === -1) return null;
    var out = '', pos = 0, idx, cursorOrig = 0;
    while ((idx = norm.indexOf(q, pos)) !== -1) {
      var s = mapa[idx], e = mapa[idx + q.length - 1] + 1;
      out += escLocal(original.slice(cursorOrig, s)) + '<mark>' + escLocal(original.slice(s, e)) + '</mark>';
      cursorOrig = e; pos = idx + q.length;
    }
    out += escLocal(original.slice(cursorOrig));
    return out;
  }
  function escLocal(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(prefijo) { return (prefijo || 'id') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

  window.GOATSupportSections = { _test: {
    veredictoVelocidad: veredictoVelocidad, normalizarTexto: normalizarTexto,
    filtrarMemos: filtrarMemos, ordenarMemos: ordenarMemos, resaltar: resaltar
  } };

  if (!window.GOATSupport || typeof window.GOATSupport.register !== 'function') return;
  var REG = window.GOATSupport;

  /* ================= Utilidades de UI compartidas ================= */
  function cargando(el) { el.innerHTML = '<div class="cs-loading" style="padding:24px;text-align:center">Cargando…</div>'; }
  function errBox(api, err, msg) {
    if (api && typeof api.errorHtml === 'function') return api.errorHtml(err, msg);
    return '<div class="cs-error" style="color:#c62828;padding:10px">' + escLocal(msg || 'Algo salió mal.') +
      '<details><summary>Ver detalles</summary><pre style="white-space:pre-wrap">' + escLocal(err && err.message ? err.message : String(err || '')) + '</pre></details></div>';
  }
  function detalles(err) {
    return '<details><summary>Ver detalles</summary><pre style="white-space:pre-wrap;font-size:12px">' + escLocal(err && err.message ? err.message : String(err || '')) + '</pre></details>';
  }
  async function conCarga(btn, fn) {
    if (!btn) return fn();
    var txt = btn.textContent; btn.disabled = true; btn.textContent = 'Trabajando…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = txt; }
  }
  function sesionId(api) { try { var s = api.session(); return s && (s.userId || s.user_id || (s.user && s.user.id)) || null; } catch (e) { return null; } }
  async function pingSupabase(api) {
    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var cfg = (typeof window !== 'undefined' && window.GABY_SUPABASE) || null;
    if (cfg && cfg.url && typeof fetch === 'function') {
      await fetch(cfg.url + '/rest/v1/', { headers: { apikey: cfg.anonKey || cfg.key || '' } });
    } else {
      await api.select('profiles', { columns: 'id', limit: 1 });
    }
    return Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  }
  function descargar(nombre, contenido, tipo) {
    var blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function copiarTexto(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    return new Promise(function (res) {
      var ta = document.createElement('textarea'); ta.value = texto; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); res();
    });
  }

  /* ================================================================
     1. SEGURIDAD
     ================================================================ */
  function registrarSeguridad() {
    REG.register({
      id: 'seguridad', title: 'Seguridad', icon: 'shield', color: '#e05252',
      badge: async function (api) {
        try { var r = await api.select('account_locks', { columns: 'id', eq: [['status', 'BLOQUEADA']], limit: 200 }); return { count: r.length, level: r.length > 0 ? 'error' : null }; }
        catch (e) { return { count: 0, level: null }; }
      },
      render: async function (el, api) {
        cargando(el);
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        try {
          var locks = await api.select('account_locks', { eq: [['status', 'BLOQUEADA']], order: 'locked_at', ascending: false, limit: 100 });
          var attempts = await api.select('login_attempts', { order: 'last_at', ascending: false, limit: 100 });
          var sesiones = await api.select('profiles', { columns: 'id,nombre,email,ultimo_login_at', order: 'ultimo_login_at', ascending: false, limit: 50 });
          var auditoria = await api.select('audit_log', { order: 'created_at', ascending: false, limit: 100 });
          el.innerHTML =
            '<h3>🔒 Cuentas bloqueadas</h3>' +
            (locks.length ? locks.map(function (l) {
              return '<div class="cs-row" style="display:flex;justify-content:space-between;gap:8px;padding:8px;border-bottom:1px solid #26262b"><div><strong>' + E(l.email) + '</strong><br><small>Bloqueada: ' + api.fmtFechaHora(l.locked_at) + ' · Intentos: ' + (l.attempts || 0) + (l.user_agent ? '<br>' + E(l.user_agent) : '') + '</small></div>' +
                '<button class="cs-btn" data-unlock="' + E(l.email) + '">Desbloquear</button></div>';
            }).join('') : '<p>No hay cuentas bloqueadas. 🎉</p>') +
            '<h3>⚠️ Intentos fallidos de inicio de sesión</h3>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><input type="search" id="cs-att-q" placeholder="Buscar por correo…"><input type="date" id="cs-att-fecha"><button class="cs-btn" id="cs-att-filtrar">Filtrar</button></div>' +
            '<div id="cs-att-list">' + tablaIntentos(attempts) + '</div>' +
            '<h3>🖥️ Sesiones recientes</h3>' +
            sesiones.filter(function (p) { return p.ultimo_login_at; }).map(function (p) {
              return '<div class="cs-row" style="display:flex;justify-content:space-between;gap:8px;padding:8px;border-bottom:1px solid #26262b"><div><strong>' + E(p.nombre || '') + '</strong> · ' + E(p.email) + '<br><small>Último acceso: ' + api.fmtFechaHora(p.ultimo_login_at) + '</small></div>' +
                '<button class="cs-btn" data-close-session="' + E(p.id) + '">Cerrar sesión</button></div>';
            }).join('') +
            '<h3>🔑 Restablecer contraseña</h3>' +
            '<div style="display:flex;gap:8px"><input type="email" id="cs-reset-email" placeholder="correo@ejemplo.com" style="flex:1"><button class="cs-btn" id="cs-reset-btn">Enviar enlace</button></div>' +
            '<p><small>Se envía un correo con un enlace para crear una contraseña nueva.</small></p>' +
            '<h3>📜 Auditoría (últimas 100 acciones)</h3>' +
            '<input type="search" id="cs-aud-q" placeholder="Filtrar por texto…" style="width:100%">' +
            '<div id="cs-aud-list">' + tablaAuditoria(auditoria) + '</div>';
          function tablaIntentos(rows) {
            return rows.length ? rows.map(function (a) {
              return '<div style="padding:6px;border-bottom:1px solid #26262b"><strong>' + E(a.email) + '</strong> · Intentos: ' + (a.count || 0) + '<br><small>Último: ' + api.fmtFechaHora(a.last_at) + (a.last_ip ? ' · IP: ' + E(a.last_ip) : '') + (a.last_device ? ' · ' + E(a.last_device) : '') + (a.blocked_until ? ' · Bloqueado hasta: ' + api.fmtFechaHora(a.blocked_until) : '') + '</small></div>';
            }).join('') : '<p>Sin intentos fallidos registrados.</p>';
          }
          function tablaAuditoria(rows) {
            return rows.length ? rows.map(function (a) {
              return '<div style="padding:6px;border-bottom:1px solid #26262b"><small>' + api.fmtFechaHora(a.created_at) + '</small><br><strong>' + E(a.actor_email || '') + '</strong> · ' + E(a.action) + ' <small>(' + E(a.target_type || '') + ' ' + E(a.target_id || '') + ')</small></div>';
            }).join('') : '<p>Sin registros de auditoría.</p>';
          }
          el.querySelectorAll('[data-unlock]').forEach(function (b) {
            b.addEventListener('click', function () {
              conCarga(b, async function () {
                try { await api.rpc('unlock_account', { p_email: b.getAttribute('data-unlock') }); await api.audit('security.unlock', { email: b.getAttribute('data-unlock') }); api.toast('Cuenta desbloqueada ✅', 'success'); api.refreshBadges(); if (api.openSection) api.openSection('seguridad'); }
                catch (e) { api.toast('No se pudo desbloquear.', 'error'); b.insertAdjacentHTML('afterend', detalles(e)); }
              });
            });
          });
          el.querySelectorAll('[data-close-session]').forEach(function (b) {
            b.addEventListener('click', function () {
              conCarga(b, async function () {
                try {
                  var r = await api.rpc('close_user_sessions', { p_user_id: b.getAttribute('data-close-session') });
                  var msg = (r && r.message) || 'Se marcó la cuenta para que vuelva a iniciar sesión la próxima vez que abra el panel. No es un cierre instantáneo de la sesión.';
                  api.toast(msg, 'info'); await api.audit('security.close_sessions', { user_id: b.getAttribute('data-close-session'), revoked: false });
                } catch (e) { api.toast('No se pudo cerrar la sesión.', 'error'); b.insertAdjacentHTML('afterend', detalles(e)); }
              });
            });
          });
          var filtrarBtn = el.querySelector('#cs-att-filtrar');
          if (filtrarBtn) filtrarBtn.addEventListener('click', async function () {
            var q = el.querySelector('#cs-att-q').value.trim(), fecha = el.querySelector('#cs-att-fecha').value;
            var opts = { order: 'last_at', ascending: false, limit: 100 };
            if (fecha) opts.gte = [['last_at', fecha]];
            var rows = await api.select('login_attempts', opts);
            if (q) rows = rows.filter(function (a) { return normalizarTexto(a.email).indexOf(normalizarTexto(q)) !== -1; });
            el.querySelector('#cs-att-list').innerHTML = tablaIntentos(rows);
          });
          var audQ = el.querySelector('#cs-aud-q');
          if (audQ) audQ.addEventListener('input', function () {
            var q = normalizarTexto(audQ.value);
            var rows = auditoria.filter(function (a) { return normalizarTexto([a.actor_email, a.action, a.target_type, a.target_id].join(' ')).indexOf(q) !== -1; });
            el.querySelector('#cs-aud-list').innerHTML = tablaAuditoria(rows);
          });
          var resetBtn = el.querySelector('#cs-reset-btn');
          if (resetBtn) resetBtn.addEventListener('click', function () {
            conCarga(resetBtn, async function () {
              var email = el.querySelector('#cs-reset-email').value.trim();
              if (!email) { api.toast('Escribe el correo primero.', 'warning'); return; }
              try {
                var res = await api.client().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
                if (res && res.error) throw res.error;
                api.toast('Enlace enviado a ' + email + ' ✅', 'success'); await api.audit('security.password_reset', { email: email });
              } catch (e) { api.toast('No se pudo enviar el enlace.', 'error'); resetBtn.insertAdjacentHTML('afterend', detalles(e)); }
            });
          });
        } catch (e) { el.innerHTML = errBox(api, e, 'No se pudo cargar la sección de seguridad.'); }
      }
    });
  }

  /* ================================================================
     2. INTERNET
     ================================================================ */
  var internetTimer = null, caidas = [];
  function registrarInternet() {
    REG.register({
      id: 'internet', title: 'Internet', icon: 'wifi', color: '#4da3ff',
      render: function (el, api) {
        if (internetTimer) { clearInterval(internetTimer); internetTimer = null; }
        function pintar() {
          var on = navigator.onLine;
          el.innerHTML = '<h3>🌐 Estado de la conexión</h3>' +
            '<p style="font-size:20px">' + (on ? '🟢 Conectado' : '🔴 Sin conexión') + '</p>' +
            '<p>Tipo de conexión: <strong>' + escLocal((navigator.connection && navigator.connection.effectiveType) || 'No disponible') + '</strong></p>' +
            '<p>Respuesta de la base de datos: <strong id="cs-ping">midiendo…</strong></p>' +
            '<h4>Caídas en esta sesión</h4>' + (caidas.length ? caidas.map(function (c) {
              return '<div style="padding:6px;border-bottom:1px solid #26262b">🔴 Cayó: ' + api.fmtHora(c.caida) + (c.regreso ? ' · 🟢 Volvió: ' + api.fmtHora(c.regreso) : ' · aún sin conexión') + '</div>';
            }).join('') : '<p>Sin caídas registradas en esta sesión.</p>');
        }
        pintar();
        async function medir() { try { var ms = await pingSupabase(api); var n = el.querySelector('#cs-ping'); if (n && el.isConnected) n.textContent = ms + ' ms'; } catch (e) { var n2 = el.querySelector('#cs-ping'); if (n2 && el.isConnected) n2.textContent = 'sin respuesta'; } }
        medir();
        internetTimer = setInterval(function () { if (!el.isConnected) { clearInterval(internetTimer); internetTimer = null; return; } medir(); }, 10000);
        function onOff() { if (!navigator.onLine) caidas.push({ caida: new Date().toISOString(), regreso: null }); else if (caidas.length && !caidas[caidas.length - 1].regreso) caidas[caidas.length - 1].regreso = new Date().toISOString(); if (el.isConnected) pintar(); }
        window.addEventListener('online', onOff); window.addEventListener('offline', onOff);
        if (typeof MutationObserver !== 'undefined') {
          var obs = new MutationObserver(function () { if (!el.isConnected) { window.removeEventListener('online', onOff); window.removeEventListener('offline', onOff); obs.disconnect(); } });
          if (document.body) obs.observe(document.body, { childList: true, subtree: true });
        }
      }
    });
  }

  /* ================================================================
     3. VELOCIDAD
     ================================================================ */
  function registrarVelocidad() {
    REG.register({
      id: 'velocidad', title: 'Velocidad', icon: 'gauge', color: '#b388ff',
      render: async function (el, api) {
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        el.innerHTML = '<h3>🚀 Prueba de velocidad</h3>' +
          '<button class="cs-btn" id="cs-speed-btn" style="font-size:18px;padding:14px 22px">Probar internet</button>' +
          '<div id="cs-speed-result" style="margin-top:14px"></div><div id="cs-speed-hist"><p>Cargando historial…</p></div>';
        async function historial() {
          try {
            var rows = await api.select('speed_tests', { order: 'created_at', ascending: false, limit: 10 });
            el.querySelector('#cs-speed-hist').innerHTML = '<h4>Historial (últimas 10)</h4>' + (rows.length ? rows.map(function (r) {
              return '<div style="padding:6px;border-bottom:1px solid #26262b">' + api.fmtFechaHora(r.created_at) + ' · <strong>' + r.descarga_mbps + ' Mbps</strong> · ' + (r.latencia_ms || '—') + ' ms · ' + E(r.veredicto || '') + '</div>';
            }).join('') : '<p>Todavía no hay pruebas guardadas.</p>');
          } catch (e) { el.querySelector('#cs-speed-hist').innerHTML = errBox(api, e, 'No se pudo cargar el historial.'); }
        }
        historial();
        el.querySelector('#cs-speed-btn').addEventListener('click', function (ev) {
          conCarga(ev.currentTarget, async function () {
            var box = el.querySelector('#cs-speed-result'); box.innerHTML = 'Midiendo… ⏳';
            try {
              var t0 = performance.now();
              var resp = await fetch('index.html?cs_speed=' + Date.now(), { cache: 'no-store' });
              var blob = await resp.blob();
              var seg = (performance.now() - t0) / 1000;
              var mbps = Math.round((blob.size * 8 / seg / 1e6) * 100) / 100;
              var latencia = await pingSupabase(api);
              var estabilidad = [];
              for (var i = 0; i < 5; i++) estabilidad.push(await pingSupabase(api));
              var veredicto = veredictoVelocidad(mbps, latencia);
              var pct = Math.min(100, mbps / 50 * 100);
              box.innerHTML = '<div style="background:#26262b;border-radius:8px;height:22px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:#7e57c2"></div></div>' +
                '<p style="font-size:20px"><strong>' + mbps + ' Mbps</strong> · ' + veredicto + '</p>' +
                '<p>Respuesta (ping): ' + latencia + ' ms · Estabilidad (5 mediciones): ' + estabilidad.join(', ') + ' ms</p>' +
                '<p><small>25 Mbps o más es excelente para el panel. Si sale “Muy lenta”, revisa el wifi antes de culpar a la aplicación. 😉</small></p>';
              var fila = { descarga_mbps: mbps, latencia_ms: latencia, estabilidad_ms: estabilidad, veredicto: veredicto, created_by: sesionId(api) };
              try { await api.insert('speed_tests', fila); historial(); }
              catch (e2) { api.queue.add({ tipo: 'speed_test', tabla: 'speed_tests', operacion: 'insert', payload: fila }); api.toast('No se pudo guardar la prueba ahora; quedó en la cola para subirla luego. ⚠️', 'warning'); }
            } catch (e) { box.innerHTML = errBox(api, e, 'La prueba falló. Revisa tu conexión e inténtalo de nuevo.'); }
          });
        });
      }
    });
  }

  /* ================================================================
     4. DIAGNÓSTICO
     ================================================================ */
  function registrarDiagnostico() {
    REG.register({
      id: 'diagnostico', title: 'Diagnóstico', icon: 'stethoscope', color: '#ffd54f',
      render: function (el, api) {
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        var resultados = [];
        var PRUEBAS = [
          { id: 'internet', nombre: 'Internet', explicacion: 'Este dispositivo no tiene conexión a internet.', solucion: null,
            run: async function () { if (!navigator.onLine) throw new Error('navigator.onLine = false'); return 'Conectado'; } },
          { id: 'db', nombre: 'Base de datos', explicacion: 'No se pudo leer ni escribir en la base de datos.', solucion: null,
            run: async function () {
              await api.select('profiles', { columns: 'id', limit: 1 });
              var ins = await api.insert('sync_queue_log', { tipo: 'diagnostico', resultado: 'prueba' });
              var id = ins && ins[0] && ins[0].id;
              if (id) await api.remove('sync_queue_log', [['id', id]]);
              return 'Lectura y escritura correctas';
            } },
          { id: 'auth', nombre: 'Sesión (Auth)', explicacion: 'No hay una sesión válida; vuelve a iniciar sesión.', solucion: null,
            run: async function () { var r = await api.client().auth.getSession(); if (r && r.error) throw r.error; if (!r || !r.data || !r.data.session) throw new Error('Sin sesión activa'); return 'Sesión activa'; } },
          { id: 'storage', nombre: 'Archivos (Storage)', explicacion: 'No se pudieron subir archivos. Puede faltar el contenedor “soporte-pruebas” o sus permisos.', solucion: null,
            run: async function () {
              var nombre = 'prueba-' + Date.now() + '.txt';
              var up = await api.client().storage.from('soporte-pruebas').upload(nombre, new Blob(['ok'], { type: 'text/plain' }));
              if (up && up.error) throw up.error;
              await api.client().storage.from('soporte-pruebas').remove([nombre]);
              return 'Subida y borrado correctos';
            } },
          { id: 'realtime', nombre: 'Tiempo real (Realtime)', explicacion: 'El canal en tiempo real no respondió en 6 segundos.', solucion: null,
            run: async function () {
              var client = api.client();
              return await new Promise(function (resolve, reject) {
                var canal = null, listo = false;
                var to = setTimeout(function () { limpiar(); reject(new Error('Tiempo de espera agotado (6 s)')); }, 6000);
                function limpiar() { clearTimeout(to); try { if (canal && client.removeChannel) client.removeChannel(canal); else if (canal && canal.unsubscribe) canal.unsubscribe(); } catch (e) {} }
                try {
                  canal = client.channel('cs-diag-' + Date.now());
                  canal.subscribe(function (status) { if (listo) return; if (status === 'SUBSCRIBED') { listo = true; limpiar(); resolve('Canal conectado'); } });
                } catch (e) { limpiar(); reject(e); }
              });
            } },
          { id: 'push', nombre: 'Notificaciones push', explicacion: 'No se pudo revisar los dispositivos registrados.', solucion: null,
            run: async function () { var rows = await api.select('push_tokens', { columns: 'id', limit: 1 }); if (!rows.length) return { warn: 'Sin dispositivos registrados' }; return rows.length + ' dispositivo(s) registrado(s)'; } },
          { id: 'sw', nombre: 'Service Worker', explicacion: 'La aplicación no tiene su trabajador de fondo activo; eso afecta la instalación y el modo sin conexión.', solucion: 'sw',
            run: async function () { if (!('serviceWorker' in navigator)) throw new Error('Service Worker no soportado'); var reg = await navigator.serviceWorker.getRegistration(); if (!reg) throw new Error('Sin registro de Service Worker'); return 'Registrado'; } },
          { id: 'notif', nombre: 'Permiso de notificaciones', explicacion: 'El navegador no ha dado permiso para mostrar notificaciones en este dispositivo.', solucion: null,
            run: async function () { if (typeof Notification === 'undefined') throw new Error('Notificaciones no soportadas'); if (Notification.permission === 'denied') throw new Error('Permiso denegado'); if (Notification.permission !== 'granted') return { warn: 'Permiso aún no concedido (' + Notification.permission + ')' }; return 'Permiso concedido'; } },
          { id: 'cache', nombre: 'Caché', explicacion: 'No se pudo revisar la caché de la aplicación.', solucion: 'cache',
            run: async function () { if (typeof caches === 'undefined') throw new Error('API de caché no disponible'); var ks = await caches.keys(); return ks.length + ' caché(s)'; } }
        ];
        el.innerHTML = '<h3>🩺 Diagnóstico completo</h3>' +
          '<button class="cs-btn" id="cs-diag-run" style="font-size:16px;padding:12px 20px">Revisar todo</button> ' +
          '<button class="cs-btn" id="cs-diag-copy">Copiar reporte</button>' +
          '<div id="cs-diag-list" style="margin-top:12px"><p>Pulsa “Revisar todo” para empezar.</p></div>';
        function pintar() {
          el.querySelector('#cs-diag-list').innerHTML = resultados.map(function (r, i) {
            var icono = r.estado === 'ok' ? '✓' : r.estado === 'warn' ? '⚠' : r.estado === 'run' ? '⏳' : '✗';
            var color = r.estado === 'ok' ? '#2e7d32' : r.estado === 'warn' ? '#ef6c00' : r.estado === 'run' ? '#666' : '#c62828';
            return '<div class="cs-diag-row" data-prueba="' + r.id + '" style="padding:10px;border-bottom:1px solid #26262b">' +
              '<span style="color:' + color + ';font-weight:bold">' + icono + ' ' + E(r.nombre) + '</span>' +
              (r.ms != null ? ' <small>(' + r.ms + ' ms)</small>' : '') +
              (r.detalle ? '<br><small>' + E(r.detalle) + '</small>' : '') +
              (r.estado === 'error' ? '<br><small>' + E(r.explicacion || '') + '</small>' + detalles(r.error) +
                '<br><button class="cs-btn" data-solucion="' + i + '">' + (r.solucion === 'cache' ? 'Limpiar caché' : r.solucion === 'sw' ? 'Re-registrar Service Worker' : 'Reintentar') + '</button>' : '') +
              '</div>';
          }).join('');
          el.querySelectorAll('[data-solucion]').forEach(function (b) {
            b.addEventListener('click', async function () {
              var r = resultados[Number(b.getAttribute('data-solucion'))];
              await conCarga(b, async function () {
                try {
                  if (r.solucion === 'cache' && typeof caches !== 'undefined') { var ks = await caches.keys(); await Promise.all(ks.map(function (k) { return caches.delete(k); })); api.toast('Caché limpiada ✅', 'success'); }
                  else if (r.solucion === 'sw' && 'serviceWorker' in navigator) { var reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.unregister(); await navigator.serviceWorker.register('sw.js'); api.toast('Service Worker registrado de nuevo ✅', 'success'); }
                } catch (e) { api.toast('La solución falló.', 'error'); }
                await correrUna(r.id);
              });
            });
          });
        }
        async function correrUna(id) {
          var p = PRUEBAS.filter(function (x) { return x.id === id; })[0]; if (!p) return;
          var r = resultados.filter(function (x) { return x.id === id; })[0];
          if (!r) { r = { id: p.id, nombre: p.nombre, explicacion: p.explicacion, solucion: p.solucion }; resultados.push(r); }
          r.estado = 'run'; r.detalle = ''; pintar();
          var t0 = performance.now();
          try { var d = await p.run(); r.ms = Math.round(performance.now() - t0); if (d && typeof d === 'object' && d.warn) { r.estado = 'warn'; r.detalle = d.warn; } else { r.estado = 'ok'; r.detalle = String(d || 'Correcto'); } }
          catch (e) { r.ms = Math.round(performance.now() - t0); r.estado = 'error'; r.error = e; r.detalle = 'Falló la prueba.'; }
          pintar();
        }
        el.querySelector('#cs-diag-run').addEventListener('click', function (ev) {
          conCarga(ev.currentTarget, async function () { resultados = []; for (var i = 0; i < PRUEBAS.length; i++) await correrUna(PRUEBAS[i].id); });
        });
        el.querySelector('#cs-diag-copy').addEventListener('click', async function () {
          if (!resultados.length) { api.toast('Primero corre la revisión.', 'warning'); return; }
          var lineas = ['🩺 Reporte del Centro de Soporte — GOAT Style Salon', 'Fecha: ' + api.fmtFechaHora(new Date().toISOString()), ''];
          resultados.forEach(function (r) { lineas.push((r.estado === 'ok' ? '✓' : r.estado === 'warn' ? '⚠' : '✗') + ' ' + r.nombre + (r.ms != null ? ' (' + r.ms + ' ms)' : '') + (r.detalle ? ' — ' + r.detalle : '') + (r.error ? ' — Error: ' + (r.error.message || r.error) : '')); });
          await copiarTexto(lineas.join('\n'));
          api.toast('Reporte copiado, listo para enviar por WhatsApp ✅', 'success');
        });
      }
    });
  }

  /* ================================================================
     5. SINCRONIZACIÓN
     ================================================================ */
  function registrarSincronizacion() {
    var abierta = false;
    REG.register({
      id: 'sincronizacion', title: 'Sincronización', icon: 'refresh-cw', color: '#4db6ac',
      badge: async function (api) { try { var n = await api.queue.count(); return { count: n, level: n > 0 ? 'warn' : null }; } catch (e) { return { count: 0, level: null }; } },
      render: async function (el, api) {
        abierta = true;
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        async function pintar() {
          if (!el.isConnected && document.body) { /* jsdom: isConnected puede ser false tras innerHTML */ }
          var items = api.queue.list() || [];
          var hist = [];
          try { hist = await api.select('sync_queue_log', { order: 'created_at', ascending: false, limit: 20 }); } catch (e) {}
          el.innerHTML = '<h3>🔄 Cola de subida</h3>' +
            '<button class="cs-btn" id="cs-q-flush" style="padding:10px 18px">Subir todo ahora</button>' +
            '<div id="cs-q-progress" style="margin:10px 0"></div>' +
            (items.length ? items.map(function (it) {
              return '<div class="cs-q-row" style="padding:8px;border-bottom:1px solid #26262b;display:flex;justify-content:space-between;gap:8px"><div><strong>' + E(it.tipo || it.tabla || '—') + '</strong><br><small>' + api.fmtFechaHora(it.created_at || it.queued_at || Date.now()) + (it.error ? '<br>Error: ' + E(typeof it.error === 'string' ? it.error : (it.error.message || '')) : '') + '</small></div>' +
                '<span><button class="cs-btn" data-q-retry="' + E(it.id) + '">Reintentar este</button> <button class="cs-btn" data-q-drop="' + E(it.id) + '">Descartar</button></span></div>';
            }).join('') : '<p>La cola está vacía. Todo está subido. 🎉</p>') +
            '<h4>Historial (últimos 20)</h4>' + (hist.length ? hist.map(function (hh) {
              return '<div style="padding:6px;border-bottom:1px solid #26262b"><small>' + api.fmtFechaHora(hh.created_at) + '</small> · ' + E(hh.tipo || '') + ' · ' + E(hh.tabla || '') + ' · <strong>' + E(hh.resultado || '') + '</strong>' + (hh.motivo ? '<br><small>' + E(hh.motivo) + '</small>' : '') + '</div>';
            }).join('') : '<p>Sin historial todavía.</p>');
          async function ejecutarItem(it) {
            var op = it.operacion || 'insert';
            if (op === 'insert') await api.insert(it.tabla, it.payload);
            else if (op === 'update') await api.update(it.tabla, it.payload, it.eq || []);
            else if (op === 'remove' || op === 'delete') await api.remove(it.tabla, it.eq || []);
            else if (op === 'rpc') await api.rpc(it.tabla, it.payload);
            else await api.insert(it.tabla, it.payload);
          }
          el.querySelectorAll('[data-q-retry]').forEach(function (b) {
            b.addEventListener('click', function () {
              conCarga(b, async function () {
                var it = (api.queue.list() || []).filter(function (x) { return String(x.id) === b.getAttribute('data-q-retry'); })[0];
                if (!it) return;
                try { await ejecutarItem(it); api.queue.remove(it.id); try { await api.insert('sync_queue_log', { queue_id: String(it.id), tipo: it.tipo || '', tabla: it.tabla || '', resultado: 'subido' }); } catch (e) {} api.toast('Elemento subido ✅', 'success'); }
                catch (e) { try { await api.insert('sync_queue_log', { queue_id: String(it.id), tipo: it.tipo || '', tabla: it.tabla || '', resultado: 'fallido', motivo: e.message || String(e) }); } catch (e2) {} api.toast('Ese elemento volvió a fallar.', 'error'); }
                pintar();
              });
            });
          });
          el.querySelectorAll('[data-q-drop]').forEach(function (b) {
            b.addEventListener('click', async function () {
              var ok = await api.confirm({ title: 'Descartar elemento', body: 'Este elemento pendiente se eliminará de la cola y NO se subirá. ¿Seguro?', confirmText: 'Descartar', danger: true });
              if (!ok) return;
              var it = (api.queue.list() || []).filter(function (x) { return String(x.id) === b.getAttribute('data-q-drop'); })[0];
              api.queue.remove(b.getAttribute('data-q-drop'));
              try { await api.insert('sync_queue_log', { queue_id: b.getAttribute('data-q-drop'), tipo: (it && it.tipo) || '', tabla: (it && it.tabla) || '', resultado: 'descartado' }); } catch (e) {}
              api.toast('Elemento descartado.', 'info'); pintar();
            });
          });
          var flushBtn = el.querySelector('#cs-q-flush');
          if (flushBtn) flushBtn.addEventListener('click', function () {
            conCarga(flushBtn, async function () {
              var antes = await api.queue.count();
              var prog = el.querySelector('#cs-q-progress');
              try { await api.queue.flush(function (p, totalArg) { var done, total; if (p && typeof p === 'object') { done = (p.subidos || 0) + (p.fallidos || 0); total = p.total; } else { done = p; total = totalArg; } if (prog) prog.innerHTML = '<div style="background:#26262b;border-radius:8px;height:18px;overflow:hidden"><div style="height:100%;background:#26a69a;width:' + (total ? Math.round(done / total * 100) : 100) + '%"></div></div><small>Subiendo ' + done + ' de ' + total + '…</small>'; }); }
              catch (e) { api.toast('La subida se interrumpió.', 'error'); }
              var despues = await api.queue.count();
              if (prog) prog.innerHTML = '<p>✅ Subidos: <strong>' + (antes - despues) + '</strong> · ❌ Fallidos (siguen en cola): <strong>' + despues + '</strong></p>';
              api.refreshBadges(); pintar();
            });
          });
        }
        await pintar();
        if (api.queue && typeof api.queue.onChange === 'function') {
          try { api.queue.onChange(function () { if (abierta && el.isConnected) pintar(); }); } catch (e) {}
        }
      }
    });
  }

  /* ============ Envío push compartido (memos / notificaciones) ============ */
  async function pushNtf(api, nid) {
    // OJO: api.client() es asíncrono — hay que esperarlo con await. Sin el
    // await, .functions cae sobre la promesa y el envío NUNCA ocurre (bug
    // corregido: los avisos salían en la campana pero el push no sonaba).
    try {
      var c = await api.client();
      if (c && c.functions && typeof c.functions.invoke === 'function') {
        await c.functions.invoke('send-push', { body: { mode: 'send', notificationId: nid } });
      }
    } catch (e) {}
  }
  async function enviarPushMasivo(api, titulo, cuerpo, audiencia, persona) {
    // audiencia: 'barberos' | 'clientes' | 'todos' | 'persona' | 'app'
    // persona: {tipo:'barber'|'client'|'profile', id, nombre}
    if (audiencia === 'barberos' || audiencia === 'todos') {
      var resM = await api.rpc('send_mass_notification', { p_title: titulo, p_body: cuerpo, p_audience: 'staff', p_client_ids: [], p_barber_ids: [] });
      // La RPC crea los avisos del personal pero no devuelve sus ids: se
      // buscan los recién creados para disparar el push de cada uno.
      var nEsp = (resM && resM.inserted) ? resM.inserted : 0;
      if (nEsp > 0) {
        var desde = new Date(Date.now() - 3 * 60 * 1000).toISOString();
        var filasStaff = await api.select('notifications', { columns: 'id', eq: [['audience', 'staff'], ['type', 'masiva'], ['title', titulo]], gte: [['created_at', desde]], order: 'created_at', ascending: false, limit: nEsp });
        for (var s = 0; s < filasStaff.length; s++) await pushNtf(api, filasStaff[s].id);
      }
    }
    if (audiencia === 'clientes' || audiencia === 'todos') {
      var clientes = await api.select('clients', { columns: 'id', limit: 1000 });
      for (var i = 0; i < clientes.length; i++) {
        var nid = uid('nt');
        await api.insert('notifications', { id: nid, audience: 'client', client_id: clientes[i].id, type: 'masiva', title: titulo, body: cuerpo });
        await pushNtf(api, nid);
      }
    }
    if (audiencia === 'app') {
      var idApp = uid('nt');
      await api.insert('notifications', { id: idApp, audience: 'app', type: 'masiva', title: titulo, body: cuerpo });
      await pushNtf(api, idApp);
    }
    if (audiencia === 'persona' && persona) {
      var id2 = uid('nt');
      var fila = { id: id2, audience: persona.tipo === 'barber' ? 'staff' : 'client', type: 'masiva', title: titulo, body: cuerpo };
      if (persona.tipo === 'barber') fila.barber_id = persona.id; else fila.client_id = persona.id;
      await api.insert('notifications', fila);
      await pushNtf(api, id2);
    }
  }

  /* ================================================================
     6. MEMOS
     ================================================================ */
  function registrarMemos() {
    REG.register({
      id: 'memos', title: 'Memos', icon: 'mail', color: '#d4af37',
      render: async function (el, api) {
        cargando(el);
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        var PRIO_COLOR = { normal: '#757575', importante: '#ef6c00', urgente: '#c62828' };
        try {
          var profiles = await api.select('profiles', { columns: 'id,nombre,email,role,barber_id', limit: 200 });
          var barberos = await api.select('barbers', { columns: 'id,name', limit: 100 });
          var clientes = await api.select('clients', { columns: 'id,name', limit: 500 });
          var editando = null;
          function opcionesPersona() {
            var out = '';
            barberos.forEach(function (b) { out += '<option value="barber:' + E(b.id) + '">💈 ' + E(b.name) + ' (barbero)</option>'; });
            clientes.forEach(function (c) { out += '<option value="client:' + E(c.id) + '">👤 ' + E(c.name) + ' (cliente)</option>'; });
            profiles.forEach(function (p) { out += '<option value="profile:' + E(p.id) + '">🔐 ' + E(p.nombre || p.email) + ' (cuenta)</option>'; });
            return out;
          }
          async function pintarLista() {
            var memos = await api.select('support_memos', { order: 'created_at', ascending: false, limit: 200 });
            var box = el.querySelector('#cs-memo-list');
            box.innerHTML = memos.length ? memos.map(function (m) {
              return '<div class="cs-memo-row" style="padding:10px;border-bottom:1px solid #26262b">' +
                '<span style="background:' + (PRIO_COLOR[m.prioridad] || '#757575') + ';color:#fff;border-radius:10px;padding:2px 8px;font-size:12px">' + E(m.prioridad) + '</span> ' +
                '<span style="background:rgba(212,175,55,.16);color:#e9d189;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600">' + E(m.estado) + '</span> ' +
                '<strong>' + E(m.titulo) + '</strong><br><small>Para: ' + E(m.destinatario_nombre || m.destinatario_tipo) + ' · ' + api.fmtFechaHora(m.created_at) + (m.etiquetas && m.etiquetas.length ? ' · 🏷️ ' + E(m.etiquetas.join(', ')) : '') + '</small>' +
                '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="cs-btn" data-memo-edit="' + E(m.id) + '">Editar</button>' +
                '<button class="cs-btn" data-memo-dup="' + E(m.id) + '">Duplicar</button>' +
                '<button class="cs-btn" data-memo-reads="' + E(m.id) + '">Ver lecturas</button>' +
                (m.estado !== 'archivado' ? '<button class="cs-btn" data-memo-arch="' + E(m.id) + '">Archivar</button>' : '') +
                '<button class="cs-btn" data-memo-del="' + E(m.id) + '">Eliminar</button></div>' +
                '<div data-memo-reads-box="' + E(m.id) + '"></div></div>';
            }).join('') : '<p>No hay memos todavía.</p>';
            function buscarMemo(id) { return memos.filter(function (x) { return String(x.id) === String(id); })[0]; }
            box.querySelectorAll('[data-memo-edit]').forEach(function (b) { b.addEventListener('click', function () { var m = buscarMemo(b.getAttribute('data-memo-edit')); if (m) rellenar(m); }); });
            box.querySelectorAll('[data-memo-dup]').forEach(function (b) { b.addEventListener('click', async function () { var m = buscarMemo(b.getAttribute('data-memo-dup')); if (!m) return; var copia = Object.assign({}, m); delete copia.id; delete copia.created_at; delete copia.updated_at; copia.titulo = m.titulo + ' (copia)'; copia.estado = 'borrador'; await conCarga(b, async function () { await api.insert('support_memos', copia); api.toast('Memo duplicado como borrador ✅', 'success'); pintarLista(); }); }); });
            box.querySelectorAll('[data-memo-arch]').forEach(function (b) { b.addEventListener('click', async function () { await conCarga(b, async function () { await api.update('support_memos', { estado: 'archivado', updated_at: new Date().toISOString() }, [['id', b.getAttribute('data-memo-arch')]]); api.toast('Memo archivado.', 'info'); pintarLista(); }); }); });
            box.querySelectorAll('[data-memo-del]').forEach(function (b) { b.addEventListener('click', async function () { var ok = await api.confirm({ title: 'Eliminar memo', body: 'Este memo se eliminará para siempre. ¿Seguro?', confirmText: 'Eliminar', danger: true }); if (!ok) return; await api.remove('support_memos', [['id', b.getAttribute('data-memo-del')]]); api.toast('Memo eliminado.', 'info'); pintarLista(); }); });
            box.querySelectorAll('[data-memo-reads]').forEach(function (b) { b.addEventListener('click', async function () {
              var id = b.getAttribute('data-memo-reads'); var idEsc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '');
              var destino = box.querySelector('[data-memo-reads-box="' + idEsc + '"]') || box.querySelector('[data-memo-reads-box]');
              var m = buscarMemo(id);
              try { var reads = await api.select('memo_reads', { eq: [['memo_id', id]], order: 'leido_at', ascending: false, limit: 200 });
                destino.innerHTML = reads.length ? '<div style="background:#101012;padding:8px;margin-top:6px">' + reads.map(function (r) { return '<div>👁️ ' + E(r.lector) + ' · ' + api.fmtFechaHora(r.leido_at) + '</div>'; }).join('') + '</div>'
                  : '<p style="margin-top:6px"><small>' + (m && m.estado === 'enviado' ? 'Aún no lo ha leído nadie.' : 'Este memo todavía no se ha enviado.') + '</small></p>';
              } catch (e) { destino.innerHTML = errBox(api, e, 'No se pudieron cargar las lecturas.'); }
            }); });
          }
          function rellenar(m) {
            editando = m.id;
            el.querySelector('#cs-memo-titulo').value = m.titulo || '';
            el.querySelector('#cs-memo-mensaje').value = m.mensaje || '';
            el.querySelector('#cs-memo-tipo').value = m.destinatario_tipo || 'clientes';
            if (m.destinatario_tipo === 'persona' && m.destinatario_id) el.querySelector('#cs-memo-persona').value = m.destinatario_id;
            el.querySelector('#cs-memo-prioridad').value = m.prioridad || 'normal';
            el.querySelector('#cs-memo-etiquetas').value = (m.etiquetas || []).join(', ');
            el.querySelector('#cs-memo-push').checked = !!m.enviar_push;
            el.querySelector('#cs-memo-form-title').textContent = '✏️ Editando memo';
            togglePersona(); window.scrollTo(0, 0);
          }
          function togglePersona() { var t = el.querySelector('#cs-memo-tipo').value; el.querySelector('#cs-memo-persona-wrap').style.display = t === 'persona' ? '' : 'none'; }
          el.innerHTML =
            '<h3 id="cs-memo-form-title">✉️ Nuevo memo</h3>' +
            '<div style="display:grid;gap:8px;max-width:640px">' +
            '<input id="cs-memo-titulo" placeholder="Título del memo">' +
            '<textarea id="cs-memo-mensaje" rows="4" placeholder="Mensaje…"></textarea>' +
            '<label>Enviar a: <select id="cs-memo-tipo"><option value="clientes">Todos los clientes</option><option value="barberos">Todos los barberos</option><option value="persona">Una persona</option></select></label>' +
            '<label id="cs-memo-persona-wrap" style="display:none">Persona: <select id="cs-memo-persona">' + opcionesPersona() + '</select></label>' +
            '<label>Prioridad: <select id="cs-memo-prioridad"><option value="normal">🟢 Normal</option><option value="importante">🟠 Importante</option><option value="urgente">🔴 Urgente</option></select></label>' +
            '<input id="cs-memo-etiquetas" placeholder="Etiquetas, separadas por comas">' +
            '<label>Imagen (opcional): <input type="file" id="cs-memo-imagen" accept="image/*"></label>' +
            '<label><input type="checkbox" id="cs-memo-push"> Enviar también por notificación push al enviar</label>' +
            '<div style="display:flex;gap:8px"><button class="cs-btn" id="cs-memo-borrador">Guardar como borrador</button><button class="cs-btn" id="cs-memo-enviar" style="font-weight:bold">Enviar</button></div>' +
            '</div><h3>📬 Memos</h3><div id="cs-memo-list">Cargando…</div>';
          el.querySelector('#cs-memo-tipo').addEventListener('change', togglePersona);
          async function guardar(enviar, btn) {
            await conCarga(btn, async function () {
              var tipo = el.querySelector('#cs-memo-tipo').value;
              var personaVal = el.querySelector('#cs-memo-persona').value;
              var personaNombre = '';
              if (tipo === 'persona') { var sel = el.querySelector('#cs-memo-persona'); personaNombre = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.replace(/^[^\s]+\s/, '') : ''; }
              var fila = {
                titulo: el.querySelector('#cs-memo-titulo').value.trim(),
                mensaje: el.querySelector('#cs-memo-mensaje').value.trim(),
                destinatario_tipo: tipo,
                destinatario_id: tipo === 'persona' ? personaVal : null,
                destinatario_nombre: tipo === 'persona' ? personaNombre : (tipo === 'clientes' ? 'Todos los clientes' : 'Todos los barberos'),
                prioridad: el.querySelector('#cs-memo-prioridad').value,
                etiquetas: el.querySelector('#cs-memo-etiquetas').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
                enviar_push: el.querySelector('#cs-memo-push').checked,
                estado: enviar ? 'enviado' : 'borrador',
                updated_at: new Date().toISOString()
              };
              if (!fila.titulo || !fila.mensaje) { api.toast('Escribe el título y el mensaje.', 'warning'); return; }
              var fileInput = el.querySelector('#cs-memo-imagen');
              var id = editando || uid('memo');
              if (fileInput && fileInput.files && fileInput.files[0]) {
                var f = fileInput.files[0]; var path = 'memos/' + id + '/' + f.name;
                var up = await api.client().storage.from('soporte-adjuntos').upload(path, f);
                if (up && up.error) throw up.error;
                var pub = api.client().storage.from('soporte-adjuntos').getPublicUrl(path);
                fila.imagen_url = (pub && pub.data && pub.data.publicUrl) || path;
              }
              if (editando) { await api.update('support_memos', fila, [['id', editando]]); }
              else { fila.id = id; fila.created_by = sesionId(api); await api.insert('support_memos', fila); }
              await api.audit(enviar ? 'memo.send' : 'memo.save', { id: id, titulo: fila.titulo });
              if (enviar && fila.enviar_push) {
                try {
                  if (tipo === 'barberos') await enviarPushMasivo(api, fila.titulo, fila.mensaje, 'barberos');
                  else if (tipo === 'clientes') await enviarPushMasivo(api, fila.titulo, fila.mensaje, 'clientes');
                  else { var partes = String(personaVal).split(':'); await enviarPushMasivo(api, fila.titulo, fila.mensaje, 'persona', { tipo: partes[0] === 'barber' ? 'barber' : 'client', id: partes.slice(1).join(':') }); }
                } catch (e) { api.toast('El memo quedó enviado, pero el aviso push falló. ⚠️', 'warning'); }
              }
              api.toast(enviar ? 'Memo enviado ✅' : 'Borrador guardado ✅', 'success');
              editando = null; el.querySelector('#cs-memo-form-title').textContent = '✉️ Nuevo memo';
              el.querySelector('#cs-memo-titulo').value = ''; el.querySelector('#cs-memo-mensaje').value = '';
              pintarLista();
            }).catch(function (e) { api.toast('No se pudo guardar el memo.', 'error'); });
          }
          el.querySelector('#cs-memo-borrador').addEventListener('click', function (ev) { guardar(false, ev.currentTarget); });
          el.querySelector('#cs-memo-enviar').addEventListener('click', function (ev) { guardar(true, ev.currentTarget); });
          await pintarLista();
        } catch (e) { el.innerHTML = errBox(api, e, 'No se pudo cargar la sección de memos.'); }
      }
    });
  }

  /* ================================================================
     7. BUSCAR MEMOS
     ================================================================ */
  function registrarBuscarMemos() {
    REG.register({
      id: 'buscar-memos', title: 'Buscar memos', icon: 'search', color: '#90a4ae',
      render: async function (el, api) {
        cargando(el);
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        try {
          var memos = await api.select('support_memos', { order: 'created_at', ascending: false, limit: 500 });
          var q0 = ''; try { q0 = api.takeSectionQuery('buscar-memos') || ''; } catch (e) {}
          el.innerHTML = '<h3>🔎 Buscar memos</h3>' +
            '<div style="display:grid;gap:8px;max-width:680px">' +
            '<input type="search" id="cs-bm-texto" placeholder="Buscar por texto (sin importar acentos)…" value="' + E(q0) + '">' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<label>Fecha exacta <input type="date" id="cs-bm-fecha"></label>' +
            '<label>Desde <input type="date" id="cs-bm-desde"></label>' +
            '<label>Hasta <input type="date" id="cs-bm-hasta"></label></div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<label>Día <select id="cs-bm-dia"><option value="">Cualquiera</option><option value="0">Domingo</option><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option></select></label>' +
            '<label>Mes <select id="cs-bm-mes"><option value="">Cualquiera</option>' + ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map(function (mn, i) { return '<option value="' + (i + 1) + '">' + mn + '</option>'; }).join('') + '</select></label>' +
            '<label>Año <input type="number" id="cs-bm-anio" placeholder="2026" style="width:90px"></label></div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<label>Para <select id="cs-bm-tipo"><option value="">Todos</option><option value="clientes">Clientes</option><option value="barberos">Barberos</option><option value="persona">Una persona</option></select></label>' +
            '<label>Prioridad <select id="cs-bm-prio"><option value="">Todas</option><option value="normal">Normal</option><option value="importante">Importante</option><option value="urgente">Urgente</option></select></label>' +
            '<label>Estado <select id="cs-bm-estado"><option value="">Todos</option><option value="borrador">Borrador</option><option value="enviado">Enviado</option><option value="archivado">Archivado</option></select></label>' +
            '<label>Orden <select id="cs-bm-orden"><option value="reciente">Más reciente</option><option value="antiguo">Más antiguo</option><option value="prioridad">Por prioridad</option></select></label></div>' +
            '<input id="cs-bm-etiqueta" placeholder="Etiqueta (ej.: pagos)">' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="cs-btn" id="cs-bm-limpiar">Limpiar filtros</button><button class="cs-btn" id="cs-bm-csv">Exportar CSV</button><button class="cs-btn" id="cs-bm-pdf">Exportar PDF</button></div>' +
            '</div><p id="cs-bm-count" style="font-weight:bold;margin-top:12px"></p><div id="cs-bm-list"></div>';
          var ultimos = [];
          function filtros() {
            return { texto: el.querySelector('#cs-bm-texto').value.trim(), fechaExacta: el.querySelector('#cs-bm-fecha').value || undefined,
              desde: el.querySelector('#cs-bm-desde').value || undefined, hasta: el.querySelector('#cs-bm-hasta').value || undefined,
              diaSemana: el.querySelector('#cs-bm-dia').value, mes: el.querySelector('#cs-bm-mes').value,
              anio: el.querySelector('#cs-bm-anio').value || undefined, destinatario_tipo: el.querySelector('#cs-bm-tipo').value || undefined,
              prioridad: el.querySelector('#cs-bm-prio').value || undefined, estado: el.querySelector('#cs-bm-estado').value || undefined,
              etiqueta: el.querySelector('#cs-bm-etiqueta').value.trim() || undefined };
          }
          function pintar() {
            var f = filtros();
            ultimos = ordenarMemos(filtrarMemos(memos, f), el.querySelector('#cs-bm-orden').value);
            el.querySelector('#cs-bm-count').textContent = ultimos.length + ' resultado' + (ultimos.length === 1 ? '' : 's');
            el.querySelector('#cs-bm-list').innerHTML = ultimos.length ? ultimos.map(function (m) {
              var tit = resaltar(m.titulo, f.texto); var msg = resaltar(m.mensaje, f.texto);
              return '<div class="cs-bm-row" style="padding:10px;border-bottom:1px solid #26262b"><strong>' + (tit || E(m.titulo)) + '</strong> ' +
                '<span style="background:rgba(212,175,55,.16);color:#e9d189;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600">' + E(m.prioridad) + ' · ' + E(m.estado) + '</span><br>' +
                '<span>' + (msg || E(m.mensaje)) + '</span><br><small>Para: ' + E(m.destinatario_nombre || m.destinatario_tipo) + ' · ' + api.fmtFechaHora(m.created_at) + '</small></div>';
            }).join('') : '<p>No se encontraron memos con esos filtros.</p>';
          }
          ['#cs-bm-texto','#cs-bm-fecha','#cs-bm-desde','#cs-bm-hasta','#cs-bm-dia','#cs-bm-mes','#cs-bm-anio','#cs-bm-tipo','#cs-bm-prio','#cs-bm-estado','#cs-bm-orden','#cs-bm-etiqueta'].forEach(function (sel) {
            var n = el.querySelector(sel); if (n) { n.addEventListener('input', pintar); n.addEventListener('change', pintar); }
          });
          el.querySelector('#cs-bm-limpiar').addEventListener('click', function () {
            el.querySelectorAll('input').forEach(function (i) { i.value = ''; });
            el.querySelectorAll('select').forEach(function (s) { s.value = s.id === 'cs-bm-orden' ? 'reciente' : ''; });
            pintar();
          });
          el.querySelector('#cs-bm-csv').addEventListener('click', function () {
            var csv = 'titulo,mensaje,para,prioridad,estado,fecha\n' + ultimos.map(function (m) {
              return [m.titulo, m.mensaje, m.destinatario_nombre || m.destinatario_tipo, m.prioridad, m.estado, m.created_at].map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
            }).join('\n');
            descargar('memos.csv', '﻿' + csv, 'text/csv;charset=utf-8'); api.toast('CSV descargado ✅', 'success');
          });
          el.querySelector('#cs-bm-pdf').addEventListener('click', function () {
            var w = window.open('', '_blank');
            if (!w) { api.toast('El navegador bloqueó la ventana del PDF.', 'warning'); return; }
            w.document.write('<html><head><title>Memos — GOAT Style Salon</title></head><body><h1>Memos</h1>' + ultimos.map(function (m) { return '<h3>' + E(m.titulo) + '</h3><p>' + E(m.mensaje) + '</p><p><small>' + E(m.destinatario_nombre || '') + ' · ' + api.fmtFechaHora(m.created_at) + '</small></p><hr>'; }).join('') + '<script>window.print()<\/script></body></html>');
            w.document.close();
          });
          pintar();
        } catch (e) { el.innerHTML = errBox(api, e, 'No se pudieron cargar los memos.'); }
      }
    });
  }

  /* ================================================================
     8. NOTIFICACIONES
     ================================================================ */
  function registrarNotificaciones() {
    REG.register({
      id: 'notificaciones', title: 'Notificaciones', icon: 'bell', color: '#f48fb1',
      badge: async function (api) {
        try { var rows = await api.select('notifications_log', { columns: 'id,programada_at', eq: [['estado', 'programada']], limit: 200 }); var futuras = rows.filter(function (r) { return r.programada_at && new Date(r.programada_at) > new Date(); }); return { count: futuras.length, level: futuras.length > 0 ? 'warn' : null }; }
        catch (e) { return { count: 0, level: null }; }
      },
      render: async function (el, api) {
        cargando(el);
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        try {
          var barberos = await api.select('barbers', { columns: 'id,name', limit: 100 });
          var clientes = await api.select('clients', { columns: 'id,name', limit: 500 });
          async function registrarLog(titulo, cuerpo, audiencia, destinatario, estado, programadaAt) {
            var fila = { titulo: titulo, cuerpo: cuerpo, audiencia: audiencia, destinatario: destinatario || null, estado: estado, programada_at: programadaAt || null, enviado_at: estado === 'enviado' ? new Date().toISOString() : null, created_by: sesionId(api) };
            try { await api.insert('notifications_log', fila); }
            catch (e) { api.queue.add({ tipo: 'notifications_log', tabla: 'notifications_log', operacion: 'insert', payload: fila }); }
          }
          async function enviarAhora(titulo, cuerpo, audiencia, persona) {
            await enviarPushMasivo(api, titulo, cuerpo, audiencia, persona);
            await registrarLog(titulo, cuerpo, audiencia === 'persona' ? 'persona' : audiencia, persona ? persona.nombre : null, 'enviado', null);
            await api.audit('notification.send', { titulo: titulo, audiencia: audiencia });
          }
          async function enviarProgramadas() {
            var vencidas = [];
            try { vencidas = await api.select('notifications_log', { eq: [['estado', 'programada']], lte: [['programada_at', new Date().toISOString()]], limit: 50 }); } catch (e) {}
            for (var i = 0; i < vencidas.length; i++) {
              var v = vencidas[i];
              try {
                var aud = v.audiencia === 'todos' ? 'todos' : v.audiencia === 'barberos' ? 'barberos' : v.audiencia === 'clientes' ? 'clientes' : v.audiencia === 'app' ? 'app' : 'persona';
                await enviarPushMasivo(api, v.titulo, v.cuerpo, aud, null);
                await api.update('notifications_log', { estado: 'enviado', enviado_at: new Date().toISOString() }, [['id', v.id]]);
                api.toast('Notificación programada enviada: ' + v.titulo + ' ✅', 'success');
              } catch (e) { await api.update('notifications_log', { estado: 'fallido' }, [['id', v.id]]).catch(function () {}); }
            }
            if (vencidas.length) api.refreshBadges();
          }
          await enviarProgramadas();
          var hist = await api.select('notifications_log', { order: 'created_at', ascending: false, limit: 30 });
          var opcionesPersona = '';
          barberos.forEach(function (b) { opcionesPersona += '<option value="barber:' + E(b.id) + '|' + E(b.name) + '">💈 ' + E(b.name) + '</option>'; });
          clientes.forEach(function (c) { opcionesPersona += '<option value="client:' + E(c.id) + '|' + E(c.name) + '">👤 ' + E(c.name) + '</option>'; });
          el.innerHTML = '<h3>🔔 Enviar notificación</h3>' +
            '<div style="display:grid;gap:8px;max-width:640px">' +
            '<input id="cs-nt-titulo" placeholder="Título">' +
            '<textarea id="cs-nt-cuerpo" rows="3" placeholder="Mensaje…"></textarea>' +
            '<label>Audiencia: <select id="cs-nt-aud"><option value="todos">Todos</option><option value="barberos">Barberos</option><option value="clientes">Clientes</option><option value="persona">Una persona</option><option value="app">Toda la app (todos los instalados)</option></select></label>' +
            '<label id="cs-nt-persona-wrap" style="display:none">Persona: <select id="cs-nt-persona">' + opcionesPersona + '</select></label>' +
            '<label><input type="checkbox" id="cs-nt-prog"> Programar envío</label>' +
            '<label id="cs-nt-fecha-wrap" style="display:none">Fecha y hora: <input type="datetime-local" id="cs-nt-fecha"></label>' +
            '<p><small>⏰ El envío programado se envía cuando el panel está abierto a esa hora.</small></p>' +
            '<button class="cs-btn" id="cs-nt-enviar" style="font-weight:bold">Enviar / Programar</button></div>' +
            '<h3>🕘 Historial (últimas 30)</h3>' + (hist.length ? hist.map(function (hh) {
              return '<div style="padding:8px;border-bottom:1px solid #26262b"><strong>' + E(hh.titulo) + '</strong> <span style="background:rgba(212,175,55,.16);color:#e9d189;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600">' + E(hh.estado) + '</span><br><small>' + E(hh.cuerpo) + '</small><br><small>Audiencia: ' + E(hh.audiencia) + (hh.destinatario ? ' · ' + E(hh.destinatario) : '') + ' · ' + api.fmtFechaHora(hh.enviado_at || hh.programada_at || hh.created_at) + '</small></div>';
            }).join('') : '<p>Sin notificaciones registradas todavía.</p>');
          function toggle() { var a = el.querySelector('#cs-nt-aud').value; el.querySelector('#cs-nt-persona-wrap').style.display = a === 'persona' ? '' : 'none'; el.querySelector('#cs-nt-fecha-wrap').style.display = el.querySelector('#cs-nt-prog').checked ? '' : 'none'; }
          el.querySelector('#cs-nt-aud').addEventListener('change', toggle);
          el.querySelector('#cs-nt-prog').addEventListener('change', toggle);
          el.querySelector('#cs-nt-enviar').addEventListener('click', function (ev) {
            conCarga(ev.currentTarget, async function () {
              var titulo = el.querySelector('#cs-nt-titulo').value.trim(), cuerpo = el.querySelector('#cs-nt-cuerpo').value.trim();
              var aud = el.querySelector('#cs-nt-aud').value;
              if (!titulo || !cuerpo) { api.toast('Escribe el título y el mensaje.', 'warning'); return; }
              var persona = null;
              if (aud === 'persona') { var partes = el.querySelector('#cs-nt-persona').value.split('|'); var idp = partes[0].split(':'); persona = { tipo: idp[0], id: idp.slice(1).join(':'), nombre: partes.slice(1).join('|') }; }
              try {
                if (el.querySelector('#cs-nt-prog').checked) {
                  var fecha = el.querySelector('#cs-nt-fecha').value;
                  if (!fecha) { api.toast('Elige la fecha y hora del envío programado.', 'warning'); return; }
                  await registrarLog(titulo, cuerpo, aud === 'persona' ? 'persona' : aud, persona ? persona.nombre : null, 'programada', new Date(fecha).toISOString());
                  api.toast('Notificación programada ✅ Se enviará cuando el panel esté abierto a esa hora.', 'success'); api.refreshBadges();
                } else {
                  await enviarAhora(titulo, cuerpo, aud, persona);
                  api.toast('Notificación enviada ✅', 'success');
                }
                if (api.openSection) api.openSection('notificaciones');
              } catch (e) { api.toast('No se pudo completar el envío.', 'error'); ev.currentTarget.insertAdjacentHTML('afterend', detalles(e)); }
            });
          });
        } catch (e) { el.innerHTML = errBox(api, e, 'No se pudo cargar la sección de notificaciones.'); }
      }
    });
  }

  /* ================================================================
     9. USUARIOS
     ================================================================ */
  var AREAS_PERMISOS = ['citas', 'calendario', 'clientes', 'servicios', 'pagos', 'reportes', 'notificaciones', 'configuracion'];
  function registrarUsuarios() {
    REG.register({
      id: 'usuarios', title: 'Usuarios', icon: 'users', color: '#81c784',
      badge: async function (api) {
        try { var r = await api.select('profiles', { columns: 'id', eq: [['estado', 'bloqueado']], limit: 200 }); return { count: r.length, level: r.length > 0 ? 'warn' : null }; }
        catch (e) { return { count: 0, level: null }; }
      },
      render: async function (el, api) {
        cargando(el);
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        try {
          var q0 = ''; try { q0 = api.takeSectionQuery('usuarios') || ''; } catch (e) {}
          var profiles = await api.select('profiles', { order: 'created_at', ascending: false, limit: 300 });
          var barberos = await api.select('barbers', { limit: 100 });
          var barberPorId = {}; barberos.forEach(function (b) { barberPorId[b.id] = b; });
          el.innerHTML = '<h3>👥 Usuarios</h3>' +
            '<input type="search" id="cs-us-q" placeholder="Buscar por nombre o correo…" style="width:100%" value="' + E(q0) + '">' +
            '<div id="cs-us-list" style="margin-top:10px"></div><div id="cs-us-modal"></div>';
          function pintar() {
            var q = normalizarTexto(el.querySelector('#cs-us-q').value);
            var rows = profiles.filter(function (p) { return !q || normalizarTexto((p.nombre || '') + ' ' + (p.email || '')).indexOf(q) !== -1; });
            el.querySelector('#cs-us-list').innerHTML = rows.length ? rows.map(function (p) {
              var b = p.barber_id ? barberPorId[p.barber_id] : null;
              return '<div class="cs-us-row" style="padding:10px;border-bottom:1px solid #26262b">' +
                '<strong>' + E(p.nombre || '(sin nombre)') + '</strong> · ' + E(p.email) + '<br>' +
                '<small>Rol: ' + E(p.role) + ' · Estado: ' + E(p.estado) + (b ? ' · 💈 ' + E(b.name) : '') + '</small>' +
                '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="cs-btn" data-us-ver="' + E(p.id) + '">Ver perfil</button>' +
                (p.estado === 'activo' ? '<button class="cs-btn" data-us-estado="bloqueado|' + E(p.id) + '">Desactivar</button>' : '<button class="cs-btn" data-us-estado="activo|' + E(p.id) + '">Activar</button>') +
                '<button class="cs-btn" data-us-cancel="' + E(p.id) + '">Cancelar cuenta</button>' +
                (p.barber_id ? '<button class="cs-btn" data-us-perms="' + E(p.id) + '">Permisos por área</button>' : '') +
                ((p.role === 'admin' || p.role === 'barbero') ? '<button class="cs-btn" data-us-support="' + E(p.id) + '">Entrar como este admin</button>' : '') +
                '</div><div data-us-extra="' + E(p.id) + '"></div></div>';
            }).join('') : '<p>No se encontraron usuarios.</p>';
            enlazar();
          }
          function buscarP(id) { return profiles.filter(function (x) { return String(x.id) === String(id); })[0]; }
          function extra(id) { return el.querySelector('[data-us-extra="' + id + '"]'); }
          function enlazar() {
            el.querySelectorAll('[data-us-ver]').forEach(function (b) { b.addEventListener('click', function () {
              var p = buscarP(b.getAttribute('data-us-ver')); if (!p) return;
              var bb = p.barber_id ? barberPorId[p.barber_id] : null;
              extra(p.id).innerHTML = '<div style="background:#101012;padding:10px;margin-top:6px;border:1px solid #26262b">' +
                Object.keys(p).map(function (k) { return '<div><small><strong>' + E(k) + ':</strong> ' + E(typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k])) + '</small></div>'; }).join('') +
                (bb ? '<div><small><strong>Barbero:</strong> ' + E(bb.name) + ' · ' + E(bb.email || '') + ' · ' + E(bb.phone || '') + '</small></div>' : '') +
                '<div><small>Último acceso: ' + (p.ultimo_login_at ? api.fmtFechaHora(p.ultimo_login_at) : 'nunca registrado') + '</small></div></div>';
            }); });
            el.querySelectorAll('[data-us-estado]').forEach(function (b) { b.addEventListener('click', async function () {
              var partes = b.getAttribute('data-us-estado').split('|'); var estado = partes[0], id = partes.slice(1).join('|');
              var p = buscarP(id);
              var ok = await api.confirm({ title: estado === 'activo' ? 'Activar cuenta' : 'Desactivar cuenta', body: '¿Seguro que quieres poner la cuenta de ' + (p ? p.email : id) + ' como “' + estado + '”?', confirmText: estado === 'activo' ? 'Activar' : 'Desactivar', danger: estado !== 'activo' });
              if (!ok) return;
              await conCarga(b, async function () {
                try { await api.rpc('set_account_status', { p_user_id: id, p_estado: estado, p_motivo: null, p_suspendido_hasta: null }); await api.audit('user.status', { user_id: id, estado: estado }); api.toast('Cuenta actualizada ✅', 'success'); if (p) p.estado = estado; pintar(); api.refreshBadges(); }
                catch (e) { api.toast('No se pudo cambiar el estado.', 'error'); b.insertAdjacentHTML('afterend', detalles(e)); }
              });
            }); });
            el.querySelectorAll('[data-us-cancel]').forEach(function (b) { b.addEventListener('click', async function () {
              var id = b.getAttribute('data-us-cancel'); var p = buscarP(id);
              var ok1 = await api.confirm({ title: 'Cancelar cuenta', body: 'Vas a cancelar la cuenta de ' + (p ? p.email : id) + '. Esta acción es seria.', confirmText: 'Continuar', danger: true });
              if (!ok1) return;
              var modal = el.querySelector('#cs-us-modal');
              modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999"><div style="background:#161618;color:#f4f1ea;padding:20px;border-radius:10px;max-width:420px;width:92%">' +
                '<h3 style="margin-top:0">✍️ Confirmación final</h3><p>Escribe <strong>CANCELAR</strong> para confirmar y el motivo (obligatorio):</p>' +
                '<input id="cs-cancel-word" placeholder="CANCELAR" style="width:100%;margin-bottom:8px">' +
                '<input id="cs-cancel-motivo" placeholder="Motivo (obligatorio)" style="width:100%;margin-bottom:12px">' +
                '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="cs-btn" id="cs-cancel-no">Volver</button><button class="cs-btn" id="cs-cancel-si" style="background:#c62828;color:#fff">Cancelar cuenta</button></div></div></div>';
              modal.querySelector('#cs-cancel-no').addEventListener('click', function () { modal.innerHTML = ''; });
              modal.querySelector('#cs-cancel-si').addEventListener('click', async function () {
                var palabra = modal.querySelector('#cs-cancel-word').value.trim(), motivo = modal.querySelector('#cs-cancel-motivo').value.trim();
                if (palabra !== 'CANCELAR') { api.toast('Debes escribir CANCELAR exactamente.', 'warning'); return; }
                if (!motivo) { api.toast('El motivo es obligatorio.', 'warning'); return; }
                try { await api.rpc('set_account_status', { p_user_id: id, p_estado: 'cancelado', p_motivo: motivo, p_suspendido_hasta: null }); await api.audit('user.cancel', { user_id: id, motivo: motivo }); api.toast('Cuenta cancelada.', 'info'); modal.innerHTML = ''; if (p) p.estado = 'cancelado'; pintar(); }
                catch (e) { api.toast('No se pudo cancelar la cuenta.', 'error'); }
              });
            }); });
            el.querySelectorAll('[data-us-perms]').forEach(function (b) { b.addEventListener('click', async function () {
              var p = buscarP(b.getAttribute('data-us-perms')); if (!p || !p.barber_id) return;
              var box = extra(p.id); box.innerHTML = '<p>Cargando permisos…</p>';
              try {
                var perms = await api.select('area_permissions', { eq: [['barber_id', p.barber_id]], limit: 100 });
                var mapa = {}; perms.forEach(function (x) { mapa[x.area] = !!x.permitido; });
                box.innerHTML = '<div style="background:#101012;padding:10px;margin-top:6px"><strong>Permisos por área de ' + E(p.nombre || p.email) + '</strong>' +
                  AREAS_PERMISOS.map(function (a) { return '<label style="display:flex;justify-content:space-between;padding:6px;border-bottom:1px solid #26262b"><span>' + E(a) + '</span><input type="checkbox" data-perm-area="' + E(a) + '" ' + (mapa[a] ? 'checked' : '') + '></label>'; }).join('') + '</div>';
                box.querySelectorAll('[data-perm-area]').forEach(function (sw) { sw.addEventListener('change', async function () {
                  try { await api.rpc('set_area_permission', { p_barber_id: p.barber_id, p_area: sw.getAttribute('data-perm-area'), p_permitido: sw.checked }); api.toast('Permiso actualizado ✅', 'success'); }
                  catch (e) { sw.checked = !sw.checked; api.toast('No se pudo guardar el permiso.', 'error'); }
                }); });
              } catch (e) { box.innerHTML = errBox(api, e, 'No se pudieron cargar los permisos.'); }
            }); });
            el.querySelectorAll('[data-us-support]').forEach(function (b) { b.addEventListener('click', async function () {
              var p = buscarP(b.getAttribute('data-us-support')); if (!p) return;
              await api.audit('support.view', { email: p.email });
              var modal = el.querySelector('#cs-us-modal'); modal.innerHTML = '<p>Cargando vista de soporte…</p>';
              try {
                var citas = p.barber_id ? await api.select('appointments', { eq: [['barber_id', p.barber_id]], order: 'created_at', ascending: false, limit: 30 }) : [];
                var notifs = p.barber_id ? await api.select('notifications', { eq: [['barber_id', p.barber_id]], order: 'created_at', ascending: false, limit: 30 }) : [];
                modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.55);overflow:auto;z-index:9999"><div style="background:#161618;color:#f4f1ea;max-width:720px;margin:24px auto;border-radius:10px;overflow:hidden">' +
                  '<div style="background:#c62828;color:#fff;padding:12px 16px"><strong>Modo soporte — estás viendo como ' + E(p.nombre || p.email) + ' (solo lectura)</strong><br><small>Esto NO es la sesión real de esta persona: es una vista de solo lectura para ayudarle.</small></div>' +
                  '<div style="padding:16px"><h4>📅 Sus citas</h4>' + (citas.length ? citas.map(function (c) { return '<div style="padding:6px;border-bottom:1px solid #26262b">' + E(c.client_name || '') + ' · ' + E(c.service || '') + ' · ' + E(c.status || '') + ' · ' + (c.date_time ? api.fmtFechaHora(c.date_time) : '') + '</div>'; }).join('') : '<p>Sin citas.</p>') +
                  '<h4>🔔 Sus notificaciones</h4>' + (notifs.length ? notifs.map(function (n) { return '<div style="padding:6px;border-bottom:1px solid #26262b"><strong>' + E(n.title) + '</strong><br><small>' + E(n.body) + ' · ' + api.fmtFechaHora(n.created_at) + '</small></div>'; }).join('') : '<p>Sin notificaciones.</p>') +
                  '<button class="cs-btn" id="cs-support-close" style="margin-top:12px">Cerrar vista de soporte</button></div></div></div>';
                modal.querySelector('#cs-support-close').addEventListener('click', function () { modal.innerHTML = ''; });
              } catch (e) { modal.innerHTML = errBox(api, e, 'No se pudo abrir la vista de soporte.'); }
            }); });
          }
          el.querySelector('#cs-us-q').addEventListener('input', pintar);
          pintar();
        } catch (e) { el.innerHTML = errBox(api, e, 'No se pudo cargar la lista de usuarios.'); }
      }
    });
  }

  /* ================================================================
     10. MANTENIMIENTO
     ================================================================ */
  var AREAS_MANT = ['global', 'reservas', 'pagos', 'avisos', 'panel', 'clientes'];
  function registrarMantenimiento() {
    REG.register({
      id: 'mantenimiento', title: 'Mantenimiento', icon: 'wrench', color: '#ffb74d',
      badge: async function (api) {
        try { var r = await api.select('maintenance', { columns: 'area', eq: [['activa', true]], limit: 50 }); return { count: r.length, level: r.length > 0 ? 'warn' : null }; }
        catch (e) { return { count: 0, level: null }; }
      },
      render: async function (el, api) {
        cargando(el);
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        try {
          var rows = await api.select('maintenance', { limit: 50 });
          var porArea = {}; rows.forEach(function (r) { porArea[r.area] = r; });
          var areas = AREAS_MANT.slice();
          rows.forEach(function (r) { if (areas.indexOf(r.area) === -1) areas.push(r.area); });
          var activas = areas.filter(function (a) { return porArea[a] && porArea[a].activa; });
          el.innerHTML = '<h3>🛠️ Mantenimiento</h3>' +
            '<p style="font-size:16px">Ahora en mantenimiento: <strong>' + (activas.length ? E(activas.join(', ')) : 'Ningún área en mantenimiento') + '</strong></p>' +
            areas.map(function (a) {
              var r = porArea[a] || { area: a, activa: false, mensaje: '', termina_at: null };
              var terminaVal = r.termina_at ? new Date(r.termina_at).toISOString().slice(0, 16) : '';
              return '<div class="cs-mant-row" data-area="' + E(a) + '" style="padding:12px;border-bottom:1px solid #26262b">' +
                '<label style="display:flex;justify-content:space-between;align-items:center"><strong>' + E(a) + '</strong><input type="checkbox" data-mant-activa ' + (r.activa ? 'checked' : '') + '></label>' +
                '<div style="display:grid;gap:6px;margin-top:8px"><input data-mant-mensaje placeholder="Mensaje para los usuarios…" value="' + E(r.mensaje || '') + '">' +
                '<label>Termina: <input type="datetime-local" data-mant-termina value="' + terminaVal + '"></label>' +
                '<button class="cs-btn" data-mant-save>Guardar</button></div></div>';
            }).join('');
          el.querySelectorAll('[data-mant-save]').forEach(function (b) { b.addEventListener('click', function () {
            var row = b.closest('[data-area]'); var area = row.getAttribute('data-area');
            conCarga(b, async function () {
              try {
                var termina = row.querySelector('[data-mant-termina]').value;
                await api.rpc('set_maintenance', { p_area: area, p_activa: row.querySelector('[data-mant-activa]').checked, p_mensaje: row.querySelector('[data-mant-mensaje]').value, p_inicia_at: null, p_termina_at: termina ? new Date(termina).toISOString() : null });
                api.toast('Mantenimiento de “' + area + '” guardado ✅', 'success'); api.refreshBadges(); if (api.openSection) api.openSection('mantenimiento');
              } catch (e) { api.toast('No se pudo guardar.', 'error'); b.insertAdjacentHTML('afterend', detalles(e)); }
            });
          }); });
        } catch (e) { el.innerHTML = errBox(api, e, 'No se pudo cargar el mantenimiento.'); }
      }
    });
  }

  /* ================================================================
     11. ERRORES
     ================================================================ */
  function registrarErrores() {
    REG.register({
      id: 'errores', title: 'Errores', icon: 'bug', color: '#e57373',
      badge: async function (api) {
        try { var r = await api.select('error_logs', { columns: 'id', eq: [['resuelto', false]], limit: 200 }); return { count: r.length, level: r.length > 0 ? 'error' : null }; }
        catch (e) { return { count: 0, level: null }; }
      },
      render: async function (el, api) {
        cargando(el);
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        try {
          var todos = await api.select('error_logs', { order: 'created_at', ascending: false, limit: 200 });
          el.innerHTML = '<h3>🐞 Registro de errores</h3>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><input type="date" id="cs-err-desde"><input type="search" id="cs-err-q" placeholder="Buscar en mensaje o usuario…"><button class="cs-btn" id="cs-err-filtrar">Filtrar</button></div>' +
            '<div id="cs-err-list" style="margin-top:10px"></div>';
          function pintar(rows) {
            el.querySelector('#cs-err-list').innerHTML = rows.length ? rows.map(function (r) {
              return '<div class="cs-err-row" style="padding:10px;border-bottom:1px solid #26262b;opacity:' + (r.resuelto ? '.55' : '1') + '">' +
                '<small>' + api.fmtFechaHora(r.created_at) + '</small> · 👤 ' + E(r.usuario || '—') + ' · 📄 ' + E(r.pagina || '—') + '<br>' +
                '<strong>' + E(r.mensaje) + '</strong>' + (r.stack ? detalles({ message: r.stack }) : '') + '<br>' +
                '<button class="cs-btn" data-err-toggle="' + E(r.id) + '" data-resuelto="' + (r.resuelto ? '1' : '0') + '">' + (r.resuelto ? 'Reabrir' : 'Marcar como resuelto') + '</button></div>';
            }).join('') : '<p>No hay errores con esos filtros. 🎉</p>';
            el.querySelectorAll('[data-err-toggle]').forEach(function (b) { b.addEventListener('click', async function () {
              var nuevo = b.getAttribute('data-resuelto') !== '1';
              await conCarga(b, async function () {
                try { await api.update('error_logs', { resuelto: nuevo }, [['id', b.getAttribute('data-err-toggle')]]); var fila = todos.filter(function (x) { return String(x.id) === b.getAttribute('data-err-toggle'); })[0]; if (fila) fila.resuelto = nuevo; api.toast(nuevo ? 'Error marcado como resuelto ✅' : 'Error reabierto.', 'success'); api.refreshBadges(); aplicar(); }
                catch (e) { api.toast('No se pudo actualizar.', 'error'); }
              });
            }); });
          }
          function aplicar() {
            var desde = el.querySelector('#cs-err-desde').value, q = normalizarTexto(el.querySelector('#cs-err-q').value);
            var rows = todos.filter(function (r) {
              if (desde && new Date(r.created_at) < new Date(desde + 'T00:00:00')) return false;
              if (q && normalizarTexto((r.mensaje || '') + ' ' + (r.usuario || '')).indexOf(q) === -1) return false;
              return true;
            });
            pintar(rows);
          }
          el.querySelector('#cs-err-filtrar').addEventListener('click', aplicar);
          pintar(todos);
        } catch (e) { el.innerHTML = errBox(api, e, 'No se pudo cargar el registro de errores.'); }
      }
    });
  }

  /* ================================================================
     12. HERRAMIENTAS
     ================================================================ */
  var TABLAS_EXPORT = ['clients', 'appointments', 'notifications', 'profiles', 'tickets', 'error_logs', 'audit_log', 'login_attempts', 'barbers', 'services', 'reviews'];
  function registrarHerramientas() {
    REG.register({
      id: 'herramientas', title: 'Herramientas', icon: 'hammer', color: '#a1887f',
      render: function (el, api) {
        el.innerHTML = '<h3>🧰 Herramientas</h3>' +
          '<div style="display:grid;gap:10px;max-width:560px">' +
          '<button class="cs-btn" id="cs-h-cache">🧹 Limpiar caché de la aplicación</button>' +
          '<button class="cs-btn" id="cs-h-update">⬆️ Forzar actualización</button>' +
          '<button class="cs-btn" id="cs-h-version">🔢 Ver versión instalada</button>' +
          '<div id="cs-h-version-out"></div>' +
          '<button class="cs-btn" id="cs-h-notif">🔔 Probar notificación en este dispositivo</button>' +
          '<p><small>La prueba de notificación es local: solo se ve en este dispositivo.</small></p>' +
          '<button class="cs-btn" id="cs-h-export">💾 Exportar respaldo (JSON)</button>' +
          '<div id="cs-h-export-out"></div></div>';
        el.querySelector('#cs-h-cache').addEventListener('click', function (ev) {
          conCarga(ev.currentTarget, async function () {
            try { if (typeof caches !== 'undefined') { var ks = await caches.keys(); await Promise.all(ks.map(function (k) { return caches.delete(k); })); } api.toast('Caché limpiada ✅', 'success'); await api.audit('tools.clear_cache', {}); }
            catch (e) { api.toast('No se pudo limpiar la caché.', 'error'); }
          });
        });
        el.querySelector('#cs-h-update').addEventListener('click', async function () {
          try { if ('serviceWorker' in navigator) { var reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } } catch (e) {}
          location.reload();
        });
        el.querySelector('#cs-h-version').addEventListener('click', function (ev) {
          conCarga(ev.currentTarget, async function () {
            var out = el.querySelector('#cs-h-version-out');
            try { var r = await fetch('sw.js', { cache: 'no-store' }); var txt = await r.text(); var m = txt.match(/goat-style-v(\d+)/); out.innerHTML = '<p>Versión instalada: <strong>' + (m ? 'goat-style-v' + m[1] : 'No detectada') + '</strong></p>'; }
            catch (e) { out.innerHTML = errBox(api, e, 'No se pudo leer la versión.'); }
          });
        });
        el.querySelector('#cs-h-notif').addEventListener('click', async function () {
          try {
            if (typeof Notification === 'undefined') { api.toast('Este navegador no soporta notificaciones.', 'warning'); return; }
            var perm = Notification.permission;
            if (perm !== 'granted') perm = await Notification.requestPermission();
            if (perm !== 'granted') { api.toast('No se dio permiso de notificaciones.', 'warning'); return; }
            var reg = ('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistration() : null;
            if (reg && reg.showNotification) await reg.showNotification('GOAT Style Salon', { body: 'Notificación de prueba del Centro de Soporte' });
            else new Notification('GOAT Style Salon', { body: 'Notificación de prueba del Centro de Soporte' });
            api.toast('Prueba enviada a este dispositivo ✅', 'success');
          } catch (e) { api.toast('La prueba falló.', 'error'); }
        });
        el.querySelector('#cs-h-export').addEventListener('click', function (ev) {
          conCarga(ev.currentTarget, async function () {
            var out = el.querySelector('#cs-h-export-out'); var respaldo = {}; var fallos = [];
            for (var i = 0; i < TABLAS_EXPORT.length; i++) {
              try { respaldo[TABLAS_EXPORT[i]] = await api.rpc('export_data', { p_table: TABLAS_EXPORT[i] }); }
              catch (e) { fallos.push(TABLAS_EXPORT[i]); }
            }
            descargar('respaldo-goat-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(respaldo, null, 2), 'application/json');
            out.innerHTML = '<p>Respaldo descargado con ' + Object.keys(respaldo).length + ' tablas.' + (fallos.length ? ' No se pudieron exportar: ' + fallos.join(', ') + '.' : '') + '</p>';
            await api.audit('tools.export', { tablas: Object.keys(respaldo) });
          });
        });
      }
    });
  }

  /* ================================================================
     13. LEGAL
     ================================================================ */
  function registrarLegal() {
    REG.register({
      id: 'legal', title: 'Términos y políticas', icon: 'scale', color: '#dce775',
      badge: async function (api) {
        try { var s = await api.select('legal_settings', { eq: [['id', 1]], limit: 1 }); return { count: 0, level: s.length && s[0].require_reaccept ? 'warn' : null }; }
        catch (e) { return { count: 0, level: null }; }
      },
      render: async function (el, api) {
        cargando(el);
        var E = function (s) { return api.esc ? api.esc(s) : escLocal(s); };
        try {
          var docs = await api.select('legal_documents', { order: 'titulo', ascending: true, limit: 100 });
          var settings = await api.select('legal_settings', { eq: [['id', 1]], limit: 1 });
          var acept = await api.select('legal_acceptances', { order: 'created_at', ascending: false, limit: 20 });
          var requireReaccept = settings.length ? !!settings[0].require_reaccept : false;
          el.innerHTML = '<h3>⚖️ Términos y políticas</h3>' +
            '<label style="display:flex;gap:8px;align-items:flex-start;background:rgba(212,175,55,.10);padding:12px;border-radius:8px"><input type="checkbox" id="cs-legal-reaccept" ' + (requireReaccept ? 'checked' : '') + '><span><strong>Exigir que todos acepten de nuevo</strong><br><small>Si está activo, todos los usuarios tendrán que aceptar los documentos de nuevo la próxima vez que entren.</small></span></label>' +
            '<h4>📄 Documentos</h4>' + (docs.length ? docs.map(function (d) {
              return '<div class="cs-legal-row" style="padding:10px;border-bottom:1px solid #26262b"><strong>' + E(d.titulo) + '</strong> <small>(' + E(d.slug) + ')</small><br><small>Versión ' + d.version + ' · Actualizado: ' + api.fmtFechaHora(d.updated_at) + '</small> <button class="cs-btn" data-legal-edit="' + E(d.slug) + '">Editar</button><div data-legal-editor="' + E(d.slug) + '"></div></div>';
            }).join('') : '<p>No hay documentos legales todavía.</p>') +
            '<h4>✍️ Aceptaciones recientes</h4>' + (acept.length ? acept.map(function (a) {
              return '<div style="padding:6px;border-bottom:1px solid #26262b"><small>Versión ' + E(a.version) + ' · ' + api.fmtFechaHora(a.created_at) + ' · ' + E(String(a.user_agent || '').slice(0, 60)) + '</small></div>';
            }).join('') : '<p>Sin aceptaciones registradas.</p>');
          var sw = el.querySelector('#cs-legal-reaccept');
          if (sw) sw.addEventListener('change', async function () {
            try { await api.update('legal_settings', { require_reaccept: sw.checked, updated_at: new Date().toISOString() }, [['id', 1]]); await api.audit('legal.require_reaccept', { activo: sw.checked }); api.toast(sw.checked ? 'Se exigirá aceptar de nuevo ✅' : 'Ya no se exigirá aceptar de nuevo.', 'success'); api.refreshBadges(); }
            catch (e) { sw.checked = !sw.checked; api.toast('No se pudo guardar el ajuste.', 'error'); }
          });
          el.querySelectorAll('[data-legal-edit]').forEach(function (b) { b.addEventListener('click', function () {
            var slug = b.getAttribute('data-legal-edit');
            var doc = docs.filter(function (x) { return x.slug === slug; })[0]; if (!doc) return;
            var box = el.querySelector('[data-legal-editor="' + slug + '"]');
            box.innerHTML = '<div style="display:grid;gap:8px;margin-top:8px"><input data-legal-titulo value="' + E(doc.titulo) + '">' +
              '<textarea data-legal-contenido rows="14" style="width:100%">' + E(doc.contenido || '') + '</textarea>' +
              '<button class="cs-btn" data-legal-save style="font-weight:bold">Guardar y publicar nueva versión</button></div>';
            box.querySelector('[data-legal-save]').addEventListener('click', function (ev) {
              conCarga(ev.currentTarget, async function () {
                var nuevaVersion = (doc.version || 1) + 1;
                try {
                  await api.update('legal_documents', { titulo: box.querySelector('[data-legal-titulo]').value, contenido: box.querySelector('[data-legal-contenido]').value, version: nuevaVersion, updated_at: new Date().toISOString(), updated_by: sesionId(api) }, [['slug', slug]]);
                  await api.audit('legal.publish', { slug: slug, version: nuevaVersion });
                  api.toast('Versión ' + nuevaVersion + ' publicada ✅', 'success'); if (api.openSection) api.openSection('legal');
                } catch (e) { api.toast('No se pudo guardar el documento.', 'error'); ev.currentTarget.insertAdjacentHTML('afterend', detalles(e)); }
              });
            });
          }); });
        } catch (e) { el.innerHTML = errBox(api, e, 'No se pudo cargar la sección legal.'); }
      }
    });
  }

  /* ================= Registro de las 13 secciones ================= */
  registrarSeguridad(); registrarInternet(); registrarVelocidad(); registrarDiagnostico();
  registrarSincronizacion(); registrarMemos(); registrarBuscarMemos(); registrarNotificaciones();
  registrarUsuarios(); registrarMantenimiento(); registrarErrores(); registrarHerramientas(); registrarLegal();
})();
