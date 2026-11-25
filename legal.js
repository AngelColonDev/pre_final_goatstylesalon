(function () {
    // =========================================================================
    // CONFIGURACIÓN LEGAL — configuración completa y vigente desde el
    // 1 de diciembre de 2026. Todos los valores de este bloque son finales
    // y verdaderos, y se muestran en las páginas legales.
    // Ver docs/legal-pendientes.md para el registro de cierre con los
    // valores finales utilizados.
    // =========================================================================
    const config = {
        // Documentos vigentes desde el 1 de diciembre de 2026.
        draft: false,
        // Cambia esta versión cada vez que haya un cambio material en Terminos/Privacidad.
        termsVersion: '2026-12-01',
        privacyVersion: '2026-12-01',
        bookingPolicyVersion: '2026-12-01',
        cookieVersion: '2026-12-01',
        lastUpdated: '1 de diciembre de 2026',
        effectiveDate: '1 de diciembre de 2026',

        legalName: 'Gabriel Andres Ortiz',
        tradeName: 'Goat Style Salon',
        owner: 'Gabriel Andres Ortiz',
        address: 'Barranquitas, Puerto Rico',
        municipality: 'Barranquitas',
        email: 'gaby@goatstylesalon.com',
        claimsEmail: 'gaby@goatstylesalon.com',
        privacyEmail: 'gaby@goatstylesalon.com',
        phone: '787-218-1068',
        year: '2026',

        // Valores de respaldo para la política de reservaciones.
        freeCancelHours: '2',
        lateCancelFee: 'ninguno: no cobramos cargo por cancelar; solo te pedimos avisar con al menos 2 horas de anticipación',
        graceMinutes: '10',
        noShowConsequence: 'Las ausencias repetidas sin aviso pueden limitar tu posibilidad de reservar en línea en el futuro.',
        rescheduleRule: 'Puedes cancelar o cambiar tu cita desde la aplicación o llamando al 787-218-1068, idealmente con al menos 2 horas de anticipación, sujeto a disponibilidad.',

        // Proveedores
        hosting: 'GitHub Pages',
        database: 'Supabase',
        formsProvider: 'Formspark',
        emailProvider: 'Supabase con SMTP propio del dominio goatstylesalon.com',
        smsProvider: 'No utilizamos SMS; los avisos llegan por notificación push, correo y WhatsApp',
        analytics: 'No utilizamos analítica de terceros',
        otherProviders: 'Ninguno adicional a los mencionados',

        retentionAppointments: 'Mientras sean necesarios para prestar el servicio y mantener nuestros registros comerciales; después se eliminan o se anonimizan',
        retentionBilling: 'Mientras sean necesarios para nuestros registros comerciales y para cumplir las obligaciones contables y fiscales aplicables en Puerto Rico; después se eliminan o se anonimizan',
        retentionLogs: 'Por un periodo limitado, solo el necesario para la seguridad y el funcionamiento de la plataforma; después se eliminan',
        retentionDeleted: 'el tiempo necesario para nuestros registros comerciales'
    };

    const placeholders = {
        effectiveDate: 'FECHA DE ENTRADA EN VIGOR',
        legalName: 'NOMBRE LEGAL DE LA BARBERÍA',
        tradeName: 'NOMBRE COMERCIAL',
        owner: 'PROPIETARIO O ENTIDAD LEGAL',
        address: 'DIRECCIÓN',
        municipality: 'MUNICIPIO',
        email: 'EMAIL',
        claimsEmail: 'EMAIL PARA RECLAMACIONES',
        privacyEmail: 'EMAIL DE PRIVACIDAD',
        phone: 'TELÉFONO',
        freeCancelHours: 'X',
        lateCancelFee: 'CARGO POR CANCELACIÓN TARDÍA',
        graceMinutes: 'X',
        noShowConsequence: 'CONSECUENCIA DE NO-SHOW',
        rescheduleRule: 'REGLA DE REPROGRAMACIÓN',
        hosting: 'HOSTING',
        database: 'BASE DE DATOS',
        formsProvider: 'PROVEEDOR DE FORMULARIOS',
        emailProvider: 'EMAIL',
        smsProvider: 'SMS',
        analytics: 'ANALYTICS',
        otherProviders: 'OTROS',
        retentionAppointments: 'PERÍODO',
        retentionBilling: 'PERÍODO',
        retentionLogs: 'PERÍODO',
        retentionDeleted: 'PERÍODO'
    };

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // Las reglas de reservacion salen de la Configuracion del panel (settings.booking),
    // asi la politica publicada siempre coincide con lo que el sistema aplica.
    function bookingValue(key) {
        try {
            const rules = window.GabyData && window.GabyData.getState().settings.booking;
            if (!rules) return '';
            const noShow = rules.noShowRules || {};
            const map = {
                freeCancelHours: rules.cancelPolicyHours,
                lateCancelFee: rules.lateCancelFee,
                graceMinutes: rules.graceMinutes,
                noShowConsequence: noShow.enabled
                    ? `Se registra en tu historial. Con ${noShow.blockAt} no-shows se pausan las reservaciones en línea hasta que la barbería lo revise.`
                    : 'Se registra en tu historial.',
                rescheduleRule: `Comunícate con la barbería hasta ${rules.onlineChangeMinHours} hora(s) antes de la cita, según disponibilidad.`
            };
            return map[key] !== undefined && map[key] !== null && map[key] !== '' ? String(map[key]) : '';
        } catch (error) {
            return '';
        }
    }

    function value(key) {
        return bookingValue(key) || config[key] || '';
    }

    function display(key) {
        const v = value(key);
        if (v) return escapeHtml(v);
        return '';
    }

    function fillPlaceholders(root) {
        (root || document).querySelectorAll('[data-legal]').forEach(node => {
            node.innerHTML = display(node.getAttribute('data-legal'));
        });
        (root || document).querySelectorAll('[data-legal-mail]').forEach(node => {
            const key = node.getAttribute('data-legal-mail');
            const v = value(key) || value('email');
            if (v) node.setAttribute('href', `mailto:${v}`);
        });
    }

    // ---------------------------------------------------------------------
    // Estilos compartidos (banner de cookies, footer legal, campos obligatorios)
    // ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('gaby-legal-styles')) return;
        const style = document.createElement('style');
        style.id = 'gaby-legal-styles';
        style.textContent = `
            :root { --legal-gold: #d4af37; --legal-gold-soft: #f3d68a; --legal-bg: #111; --legal-text: #f5f1e8; --legal-muted: #b4ad9c; --legal-line: rgba(255,255,255,.1); --legal-required: #ff5f5f; }
            body.light-mode { --legal-bg: #fff; --legal-text: #111; --legal-muted: #555; --legal-line: rgba(0,0,0,.1); --legal-required: #d42c2c; }

            /* Campos obligatorios: asterisco de color en la etiqueta */
            .field:has(> :is(input, select, textarea):required) > label::after,
            .form-group:has(> :is(input, select, textarea):required) > label::after,
            .field:has(> :is(input, select, textarea):required) > .form-label::after,
            .form-group:has(> :is(input, select, textarea):required) > .form-label::after,
            .field:has(> .pw-wrap > input:required) > label::after,
            .form-group:has(> .pw-wrap > input:required) > .form-label::after,
            .form-group:has(> .pw-wrap > input:required) > label::after,
            .policy-check:has(> input:required) > span::after {
                content: " *"; color: var(--legal-required); font-weight: 800;
            }
            .required-legend { font-size: .8rem; color: var(--legal-muted); margin: 0 0 .25rem; }

            /* Resumen de la reserva */
            .booking-summary { border: 1px solid rgba(212,175,55,.3); background: rgba(212,175,55,.06); border-radius: 16px; padding: 1rem 1.1rem; margin-bottom: 1rem; font-size: .86rem; line-height: 1.5; }
            .booking-summary:empty { display: none; }
            .booking-summary-title { font-weight: 700; color: var(--legal-gold-soft); margin-bottom: .6rem; letter-spacing: .02em; }
            body.light-mode .booking-summary-title { color: #7a5c12; }
            .booking-summary dl { display: grid; gap: .45rem; margin: 0 0 .7rem; }
            .booking-summary dl > div { display: grid; grid-template-columns: minmax(120px, 34%) 1fr; gap: .75rem; }
            .booking-summary dt { color: var(--legal-muted); }
            .booking-summary dd { margin: 0; color: var(--legal-text); }
            .booking-summary a { color: var(--legal-gold); text-decoration: underline; }
            @media (max-width: 520px) { .booking-summary dl > div { grid-template-columns: 1fr; gap: .1rem; } }

            /* Casillas de consentimiento */
            .consent-box { display: grid; gap: .65rem; padding: .9rem 1rem; border-radius: 14px; border: 1px solid var(--legal-line); }
            .consent-box p { margin: 0; font-size: .82rem; line-height: 1.55; color: var(--legal-muted); }
            .consent-box a { color: var(--legal-gold); text-decoration: underline; }
            .consent-check { display: flex; gap: .6rem; align-items: flex-start; font-size: .85rem; line-height: 1.5; color: var(--legal-text); cursor: pointer; }
            .consent-check input { margin-top: .2rem; width: 17px; height: 17px; flex-shrink: 0; accent-color: #d4af37; }
            .consent-check:has(> input:required) > span::after { content: " *"; color: var(--legal-required); font-weight: 800; }
            .required-legend b { color: var(--legal-required); }

            /* Selects legibles en modo oscuro y claro */
            :root { color-scheme: dark; }
            body.light-mode { color-scheme: light; }
            select option, select optgroup { background-color: #161616; color: #f5f1e8; }
            body.light-mode select option, body.light-mode select optgroup { background-color: #fff; color: #111; }

            /* Banner de cookies */
            .cookie-banner { position: fixed; left: 1rem; right: 1rem; bottom: calc(1rem + env(safe-area-inset-bottom)); z-index: 5000; max-width: 760px; margin: 0 auto; background: var(--legal-bg); color: var(--legal-text); border: 1px solid rgba(212,175,55,.35); border-radius: 18px; box-shadow: 0 18px 50px rgba(0,0,0,.45); padding: 1.1rem 1.2rem; display: grid; gap: .9rem; font-family: 'Inter', system-ui, sans-serif; }
            @media (max-width: 968px) {
                .cookie-banner { left: .6rem; right: .6rem; bottom: calc(5.4rem + env(safe-area-inset-bottom)); padding: .85rem .9rem; gap: .6rem; border-radius: 16px; }
                .cookie-banner h2, .cookie-text-long { display: none; }
                .cookie-text-short { display: block !important; }
                .cookie-banner p { font-size: .8rem; line-height: 1.45; }
                .cookie-banner .cookie-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: .4rem; }
                .cookie-banner .cookie-btn { padding: .6rem .35rem; font-size: .72rem; line-height: 1.2; }
            }
            .cookie-banner h2 { font-size: 1rem; margin: 0; font-family: inherit; }
            .cookie-banner p { margin: 0; font-size: .88rem; line-height: 1.55; color: var(--legal-muted); }
            .cookie-banner a { color: var(--legal-gold); text-decoration: underline; }
            .cookie-text-short { display: none; }
            .cookie-actions { display: flex; flex-wrap: wrap; gap: .6rem; }
            .cookie-btn { flex: 1 1 160px; border-radius: 999px; padding: .8rem 1rem; font: inherit; font-size: .85rem; font-weight: 700; cursor: pointer; border: 1px solid rgba(212,175,55,.55); background: transparent; color: var(--legal-text); }
            .cookie-btn.solid { background: linear-gradient(135deg, #f6dfa0 0%, #d4af37 62%, #87640f 100%); color: #111; border-color: transparent; }
            .cookie-btn:focus-visible { outline: 2px solid var(--legal-gold); outline-offset: 2px; }

            .cookie-modal { position: fixed; inset: 0; z-index: 5100; background: rgba(0,0,0,.65); display: none; align-items: center; justify-content: center; padding: 1rem; font-family: 'Inter', system-ui, sans-serif; }
            .cookie-modal.open { display: flex; }
            .cookie-modal-card { background: var(--legal-bg); color: var(--legal-text); border: 1px solid rgba(212,175,55,.3); border-radius: 22px; width: min(560px, 100%); max-height: 90vh; overflow: auto; padding: 1.4rem; display: grid; gap: 1rem; }
            .cookie-modal-card h2 { margin: 0; font-size: 1.15rem; font-family: inherit; }
            .cookie-modal-card p { margin: 0; color: var(--legal-muted); font-size: .88rem; line-height: 1.55; }
            .cookie-cat { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; padding: .9rem 0; border-top: 1px solid var(--legal-line); }
            .cookie-cat strong { display: block; font-size: .92rem; margin-bottom: .2rem; }
            .cookie-cat small { color: var(--legal-muted); font-size: .8rem; line-height: 1.5; display: block; }
            .cookie-switch { position: relative; width: 46px; height: 26px; flex-shrink: 0; }
            .cookie-switch input { opacity: 0; width: 0; height: 0; }
            .cookie-switch span { position: absolute; inset: 0; border-radius: 999px; background: #555; transition: background .2s; cursor: pointer; }
            .cookie-switch span::before { content: ''; position: absolute; width: 20px; height: 20px; left: 3px; top: 3px; border-radius: 50%; background: #fff; transition: transform .2s; }
            .cookie-switch input:checked + span { background: var(--legal-gold); }
            .cookie-switch input:checked + span::before { transform: translateX(20px); }
            .cookie-switch input:disabled + span { opacity: .6; cursor: not-allowed; }
            .cookie-switch input:focus-visible + span { outline: 2px solid var(--legal-gold); outline-offset: 2px; }

            /* Mapa que requiere consentimiento */
            .consent-embed-placeholder { height: 100%; min-height: 240px; display: grid; place-items: center; text-align: center; gap: .8rem; padding: 1.5rem; background: rgba(255,255,255,.04); color: var(--legal-muted); font-size: .9rem; line-height: 1.6; }
            .consent-embed-placeholder button { border-radius: 999px; padding: .75rem 1.2rem; font: inherit; font-weight: 700; cursor: pointer; border: 0; background: linear-gradient(135deg, #f6dfa0 0%, #d4af37 62%, #87640f 100%); color: #111; }
        `;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Leyenda "* Campo obligatorio" en cada formulario con campos requeridos
    // ---------------------------------------------------------------------
    function addRequiredLegends() {
        document.querySelectorAll('form').forEach(form => {
            if (form.dataset.noRequiredLegend !== undefined) return;
            if (!form.querySelector('[required]') || form.querySelector('.required-legend')) return;
            const legend = document.createElement('p');
            legend.className = 'required-legend';
            legend.innerHTML = 'Los campos marcados con <b>*</b> son obligatorios.';
            form.insertBefore(legend, form.firstElementChild);
        });
    }

    // ---------------------------------------------------------------------
    // Consentimiento de cookies
    // ---------------------------------------------------------------------
    const CONSENT_KEY = 'gs_cookie_consent';
    const optionalCategories = [
        { id: 'functional', name: 'Funcionales', desc: 'Contenido de terceros que mejora la experiencia, como el mapa de Google Maps. Google puede usar sus propias cookies al cargarlo.' },
        { id: 'analytics', name: 'Analíticas', desc: 'Estadísticas de uso del sitio. Actualmente no usamos herramientas de analítica; si se añaden, solo se activarán con tu permiso.' }
    ];

    function readConsent() {
        try {
            const raw = localStorage.getItem(CONSENT_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed.version !== config.cookieVersion) return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function saveConsent(choices) {
        const record = {
            version: config.cookieVersion,
            necessary: true,
            functional: Boolean(choices.functional),
            analytics: Boolean(choices.analytics),
            savedAt: new Date().toISOString()
        };
        try { localStorage.setItem(CONSENT_KEY, JSON.stringify(record)); } catch (error) { /* almacenamiento bloqueado */ }
        hideBanner();
        closePreferences();
        window.dispatchEvent(new CustomEvent('gabyconsentchange', { detail: record }));
        applyConsentEmbeds();
        return record;
    }

    function hasConsent(category) {
        if (category === 'necessary') return true;
        const consent = readConsent();
        return Boolean(consent && consent[category]);
    }

    // Mientras el banner esta visible, la página reserva espacio abajo para que el banner
    // nunca tape botones del contenido (por ejemplo "Confirmar solicitud de cita").
    let bannerObserver = null;
    let basePaddingBottom = null;

    function reserveSpaceForBanner(banner) {
        if (basePaddingBottom === null) basePaddingBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
        const apply = () => {
            const gap = window.innerHeight - banner.getBoundingClientRect().top;
            document.body.style.paddingBottom = `${Math.max(basePaddingBottom, gap + 16)}px`;
        };
        apply();
        if (window.ResizeObserver) {
            bannerObserver = new ResizeObserver(apply);
            bannerObserver.observe(banner);
        }
        window.addEventListener('resize', apply);
    }

    function hideBanner() {
        document.getElementById('cookie-banner')?.remove();
        if (bannerObserver) bannerObserver.disconnect();
        if (basePaddingBottom !== null) document.body.style.paddingBottom = '';
    }

    function showBanner() {
        if (document.getElementById('cookie-banner')) return;
        const banner = document.createElement('section');
        banner.id = 'cookie-banner';
        banner.className = 'cookie-banner';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', 'Aviso de cookies');
        banner.innerHTML = `
            <h2>Usamos cookies y almacenamiento local</h2>
            <p class="cookie-text-long">Usamos almacenamiento estrictamente necesario para que puedas reservar y para recordar tus preferencias. Con tu permiso, también cargamos contenido de terceros (como el mapa). Puedes aceptar, rechazar lo no esencial o escoger por categoría. Más información en la <a href="cookies.html">Política de Cookies</a>.</p>
            <p class="cookie-text-short">Usamos lo necesario para que el sitio funcione y, con tu permiso, el mapa de Google. <a href="cookies.html">Más información</a></p>
            <div class="cookie-actions">
                <button type="button" class="cookie-btn solid" data-cookie-accept>Aceptar todas</button>
                <button type="button" class="cookie-btn solid" data-cookie-reject>Rechazar no esenciales</button>
                <button type="button" class="cookie-btn" data-cookie-customize>Personalizar</button>
            </div>
        `;
        document.body.appendChild(banner);
        reserveSpaceForBanner(banner);
        banner.querySelector('[data-cookie-accept]').addEventListener('click', () => saveConsent({ functional: true, analytics: true }));
        banner.querySelector('[data-cookie-reject]').addEventListener('click', () => saveConsent({}));
        banner.querySelector('[data-cookie-customize]').addEventListener('click', openPreferences);
    }

    function ensureModal() {
        let modal = document.getElementById('cookie-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'cookie-modal';
        modal.className = 'cookie-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'cookie-modal-title');
        modal.innerHTML = `
            <div class="cookie-modal-card">
                <h2 id="cookie-modal-title">Preferencias de cookies</h2>
                <p>Escoge qué categorías permites. Las opcionales están desactivadas hasta que las actives. Puedes cambiar esto cuando quieras desde "Preferencias de cookies" en el pie de página.</p>
                <div class="cookie-cat">
                    <div><strong>Estrictamente necesarias</strong><small>Reservaciones, preferencias, seguridad y recordar esta misma elección. Siempre activas porque sin ellas el sitio no funciona.</small></div>
                    <label class="cookie-switch" aria-label="Necesarias (siempre activas)"><input type="checkbox" checked disabled><span></span></label>
                </div>
                ${optionalCategories.map(cat => `
                    <div class="cookie-cat">
                        <div><strong>${cat.name}</strong><small>${cat.desc}</small></div>
                        <label class="cookie-switch" aria-label="${cat.name}"><input type="checkbox" data-cookie-cat="${cat.id}"><span></span></label>
                    </div>
                `).join('')}
                <div class="cookie-actions">
                    <button type="button" class="cookie-btn solid" data-cookie-save>Guardar mis preferencias</button>
                    <button type="button" class="cookie-btn" data-cookie-reject-all>Rechazar no esenciales</button>
                    <button type="button" class="cookie-btn" data-cookie-accept-all>Aceptar todas</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', event => { if (event.target === modal) closePreferences(); });
        modal.addEventListener('keydown', event => { if (event.key === 'Escape') closePreferences(); });
        modal.querySelector('[data-cookie-save]').addEventListener('click', () => {
            const choices = {};
            modal.querySelectorAll('[data-cookie-cat]').forEach(input => { choices[input.dataset.cookieCat] = input.checked; });
            saveConsent(choices);
        });
        modal.querySelector('[data-cookie-reject-all]').addEventListener('click', () => saveConsent({}));
        modal.querySelector('[data-cookie-accept-all]').addEventListener('click', () => saveConsent({ functional: true, analytics: true }));
        return modal;
    }

    function openPreferences() {
        const modal = ensureModal();
        const consent = readConsent() || {};
        modal.querySelectorAll('[data-cookie-cat]').forEach(input => { input.checked = Boolean(consent[input.dataset.cookieCat]); });
        modal.classList.add('open');
        modal.querySelector('[data-cookie-save]').focus();
    }

    function closePreferences() {
        document.getElementById('cookie-modal')?.classList.remove('open');
    }

    // Contenido de terceros (p. ej. Google Maps) que solo se carga con consentimiento "functional",
    // o si la persona lo pide explicitamente con el boton.
    function loadEmbed(node) {
        if (node.dataset.loaded) return;
        const iframe = document.createElement('iframe');
        iframe.src = node.dataset.src;
        iframe.title = node.dataset.title || 'Contenido externo';
        iframe.width = '100%';
        iframe.height = '100%';
        iframe.style.border = '0';
        iframe.loading = 'lazy';
        iframe.referrerPolicy = 'no-referrer-when-downgrade';
        node.innerHTML = '';
        node.appendChild(iframe);
        node.dataset.loaded = 'true';
    }

    function applyConsentEmbeds() {
        document.querySelectorAll('[data-consent-embed]').forEach(node => {
            if (node.dataset.loaded) return;
            if (hasConsent(node.dataset.consentEmbed)) {
                loadEmbed(node);
                return;
            }
            if (node.querySelector('.consent-embed-placeholder')) return;
            node.innerHTML = `
                <div class="consent-embed-placeholder">
                    <div>El mapa lo provee Google Maps, que puede usar sus propias cookies.<br>Por tu privacidad no lo cargamos sin tu permiso.</div>
                    <button type="button">Mostrar mapa</button>
                </div>
            `;
            node.querySelector('button').addEventListener('click', () => loadEmbed(node));
        });
    }

    function bindPreferenceLinks() {
        document.addEventListener('click', event => {
            const trigger = event.target.closest('[data-cookie-prefs]');
            if (!trigger) return;
            event.preventDefault();
            openPreferences();
        });
    }

    // Cuando el navegador bloquea un envio por un campo obligatorio vacio, se avisa con un mensaje claro
    // (antes parecia que el boton "no hacia nada").
    function bindInvalidFieldMessages() {
        let lastForm = null;
        let lastAt = 0;
        document.addEventListener('invalid', event => {
            const field = event.target;
            const form = field.form;
            const now = Date.now();
            if (form === lastForm && now - lastAt < 800) return; // un solo mensaje por intento
            lastForm = form;
            lastAt = now;
            const container = field.closest('.field, .form-group, .policy-check, .consent-check');
            const label = container ? (container.querySelector('label, .form-label, span') || container).textContent : '';
            const name = label.replace(/\s*\*\s*$/, '').trim();
            const message = field.dataset.invalidMessage
                ? field.dataset.invalidMessage
                : field.validity && field.validity.customError
                ? escapeHtml(field.validationMessage)
                : field.type === 'checkbox'
                ? 'Debes marcar la casilla de confirmación para continuar.'
                : `Completa el campo obligatorio${name ? `: <strong>${escapeHtml(name.slice(0, 60))}</strong>` : ''}${/[?.!]$/.test(name) ? '' : '.'}`;
            if (window.GabyToast) window.GabyToast.show(message, 'warning');
        }, true);
    }

    function init() {
        injectStyles();
        bindInvalidFieldMessages();
        document.querySelectorAll('[data-legal-draft]').forEach(node => { node.hidden = !config.draft; });
        fillPlaceholders();
        addRequiredLegends();
        bindPreferenceLinks();
        applyConsentEmbeds();
        if (!readConsent()) showBanner();
    }

    // Resumen de la política que se muestra justo antes de confirmar una cita.
    // Acepta un servicio o una lista de servicios (selección multiple).
    function bookingSummaryHtml(serviceOrList) {
        const list = (Array.isArray(serviceOrList) ? serviceOrList : [serviceOrList]).filter(Boolean);
        const total = window.GabyForms ? window.GabyForms.estimateTotal(list).label : '';
        const rows = [
            [list.length > 1 ? 'Servicios' : 'Servicio', list.length ? list.map(item => `${escapeHtml(item.name)} — <strong>${escapeHtml(item.price || '')}</strong>`).join('<br>') : 'Escoge al menos un servicio.'],
            ...(list.length > 1 && total ? [['Total estimado', `<strong>${escapeHtml(total)}</strong>`]] : []),
            ['Pago', 'Los servicios se pagan en la barbería o directamente al barbero. No se requiere depósito y esta página no procesa pagos.'],
            ['Cancelación gratuita', `Con ${display('freeCancelHours')} horas o más de anticipación.`],
            ['Cancelación tardía', `Si cancelas con menos de ${display('freeCancelHours')} horas de anticipación, el cargo es ${display('lateCancelFee')}.`],
            ['No-Show', display('noShowConsequence')],
            ['Tardanza máxima', `${display('graceMinutes')} minutos. Después, el barbero decide si te atiende, reprograma o marca no-show.`],
            ['Cambios', display('rescheduleRule')]
        ];
        return `
            <div class="booking-summary-title">Resumen antes de confirmar</div>
            <dl>${rows.map(([label, text]) => `<div><dt>${label}</dt><dd>${text}</dd></div>`).join('')}</dl>
            <a href="policies.html" target="_blank">Ver la Política de Reservaciones completa</a>
        `;
    }

    window.GabyLegal = {
        config,
        value,
        display,
        fillPlaceholders,
        bookingSummaryHtml,
        hasConsent,
        readConsent,
        openPreferences
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
