(function () {
    // =========================================================================
    // Politica de contrasenas: reglas, medidor de fuerza, mostrar/ocultar y generador.
    // Las mismas reglas se vuelven a validar en security.js antes de guardar (no se confia
    // solo en el formulario) y, con Supabase, en la configuracion de Auth del servidor.
    // =========================================================================
    const MIN = 10;
    const MAX = 64;
    const SPECIAL = /[^A-Za-z0-9\s]/;

    // Contrasenas y palabras demasiado comunes (en minusculas).
    const COMMON = new Set([
        'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'contrasena', 'contraseña',
        '12345678', '123456789', '1234567890', '12345678910', '1234567', '123456', '87654321', '11111111', '00000000',
        'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'admin', 'admin123', 'administrator', 'letmein',
        'welcome', 'welcome1', 'abc123', 'abc12345', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'superman',
        'batman', 'master', 'sunshine', 'princess', 'trustno1', 'shadow', 'michael', 'jordan23', 'puertorico',
        'boricua', 'barberia', 'barber', 'barbershop', 'gabystyle', 'goatstyle', 'goatstylesalon', 'changeme', 'secret'
    ]);
    const WEAK_WORDS = ['password', 'contrasena', 'qwerty', 'admin', 'letmein', 'welcome', 'iloveyou', 'barber', 'barberia',
        'gaby', 'goat', 'style', 'salon', 'puertorico', 'boricua', 'monkey', 'dragon', 'master', 'abc', 'hola', 'clave'];
    const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

    function normalizeLeet(text) {
        return text.toLowerCase().replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/7/g, 't');
    }

    function isCommon(password) {
        const lower = password.toLowerCase();
        if (COMMON.has(lower)) return true;
        // "Password123!" o "Qwerty2026" siguen siendo comunes: palabra comun + numeros/simbolos.
        const letters = lower.replace(/[^a-zñ]/g, '');
        if (letters && COMMON.has(letters) && letters.length / password.length >= 0.6) return true;
        if (COMMON.has(normalizeLeet(lower).replace(/[^a-z]/g, ''))) return true;
        return false;
    }

    function hasExcessiveRepeat(password) {
        if (/(.)\1{3,}/.test(password)) return true; // 4 o mas iguales seguidos: aaaa, 1111
        const counts = {};
        for (const ch of password) counts[ch] = (counts[ch] || 0) + 1;
        return Object.values(counts).some(n => n / password.length > 0.5);
    }

    function containsPersonalInfo(password, context) {
        const lower = password.toLowerCase();
        const email = String(context.email || '').trim().toLowerCase();
        const name = String(context.name || '').trim().toLowerCase();
        if (email && (lower === email || lower.includes(email))) return true;
        const local = email.split('@')[0];
        if (local && local.length >= 4 && lower === local) return true;
        if (name && (lower === name || lower === name.replace(/\s+/g, ''))) return true;
        return false;
    }

    // Lista de reglas obligatorias. Cada una tiene el texto de la lista y el mensaje de error.
    function evaluate(password, context) {
        const value = String(password || '');
        const ctx = context || {};
        const rules = [
            { id: 'min', label: `Mínimo ${MIN} caracteres`, ok: value.length >= MIN, error: `La contraseña debe tener al menos ${MIN} caracteres.` },
            { id: 'max', label: `Máximo ${MAX} caracteres`, ok: value.length <= MAX, error: `La contraseña no puede tener más de ${MAX} caracteres.`, hideWhenOk: true },
            { id: 'upper', label: 'Una letra mayúscula', ok: /[A-ZÑ]/.test(value), error: 'Debes incluir al menos una letra mayúscula.' },
            { id: 'lower', label: 'Una letra minúscula', ok: /[a-zñ]/.test(value), error: 'Debes incluir al menos una letra minúscula.' },
            { id: 'number', label: 'Un número', ok: /\d/.test(value), error: 'Debes incluir al menos un número.' },
            { id: 'special', label: 'Un carácter especial (! @ # $ % & * ? . -)', ok: SPECIAL.test(value), error: 'Debes incluir al menos un carácter especial.' },
            { id: 'common', label: 'No es una contraseña común', ok: value.length > 0 && !isCommon(value), error: 'Esta contraseña es demasiado común. Elige una contraseña diferente.' },
            { id: 'personal', label: 'No es tu nombre ni tu correo', ok: value.length > 0 && !containsPersonalInfo(value, ctx), error: 'La contraseña no puede ser tu nombre ni contener tu correo electrónico.' },
            { id: 'repeat', label: 'No repite el mismo carácter en exceso', ok: value.length > 0 && !hasExcessiveRepeat(value), error: 'La contraseña repite demasiado el mismo carácter.' },
            { id: 'spaces', label: 'No son solo espacios', ok: value.trim().length > 0, error: 'La contraseña no puede ser solo espacios.', hideWhenOk: true }
        ];
        if (ctx.current) {
            rules.push({ id: 'different', label: 'Diferente a tu contraseña actual', ok: value.length > 0 && value !== ctx.current, error: 'La nueva contraseña debe ser diferente a tu contraseña actual.' });
        }
        const failed = rules.filter(rule => !rule.ok);
        return { rules, valid: failed.length === 0, errors: failed.map(rule => rule.error) };
    }

    // Fuerza estimada: longitud y variedad, con penalizaciones por patrones predecibles.
    function strength(password, context) {
        const value = String(password || '');
        if (!value) return { score: 0, label: 'Muy débil' };
        let pool = 0;
        if (/[a-zñ]/.test(value)) pool += 26;
        if (/[A-ZÑ]/.test(value)) pool += 26;
        if (/\d/.test(value)) pool += 10;
        if (SPECIAL.test(value)) pool += 33;
        if (/\s/.test(value)) pool += 1;
        let bits = value.length * Math.log2(Math.max(pool, 2));

        const lower = normalizeLeet(value);
        WEAK_WORDS.forEach(word => { if (lower.includes(word)) bits -= 22; });
        if (isCommon(value)) bits -= 30;
        if (containsPersonalInfo(value, context || {})) bits -= 30;
        const name = String((context && context.name) || '').toLowerCase().split(/\s+/).filter(part => part.length >= 3);
        name.forEach(part => { if (value.toLowerCase().includes(part)) bits -= 15; });
        SEQUENCES.forEach(seq => {
            for (let i = 0; i + 4 <= seq.length; i += 1) {
                const chunk = seq.slice(i, i + 4);
                if (value.toLowerCase().includes(chunk) || value.toLowerCase().includes([...chunk].reverse().join(''))) { bits -= 12; break; }
            }
        });
        if (/(.)\1{2,}/.test(value)) bits -= 10;
        if (/(19|20)\d{2}/.test(value)) bits -= 8;
        // Patron tipico "Palabra + numeros + simbolo" (ej. Password1!, Barberia2026*)
        if (/^[A-ZÑ][a-zñ]+\d+[^A-Za-z0-9]*$/.test(value) || /^[A-ZÑ][a-zñ]+[^A-Za-z0-9]+\d+$/.test(value)) bits -= 18;
        const classes = [/[a-zñ]/, /[A-ZÑ]/, /\d/, SPECIAL].filter(re => re.test(value)).length;
        if (classes < 3) bits -= 10;

        const valid = evaluate(value, context).valid;
        let score;
        if (bits < 30) score = 0;
        else if (bits < 45) score = 1;
        else if (bits < 60) score = 2;
        else if (bits < 80) score = 3;
        else score = 4;
        if (!valid) score = Math.min(score, 1);
        const labels = ['Muy débil', 'Débil', 'Aceptable', 'Fuerte', 'Muy fuerte'];
        return { score, label: labels[score], bits: Math.round(bits) };
    }

    // Genera una contrasena aleatoria segura (crypto.getRandomValues) con todos los tipos de caracteres.
    function generate(length) {
        const size = Math.min(Math.max(length || 16, 12), MAX);
        const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_+='];
        const all = sets.join('');
        const random = max => {
            const buf = new Uint32Array(1);
            const limit = Math.floor(0xffffffff / max) * max;
            do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
            return buf[0] % max;
        };
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const chars = sets.map(set => set[random(set.length)]);
            while (chars.length < size) chars.push(all[random(all.length)]);
            for (let i = chars.length - 1; i > 0; i -= 1) {
                const j = random(i + 1);
                [chars[i], chars[j]] = [chars[j], chars[i]];
            }
            const candidate = chars.join('');
            if (evaluate(candidate, {}).valid) return candidate;
        }
        return generate(size);
    }

    // ---------------------------------------------------------------------
    // Interfaz
    // ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('gaby-password-styles')) return;
        const style = document.createElement('style');
        style.id = 'gaby-password-styles';
        style.textContent = `
            .pw-wrap { position: relative; display: block; }
            .pw-wrap > input { width: 100%; padding-right: 3.2rem !important; }
            .pw-toggle { position: absolute; right: .35rem; top: 50%; transform: translateY(-50%); width: 2.5rem; height: 2.5rem; border: 0; border-radius: 10px; background: transparent; color: #d4af37; cursor: pointer; display: grid; place-items: center; font-size: 1rem; }
            .pw-toggle:hover { background: rgba(212,175,55,.12); }
            .pw-toggle:focus-visible { outline: 2px solid #d4af37; outline-offset: 1px; }
            .pw-panel { display: grid; gap: .6rem; margin-top: .55rem; font-family: 'Inter', system-ui, sans-serif; }
            .pw-meter { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
            .pw-meter span { height: 6px; border-radius: 99px; background: rgba(127,127,127,.25); transition: background .2s; }
            .pw-meter[data-score="0"] span:nth-child(-n+1) { background: #e5484d; }
            .pw-meter[data-score="1"] span:nth-child(-n+2) { background: #f0883e; }
            .pw-meter[data-score="2"] span:nth-child(-n+3) { background: #f1be5d; }
            .pw-meter[data-score="3"] span:nth-child(-n+4) { background: #7cc96a; }
            .pw-meter[data-score="4"] span:nth-child(-n+5) { background: #3fb950; }
            .pw-strength { display: flex; justify-content: space-between; align-items: center; gap: .75rem; flex-wrap: wrap; font-size: .8rem; }
            .pw-strength strong { font-weight: 700; }
            .pw-generate { background: none; border: 1px solid rgba(212,175,55,.45); color: #d4af37; border-radius: 999px; padding: .4rem .8rem; font: inherit; font-size: .78rem; font-weight: 700; cursor: pointer; }
            .pw-generate:hover { background: rgba(212,175,55,.1); }
            .pw-rules { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: .25rem .9rem; font-size: .8rem; }
            .pw-rules li { display: flex; gap: .45rem; align-items: flex-start; opacity: .75; line-height: 1.35; }
            .pw-rules li::before { content: "○"; font-weight: 800; width: 1em; flex-shrink: 0; }
            .pw-rules li.ok { opacity: 1; color: #3fb950; }
            .pw-rules li.ok::before { content: "✓"; }
            .pw-rules li.bad { opacity: 1; color: #ff6b6b; }
            .pw-rules li.bad::before { content: "✕"; }
            .pw-rules li.hidden { display: none; }
            .pw-match { font-size: .8rem; margin-top: .35rem; min-height: 1em; }
            .pw-match.ok { color: #3fb950; }
            .pw-match.bad { color: #ff6b6b; }
        `;
        document.head.appendChild(style);
    }

    // Boton de ojo para mostrar/ocultar. Se puede usar en cualquier campo de contrasena.
    function addToggle(input) {
        if (!input || input.dataset.pwToggle) return;
        injectStyles();
        input.dataset.pwToggle = 'true';
        const wrap = document.createElement('span');
        wrap.className = 'pw-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pw-toggle';
        const sync = () => {
            const visible = input.type === 'text';
            button.innerHTML = `<i class="fas ${visible ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;
            button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
            button.title = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
        };
        button.addEventListener('click', () => {
            input.type = input.type === 'password' ? 'text' : 'password';
            sync();
            input.focus();
        });
        sync();
        wrap.appendChild(button);
    }

    // Conecta un campo "nueva contrasena" (y opcionalmente confirmar / actual) con la lista y el medidor.
    // options: { input, confirm, current, getContext: () => ({ name, email }) }
    function attach(options) {
        injectStyles();
        const input = options.input;
        const confirm = options.confirm || null;
        const current = options.current || null;
        const getContext = options.getContext || (() => ({}));
        if (!input || input.dataset.pwPolicy) return input && input.pwPolicy;
        input.dataset.pwPolicy = 'true';
        input.setAttribute('autocomplete', 'new-password');
        input.setAttribute('maxlength', String(MAX));
        input.removeAttribute('minlength');
        if (confirm) confirm.setAttribute('autocomplete', 'new-password');
        if (current) current.setAttribute('autocomplete', 'current-password');
        [input, confirm, current].forEach(addToggle);

        const panel = document.createElement('div');
        panel.className = 'pw-panel';
        panel.setAttribute('aria-live', 'polite');
        panel.innerHTML = `
            <div class="pw-meter" data-score="0" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
            <div class="pw-strength"><span>Seguridad: <strong class="pw-strength-label">—</strong></span><button type="button" class="pw-generate"><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i> Generar contraseña segura</button></div>
            <ul class="pw-rules"></ul>
        `;
        input.closest('.pw-wrap').insertAdjacentElement('afterend', panel);
        let match = null;
        if (confirm) {
            match = document.createElement('div');
            match.className = 'pw-match';
            confirm.closest('.pw-wrap').insertAdjacentElement('afterend', match);
        }

        function context() {
            return { ...getContext(), current: current ? current.value : '' };
        }

        function update() {
            const result = evaluate(input.value, context());
            const typed = input.value.length > 0;
            panel.querySelector('.pw-rules').innerHTML = result.rules.map(rule => {
                const state = rule.ok ? 'ok' : (typed ? 'bad' : '');
                const hidden = rule.hideWhenOk && rule.ok ? 'hidden' : '';
                return `<li class="${state} ${hidden}">${rule.label}</li>`;
            }).join('');
            const power = strength(input.value, context());
            panel.querySelector('.pw-meter').dataset.score = typed ? String(power.score) : '-1';
            panel.querySelector('.pw-strength-label').textContent = typed ? power.label : '—';
            input.setCustomValidity(typed && !result.valid ? result.errors[0] : '');
            if (confirm) {
                const mismatch = confirm.value.length > 0 && confirm.value !== input.value;
                confirm.setCustomValidity(mismatch ? 'Las contraseñas no coinciden.' : '');
                match.textContent = confirm.value ? (mismatch ? 'Las contraseñas no coinciden.' : '✓ Las contraseñas coinciden.') : '';
                match.className = `pw-match ${confirm.value ? (mismatch ? 'bad' : 'ok') : ''}`;
            }
            return result;
        }

        panel.querySelector('.pw-generate').addEventListener('click', () => {
            const generated = generate(16);
            input.value = generated;
            input.type = 'text';
            if (confirm) {
                confirm.value = generated;
                confirm.type = 'text';
            }
            [input, confirm].forEach(field => field && field.dispatchEvent(new Event('input', { bubbles: true })));
            // Muestra la contrasena generada (el ojo pasa a "ocultar").
            [input, confirm].forEach(field => {
                const toggle = field && field.closest('.pw-wrap')?.querySelector('.pw-toggle');
                if (!toggle) return;
                toggle.innerHTML = '<i class="fas fa-eye-slash" aria-hidden="true"></i>';
                toggle.setAttribute('aria-label', 'Ocultar contraseña');
                toggle.title = 'Ocultar contraseña';
            });
            update();
            const message = 'Contraseña generada. Está visible para que la revises: guárdala en un lugar seguro o en tu gestor de contraseñas.';
            if (window.GabyToast) window.GabyToast.show(message, 'success', { duration: 8000 });
        });

        [input, confirm, current].forEach(field => field && field.addEventListener('input', update));
        update();
        const api = {
            update,
            isValid: () => update().valid && (!confirm || confirm.value === input.value),
            errors: () => {
                const result = update();
                const errors = [...result.errors];
                if (confirm && confirm.value !== input.value) errors.push('Las contraseñas no coinciden.');
                return errors;
            },
            reset: () => { update(); }
        };
        input.pwPolicy = api;
        return api;
    }

    window.GabyPassword = { MIN, MAX, evaluate, strength, generate, attach, addToggle, isCommon };
})();
