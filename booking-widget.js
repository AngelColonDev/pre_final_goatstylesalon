(function () {
    // =========================================================================
    // Reserva paso a paso: 1) Servicio 2) Barbero 3) Fecha y hora 4) Revisar 5) Confirmacion.
    // Se usa en index.html (#reserva) y booking.html. No hace falta cuenta: el cliente escribe su nombre completo.
    // Los precios son informativos: el pago es presencial en la barberia.
    // =========================================================================
    const B = () => window.GabyBooking;
    const Data = () => window.GabyData;
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    // ---------------------------------------------------------------------
    // i18n del widget: diccionario propio + mapas EN por id del catálogo
    // sembrado (shared-data.js). Los valores internos (estados, nombres de
    // servicios de la casa, ids) NO se traducen: solo los textos mostrados.
    // ---------------------------------------------------------------------
    const translations = {
        es: {
            stepService: 'Servicio', stepBarber: 'Barbero', stepDateTime: 'Fecha y hora', stepReview: 'Revisar',
            photoMustBeImage: 'El archivo debe ser una imagen.',
            photoTooBig: 'La foto es muy grande (máximo 15 MB).',
            photoReadError: 'No se pudo leer la foto. Prueba con otra imagen (JPG o PNG).',
            servicesTitle: '¿Qué te vas a hacer?',
            servicesSub: 'Puedes escoger uno o varios servicios. Los precios son informativos.',
            barberChosenLabel: 'Barbero', changeBarber: 'Cambiar barbero',
            unknownHelp: 'Tu barbero te ayuda a escogerlo. Antes de confirmar puedes subir una foto de referencia (opcional).',
            payInPersonStrong: 'Pago presencial en la barbería.',
            payServicesText: 'Esta página no cobra ni guarda datos de pago.',
            payReviewText: 'No se cobra nada en esta página.',
            chooseAtLeastOne: 'Escoge al menos un servicio.',
            serviceWord: 'servicio', servicesWord: 'servicios',
            continueBtn: 'Continuar',
            barberNotOffers: '{name} no ofrece todos esos servicios. Escoge otro barbero.',
            barbersTitle: 'Escoge tu barbero',
            nextSlot: 'Próximo espacio', noUpcomingSlots: 'Sin espacios próximos',
            noBarberForAll: 'Ningún barbero ofrece todos los servicios escogidos juntos. Prueba con menos servicios.',
            back: 'Atrás',
            dateTimeTitle: '¿Cuándo te viene bien?',
            datesAria: 'Fechas',
            ariaClosed: 'barbería cerrada', ariaSlots: 'horarios', ariaNoSlots: 'sin horarios',
            closedWord: 'Cerrado', freeWord: 'libres', fullWord: 'Lleno',
            morning: 'Mañana', afternoon: 'Tarde', evening: 'Noche',
            closedDayTitle: 'La barbería está cerrada ese día.',
            closedDayText: 'Los domingos y lunes la barbería está cerrada. Escoge un día de martes a sábado.',
            noSlotsDayTitle: 'No hay espacios disponibles este día.',
            noSlotsDayText: 'Escoge otra fecha o comunícate con la barbería.',
            shopHoursTitle: 'Horario de la barbería',
            reviewBtn: 'Revisar',
            sumName: 'Nombre', sumEmail: 'Correo', sumService: 'Servicio', sumServices: 'Servicios',
            sumBarber: 'Barbero', sumDate: 'Fecha', sumTime: 'Hora', sumDuration: 'Duración',
            sumPrice: 'Precio', sumPayInPerson: 'pago presencial',
            sumPhoto: 'Foto de referencia', sumPhotoAttached: 'Adjunta', sumCode: 'Código',
            reviewTitle: 'Revisa tu cita',
            fullNameLabel: 'Nombre completo *', fullNamePlaceholder: 'Tu nombre y apellido',
            emailLabel: 'Correo electrónico *', emailHint: 'Te enviaremos la confirmación de tu cita a este correo.',
            vipTitle: '📍 Detalles del servicio VIP a domicilio',
            vipTownLabel: 'Pueblo *', vipTownPlaceholder: 'Selecciona tu pueblo',
            vipGuestsLabel: 'Cantidad de personas',
            vipAddressLabel: 'Dirección y descripción del lugar *',
            vipAddressPlaceholder: 'Dirección, urbanización, casa/apto, puntos de referencia...',
            noteLabel: 'Nota para el barbero (opcional)', notePlaceholder: 'Ej. prefiero low fade, barba #2...',
            photoTitle: 'Foto de referencia (opcional)',
            photoHelp: 'Sube una foto del recorte que quieres. Solo la ven tu barbero y la barbería.',
            removePhoto: 'Quitar foto', changePhoto: 'Cambiar foto', uploadPhoto: 'Subir foto',
            agreeText: 'He revisado la fecha, hora, servicio, precio y política de cancelación aplicable a esta reservación. *',
            changeCancelNote: 'Para cambiar o cancelar tu cita, comunícate con la barbería.',
            confirmBtn: 'Confirmar cita', confirmingBtn: 'Confirmando...',
            toastName: 'Escribe tu nombre completo para confirmar la cita.',
            toastEmail: 'Escribe un correo electrónico válido para confirmar tu cita.',
            toastAgree: 'Marca la casilla de confirmación para continuar.',
            toastVip: 'Completa el pueblo y la dirección del servicio VIP.',
            confirmError: 'No se pudo confirmar la cita.',
            noticeUpdateError: 'No se pudo actualizar el aviso.',
            toastConfirmed: '¡Tu cita fue confirmada!',
            toastReceived: 'Recibimos tu solicitud de cita.',
            doneConfirmedTitle: '¡Tu cita fue confirmada!',
            doneReceivedTitle: '¡Recibimos tu solicitud!',
            doneBarberWillConfirm: 'Tu barbero la confirmará pronto. ',
            doneKeepCode: 'Guarda tu código ',
            doneKeepCodeAfter: ' para consultar el estado de tu cita. Para cambiarla o cancelarla, comunícate con la barbería.',
            doneEmailTo: 'Te enviaremos la confirmación a {email}.',
            donePayLabel: 'Pago:', donePayText: 'presencial en la barbería.',
            backHome: 'Volver al inicio', bookAnother: 'Reservar otra cita'
        },
        en: {
            stepService: 'Service', stepBarber: 'Barber', stepDateTime: 'Date & time', stepReview: 'Review',
            photoMustBeImage: 'The file must be an image.',
            photoTooBig: 'The photo is too large (maximum 15 MB).',
            photoReadError: 'The photo could not be read. Try another image (JPG or PNG).',
            servicesTitle: 'What are you getting done?',
            servicesSub: 'You can choose one or more services. Prices are for reference.',
            barberChosenLabel: 'Barber', changeBarber: 'Change barber',
            unknownHelp: 'Your barber will help you choose it. Before confirming you can upload a reference photo (optional).',
            payInPersonStrong: 'Pay in person at the barbershop.',
            payServicesText: 'This page does not charge or store payment details.',
            payReviewText: 'Nothing is charged on this page.',
            chooseAtLeastOne: 'Choose at least one service.',
            serviceWord: 'service', servicesWord: 'services',
            continueBtn: 'Continue',
            barberNotOffers: '{name} does not offer all of those services. Choose another barber.',
            barbersTitle: 'Choose your barber',
            nextSlot: 'Next opening', noUpcomingSlots: 'No upcoming openings',
            noBarberForAll: 'No barber offers all the chosen services together. Try fewer services.',
            back: 'Back',
            dateTimeTitle: 'When works for you?',
            datesAria: 'Dates',
            ariaClosed: 'barbershop closed', ariaSlots: 'time slots', ariaNoSlots: 'no time slots',
            closedWord: 'Closed', freeWord: 'open', fullWord: 'Full',
            morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
            closedDayTitle: 'The barbershop is closed that day.',
            closedDayText: 'The barbershop is closed on Sundays and Mondays. Choose a day from Tuesday to Saturday.',
            noSlotsDayTitle: 'There are no openings available this day.',
            noSlotsDayText: 'Choose another date or contact the barbershop.',
            shopHoursTitle: 'Barbershop hours',
            reviewBtn: 'Review',
            sumName: 'Name', sumEmail: 'Email', sumService: 'Service', sumServices: 'Services',
            sumBarber: 'Barber', sumDate: 'Date', sumTime: 'Time', sumDuration: 'Duration',
            sumPrice: 'Price', sumPayInPerson: 'pay in person',
            sumPhoto: 'Reference photo', sumPhotoAttached: 'Attached', sumCode: 'Code',
            reviewTitle: 'Review your appointment',
            fullNameLabel: 'Full name *', fullNamePlaceholder: 'Your first and last name',
            emailLabel: 'Email *', emailHint: 'We will send your appointment confirmation to this email.',
            vipTitle: '📍 VIP at-home service details',
            vipTownLabel: 'Town *', vipTownPlaceholder: 'Select your town',
            vipGuestsLabel: 'Number of people',
            vipAddressLabel: 'Address and description of the place *',
            vipAddressPlaceholder: 'Address, neighborhood, house/apt, landmarks...',
            noteLabel: 'Note for the barber (optional)', notePlaceholder: 'E.g. I prefer a low fade, beard #2...',
            photoTitle: 'Reference photo (optional)',
            photoHelp: 'Upload a photo of the cut you want. Only your barber and the barbershop can see it.',
            removePhoto: 'Remove photo', changePhoto: 'Change photo', uploadPhoto: 'Upload photo',
            agreeText: 'I have reviewed the date, time, service, price and cancellation policy that apply to this booking. *',
            changeCancelNote: 'To change or cancel your appointment, contact the barbershop.',
            confirmBtn: 'Confirm appointment', confirmingBtn: 'Confirming...',
            toastName: 'Write your full name to confirm the appointment.',
            toastEmail: 'Write a valid email to confirm your appointment.',
            toastAgree: 'Check the confirmation box to continue.',
            toastVip: 'Complete the town and address for the VIP service.',
            confirmError: 'The appointment could not be confirmed.',
            noticeUpdateError: 'The notice could not be updated.',
            toastConfirmed: 'Your appointment was confirmed!',
            toastReceived: 'We received your appointment request.',
            doneConfirmedTitle: 'Your appointment was confirmed!',
            doneReceivedTitle: 'We received your request!',
            doneBarberWillConfirm: 'Your barber will confirm it soon. ',
            doneKeepCode: 'Keep your code ',
            doneKeepCodeAfter: ' to check the status of your appointment. To change or cancel it, contact the barbershop.',
            doneEmailTo: 'We will send the confirmation to {email}.',
            donePayLabel: 'Payment:', donePayText: 'in person at the barbershop.',
            backHome: 'Back to home', bookAnother: 'Book another appointment'
        }
    };

    // Duración/descripción EN por id del catálogo sembrado; respaldo: el texto original.
    const SERVICE_EN = {
        'service-1': { duration: 'Includes a drink and a hair wash', description: 'Every cut includes a drink of your choice and a hair wash.' },
        'service-2': { duration: 'Premium cut', description: 'Premium Fade with a clean, professional finish.' },
        'service-3': { duration: 'Traditional Hot Towel Shave', description: 'Signature Cut with Traditional Hot Towel Shave.' },
        'service-4': { duration: 'Up to 12 years old', description: 'Kids Premium for children up to 12 years old.' },
        'service-5': { duration: 'Prior consultation', description: 'Baby Cut subject to prior consultation.' },
        'service-6': { duration: 'Color', description: 'Hair Light for a more defined, modern look.' },
        'service-7': { duration: 'Cut not included', description: 'Full platinum. Cut not included.' },
        'service-8': { duration: 'Treatment', description: 'Hair hydration treatment.' },
        'service-9': { duration: 'Treatment', description: 'Keratin to improve texture and control frizz.' },
        'service-10': { duration: 'Facial', description: 'Deep facial cleansing.' },
        'service-11': { duration: 'Complete experience', description: 'Includes Signature Cut, beard design, hair wash, hot towels, scalp massage, express facial cleansing, a courtesy drink and premium finishing products.' }
    };

    const CATEGORY_EN = { 'Cortes': 'Cuts', 'Barba': 'Beard', 'Combos': 'Combos', 'Diseños': 'Designs', 'Tratamientos': 'Treatments', 'Faciales': 'Facials', 'Color': 'Color', 'VIP': 'VIP', 'Otros': 'Other' };

    function currentLang() {
        return (window.GabyPreferences && window.GabyPreferences.getPreferredLanguage()) || 'es';
    }

    function t(key) {
        const lang = currentLang();
        return (translations[lang] && translations[lang][key]) || translations.es[key] || key;
    }

    function locale() {
        return currentLang() === 'en' ? 'en-US' : 'es-PR';
    }

    function serviceText(service, field) {
        if (currentLang() === 'en' && SERVICE_EN[service.id] && SERVICE_EN[service.id][field]) return SERVICE_EN[service.id][field];
        return service[field] || '';
    }

    function categoryLabel(category) {
        return currentLang() === 'en' ? (CATEGORY_EN[category] || category) : category;
    }
    // FormSpark: un formulario por barbero (ya existen y están verificados). El
    // aviso por correo llega al barbero de la cita y a angelcolonnegron@gmail.com,
    // con el asunto "Nueva cita — GOAT Style Salon". Si un barbero no tiene
    // formulario aquí, simplemente no se envía el correo.
    const FORMSPARK_URLS = {
        gabriel: 'https://submit-form.com/f0i9yTbl2',
        darialex: 'https://submit-form.com/RcbBqUtzU',
        wilo: 'https://submit-form.com/SPFHqNvbZ'
    };

    // Aviso por correo al barbero cuando se crea una cita en línea. Nunca
    // bloquea la reserva: se envía en segundo plano y cualquier error se ignora.
    function notifyBarberByEmail(appointment) {
        try {
            const url = appointment && FORMSPARK_URLS[appointment.barber];
            if (!url || !appointment.code) return;
            const body = new URLSearchParams({
                nombre: appointment.client || '',
                // PR #17 (E): el correo del cliente va con el campo `email`: es el que
                // FormSpark usa para la confirmación automática al remitente
                // (autoresponder) y como reply-to del aviso al barbero.
                email: appointment.clientEmail || '',
                servicio: appointment.service || '',
                barbero: appointment.barberName || appointment.barber || '',
                fecha: String(appointment.dateTime || '').slice(0, 10),
                hora: String(appointment.dateTime || '').slice(11, 16),
                codigo: appointment.code
            });
            fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
        } catch (_) { /* el correo nunca bloquea la reserva */ }
    }

    const isVip = service => service && (service.category === 'VIP' || /VIP/i.test(service.name));
    const PR_TOWNS = ['Adjuntas', 'Aguada', 'Aguadilla', 'Aguas Buenas', 'Aibonito', 'Añasco', 'Arecibo', 'Arroyo', 'Barceloneta', 'Barranquitas', 'Bayamón', 'Cabo Rojo', 'Caguas', 'Camuy', 'Canóvanas', 'Carolina', 'Cataño', 'Cayey', 'Ceiba', 'Ciales', 'Cidra', 'Coamo', 'Comerío', 'Corozal', 'Culebra', 'Dorado', 'Fajardo', 'Florida', 'Guánica', 'Guayama', 'Guayanilla', 'Guaynabo', 'Gurabo', 'Hatillo', 'Hormigueros', 'Humacao', 'Isabela', 'Jayuya', 'Juana Díaz', 'Juncos', 'Lajas', 'Lares', 'Las Marías', 'Las Piedras', 'Loíza', 'Luquillo', 'Manatí', 'Maricao', 'Maunabo', 'Mayagüez', 'Moca', 'Morovis', 'Naguabo', 'Naranjito', 'Orocovis', 'Patillas', 'Peñuelas', 'Ponce', 'Quebradillas', 'Rincón', 'Río Grande', 'Sabana Grande', 'Salinas', 'San Germán', 'San Juan', 'San Lorenzo', 'San Sebastián', 'Santa Isabel', 'Toa Alta', 'Toa Baja', 'Trujillo Alto', 'Utuado', 'Vega Alta', 'Vega Baja', 'Vieques', 'Villalba', 'Yabucoa', 'Yauco'];

    function injectStyles() {
        if (document.getElementById('booking-widget-styles')) return;
        const style = document.createElement('style');
        style.id = 'booking-widget-styles';
        style.textContent = `
            .bw { --bw-gold: #d4af37; --bw-soft: #f3d68a; --bw-line: rgba(255,255,255,.1); --bw-card: rgba(255,255,255,.03); --bw-muted: #a59f90; --bw-text: inherit;
                display: grid; gap: 1.1rem; font-family: 'Inter', system-ui, sans-serif; text-align: left; color: var(--bw-text); }
            body.light-mode .bw { --bw-line: rgba(0,0,0,.1); --bw-card: #fff; --bw-muted: #5c5c5c; --bw-soft: #7a5c12; }
            .bw-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: .4rem; }
            .bw-step { display: grid; gap: .35rem; font-size: .72rem; color: var(--bw-muted); text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
            .bw-step::before { content: ''; height: 4px; border-radius: 99px; background: var(--bw-line); }
            .bw-step.done::before, .bw-step.current::before { background: var(--bw-gold); }
            .bw-step.current { color: var(--bw-soft); }
            .bw h3.bw-title { font-family: 'Cinzel', serif; font-size: 1.3rem; margin: 0; }
            .bw-sub { color: var(--bw-muted); font-size: .88rem; line-height: 1.6; margin: 0; }
            .bw-cat { font-size: .78rem; text-transform: uppercase; letter-spacing: .12em; color: var(--bw-soft); margin: .6rem 0 .1rem; font-weight: 700; }
            .bw-list { display: grid; gap: .55rem; }
            .bw-option { display: grid; grid-template-columns: auto 1fr auto; gap: .8rem; align-items: center; padding: .85rem 1rem; border-radius: 14px; border: 1px solid var(--bw-line); background: var(--bw-card); cursor: pointer; text-align: left; color: inherit; font: inherit; width: 100%; }
            .bw-option:hover { border-color: rgba(212,175,55,.5); }
            .bw-option.selected, .bw-option:has(input:checked) { border-color: var(--bw-gold); background: rgba(212,175,55,.1); }
            .bw-option input { width: 18px; height: 18px; accent-color: var(--bw-gold); margin: 0; }
            .bw-option strong { display: block; font-size: .95rem; }
            .bw-option small { display: block; color: var(--bw-muted); font-size: .78rem; margin-top: .15rem; }
            .bw-price { font-weight: 800; color: var(--bw-gold); white-space: nowrap; text-align: right; }
            .bw-price small { font-weight: 500; }
            .bw-tag { display: inline-block; margin-left: .4rem; font-size: .68rem; padding: .1rem .45rem; border-radius: 99px; background: rgba(212,175,55,.18); color: var(--bw-soft); font-weight: 700; vertical-align: middle; }
            .bw-barbers { display: grid; gap: .6rem; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
            .bw-barber { display: grid; grid-template-columns: 56px 1fr; gap: .8rem; align-items: center; }
            .bw-avatar { width: 56px; height: 56px; border-radius: 50%; background-size: cover; background-position: center top; border: 2px solid rgba(212,175,55,.5); }
            .bw-next { color: #3fb950; font-size: .78rem; font-weight: 700; margin-top: .2rem; display: block; }
            .bw-next.none { color: var(--bw-muted); font-weight: 500; }
            .bw-dates { display: flex; gap: .5rem; overflow-x: auto; padding: .2rem .1rem .6rem; scroll-snap-type: x mandatory; }
            .bw-date { flex: 0 0 auto; width: 74px; display: grid; gap: .1rem; justify-items: center; padding: .65rem .3rem; border-radius: 14px; border: 1px solid var(--bw-line); background: var(--bw-card); color: inherit; cursor: pointer; font: inherit; scroll-snap-align: start; }
            .bw-date span { font-size: .7rem; text-transform: uppercase; color: var(--bw-muted); }
            .bw-date strong { font-size: 1.25rem; }
            .bw-date small { font-size: .66rem; color: #3fb950; }
            .bw-date:disabled { opacity: .35; cursor: not-allowed; }
            .bw-date:disabled small { color: var(--bw-muted); }
            .bw-date.selected { border-color: var(--bw-gold); background: rgba(212,175,55,.14); }
            .bw-period { font-size: .78rem; color: var(--bw-muted); margin: .4rem 0 .3rem; font-weight: 700; }
            .bw-times { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: .45rem; }
            .bw-time { padding: .65rem .3rem; border-radius: 12px; border: 1px solid var(--bw-line); background: var(--bw-card); color: inherit; cursor: pointer; font: inherit; font-weight: 700; font-size: .88rem; }
            .bw-time:hover { border-color: var(--bw-gold); }
            .bw-time.selected { background: linear-gradient(135deg, #f6dfa0 0%, #d4af37 62%, #87640f 100%); color: #111; border-color: transparent; }
            .bw-empty { border: 1px dashed rgba(212,175,55,.5); border-radius: 16px; padding: 1.2rem; display: grid; gap: .7rem; justify-items: start; background: rgba(212,175,55,.05); }
            .bw-summary { border: 1px solid var(--bw-line); border-radius: 16px; overflow: hidden; }
            .bw-summary div { display: grid; grid-template-columns: 130px 1fr; gap: .8rem; padding: .7rem 1rem; border-top: 1px solid var(--bw-line); font-size: .9rem; }
            .bw-summary div:first-child { border-top: 0; }
            .bw-summary dt { color: var(--bw-muted); }
            .bw-summary dd { margin: 0; font-weight: 600; }
            .bw-pay { display: flex; gap: .6rem; align-items: center; padding: .75rem 1rem; border-radius: 14px; background: rgba(63,185,80,.1); border: 1px solid rgba(63,185,80,.3); font-size: .86rem; }
            .bw-pay i { color: #3fb950; }
            .bw-field { display: grid; gap: .35rem; font-size: .85rem; font-weight: 600; }
            .bw-field input, .bw-field select, .bw-field textarea { width: 100%; border-radius: 12px; border: 1px solid var(--bw-line); background: var(--bw-card); color: inherit; padding: .75rem .9rem; font: inherit; font-weight: 400; }
            body:not(.light-mode) .bw-field select option { background: #161616; color: #f5f1e8; }
            .bw-field textarea { min-height: 70px; resize: vertical; }
            .bw-grid { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
            .bw-check { display: flex; gap: .6rem; align-items: flex-start; font-size: .85rem; line-height: 1.5; cursor: pointer; }
            .bw-check input { margin-top: .2rem; width: 17px; height: 17px; accent-color: var(--bw-gold); flex-shrink: 0; }
            .bw-actions { display: flex; gap: .6rem; flex-wrap: wrap; justify-content: space-between; align-items: center; }
            .bw-btn { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; border-radius: 999px; padding: .85rem 1.4rem; font: inherit; font-weight: 800; font-size: .88rem; cursor: pointer; border: 1px solid rgba(212,175,55,.45); background: transparent; color: inherit; text-decoration: none; }
            .bw-btn.primary { background: linear-gradient(135deg, #f6dfa0 0%, #d4af37 62%, #87640f 100%); color: #111; border-color: transparent; }
            .bw-btn:disabled { opacity: .5; cursor: not-allowed; }
            .bw-btn:focus-visible, .bw-option:focus-visible, .bw-date:focus-visible, .bw-time:focus-visible { outline: 2px solid var(--bw-gold); outline-offset: 2px; }
            .bw-done { text-align: center; display: grid; gap: .9rem; justify-items: center; }
            .bw-done .bw-check-icon { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; font-size: 1.8rem; color: #111; background: linear-gradient(135deg, #f6dfa0 0%, #d4af37 62%, #87640f 100%); }
            .bw-done .bw-summary { width: 100%; text-align: left; }
            .bw-date.closed { opacity: .55; border-style: dashed; }
            .bw-date.closed small { color: #f07171; }
            .bw-closed { border: 1px solid rgba(220,53,69,.4); background: rgba(220,53,69,.08); border-radius: 16px; padding: 1.1rem 1.2rem; display: grid; gap: .45rem; }
            .bw-closed strong { color: #f07171; }
            body.light-mode .bw-closed strong { color: #b42318; }
            .bw-hours { margin-top: 1rem; padding: .8rem 1rem; border-radius: 14px; border: 1px solid var(--bw-line); background: var(--bw-card); max-width: 420px; }
            .bw-hours-title { display: block; font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--bw-muted); margin-bottom: .3rem; }
            .bw-chosen { display: flex; align-items: center; justify-content: space-between; gap: .8rem; flex-wrap: wrap; padding: .75rem 1rem; border-radius: 14px; border: 1px solid rgba(212,175,55,.45); background: rgba(212,175,55,.08); font-size: .9rem; }
            .bw-chosen button { background: none; border: 0; color: var(--bw-soft); font: inherit; font-size: .82rem; font-weight: 700; text-decoration: underline; cursor: pointer; }
            .bw-alert { padding: .8rem 1rem; border-radius: 12px; border: 1px solid rgba(241,190,93,.5); background: rgba(241,190,93,.08); font-size: .86rem; line-height: 1.55; }
            .bw-unknown { border-style: dashed; border-color: rgba(212,175,55,.55); }
            .bw-unknown .bw-q { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: rgba(212,175,55,.16); color: var(--bw-gold); font-size: 1rem; }
            .bw-photo { border: 1px dashed var(--bw-line); border-radius: 16px; padding: 1rem; display: grid; gap: .7rem; background: var(--bw-card); }
            .bw-photo-drop { display: flex; gap: .8rem; align-items: center; flex-wrap: wrap; }
            .bw-photo input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
            .bw-photo-preview { position: relative; width: 120px; height: 120px; border-radius: 14px; overflow: hidden; border: 1px solid var(--bw-line); }
            .bw-photo-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .bw-photo-preview button { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 50%; border: 0; background: rgba(0,0,0,.7); color: #fff; cursor: pointer; }
            @media (max-width: 560px) { .bw-summary div { grid-template-columns: 1fr; gap: .15rem; } .bw-actions .bw-btn { flex: 1 1 auto; } }
        `;
        document.head.appendChild(style);
    }

    // Reduce la foto de referencia (max. 900 px, JPEG) para que no ocupe mucho espacio.
    function compressPhoto(file) {
        return new Promise((resolve, reject) => {
            if (file.type && !/^image\//.test(file.type)) return reject(Object.assign(new Error('type'), { userMessage: t('photoMustBeImage') }));
            if (file.size > 15 * 1024 * 1024) return reject(Object.assign(new Error('size'), { userMessage: t('photoTooBig') }));
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const max = 900;
                const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                let data = canvas.toDataURL('image/jpeg', 0.72);
                if (data.length > 380000) data = canvas.toDataURL('image/jpeg', 0.5);
                resolve(data);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
            img.src = url;
        });
    }

    // ---------------------------------------------------------------------
    function mount(root, options) {
        injectStyles();
        const opts = options || {};
        const state = Data().getState();
        const params = new URLSearchParams(window.location.search);

        const view = {
            step: 1,
            services: [],
            barberId: null,
            date: null,
            time: null,
            name: '',
            email: '',
            notes: '',
            referencePhoto: '',
            result: null
        };

        // Precarga: ?service=...&barber=... ("Reservar con ...", "Reservar este servicio").
        const pre = (opts.service || params.get('service') || '').split(' + ').filter(Boolean);
        const activeServices = state.services.filter(s => s.active);
        pre.forEach(name => { if (B().isUnknownCut(name) || activeServices.some(s => s.name === name)) view.services.push(name); });
        const preBarber = opts.barber || params.get('barber');
        if (preBarber && state.barbers.some(b => b.id === preBarber && b.active !== false)) view.barberId = preBarber;
        if (view.services.length) view.step = view.barberId ? 3 : 2;

        root.classList.add('bw');

        function selectedServices() {
            return B().findServices(view.services);
        }

        function duration() {
            return B().totalMinutes(selectedServices());
        }

        function stepsBar() {
            const labels = [t('stepService'), t('stepBarber'), t('stepDateTime'), t('stepReview')];
            const current = view.step - 1;
            return `<div class="bw-steps" aria-hidden="true">${labels.map((label, i) => `<span class="bw-step ${i < current ? 'done' : ''} ${i === current ? 'current' : ''}">${label}</span>`).join('')}</div>`;
        }

        // ---------------- Paso 1: servicios
        function renderServices() {
            const db = Data().getState();
            const services = db.services.filter(s => s.active);
            const categories = [...new Set([...(db.settings.serviceCategories || []), ...services.map(s => s.category || 'Otros')])];
            const groups = categories.map(category => ({ category, items: services.filter(s => (s.category || 'Otros') === category) })).filter(g => g.items.length);
            const selected = selectedServices();
            const unknown = B().unknownCutService(db);
            const chosenBarber = view.barberId ? db.barbers.find(b => b.id === view.barberId) : null;
            root.innerHTML = `
                ${stepsBar()}
                <h3 class="bw-title">${t('servicesTitle')}</h3>
                <p class="bw-sub">${t('servicesSub')}</p>
                ${chosenBarber ? `<div class="bw-chosen"><span><i class="fas fa-user-check" aria-hidden="true"></i> ${t('barberChosenLabel')}: <strong>${escapeHtml(chosenBarber.alias || chosenBarber.name)}</strong></span><button type="button" data-clear-barber>${t('changeBarber')}</button></div>` : ''}
                <div class="bw-list">
                    <label class="bw-option bw-unknown">
                        <input type="checkbox" data-service="${escapeHtml(unknown.name)}" ${view.services.includes(unknown.name) ? 'checked' : ''}>
                        <span><strong>${escapeHtml(unknown.name)}</strong><small>${t('unknownHelp')}</small></span>
                        <span class="bw-q" aria-hidden="true"><i class="fas fa-question"></i></span>
                    </label>
                </div>
                ${groups.map(group => `
                    <div class="bw-cat">${escapeHtml(categoryLabel(group.category))}</div>
                    <div class="bw-list">
                        ${group.items.map(service => `
                            <label class="bw-option">
                                <input type="checkbox" data-service="${escapeHtml(service.name)}" ${view.services.includes(service.name) ? 'checked' : ''}>
                                <span><strong>${escapeHtml(service.name)}</strong><small>${B().formatDuration(B().serviceMinutes(service))}${serviceText(service, 'duration') ? ` · ${escapeHtml(serviceText(service, 'duration'))}` : ''}</small></span>
                                <span class="bw-price">${escapeHtml(service.price)}</span>
                            </label>
                        `).join('')}
                    </div>
                `).join('')}
                <div class="bw-pay"><i class="fas fa-store" aria-hidden="true"></i><span><strong>${t('payInPersonStrong')}</strong> ${t('payServicesText')}</span></div>
                <div class="bw-actions">
                    <span class="bw-sub">${selected.length ? `${selected.length} ${selected.length === 1 ? t('serviceWord') : t('servicesWord')} · ${B().formatDuration(duration())} · ${escapeHtml(B().priceLabel(selected))}` : t('chooseAtLeastOne')}</span>
                    <button class="bw-btn primary" type="button" data-next ${selected.length ? '' : 'disabled'}>${t('continueBtn')} <i class="fas fa-arrow-right"></i></button>
                </div>
            `;
            root.querySelectorAll('[data-service]').forEach(input => input.addEventListener('change', () => {
                const name = input.dataset.service;
                view.services = input.checked ? [...view.services, name] : view.services.filter(s => s !== name);
                view.date = null;
                view.time = null;
                renderServices();
            }));
            root.querySelector('[data-clear-barber]')?.addEventListener('click', () => { view.barberId = null; renderServices(); });
            // Con un barbero ya escogido que ofrece esos servicios, se pasa directo a la fecha y hora.
            root.querySelector('[data-next]').addEventListener('click', () => {
                const offers = chosenBarber && B().barbersForServices(selectedServices()).some(b => b.id === chosenBarber.id);
                if (chosenBarber && !offers) {
                    Data().toast(t('barberNotOffers').replace('{name}', chosenBarber.alias || chosenBarber.name), 'warning');
                    view.barberId = null;
                }
                go(offers ? 3 : 2);
            });
        }

        // ---------------- Paso 2: barbero
        function renderBarbers() {
            const services = selectedServices();
            const barbers = B().barbersForServices(services);
            root.innerHTML = `
                ${stepsBar()}
                <h3 class="bw-title">${t('barbersTitle')}</h3>
                <p class="bw-sub">${escapeHtml(services.map(s => s.name).join(' + '))} · ${B().formatDuration(duration())}</p>
                ${barbers.length ? `<div class="bw-barbers">${barbers.map(barber => {
                    const next = B().nextAvailable(barber.id, duration());
                    const rating = B().barberRating(barber.id);
                    return `
                        <button type="button" class="bw-option bw-barber ${view.barberId === barber.id ? 'selected' : ''}" data-barber="${barber.id}">
                            <span class="bw-avatar" style="background-image:url('${escapeHtml(barber.avatar || '')}')"></span>
                            <span>
                                <strong>${escapeHtml(barber.alias || barber.name)}</strong>
                                <small>${escapeHtml(barber.name)}${rating.count ? ` · ⭐ ${rating.avg.toFixed(1)} (${rating.count})` : ''}</small>
                                <span class="bw-next ${next ? '' : 'none'}">${next ? `${t('nextSlot')}: ${B().relativeDay(next.date)} ${B().formatTime(next.time)}` : t('noUpcomingSlots')}</span>
                            </span>
                        </button>`;
                }).join('')}</div>` : `<div class="bw-alert">${t('noBarberForAll')}</div>`}
                <div class="bw-actions">
                    <button class="bw-btn" type="button" data-back><i class="fas fa-arrow-left"></i> ${t('back')}</button>
                </div>
            `;
            root.querySelectorAll('[data-barber]').forEach(button => button.addEventListener('click', () => {
                view.barberId = button.dataset.barber;
                view.date = null;
                view.time = null;
                go(3);
            }));
            root.querySelector('[data-back]').addEventListener('click', () => go(1));
        }

        // ---------------- Paso 3: fecha y hora
        function renderDateTime() {
            const db = Data().getState();
            const barber = db.barbers.find(b => b.id === view.barberId);
            const days = B().availableDates(view.barberId, duration(), db);
            if (!view.date) view.date = (days.find(d => d.count) || days[0]).key;
            const closedDay = !B().isShopOpen(view.date);
            const slots = closedDay ? [] : B().getSlots(view.barberId, view.date, duration());
            const groups = [
                [t('morning'), slots.filter(t => B().toMin(t) < 720)],
                [t('afternoon'), slots.filter(t => B().toMin(t) >= 720 && B().toMin(t) < 1020)],
                [t('evening'), slots.filter(t => B().toMin(t) >= 1020)]
            ].filter(g => g[1].length);
            root.innerHTML = `
                ${stepsBar()}
                <h3 class="bw-title">${t('dateTimeTitle')}</h3>
                <p class="bw-sub">${escapeHtml(barber ? barber.alias || barber.name : '')} · ${escapeHtml(selectedServices().map(s => s.name).join(' + '))} · ${B().formatDuration(duration())}</p>
                <div class="bw-dates" role="listbox" aria-label="${t('datesAria')}">
                    ${days.map(day => {
                        const date = B().parseKey(day.key);
                        // Los días cerrados se pueden tocar para ver el aviso; los llenos no.
                        return `<button type="button" class="bw-date ${view.date === day.key ? 'selected' : ''} ${day.closed ? 'closed' : ''}" data-date="${day.key}" ${day.count || day.closed ? '' : 'disabled'} aria-label="${B().formatDate(day.key)}${day.closed ? `, ${t('ariaClosed')}` : day.count ? `, ${day.count} ${t('ariaSlots')}` : `, ${t('ariaNoSlots')}`}">
                            <span>${date.toLocaleDateString(locale(), { weekday: 'short' })}</span><strong>${date.getDate()}</strong><small>${day.closed ? t('closedWord') : day.count ? `${day.count} ${t('freeWord')}` : t('fullWord')}</small></button>`;
                    }).join('')}
                </div>
                <div>
                    <div class="bw-period" style="font-size:.95rem; text-transform:capitalize;">${B().formatDate(view.date)}</div>
                    ${groups.length ? groups.map(([label, times]) => `
                        <div class="bw-period">${label}</div>
                        <div class="bw-times">${times.map(t => `<button type="button" class="bw-time ${view.time === t ? 'selected' : ''}" data-time="${t}">${B().formatTime(t)}</button>`).join('')}</div>
                    `).join('') : closedDay ? `
                        <div class="bw-closed" role="alert">
                            <strong><i class="fas fa-store-slash" aria-hidden="true"></i> ${t('closedDayTitle')}</strong>
                            <span class="bw-sub">${t('closedDayText')}</span>
                        </div>` : `
                        <div class="bw-empty">
                            <strong>${t('noSlotsDayTitle')}</strong>
                            <span class="bw-sub">${t('noSlotsDayText')}</span>
                        </div>`}
                    <div class="bw-hours"><span class="bw-hours-title"><i class="fas fa-clock" aria-hidden="true"></i> ${t('shopHoursTitle')}</span>${window.GabySchedule ? window.GabySchedule.html({ compact: true }) : escapeHtml(B().shopHoursSummary())}</div>
                </div>
                <div class="bw-actions">
                    <button class="bw-btn" type="button" data-back><i class="fas fa-arrow-left"></i> ${t('back')}</button>
                    <button class="bw-btn primary" type="button" data-next ${view.time ? '' : 'disabled'}>${t('reviewBtn')} <i class="fas fa-arrow-right"></i></button>
                </div>
            `;
            root.querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => {
                view.date = button.dataset.date;
                view.time = null;
                renderDateTime();
            }));
            root.querySelectorAll('[data-time]').forEach(button => button.addEventListener('click', () => {
                view.time = button.dataset.time;
                renderDateTime();
                root.querySelector('[data-next]').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }));
            root.querySelector('[data-back]').addEventListener('click', () => go(2));
            root.querySelector('[data-next]').addEventListener('click', () => go(4));
            root.querySelector('.bw-date.selected')?.scrollIntoView({ block: 'nearest', inline: 'center' });
        }

        // ---------------- Paso 4: revisar
        function summaryRows(appointment) {
            const services = selectedServices();
            const db = Data().getState();
            const barber = db.barbers.find(b => b.id === (appointment ? appointment.barber : view.barberId));
            const date = appointment ? String(appointment.dateTime).slice(0, 10) : view.date;
            const time = appointment ? String(appointment.dateTime).slice(11, 16) : view.time;
            return `
                <dl class="bw-summary">
                    ${appointment ? `<div><dt>${t('sumName')}</dt><dd>${escapeHtml(appointment.client)}</dd></div>` : ''}
                    ${appointment && appointment.clientEmail ? `<div><dt>${t('sumEmail')}</dt><dd>${escapeHtml(appointment.clientEmail)}</dd></div>` : ''}
                    <div><dt>${services.length > 1 ? t('sumServices') : t('sumService')}</dt><dd>${escapeHtml(services.map(s => s.name).join(' + '))}</dd></div>
                    <div><dt>${t('sumBarber')}</dt><dd>${escapeHtml(barber ? barber.name + (barber.alias ? ` (${barber.alias})` : '') : '')}</dd></div>
                    <div><dt>${t('sumDate')}</dt><dd style="text-transform:capitalize;">${B().formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>
                    <div><dt>${t('sumTime')}</dt><dd>${B().formatTime(time)}</dd></div>
                    <div><dt>${t('sumDuration')}</dt><dd>${B().formatDuration(duration())}</dd></div>
                    <div><dt>${t('sumPrice')}</dt><dd>${escapeHtml(B().priceLabel(services))} · ${t('sumPayInPerson')}</dd></div>
                    ${(appointment ? appointment.referencePhoto : view.referencePhoto) ? `<div><dt>${t('sumPhoto')}</dt><dd>${t('sumPhotoAttached')}</dd></div>` : ''}
                    ${appointment ? `<div><dt>${t('sumCode')}</dt><dd>${escapeHtml(appointment.code)}</dd></div>` : ''}
                </dl>
            `;
        }

        function renderReview() {
            const services = selectedServices();
            const vip = services.some(isVip);
            root.innerHTML = `
                ${stepsBar()}
                <h3 class="bw-title">${t('reviewTitle')}</h3>
                ${summaryRows()}
                <label class="bw-field">${t('fullNameLabel')}<input id="bw-name" type="text" maxlength="80" autocomplete="name" required placeholder="${t('fullNamePlaceholder')}" value="${escapeHtml(view.name)}"></label>
                <label class="bw-field">${t('emailLabel')}<input id="bw-email" type="email" maxlength="120" autocomplete="email" inputmode="email" required placeholder="tu@correo.com" value="${escapeHtml(view.email)}"><span class="bw-sub">${t('emailHint')}</span></label>
                <div class="bw-pay"><i class="fas fa-store" aria-hidden="true"></i><span><strong>${t('payInPersonStrong')}</strong> ${t('payReviewText')}</span></div>
                ${vip ? `
                    <div class="bw-empty" style="justify-items:stretch;">
                        <strong>${t('vipTitle')}</strong>
                        <div class="bw-grid">
                            <label class="bw-field">${t('vipTownLabel')}<select id="bw-vip-town" required><option value="">${t('vipTownPlaceholder')}</option>${PR_TOWNS.map(town => `<option>${town}</option>`).join('')}</select></label>
                            <label class="bw-field">${t('vipGuestsLabel')}<input id="bw-vip-guests" type="number" min="1" value="1"></label>
                        </div>
                        <label class="bw-field">${t('vipAddressLabel')}<textarea id="bw-vip-address" required placeholder="${t('vipAddressPlaceholder')}"></textarea></label>
                    </div>` : ''}
                <label class="bw-field">${t('noteLabel')}<textarea id="bw-notes" maxlength="300" placeholder="${t('notePlaceholder')}">${escapeHtml(view.notes)}</textarea></label>
                <div class="bw-photo">
                    <strong style="font-size:.9rem;">${t('photoTitle')}</strong>
                    <span class="bw-sub">${t('photoHelp')}</span>
                    <div class="bw-photo-drop">
                        ${view.referencePhoto ? `<span class="bw-photo-preview"><img src="${view.referencePhoto}" alt="${t('photoTitle')}"><button type="button" data-photo-remove aria-label="${t('removePhoto')}"><i class="fas fa-times"></i></button></span>` : ''}
                        <label class="bw-btn" style="position:relative;"><i class="fas fa-camera"></i> ${view.referencePhoto ? t('changePhoto') : t('uploadPhoto')}<input type="file" id="bw-photo" accept="image/*"></label>
                    </div>
                </div>
                <div class="booking-summary">${window.GabyLegal ? window.GabyLegal.bookingSummaryHtml(services) : ''}</div>
                <label class="bw-check"><input type="checkbox" id="bw-agree"><span>${t('agreeText')}</span></label>
                <p class="bw-sub">${t('changeCancelNote')}</p>
                <div class="bw-actions">
                    <button class="bw-btn" type="button" data-back><i class="fas fa-arrow-left"></i> ${t('back')}</button>
                    <button class="bw-btn primary" type="button" data-confirm><i class="fas fa-check"></i> ${t('confirmBtn')}</button>
                </div>
            `;
            root.querySelector('[data-back]').addEventListener('click', () => go(3));
            root.querySelector('#bw-name').addEventListener('input', event => { view.name = event.target.value; });
            root.querySelector('#bw-email').addEventListener('input', event => { view.email = event.target.value; });
            root.querySelector('#bw-notes').addEventListener('input', event => { view.notes = event.target.value; });
            root.querySelector('#bw-photo').addEventListener('change', async event => {
                const file = event.target.files && event.target.files[0];
                if (!file) return;
                try {
                    view.referencePhoto = await compressPhoto(file);
                    const agreed = root.querySelector('#bw-agree')?.checked;
                    renderReview();
                    if (agreed) root.querySelector('#bw-agree').checked = true;
                } catch (error) {
                    Data().toast(error.userMessage || t('photoReadError'), 'error');
                }
            });
            root.querySelector('[data-photo-remove]')?.addEventListener('click', () => { view.referencePhoto = ''; renderReview(); });
            root.querySelector('[data-confirm]').addEventListener('click', confirm);
        }

        async function confirm() {
            const nameInput = root.querySelector('#bw-name');
            view.name = nameInput.value.trim().replace(/\s+/g, ' ');
            if (view.name.length < 2) {
                Data().toast(t('toastName'), 'warning');
                nameInput.focus();
                return;
            }
            // PR #17 (E): el correo es obligatorio y con formato válido; sin él no
            // se puede confirmar (el motor y el servidor lo exigen también).
            const emailInput = root.querySelector('#bw-email');
            view.email = emailInput ? emailInput.value.trim() : '';
            if (!B().isValidEmail(view.email)) {
                Data().toast(t('toastEmail'), 'warning');
                if (emailInput) emailInput.focus();
                return;
            }
            if (!root.querySelector('#bw-agree').checked) {
                Data().toast(t('toastAgree'), 'warning');
                return;
            }
            const vipTown = root.querySelector('#bw-vip-town');
            const vipAddress = root.querySelector('#bw-vip-address');
            if (vipTown && (!vipTown.value || !vipAddress.value.trim())) {
                Data().toast(t('toastVip'), 'warning');
                return;
            }
            const button = root.querySelector('[data-confirm]');
            button.disabled = true;
            button.textContent = t('confirmingBtn');
            let created = null;
            let failure = '';
            const ok = await Data().commit(state => {
                try {
                    created = B().createAppointment(state, {
                        walkIn: { name: view.name, email: view.email }, barberId: view.barberId, services: B().findServices(view.services, state),
                        date: view.date, time: view.time, source: 'online',
                        notes: root.querySelector('#bw-notes').value.trim(),
                        referencePhoto: view.referencePhoto || '',
                        vipDetails: vipTown ? { town: vipTown.value, address: vipAddress.value.trim(), guests: root.querySelector('#bw-vip-guests').value } : null
                    });
                } catch (error) {
                    failure = error.userMessage || '';
                    throw error;
                }
                created = { ...created };
            }, { success: null, error: t('confirmError') });
            if (!ok) {
                button.disabled = false;
                button.innerHTML = `<i class="fas fa-check"></i> ${t('confirmBtn')}`;
                // Si el horario se ocupó mientras tanto, se refrescan los espacios.
                if (!failure || /horario/i.test(failure)) {
                    view.time = null;
                    go(3);
                }
                return;
            }
            view.result = created;
            // El servidor puede confirmar la cita automáticamente (el trigger fija
            // APROBADA cuando la confirmación automática está activa en la base de
            // datos): se consulta el estado real para no mostrar PENDIENTE cuando
            // la cita ya está confirmada.
            const localStatus = created.status;
            // La fila del servidor puede no verse en la primera consulta justo
            // después de guardar: se reintenta un par de veces con una pausa
            // corta antes de quedarse con el estado local.
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const server = await B().lookupByCode(created.code);
                    if (server && server.status) { created.status = server.status; break; }
                } catch (_) { /* sin conexión: se reintenta y luego se muestra lo último que se sabía */ }
                if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400));
            }
            // El aviso al cliente se creó con el estado local (PENDIENTE): si el
            // servidor ya aprobó la cita, se corrige a la redacción de confirmada
            // (las mismas palabras que createAppointment usa para APROBADA).
            if (localStatus === 'PENDIENTE' && created.status === 'APROBADA') {
                await Data().commit(state => {
                    const notice = (state.notifications || []).find(n => n.audience === 'client' && n.appointmentCode === created.code);
                    if (!notice) return;
                    const lang = notice.title === 'Cita recibida' ? 'es' : (notice.title === 'Appointment received' ? 'en' : null);
                    if (!lang) return;
                    notice.title = lang === 'es' ? 'Cita confirmada' : 'Appointment confirmed';
                    notice.type = 'aprobada';
                    const suffix = lang === 'es' ? ' Te avisaremos cuando el barbero la confirme.' : ' We will let you know when the barber confirms it.';
                    if (notice.body && notice.body.endsWith(suffix)) notice.body = notice.body.slice(0, -suffix.length);
                }, { success: null, error: t('noticeUpdateError') });
            }
            // Primero se muestra la confirmación (paso 5) y después se guarda la
            // cita en este dispositivo: guardar dispara 'gabymyappointments' y
            // booking.html no debe cambiar a la vista "Tu cita" mientras se ve
            // la confirmación.
            go(5);
            B().rememberMyAppointment(created);
            // La cita nueva entra en el token push de este dispositivo, para
            // que los avisos de esta cita (aprobación, cancelación,
            // recordatorios) lleguen por push sin esperar a otra apertura.
            try {
                if (window.GabyNotifications && typeof window.GabyNotifications.refreshPushToken === 'function') {
                    window.GabyNotifications.refreshPushToken();
                }
            } catch (_) { /* el push del token no bloquea la confirmación */ }
            // La ficha del cliente se registra en el servidor por RPC: el sync
            // anónimo no puede insertar en clients por RLS (clients_staff_insert
            // exige is_staff()). Sin await y sin mensajes: la cita ya está
            // guardada y la pantalla no debe fallar ni demorarse por esto.
            try {
                if (window.GabyCloud && typeof window.GabyCloud.registerClientForAppointment === 'function') {
                    window.GabyCloud.registerClientForAppointment(created.code);
                }
            } catch (_) { /* el registro del cliente nunca bloquea la confirmación */ }
            // El barbero también recibe la cita por correo (FormSpark, un
            // formulario por barbero). Nunca bloquea la confirmación.
            notifyBarberByEmail(created);
            Data().toast(created.status === 'APROBADA' ? t('toastConfirmed') : t('toastReceived'), 'success');
            if (typeof opts.onDone === 'function') opts.onDone(created);
        }

        // ---------------- Paso 5: confirmacion
        function renderDone() {
            const appointment = view.result;
            const confirmed = appointment.status === 'APROBADA';
            root.innerHTML = `
                <div class="bw-done">
                    <span class="bw-check-icon"><i class="fas fa-check"></i></span>
                    <h3 class="bw-title">${confirmed ? t('doneConfirmedTitle') : t('doneReceivedTitle')}</h3>
                    <p class="bw-sub">${confirmed ? '' : t('doneBarberWillConfirm')}${t('doneKeepCode')}<strong>${escapeHtml(appointment.code)}</strong>${t('doneKeepCodeAfter')}</p>
                    ${appointment.clientEmail ? `<p class="bw-sub">${t('doneEmailTo').replace('{email}', escapeHtml(appointment.clientEmail))}</p>` : ''}
                    ${summaryRows(appointment)}
                    <div class="bw-pay" style="width:100%;"><i class="fas fa-store"></i><span><strong>${t('donePayLabel')}</strong> ${t('donePayText')}</span></div>
                    <div class="bw-actions" style="justify-content:center;">
                        <a class="bw-btn primary" href="index.html"><i class="fas fa-house"></i> ${t('backHome')}</a>
                    </div>
                    <button class="bw-btn" type="button" data-again style="border:0;">${t('bookAnother')}</button>
                </div>
            `;
            root.querySelector('[data-again]').addEventListener('click', () => {
                Object.assign(view, { step: 1, services: [], barberId: null, date: null, time: null, result: null, notes: '', referencePhoto: '', email: '' });
                go(1);
            });
        }

        function go(step, initial) {
            if (step === 2 && !view.services.length) step = 1;
            if (step >= 3 && !view.barberId) step = view.services.length ? 2 : 1;
            if (step === 4 && !view.time) step = 3;
            view.step = step;
            ({ 1: renderServices, 2: renderBarbers, 3: renderDateTime, 4: renderReview, 5: renderDone })[step]();
            if (!initial && opts.scrollOnStep !== false) {
                const top = root.getBoundingClientRect().top;
                if (top < 0 || top > window.innerHeight * 0.6) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        go(view.step, true);
        return {
            selectService(name) {
                if (!view.services.includes(name)) view.services.push(name);
                view.time = null;
                go(view.barberId ? 3 : 2);
            },
            selectBarber(barberId) {
                const db = Data().getState();
                if (!db.barbers.some(b => b.id === barberId && b.active !== false)) return;
                Object.assign(view, { barberId, date: null, time: null, result: null });
                const offers = view.services.length && B().barbersForServices(selectedServices()).some(b => b.id === barberId);
                go(offers ? 3 : 1);
            },
            refresh() { if (view.step !== 5) go(view.step); },
            get step() { return view.step; }
        };
    }

    window.GabyBookingWidget = { mount };
})();
