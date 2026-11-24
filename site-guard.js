(function () {
    // =========================================================================
    // Modo mantenimiento (configurado desde el panel privado ops/).
    // - Todo el sitio: pantalla completa que no deja navegar.
    // - Por secciones: los bloques marcados con data-maintenance-section="..." muestran un aviso.
    // - El personal puede seguir trabajando si "allowStaff" esta activo.
    // - Angel (sesion de desarrollador activa) ve el sitio normal con un aviso pequeno.
    // =========================================================================
    const SECTION_LABELS = {
        reservas: 'Las reservaciones en línea',
        tienda: 'La tienda de productos',
        resenas: 'Las reseñas',
        noticias: 'Las noticias',
        barberos: 'Los perfiles de barberos',
        servicios: 'El menú de servicios',
        soporte: 'El centro de soporte'
    };
    const isStaffPage = /\/staff\//.test(window.location.pathname);

    function devSessionActive() {
        try {
            const session = JSON.parse(localStorage.getItem('gs_dev_session') || 'null');
            return Boolean(session && session.exp > Date.now());
        } catch (error) {
            return false;
        }
    }

    function config() {
        try {
            return window.GabyData.getState().settings.maintenance || {};
        } catch (error) {
            return {};
        }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function injectStyles() {
        if (document.getElementById('site-guard-styles')) return;
        const style = document.createElement('style');
        style.id = 'site-guard-styles';
        style.textContent = `
            #site-maintenance { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 1.5rem; text-align: center; color: #f5f1e8; font-family: 'Inter', system-ui, sans-serif;
                background: radial-gradient(circle at top, rgba(212,175,55,.22), transparent 45%), linear-gradient(180deg, #0b0b0b 0%, #030303 100%); }
            #site-maintenance .sm-card { max-width: 560px; display: grid; gap: 1.1rem; justify-items: center; }
            #site-maintenance img { width: 110px; filter: drop-shadow(0 0 24px rgba(212,175,55,.35)); }
            #site-maintenance h1 { font-family: 'Cinzel', serif; font-size: clamp(1.7rem, 6vw, 2.6rem); color: #d4af37; margin: 0; }
            #site-maintenance p { margin: 0; line-height: 1.7; color: #cfc8b8; }
            #site-maintenance .sm-eta { display: inline-flex; gap: .5rem; align-items: center; padding: .55rem 1rem; border-radius: 999px; border: 1px solid rgba(212,175,55,.35); color: #f3d68a; font-size: .9rem; }
            #site-maintenance .sm-icon { font-size: 2.2rem; color: #d4af37; animation: sm-spin 6s linear infinite; }
            #site-maintenance button { border: 0; border-radius: 999px; padding: .85rem 1.4rem; font: inherit; font-weight: 800; cursor: pointer; color: #111; background: linear-gradient(135deg, #f6dfa0 0%, #d4af37 62%, #87640f 100%); }
            #site-maintenance small { color: #8e877a; }
            @keyframes sm-spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) { #site-maintenance .sm-icon { animation: none; } }
            html.site-maintenance-on, html.site-maintenance-on body { overflow: hidden !important; }
            .maintenance-notice { display: grid; gap: .5rem; justify-items: center; text-align: center; padding: 2rem 1.25rem; margin: 1rem 0; border-radius: 20px; border: 1px dashed rgba(212,175,55,.5); background: rgba(212,175,55,.06); color: inherit; font-family: 'Inter', system-ui, sans-serif; }
            .maintenance-notice i { font-size: 1.6rem; color: #d4af37; }
            .maintenance-notice strong { font-size: 1.05rem; }
            .maintenance-notice span { opacity: .8; font-size: .9rem; line-height: 1.6; }
            #dev-preview-banner { position: fixed; z-index: 2147483001; left: 50%; transform: translateX(-50%); top: .6rem; padding: .45rem .9rem; border-radius: 999px; background: #f1be5d; color: #111; font: 700 .78rem 'Inter', system-ui, sans-serif; box-shadow: 0 8px 20px rgba(0,0,0,.35); }
        `;
        document.head.appendChild(style);
    }

    function formatEta(eta) {
        if (!eta) return '';
        const date = new Date(eta);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('es-PR', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
    }

    // Pantalla completa: los demas elementos quedan "inert" (no se pueden enfocar ni usar).
    function showFullScreen(cfg) {
        let overlay = document.getElementById('site-maintenance');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'site-maintenance';
            overlay.setAttribute('role', 'alertdialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'sm-title');
            document.body.appendChild(overlay);
        }
        const eta = formatEta(cfg.eta);
        overlay.innerHTML = `
            <div class="sm-card">
                <img src="https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972135/b3a13ac1-cac2-4367-9c0d-5946397d4ff9-removebg-preview_xhkncw.png" alt="Logo de la barbería">
                <i class="fas fa-gear sm-icon" aria-hidden="true"></i>
                <h1 id="sm-title">${escapeHtml(cfg.title || 'Estamos en mantenimiento')}</h1>
                <p>${escapeHtml(cfg.message || 'Vuelve pronto.')}</p>
                ${eta ? `<span class="sm-eta"><i class="fas fa-clock" aria-hidden="true"></i> Regresamos: ${escapeHtml(eta)}</span>` : ''}
                <button type="button" onclick="location.reload()">Intentar de nuevo</button>
                <small>¿Necesitas ayuda con una cita? Llama al 787-218-1068.</small>
            </div>
        `;
        Array.from(document.body.children).forEach(child => {
            if (child !== overlay && child.id !== 'gaby-toasts') child.setAttribute('inert', '');
        });
        document.documentElement.classList.add('site-maintenance-on');
        overlay.querySelector('button').focus();
    }

    function hideFullScreen() {
        const overlay = document.getElementById('site-maintenance');
        if (overlay) overlay.remove();
        document.querySelectorAll('body > [inert]').forEach(child => child.removeAttribute('inert'));
        document.documentElement.classList.remove('site-maintenance-on');
    }

    function applySections(sections) {
        // Bloques secundarios (filtros, formularios) que solo se ocultan, sin aviso propio.
        document.querySelectorAll('[data-maintenance-hide]').forEach(block => {
            const active = Boolean(sections && sections[block.dataset.maintenanceHide]);
            if (active && !block.dataset.maintenanceHidden) {
                block.dataset.maintenanceHidden = 'true';
                block.dataset.maintenancePrevDisplay = block.style.display || '';
                block.style.display = 'none';
            } else if (!active && block.dataset.maintenanceHidden) {
                delete block.dataset.maintenanceHidden;
                block.style.display = block.dataset.maintenancePrevDisplay || '';
            }
        });
        document.querySelectorAll('[data-maintenance-section]').forEach(block => {
            const key = block.dataset.maintenanceSection;
            const active = Boolean(sections && sections[key]);
            const notice = block.nextElementSibling && block.nextElementSibling.classList.contains('maintenance-notice') ? block.nextElementSibling : null;
            if (active && !notice) {
                block.dataset.maintenancePrevDisplay = block.style.display || '';
                block.style.display = 'none';
                block.insertAdjacentHTML('afterend', `
                    <div class="maintenance-notice" role="status">
                        <i class="fas fa-screwdriver-wrench" aria-hidden="true"></i>
                        <strong>Sección en mantenimiento</strong>
                        <span>${SECTION_LABELS[key] || 'Esta sección'} no está disponible en este momento. Estamos trabajando para habilitarla pronto.</span>
                    </div>
                `);
            } else if (!active && notice) {
                notice.remove();
                block.style.display = block.dataset.maintenancePrevDisplay || '';
            }
        });
    }

    function devBanner(show, text) {
        let banner = document.getElementById('dev-preview-banner');
        if (!show) {
            if (banner) banner.remove();
            return;
        }
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'dev-preview-banner';
            document.body.appendChild(banner);
        }
        banner.textContent = text;
    }

    function apply() {
        if (!document.body) return;
        injectStyles();
        const cfg = config();
        const dev = devSessionActive();
        const anySection = Object.values(cfg.sections || {}).some(Boolean);
        const blockAll = cfg.enabled && !(isStaffPage && cfg.allowStaff !== false);

        if (dev) {
            hideFullScreen();
            applySections({});
            devBanner(cfg.enabled || anySection, `Vista de desarrollador: ${cfg.enabled ? 'mantenimiento total activo' : 'secciones en mantenimiento'}`);
            return;
        }
        devBanner(false);
        if (blockAll) showFullScreen(cfg);
        else hideFullScreen();
        if (!isStaffPage) applySections(cfg.enabled ? {} : cfg.sections);
    }

    window.GabyGuard = { apply, SECTION_LABELS };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
    window.addEventListener('gabydatachange', apply);
    window.addEventListener('storage', event => {
        if (event.key === 'gs_crm' || event.key === 'gs_dev_session') apply();
    });
})();
