const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let server, browser, origin;
const browserErrors = [];
before(async () => {
    server = http.createServer((req, res) => {
        const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        fs.readFile(file, (error, content) => {
            if (error) { res.writeHead(404).end(); return; }
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
            res.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
            res.end(content);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
});
after(async () => {
    await browser?.close();
    await new Promise(resolve => server?.close(resolve));
    assert.deepEqual(browserErrors, [], 'No debe haber errores JavaScript en las páginas probadas');
});

async function pageWithData(staff = null, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ viewport });
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await context.addInitScript(({ staff }) => {
        if (!localStorage.getItem('gs_language_chosen')) localStorage.setItem('gs_language_chosen', 'es');
        if (localStorage.getItem('qa-seeded')) return;
        const client = { id: 'qa-client', name: 'Carlos Prueba', email: 'qa@example.test', phone: '7875551234', birthDate: '1990-01-01', preferredBarber: 'gabriel', photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
        const other = { ...client, id: 'qa-other', email: 'other@example.test', preferredBarber: 'wilo' };
        localStorage.setItem('gs_crm', JSON.stringify({ clients: [client, other], appointments: [
            { code: 'QA-COMPLETED', clientId: client.id, client: client.name, barber: 'gabriel', barberName: 'Gaby', service: 'Classic Cut', dateTime: '2026-01-10T10:00', status: 'COMPLETADA', duration: 40, price: '$35' },
            { code: 'QA-OTHER', clientId: other.id, client: other.name, barber: 'wilo', service: 'Premium Fade', dateTime: '2026-01-11T10:00', status: 'COMPLETADA', duration: 40, price: '$40' }
        ], reviews: [], settings: { firstReviewSeeded: true } }));
        if (staff) localStorage.setItem('gs_staff_session', JSON.stringify({ ...staff, exp: Date.now() + 3600000 }));
        localStorage.setItem('qa-seeded', 'true');
    }, { staff });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => browserErrors.push(error.stack || error.message));
    return { page, context };
}

async function sendReview(page, { name, rating = 5, text = '', publish = true }) {
    await page.locator('#review-name').fill(name);
    await page.locator('#review-service').selectOption('Classic Cut');
    await page.locator('#review-barber').selectOption('gabriel');
    await page.locator(`#review-star-picker [data-star="${rating}"]`).click();
    await page.locator('#review-text').fill(text);
    await page.locator(`input[name="review-publish"][value="${publish ? 'yes' : 'no'}"]`).check();
    await page.locator('#review-form button[type=submit]').click();
}

test('móvil: reseña sin cuenta pide nombre, queda pendiente y no se publica hasta aprobarla', async () => {
    const { page, context } = await pageWithData(null, { width: 390, height: 844 });
    try {
        await page.goto(`${origin}/index.html`);
        const banner = page.getByRole('button', { name: 'Rechazar no esenciales', exact: true });
        if (await banner.count()) await banner.click();
        await page.locator('#review-form').scrollIntoViewIfNeeded();
        await page.locator('#review-form button[type=submit]').click();
        assert.equal(await page.evaluate(() => GabyData.getState().reviews.length), 0, 'Sin nombre no se envía');
        await sendReview(page, { name: 'Ana Pérez', rating: 4, text: 'Comentario pendiente de prueba' });
        await page.waitForFunction(() => GabyData.getState().reviews.length === 1);
        await page.reload();
        const review = await page.evaluate(() => GabyData.getState().reviews[0]);
        assert.equal(review.clientName, 'Ana Pérez');
        assert.equal(review.service, 'Classic Cut');
        assert.equal(review.rating, 4);
        assert.equal(review.status, 'PENDIENTE');
        assert.equal(review.publishConsent, true);
        await page.goto(`${origin}/barber.html?id=gabriel`);
        assert.ok(!(await page.locator('body').innerText()).includes('Comentario pendiente de prueba'));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await context.close(); }
});

test('reseña aprobada muestra la fecha de publicación en Clientes VIP y conserva el detalle del perfil', async () => {
    const { page, context } = await pageWithData();
    try {
        await page.goto(`${origin}/index.html`);
        await sendReview(page, { name: 'Carlos Prueba', rating: 1, text: '<img src=x onerror="window.qaXss=true">' });
        await page.waitForFunction(() => GabyData.getState().reviews.length === 1);
        const publishedAt = '2026-06-01T15:00:00.000Z';
        await page.evaluate(date => GabyData.updateState(state => {
            GabyBooking.setReviewStatus(state.reviews[0], 'APROBADA');
            state.reviews[0].publishedAt = date;
        }), publishedAt);
        await page.goto(`${origin}/barber.html?id=gabriel`);
        const reviews = page.locator('section[aria-label="Reseñas de clientes"]');
        const sentDate = await page.evaluate(() => new Date().toLocaleDateString('es-PR', { day: 'numeric', month: 'long', year: 'numeric' }));
        assert.match(await reviews.innerText(), /Servicio: Classic Cut/);
        assert.ok((await reviews.innerText()).includes(`Fecha: ${sentDate}`), 'La fecha es el día en que se envió la reseña');
        assert.match(await reviews.innerText(), /Barbero: Gaby/);
        assert.match(await reviews.innerText(), /Carlos Prueba/);
        assert.equal(await reviews.locator('.bio-text img').count(), 0);
        assert.equal(await page.evaluate(() => Boolean(window.qaXss)), false);
        await page.goto(`${origin}/index.html`);
        const card = page.locator('#track-1 .review-card').first();
        await card.waitFor();
        assert.match(await card.innerText(), /Servicio\s+Classic Cut/);
        assert.match(await card.innerText(), /Barbero\s+.*Gaby/);
        assert.match(await card.innerText(), /Publicada\s+/);
        assert.equal(await card.locator('time').getAttribute('datetime'), publishedAt);
        assert.match(await card.locator('img[alt="Foto de Carlos Prueba"]').getAttribute('src'), /review-avatar\.svg$/);
        assert.equal(await card.locator('.review-text img').count(), 0);
        await page.getByRole('button', { name: 'Rechazar no esenciales', exact: true }).click();
        // Comprobar lo que realmente se ve, no solo que los datos estén en el DOM.
        await page.locator('#testimonios').scrollIntoViewIfNeeded();
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.locator('#testimonios').scrollIntoViewIfNeeded();
            const visible = await card.evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return ['.vip-review-photo', '.vip-review-name', '.vip-review-details'].every(selector => {
                    const item = element.querySelector(selector);
                    const rect = item.getBoundingClientRect();
                    const style = getComputedStyle(item);
                    return rect.width > 0 && rect.height > 0 && rect.top >= bounds.top && rect.bottom <= bounds.bottom && style.visibility === 'visible' && style.display !== 'none';
                });
            });
            assert.equal(visible, true);
            const output = path.join(__dirname, 'artifacts');
            fs.mkdirSync(output, { recursive: true });
            await page.locator('#testimonios').screenshot({ path: path.join(output, `vip-${viewport.width}.png`) });
        }
    } finally { await context.close(); }
});

test('Clientes VIP recupera datos de citas anteriores y conserva un avatar visible sin foto', async () => {
    const { page, context } = await pageWithData();
    try {
        await page.goto(`${origin}/index.html`);
        await page.evaluate(() => GabyData.updateState(state => {
            state.clients[0].photo = '';
            state.reviews = [{ id: 'qa-legacy', clientId: 'qa-client', clientName: 'Carlos Prueba', appointmentCode: 'QA-COMPLETED', rating: 5, status: 'APROBADA', publishConsent: true, text: 'Muy buen recorte.' }];
        }));
        const card = page.locator('#track-1 .review-card').first();
        assert.match(await card.innerText(), /Servicio\s+Classic Cut/);
        assert.match(await card.innerText(), /Barbero\s+.*Gaby/);
        assert.match(await card.innerText(), /Fecha del servicio\s+.*2026/);
        await page.waitForFunction(() => document.querySelector('#track-1 .vip-review-photo')?.naturalWidth > 0);
        assert.match(await card.locator('img').getAttribute('src'), /review-avatar\.svg$/);
    } finally { await context.close(); }
});

test('CRM: sin sesión no se puede buscar fichas', async () => {
    const { page, context } = await pageWithData();
    try {
        await page.goto(`${origin}/crm/dist/index.html`);
        await page.getByRole('heading', { name: 'Acceso del personal' }).waitFor();
        assert.equal(await page.getByPlaceholder('0000').count(), 0);
    } finally { await context.close(); }
});

test('CRM: separa clientes con el mismo nombre y abre una cita real con cliente precargado', async () => {
    const { page, context } = await pageWithData({ email: 'gaby@goatstylesalon.com', barberId: 'gabriel', isAdmin: true });
    try {
        await page.goto(`${origin}/crm/dist/index.html?phone=1234&name=Carlos%20Prueba`);
        await page.getByRole('button', { name: 'Entrar', exact: true }).click();
        await page.getByRole('button', { name: '2 Citas', exact: true }).click();
        assert.match(await page.locator('.crm-workspace-content').innerText(), /Classic Cut/);
        assert.ok(!(await page.locator('.crm-workspace-content').innerText()).includes('Premium Fade'));
        assert.equal(await page.getByRole('button', { name: 'Registrar Pago', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Nueva Cita', exact: true }).click();
        await page.locator('#ap-new-client').waitFor();
        assert.equal(await page.locator('#ap-new-client').inputValue(), 'qa-client');
        assert.ok(await page.locator('#ap-new-form').isVisible());
    } finally { await context.close(); }
});

async function seedPendingAppointment(page) {
    return page.evaluate(() => {
        let code = null;
        GabyData.updateState(state => {
            const next = GabyBooking.nextAvailable('gabriel', 40, state);
            const appointment = GabyBooking.createAppointment(state, { client: state.clients[0], barberId: 'gabriel', services: GabyBooking.findServices(['Classic Cut'], state), date: next.date, time: next.time, source: 'online', referencePhoto: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' });
            code = appointment.code;
        });
        return code;
    });
}

test('panel admin: menú agrupado, cerrar sesión al final en rojo y el menú no se mueve al escoger una opción', async () => {
    const { page, context } = await pageWithData({ email: 'gaby@goatstylesalon.com', barberId: 'gabriel', isAdmin: true }, { width: 1440, height: 640 });
    try {
        await page.goto(`${origin}/staff/gaby/index.html`);
        await page.locator('.admin-shell').waitFor();
        const code = await seedPendingAppointment(page);
        assert.equal(await page.evaluate(c => GabyData.getState().appointments.find(a => a.code === c).status, code), 'PENDIENTE');
        await page.locator('.admin-shell').waitFor();
        const topbar = await page.locator('.topbar').innerText();
        assert.ok(!/Cambiar contraseña|Cerrar sesión/i.test(topbar), 'La barra de arriba ya no tiene cambiar contraseña ni cerrar sesión');
        assert.deepEqual((await page.locator('.nav-group-label').allInnerTexts()).map(t => t.toUpperCase()), ['AGENDA', 'CLIENTES', 'BARBERÍA', 'NEGOCIO', 'CUENTA']);
        const logout = page.locator('.sidebar .nav-footer > :last-child');
        assert.match(await logout.innerText(), /Cerrar sesión/);
        assert.match(await logout.evaluate(el => getComputedStyle(el).color), /rgb\(255, 138, 138\)/);
        // El menú conserva su posición al escoger una opción (no se redibuja ni vuelve arriba).
        await page.evaluate(() => { const s = document.querySelector('.sidebar'); s.scrollTop = s.scrollHeight; s.dataset.qa = 'mismo'; });
        const before = await page.evaluate(() => document.querySelector('.sidebar').scrollTop);
        assert.ok(before > 0);
        await page.locator('.nav-btn[data-section="settings"]').click();
        const after = await page.evaluate(() => ({ nav: document.querySelector('.sidebar').scrollTop, same: document.querySelector('.sidebar').dataset.qa }));
        assert.equal(after.same, 'mismo');
        assert.equal(after.nav, before);
        const settings = page.locator('#admin-section-content');
        assert.equal(await settings.getByRole('button', { name: 'Cambiar contraseña' }).count(), 1);
        assert.equal(await settings.getByRole('button', { name: 'Cerrar sesión' }).count(), 1);
        // Citas: Aprobar y Rechazar a la vista; el resto en los tres puntos.
        assert.equal(await page.locator('.nav-btn[data-section="appointments"] .ap-nav-badge').innerText(), '1');
        await page.locator('.nav-btn[data-section="appointments"]').click();
        const request = page.locator('.ap-request').first();
        await request.waitFor();
        assert.equal(await request.getByRole('button', { name: 'Aprobar' }).count(), 1);
        assert.equal(await request.getByRole('button', { name: 'Rechazar' }).count(), 1);
        assert.equal(await request.locator('img.ap-request-photo').count(), 1);
        await request.locator('[data-more]').click();
        const menu = page.locator('.ap-more-menu');
        assert.match(await menu.innerText(), /Ver detalles[\s\S]*Marcar completada[\s\S]*Marcar no-show[\s\S]*Editar \/ reprogramar[\s\S]*Cancelar cita/);
        await page.keyboard.press('Escape');
        assert.equal(await menu.count(), 0);
        await request.getByRole('button', { name: 'Aprobar' }).click();
        await page.waitForFunction(c => GabyData.getState().appointments.find(a => a.code === c).status === 'APROBADA', code);
        await page.waitForFunction(() => !document.querySelector('.ap-request'));
    } finally { await context.close(); }
});

test('panel en el celular: el menú se abre con el botón y se cierra al escoger una sección', async () => {
    const { page, context } = await pageWithData({ email: 'wilo@goatstylesalon.com', barberId: 'wilo', isAdmin: false }, { width: 390, height: 844 });
    try {
        await page.goto(`${origin}/staff/wilo/index.html`);
        await page.locator('.admin-shell').waitFor();
        const offscreen = await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().right <= 0);
        assert.equal(offscreen, true, 'El menú empieza cerrado');
        assert.equal(await page.locator('.nav-btn[data-section="providers"]').count(), 0, 'Proveedores es solo del administrador');
        await page.locator('[data-nav-open]').click();
        await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0);
        await page.locator('.nav-btn[data-section="calendar"]').click();
        await page.waitForFunction(() => !document.body.classList.contains('nav-open'));
        assert.equal(await page.locator('.mobile-bar-title').innerText(), 'Calendario');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await context.close(); }
});

test('reserva sin cuenta: pide nombre completo; "No sé cómo se llama el recorte" con foto queda pendiente de aprobación', async () => {
    const { page, context } = await pageWithData(null, { width: 390, height: 844 });
    try {
        await page.goto(`${origin}/booking.html`);
        const banner = page.getByRole('button', { name: 'Rechazar no esenciales', exact: true });
        if (await banner.count()) await banner.click();
        await page.locator('.bw-unknown input').check({ force: true });
        await page.locator('.bw [data-next]').click();
        await page.locator('[data-barber="gabriel"]').click();
        await page.locator('.bw-time').first().click();
        await page.locator('.bw [data-next]').click();
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
        await page.locator('#bw-photo').setInputFiles({ name: 'referencia.png', mimeType: 'image/png', buffer: png });
        await page.locator('.bw-photo-preview img').waitFor();
        // La casilla puede volver a dibujarse mientras se procesa la foto: se reintenta hasta que quede marcada.
        for (let attempt = 0; attempt < 5 && !(await page.locator('#bw-agree').isChecked()); attempt += 1) {
            await page.locator('#bw-agree').check({ force: true }).catch(() => {});
        }
        assert.equal(await page.locator('#bw-agree').isChecked(), true);
        await page.locator('[data-confirm]').click();
        assert.equal(await page.evaluate(() => GabyData.getState().appointments.some(a => a.unknownCut)), false, 'Sin nombre no se reserva');
        await page.locator('#bw-name').fill('Luis Rivera');
        await page.locator('[data-confirm]').click();
        await page.waitForFunction(() => GabyData.getState().appointments.some(a => a.unknownCut));
        const appointment = await page.evaluate(() => GabyData.getState().appointments.find(a => a.unknownCut));
        assert.equal(appointment.status, 'PENDIENTE');
        assert.equal(appointment.client, 'Luis Rivera');
        assert.equal(appointment.clientId, null);
        assert.equal(appointment.service, 'No sé cómo se llama el recorte');
        assert.match(appointment.referencePhoto, /^data:image\/jpeg;base64,/);
        assert.match(await page.locator('.bw-done').innerText(), /Recibimos tu solicitud/);
        assert.match(await page.locator('.bw-done').innerText(), new RegExp(appointment.code));
        await page.locator('#consult-input').fill(appointment.code);
        await page.getByRole('button', { name: 'Buscar', exact: true }).click();
        await page.waitForFunction(() => /Pendiente/.test(document.getElementById('consult-result').innerText));
        // Al volver a Cita se ve la cita activa con su estado y un botón simple para sacar otra.
        await page.reload();
        const mine = page.locator('#my-appointments');
        await mine.waitFor();
        assert.match(await mine.innerText(), new RegExp(appointment.code));
        assert.match(await mine.innerText(), /Pendiente/i);
        assert.equal(await page.locator('#booking-card').isVisible(), false);
        assert.equal(await page.locator('.mobile-bottom-nav a[href="booking.html"] span').innerText(), 'Mi cita');
        await page.getByRole('button', { name: 'Sacar otra cita' }).click();
        await page.locator('#booking-card .bw-option').first().waitFor();
        assert.equal(await mine.isVisible(), false);
    } finally { await context.close(); }
});

test('panel del barbero en el celular: cada sección abre con un solo toque y nada es más ancho que la pantalla', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await context.addInitScript(() => {
        if (!localStorage.getItem('gs_language_chosen')) localStorage.setItem('gs_language_chosen', 'es');
        if (localStorage.getItem('qa-seeded')) return;
        const client = { id: 'qa-long', name: 'Carlos Prueba Con Un Nombre Bastante Largo', email: 'carlos.prueba.largo@example.test', phone: '7875551234', preferredBarber: 'wilo' };
        localStorage.setItem('gs_crm', JSON.stringify({ clients: [client], appointments: [
            { code: 'QA-W1', clientId: client.id, client: client.name, barber: 'wilo', barberName: 'Wilo', service: 'Classic Cut', services: ['Classic Cut'], dateTime: '2026-01-10T10:00', status: 'COMPLETADA', duration: 40 }
        ], reviews: [], settings: { firstReviewSeeded: true } }));
        localStorage.setItem('gs_staff_session', JSON.stringify({ email: 'wilo@goatstylesalon.com', barberId: 'wilo', isAdmin: false, exp: Date.now() + 3600000 }));
        localStorage.setItem('qa-seeded', 'true');
    });
    const page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.stack || error.message));
    try {
        await page.goto(`${origin}/staff/wilo/index.html`);
        await page.locator('.admin-shell').waitFor();
        const ids = await page.evaluate(() => [...document.querySelectorAll('.nav-btn[data-section]')].map(b => b.dataset.section));
        for (const id of ids) {
            await page.locator('[data-nav-open]').tap();
            await page.waitForFunction(() => document.body.classList.contains('nav-open'));
            await page.locator(`.nav-btn[data-section="${id}"]`).tap();
            await page.waitForFunction(section => !document.body.classList.contains('nav-open') && document.querySelector('.nav-btn.active')?.dataset.section === section, id);
            const size = await page.evaluate(() => ({ vw: innerWidth, doc: document.documentElement.scrollWidth }));
            assert.deepEqual([id, size.vw, size.doc <= 390], [id, 390, true], `La sección ${id} cabe en la pantalla`);
        }
        await page.locator('[data-nav-open]').tap();
        await page.locator('.nav-btn[data-section="clients"]').tap();
        await page.locator('[data-pick]').first().tap();
        await page.getByText('Notas internas').waitFor();
    } finally { await context.close(); }
});

test('inicio: no queda registro ni inicio de sesión de clientes y las reseñas anteriores aprobadas se ven con barbero', async () => {
    const { page, context } = await pageWithData();
    try {
        await page.goto(`${origin}/index.html`);
        const leftovers = await page.evaluate(() => ({
            links: [...document.querySelectorAll('a')].filter(a => /profile\.html|security\.html/.test(a.getAttribute('href') || '') || /^(Cliente|Portal|Registrarse|Mi cuenta)$/.test(a.textContent.trim())).length,
            forms: document.querySelectorAll('#client-register-form, #client-login-form, #cliente').length,
            text: /Crear cuenta|Ya tengo cuenta|Mi cuenta|Registrarse/i.test(document.body.innerText)
        }));
        assert.deepEqual([leftovers.links, leftovers.forms, leftovers.text], [0, 0, false]);
        for (const file of ['profile.html', 'security.html', 'client-account.js']) {
            const res = await page.request.get(`${origin}/${file}`);
            assert.equal(res.status(), 404, `${file} ya no existe`);
        }
        await page.evaluate(() => GabyData.updateState(state => {
            state.reviews = [{ id: 'qa-old', clientId: 'qa-client', clientName: 'Carlos Prueba', barber: 'gabriel', rating: '5', text: 'Reseña de antes', createdAt: '2026-05-01T12:00:00.000Z', status: 'APROBADA' }];
        }));
        await page.reload();
        const card = page.locator('#track-1 .review-card').first();
        await card.waitFor();
        const text = (await card.innerText()).replace(/\s+/g, ' ');
        assert.match(text, /Reseña de antes/);
        assert.match(text, /Barbero:? Gabriel Andres Ortiz \(Gaby\)/);
        assert.match(text, /(Fecha:|Enviada|Publicada) 1 de mayo de 2026/);
        assert.match(await card.locator('img.vip-review-photo').getAttribute('src'), /review-avatar\.svg$/);
        await page.goto(`${origin}/barber.html?id=gabriel`);
        assert.match(await page.locator('section[aria-label="Reseñas de clientes"]').innerText(), /Reseña de antes[\s\S]*Barbero: Gaby/);
    } finally { await context.close(); }
});

test('primera visita: pide escoger el idioma una sola vez', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.stack || error.message));
    try {
        await page.goto(`${origin}/services.html`);
        const modal = page.locator('.site-lang');
        await modal.waitFor();
        await modal.getByRole('button', { name: 'English' }).click();
        await page.waitForLoadState('load');
        assert.equal(await page.evaluate(() => GabyData.getState().settings.defaultLanguage), 'en');
        await page.goto(`${origin}/settings.html`);
        assert.equal(await page.locator('.site-lang').count(), 0, 'No se vuelve a preguntar');
    } finally { await context.close(); }
});

test('reserva: domingo y lunes salen como cerrados con aviso, y "Reservar con" deja escogido el barbero', async () => {
    const { page, context } = await pageWithData(null, { width: 390, height: 844 });
    try {
        await page.goto(`${origin}/booking.html`);
        const banner = page.getByRole('button', { name: 'Rechazar no esenciales', exact: true });
        if (await banner.count()) await banner.click();
        await page.locator('[data-book-barber="wilo"]').click();
        assert.match(await page.locator('.bw-chosen').innerText(), /Wilo/);
        await page.locator('.bw-option input[data-service="Classic Cut"]').check({ force: true });
        await page.locator('.bw [data-next]').click();
        await page.locator('.bw-date').first().waitFor();
        assert.match(await page.locator('.bw-title').innerText(), /Cuándo/, 'Salta directo a la fecha y hora');
        const closed = page.locator('.bw-date.closed').first();
        assert.match(await closed.innerText(), /Cerrado/);
        await closed.click();
        assert.match(await page.locator('.bw-closed').innerText(), /cerrada/);
        assert.equal(await page.locator('.bw-time').count(), 0);
        const hours = await page.locator('.bw-hours .gs-hours div').allInnerTexts();
        assert.deepEqual(hours.map(row => row.replace(/\s+/g, ' ').trim()), ['Martes a jueves 8:00 AM – 6:00 PM', 'Viernes 8:00 AM – 8:00 PM', 'Sábado 7:00 AM – 5:00 PM', 'Domingo y lunes Cerrado']);
    } finally { await context.close(); }
});

test('soporte: reportar un problema pide nombre completo, teléfono y cuál área si es "Otra"', async () => {
    const { page, context } = await pageWithData(null, { width: 390, height: 844 });
    try {
        await page.goto(`${origin}/support.html`);
        const banner = page.getByRole('button', { name: 'Rechazar no esenciales', exact: true });
        if (await banner.count()) await banner.click();
        await page.locator('[data-panel="report-panel"]').click();
        assert.equal(await page.locator('label[for="reportName"]').innerText(), 'Nombre completo');
        assert.equal(await page.locator('#reportOtherWrap').isVisible(), false);
        await page.locator('#reportArea').selectOption('other');
        assert.equal(await page.locator('#reportOther').isVisible(), true);
        const required = await page.evaluate(() => ['reportName', 'reportPhone', 'reportArea', 'reportOther', 'reportDevice', 'reportMessage'].every(id => document.getElementById(id).required) && !document.getElementById('reportEmail').required);
        assert.equal(required, true);
        await page.locator('#reportPhone').fill('123');
        assert.equal(await page.locator('#reportPhone').evaluate(el => el.validity.valid), false);
        await page.locator('#reportPhone').fill('(787) 555-1234');
        assert.equal(await page.locator('#reportPhone').evaluate(el => el.validity.valid), true);
    } finally { await context.close(); }
});

test('perfil del barbero en el celular: la barra de abajo muestra sus íconos', async () => {
    const { page, context } = await pageWithData(null, { width: 390, height: 844 });
    try {
        await page.goto(`${origin}/barber.html?id=gabriel`);
        const icons = page.locator('.site-bottom-nav a i');
        assert.equal(await icons.count(), 5);
        assert.equal(await page.locator('.site-bottom-nav').isVisible(), true);
        // Las pruebas no cargan la fuente de íconos (sin internet); se revisa que cada opción tenga su ícono.
        assert.deepEqual(await icons.evaluateAll(list => list.map(i => i.className)), ['fas fa-house', 'fas fa-users', 'fas fa-calendar-check', 'fas fa-newspaper', 'fas fa-gear']);
    } finally { await context.close(); }
});

test('panel en el celular: "Más opciones" de una cita funciona encima de la ventana y las canceladas salen en rojo', async () => {
    const { page, context } = await pageWithData({ email: 'gaby@goatstylesalon.com', barberId: 'gabriel', isAdmin: true }, { width: 390, height: 844 });
    try {
        await page.goto(`${origin}/staff/gaby/index.html`);
        await page.locator('.admin-shell').waitFor();
        const codes = await page.evaluate(() => {
            const out = [];
            GabyData.updateState(state => {
                const next = GabyBooking.nextAvailable('gabriel', 40, state);
                const services = GabyBooking.findServices(['Classic Cut'], state);
                const a = GabyBooking.createAppointment(state, { walkIn: { name: 'Luis Rivera', phone: '7875551234' }, barberId: 'gabriel', services, date: next.date, time: next.time, source: 'manual' });
                const slots = GabyBooking.getSlots('gabriel', next.date, 40, { state, staff: true });
                const b = GabyBooking.createAppointment(state, { walkIn: { name: 'Ana Pérez' }, barberId: 'gabriel', services, date: next.date, time: slots[0], source: 'manual' });
                GabyBooking.cancelAppointment(state, b.code, { by: 'barbería', actor: 'Gaby', reason: 'El cliente llamó' });
                out.push(a.code, b.code, next.date);
            });
            return out;
        });
        const [active, canceled, day] = codes;
        await page.evaluate(d => { window.__day = d; }, day);
        await page.locator('[data-nav-open]').click();
        await page.locator('.nav-btn[data-section="calendar"]').click();
        await page.locator('[data-view="day"]').click();
        for (let i = 0; i < 40 && !(await page.locator(`[data-open="${canceled}"]`).count()); i += 1) await page.locator('[data-nav="1"]').click();
        const red = await page.locator(`[data-open="${canceled}"]`).evaluate(el => ({ border: getComputedStyle(el).borderLeftColor, bg: getComputedStyle(el).backgroundColor, label: el.querySelector('.ap-event-status').textContent }));
        assert.equal(red.border, 'rgb(255, 107, 107)');
        assert.match(red.bg, /rgba\(255, 107, 107/);
        assert.equal(red.label, 'Cancelada');
        await page.locator(`[data-open="${active}"]`).click();
        await page.locator('.admin-modal-card').waitFor();
        await page.getByRole('button', { name: 'Más opciones' }).click();
        const menu = page.locator('.ap-more-menu');
        await menu.waitFor();
        const onTop = await menu.evaluate(m => { const r = m.getBoundingClientRect(); return Boolean(document.elementFromPoint(r.left + 20, r.top + 20)?.closest('.ap-more-menu')); });
        assert.equal(onTop, true, 'El menú se ve encima de la ventana de la cita');
        await menu.getByRole('button', { name: 'Marcar completada' }).click();
        await page.waitForFunction(c => GabyData.getState().appointments.find(a => a.code === c).status === 'COMPLETADA', active);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await context.close(); }
});
