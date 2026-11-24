(function () {
    // =========================================================================
    // Panel privado del administrador de programacion (Angel).
    // - Acceso con clave propia (hash PBKDF2). En el primer acceso se exige crear una clave nueva.
    // - Con Supabase: acceso con cuenta de Auth marcada como desarrollador (staff_roles.is_developer).
    // - Mantenimiento total o por secciones, cuentas del personal bloqueadas, pruebas y respaldo.
    // =========================================================================
    const Data = window.GabyData;
    const Security = window.GabySecurity;
    const cloud = () => Boolean(window.GabyCloud && window.GabyCloud.enabled);
    const SESSION_KEY = 'gs_dev_session';
    const SESSION_MINUTES = 30;
    const THROTTLE_KEY = 'gs_dev_throttle';

    // Clave inicial (solo el hash). En el primer acceso se reemplaza por una clave personal.
    const DEV_SEED = { algo: 'PBKDF2-SHA256', iterations: 600000, salt: '+4INSAanQ5GAD8tqHeN1gg==', hash: 'P1k4qt0M4KjrIdiaNyRv82hcC2dNn6dHiDLo9bSKVdc=' };

    const $ = id => document.getElementById(id);
    const toast = (message, type) => Data.toast(message, type);
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const fmt = value => value ? new Date(value).toLocaleString('es-PR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    let currentTab = 'summary';
    let knownLockIds = null;

    // ---------------------------------------------------------------------
    // Sesion
    // ---------------------------------------------------------------------
    function sessionActive() {
        try {
            const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
            return Boolean(session && session.exp > Date.now());
        } catch (error) {
            return false;
        }
    }

    function touchSession() {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ exp: Date.now() + SESSION_MINUTES * 60000 }));
    }

    function endSession() {
        localStorage.removeItem(SESSION_KEY);
    }

    // 5 claves incorrectas => 15 minutos de espera (no se bloquea la cuenta para no dejarte fuera).
    function throttleState() {
        try { return JSON.parse(localStorage.getItem(THROTTLE_KEY) || '{"count":0,"until":0}'); } catch (error) { return { count: 0, until: 0 }; }
    }

    function devRecord() {
        return Data.getState().security.devAuth || null;
    }

    function show(view) {
        ['login-view', 'setup-view', 'app-view'].forEach(id => $(id).classList.toggle('hidden', id !== view));
    }

    async function handleLogin(event) {
        event.preventDefault();
        const error = $('login-error');
        error.textContent = '';
        const throttle = throttleState();
        if (throttle.until > Date.now()) {
            error.textContent = `Demasiados intentos. Espera ${Math.ceil((throttle.until - Date.now()) / 60000)} minuto(s).`;
            return;
        }
        const password = $('dev-password').value;
        const button = event.target.querySelector('button');
        button.disabled = true;
        let ok = false;
        try {
            if (cloud()) {
                const client = await window.GabyCloud.getClient();
                const { error: authError } = await client.auth.signInWithPassword({ email: $('dev-email').value.trim(), password });
                if (!authError) {
                    const { data } = await client.rpc('is_developer');
                    ok = data === true;
                    if (!ok) await client.auth.signOut();
                }
            } else {
                ok = await Security.verifyPassword(password, (devRecord() || {}).passwordHash || DEV_SEED);
            }
        } catch (err) {
            ok = false;
        }
        button.disabled = false;
        if (!ok) {
            const next = { count: throttle.count + 1, until: 0 };
            if (next.count >= 5) next.until = Date.now() + 15 * 60000;
            localStorage.setItem(THROTTLE_KEY, JSON.stringify(next.count >= 5 ? { count: 0, until: next.until } : next));
            error.textContent = 'Clave incorrecta.';
            return;
        }
        localStorage.removeItem(THROTTLE_KEY);
        $('dev-password').value = '';
        if (!cloud() && !devRecord()) {
            show('setup-view');
            setupPolicy.update();
            $('setup-password').focus();
            return;
        }
        touchSession();
        openApp();
    }

    let setupPolicy = null;
    async function handleSetup(event) {
        event.preventDefault();
        const errors = setupPolicy.errors();
        if (errors.length) {
            $('setup-error').textContent = errors[0];
            return;
        }
        const passwordHash = await Security.hashPassword($('setup-password').value);
        const ok = await Data.commit(state => {
            state.security.devAuth = { passwordHash, updatedAt: new Date().toISOString() };
        }, { success: 'Clave personal guardada.', error: 'No se pudo guardar la clave.' });
        if (!ok) return;
        $('setup-form').reset();
        touchSession();
        openApp();
    }

    // ---------------------------------------------------------------------
    // App
    // ---------------------------------------------------------------------
    function openApp() {
        show('app-view');
        knownLockIds = new Set(pendingLocks().map(lock => lock.id));
        render();
    }

    function pendingLocks() {
        return (Data.getState().security.locks || []).filter(lock => lock.status === 'BLOQUEADA');
    }

    function render() {
        if (!sessionActive()) {
            show('login-view');
            return;
        }
        document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === currentTab));
        const pending = pendingLocks().length;
        $('lock-badge').textContent = String(pending);
        $('lock-badge').classList.toggle('hidden', pending === 0);
        document.title = pending ? `(${pending}) Acceso` : 'Acceso';
        const views = { summary: renderSummary, security: renderSecurity, maintenance: renderMaintenance, tests: renderTests, system: renderSystem };
        views[currentTab]();
    }

    function renderSummary() {
        const state = Data.getState();
        const m = state.settings.maintenance;
        const sectionsOn = Object.entries(m.sections || {}).filter(([, on]) => on).map(([key]) => key);
        const pending = pendingLocks();
        $('content').innerHTML = `
            <div class="head"><div><h1>Resumen</h1><p>Estado general de la plataforma.</p></div></div>
            <div class="grid">
                <div class="card stat"><strong>${pending.length}</strong><span>Cuentas bloqueadas pendientes</span></div>
                <div class="card stat"><strong>${m.enabled ? 'Activo' : (sectionsOn.length ? `${sectionsOn.length} secc.` : 'No')}</strong><span>Mantenimiento</span></div>
                <div class="card stat"><strong>${state.clients.length}</strong><span>Fichas de clientes</span></div>
                <div class="card stat"><strong>${state.appointments.length}</strong><span>Citas guardadas</span></div>
            </div>
            ${pending.length ? `<div class="card"><h3><i class="fas fa-triangle-exclamation"></i> Requiere tu atención</h3><p class="muted">Hay ${pending.length} cuenta(s) bloqueada(s) por intentos fallidos esperando verificación.</p><div class="row"><button class="btn" data-go="security">Revisar cuentas</button></div></div>` : ''}
            <div class="card">
                <h3><i class="fas fa-database"></i> Modo de datos</h3>
                <p class="muted">${cloud() ? 'Conectado a Supabase: los cambios se guardan en el servidor.' : 'Sin servidor: los datos y la configuración viven en el navegador de cada dispositivo. El mantenimiento y los bloqueos que configures aquí solo afectan este navegador hasta que conectes Supabase (ver docs/supabase-setup.md).'}</p>
            </div>
        `;
        document.querySelector('[data-go]')?.addEventListener('click', () => { currentTab = 'security'; render(); });
    }

    // ---------------------------------------------------------------------
    // Cuentas del personal bloqueadas
    // ---------------------------------------------------------------------
    function deviceFrom(ua) {
        if (!ua) return 'Desconocido';
        const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Otro';
        const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Navegador';
        return `${browser} en ${os}`;
    }

    function lockDetails(lock) {
        const state = Data.getState();
        const account = Security.STAFF_ACCOUNTS.find(item => item.email === lock.email) || {};
        // Con Supabase el nombre y teléfono del barbero llegan junto al bloqueo (lock.profile).
        const barber = state.barbers.find(item => item.id === (account.barberId || lock.profile?.barberId)) || lock.profile || {};
        return {
            title: `${barber.name || lock.email}${barber.alias ? ` (${barber.alias})` : ''}`,
            kind: account.isAdmin ? 'Personal · Administrador' : 'Personal · Barbero',
            phone: barber.phone || '',
            rows: [
                ['Correo', lock.email], ['Teléfono', barber.phone || '—'], ['Rol', account.isAdmin ? 'Administrador general' : 'Barbero'],
                ['Horario', barber.schedule || '—']
            ]
        };
    }
    function contactLinks(lock, details) {
        const digits = String(details.phone || '').replace(/\D/g, '');
        const phone = digits.length === 10 ? `1${digits}` : digits;
        const message = encodeURIComponent(`Hola ${details.title}, te escribimos de la barbería. Tu cuenta se bloqueó por seguridad después de varios intentos fallidos de inicio de sesión. ¿Fuiste tú quien intentó entrar? Responde para verificar tu identidad y ayudarte a recuperar el acceso.`);
        return `
            ${phone ? `<a class="btn ghost" href="tel:+${phone}"><i class="fas fa-phone"></i> Llamar</a>` : ''}
            ${phone ? `<a class="btn ghost" href="https://wa.me/${phone}?text=${message}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ''}
            <a class="btn ghost" href="mailto:${encodeURIComponent(lock.email)}?subject=${encodeURIComponent('Verificación de tu cuenta')}&body=${message}"><i class="fas fa-envelope"></i> Correo</a>
        `;
    }

    function renderLock(lock) {
        const details = lockDetails(lock);
        const resolved = lock.status !== 'BLOQUEADA';
        const statusLabel = { BLOQUEADA: 'Bloqueada · pendiente', MANTENER_BLOQUEADA: 'Se mantiene bloqueada', DESBLOQUEADA: 'Desbloqueada' }[lock.status] || lock.status;
        return `
            <article class="lock ${resolved ? 'resolved' : ''}">
                <div class="lock-head">
                    <div><strong>${escapeHtml(details.title)}</strong><div class="muted">${details.kind}</div></div>
                    <span class="status-pill ${lock.status === 'DESBLOQUEADA' ? 'off' : 'on'}">${statusLabel}</span>
                </div>
                <div class="kv">
                    ${details.rows.map(([label, value]) => `<div><small>${label}</small>${escapeHtml(value)}</div>`).join('')}
                    <div><small>Bloqueada</small>${fmt(lock.lockedAt)}</div>
                    <div><small>Intentos fallidos</small>${lock.attempts}</div>
                    <div><small>Dispositivo del intento</small>${escapeHtml(deviceFrom(lock.userAgent))}</div>
                    ${resolved ? `<div><small>Resuelto</small>${fmt(lock.resolvedAt)}</div>` : ''}
                </div>
                <p class="muted">Antes de desbloquear, comunícate con la persona para confirmar que fue ella quien intentó entrar y no un intento de fraude. Al desbloquear, deberá crear una contraseña nueva en su próximo inicio de sesión.</p>
                <div class="row">
                    ${contactLinks(lock, details)}
                    ${lock.status !== 'DESBLOQUEADA' ? `<button class="btn ok" data-unlock="${lock.id}"><i class="fas fa-lock-open"></i> Desbloquear</button>` : ''}
                    ${lock.status === 'BLOQUEADA' ? `<button class="btn danger" data-keep="${lock.id}"><i class="fas fa-lock"></i> Mantener bloqueada</button>` : ''}
                </div>
            </article>
        `;
    }

    function renderSecurity() {
        const state = Data.getState();
        const locks = state.security.locks || [];
        const pending = locks.filter(lock => lock.status === 'BLOQUEADA');
        const kept = locks.filter(lock => lock.status === 'MANTENER_BLOQUEADA');
        const history = locks.filter(lock => lock.status === 'DESBLOQUEADA').slice(0, 20);
        const attempts = Object.entries(state.security.attempts || {});
        $('content').innerHTML = `
            <div class="head">
                <div><h1>Cuentas bloqueadas</h1><p>Cuentas del personal que se bloquean automáticamente después de ${Security.LOCK_AFTER} intentos fallidos de inicio de sesión.</p></div>
                <button class="btn ghost" id="enable-notifications"><i class="fas fa-bell"></i> Avisarme en este navegador</button>
            </div>
            <div class="card"><h3><i class="fas fa-user-lock"></i> Pendientes de revisión (${pending.length})</h3>${pending.length ? pending.map(renderLock).join('') : '<p class="muted">No hay cuentas bloqueadas pendientes.</p>'}</div>
            ${kept.length ? `<div class="card"><h3><i class="fas fa-lock"></i> Se mantienen bloqueadas (${kept.length})</h3>${kept.map(renderLock).join('')}</div>` : ''}
            <div class="card"><h3><i class="fas fa-clock-rotate-left"></i> Intentos fallidos recientes</h3>
                ${attempts.length ? `<div class="table-wrap"><table><thead><tr><th>Correo</th><th>Intentos</th><th>Último intento</th></tr></thead><tbody>${attempts.map(([email, info]) => `<tr><td>${escapeHtml(email)}</td><td>${info.count}</td><td>${fmt(info.lastAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin intentos fallidos pendientes.</p>'}
            </div>
            ${history.length ? `<div class="card"><h3><i class="fas fa-list-check"></i> Historial de desbloqueos</h3>${history.map(renderLock).join('')}</div>` : ''}
        `;
        document.querySelectorAll('[data-unlock]').forEach(button => button.addEventListener('click', async () => {
            if (!window.confirm('¿Confirmas que verificaste la identidad de esta persona? Se desbloqueará y deberá crear una contraseña nueva.')) return;
            await Security.unlock(button.dataset.unlock);
            render();
        }));
        document.querySelectorAll('[data-keep]').forEach(button => button.addEventListener('click', async () => {
            await Security.keepLocked(button.dataset.keep);
            render();
        }));
        $('enable-notifications').addEventListener('click', async () => {
            if (!('Notification' in window)) return toast('Este navegador no permite notificaciones.', 'warning');
            const permission = await Notification.requestPermission();
            toast(permission === 'granted' ? 'Listo: te avisaremos aquí cuando se bloquee una cuenta mientras el panel esté abierto.' : 'No se dieron permisos de notificación.', permission === 'granted' ? 'success' : 'warning');
        });
    }

    // Aviso automatico cuando aparece un bloqueo nuevo (mientras el panel esta abierto).
    function checkNewLocks() {
        if (!knownLockIds || !sessionActive()) return;
        pendingLocks().forEach(lock => {
            if (knownLockIds.has(lock.id)) return;
            knownLockIds.add(lock.id);
            const message = `Nueva cuenta bloqueada: ${lock.email}`;
            toast(`<strong>${escapeHtml(message)}</strong>. Revisa "Cuentas bloqueadas".`, 'error');
            if ('Notification' in window && Notification.permission === 'granted') new Notification('Cuenta bloqueada', { body: message });
        });
    }

    // ---------------------------------------------------------------------
    // Mantenimiento
    // ---------------------------------------------------------------------
    function renderMaintenance() {
        const m = Data.getState().settings.maintenance;
        const labels = window.GabyGuardLabels || {
            reservas: 'Reservaciones en línea', tienda: 'Tienda de productos',
            resenas: 'Reseñas', noticias: 'Noticias', barberos: 'Perfiles y carrusel de barberos', servicios: 'Menú de servicios', soporte: 'Centro de soporte'
        };
        const etaValue = m.eta ? m.eta.slice(0, 16) : '';
        $('content').innerHTML = `
            <div class="head">
                <div><h1>Mantenimiento</h1><p>Bloquea todo el sitio o solo algunas partes.</p></div>
                <span class="status-pill ${m.enabled ? 'on' : 'off'}">${m.enabled ? 'Sitio en mantenimiento' : 'Sitio disponible'}</span>
            </div>
            <form class="card" id="maintenance-form">
                <h3><i class="fas fa-power-off"></i> Todo el sitio</h3>
                <div class="switch-row">
                    <div><strong>Poner la página completa en mantenimiento</strong><small>Los visitantes ven una pantalla completa y no pueden navegar. Tú sigues viendo el sitio normal mientras tu sesión esté activa.</small></div>
                    <label class="switch" aria-label="Mantenimiento total"><input type="checkbox" id="m-enabled" ${m.enabled ? 'checked' : ''}><span></span></label>
                </div>
                <div class="switch-row">
                    <div><strong>Permitir que el personal use sus paneles</strong><small>Si lo apagas, los paneles de los barberos también muestran la pantalla de mantenimiento.</small></div>
                    <label class="switch" aria-label="Permitir personal"><input type="checkbox" id="m-staff" ${m.allowStaff !== false ? 'checked' : ''}><span></span></label>
                </div>
                <label class="field">Título<input id="m-title" value="${escapeHtml(m.title)}" maxlength="80"></label>
                <label class="field">Mensaje para los visitantes<textarea id="m-message" maxlength="400">${escapeHtml(m.message)}</textarea></label>
                <label class="field">Regreso estimado (opcional)<input id="m-eta" type="datetime-local" value="${escapeHtml(etaValue)}"></label>

                <h3 style="margin-top: .5rem;"><i class="fas fa-layer-group"></i> Partes en mantenimiento</h3>
                <p class="muted">Solo aplican cuando el sitio completo NO está en mantenimiento. Cada parte muestra un aviso en lugar de su contenido.</p>
                ${Object.entries(labels).map(([key, label]) => `
                    <div class="switch-row">
                        <div><strong>${label}</strong></div>
                        <label class="switch" aria-label="${label}"><input type="checkbox" data-section="${key}" ${m.sections?.[key] ? 'checked' : ''}><span></span></label>
                    </div>
                `).join('')}
                <div class="row">
                    <button class="btn" type="submit"><i class="fas fa-floppy-disk"></i> Guardar cambios</button>
                    <a class="btn ghost" href="../index.html" target="_blank" rel="noopener"><i class="fas fa-eye"></i> Ver el sitio</a>
                </div>
                <p class="muted">Para ver lo mismo que un visitante, abre el sitio en una ventana privada (sin tu sesión de desarrollador).</p>
            </form>
        `;
        $('maintenance-form').addEventListener('submit', async event => {
            event.preventDefault();
            const enabled = $('m-enabled').checked;
            if (enabled && !window.confirm('¿Poner TODO el sitio en mantenimiento? Los visitantes no podrán navegar.')) return;
            const sections = {};
            document.querySelectorAll('[data-section]').forEach(input => { sections[input.dataset.section] = input.checked; });
            const eta = $('m-eta').value;
            await Data.commit(state => {
                state.settings.maintenance = {
                    enabled,
                    allowStaff: $('m-staff').checked,
                    title: $('m-title').value.trim() || 'Estamos en mantenimiento',
                    message: $('m-message').value.trim(),
                    eta: eta ? new Date(eta).toISOString() : '',
                    sections,
                    updatedAt: new Date().toISOString()
                };
            }, { success: enabled ? 'Mantenimiento total ACTIVADO.' : 'Configuración de mantenimiento guardada.', error: 'No se pudo guardar el mantenimiento.' });
            render();
        });
    }

    // ---------------------------------------------------------------------
    // Pruebas
    // ---------------------------------------------------------------------
    const TESTS = [
        { id: 'storage', name: 'Almacenamiento del navegador', run: async () => {
            const key = `gs_test_${Date.now()}`;
            localStorage.setItem(key, 'ok');
            const ok = localStorage.getItem(key) === 'ok';
            localStorage.removeItem(key);
            const size = new Blob([localStorage.getItem(Data.STORAGE_KEY) || '']).size;
            let quota = '';
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                quota = ` · uso del sitio ${(est.usage / 1024).toFixed(0)} KB`;
            }
            const kb = size / 1024;
            return { status: ok ? (kb > 3500 ? 'warn' : 'ok') : 'fail', detail: `Lectura/escritura ${ok ? 'correcta' : 'fallida'} · datos ${kb.toFixed(1)} KB (límite aprox. 5,000 KB)${quota}` };
        } },
        { id: 'integrity', name: 'Integridad de los datos', run: async () => {
            const s = Data.getState();
            const clientIds = new Set(s.clients.map(c => c.id));
            const barberIds = new Set(s.barbers.map(b => b.id));
            const issues = [];
            const orphan = s.appointments.filter(a => a.clientId && !clientIds.has(a.clientId)).length;
            const badBarber = s.appointments.filter(a => a.barber && !barberIds.has(a.barber)).length;
            const productsNoOwner = s.products.filter(p => !barberIds.has(p.barberId)).length;
            if (orphan) issues.push(`${orphan} cita(s) de clientes que ya no existen`);
            if (badBarber) issues.push(`${badBarber} cita(s) con barbero inexistente`);
            if (productsNoOwner) issues.push(`${productsNoOwner} producto(s) sin barbero válido`);
            return { status: issues.length ? 'warn' : 'ok', detail: issues.length ? issues.join(' · ') : `${s.clients.length} clientes, ${s.appointments.length} citas, ${s.barbers.length} barberos, ${s.products.length} productos: sin inconsistencias.` };
        } },
        { id: 'passwords', name: 'Protección de contraseñas del personal', run: async () => {
            const t0 = performance.now();
            await Security.hashPassword('Prueba#de-velocidad-2026');
            const ms = Math.round(performance.now() - t0);
            return { status: 'ok', detail: `Hash PBKDF2-SHA256 · cálculo de hash ${ms} ms` };
        } },
        { id: 'supabase', name: 'Conexión con Supabase', run: async () => {
            const cfg = window.GABY_SUPABASE || {};
            if (!cfg.url || !cfg.anonKey) return { status: 'warn', detail: 'No configurado (supabase-config.js vacío). El sitio funciona sin servidor.' };
            const res = await fetch(`${cfg.url}/auth/v1/health`, { headers: { apikey: cfg.anonKey } });
            return { status: res.ok ? 'ok' : 'fail', detail: `Auth respondió ${res.status}` };
        } },
        { id: 'supabase-db', name: 'Lectura de la base de datos', run: async () => {
            if (!cloud()) return { status: 'warn', detail: 'Sin Supabase configurado.' };
            const client = await window.GabyCloud.getClient();
            const { data, error } = await client.from('barbers').select('id').limit(5);
            if (error) return { status: 'fail', detail: error.message };
            return { status: 'ok', detail: `Tabla barbers: ${data.length} registro(s) leídos.` };
        } },
        { id: 'session', name: 'Sesión de Supabase', run: async () => {
            if (!cloud()) return { status: 'warn', detail: 'Sin Supabase configurado.' };
            const client = await window.GabyCloud.getClient();
            const { data } = await client.auth.getSession();
            return { status: data.session ? 'ok' : 'warn', detail: data.session ? `Sesión activa: ${data.session.user.email}` : 'Sin sesión activa.' };
        } },
        { id: 'cdn-images', name: 'Imágenes (Cloudinary)', run: () => new Promise(resolve => {
            const img = new Image();
            const timer = setTimeout(() => resolve({ status: 'fail', detail: 'Sin respuesta en 8 segundos.' }), 8000);
            img.onload = () => { clearTimeout(timer); resolve({ status: 'ok', detail: `Logo cargado (${img.naturalWidth}×${img.naturalHeight}).` }); };
            img.onerror = () => { clearTimeout(timer); resolve({ status: 'fail', detail: 'No se pudo cargar el logo.' }); };
            img.src = `https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972135/b3a13ac1-cac2-4367-9c0d-5946397d4ff9-removebg-preview_xhkncw.png?t=${Date.now()}`;
        }) },
        { id: 'cdn-assets', name: 'Íconos y tipografías (cdnjs / Google Fonts)', run: async () => {
            const results = await Promise.allSettled([
                fetch('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css', { cache: 'no-store' }),
                fetch('https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap', { cache: 'no-store' })
            ]);
            const ok = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
            return { status: ok === 2 ? 'ok' : ok ? 'warn' : 'fail', detail: `${ok} de 2 servicios respondieron.` };
        } },
        { id: 'pages', name: 'Páginas del sitio', run: async () => {
            const pages = ['index.html', 'booking.html', 'barbers.html', 'barber.html', 'news.html', 'services.html', 'support.html', 'settings.html', 'terminos.html', 'privacidad.html', 'cookies.html', 'policies.html', 'avisos.html', '404.html', 'staff/gaby/index.html'];
            const results = await Promise.all(pages.map(async page => {
                try {
                    const res = await fetch(`../${page}`, { cache: 'no-store' });
                    return res.ok ? null : `${page} (${res.status})`;
                } catch (error) {
                    return `${page} (sin respuesta)`;
                }
            }));
            const failed = results.filter(Boolean);
            return { status: failed.length ? 'fail' : 'ok', detail: failed.length ? `Fallaron: ${failed.join(', ')}` : `${pages.length} páginas responden correctamente.` };
        } },
        { id: 'network', name: 'Conexión y navegador', run: async () => {
            const secure = window.isSecureContext;
            const online = navigator.onLine;
            const conn = navigator.connection ? ` · red ${navigator.connection.effectiveType || ''}` : '';
            return { status: !online ? 'fail' : secure ? 'ok' : 'warn', detail: `${online ? 'En línea' : 'Sin conexión'} · ${secure ? 'HTTPS/contexto seguro' : 'SIN HTTPS (en producción el sitio debe usar HTTPS)'}${conn}` };
        } },
        { id: 'toasts', name: 'Mensajes de confirmación', run: async () => {
            toast('Prueba: mensaje de éxito.', 'success');
            toast('Prueba: mensaje de advertencia.', 'warning');
            toast('Prueba: mensaje de error.', 'error');
            return { status: 'ok', detail: 'Se mostraron 3 mensajes de prueba (arriba a la derecha).' };
        } },
        { id: 'maintenance', name: 'Estado del mantenimiento', run: async () => {
            const m = Data.getState().settings.maintenance;
            const on = Object.entries(m.sections || {}).filter(([, v]) => v).map(([k]) => k);
            return { status: m.enabled || on.length ? 'warn' : 'ok', detail: m.enabled ? 'Todo el sitio está en mantenimiento.' : on.length ? `Secciones en mantenimiento: ${on.join(', ')}` : 'Todo el sitio está disponible.' };
        } }
    ];

    function testRow(test, result) {
        const state = result ? result.status : 'idle';
        const icon = { ok: '✓', warn: '!', fail: '✕', running: '…', idle: '·' }[state];
        return `<div class="test ${state}" id="test-${test.id}"><span class="icon">${icon}</span><div><strong>${test.name}</strong><small>${result ? escapeHtml(result.detail) : 'Sin ejecutar'}</small></div><span class="ms">${result && result.ms !== undefined ? `${result.ms} ms` : `<button class="btn ghost" data-run="${test.id}" style="padding:.35rem .7rem;">Probar</button>`}</span></div>`;
    }

    async function runTest(test) {
        const row = $(`test-${test.id}`);
        if (row) row.outerHTML = testRow(test, { status: 'running', detail: 'Ejecutando...' });
        const t0 = performance.now();
        let result;
        try {
            result = await test.run();
        } catch (error) {
            result = { status: 'fail', detail: error.message || 'Error inesperado' };
        }
        result.ms = Math.round(performance.now() - t0);
        const current = $(`test-${test.id}`);
        if (current) current.outerHTML = testRow(test, result);
        bindTestButtons();
        return result;
    }

    function bindTestButtons() {
        document.querySelectorAll('[data-run]').forEach(button => {
            button.onclick = () => runTest(TESTS.find(test => test.id === button.dataset.run));
        });
    }

    function renderTests() {
        $('content').innerHTML = `
            <div class="head">
                <div><h1>Pruebas</h1><p>Conexión, servicios externos, datos y seguridad.</p></div>
                <button class="btn" id="run-all"><i class="fas fa-play"></i> Ejecutar todas</button>
            </div>
            <div class="card"><div class="tests">${TESTS.map(test => testRow(test)).join('')}</div></div>
        `;
        bindTestButtons();
        $('run-all').addEventListener('click', async () => {
            const results = [];
            for (const test of TESTS) results.push(await runTest(test));
            const failed = results.filter(r => r.status === 'fail').length;
            const warned = results.filter(r => r.status === 'warn').length;
            toast(`Pruebas terminadas: ${results.length - failed - warned} correctas, ${warned} advertencias, ${failed} fallidas.`, failed ? 'error' : warned ? 'warning' : 'success');
        });
    }

    // ---------------------------------------------------------------------
    // Sistema
    // ---------------------------------------------------------------------
    function renderSystem() {
        const s = Data.getState();
        $('content').innerHTML = `
            <div class="head"><div><h1>Sistema</h1><p>Respaldo, limpieza y tu acceso.</p></div></div>
            <div class="card">
                <h3><i class="fas fa-download"></i> Respaldo de datos</h3>
                <p class="muted">Descarga una copia de los datos guardados en este navegador (sin contraseñas: solo hashes). Guárdala en un lugar seguro: contiene datos personales de clientes.</p>
                <div class="row"><button class="btn" id="export"><i class="fas fa-file-arrow-down"></i> Descargar respaldo (.json)</button></div>
            </div>
            <div class="card">
                <h3><i class="fas fa-eraser"></i> Intentos fallidos</h3>
                <p class="muted">Hay ${Object.keys(s.security.attempts || {}).length} correo(s) con intentos fallidos acumulados (sin bloqueo). Puedes reiniciar el contador.</p>
                <div class="row"><button class="btn ghost" id="clear-attempts">Reiniciar contadores</button></div>
            </div>
            <div class="card">
                <h3><i class="fas fa-key"></i> Mi clave de acceso</h3>
                ${cloud() ? '<p class="muted">Con Supabase, tu clave se cambia desde tu cuenta de Supabase Auth.</p>' : `
                <form id="dev-change" class="tests" novalidate>
                    <label class="field">Clave actual<input type="password" id="dev-current" autocomplete="current-password"></label>
                    <label class="field">Nueva clave<input type="password" id="dev-new"></label>
                    <label class="field">Confirmar nueva clave<input type="password" id="dev-confirm"></label>
                    <div class="row"><button class="btn" type="submit">Cambiar clave</button></div>
                </form>`}
            </div>
            <div class="card">
                <h3><i class="fas fa-circle-info"></i> Información</h3>
                <div class="kv">
                    <div><small>Modo de datos</small>${cloud() ? 'Supabase' : 'Navegador (localStorage)'}</div>
                    <div><small>Última actualización de datos</small>${fmt(s.settings.updatedAt)}</div>
                    <div><small>Navegador</small>${escapeHtml(deviceFrom(navigator.userAgent))}</div>
                    <div><small>Sesión del panel</small>Vence tras ${SESSION_MINUTES} min sin actividad</div>
                </div>
            </div>
        `;
        $('export').addEventListener('click', () => {
            const backup = JSON.parse(JSON.stringify(Data.getState()));
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `respaldo-barberia-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(link.href);
            toast('Respaldo descargado.', 'success');
        });
        $('clear-attempts').addEventListener('click', async () => {
            await Data.commit(state => { state.security.attempts = {}; }, { success: 'Contadores reiniciados.', error: 'No se pudo reiniciar.' });
            render();
        });
        const form = $('dev-change');
        if (form) {
            const policy = window.GabyPassword.attach({ input: $('dev-new'), confirm: $('dev-confirm'), current: $('dev-current') });
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const okCurrent = await Security.verifyPassword($('dev-current').value, (devRecord() || {}).passwordHash || DEV_SEED);
                if (!okCurrent) return toast('La clave actual no es correcta.', 'error');
                const errors = policy.errors();
                if (errors.length) return toast(errors[0], 'warning');
                const passwordHash = await Security.hashPassword($('dev-new').value);
                await Data.commit(state => { state.security.devAuth = { passwordHash, updatedAt: new Date().toISOString() }; }, { success: 'Clave actualizada.', error: 'No se pudo cambiar la clave.' });
                render();
            });
        }
    }

    // ---------------------------------------------------------------------
    function init() {
        if (cloud()) $('dev-email-field').classList.remove('hidden');
        window.GabyPassword.addToggle($('dev-password'));
        setupPolicy = window.GabyPassword.attach({ input: $('setup-password'), confirm: $('setup-confirm') });
        $('login-form').addEventListener('submit', handleLogin);
        $('setup-form').addEventListener('submit', handleSetup);
        $('logout').addEventListener('click', async () => {
            endSession();
            if (cloud()) { const client = await window.GabyCloud.getClient(); await client.auth.signOut(); }
            show('login-view');
            toast('Sesión cerrada.', 'success');
        });
        $('tabs').addEventListener('click', event => {
            const tab = event.target.closest('[data-tab]');
            if (!tab) return;
            currentTab = tab.dataset.tab;
            touchSession();
            render();
        });
        ['click', 'keydown'].forEach(type => document.addEventListener(type, () => { if (sessionActive()) touchSession(); }, { passive: true }));
        window.addEventListener('storage', event => {
            if (event.key !== Data.STORAGE_KEY) return;
            checkNewLocks();
            if (!$('app-view').classList.contains('hidden') && currentTab !== 'maintenance' && currentTab !== 'tests' && currentTab !== 'system') render();
            else if (!$('app-view').classList.contains('hidden')) {
                const pending = pendingLocks().length;
                $('lock-badge').textContent = String(pending);
                $('lock-badge').classList.toggle('hidden', pending === 0);
            }
        });
        // La sesion vence por inactividad.
        setInterval(() => { if (!sessionActive() && !$('app-view').classList.contains('hidden')) { show('login-view'); toast('Tu sesión venció por inactividad.', 'warning'); } }, 30000);
        if (sessionActive()) openApp();
        else show('login-view');
    }

    init();
})();
