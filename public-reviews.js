(function () {
    'use strict';

    // Idioma activo de la app (Configuración → Idioma). Solo cambia textos mostrados.
    function lang() {
        try { return (window.GabyData && window.GabyData.getState().settings.defaultLanguage) === 'en' ? 'en' : 'es'; } catch (_) { return 'es'; }
    }

    const fallbackPhoto = 'review-avatar.svg';
    const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));

    function dateValue(value) {
        return value ? Date.parse(value) : NaN;
    }

    function list(state) {
        return window.GabyBooking.publicReviews(state).slice().sort((a, b) =>
            (dateValue(b.publishedAt) || dateValue(b.createdAt) || 0) -
            (dateValue(a.publishedAt) || dateValue(a.createdAt) || 0)
        );
    }

    function photoSource(photo) {
        if (/^data:image\/(png|jpe?g|webp|gif|avif|bmp);base64,/i.test(photo)) return photo;
        try {
            const url = new URL(photo, window.location.href);
            if (photo && ['http:', 'https:', 'file:'].includes(url.protocol)) return url.href;
        } catch (_) {
            return fallbackPhoto;
        }
        return fallbackPhoto;
    }

    function card(review, state) {
        const booking = window.GabyBooking;
        const appointment = review.appointmentCode
            ? state.appointments.find(item => item.code === review.appointmentCode)
            : null;
        const barber = booking.reviewBarber(review, state) || state.barbers.find(item => item.id === appointment?.barber);
        const barberName = barber ? [barber.name, barber.alias && barber.alias !== barber.name ? `(${barber.alias})` : ''].filter(Boolean).join(' ')
            : review.barber || '';
        const name = review.clientName || (lang() === 'en' ? 'Client' : 'Cliente');
        const service = booking.reviewServiceLabel({ service: review.service || appointment?.service || '' });
        const stars = Math.max(0, Math.min(5, Math.round(Number(review.rating) || 0)));
        const published = dateValue(review.publishedAt);
        const submitted = dateValue(review.createdAt);
        const dateLabel = Number.isFinite(published) ? (lang() === 'en' ? 'Published' : 'Publicada') : (lang() === 'en' ? 'Sent' : 'Enviada');
        const date = Number.isFinite(published) ? published : submitted;
        const serviceDate = review.serviceDate || appointment?.dateTime?.slice(0, 10);
        const dateDetail = Number.isFinite(date)
            ? `<div><dt>${dateLabel}</dt><dd><time datetime="${new Date(date).toISOString()}">${new Date(date).toLocaleDateString(lang() === 'en' ? 'en-US' : 'es-PR', dateOptions)}</time></dd></div>`
            : /^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
                ? `<div><dt>Fecha del servicio</dt><dd><time datetime="${serviceDate}">${booking.formatDate(serviceDate, dateOptions)}</time></dd></div>`
                : '<div><dt>Publicación</dt><dd>Fecha sin registrar</dd></div>';

        return `
            <article class="review-card">
                <div class="vip-review-author">
                    <img class="vip-review-photo" src="${escape(photoSource(review.clientPhoto))}" alt="Foto de ${escape(name)}" width="52" height="52" onerror="this.onerror=null;this.src='review-avatar.svg'">
                    <h3 class="vip-review-name">${escape(name)}</h3>
                </div>
                <div class="vip-review-rating">
                    <span aria-hidden="true">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
                    <span>${stars} ${lang() === 'en' ? 'of' : 'de'} 5</span>
                </div>
                ${review.text ? `<p class="review-text vip-review-text">${escape(review.text)}</p>` : ''}
                <dl class="vip-review-details">
                    ${barberName ? `<div><dt>${lang() === 'en' ? 'Barber' : 'Barbero'}</dt><dd>${escape(barberName)}</dd></div>` : ''}
                    ${service ? `<div><dt>${lang() === 'en' ? 'Service' : 'Servicio'}</dt><dd>${escape(service)}</dd></div>` : ''}
                    ${dateDetail}
                </dl>
            </article>`;
    }

    async function preparePhoto(file) {
        if (!file) return '';
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
            throw new Error(lang() === 'en' ? 'Pick a JPG, PNG or WebP image up to 10 MB.' : 'Escoge una imagen JPG, PNG o WebP de hasta 10 MB.');
        }

        const url = URL.createObjectURL(file);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const size = Math.min(image.naturalWidth, image.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = Math.min(128, size);
            const context = canvas.getContext('2d', { alpha: false });
            context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
                size, size, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.8);
        } catch (_) {
            throw new Error(lang() === 'en' ? 'The photo could not be opened. Pick another image.' : 'No se pudo abrir la foto. Escoge otra imagen.');
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    window.GabyPublicReviews = { list, card, preparePhoto };
})();
