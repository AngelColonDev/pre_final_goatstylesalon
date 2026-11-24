(function () {
    const app = document.getElementById('admin-app');
    const config = window.AdminPortalConfig || {};
    // Menu agrupado en el orden del trabajo diario. adminOnly: solo lo ve el administrador general.
    const NAV_GROUPS = ['Agenda', 'Clientes', 'Barbería'];
    const sections = [
        { id: 'dashboard', label: 'Inicio', icon: 'fa-house', group: 'Agenda' },
        { id: 'appointments', label: 'Citas', icon: 'fa-calendar-check', group: 'Agenda' },
        { id: 'calendar', label: 'Calendario', icon: 'fa-calendar-days', group: 'Agenda' },
        { id: 'clients', label: 'Clientes', icon: 'fa-users', group: 'Clientes' },
        { id: 'reviews', label: 'Reseñas', icon: 'fa-star', group: 'Clientes' },
        { id: 'notifications', label: 'Notificaciones', icon: 'fa-bell', group: 'Clientes' },
        { id: 'schedule', label: 'Horarios y bloqueos', icon: 'fa-clock', group: 'Barbería' },
        { id: 'services', label: 'Servicios', icon: 'fa-scissors', group: 'Barbería' },
        { id: 'profile', label: 'Barberos', icon: 'fa-id-card', group: 'Barbería', adminOnly: true },
        { id: 'inventory', label: 'Negocio', icon: 'fa-boxes-stacked', group: 'Barbería' },
        { id: 'settings', label: 'Configuración', icon: 'fa-gear', group: 'Barbería' }
    ];

    function visibleSections() {
        return sections.filter(section => !section.adminOnly || isAdmin());
    }

    function sectionLabel(id) {
        return (sections.find(section => section.id === id) || sections[0]).label;
    }

    let currentSection = 'dashboard';
    let editingClientId = '';
    let editingReviewId = '';
    let editingServiceId = '';
    let editingNewsId = '';
    let editingBarberId = '';
    let selectedClientId = '';
    let editingAppointmentCode = '';
    let viewingAppointmentCode = '';
    let showingNewReview = false;
    let showingNewService = false;
    let showingNewNews = false;
    let showingNewBarber = false;

    function getDb() {
        return window.GabyData.getState();
    }

    // Guarda y muestra un mensaje de éxito o error. message: texto de éxito, o null para no mostrar nada.
    function updateDb(mutator, message) {
        window.GabyData.commit(mutator, {
            success: message === undefined ? 'Cambios guardados correctamente.' : message,
            error: 'No se pudo guardar el cambio. Intenta de nuevo.'
        });
        return getDb();
    }

    function isAdmin() {
        return config.mode === 'admin';
    }

    function barberLabel(barber) {
        return barber.alias && barber.alias !== barber.name ? `${barber.name} (${barber.alias})` : barber.name;
    }

    function barberName(id) {
        const barber = getDb().barbers.find(item => item.id === id);
        return barber ? barberLabel(barber) : id;
    }

    function toNumber(value) {
        const match = String(value || '').replace(/[^\d.]/g, '');
        return Number(match || 0);
    }

    function formatDateTime(value) {
        if (!value) return '-';
        return new Date(value).toLocaleString('es-PR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function daysWithBarbershop(client) {
        if (!client?.registeredAt) return 0;
        return Math.max(1, Math.floor((Date.now() - new Date(client.registeredAt).getTime()) / 86400000));
    }

    function parseLocalDate(dateStr) {
        if (!dateStr) return null;
        const [year, month, day] = String(dateStr).split('-').map(Number);
        if (!year || !month || !day) return null;
        const date = new Date(year, month - 1, day);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function calculateAge(birthDate) {
        const birth = parseLocalDate(birthDate);
        if (!birth) return null;
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
        return age;
    }

    function isClientMinor(client) {
        const age = calculateAge(client?.birthDate);
        return age !== null && age < 18;
    }

    function daysUntilBirthday(birthDate) {
        const birth = parseLocalDate(birthDate);
        if (!birth) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
        if (next < today) next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
        return Math.round((next - today) / 86400000);
    }

    function formatBirthdayCountdown(birthDate) {
        const days = daysUntilBirthday(birthDate);
        if (days === null) return '';
        if (days === 0) return 'Es hoy';
        if (days === 1) return 'Es mañana';
        return `Faltan ${days} días`;
    }

    function formatBirthDate(birthDate) {
        const birth = parseLocalDate(birthDate);
        if (!birth) return '-';
        return birth.toLocaleDateString('es-PR', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    function formatMembershipDuration(days) {
        if (!days || days < 1) return 'Nuevo cliente';
        if (days < 30) return `${days} día${days === 1 ? '' : 's'}`;
        const years = Math.floor(days / 365);
        const months = Math.floor((days % 365) / 30);
        const remDays = Math.floor((days % 365) % 30);
        if (years > 0) {
            return months > 0 ? `${years} año${years === 1 ? '' : 's'}, ${months} mes${months === 1 ? '' : 'es'}` : `${years} año${years === 1 ? '' : 's'}`;
        }
        return remDays > 0 ? `${months} mes${months === 1 ? '' : 'es'}, ${remDays} día${remDays === 1 ? '' : 's'}` : `${months} mes${months === 1 ? '' : 'es'}`;
    }

    function getAppointments() {
        const db = getDb();
        return isAdmin() ? db.appointments : db.appointments.filter(item => item.barber === config.role);
    }

    function getClients() {
        const db = getDb();
        if (isAdmin()) return db.clients;
        const ids = new Set(getAppointments().map(item => item.clientId));
        return db.clients.filter(client => ids.has(client.id) || client.preferredBarber === config.role);
    }

    function getReviews() {
        const db = getDb();
        if (isAdmin()) return db.reviews;
        return db.reviews.filter(item => item.barber.toLowerCase().includes(config.role));
    }

    // Cada barbero vende y administra sus propios productos; el admin general ve todos.
    function getProducts() {
        const products = getDb().products || [];
        return isAdmin() ? products : products.filter(item => item.barberId === config.role);
    }

    function absoluteUrl(path) {
        try {
            return new URL(path, window.location.href).href;
        } catch (error) {
            return path;
        }
    }

    function renderDirectLinkCard({ title, description, path, icon, shareText }) {
        const url = absoluteUrl(path);
        const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${shareText || title}: ${url}`)}`;
        return `
            <div class="direct-link-card">
                <div class="direct-link-icon"><i class="fas ${icon || 'fa-link'}"></i></div>
                <div>
                    <div class="direct-link-title">${title}</div>
                    <div class="direct-link-desc">${description}</div>
                </div>
                <div class="direct-link-url" title="${escapeAttr(url)}"><i class="fas fa-link"></i><span>${url}</span></div>
                <div class="direct-link-actions">
                    <button class="btn btn-ghost" type="button" data-copy-link="${escapeAttr(url)}"><i class="fas fa-copy"></i><span>Copiar link</span></button>
                    <a class="btn btn-whatsapp" href="${whatsappHref}" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp"></i><span>Compartir</span></a>
                    <a class="btn btn-primary" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square"></i><span>Abrir</span></a>
                </div>
            </div>
        `;
    }

    function renderBarberDirectLinks() {
        const barber = getBarbers().find(item => item.id === config.role);
        const name = barber ? (barber.alias || barber.name) : 'tu perfil';
        return `
            <section class="card" style="margin-top: 18px;">
                <div class="section-title">Tus links directos</div>
                <div class="direct-links">
                    ${renderDirectLinkCard({ title: 'Perfil público', description: `Comparte el perfil de ${name} con fotos, contacto, productos y reseñas.`, path: `../../barber.html?id=${config.role}`, icon: 'fa-id-badge', shareText: `Mira el perfil de ${name} en Goat Style Salon` })}
                    ${renderDirectLinkCard({ title: 'Reservar contigo', description: `Abre la página de reservas con ${name} ya seleccionado.`, path: `../../booking.html?barber=${config.role}`, icon: 'fa-calendar-check', shareText: `Reserva tu cita con ${name}` })}
                </div>
            </section>
        `;
    }

    async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        helper.remove();
    }

    document.addEventListener('click', event => {
        const button = event.target.closest('[data-copy-link]');
        if (!button) return;
        copyText(button.dataset.copyLink).then(() => {
            const label = button.querySelector('span');
            button.classList.add('copied');
            if (label) label.textContent = 'Copiado';
            window.setTimeout(() => {
                button.classList.remove('copied');
                if (label) label.textContent = 'Copiar link';
            }, 1800);
        }).catch(() => window.prompt('Copia este link:', button.dataset.copyLink));
    });

    // Si un formulario no se envia por un campo obligatorio vacio, se avisa con un mensaje.
    let lastInvalidAt = 0;
    document.addEventListener('invalid', event => {
        if (Date.now() - lastInvalidAt < 800) return;
        lastInvalidAt = Date.now();
        const label = event.target.closest('.form-group')?.querySelector('.form-label')?.textContent?.trim();
        window.GabyData.toast(`Completa el campo obligatorio${label ? `: <strong>${label}</strong>` : ''}.`, 'warning');
    }, true);

    // Leyenda de campos obligatorios en los formularios del panel.
    function addRequiredLegends() {
        document.querySelectorAll('#admin-app form').forEach(form => {
            if (!form.querySelector('[required]') || form.querySelector('.required-legend')) return;
            const legend = document.createElement('p');
            legend.className = 'required-legend';
            legend.innerHTML = 'Los campos marcados con <b>*</b> son obligatorios.';
            form.insertBefore(legend, form.firstElementChild);
        });
    }

    function getProviders() {
        return getDb().providers;
    }

    function getServices() {
        return getDb().services;
    }

    function getNews() {
        const db = getDb();
        return isAdmin() ? db.news : db.news.filter(item => item.authorId === config.role);
    }

    function getBarbers() {
        return getDb().barbers;
    }

    function makeStatus(status) {
        if (status === 'APROBADA' || status === 'Activo' || status === 'online') return 'online';
        if (status === 'PENDIENTE') return 'pending';
        return 'offline';
    }

    function getClientById(id) {
        return getDb().clients.find(client => client.id === id);
    }

    function getAppointmentByCode(code) {
        return getDb().appointments.find(appointment => appointment.code === code) || null;
    }

    function getClientFromAppointment(code) {
        const appointment = getAppointmentByCode(code);
        if (!appointment) return null;
        const db = getDb();
        return db.clients.find(client => client.id === appointment.clientId || client.name === appointment.client || client.email === appointment.email) || null;
    }

    function normalizePhoneNumber(phone) {
        const digits = String(phone || '').replace(/\D/g, '');
        if (!digits) return '';
        if (digits.length === 10) return `1${digits}`;
        if (digits.length === 11 && digits.startsWith('1')) return digits;
        return digits;
    }

    function buildAppointmentNotification(appointment, client) {
        const firstName = (appointment.client || 'cliente').split(' ')[0];
        const status = appointment.status || 'PENDIENTE';
        const service = appointment.service || 'tu servicio';
        const barber = barberName(appointment.barber);
        const dateTime = formatDateTime(appointment.dateTime);
        const messages = {
            APROBADA: `Hola ${firstName}, te confirmamos que tu cita para ${service} con ${barber}, pautada para ${dateTime}, ha sido aprobada. Te esperamos en GOAT Style Salon. Si necesitas algún ajuste, respondeme a la mayor brevedad.`,
            RECHAZADA: `Hola ${firstName}, queremos informarte que tu solicitud de cita para ${service} con ${barber}, pautada para ${dateTime}, fue rechazada. Si deseas, puedes comunicarte con nosotros para coordinar una nueva fecha disponible.`,
            CANCELADA: `Hola ${firstName}, te notificamos que tu cita para ${service} con ${barber}, pautada para ${dateTime}, ha sido cancelada. Si deseas reprogramarla, con gusto podemos ayudarte a encontrar otro espacio.`,
            PENDIENTE: `Hola ${firstName}, tu cita para ${service} con ${barber}, pautada para ${dateTime}, se encuentra pendiente de confirmación. Te estaremos notificando tan pronto tengamos el estatus final.`,
            COMPLETADA: `Hola ${firstName}, gracias por visitarnos para ${service} con ${barber}. Si quieres, deja tu reseña en la página (sección Reseñas). ¡Te esperamos pronto!`,
            NO_SHOW: `Hola ${firstName}, te esperábamos para ${service} con ${barber} el ${dateTime} y no pudimos atenderte. Si deseas reprogramar, con gusto te ayudamos.`
        };
        return messages[status] || messages.PENDIENTE;
    }

    function notifyAppointmentClient(code) {
        const appointment = getAppointmentByCode(code);
        if (!appointment) {
            window.alert('No se encontro la cita seleccionada.');
            return;
        }
        const client = getClientFromAppointment(code);
        const message = buildAppointmentNotification(appointment, client);
        const phone = normalizePhoneNumber(client?.phone || appointment.clientPhone);
        if (phone) {
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
            return;
        }
        if (client?.email) {
            const subject = encodeURIComponent(`Actualización de cita ${appointment.code}`);
            window.location.href = `mailto:${client.email}?subject=${subject}&body=${encodeURIComponent(message)}`;
            return;
        }
        window.alert('Esta cita no tiene teléfono ni email registrado para enviar una notificación.');
    }

    function buildCancellationChargeMessage(appointment, client) {
        const firstName = (appointment.client || 'cliente').split(' ')[0];
        const service = appointment.service || 'tu servicio';
        return `Hola ${firstName}, registramos la cancelación de tu cita para ${service}. Según nuestras políticas, esta cancelación puede generar cargos por cancelación tardía. Si deseas revisar el balance o reprogramar, comunícate con nosotros a la mayor brevedad.`;
    }

    function contactAppointmentClient(code) {
        const client = getClientFromAppointment(code);
        const appointment = getAppointmentByCode(code);
        const phone = normalizePhoneNumber(client?.phone);
        if (phone) {
            window.location.href = `tel:+${phone}`;
            return;
        }
        if (client?.email) {
            const subject = encodeURIComponent(`Contacto sobre cita ${appointment?.code || ''}`);
            window.location.href = `mailto:${client.email}?subject=${subject}`;
            return;
        }
        window.alert('Este cliente no tiene teléfono ni email registrado para contactarlo.');
    }

    function sendCancellationChargeMessage(code) {
        const appointment = getAppointmentByCode(code);
        if (!appointment) {
            window.alert('No se encontro la cita seleccionada.');
            return;
        }
        const client = getClientFromAppointment(code);
        const message = buildCancellationChargeMessage(appointment, client);
        const phone = normalizePhoneNumber(client?.phone);
        if (phone) {
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
            return;
        }
        if (client?.email) {
            const subject = encodeURIComponent(`Cargo por cancelación de cita ${appointment.code}`);
            window.location.href = `mailto:${client.email}?subject=${subject}&body=${encodeURIComponent(message)}`;
            return;
        }
        window.alert('Este cliente no tiene teléfono ni email registrado para enviar el mensaje de cancelación.');
    }

    function cancellationAlertKey() {
        return isAdmin() ? 'admin' : (config.role || 'staff');
    }

    function getPendingCancellationAlert() {
        const key = cancellationAlertKey();
        return getAppointments()
            .filter(item => item.status === 'CANCELADA' && item.canceledByClient && !(item.cancellationAlertSeenBy || []).includes(key))
            .slice()
            .sort((a, b) => new Date(b.canceledAt || b.dateTime || 0) - new Date(a.canceledAt || a.dateTime || 0))[0] || null;
    }

    function getLatestClientCancellation() {
        return getAppointments()
            .filter(item => item.status === 'CANCELADA' && item.canceledByClient)
            .slice()
            .sort((a, b) => new Date(b.canceledAt || b.dateTime || 0) - new Date(a.canceledAt || a.dateTime || 0))[0] || null;
    }

    function renderPersistentCancellationNotice() {
        const appointment = getPendingCancellationAlert() || getLatestClientCancellation();
        if (!appointment) return '';
        const client = getClientFromAppointment(appointment.code);
        return `
            <div class="cancel-persistent-alert">
                <div class="cancel-persistent-copy">
                    <span class="cancel-persistent-emoji">⚠️</span>
                    <div>
                        <strong>${appointment.client || 'Cliente'}</strong>
                        <p>El cliente ha cancelado su cita.</p>
                        <div class="item-meta">${appointment.service} · ${formatDateTime(appointment.canceledAt || appointment.dateTime)}</div>
                        <div class="item-meta">${client?.phone || client?.email || 'Sin contacto registrado'}</div>
                    </div>
                </div>
                <div class="cancel-persistent-actions">
                    <button class="btn btn-ghost" type="button" data-persistent-cancel-ok="${appointment.code}">OK</button>
                    <button class="btn btn-ghost" type="button" data-persistent-cancel-contact="${appointment.code}">Contactar al cliente</button>
                    <button class="btn btn-primary" type="button" data-persistent-cancel-message="${appointment.code}">Mandar mensaje</button>
                </div>
            </div>
        `;
    }

    function markCancellationAlertSeen(code) {
        const key = cancellationAlertKey();
        updateDb(db => {
            const appointment = db.appointments.find(item => item.code === code);
            if (!appointment) return;
            if (!Array.isArray(appointment.cancellationAlertSeenBy)) appointment.cancellationAlertSeenBy = [];
            if (!appointment.cancellationAlertSeenBy.includes(key)) appointment.cancellationAlertSeenBy.push(key);
        }, null);
    }

    function closeCancellationAlert(acknowledge = false) {
        const overlay = document.getElementById('cancellation-alert-modal');
        if (!overlay) return;
        const code = overlay.dataset.code;
        if (acknowledge && code) {
            markCancellationAlertSeen(code);
        }
        overlay.setAttribute('hidden', 'hidden');
        overlay.classList.remove('active');
        overlay.style.display = 'none';
        overlay.dataset.code = '';
    }

    function showCancellationAlertPopup() {
        const overlay = document.getElementById('cancellation-alert-modal');
        if (!overlay) return;
        const appointment = getPendingCancellationAlert();
        if (!appointment) {
            overlay.setAttribute('hidden', 'hidden');
            overlay.classList.remove('active');
            overlay.style.display = 'none';
            overlay.dataset.code = '';
            return;
        }
        const client = getClientFromAppointment(appointment.code);
        document.getElementById('cancellation-alert-name').innerText = appointment.client || 'Cliente';
        document.getElementById('cancellation-alert-copy').innerText = 'El cliente ha cancelado su cita.';
        document.getElementById('cancellation-alert-details').innerText = `${appointment.service} · ${formatDateTime(appointment.canceledAt || appointment.dateTime)}`;
        document.getElementById('cancellation-alert-contact').innerText = client?.phone || client?.email || 'Sin contacto registrado';
        overlay.dataset.code = appointment.code;
        overlay.removeAttribute('hidden');
        overlay.style.display = 'flex';
        overlay.classList.add('active');
    }
    function renderCancellationAlertBanner() {
        const host = document.getElementById('admin-section-content');
        if (!host) return;
        const appointment = getPendingCancellationAlert();
        const existing = document.getElementById('cancellation-inline-alert');
        if (!appointment) {
            if (existing) existing.remove();
            return;
        }
        const client = getClientFromAppointment(appointment.code);
        const markup = `
            <div class="cancel-inline-alert" id="cancellation-inline-alert">
                <div class="cancel-inline-alert-copy">
                    <div class="cancel-inline-alert-emoji">⚠️</div>
                    <div>
                        <strong>${appointment.client || 'Cliente'}</strong>
                        <p>El cliente ha cancelado su cita.</p>
                        <div class="item-meta">${appointment.service} · ${formatDateTime(appointment.canceledAt || appointment.dateTime)}</div>
                        <div class="item-meta">${client?.phone || client?.email || 'Sin contacto registrado'}</div>
                    </div>
                </div>
                <div class="cancel-inline-alert-actions">
                    <button class="btn btn-ghost" type="button" data-inline-cancel-ok="${appointment.code}">OK</button>
                    <button class="btn btn-ghost" type="button" data-inline-cancel-contact="${appointment.code}">Contactar al cliente</button>
                    <button class="btn btn-primary" type="button" data-inline-cancel-message="${appointment.code}">Mandar mensaje</button>
                </div>
            </div>
        `;
        if (existing) {
            existing.outerHTML = markup;
        } else {
            host.insertAdjacentHTML('afterbegin', markup);
        }
        document.querySelector('[data-inline-cancel-ok]')?.addEventListener('click', event => {
            markCancellationAlertSeen(event.currentTarget.dataset.inlineCancelOk);
            renderSection();
        });
        document.querySelector('[data-inline-cancel-contact]')?.addEventListener('click', event => {
            contactAppointmentClient(event.currentTarget.dataset.inlineCancelContact);
        });
        document.querySelector('[data-inline-cancel-message]')?.addEventListener('click', event => {
            sendCancellationChargeMessage(event.currentTarget.dataset.inlineCancelMessage);
        });
    }

    function bindCancellationAlertActions() {
        const overlay = document.getElementById('cancellation-alert-modal');
        if (!overlay) return;
        const ok = document.getElementById('cancellation-alert-ok');
        const contact = document.getElementById('cancellation-alert-contact-btn');
        const message = document.getElementById('cancellation-alert-message-btn');
        const close = document.getElementById('cancellation-alert-close');
        if (ok) ok.onclick = () => { closeCancellationAlert(true); renderSection(); };
        if (close) close.onclick = () => { closeCancellationAlert(true); renderSection(); };
        if (contact) contact.onclick = () => {
            const code = overlay.dataset.code;
            if (!code) return;
            contactAppointmentClient(code);
        };
        if (message) message.onclick = () => {
            const code = overlay.dataset.code;
            if (!code) return;
            sendCancellationChargeMessage(code);
        };
    }

    function escapeAttr(value) {
        return String(value || '').replace(/"/g, '&quot;');
    }

    function topEfficientBarbers() {
        const appointments = getDb().appointments;
        const barbers = getDb().barbers;
        return barbers.map(barber => {
            const ownAppointments = appointments.filter(item => item.barber === barber.id);
            const approved = ownAppointments.filter(item => item.status === 'APROBADA').length;
            const pending = ownAppointments.filter(item => item.status === 'PENDIENTE').length;
            const efficiency = ownAppointments.length ? Math.round((approved / ownAppointments.length) * 100) : 0;
            const revenue = ownAppointments.reduce((sum, item) => sum + toNumber(item.service?.includes('VIP') ? 99 : 35), 0);
            return {
                id: barber.id,
                name: barberLabel(barber),
                approved,
                pending,
                total: ownAppointments.length,
                efficiency,
                revenue
            };
        }).sort((a, b) => b.efficiency - a.efficiency || b.approved - a.approved);
    }

    function topProducts() {
        return getProducts().slice().sort((a, b) => b.sold - a.sold);
    }

    function topClients() {
        const clients = getDb().clients;
        const appointments = getDb().appointments;
        return clients.map(client => {
            const ownAppointments = appointments.filter(item => item.clientId === client.id || item.client === client.name);
            return {
                id: client.id,
                name: client.name,
                phone: client.phone || '-',
                total: ownAppointments.length,
                days: daysWithBarbershop(client),
                favoriteService: ownAppointments[0]?.service || client.haircut || '-'
            };
        }).sort((a, b) => b.total - a.total).slice(0, 5);
    }

    function renderShell() {
        app.innerHTML = `
            <div class="admin-shell">
                <aside class="sidebar">
                    <div class="brand-block">
                        <img class="brand-logo" src="https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972135/b3a13ac1-cac2-4367-9c0d-5946397d4ff9-removebg-preview_xhkncw.png" alt="Logo GOAT Style Salón">
                        <h1>${config.role === 'darialex' ? 'Darialex Style' : 'Goat Style Salon'}</h1>
                        <p>${config.title}</p>
                    </div>
                    <nav class="side-nav" aria-label="Menú del panel">
                        ${NAV_GROUPS.map(group => {
                            const items = visibleSections().filter(section => section.group === group);
                            return items.length ? `
                                <div class="nav-group">
                                    <div class="nav-group-label">${group}</div>
                                    ${items.map(section => `
                                        <button class="nav-btn ${section.id === currentSection ? 'active' : ''}" type="button" data-section="${section.id}" ${section.id === currentSection ? 'aria-current="page"' : ''}>
                                            <i class="fas ${section.icon}"></i>
                                            <span>${section.label}</span>
                                            ${navBadge(section.id)}
                                        </button>
                                    `).join('')}
                                </div>` : '';
                        }).join('')}
                    </nav>
                    <div class="nav-footer">
                        <a class="nav-btn" href="../../index.html"><i class="fas fa-arrow-left"></i><span>Página principal</span></a>
                        <div class="nav-group ap-panels">
                            <div class="nav-group-label">Todos los paneles</div>
                            ${[['gaby', 'Panel de Gaby', 'gabriel'], ['darialex', 'Panel de Darialex', 'darialex'], ['wilo', 'Panel de Wilo', 'wilo']].map(([folder, label, role]) => `<a class="nav-btn ${config.role === role ? 'active' : ''}" href="../${folder}/index.html"><i class="fas fa-user-tie"></i><span>${label}</span></a>`).join('')}
                        </div>
                        <button class="nav-btn nav-logout" type="button" data-staff-logout><i class="fas fa-right-from-bracket"></i><span>Cerrar sesión</span></button>
                    </div>
                </aside>
                <div class="nav-backdrop" data-nav-close></div>
                <main class="content">
                    <div class="mobile-bar">
                        <button class="mobile-menu-btn" type="button" data-nav-open aria-label="Abrir menú"><i class="fas fa-bars"></i></button>
                        <strong class="mobile-bar-title">${sectionLabel(currentSection)}</strong>
                        ${pendingBadgeTotal() ? `<button class="mobile-bar-pending" type="button" data-section-jump="appointments" aria-label="Citas por aprobar">${pendingBadgeTotal()}</button>` : ''}
                    </div>
                    <div class="topbar">
                        <div>
                            <div class="topbar-title">${config.title}</div>
                            <div class="topbar-subtitle">${config.subtitle}</div>
                        </div>
                        <div class="topbar-actions">
                            <a class="btn btn-primary btn-back-home" href="../../index.html">Regresar a la página principal</a>
                        </div>
                    </div>
                    ${renderPersistentCancellationNotice()}<div id="admin-section-content"></div>
                </main>
            </div>
            <div class="cancel-modal-overlay" id="cancellation-alert-modal" hidden>
                <div class="cancel-modal-card">
                    <button class="cancel-modal-close" id="cancellation-alert-close" type="button"><i class="fas fa-times"></i></button>
                    <div class="cancel-modal-emoji">⚠️</div>
                    <h2 id="cancellation-alert-name"></h2>
                    <p id="cancellation-alert-copy"></p>
                    <div class="cancel-modal-meta" id="cancellation-alert-details"></div>
                    <div class="cancel-modal-meta" id="cancellation-alert-contact"></div>
                    <div class="cancel-modal-actions">
                        <button class="btn btn-ghost" id="cancellation-alert-ok" type="button">OK</button>
                        <button class="btn btn-ghost" id="cancellation-alert-contact-btn" type="button">Contactar al cliente</button>
                        <button class="btn btn-primary" id="cancellation-alert-message-btn" type="button">Mandar mensaje</button>
                    </div>
                </div>
            </div>
        `;

        app.querySelectorAll('.nav-btn[data-section]').forEach(button => {
            button.addEventListener('click', () => goToSection(button.dataset.section));
        });
        app.querySelector('[data-section-jump]')?.addEventListener('click', event => goToSection(event.currentTarget.dataset.sectionJump));
        app.querySelector('[data-nav-open]')?.addEventListener('click', () => setNavOpen(true));
        app.querySelector('[data-nav-close]')?.addEventListener('click', () => setNavOpen(false));
        app.querySelector('[data-staff-logout]')?.addEventListener('click', staffLogout);
        bindCancellationAlertActions();
    }

    function pendingBadgeTotal() {
        if (!window.GabyAdminPro || !window.GabyBooking) return 0;
        return window.GabyAdminPro.badge('appointments', proContext());
    }

    // Menu lateral en el celular (se abre con el boton de tres rayas).
    function setNavOpen(open) {
        document.body.classList.toggle('nav-open', open);
        const toggle = app.querySelector('[data-nav-open]');
        if (toggle) toggle.setAttribute('aria-expanded', String(open));
    }

    // Cambia de seccion sin redibujar el menu: el menu no se mueve ni vuelve arriba.
    function goToSection(id) {
        if (!visibleSections().some(section => section.id === id)) return;
        const changed = id !== currentSection;
        currentSection = id;
        app.querySelectorAll('.nav-btn[data-section]').forEach(button => {
            const active = button.dataset.section === id;
            button.classList.toggle('active', active);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        const title = app.querySelector('.mobile-bar-title');
        if (title) title.textContent = sectionLabel(id);
        const wasOpen = document.body.classList.contains('nav-open');
        setNavOpen(false);
        renderSection();
        // En el celular el menu se cierra y se muestra el inicio de la seccion escogida.
        if (wasOpen && changed) window.scrollTo(0, 0);
    }

    async function staffLogout() {
        if (!window.confirm('¿Cerrar sesión en este dispositivo?')) return;
        if (window.GabyCloud && window.GabyCloud.enabled) await window.GabyCloud.signOut();
        window.GabySecurity.endStaffSession();
        document.body.classList.remove('nav-open');
        window.GabyData.toast('Sesión cerrada.', 'success');
        window.setTimeout(() => { window.location.href = '../../index.html'; }, 600);
    }

    // Redibuja todo (por ejemplo, al guardar o al llegar datos nuevos) sin mover la pagina ni el menu.
    function refreshPanel() {
        const navScroll = app.querySelector('.side-nav')?.scrollTop || 0;
        const pageScroll = window.scrollY;
        const navOpen = document.body.classList.contains('nav-open');
        renderShell();
        renderSection();
        const sideNav = app.querySelector('.side-nav');
        if (sideNav) sideNav.scrollTop = navScroll;
        if (navOpen) setNavOpen(true);
        window.scrollTo(0, pageScroll);
    }

    function renderDashboard() {
        const appointments = getAppointments();
        const clients = getClients();
        const reviews = getReviews();
        const products = topProducts();
        const barbers = topEfficientBarbers();
        const topRequestedClients = topClients();
        const activeServices = getServices().filter(service => service.active).length;
        const approvedRevenue = appointments
            .filter(item => item.status === 'APROBADA')
            .reduce((sum, item) => sum + (item.services || [item.service]).reduce((subtotal, name) => subtotal + toNumber(getServices().find(service => service.name === name)?.price || 0), 0), 0);
        const monthlyTrend = [22, 28, 31, 36, 30, 40, 44];
        const serviceMix = getServices().slice(0, 4);
        const peakPoints = topRequestedClients.map((client, index) => ({
            x: 26 + (index * 52),
            y: Math.max(34, 150 - (client.total * 18))
        }));
        const approvedCount = appointments.filter(item => item.status === 'APROBADA').length;
        const pendingCount = appointments.filter(item => item.status === 'PENDIENTE').length;
        const otherCount = appointments.length - approvedCount - pendingCount;
        const cancellationAlerts = appointments
            .filter(item => item.status === 'CANCELADA' && item.canceledByClient)
            .slice()
            .sort((a, b) => new Date(b.canceledAt || b.dateTime || 0) - new Date(a.canceledAt || a.dateTime || 0))
            .slice(0, 5);
        const approvedDeg = (approvedCount / Math.max(appointments.length, 1)) * 360;
        const pendingDeg = ((approvedCount + pendingCount) / Math.max(appointments.length, 1)) * 360;

        document.getElementById('admin-section-content').innerHTML = `
            <div class="stats-grid">
                <div class="card stat">Citas visibles<strong>${appointments.length}</strong></div>
                <div class="card stat">Pendientes<strong>${appointments.filter(item => item.status === 'PENDIENTE').length}</strong></div>
                <div class="card stat">Clientes activos<strong>${clients.length}</strong></div>
                <div class="card stat">Ingresos aprobados<strong>$${approvedRevenue}</strong></div>
            </div>
            <div class="two-col" style="margin-top: 18px;">
                <section class="card">
                    <div class="section-title">Alertas de cancelación</div>
                    <div class="list-grid">
                        ${cancellationAlerts.length ? cancellationAlerts.map(item => `
                            <div class="mini-card">
                                <strong>${item.client}</strong>
                                <div class="item-meta" style="margin-top: 8px;">Canceló ${item.service}</div>
                                <div class="item-meta" style="margin-top: 8px;">${barberName(item.barber)} · ${formatDateTime(item.canceledAt || item.dateTime)}</div>
                                <div class="item-meta" style="margin-top: 8px;">Código ${item.code}</div>
                            </div>
                        `).join('') : '<div class="empty">No hay cancelaciones recientes hechas por clientes.</div>'}
                    </div>
                </section>
                <section class="card">
                    <div class="section-title">Barberos más eficientes</div>
                    <div class="grid-cards">
                        ${barbers.map(item => `
                            <div class="mini-card">
                                <strong>${item.name}</strong>
                                <div class="item-meta" style="margin-top: 8px;">Eficiencia ${item.efficiency}%</div>
                                <div class="item-meta" style="margin-top: 8px;">Aprobadas ${item.approved} · Pendientes ${item.pending}</div>
                                <div class="item-meta" style="margin-top: 8px;">Ingresos estimados $${item.revenue}</div>
                            </div>
                        `).join('')}
                    </div>
                </section>
                <section class="card">
                    <div class="section-title">Productos más vendidos</div>
                    <div class="grid-cards">
                        ${products.slice(0, 4).map(item => `
                            <div class="mini-card">
                                <strong>${item.name}</strong>
                                <div class="item-meta" style="margin-top: 8px;">Vendidos ${item.sold}</div>
                                <div class="item-meta" style="margin-top: 8px;">Stock ${item.stock} · ${item.price}</div>
                            </div>
                        `).join('')}
                    </div>
                </section>
            </div>
            <div class="two-col" style="margin-top: 18px;">
                <section class="card">
                    <div class="section-title">Clientes que más solicitan servicios</div>
                    <div class="list-grid">
                        ${topRequestedClients.map(item => `
                            <div class="mini-card">
                                <strong>${item.name}</strong>
                                <div class="item-meta" style="margin-top: 8px;">Solicitudes ${item.total} · ${item.phone}</div>
                                <div class="item-meta" style="margin-top: 8px;">${item.days} días con la barbería · ${item.favoriteService}</div>
                            </div>
                        `).join('')}
                    </div>
                </section>
                <section class="card">
                    <div class="section-title">Estadísticas generales</div>
                    <div class="grid-cards">
                        <div class="mini-card"><strong>${reviews.length}</strong><div class="item-meta" style="margin-top: 8px;">Reseñas recibidas</div></div>
                        <div class="mini-card"><strong>${reviews.filter(item => item.status === 'PENDIENTE').length}</strong><div class="item-meta" style="margin-top: 8px;">Reseñas pendientes</div></div>
                        <div class="mini-card"><strong>${activeServices}</strong><div class="item-meta" style="margin-top: 8px;">Servicios activos</div></div>
                        <div class="mini-card"><strong>${getDb().news.length}</strong><div class="item-meta" style="margin-top: 8px;">Publicaciones en noticias</div></div>
                        <div class="mini-card"><strong>${getProviders().length}</strong><div class="item-meta" style="margin-top: 8px;">Proveedores registrados</div></div>
                    </div>
                </section>
            </div>
            <div class="two-col" style="margin-top: 18px;">
                <section class="card">
                    <div class="section-title">Gráfica lineal de reservas</div>
                    <svg class="chart-svg" viewBox="0 0 360 180" role="img" aria-label="Tendencia de reservas">
                        <polyline class="chart-line" points="${monthlyTrend.map((value, index) => `${24 + (index * 52)},${158 - (value * 2.4)}`).join(' ')}"></polyline>
                        ${monthlyTrend.map((value, index) => `<circle class="chart-point" cx="${24 + (index * 52)}" cy="${158 - (value * 2.4)}" r="5"></circle>`).join('')}
                    </svg>
                </section>
                <section class="card">
                    <div class="section-title">Gráfica de puntos de clientes</div>
                    <svg class="chart-svg" viewBox="0 0 360 180" role="img" aria-label="Clientes frecuentes">
                        ${peakPoints.map(point => `<circle class="chart-scatter" cx="${point.x}" cy="${point.y}" r="7"></circle>`).join('')}
                    </svg>
                    <div class="item-meta" style="margin-top: 12px;">Cada punto representa un cliente frecuente y su intensidad de visitas.</div>
                </section>
            </div>
            <div class="two-col" style="margin-top: 18px;">
                <section class="card">
                    <div class="section-title">Barras de servicios más pedidos</div>
                    <div class="bars compact-bars">
                        ${serviceMix.map(service => `<div class="bar compact-bar" style="height: ${Math.max(56, service.requests * 3)}px;"><span>${service.name.split(' ')[0]}</span></div>`).join('')}
                    </div>
                </section>
                <section class="card">
                    <div class="section-title">Gráfica circular de estados</div>
                    <div class="donut-wrap">
                        <div class="donut-chart" style="background: conic-gradient(var(--accent) 0deg ${approvedDeg}deg, #f1be5d ${approvedDeg}deg ${pendingDeg}deg, #e16666 ${pendingDeg}deg 360deg);">
                            <div class="donut-center">${appointments.length}</div>
                        </div>
                        <div class="list-grid" style="flex: 1;">
                            <div class="item-meta">Aprobadas: ${approvedCount}</div>
                            <div class="item-meta">Pendientes: ${pendingCount}</div>
                            <div class="item-meta">Rechazadas/otras: ${otherCount}</div>
                        </div>
                    </div>
                </section>
            </div>
            ${renderBarberDirectLinks()}
        `;
    }

    function renderClients() {
        const clients = getClients();
        const selected = selectedClientId ? getClientById(selectedClientId) : null;

        document.getElementById('admin-section-content').innerHTML = `
            <div class="two-col">
                <section class="card">
                    <div class="section-title">Clientes</div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Nombre</th><th>Teléfono</th><th>Días</th><th>Barbero</th><th>Acciones</th></tr></thead>
                            <tbody>
                                ${clients.length ? clients.map(client => `
                                    <tr>
                                        <td>${client.name}${isClientMinor(client) ? ' <span class="status-pill offline" style="padding: 2px 8px;">Menor</span>' : ''}</td>
                                        <td>${client.phone || '-'}</td>
                                        <td>${daysWithBarbershop(client)}</td>
                                        <td>${barberName(client.preferredBarber || 'gabriel')}</td>
                                        <td>
                                            <button class="action-btn approve" data-client-edit="${client.id}">Editar</button>
                                            <button class="action-btn reject" data-client-view="${client.id}">Ver</button>
                                            <button class="action-btn notify" data-client-crm="${client.id}">Ficha CRM</button>
                                        </td>
                                    </tr>
                                `).join('') : '<tr><td colspan="5" class="empty">No hay clientes.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </section>
                <section class="card">
                    <div class="section-title">${editingClientId ? 'Editar cliente' : selected ? 'Detalle del cliente' : 'Selecciona un cliente'}</div>
                    ${editingClientId ? renderClientForm(clients.find(client => client.id === editingClientId)) : selected ? renderClientDetails(selected) : '<div class="empty">Pulsa editar o ver para trabajar con un cliente.</div>'}
                </section>
            </div>
        `;
        bindClientActions();
    }

    function renderClientForm(client) {
        if (!client) return '<div class="empty">Cliente no encontrado.</div>';
        return `
            <form id="client-form" class="form-grid">
                <div class="form-group"><label class="form-label">Nombre completo</label><input class="form-input" id="client-name" value="${escapeAttr(client.name)}"></div>
                <div class="form-group"><label class="form-label">Correo</label><input class="form-input" id="client-email" value="${escapeAttr(client.email)}"></div>
                <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="client-phone" value="${escapeAttr(client.phone || '')}"></div>
                <div class="form-group"><label class="form-label">Fecha de nacimiento</label><input class="form-input" type="date" id="client-birthdate" value="${escapeAttr(client.birthDate || '')}"></div>
                <div class="form-group"><label class="form-label">Recorte</label><input class="form-input" id="client-haircut" value="${escapeAttr(client.haircut || '')}"></div>
                <div class="form-group"><label class="form-label">Barba</label><input class="form-input" id="client-beard" value="${escapeAttr(client.beard || '')}"></div>
                <div class="form-group full">
                    <label class="form-label">Barbero asignado</label>
                    <select class="form-input" id="client-barber">
                        ${getBarbers().map(barber => `<option value="${barber.id}" ${client.preferredBarber === barber.id ? 'selected' : ''}>${barberLabel(barber)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group full"><div class="item-meta">${daysWithBarbershop(client)} días con la barbería</div></div>
                <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">Guardar cliente</button><button class="btn btn-ghost" type="button" id="cancel-client-edit">Cancelar</button></div></div>
            </form>
        `;
    }

    function renderClientDetails(client) {
        const appointments = getDb().appointments.filter(item => item.clientId === client.id || item.client === client.name);
        const age = calculateAge(client.birthDate);
        const phone = normalizePhoneNumber(client.phone);
        const minor = age !== null && age < 18;
        return `
            <div class="list-grid">
                <div class="mini-card">
                    <strong>${client.name}</strong>
                    <div class="item-meta" style="margin-top: 8px;">${client.email}</div>
                    <div class="item-meta" style="margin-top: 8px;">${client.phone || 'Sin teléfono registrado'}</div>
                    ${phone ? `
                        <div class="status-row" style="margin-top: 10px;">
                            <a class="action-btn approve" href="tel:+${phone}">Llamar</a>
                            <a class="action-btn notify" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
                        </div>
                    ` : ''}
                </div>
                <div class="mini-card">
                    <strong>Edad y cumpleaños</strong>
                    <div class="item-meta" style="margin-top: 8px;">
                        ${age !== null ? `Edad ${age} años` : 'Edad no disponible'}
                        ${age !== null ? `<span class="status-pill ${minor ? 'offline' : 'online'}" style="margin-left: 8px; padding: 2px 8px;">${minor ? 'Menor de edad' : 'Mayor de edad'}</span>` : ''}
                    </div>
                    <div class="item-meta" style="margin-top: 8px;">${client.birthDate ? `Nacio el ${formatBirthDate(client.birthDate)} · ${formatBirthdayCountdown(client.birthDate)}` : 'Fecha de nacimiento no disponible'}</div>
                    ${minor ? '<div class="status-pill offline" style="margin-top: 10px; display: block;">Aviso: cliente menor de edad. Evita lenguaje fuerte y temas delicados frente a esta persona.</div>' : ''}
                </div>
                <div class="mini-card"><strong>Perfil</strong><div class="item-meta" style="margin-top: 8px;">Recorte ${client.haircut || '-'}</div><div class="item-meta" style="margin-top: 8px;">Barba ${client.beard || '-'}</div><div class="item-meta" style="margin-top: 8px;">Miembro desde hace ${formatMembershipDuration(daysWithBarbershop(client))} (${daysWithBarbershop(client)} días)</div></div>
                <div class="mini-card"><strong>Historial</strong>${appointments.length ? appointments.map(item => `<div class="item-meta" style="margin-top: 8px;">${item.service} · ${item.status} · ${formatDateTime(item.dateTime)}</div>`).join('') : '<div class="item-meta" style="margin-top: 8px;">Sin citas registradas.</div>'}</div>
            </div>
        `;
    }

    function bindClientActions() {
        document.querySelectorAll('[data-client-edit]').forEach(button => {
            button.addEventListener('click', () => {
                editingClientId = button.dataset.clientEdit;
                selectedClientId = '';
                renderSection();
            });
        });
        document.querySelectorAll('[data-client-view]').forEach(button => {
            button.addEventListener('click', () => {
                selectedClientId = button.dataset.clientView;
                editingClientId = '';
                renderSection();
            });
        });
        document.querySelectorAll('[data-client-crm]').forEach(button => {
            button.addEventListener('click', () => {
                const client = getClientById(button.dataset.clientCrm);
                if (!client) return;
                const params = new URLSearchParams({
                    id: client.id,
                    name: client.name || '',
                    phone: client.phone || '',
                    email: client.email || '',
                    birthDate: client.birthDate || '',
                    barber: client.preferredBarber || 'gabriel'
                });
                window.open(`../../crm/dist/index.html?${params.toString()}`, `crm_${client.id}`, 'width=1400,height=900');
            });
        });
        const form = document.getElementById('client-form');
        if (form) {
            form.addEventListener('submit', event => {
                event.preventDefault();
                updateDb(db => {
                    const client = db.clients.find(item => item.id === editingClientId);
                    if (!client) return;
                    client.name = document.getElementById('client-name').value.trim();
                    client.email = document.getElementById('client-email').value.trim();
                    client.phone = document.getElementById('client-phone').value.trim();
                    client.birthDate = document.getElementById('client-birthdate').value;
                    client.haircut = document.getElementById('client-haircut').value.trim();
                    client.beard = document.getElementById('client-beard').value.trim();
                    client.preferredBarber = document.getElementById('client-barber').value;
                });
                editingClientId = '';
                renderSection();
            });
            document.getElementById('cancel-client-edit').addEventListener('click', () => {
                editingClientId = '';
                renderSection();
            });
        }
    }

    function renderReviewsSection() {
        const reviews = getReviews();
        const editing = reviews.find(item => item.id === editingReviewId);
        const formOpen = Boolean(editing) || showingNewReview;
        document.getElementById('admin-section-content').innerHTML = `
            <section class="card">
                <div class="section-title-row">
                    <div class="section-title">Moderación de reseñas</div>
                    <button class="btn btn-primary" type="button" id="toggle-new-review">+ Añadir reseña</button>
                </div>
                <div class="direct-links" style="margin-top: 6px;">
                    ${renderDirectLinkCard({ title: 'Link directo para reseñas', description: 'Envialo a tus clientes después del servicio para que dejen su reseña.', path: '../../index.html#resenas', icon: 'fa-star', shareText: 'Cuentanos como te fue en Goat Style Salon y deja tu reseña' })}
                </div>
                <div class="list-grid" style="margin-top: 14px;">
                    ${reviews.map(item => `
                        <article class="feed-card">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                                <div>
                                    <h4>${item.clientName}</h4>
                                    <div class="item-meta">${item.barber} · ${formatDateTime(item.createdAt)}</div>
                                </div>
                                <span class="status-pill ${makeStatus(item.status || 'PENDIENTE')}">${item.status || 'PENDIENTE'}</span>
                            </div>
                            <p>${item.text}</p>
                            <div class="form-actions">
                                <button class="action-btn approve" data-review-status="${item.id}:APROBADA">Aceptar</button>
                                <button class="action-btn reject" data-review-status="${item.id}:RECHAZADA">Rechazar</button>
                                <button class="action-btn approve" data-review-edit="${item.id}">Editar</button>
                            </div>
                        </article>
                    `).join('')}
                </div>
            </section>
            <div class="admin-modal-overlay ${formOpen ? 'active' : ''}" id="review-modal">
                <div class="admin-modal-card">
                    <button class="admin-modal-close" type="button" id="close-review-modal"><i class="fas fa-times"></i></button>
                    <div class="section-title">${editing ? 'Editar reseña' : 'Añadir reseña manualmente'}</div>
                    <form id="review-form-admin" class="form-grid">
                        <div class="form-group"><label class="form-label">Cliente</label><input class="form-input" id="review-client-name" value="${escapeAttr(editing?.clientName || '')}" required></div>
                        <div class="form-group"><label class="form-label">Barbero</label><input class="form-input" id="review-barber-name" value="${escapeAttr(editing?.barber || barberName(config.role))}" required></div>
                        <div class="form-group"><label class="form-label">Puntuación</label><input class="form-input" id="review-rating-admin" type="number" min="1" max="5" value="${escapeAttr(editing?.rating || 5)}" required></div>
                        <div class="form-group"><label class="form-label">Estado</label><select class="form-input" id="review-status-admin"><option value="PENDIENTE">Pendiente</option><option value="APROBADA">Aprobada</option><option value="RECHAZADA">Rechazada</option></select></div>
                        <div class="form-group full"><label class="form-label">Texto</label><textarea class="form-input" id="review-text-admin" rows="5" required>${editing?.text || ''}</textarea></div>
                        <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Guardar reseña' : 'Crear reseña'}</button><button class="btn btn-ghost" type="button" id="cancel-review-edit">Cancelar</button></div></div>
                    </form>
                </div>
            </div>
        `;
        document.getElementById('review-status-admin').value = editing?.status || 'APROBADA';
        bindReviewActions();
    }

    function setReviewStatus(review, status) {
        if (window.GabyBooking) {
            window.GabyBooking.setReviewStatus(review, status);
        } else {
            const eligible = review.publishConsent === true || (review.publishConsent == null && !review.appointmentCode);
            if (eligible && review.status !== 'APROBADA' && status === 'APROBADA') review.publishedAt ||= new Date().toISOString();
            review.status = status;
        }
    }

    function bindReviewActions() {
        document.querySelectorAll('[data-review-status]').forEach(button => {
            button.addEventListener('click', () => {
                const [id, status] = button.dataset.reviewStatus.split(':');
                updateDb(db => {
                    const review = db.reviews.find(item => item.id === id);
                    if (review) setReviewStatus(review, status);
                }, `Reseña marcada como ${status}.`);
                renderSection();
            });
        });
        document.querySelectorAll('[data-review-edit]').forEach(button => {
            button.addEventListener('click', () => {
                editingReviewId = button.dataset.reviewEdit;
                renderSection();
            });
        });
        const toggleNew = document.getElementById('toggle-new-review');
        if (toggleNew) toggleNew.addEventListener('click', () => {
            showingNewReview = true;
            renderSection();
        });
        const closeModal = () => {
            editingReviewId = '';
            showingNewReview = false;
            renderSection();
        };
        const closeBtn = document.getElementById('close-review-modal');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        const modalOverlay = document.getElementById('review-modal');
        if (modalOverlay) modalOverlay.addEventListener('click', event => {
            if (event.target === modalOverlay) closeModal();
        });
        const form = document.getElementById('review-form-admin');
        if (form) form.addEventListener('submit', event => {
            event.preventDefault();
            updateDb(db => {
                const payload = {
                    clientName: document.getElementById('review-client-name').value.trim(),
                    barber: document.getElementById('review-barber-name').value.trim(),
                    rating: document.getElementById('review-rating-admin').value,
                    text: document.getElementById('review-text-admin').value.trim(),
                    status: document.getElementById('review-status-admin').value
                };
                if (editingReviewId) {
                    const review = db.reviews.find(item => item.id === editingReviewId);
                    if (review) {
                        setReviewStatus(review, payload.status);
                        Object.assign(review, payload);
                    }
                } else {
                    const review = { ...payload, id: window.GabyData.makeId('review'), createdAt: new Date().toISOString(), status: 'PENDIENTE' };
                    setReviewStatus(review, payload.status);
                    db.reviews.unshift(review);
                }
            });
            editingReviewId = '';
            showingNewReview = false;
            renderSection();
        });
        const cancel = document.getElementById('cancel-review-edit');
        if (cancel) cancel.addEventListener('click', () => {
            editingReviewId = '';
            showingNewReview = false;
            renderSection();
        });
    }

    function renderAppointmentsSection() {
        const appointments = getAppointments();
        const selectedClient = selectedClientId ? getClientById(selectedClientId) : null;
        document.getElementById('admin-section-content').innerHTML = `
            <div class="two-col">
                <section class="card">
                    <div class="section-title">Citas</div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Código</th><th>Cliente</th><th>Servicio</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead>
                            <tbody>
                                ${appointments.map(item => `
                                    <tr>
                                        <td>${item.code}</td>
                                        <td>${item.client}</td>
                                        <td>${item.service}</td>
                                        <td>${formatDateTime(item.dateTime)}</td>
                                        <td><span class="status-pill ${makeStatus(item.status)}">${item.status}</span></td>
                                        <td>
                                            <div class="appointment-action-stack">
                                                <div class="appointment-quick-actions">
                                                    <button class="action-btn approve" data-appointment-status="${item.code}:APROBADA">Aceptar</button>
                                                    <button class="action-btn reject" data-appointment-status="${item.code}:RECHAZADA">Rechazar</button>
                                                    <button class="action-btn pending" data-appointment-status="${item.code}:PENDIENTE">Pendiente</button>
                                                </div>
                                                <div class="appointment-extra-actions">
                                                    <button class="action-btn approve" data-appointment-edit="${item.code}">Editar</button>
                                                    <button class="action-btn reject" data-appointment-client="${item.code}">Ver cliente</button>
                                                    <button class="action-btn notify" data-appointment-notify="${item.code}">Notificar cliente</button>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>
                <section class="card">
                    <div class="section-title">Gestión de cita</div>
                    ${renderAppointmentSide(selectedClient)}
                </section>
            </div>
        `;
        bindAppointmentActions();
    }

    function renderAppointmentSide(client) {
        const appointment = editingAppointmentCode ? getAppointmentByCode(editingAppointmentCode) : null;
        const appointmentForClient = viewingAppointmentCode ? getAppointmentByCode(viewingAppointmentCode) : null;
        if (appointment) {
            return `
                <form id="appointment-form" class="form-grid">
                    <div class="form-group"><label class="form-label">Servicio</label><input class="form-input" id="appointment-service" value="${escapeAttr(appointment.service)}"></div>
                    <div class="form-group"><label class="form-label">Fecha</label><input class="form-input" id="appointment-date" type="datetime-local" value="${escapeAttr(appointment.dateTime)}"></div>
                    <div class="form-group"><label class="form-label">Estado</label><select class="form-input" id="appointment-status"><option value="PENDIENTE">Pendiente</option><option value="APROBADA">Aprobada</option><option value="RECHAZADA">Rechazada</option><option value="CANCELADA">Cancelada</option></select></div>
                    <div class="form-group"><label class="form-label">Barbero</label><select class="form-input" id="appointment-barber">${getBarbers().map(barber => `<option value="${barber.id}" ${barber.id === appointment.barber ? 'selected' : ''}>${barberLabel(barber)}</option>`).join('')}</select></div>
                    <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">Guardar cita</button><button class="btn btn-ghost" type="button" id="cancel-appointment-edit">Cancelar</button><button class="btn btn-ghost" type="button" id="notify-appointment-client">Notificar cliente</button></div></div>
                </form>
            `;
        }
        if (client) return renderClientDetails(client);
        if (appointmentForClient) {
            return `
                <div class="list-grid">
                    <div class="mini-card"><strong>${appointmentForClient.client}</strong><div class="item-meta" style="margin-top: 8px;">Teléfono: ${client?.phone || 'No registrado'}</div><div class="item-meta" style="margin-top: 8px;">Barbero: ${barberName(appointmentForClient.barber)}</div></div>
                    <div class="mini-card"><strong>Cita seleccionada</strong><div class="item-meta" style="margin-top: 8px;">${appointmentForClient.service}</div><div class="item-meta" style="margin-top: 8px;">${formatDateTime(appointmentForClient.dateTime)}</div><div class="item-meta" style="margin-top: 8px;">Estado ${appointmentForClient.status}</div></div>
                    <div class="mini-card"><strong>Código</strong><div class="item-meta" style="margin-top: 8px;">${appointmentForClient.code}</div><div class="item-meta" style="margin-top: 8px;">Cliente sin perfil completo, pero la cita sigue visible.</div></div>
                </div>
            `;
        }
        return '<div class="empty">Usa "Ver cliente" o "Editar" para gestionar una cita.</div>';
    }

    function bindAppointmentActions() {
        document.querySelectorAll('[data-appointment-edit]').forEach(button => {
            button.addEventListener('click', () => {
                editingAppointmentCode = button.dataset.appointmentEdit;
                viewingAppointmentCode = '';
                selectedClientId = '';
                renderSection();
            });
        });
        document.querySelectorAll('[data-appointment-client]').forEach(button => {
            button.addEventListener('click', () => {
                viewingAppointmentCode = button.dataset.appointmentClient;
                const client = getClientFromAppointment(viewingAppointmentCode);
                selectedClientId = client?.id || '';
                editingAppointmentCode = '';
                renderSection();
            });
        });
        document.querySelectorAll('[data-appointment-notify]').forEach(button => {
            button.addEventListener('click', () => {
                notifyAppointmentClient(button.dataset.appointmentNotify);
            });
        });
        document.querySelectorAll('[data-appointment-status]').forEach(button => {
            button.addEventListener('click', () => {
                const [code, status] = button.dataset.appointmentStatus.split(':');
                updateDb(db => {
                    const appointment = db.appointments.find(item => item.code === code);
                    if (!appointment) return;
                    appointment.status = status;
                    appointment.barberName = barberName(appointment.barber);
                }, `Cita ${code} marcada como ${status}.`);
                renderSection();
            });
        });
        const form = document.getElementById('appointment-form');
        if (form) {
            const appointment = getAppointmentByCode(editingAppointmentCode);
            document.getElementById('appointment-status').value = appointment?.status || 'PENDIENTE';
            form.addEventListener('submit', event => {
                event.preventDefault();
                updateDb(db => {
                    const target = db.appointments.find(item => item.code === editingAppointmentCode);
                    if (!target) return;
                    target.service = document.getElementById('appointment-service').value.trim();
                    target.dateTime = document.getElementById('appointment-date').value;
                    target.status = document.getElementById('appointment-status').value;
                    target.barber = document.getElementById('appointment-barber').value;
                    target.barberName = barberName(target.barber);
                });
                editingAppointmentCode = '';
                renderSection();
            });
            document.getElementById('cancel-appointment-edit').addEventListener('click', () => {
                editingAppointmentCode = '';
                renderSection();
            });
            const notifyButton = document.getElementById('notify-appointment-client');
            if (notifyButton) {
                notifyButton.addEventListener('click', () => {
                    notifyAppointmentClient(editingAppointmentCode);
                });
            }
        }
    }

    function renderCalendar() {
        const appointments = getAppointments().slice().sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        document.getElementById('admin-section-content').innerHTML = `
            <section class="card">
                <div class="section-title">Calendario</div>
                <div class="list-grid">
                    ${appointments.length ? appointments.map(item => `
                        <div class="mini-card">
                            <strong>${formatDateTime(item.dateTime)}</strong>
                            <div class="item-meta" style="margin-top: 8px;">${item.client} · ${item.service}</div>
                            <div class="item-meta" style="margin-top: 8px;">${barberName(item.barber)} · ${item.status}</div>
                        </div>
                    `).join('') : '<div class="empty">No hay eventos en calendario.</div>'}
                </div>
            </section>
        `;
    }

    function renderServicesSection() {
        const services = getServices();
        const editing = services.find(item => item.id === editingServiceId);
        const formOpen = Boolean(editing) || showingNewService;
        document.getElementById('admin-section-content').innerHTML = `
            <section class="card">
                <div class="section-title-row">
                    <div class="section-title">Servicios</div>
                    <button class="btn btn-primary" type="button" id="toggle-new-service">+ Añadir servicio</button>
                </div>
                <div class="grid-cards">
                    ${services.map(item => `
                        <div class="mini-card">
                            <strong>${item.name}</strong>
                            <div class="item-meta" style="margin-top: 8px;">${item.price} · ${item.duration}</div>
                            <div class="item-meta" style="margin-top: 8px;">Solicitudes ${item.requests || 0}</div>
                            <div class="form-actions">
                                <button class="action-btn approve" data-service-edit="${item.id}">Editar</button>
                                <button class="action-btn approve" data-service-toggle="${item.id}">${item.active ? 'Desactivar' : 'Activar'}</button>
                                <button class="action-btn reject" data-service-delete="${item.id}">Eliminar</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </section>
            <div class="admin-modal-overlay ${formOpen ? 'active' : ''}" id="service-modal">
                <div class="admin-modal-card">
                    <button class="admin-modal-close" type="button" id="close-service-modal"><i class="fas fa-times"></i></button>
                    <div class="section-title">${editing ? 'Editar servicio' : 'Añadir servicio'}</div>
                    <form id="service-form" class="form-grid">
                        <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="service-name" value="${escapeAttr(editing?.name || '')}" required></div>
                        <div class="form-group"><label class="form-label">Precio</label><input class="form-input" id="service-price" value="${escapeAttr(editing?.price || '')}" required></div>
                        <div class="form-group"><label class="form-label">Duración</label><input class="form-input" id="service-duration" value="${escapeAttr(editing?.duration || '')}" required></div>
                        <div class="form-group"><label class="form-label">Solicitudes</label><input class="form-input" id="service-requests" type="number" value="${escapeAttr(editing?.requests || 0)}"></div>
                        <div class="form-group full"><label class="form-label">Descripción</label><textarea class="form-input" id="service-description" rows="4">${editing?.description || ''}</textarea></div>
                        <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Guardar servicio' : 'Crear servicio'}</button><button class="btn btn-ghost" type="button" id="cancel-service-edit">Cancelar</button></div></div>
                    </form>
                </div>
            </div>
        `;
        bindServiceActions();
    }

    function bindServiceActions() {
        document.querySelectorAll('[data-service-edit]').forEach(button => button.addEventListener('click', () => {
            editingServiceId = button.dataset.serviceEdit;
            renderSection();
        }));
        document.querySelectorAll('[data-service-toggle]').forEach(button => button.addEventListener('click', () => {
            updateDb(db => {
                const service = db.services.find(item => item.id === button.dataset.serviceToggle);
                if (service) service.active = !service.active;
            });
            renderSection();
        }));
        document.querySelectorAll('[data-service-delete]').forEach(button => button.addEventListener('click', () => {
            updateDb(db => {
                db.services = db.services.filter(item => item.id !== button.dataset.serviceDelete);
            });
            renderSection();
        }));
        const toggleNew = document.getElementById('toggle-new-service');
        if (toggleNew) toggleNew.addEventListener('click', () => {
            showingNewService = true;
            renderSection();
        });
        const closeServiceModal = () => {
            editingServiceId = '';
            showingNewService = false;
            renderSection();
        };
        const closeServiceBtn = document.getElementById('close-service-modal');
        if (closeServiceBtn) closeServiceBtn.addEventListener('click', closeServiceModal);
        const serviceOverlay = document.getElementById('service-modal');
        if (serviceOverlay) serviceOverlay.addEventListener('click', event => {
            if (event.target === serviceOverlay) closeServiceModal();
        });
        const form = document.getElementById('service-form');
        if (form) form.addEventListener('submit', event => {
            event.preventDefault();
            updateDb(db => {
                const payload = {
                    name: document.getElementById('service-name').value.trim(),
                    price: document.getElementById('service-price').value.trim(),
                    duration: document.getElementById('service-duration').value.trim(),
                    description: document.getElementById('service-description').value.trim(),
                    requests: Number(document.getElementById('service-requests').value || 0),
                    active: editingServiceId ? db.services.find(item => item.id === editingServiceId)?.active !== false : true
                };
                if (editingServiceId) {
                    const service = db.services.find(item => item.id === editingServiceId);
                    if (service) Object.assign(service, payload);
                } else {
                    db.services.push({ id: window.GabyData.makeId('service'), ...payload });
                }
            });
            editingServiceId = '';
            showingNewService = false;
            renderSection();
        });
        const cancel = document.getElementById('cancel-service-edit');
        if (cancel) cancel.addEventListener('click', () => {
            editingServiceId = '';
            showingNewService = false;
            renderSection();
        });
    }

    function renderNewsSection(target) {
        const news = getNews();
        const editing = news.find(item => item.id === editingNewsId);
        const formOpen = Boolean(editing) || showingNewNews;
        target.innerHTML = `
            <section class="card">
                <div class="section-title-row">
                    <div class="section-title">Noticias de la barbería</div>
                    <button class="btn btn-primary" type="button" id="toggle-new-news">+ Nueva noticia</button>
                </div>
                <div class="list-grid">
                    ${news.map(item => `
                        <article class="feed-card">
                            <h4>${item.title}</h4>
                            <div class="item-meta">${item.authorName} · ${formatDateTime(item.createdAt)}</div>
                            ${item.image ? `<img src="${item.image}" alt="${item.title}" style="width: 100%; margin-top: 12px; border-radius: 16px; max-height: 220px; object-fit: cover;">` : ''}
                            <p style="margin-top: 12px;">${item.body}</p>
                            <div class="form-actions">
                                <button class="action-btn approve" data-news-edit="${item.id}">Editar</button>
                                <button class="action-btn reject" data-news-delete="${item.id}">Eliminar</button>
                            </div>
                        </article>
                    `).join('')}
                </div>
            </section>
            <div class="admin-modal-overlay ${formOpen ? 'active' : ''}" id="news-modal">
                <div class="admin-modal-card">
                    <button class="admin-modal-close" type="button" id="close-news-modal"><i class="fas fa-times"></i></button>
                    <div class="section-title">${editing ? 'Editar noticia' : 'Nueva noticia'}</div>
                    <form id="news-form" class="form-grid">
                        <div class="form-group"><label class="form-label">Titulo</label><input class="form-input" id="news-title" value="${escapeAttr(editing?.title || '')}" required></div>
                        <div class="form-group"><label class="form-label">Link de imagen</label><input class="form-input" id="news-image-link" value="${escapeAttr(editing?.image || '')}" placeholder="https://res.cloudinary.com/..."></div>
                        <div class="form-group full"><label class="form-label">Subir imagen desde celular</label><input class="form-input" id="news-image-file" type="file" accept="image/*"></div>
                        <div class="form-group full"><label class="form-label">Contenido</label><textarea class="form-input" id="news-body" rows="5" required>${editing?.body || ''}</textarea></div>
                        <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Guardar noticia' : 'Publicar noticia'}</button><button class="btn btn-ghost" type="button" id="cancel-news-edit">Cancelar</button></div></div>
                    </form>
                </div>
            </div>
        `;
        bindNewsActions();
    }

    function bindNewsActions() {
        document.querySelectorAll('[data-news-edit]').forEach(button => button.addEventListener('click', () => {
            editingNewsId = button.dataset.newsEdit;
            renderSection();
        }));
        document.querySelectorAll('[data-news-delete]').forEach(button => button.addEventListener('click', () => {
            updateDb(db => {
                db.news = db.news.filter(item => item.id !== button.dataset.newsDelete);
            });
            renderSection();
        }));
        const toggleNew = document.getElementById('toggle-new-news');
        if (toggleNew) toggleNew.addEventListener('click', () => {
            showingNewNews = true;
            renderSection();
        });
        const closeNewsModal = () => {
            editingNewsId = '';
            showingNewNews = false;
            renderSection();
        };
        const closeNewsBtn = document.getElementById('close-news-modal');
        if (closeNewsBtn) closeNewsBtn.addEventListener('click', closeNewsModal);
        const newsOverlay = document.getElementById('news-modal');
        if (newsOverlay) newsOverlay.addEventListener('click', event => {
            if (event.target === newsOverlay) closeNewsModal();
        });
        const newsForm = document.getElementById('news-form');
        if (newsForm) newsForm.addEventListener('submit', event => {
            event.preventDefault();
            const save = image => {
                updateDb(db => {
                    const barber = db.barbers.find(item => item.id === config.role) || db.barbers[0];
                    const payload = {
                        title: document.getElementById('news-title').value.trim(),
                        body: document.getElementById('news-body').value.trim(),
                        image,
                        authorId: barber.id,
                        authorName: barberLabel(barber),
                        role: barber.isAdmin ? 'Admin General' : 'Barbero',
                        likes: editingNewsId ? db.news.find(item => item.id === editingNewsId)?.likes || 0 : 0,
                        comments: editingNewsId ? db.news.find(item => item.id === editingNewsId)?.comments || 0 : 0
                    };
                    if (editingNewsId) {
                        const news = db.news.find(item => item.id === editingNewsId);
                        if (news) Object.assign(news, payload);
                    } else {
                        db.news.unshift({ id: window.GabyData.makeId('news'), createdAt: new Date().toISOString(), ...payload });
                    }
                    if (payload.body.toLowerCase().includes('cerrada')) db.settings.closureNotice = payload.body;
                });
                editingNewsId = '';
                showingNewNews = false;
                renderSection();
            };
            const file = document.getElementById('news-image-file').files[0];
            const link = document.getElementById('news-image-link').value.trim();
            if (file) {
                const reader = new FileReader();
                reader.onload = () => save(reader.result);
                reader.readAsDataURL(file);
                return;
            }
            save(link);
        });
        const cancel = document.getElementById('cancel-news-edit');
        if (cancel) cancel.addEventListener('click', () => {
            editingNewsId = '';
            showingNewNews = false;
            renderSection();
        });
    }

    function renderSettingsSection() {
        const barber = getDb().barbers.find(item => item.id === config.role) || getDb().barbers[0];
        document.getElementById('admin-section-content').innerHTML = `
            <section class="card">
                <div class="section-title">Configuración de la página principal</div>
                <div class="mini-card" style="margin-bottom: 18px;">
                    <strong>Regresar</strong>
                    <div class="item-meta" style="margin-top: 8px;">Usa este boton para volver rápido a la página principal.</div>
                    <div class="form-actions" style="justify-content: flex-start;">
                        <a class="btn btn-primary btn-back-home" href="../../index.html">Regresar a la página principal</a>
                    </div>
                </div>
                <form id="settings-form" class="form-grid">
                    <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="settings-name" value="${escapeAttr(barber.name)}"></div>
                    <div class="form-group"><label class="form-label">Alias</label><input class="form-input" id="settings-alias" value="${escapeAttr(barber.alias)}"></div>
                    <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="settings-phone" value="${escapeAttr(barber.phone)}"></div>
                    <div class="form-group"><label class="form-label">Horario</label><input class="form-input" id="settings-schedule" value="${escapeAttr(barber.schedule || '')}"></div>
                    <div class="form-group"><label class="form-label">Instagram</label><input class="form-input" id="settings-instagram" value="${escapeAttr(barber.socials?.instagram || '')}"></div>
                    <div class="form-group"><label class="form-label">Facebook</label><input class="form-input" id="settings-facebook" value="${escapeAttr(barber.socials?.facebook || '')}"></div>
                    <div class="form-group full"><label class="form-label">Biografía</label><textarea class="form-input" id="settings-bio" rows="4">${barber.bio || ''}</textarea></div>
                    <div class="form-group full"><label class="form-label">Aviso principal</label><textarea class="form-input" id="settings-closure" rows="3">${getDb().settings.closureNotice || ''}</textarea></div>
                    <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">Guardar configuración</button></div></div>
                </form>
            </section>
        `;
        document.getElementById('settings-form').addEventListener('submit', event => {
            event.preventDefault();
            updateDb(db => {
                const target = db.barbers.find(item => item.id === config.role) || db.barbers[0];
                target.name = document.getElementById('settings-name').value.trim();
                target.alias = document.getElementById('settings-alias').value.trim();
                target.phone = document.getElementById('settings-phone').value.trim();
                target.schedule = document.getElementById('settings-schedule').value.trim();
                target.bio = document.getElementById('settings-bio').value.trim();
                target.socials = {
                    instagram: document.getElementById('settings-instagram').value.trim(),
                    facebook: document.getElementById('settings-facebook').value.trim()
                };
                db.settings.closureNotice = document.getElementById('settings-closure').value.trim();
            });
            renderSection();
        });
    }

    function renderProfileSection() {
        const barbers = getBarbers();
        const editing = barbers.find(item => item.id === editingBarberId);
        const formOpen = Boolean(editing) || showingNewBarber;
        document.getElementById('admin-section-content').innerHTML = `
            <section class="card">
                <div class="section-title-row">
                    <div class="section-title">Barberos y logins</div>
                    ${isAdmin() ? `<button class="btn btn-primary" type="button" id="toggle-new-barber">+ Añadir barbero</button>` : ''}
                </div>
                ${isAdmin() ? '' : '<div class="empty">Solo el admin general puede modificar la lista de barberos.</div>'}
                <div class="grid-cards">
                    ${barbers.map(barber => `
                        <div class="mini-card">
                            <strong>${barber.name}</strong>
                            <div class="item-meta" style="margin-top: 8px;">${barber.email}</div>
                            <div class="item-meta" style="margin-top: 8px;">${barber.phone}</div>
                            <div class="item-meta" style="margin-top: 8px;">${barber.bio}</div>
                            <div class="form-actions">
                                <button class="action-btn approve" data-barber-edit="${barber.id}">Editar</button>
                                ${isAdmin() ? `<button class="action-btn reject" data-barber-delete="${barber.id}">Eliminar</button>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </section>
            ${isAdmin() ? `
                <div class="admin-modal-overlay ${formOpen ? 'active' : ''}" id="barber-modal">
                    <div class="admin-modal-card">
                        <button class="admin-modal-close" type="button" id="close-barber-modal"><i class="fas fa-times"></i></button>
                        <div class="section-title">${editing ? 'Editar barbero' : 'Añadir barbero'}</div>
                        <form id="barber-form" class="form-grid">
                            <div class="form-group"><label class="form-label">Nombre completo</label><input class="form-input" id="barber-name" value="${escapeAttr(editing?.name || '')}" required></div>
                            <div class="form-group"><label class="form-label">Alias</label><input class="form-input" id="barber-alias" value="${escapeAttr(editing?.alias || '')}"></div>
                            <div class="form-group"><label class="form-label">Correo login</label><input class="form-input" id="barber-email" value="${escapeAttr(editing?.email || '')}" required></div>
                            <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="barber-phone" value="${escapeAttr(editing?.phone || '')}" required></div>
                            <div class="form-group full"><label class="form-label">Biografía</label><textarea class="form-input" id="barber-bio" rows="4">${editing?.bio || ''}</textarea></div>
                            <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">${editing ? 'Guardar barbero' : 'Crear barbero'}</button><button class="btn btn-ghost" type="button" id="cancel-barber-edit">Cancelar</button></div></div>
                        </form>
                    </div>
                </div>
            ` : ''}
        `;
        bindProfileActions();
    }

    function bindProfileActions() {
        document.querySelectorAll('[data-barber-edit]').forEach(button => button.addEventListener('click', () => {
            editingBarberId = button.dataset.barberEdit;
            renderSection();
        }));
        document.querySelectorAll('[data-barber-delete]').forEach(button => button.addEventListener('click', () => {
            updateDb(db => {
                db.barbers = db.barbers.filter(item => item.id !== button.dataset.barberDelete);
            });
            renderSection();
        }));
        const toggleNew = document.getElementById('toggle-new-barber');
        if (toggleNew) toggleNew.addEventListener('click', () => {
            showingNewBarber = true;
            renderSection();
        });
        const closeBarberModal = () => {
            editingBarberId = '';
            showingNewBarber = false;
            renderSection();
        };
        const closeBarberBtn = document.getElementById('close-barber-modal');
        if (closeBarberBtn) closeBarberBtn.addEventListener('click', closeBarberModal);
        const barberOverlay = document.getElementById('barber-modal');
        if (barberOverlay) barberOverlay.addEventListener('click', event => {
            if (event.target === barberOverlay) closeBarberModal();
        });
        const form = document.getElementById('barber-form');
        if (!form) return;
        form.addEventListener('submit', event => {
            event.preventDefault();
            updateDb(db => {
                const payload = {
                    name: document.getElementById('barber-name').value.trim(),
                    alias: document.getElementById('barber-alias').value.trim(),
                    email: document.getElementById('barber-email').value.trim(),
                    phone: document.getElementById('barber-phone').value.trim(),
                    bio: document.getElementById('barber-bio').value.trim()
                };
                if (editingBarberId) {
                    const barber = db.barbers.find(item => item.id === editingBarberId);
                    if (barber) Object.assign(barber, payload);
                } else {
                    db.barbers.push({
                        id: (payload.alias || payload.name).toLowerCase().replace(/\s+/g, ''),
                        specialty: [],
                        avatar: 'https://i.pravatar.cc/200?img=18',
                        isAdmin: false,
                        yearsExperience: 1,
                        vipClients: 0,
                        schedule: '8AM - 6PM',
                        socials: {},
                        gallery: [],
                        ...payload
                    });
                }
            });
            editingBarberId = '';
            showingNewBarber = false;
            renderSection();
        });
        const cancel = document.getElementById('cancel-barber-edit');
        if (cancel) cancel.addEventListener('click', () => {
            editingBarberId = '';
            showingNewBarber = false;
            renderSection();
        });
    }

    // Contexto que reciben las secciones de admin-pro.js
    function proContext() {
        return {
            config,
            isAdmin,
            getDb,
            commit: (mutator, messages) => window.GabyData.commit(mutator, messages),
            rerender: () => renderSection(),
            go: id => goToSection(id),
            logout: staffLogout,
            barberLabel,
            barberName,
            actorName: barberName(config.role),
            calculateAge,
            renderBarberDirectLinks,
            notifyAppointmentClient,
            openCrm: clientId => {
                const client = getClientById(clientId);
                if (!client) return;
                const params = new URLSearchParams({ id: client.id, name: client.name || '', phone: client.phone || '', email: client.email || '', birthDate: client.birthDate || '', barber: client.preferredBarber || 'gabriel' });
                window.open(`../../crm/dist/index.html?${params.toString()}`, `crm_${client.id}`, 'width=1400,height=900');
            },
            renderReviewLink: () => `<div class="direct-links">${renderDirectLinkCard({ title: 'Link para pedir reseñas', description: 'Envíalo después del servicio: el cliente escribe su nombre, el servicio y su opinión. Tú la publicas desde aquí.', path: '../../index.html#resenas', icon: 'fa-star', shareText: 'Cuéntanos cómo te fue y deja tu reseña' })}</div>`,
            bindReviewLink: () => {}
        };
    }

    function navBadge(sectionId) {
        if (!window.GabyAdminPro || !window.GabyBooking) return '';
        const count = window.GabyAdminPro.badge(sectionId, proContext());
        return count ? `<span class="ap-nav-badge">${count}</span>` : '';
    }

    const businessOpen = { reports: false, news: false };

    function appendBusinessSections() {
        const page = document.getElementById('admin-section-content');
        for (const [id, label] of [['reports', 'Reportes'], ['news', 'Noticias']]) {
            const details = document.createElement('details');
            details.className = 'card ap-business-section';
            details.open = businessOpen[id];
            details.innerHTML = '<summary class="section-title">' + label + '</summary><div></div>';
            details.addEventListener('toggle', () => { businessOpen[id] = details.open; });
            page.appendChild(details);
            const panel = details.lastElementChild;
            if (id === 'reports') window.GabyAdminPro.renderReports(proContext(), panel);
            else renderNewsSection(panel);
        }
    }

    function renderSection() {
        // Si el dibujo de una sección falla (datos incompletos, por ejemplo),
        // se muestra un aviso en vez de dejar la sección anterior en pantalla
        // como si nada hubiera pasado: el usuario ve que algo falló y puede reintentar.
        try {
            if (window.GabyAdminPro && window.GabyAdminPro.has(currentSection)) {
                window.GabyAdminPro.render(currentSection, proContext());
                if (currentSection === 'inventory') appendBusinessSections();
            } else {
                const renderers = {
                    dashboard: renderDashboard,
                    clients: renderClients,
                    reviews: renderReviewsSection,
                    appointments: renderAppointmentsSection,
                    calendar: renderCalendar,
                    services: renderServicesSection,
                    settings: renderSettingsSection,
                    profile: renderProfileSection
                };
                renderers[currentSection]();
            }
        } catch (error) {
            console.error('[Panel] No se pudo mostrar la sección:', error);
            const host = document.getElementById('admin-section-content');
            if (host) {
                host.innerHTML = `<section class="card"><div class="section-title">No se pudo mostrar esta sección</div><p class="item-meta">Intenta de nuevo: vuelve a tocar la sección en el menú. Si sigue pasando, recarga la página.</p><div class="form-actions"><button class="btn btn-primary" type="button" data-retry-section>Reintentar</button></div></section>`;
                host.querySelector('[data-retry-section]')?.addEventListener('click', () => renderSection());
            }
        }
        addRequiredLegends();
        renderCancellationAlertBanner();
        window.setTimeout(showCancellationAlertPopup, 80);
    }

    // Si llega un cambio mientras el dedo o el mouse esta presionando un boton, se espera a soltarlo:
    // redibujar en ese momento borraba el boton y el clic se perdia.
    let pointerIsDown = false;
    let refreshPending = false;
    document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
    ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, () => {
        pointerIsDown = false;
        if (refreshPending) window.setTimeout(() => { if (!pointerIsDown && refreshPending) handleRealtimeAdminUpdate(); }, 120);
    }, true));

    function handleRealtimeAdminUpdate() {
        // Solo se redibuja si el panel esta abierto (no sobre la pantalla de "Inicia sesión").
        if (!document.querySelector('.admin-shell')) return;
        if (pointerIsDown) { refreshPending = true; return; }
        refreshPending = false;
        refreshPanel();

    }

    window.addEventListener('gabydatachange', handleRealtimeAdminUpdate);
    window.addEventListener('focus', () => window.setTimeout(showCancellationAlertPopup, 80));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) window.setTimeout(showCancellationAlertPopup, 80); });
    window.addEventListener('storage', event => {
        if (event.key === 'gs_crm') {
            handleRealtimeAdminUpdate();
        }
    });

    window.setInterval(() => {
        const pendingAlert = getPendingCancellationAlert();
        const overlay = document.getElementById('cancellation-alert-modal');
        if (pendingAlert && overlay && !overlay.classList.contains('active')) {
            showCancellationAlertPopup();
        }
    }, 1500);

    function renderStaffLoginRequired() {
        app.innerHTML = `
            <div style="min-height: 100vh; display: grid; place-items: center; padding: 24px;">
                <div class="card" style="max-width: 460px; text-align: center; display: grid; gap: 14px;">
                    <div class="section-title">Inicia sesión</div>
                    <p class="item-meta">Para entrar a este panel debes iniciar sesión con tu cuenta del personal.</p>
                    <a class="btn btn-primary" href="../../index.html">Ir al inicio de sesión</a>
                </div>
            </div>
        `;
    }

    // Sesion local del personal (security.js). Con Supabase la sesion la valida GabyCloud.
    function currentStaffSession() {
        return window.GabySecurity ? window.GabySecurity.getStaffSession() : null;
    }

    function staffSessionAllowed() {
        const session = currentStaffSession();
        if (!session) return false;
        if (session.isAdmin) return true;
        return !isAdmin() && session.barberId === config.role;
    }

    async function start() {
        if (window.GabyCloud && window.GabyCloud.enabled) {
            const allowed = await window.GabyCloud.requireStaff(config.role, isAdmin());
            if (!allowed) {
                renderStaffLoginRequired();
                return;
            }
        } else if (!staffSessionAllowed()) {
            renderStaffLoginRequired();
            return;
        }
        renderShell();
        renderSection();
        const entry = new URLSearchParams(window.location.search);
        const requestedSection = entry.get('section');
        const section = ['products', 'providers', 'reports', 'news'].includes(requestedSection) ? 'inventory'
            : requestedSection === 'mode' ? 'dashboard' : requestedSection;
        if (requestedSection === 'reports' || requestedSection === 'news') businessOpen[requestedSection] = true;
        if (section && window.GabyAdminPro?.has(section)) {
            goToSection(section);
            if (section === 'appointments' && entry.get('action') === 'new') {
                const clientId = entry.get('client');
                const client = getDb().clients.find(item => item.id === clientId);
                if (client) window.GabyAdminPro.openNewAppointment(proContext(), { clientId: client.id });
                window.history.replaceState(null, '', window.location.pathname);
            }
        }
    }

    // Si la cuenta se bloquea o la sesion vence mientras el panel esta abierto, se cierra el acceso.
    window.setInterval(() => {
        if (window.GabyCloud && window.GabyCloud.enabled) return;
        if (!staffSessionAllowed() && document.querySelector('.admin-shell')) renderStaffLoginRequired();
    }, 30000);

    start();
})();
































