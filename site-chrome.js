(function () {
    // Header (menu completo en computadora) y footer comunes a todas las páginas publicas.
    // - Header: se inserta arriba en cada página, salvo en el index (que tiene el suyo: <body data-site-header="off">).
    //   En celular (<= 968px) se usa una barra superior propia (logo + "Volver" en las subpáginas)
    //   y la barra de navegación inferior de cada página.
    //   La barra superior vieja de cada página (data-mobile-topbar) se oculta siempre.
    // - Subpáginas de Configuración: muestran "Volver a Configuración" (en computadora, debajo del menú).
    // - Footer: se dibuja dentro de <footer data-site-footer></footer>.
    const LOGO = 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972135/b3a13ac1-cac2-4367-9c0d-5946397d4ff9-removebg-preview_xhkncw.png';
    const DEV_LOGO = 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1781464069/favicon-32x32_flnhtq.png';

    // Carpeta desde la que se cargó este archivo: así el manifiesto, el service worker
    // y notifications.js se resuelven bien también desde las subcarpetas (staff/).
    const SCRIPT_BASE = (() => {
        try {
            const src = document.currentScript && document.currentScript.src;
            if (src) return src.slice(0, src.lastIndexOf('/') + 1);
        } catch (_) { /* sin currentScript: rutas relativas */ }
        return '';
    })();

    // Idioma escogido (Configuración → Idioma y tema). Todo lo que dibuja este archivo sale en ese idioma.
    const LANG = (() => {
        try { return (window.GabyData && window.GabyData.getState().settings.defaultLanguage) === 'en' ? 'en' : 'es'; } catch (_) { return 'es'; }
    })();
    const TEXT = {
        es: {
            home: 'Inicio', services: 'Servicios', book: 'Reservar', barbers: 'Barberos', news: 'Noticias', contact: 'Contacto',
            settings: 'Configuración', bookNow: 'Reservar cita', back: 'Volver a', goHome: 'Goat Style Salon, ir al inicio',
            tabHome: 'Inicio', tabServices: 'Servicios', tabBooking: 'Cita', tabMyBooking: 'Mi cita', tabNews: 'Noticias', tabSettings: 'Config', tabBarbers: 'Barberos',
            footerAbout: 'Cortes, color, tratamientos y una experiencia VIP diseñada para que cada visita se sienta especial.',
            footerNews: 'Noticias de la barbería', footerSupport: 'Contacto y soporte', legal: 'Legal', cookiePrefs: 'Preferencias de cookies',
            development: 'Desarrollo', weAccept: 'Aceptamos:', rights: 'Todos los derechos reservados.',
            terms: 'Términos y Condiciones', privacy: 'Política de Privacidad', cookies: 'Política de Cookies', bookingPolicy: 'Política de Reservaciones', notices: 'Avisos legales', notifications: 'Notificaciones',
            cash: 'Efectivo', visaMc: 'Visa y Mastercard', reportProblem: 'Reportar un problema',
            mainMenu: 'Menú principal', backShort: 'Volver', openingHours: 'Horario'
        },
        en: {
            home: 'Home', services: 'Services', book: 'Book', barbers: 'Barbers', news: 'News', contact: 'Contact',
            settings: 'Settings', bookNow: 'Book now', back: 'Back to', goHome: 'Goat Style Salon, go to home page',
            tabHome: 'Home', tabServices: 'Services', tabBooking: 'Booking', tabMyBooking: 'My booking', tabNews: 'News', tabSettings: 'Settings', tabBarbers: 'Barbers',
            footerAbout: 'Cuts, color, treatments and a VIP experience designed to make every visit feel special.',
            footerNews: 'Barbershop news', footerSupport: 'Contact and support', legal: 'Legal', cookiePrefs: 'Cookie preferences',
            development: 'Development', weAccept: 'We accept:', rights: 'All rights reserved.',
            terms: 'Terms and Conditions', privacy: 'Privacy Policy', cookies: 'Cookie Policy', bookingPolicy: 'Booking Policy', notices: 'Legal notices', notifications: 'Notifications',
            cash: 'Cash', visaMc: 'Visa and Mastercard', reportProblem: 'Report a problem',
            mainMenu: 'Main menu', backShort: 'Back', openingHours: 'Opening hours'
        }
    };
    const t = key => TEXT[LANG][key] || TEXT.es[key] || key;

    // Métodos de pago aceptados en la barbería (logos del pie de página).
    const PAYMENT_LOGOS = [
        { label: t('visaMc'), src: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1788914574/Visa-MasterCard-1024x393-removebg-preview_ilnpmg.png' },
        { label: 'Apple Pay', icon: 'fab fa-apple-pay' },
        { label: 'PayPal', src: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1788914322/paypal-784404_1280-1024x512-1-removebg-preview_xa8pca.png' },
        { label: 'ATH Móvil', src: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1788914217/ATHM_logo-vertical-01-1200x1076-removebg-preview_qjtvqp.png' },
        { label: t('cash'), src: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1792113468/pago_efectivo-removebg-preview_duoi1v.png' }
    ];

    const navLinks = [
        { href: 'index.html', label: t('home'), match: ['', 'index.html'] },
        { href: 'services.html', label: t('services'), match: ['services.html'] },
        { href: 'booking.html', label: t('book'), match: ['booking.html'] },
        { href: 'barbers.html', label: t('barbers'), match: ['barbers.html', 'barber.html'] },
        { href: 'news.html', label: t('news'), match: ['news.html'] },
        { href: 'settings.html', label: t('settings'), match: ['settings.html', 'settings-app.html', 'settings-notifications.html'] },
        { href: 'support.html#contacto', label: t('contact'), match: ['support.html'] }
    ];

    const legalLinks = [
        { href: 'terminos.html', label: t('terms') },
        { href: 'privacidad.html', label: t('privacy') },
        { href: 'cookies.html', label: t('cookies') },
        { href: 'policies.html', label: t('bookingPolicy') },
        { href: 'avisos.html', label: t('notices') }
    ];

    // Página "padre" de cada subpágina, para el botón Volver.
    const PARENTS = {
        'settings-app.html': { href: 'settings.html', label: t('settings') },
        'barber-application.html': { href: 'settings.html', label: t('settings') },
        'policies.html': { href: 'settings.html', label: t('settings') },
        'support.html': { href: 'settings.html', label: t('settings') },
        'app-info.html': { href: 'settings.html', label: t('settings') },
        'avisos.html': { href: 'settings.html', label: t('settings') },
        'settings-notifications.html': { href: 'settings.html', label: t('settings') },
        'cookies.html': { href: 'settings.html', label: t('settings') },
        'privacidad.html': { href: 'settings.html', label: t('settings') },
        'terminos.html': { href: 'settings.html', label: t('settings') },
        'barber.html': { href: 'barbers.html', label: t('barbers') }
    };

    function currentPage() {
        return window.location.pathname.split('/').pop() || '';
    }

    function injectStyles() {
        if (document.getElementById('site-chrome-styles')) return;
        const style = document.createElement('style');
        style.id = 'site-chrome-styles';
        style.textContent = `
            .site-header { position: sticky; top: 0; z-index: 900; display: flex; align-items: center; justify-content: space-between; gap: 2rem; padding: 1.1rem 3rem; background: rgba(10,10,10,.82); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,.06); font-family: 'Inter', system-ui, sans-serif; }
            body.light-mode .site-header { background: rgba(255,255,255,.85); border-bottom-color: rgba(0,0,0,.06); }
            .site-header-logo { font-family: 'Cinzel', serif; font-weight: 800; font-size: 1.25rem; letter-spacing: 3px; color: #d4af37; text-decoration: none; white-space: nowrap; }
            .site-header-links { display: flex; align-items: center; gap: 1.8rem; list-style: none; margin: 0; padding: 0; }
            .site-header-links a { color: #fff; font-size: .78rem; font-weight: 500; text-transform: uppercase; letter-spacing: 1.5px; text-decoration: none; padding: .35rem 0; border-bottom: 2px solid transparent; transition: color .2s, border-color .2s; }
            body.light-mode .site-header-links a { color: #111; }
            .site-header-links a:hover { color: #d4af37; }
            .site-header-links a.active { color: #d4af37; border-bottom-color: #d4af37; }
            .site-header-actions { display: flex; align-items: center; gap: .75rem; }
            .site-header-icon { width: 38px; height: 38px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(212,175,55,.35); color: #d4af37; text-decoration: none; }
            .site-header-icon:hover { background: #d4af37; color: #111; }
            .site-header-bell { position: relative; }
            .site-bell-badge { position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; background: #d4af37; color: #111; font-size: .65rem; font-weight: 800; line-height: 18px; text-align: center; display: none; }
            .site-bell-badge.show { display: inline-block; }
            .site-mobilebar-btn.site-header-bell { position: relative; }
            .site-header-cta { display: inline-flex; align-items: center; gap: .5rem; padding: .7rem 1.4rem; border-radius: 999px; font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; text-decoration: none; color: #111; background: linear-gradient(135deg, #f6dfa0 0%, #d4af37 62%, #87640f 100%); }
            .site-header-cta:hover { filter: brightness(1.06); color: #111; }
            .site-header a:focus-visible { outline: 2px solid #d4af37; outline-offset: 3px; }
            @media (max-width: 1100px) { .site-header { padding: 1rem 1.5rem; } .site-header-links { gap: .8rem; } }
            @media (max-width: 968px) { .site-header { display: none; } }
            [data-mobile-topbar] { display: none !important; }
            /* Que la barra fija de arriba no tape lo que se muestra al desplazarse (enlaces #, campos con error). */
            html { scroll-padding-top: 88px; }
            @media (max-width: 968px) { html { scroll-padding-top: 72px; scroll-padding-bottom: 100px; } }

            .site-mobilebar { display: none; position: sticky; top: 0; z-index: 900; align-items: center; gap: .7rem; padding: .7rem 1rem; padding-top: calc(.7rem + env(safe-area-inset-top)); background: rgba(10,10,10,.9); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); border-bottom: 1px solid rgba(212,175,55,.16); font-family: 'Inter', system-ui, sans-serif; }
            body.light-mode .site-mobilebar { background: rgba(255,255,255,.92); border-bottom-color: rgba(0,0,0,.08); }
            .site-mobilebar-brand { display: flex; align-items: center; gap: .55rem; min-width: 0; flex: 1; color: #d4af37; text-decoration: none; }
            .site-mobilebar-brand img { width: 34px; height: 34px; object-fit: contain; filter: drop-shadow(0 0 10px rgba(212,175,55,.3)); }
            .site-mobilebar-brand span { font-family: 'Cinzel', serif; font-weight: 800; font-size: 1rem; letter-spacing: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .site-mobilebar-btn { flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(212,175,55,.35); color: #d4af37; text-decoration: none; background: transparent; }
            .site-mobilebar-btn:active { background: rgba(212,175,55,.15); }
            .site-mobilebar a:focus-visible { outline: 2px solid #d4af37; outline-offset: 2px; }
            @media (max-width: 968px) { .site-mobilebar { display: flex; } }

            /* Barra de navegación inferior completa (páginas que no traen sus propios estilos). */
            .site-bottom-nav { display: none; }
            @media (max-width: 968px) {
                .site-bottom-nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2500; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .25rem; padding: .8rem .7rem calc(.8rem + env(safe-area-inset-bottom)); background: rgba(8,8,8,.96); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-top: 1px solid rgba(212,175,55,.15); box-shadow: 0 -12px 30px rgba(0,0,0,.3); font-family: 'Inter', system-ui, sans-serif; }
                .site-bottom-nav a { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .3rem; min-width: 0; color: #d8d2c3; font-size: .68rem; font-weight: 600; letter-spacing: .02em; text-decoration: none; }
                .site-bottom-nav i { color: #d4af37; font-size: 1.05rem; }
                .site-bottom-nav a.active { color: #d4af37; }
                body.light-mode .site-bottom-nav { background: rgba(255,255,255,.96); border-top-color: rgba(0,0,0,.08); box-shadow: 0 -12px 30px rgba(0,0,0,.12); }
                body.light-mode .site-bottom-nav a { color: #6b7280; }
                body.light-mode .site-bottom-nav a.active { color: #7a5c12; }
            }
            /* Ventana para escoger el idioma la primera vez que se abre la página. */
            .site-lang { position: fixed; inset: 0; z-index: 6000; display: flex; align-items: center; justify-content: center; padding: 1.25rem; background: rgba(0,0,0,.78); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); font-family: 'Inter', system-ui, sans-serif; }
            .site-lang-card { width: min(420px, 100%); background: linear-gradient(180deg, #151515, #0b0b0b); color: #f5f1e8; border: 1px solid rgba(212,175,55,.4); border-radius: 24px; padding: 2rem 1.5rem 1.6rem; text-align: center; display: grid; gap: 1rem; box-shadow: 0 24px 60px rgba(0,0,0,.55); }
            body.light-mode .site-lang-card { background: #fff; color: #111; }
            .site-lang-card img.site-lang-logo { width: 78px; height: 78px; object-fit: contain; margin: 0 auto; filter: drop-shadow(0 0 16px rgba(212,175,55,.35)); }
            .site-lang-card h2 { margin: 0; font-family: 'Cinzel', serif; color: #d4af37; font-size: 1.35rem; }
            .site-lang-card p { margin: 0; opacity: .8; font-size: .92rem; line-height: 1.5; }
            .site-lang-options { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-top: .25rem; }
            .site-lang-options button { display: grid; justify-items: center; gap: .55rem; padding: 1rem .5rem; border-radius: 18px; border: 1px solid rgba(212,175,55,.35); background: rgba(212,175,55,.06); color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
            .site-lang-options button:hover, .site-lang-options button:focus-visible { border-color: #d4af37; background: rgba(212,175,55,.16); outline: none; }
            .site-lang-options img { width: 48px; height: 32px; object-fit: cover; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.3); }

            /* Horario de la barbería en forma de tabla (perfiles, lista de barberos, inicio y reservas). */
            .site-footer .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
            .gs-hours { display: grid; gap: 0; margin: 0; width: 100%; font-family: 'Inter', system-ui, sans-serif; }
            .gs-hours div { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; padding: .5rem 0; border-bottom: 1px solid rgba(212,175,55,.14); }
            .gs-hours div:last-child { border-bottom: 0; }
            .gs-hours dt { color: inherit; font-weight: 600; font-size: .9rem; margin: 0; }
            .gs-hours dd { margin: 0; color: #f3d68a; font-weight: 700; font-size: .9rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
            .gs-hours .gs-hours-closed dd { color: #f07171; }
            body.light-mode .gs-hours dd { color: #7a5c12; }
            body.light-mode .gs-hours .gs-hours-closed dd { color: #b42318; }
            .gs-hours.compact div { padding: .3rem 0; }
            .gs-hours.compact dt, .gs-hours.compact dd { font-size: .8rem; }

            .site-crumb { max-width: 1200px; margin: 0 auto; padding: 1.1rem 3rem 0; font-family: 'Inter', system-ui, sans-serif; }
            .site-crumb a { display: inline-flex; align-items: center; gap: .5rem; color: #d4af37; font-size: .8rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; text-decoration: none; }
            .site-crumb a:hover { text-decoration: underline; }
            body.light-mode .site-crumb a { color: #7a5c12; }
            @media (max-width: 968px) { .site-crumb { display: none; } }

            .site-footer { background: linear-gradient(180deg, #0a0a0a 0%, #050505 100%); padding: 4rem 2rem 2rem; border-top: 1px solid rgba(212,175,55,.12); color: #b6b6b6; font-family: 'Inter', system-ui, sans-serif; margin-top: 3rem; }
            body.light-mode .site-footer { background: #fff; border-top-color: rgba(0,0,0,.06); color: #555; }
            .site-footer-inner { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1.4fr 1fr 1.2fr 1fr; gap: 2.5rem; align-items: start; }
            .site-footer-brand img { width: 88px; height: auto; margin-bottom: 1rem; filter: drop-shadow(0 0 18px rgba(212,175,55,.28)); }
            .site-footer-brand h3 { font-family: 'Cinzel', serif; font-size: 1.2rem; color: #f5f1e8; margin: 0 0 .75rem; }
            body.light-mode .site-footer-brand h3 { color: #111; }
            .site-footer p { margin: 0; line-height: 1.8; font-size: .9rem; }
            .site-footer h4 { font-family: 'Cinzel', serif; color: #d4af37; margin: 0 0 1rem; font-size: 1rem; }
            .site-footer-col { display: grid; gap: .35rem; justify-items: start; }
            .site-footer-col a, .site-footer-col button { color: inherit; text-decoration: none; font: inherit; font-size: .9rem; line-height: 1.6; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
            .site-footer-col a:hover, .site-footer-col button:hover { color: #f3d68a; text-decoration: underline; }
            body.light-mode .site-footer-col a:hover, body.light-mode .site-footer-col button:hover { color: #7a5c12; }
            .site-footer-credit { display: inline-flex; align-items: center; gap: .6rem; color: #f3d68a !important; font-weight: 600; }
            body.light-mode .site-footer-credit { color: #7a5c12 !important; }
            .site-footer-credit img { width: 28px; height: 28px; border-radius: 8px; }
            .site-footer-payments { max-width: 1200px; margin: 2.5rem auto 0; padding-top: 1.5rem; border-top: 1px solid rgba(212,175,55,.12); display: flex; align-items: center; justify-content: center; gap: 1.3rem; flex-wrap: wrap; font-size: .85rem; }
            .site-footer-pay { display: inline-flex; align-items: center; justify-content: center; height: 44px; }
            .site-footer-pay img { display: block; height: 40px; width: auto; max-width: 120px; object-fit: contain; }
            .site-footer-payments .fa-apple-pay { font-size: 2.4rem; color: #e8e8e8; }
            body.light-mode .site-footer-payments .fa-apple-pay { color: #1d1d1f; }
            .site-footer-copy { text-align: center; font-size: .8rem; margin-top: 1.25rem; }
            @media (max-width: 968px) { .site-footer-inner { grid-template-columns: 1fr 1fr; } .site-footer-brand { grid-column: 1 / -1; } }
            @media (max-width: 560px) { .site-footer { padding: 3rem 1.25rem 1.5rem; } .site-footer-inner { grid-template-columns: 1fr; gap: 2rem; } }
        `;
        document.head.appendChild(style);
    }

    function renderHeader() {
        if (document.body.dataset.siteHeader === 'off' || document.querySelector('.site-header')) return;
        const page = currentPage();
        const header = document.createElement('header');
        header.className = 'site-header';
        header.innerHTML = `
            <a class="site-header-logo" href="index.html">GOAT STYLE SALON</a>
            <nav aria-label="${t('mainMenu')}">
                <ul class="site-header-links">
                    ${navLinks.map(link => `<li><a href="${link.href}" class="${link.match.includes(page) ? 'active' : ''}" ${link.match.includes(page) ? 'aria-current="page"' : ''}>${link.label}</a></li>`).join('')}
                </ul>
            </nav>
            <div class="site-header-actions">
                <a class="site-header-icon site-header-bell" href="notificaciones.html" title="${t('notifications')}" aria-label="${t('notifications')}"><i class="fas fa-bell"></i><span class="site-bell-badge" data-bell-badge hidden></span></a>
                <a class="site-header-icon" href="settings.html" title="${t('settings')}" aria-label="${t('settings')}"><i class="fas fa-gear"></i></a>
                <a class="site-header-cta" href="booking.html"><i class="fas fa-calendar-check"></i>${t('bookNow')}</a>
            </div>
        `;
        document.body.insertBefore(header, document.body.firstChild);
    }

    // Barra superior del celular: igual en todas las páginas (menos el inicio, que tiene la suya).
    function renderMobileBar() {
        if (document.body.dataset.siteHeader === 'off' || document.querySelector('.site-mobilebar')) return;
        const parent = PARENTS[currentPage()];
        const bar = document.createElement('div');
        bar.className = 'site-mobilebar';
        bar.innerHTML = `
            ${parent ? `<a class="site-mobilebar-btn" href="${parent.href}" aria-label="${t('back')} ${parent.label}"><i class="fas fa-chevron-left"></i></a>` : ''}
            <a class="site-mobilebar-brand" href="index.html" aria-label="${t('goHome')}">
                <img src="${LOGO}" alt="">
                <span>GOAT STYLE SALON</span>
            </a>
            <a class="site-mobilebar-btn site-header-bell" href="notificaciones.html" aria-label="${t('notifications')}"><i class="fas fa-bell"></i><span class="site-bell-badge" data-bell-badge hidden></span></a>
            <a class="site-mobilebar-btn" href="index.html" aria-label="${t('home')}"><i class="fas fa-house"></i></a>
        `;
        const header = document.querySelector('.site-header');
        if (header) header.after(bar);
        else document.body.insertBefore(bar, document.body.firstChild);
        if (parent) {
            const crumb = document.createElement('nav');
            crumb.className = 'site-crumb';
            crumb.setAttribute('aria-label', t('backShort'));
            crumb.innerHTML = `<a href="${parent.href}"><i class="fas fa-arrow-left"></i>${t('back')} ${parent.label}</a>`;
            bar.after(crumb);
        }
    }

    // Horario de la barbería (igual para todos los barberos). Se muestra como tabla: días y horas.
    const SCHEDULE_ROWS = {
        es: [['Martes a jueves', '8:00 AM – 6:00 PM'], ['Viernes', '8:00 AM – 8:00 PM'], ['Sábado', '7:00 AM – 5:00 PM'], ['Domingo y lunes', 'Cerrado', true]],
        en: [['Tuesday to Thursday', '8:00 AM – 6:00 PM'], ['Friday', '8:00 AM – 8:00 PM'], ['Saturday', '7:00 AM – 5:00 PM'], ['Sunday and Monday', 'Closed', true]]
    };

    function scheduleHtml(options) {
        const lang = (window.GabyData && window.GabyData.getState().settings.defaultLanguage) === 'en' ? 'en' : 'es';
        const compact = options && options.compact;
        return `<dl class="gs-hours${compact ? ' compact' : ''}" aria-label="${TEXT[lang].openingHours}">${SCHEDULE_ROWS[lang]
            .map(([days, hours, closed]) => `<div${closed ? ' class="gs-hours-closed"' : ''}><dt>${days}</dt><dd>${hours}</dd></div>`).join('')}</dl>`;
    }

    window.GabySchedule = { html: scheduleHtml, rows: lang => SCHEDULE_ROWS[lang === 'en' ? 'en' : 'es'] };
    injectStyles();

    // Primera visita: se pregunta el idioma una sola vez (se guarda en este navegador).
    const LANG_KEY = 'gs_language_chosen';
    const FLAGS = {
        es: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972287/Flag_of_Puerto_Rico.svg_awwgvz.webp',
        en: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972299/download_z6ticp.webp'
    };

    function askLanguage() {
        let chosen = false;
        try { chosen = Boolean(localStorage.getItem(LANG_KEY)); } catch (_) { return; }
        if (chosen || document.querySelector('.site-lang')) return;
        const modal = document.createElement('div');
        modal.className = 'site-lang';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'site-lang-title');
        modal.innerHTML = `
            <div class="site-lang-card">
                <img class="site-lang-logo" src="${LOGO}" alt="Goat Style Salon">
                <h2 id="site-lang-title">Escoge tu idioma · Choose your language</h2>
                <p>Puedes cambiarlo después en Configuración.<br>You can change it later in Settings.</p>
                <div class="site-lang-options">
                    <button type="button" data-lang="es"><img src="${FLAGS.es}" alt="">Español</button>
                    <button type="button" data-lang="en"><img src="${FLAGS.en}" alt="">English</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('[data-lang="es"]').focus();
        modal.querySelectorAll('[data-lang]').forEach(button => button.addEventListener('click', () => {
            const lang = button.dataset.lang;
            let current = 'es';
            try { localStorage.setItem(LANG_KEY, lang); } catch (_) { /* almacenamiento bloqueado */ }
            if (window.GabyData) {
                current = window.GabyData.getState().settings.defaultLanguage || 'es';
                window.GabyData.updateState(state => { state.settings.defaultLanguage = lang; });
            }
            modal.remove();
            // Cada página traduce sus textos al cargar; si cambió el idioma se vuelve a abrir.
            if (lang !== current) window.location.reload();
        }));
    }

    // Si este navegador tiene una cita próxima, la pestaña "Cita" pasa a decir "Mi cita".
    function updateBookingTab() {
        let mine = [];
        try { mine = JSON.parse(localStorage.getItem('gs_my_appointments') || '[]'); } catch (_) { mine = []; }
        const now = Date.now();
        const hasActive = Array.isArray(mine) && mine.some(item => item && item.dateTime && new Date(item.dateTime).getTime() > now && !['CANCELADA', 'RECHAZADA'].includes(item.status));
        const tabs = { 'index.html': 'tabHome', '#hero': 'tabHome', 'services.html': 'tabServices', 'barbers.html': 'tabBarbers', 'news.html': 'tabNews', 'settings.html': 'tabSettings' };
        document.querySelectorAll('.mobile-bottom-nav a').forEach(link => {
            const label = link.querySelector('span');
            const href = link.getAttribute('href') || '';
            if (!label) return;
            if (href.startsWith('booking.html')) label.textContent = t(hasActive ? 'tabMyBooking' : 'tabBooking');
            else if (tabs[href]) label.textContent = t(tabs[href]);
        });
    }

    function renderFooters() {
        const year = (window.GabyLegal && window.GabyLegal.value('year')) || String(new Date().getFullYear());
        const name = (window.GabyLegal && window.GabyLegal.value('tradeName')) || 'Goat Style Salon';
        document.querySelectorAll('[data-site-footer]').forEach(footer => {
            footer.className = 'site-footer';
            footer.innerHTML = `
                <div class="site-footer-inner">
                    <div class="site-footer-brand">
                        <img src="${LOGO}" alt="Logo ${name}">
                        <h3>${name.toUpperCase()}</h3>
                        <p>${t('footerAbout')}</p>
                    </div>
                    <div class="site-footer-col">
                        <h4>${t('contact')}</h4>
                        <a href="tel:+17872181068">787-218-1068</a>
                        <p>Barranquitas, Puerto Rico</p>
                        <a href="news.html">${t('footerNews')}</a>
                        <a href="support.html#contacto">${t('footerSupport')}</a>
                        <a href="support.html#reporte">${t('reportProblem')}</a>
                    </div>
                    <div class="site-footer-col">
                        <h4>${t('legal')}</h4>
                        ${legalLinks.map(link => `<a href="${link.href}">${link.label}</a>`).join('')}
                        <button type="button" data-cookie-prefs>${t('cookiePrefs')}</button>
                    </div>
                    <div class="site-footer-col">
                        <h4>${t('development')}</h4>
                        <a class="site-footer-credit" href="https://angeltechsolutions.dev/" target="_blank" rel="noreferrer"><img src="${DEV_LOGO}" alt="">Angel Tech Solutions</a>
                    </div>
                </div>
                <div class="site-footer-payments">
                    <span>${t('weAccept')}</span>
                    ${PAYMENT_LOGOS.map(logo => logo.icon
                        ? `<span class="site-footer-pay" title="${logo.label}"><i class="${logo.icon}" aria-hidden="true"></i><span class="sr-only">${logo.label}</span></span>`
                        : `<span class="site-footer-pay" title="${logo.label}"><img src="${logo.src}" alt="${logo.label}" loading="lazy"></span>`).join('')}
                </div>
                <p class="site-footer-copy">&copy; ${year} ${name}. ${t('rights')}</p>
            `;
        });
    }

    // PWA: manifiesto + service worker + módulo de notificaciones.
    // No se toca index.html: todo se inyecta desde aquí, en todas las páginas.
    function injectPwa() {
        if (!document.querySelector('link[rel="manifest"]')) {
            const link = document.createElement('link');
            link.rel = 'manifest';
            link.href = `${SCRIPT_BASE}manifest.webmanifest`;
            document.head.appendChild(link);
        }
        if (!document.querySelector('meta[name="theme-color"]')) {
            const meta = document.createElement('meta');
            meta.name = 'theme-color';
            meta.content = '#070707';
            document.head.appendChild(meta);
        }
        // Icono de pantalla de inicio en iPhone: sin esto, al añadir desde una
        // página interna iOS usa una captura en vez del logo. index.html ya lo
        // trae, así que solo se inyecta cuando la página no tiene uno.
        if (!document.querySelector('link[rel="apple-touch-icon"]')) {
            const icon = document.createElement('link');
            icon.rel = 'apple-touch-icon';
            icon.href = LOGO;
            document.head.appendChild(icon);
        }
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register(`${SCRIPT_BASE}sw.js`).catch(() => { /* sin service worker: la página funciona igual */ });
        }
        // El aviso de instalación se guarda para el botón de Ajustes (notifications.js lo usa).
        window.addEventListener('beforeinstallprompt', event => {
            event.preventDefault();
            window.__gabyInstallPrompt = event;
        });
        // Super admin (PR #18): mantenimiento por tabla, permisos por área y
        // tickets. Se carga en todas las páginas públicas, como notifications.js.
        if (!window.GabySuperAdmin && !document.querySelector('script[data-gaby-super-admin]')) {
            const superAdmin = document.createElement('script');
            superAdmin.src = `${SCRIPT_BASE}super-admin.js?v=20261124f`;
            superAdmin.defer = true;
            superAdmin.dataset.gabySuperAdmin = '1';
            document.head.appendChild(superAdmin);
        }
        // Campana, recordatorios y push (notifications.js). Las páginas de avisos ya lo cargan directo.
        if (!window.GabyNotifications && !document.querySelector('script[data-gaby-notifications]')) {
            const script = document.createElement('script');
            script.src = `${SCRIPT_BASE}notifications.js?v=20261124c`;
            script.defer = true;
            script.dataset.gabyNotifications = '1';
            document.head.appendChild(script);
        }
    }

    function init() {
        injectStyles();
        renderHeader();
        renderMobileBar();
        renderFooters();
        updateBookingTab();
        askLanguage();
        injectPwa();
        // La campana se actualiza al renderizar el header (notifications.js puede
        // haberse cargado antes de que existiera el botón).
        if (window.GabyNotifications) window.GabyNotifications.updateBell();
        window.addEventListener('gabymyappointments', updateBookingTab);
        // Las traducciones de cada página se aplican después; se vuelve a poner al terminar de cargar.
        window.addEventListener('load', updateBookingTab);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
