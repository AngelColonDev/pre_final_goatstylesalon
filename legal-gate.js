// Puerta legal de GOAT Style Salon (PR #22).
// Si el interruptor require_reaccept de legal_settings está activo y la
// versión aceptada en este dispositivo es menor que la versión vigente de
// los documentos legales, muestra un modal bloqueante que solo se cierra
// aceptando. FAIL-OPEN: ante cualquier error no muestra nada y no rompe
// la página. Sin dependencias: usa fetch directo a PostgREST con la
// configuración pública de window.GABY_SUPABASE.
(function () {
    'use strict';

    var EXCLUDED = ['centro-soporte.html', 'legal.html', 'super-admin.html'];
    var TITLES = {
        terminos: 'Términos de Uso',
        privacidad: 'Política de Privacidad',
        cookies: 'Política de Cookies y Almacenamiento Local',
        reservas: 'Política de Reservas y Cancelaciones',
        pagos: 'Política de Pagos'
    };

    function isExcluded() {
        try {
            var path = (window.location && window.location.pathname) || '';
            return EXCLUDED.some(function (name) { return path.indexOf(name) !== -1; });
        } catch (_) { return false; }
    }

    // Versión vigente = la mayor versión entre los documentos (0 si no hay).
    function _versionVigente(docs) {
        if (!docs || !docs.length) return 0;
        var max = 0;
        docs.forEach(function (d) {
            var v = parseInt(d && d.version, 10);
            if (!isNaN(v) && v > max) max = v;
        });
        return max;
    }

    function settingsObj(settings) {
        if (Array.isArray(settings)) return settings[0] || null;
        return settings || null;
    }

    // Solo bloquea si el interruptor está activo Y la versión aceptada es
    // menor que la vigente. Si require_reaccept es false NO se bloquea y
    // tampoco se toca localStorage: la aceptación solo se guarda cuando la
    // persona pulsa el botón Acepto del modal.
    function _debeBloquear(settings, docs, aceptada) {
        var s = settingsObj(settings);
        if (!s || s.require_reaccept !== true) return false;
        var vigente = _versionVigente(docs);
        if (!vigente) return false;
        var acc = parseInt(aceptada, 10);
        if (isNaN(acc)) acc = 0;
        return acc < vigente;
    }

    function restFetch(path, options) {
        var cfg = window.GABY_SUPABASE;
        var base = String(cfg.url || '').replace(/\/+$/, '');
        var headers = {
            apikey: cfg.anonKey,
            Authorization: 'Bearer ' + cfg.anonKey
        };
        if (options && options.headers) {
            Object.keys(options.headers).forEach(function (k) { headers[k] = options.headers[k]; });
        }
        var fetchFn = window.fetch || (typeof fetch !== 'undefined' ? fetch : null);
        if (!fetchFn) return Promise.reject(new Error('fetch no disponible'));
        var opts = { method: (options && options.method) || 'GET', headers: headers };
        if (options && options.body) opts.body = options.body;
        return fetchFn.call(window, base + path, opts).then(function (res) {
            if (res && res.ok === false) throw new Error('HTTP ' + res.status);
            if (options && options.method && options.method !== 'GET') return null;
            return res.json();
        });
    }

    function injectStyles() {
        if (document.getElementById('lg-style')) return;
        var st = document.createElement('style');
        st.id = 'lg-style';
        st.textContent = [
            '.lg-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:1rem;}',
            '.lg-card{background:#111;color:#f5f0e6;border:1px solid #d4af37;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:1.6rem;font-family:inherit;box-shadow:0 18px 50px rgba(0,0,0,.6);}',
            '.lg-card h2{color:#d4af37;margin:0 0 .6rem;font-size:1.35rem;}',
            '.lg-card p{line-height:1.55;margin:0 0 1rem;}',
            '.lg-links{list-style:none;margin:0 0 1.2rem;padding:0;}',
            '.lg-links li{margin:.35rem 0;}',
            '.lg-links a{color:#d4af37;text-decoration:underline;}',
            '.lg-accept{display:block;width:100%;background:#d4af37;color:#111;border:0;border-radius:10px;padding:.95rem 1rem;font-size:1rem;font-weight:700;cursor:pointer;}',
            '.lg-accept:focus{outline:3px solid #fff;outline-offset:2px;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function showModal(docs, vigente) {
        if (document.querySelector('.lg-overlay')) return;
        injectStyles();
        var overlay = document.createElement('div');
        overlay.className = 'lg-overlay';
        var card = document.createElement('div');
        card.className = 'lg-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'lg-title');

        var h = document.createElement('h2');
        h.id = 'lg-title';
        h.textContent = 'Documentos actualizados';
        var p = document.createElement('p');
        p.textContent = 'Actualizamos nuestros términos y políticas. Para seguir usando GOAT Style Salon, léelos y acéptalos.';

        var ul = document.createElement('ul');
        ul.className = 'lg-links';
        docs.forEach(function (d) {
            if (!d || !d.slug) return;
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = 'legal.html?doc=' + encodeURIComponent(d.slug);
            a.target = '_self';
            a.textContent = TITLES[d.slug] || d.slug;
            li.appendChild(a);
            ul.appendChild(li);
        });

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lg-accept';
        btn.textContent = 'Acepto los términos y políticas';
        btn.addEventListener('click', function () {
            try { localStorage.setItem('goat-legal-accepted', String(vigente)); } catch (_) {}
            // Registro best-effort: si falla, la aceptación local ya vale y
            // el modal se cierra igual.
            try {
                restFetch('/rest/v1/legal_acceptances', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ version: vigente, user_agent: navigator.userAgent })
                }).catch(function () {});
            } catch (_) {}
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });

        card.appendChild(h);
        card.appendChild(p);
        card.appendChild(ul);
        card.appendChild(btn);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        try { btn.focus(); } catch (_) {}
    }

    async function check() {
        try {
            if (isExcluded()) return;
            if (!window.GABY_SUPABASE || !window.GABY_SUPABASE.url || !window.GABY_SUPABASE.anonKey) return;
            var results = await Promise.all([
                restFetch('/rest/v1/legal_settings?select=require_reaccept&id=eq.1'),
                restFetch('/rest/v1/legal_documents?select=slug,version')
            ]);
            var settings = results[0];
            var docs = results[1] || [];
            var aceptada = 0;
            try { aceptada = parseInt(localStorage.getItem('goat-legal-accepted') || '0', 10) || 0; } catch (_) {}
            if (_debeBloquear(settings, docs, aceptada)) {
                showModal(docs, _versionVigente(docs));
            }
            // Si require_reaccept es false y la versión aceptada es menor,
            // no se bloquea ni se guarda nada en localStorage (ver _debeBloquear).
        } catch (err) {
            // FAIL-OPEN: cualquier error de red o de parseo no bloquea.
            try { console.warn('[legal-gate]', err && err.message ? err.message : err); } catch (_) {}
        }
    }

    window.GOATLegalGate = {
        check: check,
        _versionVigente: _versionVigente,
        _debeBloquear: _debeBloquear
    };

    if (!isExcluded()) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { check(); });
        } else {
            check();
        }
    }
})();
