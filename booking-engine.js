(function () {
    // =========================================================================
    // GabyBooking: motor de citas (sin pagos en linea; los precios son informativos).
    // - Disponibilidad real: horario del barbero, horario de la barberia, descansos,
    //   dias libres, vacaciones, bloqueos manuales, duracion del servicio y citas existentes.
    // - Citas con historial de cambios, cancelaciones (quien/cuando/motivo), reprogramacion
    //   sin duplicar, completadas y no-shows con reglas configurables.
    // - Reservas en linea sin cuenta: el cliente escribe su nombre completo al reservar.
    // - Bloqueo de clientes, resenas publicas, notificaciones del personal y estadisticas.
    // Todas las funciones que cambian datos reciben el "state" dentro de GabyData.updateState/commit.
    // =========================================================================
    const ACTIVE = ['PENDIENTE', 'APROBADA'];
    const STATUS_LABELS = {
        PENDIENTE: 'Pendiente',
        APROBADA: 'Confirmada',
        COMPLETADA: 'Completada',
        CANCELADA: 'Cancelada',
        NO_SHOW: 'No-Show',
        RECHAZADA: 'Rechazada'
    };
    const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const DEFAULT_MINUTES = 40;
    const BLOCKED_MESSAGE = 'No es posible realizar una reservación online en este momento. Comunícate con la barbería para recibir asistencia.';

    const db = () => window.GabyData.getState();
    const pad = n => String(n).padStart(2, '0');
    const toMin = hhmm => {
        const [h, m] = String(hhmm || '0:0').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    const fromMin = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const parseKey = key => {
        const [y, m, d] = String(key).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    };
    const parseLocal = value => {
        if (!value) return null;
        const [datePart, timePart = '00:00'] = String(value).split('T');
        const [y, m, d] = datePart.split('-').map(Number);
        const [hh, mm] = timePart.split(':').map(Number);
        const date = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
        return Number.isNaN(date.getTime()) ? null : date;
    };
    const addDays = (date, days) => { const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy; };
    const uid = prefix => window.GabyData.makeId(prefix);
    const nowIso = () => new Date().toISOString();

    function settings(state) {
        const s = (state || db()).settings;
        return { booking: s.booking || {}, business: s.business || {} };
    }

    // ---------------------------------------------------------------------
    // Formatos
    // ---------------------------------------------------------------------
    function formatTime(hhmm) {
        const minutes = toMin(hhmm);
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        const suffix = h >= 12 ? 'PM' : 'AM';
        return `${((h + 11) % 12) + 1}:${pad(m)} ${suffix}`;
    }

    function formatDate(key, options) {
        const date = typeof key === 'string' ? parseKey(key) : key;
        return date.toLocaleDateString('es-PR', options || { weekday: 'long', day: 'numeric', month: 'long' });
    }

    function relativeDay(key) {
        const today = dateKey(new Date());
        if (key === today) return 'Hoy';
        if (key === dateKey(addDays(new Date(), 1))) return 'Mañana';
        return formatDate(key, { weekday: 'short', day: 'numeric', month: 'short' });
    }

    function formatDuration(minutes) {
        const m = Number(minutes) || 0;
        if (m < 60) return `${m} minutos`;
        const h = Math.floor(m / 60);
        const rest = m % 60;
        return `${h} hora${h === 1 ? '' : 's'}${rest ? ` ${rest} min` : ''}`;
    }

    const statusLabel = status => STATUS_LABELS[status] || status || '—';

    // ---------------------------------------------------------------------
    // Servicios y duracion
    // ---------------------------------------------------------------------
    function serviceMinutes(service) {
        return Number(service && service.minutes) || DEFAULT_MINUTES;
    }

    // Opcion "No sé cómo se llama el recorte": no es un servicio publicado, solo existe al reservar.
    // El barbero define el recorte en la barbería (puede cambiarlo al editar la cita).
    const UNKNOWN_CUT = 'No sé cómo se llama el recorte';
    const isUnknownCut = name => name === UNKNOWN_CUT;

    function unknownCutService(state) {
        return {
            id: 'unknown-cut', name: UNKNOWN_CUT, category: 'Cortes', barbers: [], active: true, unknownCut: true,
            minutes: Number(settings(state).booking.unknownCutMinutes) || DEFAULT_MINUTES,
            price: 'A consultar', duration: 'El barbero te ayuda a escogerlo',
            description: 'Escoge esta opción si no sabes el nombre del recorte. Puedes subir una foto de referencia.'
        };
    }

    function findServices(names, state) {
        const services = (state || db()).services;
        return (names || []).map(name => (isUnknownCut(name) ? unknownCutService(state) : services.find(service => service.name === name))).filter(Boolean);
    }

    function appointmentServiceNames(appointment) {
        if (Array.isArray(appointment.services) && appointment.services.length) return appointment.services;
        return String(appointment.service || '').split(' + ').map(s => s.trim()).filter(Boolean);
    }

    function appointmentDuration(appointment, state) {
        if (Number(appointment.duration)) return Number(appointment.duration);
        const services = findServices(appointmentServiceNames(appointment), state);
        return services.length ? services.reduce((sum, service) => sum + serviceMinutes(service), 0) : DEFAULT_MINUTES;
    }

    function totalMinutes(services) {
        return services.reduce((sum, service) => sum + serviceMinutes(service), 0) || DEFAULT_MINUTES;
    }

    function priceLabel(services) {
        if (window.GabyForms) return window.GabyForms.estimateTotal(services).label;
        return services.map(s => s.price).join(' + ');
    }

    function barberOffers(barber, service) {
        return !service.barbers || !service.barbers.length || service.barbers.includes(barber.id);
    }

    function barbersForServices(services, state) {
        return (state || db()).barbers.filter(barber => barber.active !== false && services.every(service => barberOffers(barber, service)));
    }

    // ---------------------------------------------------------------------
    // Horarios
    // ---------------------------------------------------------------------
    // Horario de la barbería, igual para todos los barberos (0 = domingo). null = cerrado.
    // Martes a jueves 8 AM – 6 PM, viernes 8 AM – 8 PM y sábado 7 AM – 5 PM. Domingo y lunes cerrado.
    // Ninguna cita (en línea ni manual) puede quedar fuera de este horario.
    const SHOP_HOURS = [null, null, { open: '08:00', close: '18:00' }, { open: '08:00', close: '18:00' }, { open: '08:00', close: '18:00' }, { open: '08:00', close: '20:00' }, { open: '07:00', close: '17:00' }];
    const CLOSED_MESSAGE = 'La barbería está cerrada los domingos y lunes. Abrimos martes a jueves de 8:00 AM a 6:00 PM, viernes de 8:00 AM a 8:00 PM y sábado de 7:00 AM a 5:00 PM.';

    function shopHoursFor(key) {
        return SHOP_HOURS[parseKey(key).getDay()] || null;
    }

    function isShopOpen(key) {
        return Boolean(shopHoursFor(key));
    }

    function shopHoursSummary() {
        return 'Martes a jueves 8:00 AM – 6:00 PM · Viernes 8:00 AM – 8:00 PM · Sábado 7:00 AM – 5:00 PM';
    }

    function defaultWeek() {
        return SHOP_HOURS.map(hours => hours
            ? { off: false, start: hours.open, end: hours.close, breaks: [] }
            : { off: true, start: '08:00', end: '18:00', breaks: [] });
    }

    function weeklySchedule(barber) {
        return Array.isArray(barber && barber.weeklySchedule) && barber.weeklySchedule.length === 7 ? barber.weeklySchedule : defaultWeek();
    }

    function scheduleSummary(barber) {
        const week = weeklySchedule(barber);
        const groups = [];
        [1, 2, 3, 4, 5, 6, 0].forEach(day => {
            const d = week[day];
            const label = d.off ? 'No disponible' : `${formatTime(d.start)} – ${formatTime(d.end)}`;
            const last = groups[groups.length - 1];
            if (last && last.label === label) last.days.push(day);
            else groups.push({ label, days: [day] });
        });
        const short = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        return groups.filter(g => g.label !== 'No disponible')
            .map(g => `${short[g.days[0]]}${g.days.length > 1 ? `–${short[g.days[g.days.length - 1]]}` : ''} ${g.label}`)
            .join(' · ') || 'Horario por confirmar';
    }

    // Bloqueos que afectan a un barbero en una fecha (vacaciones, dias libres, citas personales).
    function blocksFor(barberId, key, state) {
        return ((state || db()).timeBlocks || []).filter(block =>
            (block.barberId === barberId || block.barberId === 'all') && key >= block.startDate && key <= (block.endDate || block.startDate));
    }

    // Ventana de trabajo del dia o null si no trabaja.
    function dayWindow(barber, key, state) {
        const date = parseKey(key);
        const weekday = date.getDay();
        const day = weeklySchedule(barber)[weekday];
        const shopHours = SHOP_HOURS[weekday];
        if (!shopHours || !day || day.off) return null;
        const blocks = blocksFor(barber.id, key, state);
        if (blocks.some(block => block.allDay)) return null;
        const start = Math.max(toMin(day.start), toMin(shopHours.open));
        const end = Math.min(toMin(day.end), toMin(shopHours.close));
        if (end <= start) return null;
        const busy = (day.breaks || []).map(br => ({ start: toMin(br.start), end: toMin(br.end), label: br.label || 'Descanso' }));
        blocks.forEach(block => busy.push({ start: toMin(block.startTime), end: toMin(block.endTime), label: block.reason || 'Bloqueado' }));
        return { start, end, busy };
    }

    function appointmentsFor(barberId, key, state, excludeCode) {
        return (state || db()).appointments.filter(item =>
            item.barber === barberId && ACTIVE.includes(item.status) && item.code !== excludeCode && String(item.dateTime || '').slice(0, 10) === key);
    }

    // Horas disponibles (HH:MM) para un barbero, fecha y duracion.
    function getSlots(barberId, key, duration, options) {
        const state = (options && options.state) || db();
        const barber = state.barbers.find(item => item.id === barberId);
        if (!barber || barber.active === false) return [];
        const rules = settings(state).booking;
        const win = dayWindow(barber, key, state);
        if (!win) return [];
        const step = Number(rules.slotStep) || 15;
        const minutes = Number(duration) || DEFAULT_MINUTES;
        const busy = win.busy.slice();
        appointmentsFor(barberId, key, state, options && options.excludeCode).forEach(item => {
            const start = toMin(String(item.dateTime).slice(11, 16));
            busy.push({ start, end: start + appointmentDuration(item, state) });
        });
        // Ocupación del servidor sin nombres, teléfonos ni datos de otros clientes.
        (state.busySlots || []).filter(item => item.barber === barberId && item.code !== (options && options.excludeCode) && String(item.dateTime).slice(0, 10) === key).forEach(item => {
            const start = toMin(String(item.dateTime).slice(11, 16));
            busy.push({ start, end: start + Number(item.duration || DEFAULT_MINUTES) });
        });
        const now = new Date();
        const ignoreRules = options && options.staff;
        const earliest = ignoreRules ? null : new Date(now.getTime() + (Number(rules.minNoticeHours) || 0) * 3600000);
        const lastDay = ignoreRules ? null : addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), Number(rules.maxAdvanceDays) || 30);
        if (lastDay && parseKey(key) > lastDay) return [];
        // Candidatos: cada "step" minutos y, ademas, justo cuando termina otra cita o descanso
        // (ej. si una cita termina 2:40 PM, se ofrece 2:40 PM y no se pierde tiempo).
        const candidates = new Set();
        for (let start = win.start; start + minutes <= win.end; start += step) candidates.add(start);
        busy.forEach(b => { if (b.end >= win.start && b.end + minutes <= win.end) candidates.add(b.end); });
        const slots = [];
        for (const start of [...candidates].sort((a, b) => a - b)) {
            const end = start + minutes;
            if (busy.some(b => start < b.end && end > b.start)) continue;
            const at = parseLocal(`${key}T${fromMin(start)}`);
            if (earliest && at < earliest) continue;
            if (ignoreRules && at < now) continue;
            slots.push(fromMin(start));
        }
        return slots;
    }

    function nextAvailable(barberId, duration, state) {
        const rules = settings(state).booking;
        const today = new Date();
        for (let i = 0; i <= (Number(rules.maxAdvanceDays) || 30); i += 1) {
            const key = dateKey(addDays(today, i));
            const slots = getSlots(barberId, key, duration, { state });
            if (slots.length) return { date: key, time: slots[0] };
        }
        return null;
    }

    function availableDates(barberId, duration, state, excludeCode) {
        const rules = settings(state).booking;
        const today = new Date();
        const days = [];
        for (let i = 0; i <= (Number(rules.maxAdvanceDays) || 30); i += 1) {
            const key = dateKey(addDays(today, i));
            days.push({ key, closed: !isShopOpen(key), count: getSlots(barberId, key, duration, { state, excludeCode }).length });
        }
        return days;
    }

    // ---------------------------------------------------------------------
    // Clientes: estadisticas, no-shows y bloqueos
    // ---------------------------------------------------------------------
    function clientAppointments(clientId, state) {
        const s = state || db();
        const client = s.clients.find(item => item.id === clientId);
        return s.appointments.filter(item => item.clientId === clientId || (client && item.clientEmail && item.clientEmail === client.email));
    }

    function mostCommon(values) {
        const counts = {};
        values.filter(Boolean).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }

    function clientStats(clientId, state) {
        const s = state || db();
        const list = clientAppointments(clientId, s).slice().sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));
        const now = new Date();
        const upcoming = list.filter(item => ACTIVE.includes(item.status) && parseLocal(item.dateTime) >= now);
        const completed = list.filter(item => item.status === 'COMPLETADA');
        const last = completed[completed.length - 1] || null;
        const visits = completed.length;
        return {
            total: list.length,
            completed: visits,
            cancelled: list.filter(item => item.status === 'CANCELADA').length,
            noShows: list.filter(item => item.status === 'NO_SHOW').length,
            upcoming,
            next: upcoming[0] || null,
            last,
            history: list.slice().reverse(),
            frequentBarber: mostCommon(completed.map(item => item.barber)),
            frequentService: mostCommon(completed.flatMap(appointmentServiceNames)),
            isFrequent: visits >= (Number(settings(s).booking.frequentClientVisits) || 5)
        };
    }

    function noShowLevel(count, state) {
        const rules = settings(state).booking.noShowRules || {};
        if (!rules.enabled || !count) return { level: 'normal', label: 'Normal' };
        if (count >= rules.blockAt) return { level: 'bloqueo', label: 'Reservas online bloqueadas' };
        if (count >= rules.alertAt) return { level: 'alerta', label: 'Alerta para el administrador' };
        if (count >= rules.warnAt) return { level: 'advertencia', label: 'Advertencia' };
        return { level: 'normal', label: 'Normal' };
    }

    function activeBlock(clientId, state) {
        return ((state || db()).clientBlocks || []).find(block => block.clientId === clientId && block.active) || null;
    }

    // ---------------------------------------------------------------------
    // Notificaciones (centro de avisos: notificaciones.html)
    // audience 'staff' (panel del personal, como hasta ahora) o 'client' (el
    // cliente lo ve por su código de cita). Las llamadas actuales no pasan
    // audience y siguen siendo avisos del personal.
    // ---------------------------------------------------------------------
    function notify(state, { barberId, clientId, audience, type, title, body, code }) {
        state.notifications = state.notifications || [];
        const notice = {
            id: uid('ntf'), audience: audience || 'staff', barberId: barberId || null, clientId: clientId || null,
            type, title, body, appointmentCode: code || null, createdAt: nowIso(), readAt: null
        };
        state.notifications.unshift(notice);
        if (state.notifications.length > 500) state.notifications.length = 500;
        return notice;
    }

    // Textos de los avisos al cliente en el idioma de este navegador (es/en).
    function clientText(state, es, en) {
        return settings(state).defaultLanguage === 'en' ? en : es;
    }

    function describe(appointment) {
        const key = String(appointment.dateTime).slice(0, 10);
        const time = String(appointment.dateTime).slice(11, 16);
        return `${appointment.service} · ${formatDate(key)} a las ${formatTime(time)}`;
    }

    function pushHistory(appointment, action, by, detail) {
        appointment.history = appointment.history || [];
        appointment.history.push({ at: nowIso(), action, by: by || 'Sistema', detail: detail || '' });
    }

    function barberLabel(state, barberId) {
        const barber = state.barbers.find(item => item.id === barberId);
        if (!barber) return barberId || '';
        return barber.alias && barber.alias !== barber.name ? `${barber.name} (${barber.alias})` : barber.name;
    }

    // Enlace de Google Calendar con la cita ya rellenada (no hacen falta
    // credenciales: abre calendar.google.com con el evento listo para guardar).
    // La hora guardada es local (Puerto Rico); se pasa a UTC para el enlace.
    function googleCalendarUrl(appointment, state) {
        const start = parseLocal(appointment.dateTime);
        if (!start) return '';
        const end = new Date(start.getTime() + appointmentDuration(appointment, state) * 60000);
        const fmt = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
        const q = `action=TEMPLATE&text=${encodeURIComponent(`Cita GOAT Style Salon — ${appointment.client} (${appointment.service})`)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(`${appointment.service} con ${appointment.barberName || barberLabel(state, appointment.barber)} · Código ${appointment.code} · Pago presencial en la barbería.`)}&location=${encodeURIComponent('GOAT Style Salon, Barranquitas, Puerto Rico')}`;
        return `https://calendar.google.com/calendar/render?${q}`;
    }

    // ---------------------------------------------------------------------
    // Nombre del cliente en reservas en linea (se escribe al reservar)
    // ---------------------------------------------------------------------
    const NAME_MAX = 80;

    function normalizeName(name) {
        return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function cleanName(name) {
        return String(name || '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
    }

    // Si el nombre coincide con una sola ficha de cliente, la cita se une a esa ficha
    // (historial, no-shows y bloqueos). Si hay varias o ninguna, la cita queda sin ficha.
    function matchClientByName(state, name) {
        const key = normalizeName(name);
        if (!key) return null;
        const found = (state.clients || []).filter(client => normalizeName(client.name) === key);
        return found.length === 1 ? found[0] : null;
    }

    // ---------------------------------------------------------------------
    // Validaciones y operaciones de citas
    // ---------------------------------------------------------------------
    function validateBooking({ clientId, barberId, services, date, time, excludeCode, staff }, state) {
        const s = state || db();
        if (!services || !services.length) return 'Escoge al menos un servicio.';
        const barber = s.barbers.find(item => item.id === barberId);
        if (!barber || barber.active === false) return 'Ese barbero no está disponible.';
        if (!services.every(service => barberOffers(barber, service))) return `${barber.alias || barber.name} no ofrece uno de los servicios escogidos.`;
        if (!date || !isShopOpen(date)) return CLOSED_MESSAGE;
        const hours = shopHoursFor(date);
        if (!time || toMin(time) < toMin(hours.open) || toMin(time) + totalMinutes(services) > toMin(hours.close)) {
            return `Ese horario está fuera del horario de la barbería. Ese día abrimos de ${formatTime(hours.open)} a ${formatTime(hours.close)}.`;
        }
        if (!staff && clientId) {
            if (activeBlock(clientId, s)) return BLOCKED_MESSAGE;
            const rules = settings(s).booking;
            const future = clientStats(clientId, s).upcoming.filter(item => item.code !== excludeCode).length;
            if (!excludeCode && rules.maxFutureAppointments && future >= rules.maxFutureAppointments) {
                return `Ya hay ${future} cita${future === 1 ? '' : 's'} próxima${future === 1 ? '' : 's'} a este nombre. Se permiten hasta ${rules.maxFutureAppointments} a la vez. Comunícate con la barbería.`;
            }
        }
        const slots = getSlots(barberId, date, totalMinutes(services), { state: s, excludeCode, staff });
        if (!slots.includes(time)) return 'Ese horario ya no está disponible. Escoge otra hora.';
        return null;
    }

    function uniqueCode(state) {
        let code;
        do { code = `GS-${Math.floor(100000 + Math.random() * 900000)}`; } while (state.appointments.some(item => item.code === code));
        return code;
    }

    // Crea la cita (online o manual). Devuelve el objeto de la cita.
    // - Online: walkIn.name es el nombre completo que escribe el cliente al reservar.
    // - Manual (personal): client es una ficha existente o walkIn trae nombre y teléfono.
    function createAppointment(state, { client, walkIn, barberId, services, date, time, vipDetails, notes, referencePhoto, by, source }) {
        const rules = settings(state).booking;
        const manual = source === 'manual';
        const typedName = cleanName(walkIn && walkIn.name);
        if (!manual && !client && typedName.length < 2) throw Object.assign(new Error('name'), { userMessage: 'Escribe tu nombre completo.' });
        let record = client || (!manual ? matchClientByName(state, typedName) : null);
        const error = validateBooking({ clientId: record && record.id, barberId, services, date, time, staff: manual }, state);
        if (error) throw Object.assign(new Error('booking'), { userMessage: error });
        // Si nadie reservó antes con ese nombre, se crea su ficha de cliente para
        // que aparezca en Clientes con su historial, no-shows y bloqueos. En
        // línea solo se conoce el nombre; el teléfono llega cuando lo escribe el
        // personal (o en la cita manual sin ficha).
        if (!record) {
            record = {
                id: uid('cl'), name: typedName, email: '', phone: (walkIn && walkIn.phone) || '',
                birthDate: '', haircut: '', beard: '', preferredBarber: barberId,
                photo: '', consent: null, marketingConsent: null,
                registeredAt: nowIso(), status: 'Activo', address: '', altPhones: [], lastModifiedAt: null
            };
            state.clients = state.clients || [];
            state.clients.push(record);
        }
        const code = uniqueCode(state);
        const status = manual || rules.autoConfirm ? 'APROBADA' : 'PENDIENTE';
        const appointment = {
            code,
            clientId: record ? record.id : null,
            client: typedName || (record && record.name) || 'Cliente',
            clientEmail: record ? record.email || '' : '',
            clientPhone: record ? record.phone || '' : (walkIn && walkIn.phone) || '',
            service: services.map(s => s.name).join(' + '),
            services: services.map(s => s.name),
            duration: totalMinutes(services),
            price: priceLabel(services),
            barber: barberId,
            barberName: barberLabel(state, barberId),
            status,
            dateTime: `${date}T${time}`,
            vipDetails: vipDetails || null,
            notes: notes || '',
            referencePhoto: /^data:image\/(jpeg|png|webp);base64,/.test(String(referencePhoto || '')) && referencePhoto.length <= 400000 ? referencePhoto : '',
            unknownCut: services.some(s => isUnknownCut(s.name)),
            source: source || 'online',
            policyAcceptance: manual ? null : { version: (window.GabyLegal && window.GabyLegal.value('bookingPolicyVersion')) || '', acceptedAt: nowIso() },
            createdAt: nowIso(),
            history: []
        };
        pushHistory(appointment, 'Creada', by || (manual ? 'Personal' : 'Cliente'), `${statusLabel(status)} · ${describe(appointment)}`);
        state.appointments.push(appointment);
        notify(state, { barberId, type: 'nueva', code, title: 'Nueva cita', body: `${appointment.client}: ${describe(appointment)}.` });
        // Aviso al cliente: confirmada, o recibida y pendiente de aprobación del barbero.
        notify(state, {
            audience: 'client', clientId: appointment.clientId, code,
            type: status === 'APROBADA' ? 'aprobada' : 'nueva',
            title: clientText(state, status === 'APROBADA' ? 'Cita confirmada' : 'Cita recibida', status === 'APROBADA' ? 'Appointment confirmed' : 'Appointment received'),
            body: `${describe(appointment)} con ${appointment.barberName}.${status === 'APROBADA' ? '' : clientText(state, ' Te avisaremos cuando el barbero la confirme.', ' We will let you know when the barber confirms it.')}`
        });
        state.activity = state.activity || [];
        state.activity.unshift({ id: uid('act'), type: 'booking', text: `${appointment.client} reservó ${appointment.service} con ${appointment.barberName}.`, createdAt: nowIso() });
        return appointment;
    }

    // Consulta de estado con el codigo de la cita (no hace falta cuenta).
    // Con Supabase se pregunta al servidor; sin servidor se busca en los datos de este navegador.
    async function lookupByCode(code) {
        const key = String(code || '').trim().toUpperCase();
        if (!/^GS-\d{6}$/.test(key)) return null;
        if (window.GabyCloud && window.GabyCloud.enabled) return window.GabyCloud.appointmentStatus(key);
        const found = db().appointments.find(item => item.code === key);
        return found ? { code: found.code, status: found.status, service: found.service, dateTime: found.dateTime, barberName: found.barberName || barberLabel(db(), found.barber) } : null;
    }

    // ---------------------------------------------------------------------
    // "Mi cita": las citas reservadas desde este navegador (no hay cuentas).
    // Solo se guarda el código y lo necesario para mostrarla; el estado se consulta con el código.
    // ---------------------------------------------------------------------
    const MY_KEY = 'gs_my_appointments';

    function readMine() {
        try {
            const list = JSON.parse(localStorage.getItem(MY_KEY) || '[]');
            return Array.isArray(list) ? list.filter(item => item && item.code) : [];
        } catch (_) {
            return [];
        }
    }

    function saveMine(list) {
        try { localStorage.setItem(MY_KEY, JSON.stringify(list)); } catch (_) { /* almacenamiento bloqueado */ }
        window.dispatchEvent(new CustomEvent('gabymyappointments'));
    }

    function rememberMyAppointment(appointment) {
        if (!appointment || !appointment.code) return;
        const entry = {
            code: appointment.code, status: appointment.status, service: appointment.service,
            dateTime: appointment.dateTime, barberName: appointment.barberName || '', savedAt: nowIso()
        };
        saveMine([entry, ...readMine().filter(item => item.code !== appointment.code)].slice(0, 10));
    }

    function forgetMyAppointment(code) {
        saveMine(readMine().filter(item => item.code !== code));
    }

    // Citas que todavía no han pasado, la más cercana primero (incluye las rechazadas o canceladas
    // para que el cliente vea el resultado hasta la fecha de la cita).
    function myUpcomingAppointments() {
        const now = Date.now();
        return readMine()
            .filter(item => { const start = parseLocal(item.dateTime); return start && start.getTime() > now; })
            .sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));
    }

    // Actualiza el estado de cada cita guardada consultando su código.
    async function refreshMyAppointments() {
        const list = readMine();
        let changed = false;
        for (const item of list) {
            try {
                const found = await lookupByCode(item.code);
                if (!found) continue;
                ['status', 'service', 'dateTime', 'barberName'].forEach(key => {
                    if (found[key] && found[key] !== item[key]) { item[key] = found[key]; changed = true; }
                });
            } catch (_) { /* sin conexión: se muestra lo último que se sabía */ }
        }
        const now = Date.now();
        const kept = list.filter(item => { const start = parseLocal(item.dateTime); return start && start.getTime() > now - 86400000; });
        if (changed || kept.length !== list.length) saveMine(kept);
        return myUpcomingAppointments();
    }

    function hoursUntil(appointment) {
        const start = parseLocal(appointment.dateTime);
        return start ? (start.getTime() - Date.now()) / 3600000 : 0;
    }

    // Cancelacion hecha por el personal (el cliente llama o escribe a la barberia).
    function cancelAppointment(state, code, { by, actor, reason }) {
        const appointment = state.appointments.find(item => item.code === code);
        if (!appointment) throw Object.assign(new Error('appt'), { userMessage: 'No encontramos esa cita.' });
        if (!ACTIVE.includes(appointment.status)) throw Object.assign(new Error('appt'), { userMessage: 'Esta cita ya no está activa.' });
        appointment.status = 'CANCELADA';
        appointment.canceledBy = by;
        appointment.canceledAt = nowIso();
        appointment.cancelReason = reason || '';
        appointment.cancellationAlertSeenBy = [];
        appointment.lateCancellation = hoursUntil(appointment) < (Number(settings(state).booking.cancelPolicyHours) || 0);
        pushHistory(appointment, 'Cancelada', actor || by, reason ? `Motivo: ${reason}` : '');
        notify(state, { barberId: appointment.barber, type: 'cancelada', code, title: 'Cita cancelada', body: `${appointment.client} · ${describe(appointment)} (por ${by}).` });
        // Si canceló la barbería, el cliente debe enterarse (si canceló el cliente, ya lo sabe).
        if (by !== 'cliente') {
            notify(state, {
                audience: 'client', clientId: appointment.clientId, code, type: 'cancelada',
                title: clientText(state, 'Cita cancelada', 'Appointment cancelled'),
                body: clientText(state, `Tu cita ${describe(appointment)} con ${appointment.barberName} fue cancelada por la barbería.`, `Your appointment ${describe(appointment)} with ${appointment.barberName} was cancelled by the barbershop.`)
            });
        }
        return appointment;
    }

    // Reprogramacion hecha por el personal.
    function rescheduleAppointment(state, code, { date, time, by, actor, services, barberId }) {
        const appointment = state.appointments.find(item => item.code === code);
        if (!appointment) throw Object.assign(new Error('appt'), { userMessage: 'No encontramos esa cita.' });
        const newServices = services || findServices(appointmentServiceNames(appointment), state);
        const newBarber = barberId || appointment.barber;
        const error = validateBooking({ clientId: appointment.clientId, barberId: newBarber, services: newServices, date, time, excludeCode: code, staff: true }, state);
        if (error) throw Object.assign(new Error('slot'), { userMessage: error });
        const before = describe(appointment);
        appointment.dateTime = `${date}T${time}`;
        appointment.barber = newBarber;
        appointment.barberName = barberLabel(state, newBarber);
        appointment.services = newServices.map(s => s.name);
        appointment.service = appointment.services.join(' + ');
        appointment.unknownCut = appointment.services.some(isUnknownCut);
        appointment.duration = totalMinutes(newServices);
        appointment.price = priceLabel(newServices);
        pushHistory(appointment, 'Reprogramada', actor || by, `Antes: ${before} · Ahora: ${describe(appointment)} con ${appointment.barberName}`);
        notify(state, { barberId: newBarber, type: 'reprogramada', code, title: 'Cita reprogramada', body: `${appointment.client}: ${before} → ${describe(appointment)}.` });
        notify(state, {
            audience: 'client', clientId: appointment.clientId, code, type: 'reprogramada',
            title: clientText(state, 'Cita reprogramada', 'Appointment rescheduled'),
            body: `${before} → ${describe(appointment)} con ${appointment.barberName}.`
        });
        return appointment;
    }

    // Cambios de estado del personal: confirmar, rechazar, completar, no-show.
    function setStatus(state, code, status, { actor, reason }) {
        const appointment = state.appointments.find(item => item.code === code);
        if (!appointment) throw Object.assign(new Error('appt'), { userMessage: 'No encontramos esa cita.' });
        const previous = appointment.status;
        if (status === 'CANCELADA') return cancelAppointment(state, code, { by: 'barbería', actor, reason });
        appointment.status = status;
        if (status === 'COMPLETADA') appointment.completedAt = nowIso();
        if (status === 'NO_SHOW') appointment.noShowAt = nowIso();
        pushHistory(appointment, statusLabel(status), actor || 'Personal', previous !== status ? `Antes: ${statusLabel(previous)}${reason ? ` · ${reason}` : ''}` : '');
        if (status === 'APROBADA' && previous !== 'APROBADA') {
            notify(state, {
                audience: 'client', clientId: appointment.clientId, code, type: 'aprobada',
                title: clientText(state, 'Cita confirmada', 'Appointment confirmed'),
                body: `${describe(appointment)} con ${appointment.barberName}.`
            });
        }
        if (status === 'RECHAZADA' && previous !== 'RECHAZADA') {
            notify(state, {
                audience: 'client', clientId: appointment.clientId, code, type: 'rechazada',
                title: clientText(state, 'Cita no aprobada', 'Appointment not approved'),
                body: clientText(state, `${describe(appointment)} con ${appointment.barberName} no pudo confirmarse. Comunícate con la barbería para buscar otro horario.`, `${describe(appointment)} with ${appointment.barberName} could not be confirmed. Contact the barbershop to find another time.`)
            });
        }
        if (status === 'PENDIENTE' && previous !== 'PENDIENTE') {
            notify(state, {
                audience: 'client', clientId: appointment.clientId, code, type: 'pendiente',
                title: clientText(state, 'Cita pendiente de confirmación', 'Appointment pending confirmation'),
                body: clientText(state, `${describe(appointment)} con ${appointment.barberName} está pendiente de confirmación. Te avisaremos en cuanto el barbero la confirme.`, `${describe(appointment)} with ${appointment.barberName} is pending confirmation. We will let you know as soon as the barber confirms it.`)
            });
        }
        if (status === 'COMPLETADA') {
            notify(state, {
                audience: 'client', clientId: appointment.clientId, code, type: 'completada',
                title: clientText(state, '¡Gracias por tu visita!', 'Thanks for your visit!'),
                body: `${describe(appointment)} con ${appointment.barberName}.`
            });
            // Hito de cliente frecuente: 5 visitas completadas (settings.booking.frequentClientVisits).
            // La fidelidad real es esa; no existe ningún "GOAT Club".
            if (appointment.clientId) {
                const visits = clientStats(appointment.clientId, state).completed;
                const goal = Number(settings(state).booking.frequentClientVisits) || 5;
                if (visits === goal) {
                    notify(state, {
                        audience: 'client', clientId: appointment.clientId, code, type: 'fidelidad',
                        title: clientText(state, '¡Ya eres cliente frecuente!', 'You are now a frequent client!'),
                        body: clientText(state, `Completaste ${goal} visitas en GOAT Style Salon. ¡Gracias por tu confianza!`, `You completed ${goal} visits at GOAT Style Salon. Thank you for your trust!`)
                    });
                }
            }
        }
        if (status === 'NO_SHOW' && appointment.clientId) applyNoShowRules(state, appointment.clientId);
        return appointment;
    }

    function applyNoShowRules(state, clientId) {
        const count = clientStats(clientId, state).noShows;
        const rules = settings(state).booking.noShowRules || {};
        const client = state.clients.find(item => item.id === clientId);
        const name = client ? client.name : 'Cliente';
        if (!rules.enabled) return;
        if (count >= rules.alertAt) {
            notify(state, { type: 'alerta-noshow', title: 'Alerta de no-shows', body: `${name} tiene ${count} no-show(s).` });
        }
        if (count >= rules.blockAt && !activeBlock(clientId, state)) {
            state.clientBlocks.push({ id: uid('blk'), clientId, reason: `Múltiples no-shows (${count})`, at: nowIso(), by: 'Sistema (regla automática)', active: true, automatic: true });
            notify(state, { type: 'bloqueo', title: 'Cliente bloqueado automáticamente', body: `${name} no puede reservar en línea por ${count} no-shows. Puedes desbloquearlo en Clientes.` });
        }
    }

    // Transferir un cliente a otro barbero: pasa a ser su barbero asignado y, si se pide,
    // sus citas próximas se mueven al nuevo barbero a la misma hora cuando está libre.
    // Las que chocan con otra cita del nuevo barbero se quedan como estaban (se informan).
    function transferClient(state, clientId, { toBarberId, by, moveUpcoming }) {
        const client = state.clients.find(item => item.id === clientId);
        if (!client) throw Object.assign(new Error('client'), { userMessage: 'No encontramos ese cliente.' });
        const target = state.barbers.find(item => item.id === toBarberId && item.active !== false);
        if (!target) throw Object.assign(new Error('barber'), { userMessage: 'Escoge el barbero que recibirá al cliente.' });
        const from = client.preferredBarber || '';
        if (from === toBarberId && !moveUpcoming) throw Object.assign(new Error('same'), { userMessage: `${client.name} ya está asignado a ${target.alias || target.name}.` });
        client.preferredBarber = toBarberId;
        client.lastModifiedAt = nowIso();
        const moved = [];
        const kept = [];
        if (moveUpcoming) {
            clientStats(clientId, state).upcoming.filter(item => item.barber !== toBarberId).forEach(item => {
                const appointment = state.appointments.find(a => a.code === item.code);
                const services = findServices(appointmentServiceNames(appointment), state);
                const date = String(appointment.dateTime).slice(0, 10);
                const time = String(appointment.dateTime).slice(11, 16);
                const error = services.every(service => barberOffers(target, service))
                    ? validateBooking({ clientId, barberId: toBarberId, services, date, time, excludeCode: appointment.code, staff: true }, state)
                    : `${target.alias || target.name} no ofrece ese servicio.`;
                if (error) { kept.push({ code: appointment.code, reason: error }); return; }
                rescheduleAppointment(state, appointment.code, { date, time, barberId: toBarberId, services, by: 'barbería', actor: by });
                moved.push(appointment.code);
            });
        }
        const fromLabel = from ? barberLabel(state, from) : 'sin barbero';
        notify(state, { barberId: toBarberId, type: 'transferencia', title: 'Te transfirieron un cliente', body: `${client.name} ahora es tu cliente (antes: ${fromLabel}).${moved.length ? ` Se movieron ${moved.length} cita(s) próxima(s) contigo.` : ''}` });
        state.activity = state.activity || [];
        state.activity.unshift({ id: uid('act'), type: 'client', text: `${by} transfirió a ${client.name} de ${fromLabel} a ${barberLabel(state, toBarberId)}.`, createdAt: nowIso() });
        state.clientChangeLog = state.clientChangeLog || [];
        state.clientChangeLog.unshift({ id: uid('chg'), clientId, field: 'Barbero asignado', oldValue: fromLabel, newValue: barberLabel(state, toBarberId), changedBy: by, changedAt: nowIso() });
        return { moved, kept };
    }

    // Transferir UNA cita a otro barbero (no al cliente entero): la cita pasa a
    // la lista del barbero nuevo a la misma fecha y hora, y ambos (barbero nuevo
    // y cliente) reciben un aviso. Es idempotente: si la cita ya está con ese
    // barbero (por ejemplo, el servidor ya aplicó la transferencia y se
    // reintenta), no vuelve a moverla ni a duplicar el historial; solo crea
    // los avisos si todavía no existen para ese barbero.
    function transferAppointment(state, code, { toBarberId, by, actor }) {
        const appointment = state.appointments.find(item => item.code === code);
        if (!appointment) throw Object.assign(new Error('appt'), { userMessage: 'No encontramos esa cita.' });
        const target = state.barbers.find(item => item.id === toBarberId && item.active !== false);
        if (!target) throw Object.assign(new Error('barber'), { userMessage: 'Escoge el barbero que recibirá la cita.' });
        if (!ACTIVE.includes(appointment.status)) throw Object.assign(new Error('status'), { userMessage: 'Solo se puede transferir una cita pendiente o confirmada.' });
        const toLabel = barberLabel(state, toBarberId);
        if (appointment.barber !== toBarberId) {
            const services = findServices(appointmentServiceNames(appointment), state);
            if (!services.every(service => barberOffers(target, service))) throw Object.assign(new Error('service'), { userMessage: `${target.alias || target.name} no ofrece uno de los servicios de esta cita.` });
            const date = String(appointment.dateTime).slice(0, 10);
            const time = String(appointment.dateTime).slice(11, 16);
            const error = validateBooking({ clientId: appointment.clientId, barberId: toBarberId, services, date, time, excludeCode: code, staff: true }, state);
            if (error) throw Object.assign(new Error('slot'), { userMessage: error });
            const fromLabel = barberLabel(state, appointment.barber);
            const last = (appointment.history || [])[(appointment.history || []).length - 1];
            appointment.barber = toBarberId;
            appointment.barberName = toLabel;
            if (!last || last.action !== 'Transferida' || !String(last.detail || '').includes(`Ahora: ${toLabel}`)) {
                pushHistory(appointment, 'Transferida', actor || by, `Antes: ${fromLabel} · Ahora: ${toLabel}`);
            }
        }
        let staffNotice = (state.notifications || []).find(n => n.type === 'transferencia' && n.appointmentCode === code && n.barberId === toBarberId);
        if (!staffNotice) {
            staffNotice = notify(state, { barberId: toBarberId, type: 'transferencia', code, title: 'Te transfirieron una cita', body: `${appointment.client}: ${describe(appointment)} con ${toLabel}.` });
        }
        let clientNotice = (state.notifications || []).find(n => n.type === 'transferencia' && n.audience === 'client' && n.appointmentCode === code && String(n.body || '').includes(toLabel));
        if (!clientNotice) {
            clientNotice = notify(state, {
                audience: 'client', clientId: appointment.clientId, code, type: 'transferencia',
                title: clientText(state, 'Tu cita cambió de barbero', 'Your appointment changed barber'),
                body: clientText(state, `Tu cita ${describe(appointment)} ahora es con ${toLabel}. La fecha y la hora no cambian.`, `Your appointment ${describe(appointment)} is now with ${toLabel}. The date and time stay the same.`)
            });
        }
        return { appointment, staffNotice, clientNotice };
    }

    function blockClient(state, clientId, { reason, by }) {
        if (!reason) throw Object.assign(new Error('reason'), { userMessage: 'Escribe el motivo del bloqueo.' });
        if (activeBlock(clientId, state)) throw Object.assign(new Error('dup'), { userMessage: 'El cliente ya está bloqueado.' });
        state.clientBlocks.push({ id: uid('blk'), clientId, reason, at: nowIso(), by, active: true });
    }

    function unblockClient(state, clientId, { by }) {
        const block = activeBlock(clientId, state);
        if (!block) return;
        block.active = false;
        block.removedAt = nowIso();
        block.removedBy = by;
    }

    // ---------------------------------------------------------------------
    // Resenas: cualquier visitante escribe su nombre, el servicio y su opinion.
    // Quedan pendientes hasta que la barberia las publique desde el panel.
    // ---------------------------------------------------------------------
    function addPublicReview(state, { name, service, barberId, rating, text, clientPhoto = '', publish }) {
        const clientName = cleanName(name);
        if (clientName.length < 2) throw Object.assign(new Error('name'), { userMessage: 'Escribe tu nombre completo.' });
        const serviceName = String(service || '').trim();
        if (!serviceName) throw Object.assign(new Error('service'), { userMessage: 'Escoge el servicio que te hiciste.' });
        const barber = state.barbers.find(item => item.id === barberId);
        if (!barber) throw Object.assign(new Error('barber'), { userMessage: 'Escoge tu barbero.' });
        const value = Number(rating);
        if (!Number.isInteger(value) || value < 1 || value > 5) throw Object.assign(new Error('rating'), { userMessage: 'Escoge de 1 a 5 estrellas.' });
        if (typeof publish !== 'boolean') throw Object.assign(new Error('consent'), { userMessage: 'Indica si permites que publiquemos tu reseña en la página.' });
        const comment = String(text || '').trim();
        if (comment.length > 600) throw Object.assign(new Error('text'), { userMessage: 'El comentario debe tener como máximo 600 caracteres.' });
        if (clientPhoto && (clientPhoto.length > 24000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(clientPhoto))) {
            throw Object.assign(new Error('photo'), { userMessage: 'No se pudo guardar la foto de la reseña.' });
        }
        const review = {
            id: uid('review'), clientName, clientPhoto,
            barberId: barber.id, barber: barberLabel(state, barber.id),
            service: serviceName, rating: value, text: comment, publishConsent: publish,
            status: 'PENDIENTE', createdAt: nowIso()
        };
        state.reviews.unshift(review);
        notify(state, { barberId: barber.id, type: 'resena', title: 'Nueva reseña por revisar', body: `${clientName} dio ${value} estrella(s) a ${serviceName}.${publish ? ' Publícala desde Reseñas.' : ' No autorizó publicarla en la página.'}` });
        return review;
    }

    // Servicio que se muestra en una resena publica: se omite si el cliente no sabia el nombre del recorte.
    function reviewServiceLabel(review) {
        const names = String(review.service || '').split(' + ').map(n => n.trim()).filter(n => n && !isUnknownCut(n));
        return names.join(' + ');
    }

    // Resenas anteriores al permiso de publicacion: se dejaron con el formulario viejo (sin cita ni permiso)
    // y la barberia ya las habia aprobado, asi que se siguen mostrando como antes.
    function isLegacyReview(review) {
        return (review.publishConsent === undefined || review.publishConsent === null) && !review.appointmentCode;
    }

    // Resenas visibles en la pagina publica: aprobadas y con permiso del cliente (o anteriores ya aprobadas).
    function setReviewStatus(review, status) {
        const wasPublic = publicReviews({ reviews: [review] }).length > 0;
        review.status = status;
        if (!wasPublic && publicReviews({ reviews: [review] }).length) {
            review.publishedAt ||= nowIso();
        }
    }

    function publicReviews(state) {
        return (state || db()).reviews.filter(review => review.status === 'APROBADA' && (review.publishConsent === true || isLegacyReview(review)));
    }

    // Barbero de una resena: las anteriores guardaban el id ("gabriel") en vez del nombre.
    function reviewBarber(review, state) {
        const s = state || db();
        const barber = s.barbers.find(item => item.id === review.barberId || item.id === review.barber) ||
            s.barbers.find(item => barberLabel(s, item.id) === review.barber);
        return barber || null;
    }

    function barberRating(barberId, state) {
        const s = state || db();
        const barber = s.barbers.find(item => item.id === barberId);
        const label = barber ? barberLabel(s, barberId) : '';
        const list = publicReviews(s).filter(review => review.barberId === barberId || review.barber === barberId || (label && review.barber === label));
        const avg = list.length ? list.reduce((sum, review) => sum + Number(review.rating || 0), 0) / list.length : 0;
        return { count: list.length, avg, list };
    }

    // ---------------------------------------------------------------------
    // Estadisticas (datos reales del sistema; sin pagos en linea)
    // ---------------------------------------------------------------------
    function priceNumber(appointment, state) {
        const services = findServices(appointmentServiceNames(appointment), state);
        return services.reduce((sum, service) => {
            const match = String(service.price || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
            return sum + (match ? Number(match[1]) : 0);
        }, 0);
    }

    function stats(state, { barberId, from, to } = {}) {
        const s = state || db();
        const list = s.appointments.filter(item => (!barberId || item.barber === barberId) && item.dateTime &&
            (!from || String(item.dateTime).slice(0, 10) >= from) && (!to || String(item.dateTime).slice(0, 10) <= to));
        const byStatus = status => list.filter(item => item.status === status).length;
        const count = (keyFn, items) => {
            const out = {};
            (items || list).forEach(item => { [].concat(keyFn(item)).filter(Boolean).forEach(key => { out[key] = (out[key] || 0) + 1; }); });
            return Object.entries(out).sort((a, b) => b[1] - a[1]);
        };
        const valid = list.filter(item => item.status !== 'CANCELADA' && item.status !== 'RECHAZADA');
        const clientFirst = {};
        s.appointments.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach(item => {
            if (item.clientId && !clientFirst[item.clientId]) clientFirst[item.clientId] = String(item.dateTime).slice(0, 10);
        });
        const clientsInRange = [...new Set(list.map(item => item.clientId).filter(Boolean))];
        return {
            total: list.length,
            confirmed: byStatus('APROBADA'),
            pending: byStatus('PENDIENTE'),
            completed: byStatus('COMPLETADA'),
            cancelled: byStatus('CANCELADA'),
            noShows: byStatus('NO_SHOW'),
            byDay: count(item => String(item.dateTime).slice(0, 10), valid).sort((a, b) => a[0].localeCompare(b[0])),
            byWeekday: count(item => DAY_NAMES[parseLocal(item.dateTime).getDay()], valid),
            byHour: count(item => formatTime(`${String(item.dateTime).slice(11, 13)}:00`), valid),
            services: count(item => appointmentServiceNames(item), valid),
            barbers: count(item => barberLabel(s, item.barber), valid),
            newClients: clientsInRange.filter(id => (!from || clientFirst[id] >= from) && (!to || clientFirst[id] <= to)).length,
            returningClients: clientsInRange.filter(id => clientStats(id, s).completed > 1).length,
            estimatedIncome: list.filter(item => item.status === 'COMPLETADA').reduce((sum, item) => sum + priceNumber(item, s), 0)
        };
    }

    window.GabyBooking = {
        ACTIVE, STATUS_LABELS, DAY_NAMES, BLOCKED_MESSAGE, SHOP_HOURS, CLOSED_MESSAGE, isShopOpen, shopHoursFor, shopHoursSummary, UNKNOWN_CUT, isUnknownCut, unknownCutService,
        toMin, fromMin, dateKey, parseKey, parseLocal, addDays,
        formatTime, formatDate, formatDuration, relativeDay, statusLabel,
        serviceMinutes, totalMinutes, priceLabel, findServices, appointmentServiceNames, appointmentDuration,
        barberOffers, barbersForServices, weeklySchedule, scheduleSummary, blocksFor, dayWindow,
        getSlots, nextAvailable, availableDates,
        clientAppointments, clientStats, noShowLevel, activeBlock, blockClient, unblockClient, transferClient, transferAppointment,
        validateBooking, createAppointment, cancelAppointment, rescheduleAppointment, setStatus, hoursUntil, matchClientByName, lookupByCode,
        rememberMyAppointment, forgetMyAppointment, myUpcomingAppointments, refreshMyAppointments,
        addPublicReview, setReviewStatus, publicReviews, isLegacyReview, reviewBarber, barberRating, reviewServiceLabel,
        stats, notify, describe, barberLabel, googleCalendarUrl
    };
})();
