(function () {
    // =========================================================================
    // GabySecurity: inicio de sesion seguro del personal (paneles de barberos).
    // Los clientes no tienen cuentas: reservan y dejan resenas con su nombre completo.
    // - Contrasenas guardadas con hash PBKDF2-SHA256 (600,000 iteraciones + sal aleatoria),
    //   nunca en texto plano.
    // - 3 intentos fallidos => la cuenta se bloquea y aparece en el panel privado de Angel,
    //   que decide si la desbloquea (y entonces se exige cambiar la contrasena) o la deja bloqueada.
    // - Espera progresiva entre intentos fallidos en el mismo navegador.
    // - Con Supabase (GabyCloud.enabled): Auth guarda las contrasenas con bcrypt y el conteo de
    //   intentos/bloqueos vive en la base de datos (funciones login_guard / register_failed_login).
    // =========================================================================
    const LOCK_AFTER = 3;
    const ITERATIONS = 600000;
    const STAFF_SESSION_KEY = 'gs_staff_session';
    const STAFF_SESSION_HOURS = 8;
    const SHOP_PHONE = '787-218-1068';

    // Cuentas del personal. Las contrasenas iniciales solo existen como hash y se exige cambiarlas
    // en el primer inicio de sesion (las anteriores estaban escritas en el codigo y no son seguras).
    const STAFF_ACCOUNTS = [
        { email: 'gaby@goatstylesalon.com', barberId: 'gabriel', isAdmin: true, portal: 'staff/gaby/index.html',
            seed: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'ZjbskCK8AeuQrBYCMIo4FA==', hash: 'XYkaj8tJ5EucNQOHx6FCsLCfQyk4m1lC9XIl/HFXu6w=' } },
        { email: 'darialex@goatstylesalon.com', barberId: 'darialex', isAdmin: false, portal: 'staff/darialex/index.html',
            seed: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'gR3hkkvA4RKNoXSsSjZ+tA==', hash: 'R7W8LoB5q0g+Cj4lh2uwwMQk/h4D3g8vyhubfwShL3s=' } },
        { email: 'wilo@goatstylesalon.com', barberId: 'wilo', isAdmin: false, portal: 'staff/wilo/index.html',
            seed: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'WnhzRguuwBYJ5eP7SOp+IQ==', hash: 'HrgalLTJF0l2r1DcoiF72yAkYtwZdH12t7qLyexD5YA=' } }
    ];

    const cloud = () => Boolean(window.GabyCloud && window.GabyCloud.enabled);
    const normalizeEmail = email => String(email || '').trim().toLowerCase();
    const db = () => window.GabyData.getState();

    // ---------------------------------------------------------------------
    // Hash de contrasenas (WebCrypto)
    // ---------------------------------------------------------------------
    const toBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
    const fromBase64 = text => Uint8Array.from(atob(text), ch => ch.charCodeAt(0));

    async function derive(password, salt, iterations) {
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
        return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    }

    async function hashPassword(password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const hash = await derive(password, salt, ITERATIONS);
        return { algo: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toBase64(salt), hash: toBase64(hash) };
    }

    async function verifyPassword(password, record) {
        if (!record || !record.hash) return false;
        const actual = new Uint8Array(await derive(password, fromBase64(record.salt), record.iterations || ITERATIONS));
        const expected = fromBase64(record.hash);
        if (actual.length !== expected.length) return false;
        let diff = 0;
        for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i]; // comparacion de tiempo constante
        return diff === 0;
    }

    // ---------------------------------------------------------------------
    // Cuentas
    // ---------------------------------------------------------------------
    function staffAccount(email) {
        return STAFF_ACCOUNTS.find(account => account.email === normalizeEmail(email)) || null;
    }

    // Versión de las claves iniciales: al subirla, las claves temporales nuevas reemplazan
    // a las que se hayan guardado antes en cualquier navegador.
    const SEED_VERSION = 2;

    function staffAuth(state, email) {
        const account = staffAccount(email);
        if (!account) return null;
        const saved = (state.security.staffAuth || {})[account.email];
        if (saved && saved.seedVersion === SEED_VERSION) return saved;
        return { passwordHash: account.seed, mustChangePassword: true, seedVersion: SEED_VERSION };
    }

    function findAccount(email) {
        const state = db();
        const mail = normalizeEmail(email);
        const account = staffAccount(mail);
        if (!account) return null;
        const barber = state.barbers.find(item => item.id === account.barberId) || {};
        return { type: 'staff', email: mail, id: account.barberId, name: barber.name || account.barberId, phone: barber.phone || '', account, auth: staffAuth(state, mail) };
    }

    function activeLock(state, email) {
        return (state.security.locks || []).find(lock => lock.email === normalizeEmail(email) && lock.status !== 'DESBLOQUEADA') || null;
    }

    function isLocked(email) {
        return Boolean(activeLock(db(), email));
    }

    // Espera progresiva en este navegador: 0s, 2s, 4s, 8s... despues de cada fallo.
    function waitSeconds(email) {
        try {
            const raw = JSON.parse(sessionStorage.getItem('gs_login_throttle') || '{}')[normalizeEmail(email)];
            if (!raw) return 0;
            const delay = Math.min(30, 2 ** Math.max(0, raw.count - 1)) * 1000;
            const remaining = raw.at + delay - Date.now();
            return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
        } catch (error) {
            return 0;
        }
    }

    function noteThrottle(email, success) {
        try {
            const all = JSON.parse(sessionStorage.getItem('gs_login_throttle') || '{}');
            const key = normalizeEmail(email);
            if (success) delete all[key];
            else all[key] = { count: ((all[key] && all[key].count) || 0) + 1, at: Date.now() };
            sessionStorage.setItem('gs_login_throttle', JSON.stringify(all));
        } catch (error) { /* almacenamiento bloqueado */ }
    }

    // Registra un intento fallido. Al tercero, si la cuenta existe, se crea el bloqueo.
    function registerFailure(email, account) {
        const mail = normalizeEmail(email);
        let count = 0;
        let lockedNow = false;
        window.GabyData.updateState(state => {
            const attempts = state.security.attempts;
            const entry = attempts[mail] || { count: 0 };
            entry.count += 1;
            entry.lastAt = new Date().toISOString();
            entry.type = 'staff';
            attempts[mail] = entry;
            count = entry.count;
            if (count >= LOCK_AFTER && account && !activeLock(state, mail)) {
                lockedNow = true;
                state.security.locks.unshift({
                    id: window.GabyData.makeId('lock'),
                    email: mail,
                    accountType: 'staff',
                    accountId: account.id,
                    attempts: count,
                    lockedAt: new Date().toISOString(),
                    userAgent: navigator.userAgent,
                    status: 'BLOQUEADA'
                });
            }
        });
        return { count, lockedNow };
    }

    function clearFailures(email) {
        const mail = normalizeEmail(email);
        window.GabyData.updateState(state => { delete state.security.attempts[mail]; });
    }

    // ---------------------------------------------------------------------
    // Inicio de sesion
    // ---------------------------------------------------------------------
    const MESSAGES = {
        locked: `Por seguridad, esta cuenta está bloqueada después de ${LOCK_AFTER} intentos fallidos. Comunícate con la barbería al ${SHOP_PHONE} para verificar tu identidad y desbloquearla.`,
        invalid: left => `Correo o contraseña incorrectos.${left > 0 ? ` Te queda${left === 1 ? '' : 'n'} ${left} intento${left === 1 ? '' : 's'} antes de que la cuenta se bloquee por seguridad.` : ''}`,
        wait: seconds => `Por seguridad, espera ${seconds} segundo${seconds === 1 ? '' : 's'} antes de intentar de nuevo.`
    };

    async function login({ email, password }) {
        const mail = normalizeEmail(email);
        const wait = waitSeconds(mail);
        if (wait) return { ok: false, reason: 'wait', message: MESSAGES.wait(wait) };
        if (cloud()) return cloudLogin(mail, password);

        if (isLocked(mail)) return { ok: false, reason: 'locked', message: MESSAGES.locked };
        const account = findAccount(mail);
        const ok = account ? await verifyPassword(password, account.auth.passwordHash) : false;

        if (!ok) {
            noteThrottle(mail, false);
            const { count } = registerFailure(mail, account);
            // Tambien se "bloquea" un correo inexistente para no revelar que cuentas existen.
            if (count >= LOCK_AFTER) return { ok: false, reason: 'locked', message: MESSAGES.locked };
            return { ok: false, reason: 'invalid', message: MESSAGES.invalid(LOCK_AFTER - count), attemptsLeft: LOCK_AFTER - count };
        }

        noteThrottle(mail, true);
        clearFailures(mail);
        startStaffSession(account.account);
        return { ok: true, account, mustChangePassword: Boolean(account.auth.mustChangePassword), portal: account.account.portal };
    }

    async function cloudLogin(mail, password) {
        const client = await window.GabyCloud.getClient();
        const guard = await client.rpc('login_guard', { p_email: mail });
        if (guard.data && guard.data.locked) return { ok: false, reason: 'locked', message: MESSAGES.locked };
        try {
            const result = await window.GabyCloud.staffSignIn(mail, password);
            noteThrottle(mail, true);
            await client.rpc('clear_login_attempts');
            const must = await client.rpc('must_change_password');
            return { ok: true, mustChangePassword: must.data === true, portal: result.portal || null };
        } catch (error) {
            if (!/incorrectos/i.test(error.userMessage || '')) return { ok: false, reason: 'error', message: error.userMessage || 'No se pudo iniciar sesión.' };
            noteThrottle(mail, false);
            const { data } = await client.rpc('register_failed_login', { p_email: mail, p_user_agent: navigator.userAgent });
            if (data && data.locked) return { ok: false, reason: 'locked', message: MESSAGES.locked };
            const left = data ? data.attempts_left : LOCK_AFTER - 1;
            return { ok: false, reason: 'invalid', message: MESSAGES.invalid(left), attemptsLeft: left };
        }
    }

    // ---------------------------------------------------------------------
    // Crear / cambiar contrasena (las reglas se validan aqui otra vez, no solo en el formulario)
    // ---------------------------------------------------------------------
    function policyErrors(password, context) {
        if (!window.GabyPassword) return [];
        return window.GabyPassword.evaluate(password, context).errors;
    }

    async function setPassword({ email, newPassword, context }) {
        const mail = normalizeEmail(email);
        const account = findAccount(mail);
        const errors = policyErrors(newPassword, { name: account && account.name, email: mail, ...(context || {}) });
        if (errors.length) throw Object.assign(new Error('policy'), { userMessage: errors[0] });

        if (cloud()) {
            await window.GabyCloud.updatePassword(newPassword);
            const client = await window.GabyCloud.getClient();
            await client.rpc('clear_must_change_password');
            return;
        }
        if (!account) throw Object.assign(new Error('account'), { userMessage: 'No encontramos la cuenta.' });
        const passwordHash = await hashPassword(newPassword);
        const ok = await window.GabyData.commit(state => {
            state.security.staffAuth[mail] = { passwordHash, mustChangePassword: false, seedVersion: SEED_VERSION, updatedAt: new Date().toISOString() };
        }, { success: null, error: 'No se pudo guardar la nueva contraseña.' });
        if (!ok) throw Object.assign(new Error('save'), { userMessage: 'No se pudo guardar la nueva contraseña.' });
    }

    async function changePassword({ email, currentPassword, newPassword }) {
        if (currentPassword === newPassword) {
            throw Object.assign(new Error('same'), { userMessage: 'La nueva contraseña debe ser diferente a tu contraseña actual.' });
        }
        const mail = normalizeEmail(email);
        if (cloud()) {
            const client = await window.GabyCloud.getClient();
            const { error } = await client.auth.signInWithPassword({ email: mail, password: currentPassword });
            if (error) throw Object.assign(new Error('current'), { userMessage: 'Tu contraseña actual no es correcta.' });
        } else {
            const account = findAccount(mail);
            const ok = account ? await verifyPassword(currentPassword, account.auth.passwordHash) : false;
            if (!ok) throw Object.assign(new Error('current'), { userMessage: 'Tu contraseña actual no es correcta.' });
        }
        await setPassword({ email: mail, newPassword, context: { current: currentPassword } });
    }

    // ---------------------------------------------------------------------
    // Bloqueos (los usa el panel privado de Angel)
    // ---------------------------------------------------------------------
    async function resolveLock(lockId, status) {
        // Con Supabase el bloqueo vive en la base de datos (funcion resolve_account_lock).
        if (cloud()) {
            try {
                const client = await window.GabyCloud.getClient();
                const { error } = await client.rpc('resolve_account_lock', { p_lock_id: lockId, p_unlock: status === 'DESBLOQUEADA' });
                if (error) throw error;
                await window.GabyCloud.pull();
                window.GabyData.toast(status === 'DESBLOQUEADA' ? 'Cuenta desbloqueada. Se le pedirá cambiar la contraseña al iniciar sesión.' : 'La cuenta se mantiene bloqueada.', 'success');
                return true;
            } catch (error) {
                window.GabyData.toast('No se pudo actualizar el bloqueo.', 'error');
                return false;
            }
        }
        let lock = null;
        return window.GabyData.commit(state => {
            lock = state.security.locks.find(item => item.id === lockId);
            if (!lock) throw Object.assign(new Error('lock'), { userMessage: 'No se encontró el bloqueo.' });
            lock.status = status;
            lock.resolvedAt = new Date().toISOString();
            lock.resolvedBy = 'Angel';
            if (status === 'DESBLOQUEADA') {
                delete state.security.attempts[lock.email];
                // Al desbloquear se exige crear una contrasena nueva en el proximo inicio de sesion.
                const current = staffAuth(state, lock.email);
                if (current) state.security.staffAuth[lock.email] = { ...current, mustChangePassword: true };
            }
        }, {
            success: status === 'DESBLOQUEADA' ? 'Cuenta desbloqueada. Se le pedirá cambiar la contraseña al iniciar sesión.' : 'La cuenta se mantiene bloqueada.',
            error: 'No se pudo actualizar el bloqueo.'
        });
    }

    // ---------------------------------------------------------------------
    // Sesion del personal (paneles de barberos)
    // ---------------------------------------------------------------------
    function startStaffSession(account) {
        try {
            localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify({ email: account.email, barberId: account.barberId, isAdmin: account.isAdmin, exp: Date.now() + STAFF_SESSION_HOURS * 3600 * 1000 }));
        } catch (error) { /* almacenamiento bloqueado */ }
    }

    function getStaffSession() {
        try {
            const session = JSON.parse(localStorage.getItem(STAFF_SESSION_KEY) || 'null');
            if (!session || session.exp < Date.now()) return null;
            if (isLocked(session.email)) return null;
            return session;
        } catch (error) {
            return null;
        }
    }

    function endStaffSession() {
        try { localStorage.removeItem(STAFF_SESSION_KEY); } catch (error) { /* nada */ }
    }

    // ---------------------------------------------------------------------
    // Ventana para crear la contrasena nueva (obligatoria tras desbloqueo o primer acceso del personal)
    // ---------------------------------------------------------------------
    function injectModalStyles() {
        if (document.getElementById('gaby-security-styles')) return;
        const style = document.createElement('style');
        style.id = 'gaby-security-styles';
        style.textContent = `
            .sec-modal { position: fixed; inset: 0; z-index: 7000; background: rgba(0,0,0,.72); display: flex; align-items: center; justify-content: center; padding: 1rem; font-family: 'Inter', system-ui, sans-serif; }
            .sec-card { width: min(520px, 100%); max-height: 92vh; overflow: auto; background: #121212; color: #f5f1e8; border: 1px solid rgba(212,175,55,.35); border-radius: 22px; padding: 1.5rem; display: grid; gap: 1rem; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
            body.light-mode .sec-card { background: #fff; color: #111; }
            .sec-card h2 { margin: 0; font-size: 1.25rem; font-family: 'Cinzel', serif; color: #d4af37; }
            .sec-card p { margin: 0; font-size: .9rem; line-height: 1.55; opacity: .85; }
            .sec-card form { display: grid; gap: .9rem; }
            .sec-card label { display: grid; gap: .4rem; font-size: .85rem; font-weight: 600; }
            .sec-card input { width: 100%; border-radius: 12px; border: 1px solid rgba(212,175,55,.3); background: rgba(255,255,255,.04); color: inherit; padding: .85rem 1rem; font: inherit; }
            body.light-mode .sec-card input { background: #fff; border-color: rgba(0,0,0,.15); }
            .sec-card input:focus { outline: none; border-color: #d4af37; box-shadow: 0 0 0 3px rgba(212,175,55,.18); }
            .sec-actions { display: flex; gap: .6rem; flex-wrap: wrap; }
            .sec-btn { border: 0; border-radius: 999px; padding: .85rem 1.3rem; font: inherit; font-weight: 800; cursor: pointer; background: linear-gradient(135deg, #f6dfa0 0%, #d4af37 62%, #87640f 100%); color: #111; }
            .sec-btn.ghost { background: transparent; color: inherit; border: 1px solid rgba(212,175,55,.4); }
            .sec-btn:disabled { opacity: .6; cursor: wait; }
            .sec-error { color: #ff6b6b; font-size: .85rem; min-height: 1em; }
        `;
        document.head.appendChild(style);
    }

    // options: { email, name, title, message, requireCurrent, allowCancel }
    function promptPasswordChange(options) {
        injectModalStyles();
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.className = 'sec-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML = `
                <div class="sec-card">
                    <h2>${options.title || 'Crea una contraseña nueva'}</h2>
                    <p>${options.message || 'Por seguridad, debes crear una contraseña nueva antes de continuar.'}</p>
                    <form novalidate data-no-required-legend>
                        <input type="email" autocomplete="username" value="${String(options.email || '').replace(/"/g, '&quot;')}" hidden>
                        ${options.requireCurrent ? '<label>Contraseña actual<input type="password" name="current" required></label>' : ''}
                        <label>Nueva contraseña<input type="password" name="password" required></label>
                        <label>Confirmar nueva contraseña<input type="password" name="confirm" required></label>
                        <div class="sec-error" role="alert"></div>
                        <div class="sec-actions">
                            <button class="sec-btn" type="submit">Guardar contraseña</button>
                            ${options.allowCancel ? '<button class="sec-btn ghost" type="button" data-cancel>Cancelar</button>' : ''}
                        </div>
                    </form>
                </div>
            `;
            document.body.appendChild(modal);
            const form = modal.querySelector('form');
            const current = form.querySelector('[name=current]');
            const input = form.querySelector('[name=password]');
            const confirm = form.querySelector('[name=confirm]');
            const errorBox = form.querySelector('.sec-error');
            const policy = window.GabyPassword.attach({ input, confirm, current, getContext: () => ({ name: options.name, email: options.email }) });
            (current || input).focus();
            const close = result => { modal.remove(); resolve(result); };
            form.querySelector('[data-cancel]')?.addEventListener('click', () => close(false));
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const errors = policy.errors();
                if (current && !current.value) errors.unshift('Escribe tu contraseña actual.');
                if (errors.length) {
                    errorBox.textContent = errors[0];
                    return;
                }
                const button = form.querySelector('[type=submit]');
                button.disabled = true;
                button.textContent = 'Guardando...';
                try {
                    if (current) await changePassword({ email: options.email, currentPassword: current.value, newPassword: input.value });
                    else await setPassword({ email: options.email, newPassword: input.value });
                    if (window.GabyToast) window.GabyToast.show('Tu contraseña se actualizó correctamente.', 'success');
                    close(true);
                } catch (error) {
                    errorBox.textContent = error.userMessage || 'No se pudo guardar la contraseña.';
                    button.disabled = false;
                    button.textContent = 'Guardar contraseña';
                }
            });
        });
    }

    window.GabySecurity = {
        LOCK_AFTER,
        STAFF_ACCOUNTS,
        hashPassword,
        verifyPassword,
        login,
        setPassword,
        changePassword,
        isLocked,
        findAccount,
        unlock: lockId => resolveLock(lockId, 'DESBLOQUEADA'),
        keepLocked: lockId => resolveLock(lockId, 'MANTENER_BLOQUEADA'),
        startStaffSession,
        getStaffSession,
        endStaffSession,
        promptPasswordChange,
        messages: MESSAGES
    };
})();
