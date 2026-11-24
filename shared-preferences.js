(function () {
    function getSettings() {
        return (window.GabyData && window.GabyData.getState().settings) || {};
    }

    function getPreferredLanguage() {
        return getSettings().defaultLanguage || 'es';
    }

    function getPreferredTheme() {
        return getSettings().theme || 'dark';
    }

    function resolveLightMode(theme) {
        if (theme === 'light') return true;
        if (theme === 'system') {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
        }
        return false;
    }

    function applyTheme() {
        const isLight = resolveLightMode(getPreferredTheme());
        document.body.classList.toggle('light-mode', isLight);
        document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
        return isLight ? 'light' : 'dark';
    }

    function applyLanguage(translations) {
        const lang = getPreferredLanguage();
        if (!translations || !translations[lang]) return lang;

        document.querySelectorAll('[data-i18n]').forEach(node => {
            const key = node.getAttribute('data-i18n');
            if (translations[lang][key] !== undefined) {
                node.innerHTML = translations[lang][key];
            }
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(node => {
            const key = node.getAttribute('data-i18n-placeholder');
            if (translations[lang][key] !== undefined) {
                node.setAttribute('placeholder', translations[lang][key]);
            }
        });

        return lang;
    }

    function initPreferences(options) {
        const theme = applyTheme();
        const lang = applyLanguage(options && options.translations);
        if (options && typeof options.onApplied === 'function') {
            options.onApplied({ theme, lang });
        }
    }

    window.GabyPreferences = {
        getPreferredLanguage,
        getPreferredTheme,
        applyTheme,
        applyLanguage,
        initPreferences
    };
})();
