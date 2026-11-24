(function () {
    // Componentes de formulario compartidos por las páginas del sitio y el panel del personal.

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function injectStyles() {
        if (document.getElementById('gaby-forms-styles')) return;
        const style = document.createElement('style');
        style.id = 'gaby-forms-styles';
        style.textContent = `
            [hidden] { display: none !important; }
            .service-picker { display: grid; gap: .5rem; max-height: 320px; overflow-y: auto; padding: .25rem; border-radius: 16px; border: 1px solid rgba(212,175,55,.22); background: rgba(255,255,255,.02); }
            body.light-mode .service-picker { background: #fff; border-color: rgba(0,0,0,.12); }
            .service-option { display: grid; grid-template-columns: auto 1fr auto; gap: .75rem; align-items: center; padding: .75rem .9rem; border-radius: 12px; border: 1px solid transparent; cursor: pointer; transition: background .15s, border-color .15s; }
            .service-option:hover { background: rgba(212,175,55,.06); }
            .service-option:has(input:checked) { background: rgba(212,175,55,.12); border-color: rgba(212,175,55,.45); }
            .service-option input { width: 18px; height: 18px; accent-color: #d4af37; margin: 0; }
            .service-option-name { font-weight: 600; font-size: .92rem; overflow-wrap: anywhere; }
            .service-option-meta { display: block; font-weight: 400; font-size: .75rem; opacity: .7; margin-top: .1rem; }
            .service-option-price { font-weight: 700; color: #d4af37; white-space: nowrap; font-size: .9rem; }
            .service-picker-total { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; font-size: .85rem; margin-top: .5rem; opacity: .9; }
            .service-picker-total strong { color: #d4af37; }
            .form-group:has(> [data-required-group]) > label::after,
            .field:has(> [data-required-group]) > label::after,
            .form-group:has(> [data-required-group]) > .form-label::after { content: " *"; color: #ff5f5f; font-weight: 800; }
        `;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Precios: "$35" -> 35, "Desde $30" -> 30 (mínimo), "Consultar" -> sin precio fijo
    // ---------------------------------------------------------------------
    function parsePrice(price) {
        const text = String(price || '');
        const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
        return {
            amount: match ? Number(match[1]) : 0,
            isMinimum: /desde/i.test(text),
            isQuote: !match
        };
    }

    function estimateTotal(services) {
        let total = 0;
        let hasMinimum = false;
        let hasQuote = false;
        services.forEach(service => {
            const price = parsePrice(service.price);
            total += price.amount;
            hasMinimum = hasMinimum || price.isMinimum;
            hasQuote = hasQuote || price.isQuote;
        });
        const amount = `$${total % 1 ? total.toFixed(2) : total}`;
        let label = hasMinimum ? `Desde ${amount}` : amount;
        if (hasQuote) label += total ? ' + servicios a consultar' : 'A consultar';
        if (hasQuote && !total) label = 'A consultar';
        return { total, label };
    }

    // ---------------------------------------------------------------------
    // Selector de varios servicios
    // ---------------------------------------------------------------------
    function createServicePicker(container, options) {
        injectStyles();
        const onChange = (options && options.onChange) || (() => {});
        let services = [];
        container.classList.add('service-picker');
        container.setAttribute('role', 'group');
        container.setAttribute('data-required-group', '');
        const totalBox = document.createElement('div');
        totalBox.className = 'service-picker-total';
        container.insertAdjacentElement('afterend', totalBox);

        function inputs() {
            return Array.from(container.querySelectorAll('input[type=checkbox]'));
        }

        // El navegador exige al menos uno: mientras no haya ninguno marcado, todos son "required".
        function syncRequired() {
            const anyChecked = inputs().some(input => input.checked);
            inputs().forEach(input => { input.required = !anyChecked; });
        }

        function renderTotal() {
            const selected = getSelected();
            totalBox.innerHTML = selected.length
                ? `<span>${selected.length} servicio${selected.length === 1 ? '' : 's'} seleccionado${selected.length === 1 ? '' : 's'}</span><span>Total estimado: <strong>${escapeHtml(estimateTotal(selected).label)}</strong></span>`
                : '<span>Puedes escoger uno o varios servicios.</span>';
        }

        function changed() {
            syncRequired();
            renderTotal();
            onChange(getSelected());
        }

        function render(list) {
            const previouslyChecked = new Set(getSelected().map(service => service.name));
            services = list;
            container.innerHTML = services.map((service, index) => `
                <label class="service-option">
                    <input type="checkbox" value="${index}" data-invalid-message="Escoge al menos un servicio." ${previouslyChecked.has(service.name) ? 'checked' : ''}>
                    <span class="service-option-name">${escapeHtml(service.name)}${service.duration ? `<span class="service-option-meta">${escapeHtml(service.duration)}</span>` : ''}</span>
                    <span class="service-option-price">${escapeHtml(service.price)}</span>
                </label>
            `).join('');
            inputs().forEach(input => input.addEventListener('change', changed));
            changed();
        }

        function getSelected() {
            return inputs().filter(input => input.checked).map(input => services[Number(input.value)]).filter(Boolean);
        }

        function setChecked(index, checked) {
            const input = inputs()[index];
            if (!input) return;
            input.checked = checked !== false;
            changed();
        }

        function selectByName(name) {
            const index = services.findIndex(service => service.name === name);
            if (index !== -1) setChecked(index, true);
            return index !== -1;
        }

        function reset() {
            inputs().forEach(input => { input.checked = false; });
            changed();
        }

        return { render, getSelected, setChecked, selectByName, reset };
    }

    // Datos de la cita a partir de los servicios escogidos.
    function describeServices(selected) {
        return {
            service: selected.map(service => service.name).join(' + '),
            services: selected.map(service => service.name),
            price: estimateTotal(selected).label
        };
    }

    // ---------------------------------------------------------------------
    // Campo de recorte: lista + "Otro" (con texto) + "No se cual es mi recorte"
    // ---------------------------------------------------------------------
    const HAIRCUTS = [
        'Low Fade', 'Mid Fade', 'High Fade', 'Burst Fade', 'Taper', 'Drop Fade',
        'Buzz Cut', 'Crop', 'French Crop', 'Pompadour', 'Undercut', 'Mohawk',
        'Corte clásico (tijera)', 'Rapado'
    ];
    const OTHER = '__otro__';
    const UNKNOWN = 'No sé cuál es mi recorte';

    function initHaircut(selectId, otherWrapId, otherInputId, options) {
        const select = document.getElementById(selectId);
        const wrap = document.getElementById(otherWrapId);
        const other = document.getElementById(otherInputId);
        if (!select || select.dataset.ready) return;
        injectStyles();
        const placeholder = options && options.optional ? 'Sin especificar' : 'Selecciona tu recorte';
        select.innerHTML = `<option value="">${placeholder}</option>`
            + HAIRCUTS.map(cut => `<option value="${escapeHtml(cut)}">${escapeHtml(cut)}</option>`).join('')
            + `<option value="${OTHER}">Otro</option><option value="${escapeHtml(UNKNOWN)}">${escapeHtml(UNKNOWN)}</option>`;
        const toggle = () => {
            const isOther = select.value === OTHER;
            wrap.hidden = !isOther;
            other.required = isOther;
            if (!isOther) other.value = '';
        };
        select.addEventListener('change', () => {
            toggle();
            if (select.value === OTHER) other.focus();
        });
        select.dataset.ready = 'true';
        toggle();
    }

    function getHaircut(selectId, otherInputId) {
        const value = document.getElementById(selectId).value;
        if (value === OTHER) return document.getElementById(otherInputId).value.trim();
        return value;
    }

    function setHaircut(selectId, otherWrapId, otherInputId, value) {
        const select = document.getElementById(selectId);
        const wrap = document.getElementById(otherWrapId);
        const other = document.getElementById(otherInputId);
        if (!value) {
            select.value = '';
        } else if (HAIRCUTS.includes(value) || value === UNKNOWN) {
            select.value = value;
        } else {
            select.value = OTHER;
            other.value = value;
        }
        wrap.hidden = select.value !== OTHER;
        other.required = select.value === OTHER;
    }

    window.GabyForms = {
        createServicePicker,
        describeServices,
        estimateTotal,
        initHaircut,
        getHaircut,
        setHaircut,
        HAIRCUTS
    };
})();
