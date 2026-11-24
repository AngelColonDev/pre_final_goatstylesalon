const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

function setup() {
    const storage = new Map();
    const context = vm.createContext({
        console, crypto: webcrypto,
        localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        document: { body: null },
        dispatchEvent() {}
    });
    context.window = context;
    for (const file of ['shared-data.js', 'booking-engine.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
    }
    const state = context.GabyData.getState();
    const client = { id: 'client-test', name: 'Cliente Prueba', email: 'cliente@example.test' };
    state.clients = [client];
    const date = new Date();
    date.setDate(date.getDate() + 3);
    // La barbería abre de martes a sábado.
    while (date.getDay() === 0 || date.getDay() === 1) date.setDate(date.getDate() + 1);
    const key = context.GabyBooking.dateKey(date);
    const appointment = {
        code: 'GS-TEST', clientId: client.id, client: client.name, barber: 'gabriel',
        service: 'Classic Cut', services: ['Classic Cut'], duration: 40,
        dateTime: `${key}T10:00`, status: 'COMPLETADA'
    };
    state.appointments = [appointment];
    state.reviews = []; // las pruebas empiezan sin la primera reseña del sitio
    return { state, client, appointment, key, B: context.GabyBooking, Data: context.GabyData };
}

test('reseñas sin cuenta: piden nombre, servicio y barbero, y quedan pendientes hasta publicarlas', () => {
    const { state, B } = setup();
    const input = { name: '  Ana   María Pérez ', service: 'Classic Cut', barberId: 'gabriel', rating: 1, text: 'No me gustó.', publish: true };
    assert.throws(() => B.addPublicReview(state, { ...input, name: ' ' }), /name/);
    assert.throws(() => B.addPublicReview(state, { ...input, service: '' }), /service/);
    assert.throws(() => B.addPublicReview(state, { ...input, barberId: 'nadie' }), /barber/);
    assert.throws(() => B.addPublicReview(state, { ...input, publish: undefined }), /consent/, 'Debe decidir si se publica');
    const review = B.addPublicReview(state, input);
    assert.equal(review.clientName, 'Ana María Pérez');
    assert.equal(review.rating, 1);
    assert.equal(review.service, 'Classic Cut');
    assert.equal(review.status, 'PENDIENTE');
    assert.equal(review.clientId, undefined, 'La reseña no se une a ninguna cuenta');
    assert.equal(B.publicReviews(state).length, 0, 'No se publica sin aprobación');
    review.status = 'APROBADA';
    assert.equal(B.publicReviews(state).length, 1);
    assert.ok(state.notifications.some(n => n.audience === 'staff' && n.type === 'resena'));
});

test('reseñas: ocultas y pendientes quedan fuera; las anteriores ya aprobadas se siguen mostrando', () => {
    const { state, B } = setup();
    B.addPublicReview(state, { name: 'Cliente Prueba', service: 'Classic Cut', barberId: 'gabriel', rating: 2, publish: true });
    const privateReview = B.addPublicReview(state, { name: 'Persona Privada', service: 'Classic Cut', barberId: 'gabriel', rating: 5, publish: false });
    privateReview.status = 'APROBADA';
    state.reviews.push({ id: 'hidden', status: 'OCULTA', publishConsent: true, rating: 5, barberId: 'gabriel' });
    state.reviews.push({ id: 'legacy-pending', status: 'PENDIENTE', rating: 5, barber: 'gabriel' });
    assert.equal(B.publicReviews(state).length, 0);
    // Reseña del formulario anterior (sin cita ni permiso guardado) que la barbería ya había aprobado.
    state.reviews.push({ id: 'legacy', status: 'APROBADA', rating: '5', barber: 'gabriel', createdAt: '2026-05-01T12:00:00.000Z' });
    assert.equal(B.publicReviews(state).map(r => r.id).join(','), 'legacy');
    assert.equal(B.barberRating('gabriel', state).count, 1);
    assert.equal(B.reviewBarber(state.reviews.find(r => r.id === 'legacy'), state).alias, 'Gaby');
});

test('reseñas: valida estrellas enteras y longitud del comentario', () => {
    const { state, B } = setup();
    const input = { name: 'Cliente Prueba', service: 'Classic Cut', barberId: 'gabriel', publish: true };
    for (const rating of [0, 6, 3.5, NaN]) {
        assert.throws(() => B.addPublicReview(state, { ...input, rating }), /rating/);
    }
    assert.throws(() => B.addPublicReview(state, { ...input, rating: 5, text: 'x'.repeat(601) }), /text/);
});
test('disponibilidad: respeta duración, almuerzo y bloqueos sin impedir citas contiguas', () => {
    const { state, appointment, key, B } = setup();
    appointment.status = 'APROBADA';
    state.timeBlocks = [{ id: 'block', barberId: 'gabriel', startDate: key, endDate: key, startTime: '15:00', endTime: '16:00' }];
    const slots = B.getSlots('gabriel', key, 40, { state, staff: true });
    assert.ok(!slots.includes('10:00'));
    assert.ok(!slots.includes('10:30'));
    assert.ok(slots.includes('10:40'));
    assert.ok(!slots.includes('12:00'));
    assert.ok(!slots.includes('14:30'));
    assert.ok(slots.includes('16:00'));
    state.timeBlocks[0].allDay = true;
    assert.equal(B.getSlots('gabriel', key, 40, { state, staff: true }).length, 0);
});

test('reprogramar (personal) conserva código e historial y rechaza solapamientos', () => {
    const { state, appointment, key, B } = setup();
    appointment.status = 'APROBADA';
    B.rescheduleAppointment(state, appointment.code, { date: key, time: '11:00', by: 'barbería', actor: 'Gaby' });
    assert.equal(state.appointments.length, 1);
    assert.equal(appointment.code, 'GS-TEST');
    assert.equal(appointment.history[0].action, 'Reprogramada');
    state.appointments.push({ ...appointment, code: 'GS-OTHER', dateTime: `${key}T10:00` });
    assert.throws(() => B.rescheduleAppointment(state, appointment.code, { date: key, time: '10:15', by: 'barbería' }), /slot/);
    assert.equal(appointment.dateTime, `${key}T11:00`);
});

test('cancelación registra responsable y motivo y libera disponibilidad', () => {
    const { state, appointment, key, B } = setup();
    appointment.status = 'APROBADA';
    B.cancelAppointment(state, appointment.code, { by: 'barbería', actor: 'Gaby', reason: 'El cliente llamó: cambio de planes' });
    assert.equal(appointment.status, 'CANCELADA');
    assert.equal(appointment.canceledBy, 'barbería');
    assert.equal(appointment.cancelReason, 'El cliente llamó: cambio de planes');
    assert.ok(appointment.canceledAt);
    assert.ok(B.getSlots('gabriel', key, 40, { state, staff: true }).includes('10:00'));
});

test('un guardado rechazado no conserva una cita fantasma en el navegador', async () => {
    const { Data } = setup();
    Data.addCommitHook(() => Promise.reject(Object.assign(new Error('rechazo de prueba'), { userMessage: 'No disponible' })));
    const before = Data.getState().appointments.length;
    const saved = await Data.commit(state => state.appointments.push({ code: 'QA-REJECTED' }), { success: null });
    assert.equal(saved, false);
    assert.equal(Data.getState().appointments.length, before);
});

test('citas en línea sin cuenta: piden nombre completo, quedan pendientes, apartan el horario y al rechazarlas se libera', () => {
    const { state, key, B } = setup();
    assert.equal(state.settings.booking.autoConfirm, false);
    const services = B.findServices(['Classic Cut'], state);
    assert.throws(() => B.createAppointment(state, { walkIn: { name: ' ' }, barberId: 'gabriel', services, date: key, time: '14:00', source: 'online' }), /name/);
    const first = B.createAppointment(state, { walkIn: { name: '  Luis   Rivera ' }, barberId: 'gabriel', services, date: key, time: '14:00', source: 'online' });
    assert.equal(first.status, 'PENDIENTE');
    assert.equal(first.client, 'Luis Rivera');
    assert.equal(first.clientId, null, 'Sin ficha que coincida, la cita queda sin ficha');
    assert.ok(!B.getSlots('gabriel', key, 40, { state }).includes('14:00'), 'El horario pendiente queda apartado');
    assert.throws(() => B.createAppointment(state, { walkIn: { name: 'Otra Persona' }, barberId: 'gabriel', services, date: key, time: '14:00', source: 'online' }), /booking/);
    B.setStatus(state, first.code, 'RECHAZADA', { actor: 'Gaby', reason: 'Fuera de horario' });
    assert.ok(B.getSlots('gabriel', key, 40, { state }).includes('14:00'), 'Al rechazarla el horario vuelve a estar libre');
    assert.ok(state.notifications.every(n => n.audience === 'staff'), 'Solo hay notificaciones del personal');
});

test('citas en línea: el nombre se une a una sola ficha que coincida y respeta los bloqueos', () => {
    const { state, client, key, B } = setup();
    const services = B.findServices(['Classic Cut'], state);
    const linked = B.createAppointment(state, { walkIn: { name: 'cliente prueba' }, barberId: 'gabriel', services, date: key, time: '14:00', source: 'online' });
    assert.equal(linked.clientId, client.id);
    B.blockClient(state, client.id, { reason: 'No-shows', by: 'Gaby' });
    assert.throws(() => B.createAppointment(state, { walkIn: { name: 'Cliente Prueba' }, barberId: 'gabriel', services, date: key, time: '15:00', source: 'online' }), /booking/);
    state.clients.push({ id: 'client-twin', name: 'Cliente Prueba' });
    const ambiguous = B.createAppointment(state, { walkIn: { name: 'Cliente Prueba' }, barberId: 'gabriel', services, date: key, time: '15:00', source: 'online' });
    assert.equal(ambiguous.clientId, null, 'Con dos fichas del mismo nombre no se une a ninguna');
});

test('migración: una barbería con confirmación automática pasa a aprobación del barbero una sola vez', () => {
    const storage = new Map([['gs_crm', JSON.stringify({ settings: { booking: { autoConfirm: true } } })]]);
    const context = vm.createContext({
        console, crypto: webcrypto,
        localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        document: { body: null }, dispatchEvent() {}
    });
    context.window = context;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared-data.js'), 'utf8'), context);
    assert.equal(context.GabyData.getState().settings.booking.autoConfirm, false);
    context.GabyData.updateState(s => { s.settings.booking.autoConfirm = true; });
    assert.equal(context.GabyData.getState().settings.booking.autoConfirm, true, 'Si el administrador lo vuelve a activar, se respeta');
});

test('migración: se borran los datos de las antiguas cuentas de clientes guardados en el navegador', () => {
    const old = {
        session: { currentClientId: 'client-1' },
        waitlist: [{ id: 'w1' }],
        clients: [{ id: 'client-1', name: 'Ana', password: '123', passwordHash: { hash: 'x' }, mustChangePassword: true, favorites: { service: 'Classic Cut' } }],
        notifications: [{ id: 'n1', audience: 'client' }, { id: 'n2', audience: 'staff' }],
        security: { attempts: { 'ana@example.test': { count: 2, type: 'client' }, 'gaby@goatstylesalon.com': { count: 1, type: 'staff' } }, locks: [{ id: 'l1', accountType: 'client' }, { id: 'l2', accountType: 'staff' }] },
        settings: { maintenance: { sections: { cuentas: true, reservas: false } } }
    };
    const storage = new Map([['gs_crm', JSON.stringify(old)]]);
    const context = vm.createContext({
        console, crypto: webcrypto,
        localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        document: { body: null }, dispatchEvent() {}
    });
    context.window = context;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared-data.js'), 'utf8'), context);
    const state = context.GabyData.getState();
    assert.equal(state.session, undefined);
    assert.equal(state.waitlist, undefined);
    assert.deepEqual(Object.keys(state.clients[0]).sort(), ['id', 'name']);
    assert.equal(state.notifications.map(n => n.id).join(','), 'n2');
    assert.deepEqual(Object.keys(state.security.attempts), ['gaby@goatstylesalon.com']);
    assert.equal(state.security.locks.map(l => l.id).join(','), 'l2');
    assert.equal(state.settings.maintenance.sections.cuentas, undefined);
});

test('"No sé cómo se llama el recorte": se puede reservar con foto de referencia y la reseña omite el servicio', () => {
    const { state, key, B } = setup();
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(200);
    const services = B.findServices([B.UNKNOWN_CUT, 'Classic Cut'].slice(0, 1), state);
    assert.equal(services.length, 1);
    assert.ok(B.barbersForServices(services, state).length > 0, 'Todos los barberos aceptan la opción');
    const walkIn = { name: 'Cliente Prueba' };
    const appointment = B.createAppointment(state, { walkIn, barberId: 'gabriel', services, date: key, time: '15:00', source: 'online', referencePhoto: photo });
    assert.equal(appointment.unknownCut, true);
    assert.equal(appointment.referencePhoto, photo);
    assert.equal(appointment.price, 'A consultar');
    const unsafe = B.createAppointment(state, { walkIn: { name: 'Otra Persona' }, barberId: 'gabriel', services, date: key, time: '16:00', source: 'online', referencePhoto: 'javascript:alert(1)' });
    assert.equal(unsafe.referencePhoto, '');
    const review = B.addPublicReview(state, { name: 'Cliente Prueba', service: B.UNKNOWN_CUT, barberId: 'gabriel', rating: 5, publish: true });
    assert.equal(B.reviewServiceLabel(review), '');
    assert.equal(B.reviewServiceLabel({ service: `${B.UNKNOWN_CUT} + Barba` }), 'Barba');
    assert.equal(B.reviewServiceLabel({ service: 'Classic Cut' }), 'Classic Cut');
});

test('horario: la barbería cierra domingo y lunes y no acepta citas fuera de su horario', () => {
    const { state, B } = setup();
    const services = B.findServices(['Classic Cut'], state);
    const next = weekday => { const d = new Date(); d.setDate(d.getDate() + 1); while (d.getDay() !== weekday) d.setDate(d.getDate() + 1); return B.dateKey(d); };
    for (const closed of [next(0), next(1)]) {
        assert.equal(B.isShopOpen(closed), false);
        assert.equal(B.getSlots('gabriel', closed, 40, { state, staff: true }).length, 0);
        assert.throws(() => B.createAppointment(state, { walkIn: { name: 'Luis Rivera' }, barberId: 'gabriel', services, date: closed, time: '10:00', source: 'online' }), error => /cerrada/.test(error.userMessage));
    }
    const tuesday = B.getSlots('wilo', next(2), 40, { state, staff: true });
    assert.equal(tuesday[0], '08:00');
    assert.ok(tuesday.every(t => B.toMin(t) + 40 <= 18 * 60), 'Martes cierra a las 6 PM');
    assert.ok(B.getSlots('wilo', next(5), 40, { state, staff: true }).some(t => B.toMin(t) + 40 > 18 * 60), 'Viernes llega hasta las 8 PM');
    const saturday = B.getSlots('wilo', next(6), 40, { state, staff: true });
    assert.equal(saturday[0], '07:00');
    assert.ok(saturday.every(t => B.toMin(t) + 40 <= 17 * 60), 'Sábado cierra a las 5 PM');
    assert.throws(() => B.createAppointment(state, { walkIn: { name: 'Luis Rivera' }, barberId: 'wilo', services, date: next(2), time: '18:00', source: 'manual' }), error => /fuera del horario/.test(error.userMessage));
});
