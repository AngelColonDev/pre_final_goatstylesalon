(function () {
    // =========================================================================
    // GabyAdminPro: secciones del panel para el sistema de citas.
    // Inicio (con tu disponibilidad), Calendario (dia/semana/mes), Citas, Clientes (con transferencia
    // a otro barbero), Servicios, Horarios, Resenas, Inventario (productos, materiales y proveedores),
    // Reportes, Notificaciones y Configuracion.
    // shared-admin.js le pasa un "ctx" con los datos de la sesion y utilidades.
    // Roles: cada panel es de un barbero (gabriel, darialex o wilo) y ve solo sus
    // propias citas, aunque sea administrador general; una cita transferida
    // aparece en la lista del barbero nuevo, no en la del anterior.
    // =========================================================================
    const B = () => window.GabyBooking;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const content = () => document.getElementById('admin-section-content');
    const today = () => B().dateKey(new Date());
    const ui = {
        calView: 'week', calDate: null, calBarber: 'all',
        apptQuick: 'today', apptBarber: 'all', apptService: 'all', apptStatus: 'all', apptSearch: '',
        clientSearch: '', clientId: null, scheduleBarber: null, reportRange: '30', reportBarber: 'all', reportFrom: '', reportTo: '',
        reviewFilter: 'all', search: '',
        notifyTitle: '', notifyBody: '', notifyMode: 'one', notifyCode: '', notifySelect: '',
        transferFilter: 'pending'
    };

    // ---------------------------------------------------------------------
    // Utilidades
    // ---------------------------------------------------------------------
    const statusBadge = status => `<span class="ap-status ap-s-${esc(status)}">${esc(B().statusLabel(status))}</span>`;
    const timeOf = appointment => B().formatTime(String(appointment.dateTime).slice(11, 16));
    const dayOf = appointment => String(appointment.dateTime || '').slice(0, 10);
    const fmtDateTime = appointment => `${B().formatDate(dayOf(appointment), { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeOf(appointment)}`;
    const fmtStamp = iso => iso ? new Date(iso).toLocaleString('es-PR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

    // Cada panel es de un barbero (gabriel, darialex o wilo): cada uno ve solo
    // sus propias citas, aunque sea administrador general. Una cita transferida
    // aparece en la lista del barbero nuevo, no en la del anterior.
    function isBarberRole(ctx) {
        return (ctx.getDb().barbers || []).some(b => b.id === ctx.config.role);
    }

    function scopedAppointments(ctx) {
        const list = ctx.getDb().appointments || [];
        return isBarberRole(ctx) ? list.filter(item => item.barber === ctx.config.role) : list;
    }

    function scopedClients(ctx) {
        const db = ctx.getDb();
        if (ctx.isAdmin()) return db.clients;
        const ids = new Set(scopedAppointments(ctx).map(item => item.clientId));
        return db.clients.filter(client => ids.has(client.id) || client.preferredBarber === ctx.config.role);
    }

    function barberOptions(ctx, selected, includeAll) {
        const db = ctx.getDb();
        const list = ctx.isAdmin() ? db.barbers : db.barbers.filter(b => b.id === ctx.config.role);
        return `${includeAll && ctx.isAdmin() ? `<option value="all" ${selected === 'all' ? 'selected' : ''}>Todos los barberos</option>` : ''}${list.map(b => `<option value="${b.id}" ${selected === b.id ? 'selected' : ''}>${esc(ctx.barberLabel(b))}</option>`).join('')}`;
    }

    function openModal(html, onClose) {
        const overlay = document.createElement('div');
        overlay.className = 'admin-modal-overlay active';
        overlay.innerHTML = `<div class="admin-modal-card" role="dialog" aria-modal="true"><button class="admin-modal-close" type="button" aria-label="Cerrar"><i class="fas fa-times"></i></button>${html}</div>`;
        document.body.appendChild(overlay);
        const close = () => { overlay.remove(); if (onClose) onClose(); };
        overlay.querySelector('.admin-modal-close').addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        return { el: overlay.querySelector('.admin-modal-card'), close };
    }

    function contactButtons(phone, email) {
        const digits = String(phone || '').replace(/\D/g, '');
        const intl = digits.length === 10 ? `1${digits}` : digits;
        return `${intl ? `<a class="action-btn approve" href="tel:+${intl}">Llamar</a><a class="action-btn notify" href="https://wa.me/${intl}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${email ? `<a class="action-btn approve" href="mailto:${esc(email)}">Correo</a>` : ''}`;
    }

    function bars(entries, max) {
        if (!entries.length) return '<div class="empty">Sin datos en este periodo.</div>';
        const top = Math.max(...entries.map(e => e[1]), 1);
        return `<div class="ap-bars">${entries.slice(0, max || 10).map(([label, value]) => `<div class="ap-bar"><span>${esc(label)}</span><div class="ap-bar-track"><div class="ap-bar-fill" style="width:${Math.round(value / top * 100)}%"></div></div><b>${value}</b></div>`).join('')}</div>`;
    }

    // ---------------------------------------------------------------------
    // Detalle de cita (lo usan Calendario, Citas, Dashboard y Clientes)
    // ---------------------------------------------------------------------
    function openAppointment(ctx, code, options) {
        const db = ctx.getDb();
        const a = db.appointments.find(item => item.code === code);
        if (!a) return;
        const client = db.clients.find(c => c.id === a.clientId);
        const grace = Number(db.settings.booking.graceMinutes) || 0;
        const start = B().parseLocal(a.dateTime);
        const late = B().ACTIVE.includes(a.status) && start && Date.now() > start.getTime() + grace * 60000;
        const active = B().ACTIVE.includes(a.status);
        const transferPending = B().pendingTransferRequest(db, a.code);
        const transferAccepted = B().acceptedTransferRequest(db, a.code);
        const modal = openModal(`
            <div class="section-title">Cita ${esc(a.code)} ${statusBadge(a.status)}${transferBadgeFor(ctx, a)}</div>
            ${late ? `<div class="ap-warning"><strong>El cliente pasó el periodo de tolerancia (${grace} min).</strong> Puedes atenderlo igual, reprogramar, cancelar o marcar no-show.</div>` : ''}
            <div class="ap-kv ap-kv-boxes">
                <div class="wide"><small>Cliente</small>${esc(a.client)}${client ? '' : ' <span class="ap-badge amber">Sin ficha</span>'}</div>
                <div class="wide"><small>Fecha y hora</small><span style="text-transform:capitalize;">${esc(fmtDateTime(a))}</span></div>
                <div><small>Servicio</small>${esc(a.service)}</div>
                <div><small>Duración</small>${B().formatDuration(B().appointmentDuration(a, db))}</div>
                <div class="wide"><small>Barbero</small>${esc(a.barberName || ctx.barberName(a.barber))}</div>
                ${transferPending ? `<div class="wide"><small>Transferencia</small><span class="ap-badge amber ap-badge-transfer-pending">Transferencia pendiente</span> Esperando respuesta de ${esc(ctx.barberName(transferPending.toBarber))}${transferPending.reason ? ` · Motivo: ${esc(transferPending.reason)}` : ''}</div>` : ''}
                ${transferAccepted ? `<div class="wide"><small>Transferencia</small><span class="ap-badge gold ap-badge-transferred">Transferida</span> Llegó de ${esc(ctx.barberName(transferAccepted.fromBarber))} (solicitud aceptada).</div>` : ''}
                <div><small>Teléfono</small>${esc((client && client.phone) || a.clientPhone || '—')}</div>
                <div><small>Precio informativo</small>${esc(a.price || '—')}<br><span class="item-meta">Pago presencial</span></div>
                <div class="wide"><small>Correo</small>${esc((client && client.email) || a.clientEmail || '—')}</div>
                <div class="wide"><small>Origen</small>${a.source === 'manual' ? 'Creada por el personal' : 'Reserva en línea'}</div>
                ${a.notes ? `<div class="wide"><small>Nota del cliente</small>${esc(a.notes)}</div>` : ''}
                ${a.unknownCut ? '<div class="wide"><small>Recorte</small><span class="ap-badge amber" style="margin-left:0;">El cliente no sabe el nombre</span> Defínelo con el cliente o con la foto.</div>' : ''}
                ${a.vipDetails ? `<div class="wide"><small>VIP a domicilio</small>${esc([a.vipDetails.town, a.vipDetails.address, a.vipDetails.guests ? `${a.vipDetails.guests} persona(s)` : ''].filter(Boolean).join(' · '))}</div>` : ''}
                ${a.status === 'CANCELADA' ? `<div class="wide ap-kv-cancel"><small>Cancelación</small>Por ${esc(a.canceledBy || (a.canceledByClient ? 'cliente' : 'barbería'))} · ${fmtStamp(a.canceledAt)}${a.cancelReason ? ` · ${esc(a.cancelReason)}` : ''}${a.lateCancellation ? ' · <span class="ap-badge red">Tardía</span>' : ''}</div>` : ''}
            </div>
            ${a.referencePhoto && /^data:image\/(jpeg|png|webp);base64,/.test(a.referencePhoto) ? `<div><div class="item-meta" style="margin-bottom:6px;">Foto de referencia del cliente</div><a href="${a.referencePhoto}" target="_blank" rel="noopener"><img class="ap-ref-photo" src="${a.referencePhoto}" alt="Foto de referencia del cliente"></a></div>` : ''}
            <div class="ap-modal-actions">
                <div class="form-actions" style="justify-content:flex-start; flex-wrap:wrap; align-items:center;">
                    ${a.status === 'PENDIENTE' ? '<button class="action-btn approve" data-decide="APROBADA"><i class="fas fa-check"></i> Aprobar</button><button class="action-btn reject" data-decide="RECHAZADA"><i class="fas fa-xmark"></i> Rechazar</button>' : ''}
                    ${a.status === 'APROBADA' ? '<button class="action-btn approve" data-decide="COMPLETADA"><i class="fas fa-circle-check"></i> Completar</button><button class="action-btn reject" data-decide="CANCELADA"><i class="fas fa-ban"></i> Cancelar</button><button class="action-btn pending" data-decide="PENDIENTE"><i class="fas fa-clock"></i> Marcar como pendiente</button>' : ''}
                    ${(a.status === 'RECHAZADA' || a.status === 'CANCELADA') ? '<button class="action-btn pending" data-decide="PENDIENTE"><i class="fas fa-clock"></i> Marcar como pendiente</button>' : ''}
                    ${moreButton(a.code, 'Más opciones', true)}
                </div>
                <div class="form-actions" style="justify-content:flex-start; flex-wrap:wrap; align-items:center;">
                    ${active ? `<button class="action-btn notify" type="button" data-notify-modal="${esc(a.code)}"><i class="fas fa-paper-plane"></i> Avisar al cliente</button><button class="action-btn notify" type="button" data-transfer-modal="${esc(a.code)}"><i class="fas fa-arrow-right-arrow-left"></i> Pedir transferencia</button>` : ''}
                    ${a.status === 'APROBADA' ? `<a class="action-btn approve" href="${esc(B().googleCalendarUrl(a, db))}" target="_blank" rel="noopener"><i class="fas fa-calendar-plus"></i> Añadir a Google Calendar</a>` : ''}
                    ${!active ? `<button class="action-btn reject" type="button" data-delete-modal="${esc(a.code)}"><i class="fas fa-trash"></i> Eliminar cita</button>` : ''}
                </div>
                <div id="ap-transfer"></div>
            </div>
            <div id="ap-edit"></div>
            <div><div class="item-meta" style="margin-bottom:6px;">Historial de cambios</div>
                <div class="ap-history">${(a.history || []).map(h => `<div><b>${esc(h.action)}</b> · ${fmtStamp(h.at)} · ${esc(h.by)}${h.detail ? `<br>${esc(h.detail)}` : ''}</div>`).join('') || '<div>Sin cambios registrados.</div>'}</div>
            </div>
        `, () => ctx.rerender());
        modal.el.querySelectorAll('[data-decide]').forEach(button => button.addEventListener('click', async () => {
            if (await changeStatus(ctx, code, button.dataset.decide)) modal.close();
        }));
        modal.el.querySelector('[data-notify-modal]')?.addEventListener('click', () => { modal.close(); openNotifyFor(ctx, code); });
        modal.el.querySelector('[data-transfer-modal]')?.addEventListener('click', () => renderTransferForm(ctx, a, modal));
        modal.el.querySelector('[data-delete-modal]')?.addEventListener('click', async () => { if (await deleteAppointment(ctx, code)) modal.close(); });
        bindMoreButtons(ctx, modal.el, { modal, onEdit: () => renderEditForm(ctx, a, modal) });
        if (options && options.edit && active) renderEditForm(ctx, a, modal);
        if (options && options.transfer && active) renderTransferForm(ctx, a, modal);
    }

    // Cambia el estado de una cita (aprobar, rechazar, completar, no-show o cancelar).
    async function changeStatus(ctx, code, status) {
        let reason = '';
        if (status === 'CANCELADA') {
            reason = window.prompt('Motivo de la cancelación (se le mostrará al cliente):', '');
            if (reason === null) return false;
        }
        if (status === 'RECHAZADA') {
            reason = window.prompt('¿Por qué rechazas la cita? (opcional, se le mostrará al cliente)', '');
            if (reason === null) return false;
        }
        if (status === 'NO_SHOW' && !window.confirm('¿Marcar esta cita como no-show? Se sumará al contador del cliente.')) return false;
        const labels = { APROBADA: 'aprobada. Se avisó al cliente', RECHAZADA: 'rechazada. El horario quedó libre', COMPLETADA: 'completada', NO_SHOW: 'marcada como no-show', CANCELADA: 'cancelada', PENDIENTE: 'marcada como pendiente. Se avisó al cliente' };
        return ctx.commit(state => { B().setStatus(state, code, status, { actor: ctx.actorName, reason: String(reason || '').trim() }); },
            { success: `Cita ${code} ${labels[status] || B().statusLabel(status)}.`, error: 'No se pudo actualizar la cita.' });
    }

    // Transferencia v2 (PR #17): pedir una transferencia CREA UNA SOLICITUD.
    // La cita NO cambia de barbero: queda con quien la transfiere hasta que
    // el receptor la acepte en Transferencias (o la rechace y todo siga igual).
    // Con nube: la RPC crea la solicitud y el aviso al receptor; el espejo
    // local va por saveState dentro de GabyCloud (sin commit) para no duplicar
    // el aviso por sync. Sin nube: el motor crea solicitud y aviso en local
    // con un commit normal.
    async function requestTransferHandler(ctx, code, toBarberId, reason) {
        const db = ctx.getDb();
        const a = db.appointments.find(item => item.code === code);
        if (!a) return false;
        const target = db.barbers.find(b => b.id === toBarberId);
        if (!target) { window.GabyData.toast('Escoge el barbero que recibirá la cita.', 'error'); return false; }
        try {
            // Validación en local (servicios, horario libre, sin duplicados)
            // sin tocar los datos.
            B().requestTransfer(window.GabyData.clone(db), code, { toBarberId, reason, by: ctx.actorName });
        } catch (error) {
            window.GabyData.toast(error.userMessage || 'No se puede pedir la transferencia.', 'error');
            return false;
        }
        try {
            if (window.GabyCloud?.enabled) {
                await window.GabyCloud.requestTransfer(code, toBarberId, reason, ctx.actorName);
                window.GabyData.toast(`Solicitud enviada a ${ctx.barberLabel(target)}. La cita sigue contigo hasta que la acepte.`, 'success');
            } else {
                const saved = await ctx.commit(state => {
                    B().requestTransfer(state, code, { toBarberId, reason, by: ctx.actorName });
                }, { success: `Solicitud enviada a ${ctx.barberLabel(target)}. La cita sigue contigo hasta que la acepte.`, error: 'No se pudo enviar la solicitud.' });
                if (!saved) return false;
            }
        } catch (error) {
            window.GabyData.toast(error.userMessage || 'No se pudo enviar la solicitud.', 'error');
            return false;
        }
        return true;
    }

    // Responder una solicitud (aceptar o rechazar). Solo la decide el barbero
    // receptor. Al aceptar, la cita cambia de barbero y se avisa al barbero
    // original y al cliente; al rechazar, todo queda como estaba.
    async function respondTransferHandler(ctx, requestId, accept) {
        const db = ctx.getDb();
        const request = (db.transferRequests || []).find(r => r.id === requestId);
        if (!request) { window.GabyData.toast('No encontramos esa solicitud.', 'error'); return false; }
        const a = db.appointments.find(item => item.code === request.appointmentCode);
        const action = accept ? 'aceptar' : 'rechazar';
        if (!window.confirm(`¿${accept ? 'Aceptar' : 'Rechazar'} la transferencia de la cita ${request.appointmentCode}${a ? ` (${a.client}, ${fmtDateTime(a)})` : ''}?${accept ? ' La cita pasará a tu lista.' : ' La cita seguirá con el barbero original.'}`)) return false;
        try {
            if (window.GabyCloud?.enabled) {
                await window.GabyCloud.respondTransfer(requestId, accept, ctx.actorName);
                window.GabyData.toast(accept ? `Cita ${request.appointmentCode} transferida a tu lista. Se avisó al barbero y al cliente.` : `Solicitud rechazada. La cita ${request.appointmentCode} sigue con el barbero original.`, 'success');
            } else {
                const saved = await ctx.commit(state => {
                    B().respondTransfer(state, requestId, { accept, by: ctx.actorName });
                }, { success: accept ? `Cita ${request.appointmentCode} transferida a tu lista.` : 'Solicitud rechazada.', error: `No se pudo ${action} la solicitud.` });
                if (!saved) return false;
            }
        } catch (error) {
            window.GabyData.toast(error.userMessage || `No se pudo ${action} la solicitud.`, 'error');
            return false;
        }
        ctx.rerender();
        return true;
    }

    // Formulario de solicitud de transferencia dentro del detalle de la cita.
    function renderTransferForm(ctx, appointment, modal) {
        const db = ctx.getDb();
        const box = modal.el.querySelector('#ap-transfer');
        const targets = db.barbers.filter(b => b.active !== false && b.id !== appointment.barber);
        if (!targets.length) { window.GabyData.toast('No hay otro barbero disponible para recibir la cita.', 'warning'); return; }
        if (B().pendingTransferRequest(db, appointment.code)) { window.GabyData.toast('Ya hay una solicitud de transferencia pendiente para esta cita.', 'warning'); return; }
        box.innerHTML = `
            <form class="ap-transfer-form" id="ap-transfer-form">
                <div class="form-group full">
                    <label class="form-label" for="ap-transfer-barber">Barbero que recibirá la cita</label>
                    <select class="form-input" id="ap-transfer-barber" required>
                        <option value="">Escoge un barbero</option>
                        ${targets.map(b => `<option value="${esc(b.id)}">${esc(ctx.barberLabel(b))}</option>`).join('')}
                    </select>
                    <p class="item-meta">Se le enviará una solicitud. La cita seguirá contigo a la misma fecha y hora hasta que la acepte; si la rechaza, todo queda como estaba. Se le avisa a él, y al aceptar o rechazar se avisa también al cliente.</p>
                </div>
                <div class="form-group full">
                    <label class="form-label" for="ap-transfer-reason">Motivo (opcional)</label>
                    <input class="form-input" id="ap-transfer-reason" maxlength="300" placeholder="Ej.: Tengo un compromiso a esa hora">
                </div>
                <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">Enviar solicitud</button><button class="btn btn-ghost" type="button" data-transfer-cancel>Cancelar</button></div></div>
            </form>
        `;
        box.querySelector('[data-transfer-cancel]').addEventListener('click', () => { box.innerHTML = ''; });
        box.querySelector('#ap-transfer-form').addEventListener('submit', async event => {
            event.preventDefault();
            const toBarberId = box.querySelector('#ap-transfer-barber').value;
            const reason = box.querySelector('#ap-transfer-reason').value;
            const submit = box.querySelector('[type="submit"]');
            submit.disabled = true;
            const ok = await requestTransferHandler(ctx, appointment.code, toBarberId, reason);
            submit.disabled = false;
            if (ok) modal.close();
        });
    }

    // Elimina una cita y sus avisos (con confirmación). Solo aparece cuando la
    // cita ya no está activa: una cita activa se cancela primero, para que el
    // cliente reciba el aviso de cancelación.
    async function deleteAppointment(ctx, code) {
        const db = ctx.getDb();
        const a = db.appointments.find(item => item.code === code);
        if (!a) return false;
        if (!window.confirm(`¿Eliminar la cita ${code} de ${a.client} (${fmtDateTime(a)})? Se borrará la cita y sus avisos. Esta acción no se puede deshacer.`)) return false;
        try {
            if (window.GabyCloud?.enabled) {
                const ok = await window.GabyCloud.deleteAppointment(code);
                if (!ok) return false;
                window.GabyData.toast(`Cita ${code} eliminada.`, 'success');
            } else {
                const saved = await ctx.commit(state => {
                    state.appointments = (state.appointments || []).filter(item => item.code !== code);
                    state.notifications = (state.notifications || []).filter(item => item.appointmentCode !== code);
                }, { success: `Cita ${code} eliminada.`, error: 'No se pudo eliminar la cita.' });
                if (!saved) return false;
            }
        } catch (error) {
            window.GabyData.toast(error.userMessage || 'No se pudo eliminar la cita.', 'error');
            return false;
        }
        ctx.rerender();
        return true;
    }

    // Abre el compositor de avisos con UNA cita ya elegida (desde Citas o el detalle).
    function openNotifyFor(ctx, code) {
        ui.notifyMode = 'one';
        ui.notifyCode = code;
        ui.notifySelect = code;
        ctx.go('notifications');
    }

    // Boton de tres puntos con el resto de las opciones de una cita.
    function moreButton(code, label, withText) {
        const text = label || 'Más opciones';
        return `<span class="ap-more"><button type="button" class="ap-more-btn ${withText ? 'labeled' : ''}" data-more="${esc(code)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(text)}" title="${esc(text)}"><i class="fas fa-ellipsis-vertical"></i>${withText ? `<span>${esc(text)}</span>` : ''}</button></span>`;
    }

    function closeMoreMenu() {
        document.querySelectorAll('.ap-more-menu').forEach(menu => menu.remove());
        document.querySelectorAll('.ap-more-btn[aria-expanded="true"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
    }

    function bindMoreButtons(ctx, root, options) {
        root.querySelectorAll('[data-more]').forEach(button => button.addEventListener('click', event => {
            event.stopPropagation();
            const wasOpen = button.getAttribute('aria-expanded') === 'true';
            closeMoreMenu();
            if (!wasOpen) openMoreMenu(ctx, button, button.dataset.more, options || {});
        }));
    }

    function openMoreMenu(ctx, button, code, options) {
        const db = ctx.getDb();
        const a = db.appointments.find(item => item.code === code);
        if (!a) return;
        const client = db.clients.find(c => c.id === a.clientId);
        const active = B().ACTIVE.includes(a.status);
        const digits = String((client && client.phone) || a.clientPhone || '').replace(/\D/g, '');
        const intl = digits.length === 10 ? `1${digits}` : digits;
        const email = (client && client.email) || a.clientEmail;
        const items = [
            !options.modal ? '<button type="button" data-m="open"><i class="fas fa-eye"></i>Ver detalles</button>' : '',
            a.status === 'PENDIENTE' ? '<button type="button" data-m="APROBADA"><i class="fas fa-check"></i>Aprobar</button><button type="button" data-m="RECHAZADA"><i class="fas fa-xmark"></i>Rechazar</button>' : '',
            active ? '<button type="button" data-m="COMPLETADA"><i class="fas fa-circle-check"></i>Marcar completada</button>' : '',
            active ? '<button type="button" data-m="NO_SHOW"><i class="fas fa-user-slash"></i>Marcar no-show</button>' : '',
            active ? '<button type="button" data-m="edit"><i class="fas fa-pen"></i>Editar / reprogramar</button>' : '',
            active ? '<button type="button" data-m="transfer"><i class="fas fa-arrow-right-arrow-left"></i>Pedir transferencia</button>' : '',
            active ? '<button type="button" data-m="notify-app"><i class="fas fa-bell"></i>Avisar en la app</button>' : '',
            a.status === 'APROBADA' ? `<a href="${esc(B().googleCalendarUrl(a, db))}" target="_blank" rel="noopener"><i class="fas fa-calendar-plus"></i>Añadir a Google Calendar</a>` : '',
            '<button type="button" data-m="notify"><i class="fas fa-paper-plane"></i>Avisar por WhatsApp</button>',
            client ? '<button type="button" data-m="client"><i class="fas fa-user"></i>Ver cliente</button>' : '',
            intl ? `<a href="tel:+${intl}"><i class="fas fa-phone"></i>Llamar</a><a href="https://wa.me/${intl}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i>WhatsApp</a>` : '',
            email ? `<a href="mailto:${esc(email)}"><i class="fas fa-envelope"></i>Correo</a>` : '',
            active ? '<hr><button type="button" class="danger" data-m="CANCELADA"><i class="fas fa-ban"></i>Cancelar cita</button>' : '',
            !active ? '<hr><button type="button" class="danger" data-m="delete"><i class="fas fa-trash"></i>Eliminar cita</button>' : ''
        ].join('');
        const menu = document.createElement('div');
        menu.className = 'ap-more-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = items;
        document.body.appendChild(menu);
        button.setAttribute('aria-expanded', 'true');
        // Se coloca junto al boton sin mover la pagina.
        const rect = button.getBoundingClientRect();
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
        const below = rect.bottom + 6;
        const top = below + height > window.innerHeight - 12 ? Math.max(12, rect.top - height - 6) : below;
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.addEventListener('click', async event => {
            const item = event.target.closest('[data-m]');
            if (!item) { closeMoreMenu(); return; }
            const action = item.dataset.m;
            closeMoreMenu();
            if (action === 'open') openAppointment(ctx, code);
            else if (action === 'edit') {
                if (options.onEdit) options.onEdit();
                else openAppointment(ctx, code, { edit: true });
            } else if (action === 'notify') ctx.notifyAppointmentClient(code);
            else if (action === 'notify-app') openNotifyFor(ctx, code);
            else if (action === 'transfer') {
                if (options.modal) renderTransferForm(ctx, a, options.modal);
                else openAppointment(ctx, code, { transfer: true });
            } else if (action === 'delete') {
                if (await deleteAppointment(ctx, code) && options.modal) options.modal.close();
            }
            else if (action === 'client') { if (options.modal) options.modal.close(); ui.clientId = client.id; ctx.go('clients'); }
            else if (await changeStatus(ctx, code, action) && options.modal) options.modal.close();
        });
    }

    document.addEventListener('click', event => { if (!event.target.closest('.ap-more-menu') && !event.target.closest('[data-more]')) closeMoreMenu(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMoreMenu(); });
    window.addEventListener('scroll', closeMoreMenu, { passive: true, capture: true });
    window.addEventListener('resize', closeMoreMenu);

    // Fila de una solicitud pendiente: Aprobar y Rechazar a la vista, lo demas en los tres puntos.
    function requestRow(ctx, a) {
        const photo = a.referencePhoto && /^data:image\/(jpeg|png|webp);base64,/.test(a.referencePhoto) ? `<img class="ap-request-photo" src="${a.referencePhoto}" alt="Foto de referencia">` : '';
        return `
            <div class="ap-request">
                <div>
                    <strong>${photo}${esc(a.client)} · ${esc(a.service)}</strong>
                    <div class="item-meta"><span style="text-transform:capitalize;">${esc(fmtDateTime(a))}</span> · ${esc(ctx.barberName(a.barber))} · ${B().formatDuration(B().appointmentDuration(a, ctx.getDb()))}${a.notes ? ` · "${esc(a.notes)}"` : ''}</div>
                </div>
                <div class="ap-request-actions">
                    <button class="action-btn approve" type="button" data-decide-code="${esc(a.code)}" data-decide="APROBADA"><i class="fas fa-check"></i> Aprobar</button>
                    <button class="action-btn reject" type="button" data-decide-code="${esc(a.code)}" data-decide="RECHAZADA"><i class="fas fa-xmark"></i> Rechazar</button>
                    ${moreButton(a.code)}
                </div>
            </div>`;
    }

    function pendingRequests(ctx) {
        return scopedAppointments(ctx).filter(a => a.status === 'PENDIENTE').sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));
    }

    // --- Transferencia v2 (PR #17): estado DERIVADO de transferRequests ---
    // Sin columna en appointments: 'pendiente' = hay solicitud sin responder,
    // 'transferida' = hay una aceptada. El panel es por barbero: cada uno ve
    // solo las solicitudes donde es origen o destino (igual que sus citas).
    function transferBadgeFor(ctx, a) {
        const status = B().transferStatusFor(ctx.getDb(), a.code);
        if (status === 'pendiente') return '<span class="ap-badge amber ap-badge-transfer-pending">Transferencia pendiente</span>';
        if (status === 'transferida') return '<span class="ap-badge gold ap-badge-transferred">Transferida</span>';
        return '';
    }

    function transferEventLabel(ctx, a) {
        const status = B().transferStatusFor(ctx.getDb(), a.code);
        if (status === 'transferida') return '<em class="ap-event-transfer">Transferida</em>';
        if (status === 'pendiente') return '<em class="ap-event-transfer pending">Transferencia pendiente</em>';
        return '';
    }

    function scopedTransferRequests(ctx) {
        const list = ctx.getDb().transferRequests || [];
        if (!isBarberRole(ctx)) return list;
        return list.filter(r => r.fromBarber === ctx.config.role || r.toBarber === ctx.config.role);
    }

    function incomingTransferRequests(ctx) {
        return B().incomingTransferRequests(ctx.getDb(), ctx.config.role);
    }

    function bindTransferResponseButtons(ctx, root) {
        (root || content()).querySelectorAll('[data-transfer-accept]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; await respondTransferHandler(ctx, b.dataset.transferAccept, true); }));
        (root || content()).querySelectorAll('[data-transfer-reject]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; await respondTransferHandler(ctx, b.dataset.transferReject, false); }));
    }

    // Formulario de edicion: fecha, hora (solo espacios libres), servicios y barbero.
    function renderEditForm(ctx, appointment, modal) {
        const db = ctx.getDb();
        const box = modal.el.querySelector('#ap-edit');
        const current = new Set(B().appointmentServiceNames(appointment));
        const state = { date: dayOf(appointment), time: String(appointment.dateTime).slice(11, 16), barber: appointment.barber };
        const draw = () => {
            const checked = [...box.querySelectorAll('[data-svc]:checked')].map(c => c.dataset.svc);
            const chosen = checked.length ? B().findServices(checked, db) : B().findServices([...current], db);
            const slots = B().getSlots(state.barber, state.date, B().totalMinutes(chosen), { excludeCode: appointment.code, staff: true });
            const timeList = slots.includes(state.time) ? slots : slots;
            box.querySelector('#ap-edit-slots').innerHTML = timeList.length
                ? timeList.map(t => `<button type="button" class="ap-slot ${t === state.time ? 'selected' : ''}" data-slot="${t}">${B().formatTime(t)}</button>`).join('')
                : '<div class="empty">No hay espacios libres ese día para este barbero.</div>';
            box.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => { state.time = b.dataset.slot; draw(); }));
        };
        box.innerHTML = `
            <form class="form-grid" id="ap-edit-form" style="margin-top:6px;">
                <div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="date" id="ap-edit-date" value="${state.date}" required></div>
                <div class="form-group"><label class="form-label">Barbero</label><select class="form-input" id="ap-edit-barber">${barberOptions(ctx, state.barber, false)}</select></div>
                <div class="form-group full"><label class="form-label">Servicios</label>${appointment.unknownCut ? '<div class="item-meta" style="margin-bottom:6px;">El cliente no sabía el nombre del recorte: escoge el servicio correcto.</div>' : ''}<div class="ap-checks">${[...db.services.filter(s => s.active || current.has(s.name)), ...(current.has(B().UNKNOWN_CUT) ? [B().unknownCutService(db)] : [])].map(s => `<label><input type="checkbox" data-svc="${esc(s.name)}" ${current.has(s.name) ? 'checked' : ''}>${esc(s.name)} · ${B().serviceMinutes(s)} min</label>`).join('')}</div></div>
                <div class="form-group full"><label class="form-label">Hora disponible</label><div class="ap-slots" id="ap-edit-slots"></div></div>
                <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">Guardar cambios</button></div><div class="item-meta">El cliente recibirá una notificación del cambio. La cita conserva su código e historial.</div></div>
            </form>
        `;
        box.querySelector('#ap-edit-date').addEventListener('change', e => { state.date = e.target.value; state.time = ''; draw(); });
        box.querySelector('#ap-edit-barber').addEventListener('change', e => { state.barber = e.target.value; state.time = ''; draw(); });
        box.querySelectorAll('[data-svc]').forEach(c => c.addEventListener('change', () => { state.time = ''; draw(); }));
        draw();
        box.querySelector('#ap-edit-form').addEventListener('submit', async event => {
            event.preventDefault();
            const names = [...box.querySelectorAll('[data-svc]:checked')].map(c => c.dataset.svc);
            if (!names.length) return window.GabyData.toast('Escoge al menos un servicio.', 'warning');
            if (!state.time) return window.GabyData.toast('Escoge una hora disponible.', 'warning');
            const ok = await ctx.commit(s => {
                B().rescheduleAppointment(s, appointment.code, { date: state.date, time: state.time, barberId: state.barber, services: B().findServices(names, s), by: 'barbería', actor: ctx.actorName });
            }, { success: 'Cita actualizada. Se avisó al cliente.', error: 'No se pudo actualizar la cita.' });
            if (ok) modal.close();
        });
    }

    // Crear cita manualmente (cliente con ficha o escribiendo nombre y teléfono).
    function openNewAppointment(ctx, preset) {
        const db = ctx.getDb();
        const state = { date: (preset && preset.date) || today(), time: '', barber: ctx.isAdmin() ? ((preset && preset.barber) || db.barbers[0].id) : ctx.config.role };
        const modal = openModal(`
            <div class="section-title">Nueva cita</div>
            <form class="form-grid" id="ap-new-form">
                <div class="form-group full"><label class="form-label">Cliente</label>
                    <select class="form-input" id="ap-new-client"><option value="">— Cliente sin ficha (escribir abajo) —</option>${scopedClients(ctx).map(c => `<option value="${c.id}" ${preset && preset.clientId === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(c.phone || c.email)}</option>`).join('')}</select>
                </div>
                <div class="form-group"><label class="form-label">Nombre (sin ficha)</label><input class="form-input" id="ap-new-name" placeholder="Nombre del cliente"></div>
                <div class="form-group"><label class="form-label">Teléfono (sin ficha)</label><input class="form-input" id="ap-new-phone" placeholder="787-000-0000"></div>
                <div class="form-group"><label class="form-label">Barbero</label><select class="form-input" id="ap-new-barber">${barberOptions(ctx, state.barber, false)}</select></div>
                <div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="date" id="ap-new-date" value="${state.date}" required></div>
                <div class="form-group full"><label class="form-label">Servicios</label><div class="ap-checks">${db.services.filter(s => s.active).map(s => `<label><input type="checkbox" data-svc="${esc(s.name)}">${esc(s.name)} · ${B().serviceMinutes(s)} min · ${esc(s.price)}</label>`).join('')}</div></div>
                <div class="form-group full"><label class="form-label">Hora disponible</label><div class="ap-slots" id="ap-new-slots"><div class="empty">Escoge servicios para ver las horas libres.</div></div></div>
                <div class="form-group full"><label class="form-label">Nota (opcional)</label><input class="form-input" id="ap-new-notes" maxlength="300"></div>
                <div class="form-group full"><div class="form-actions"><button class="btn btn-primary" type="submit">Crear cita</button></div></div>
            </form>
        `, () => ctx.rerender());
        const el = modal.el;
        const names = () => [...el.querySelectorAll('[data-svc]:checked')].map(c => c.dataset.svc);
        const draw = () => {
            const services = B().findServices(names());
            const box = el.querySelector('#ap-new-slots');
            if (!services.length) { box.innerHTML = '<div class="empty">Escoge servicios para ver las horas libres.</div>'; return; }
            const slots = B().getSlots(state.barber, state.date, B().totalMinutes(services), { staff: true });
            box.innerHTML = slots.length ? slots.map(t => `<button type="button" class="ap-slot ${t === state.time ? 'selected' : ''}" data-slot="${t}">${B().formatTime(t)}</button>`).join('') : '<div class="empty">No hay espacios libres ese día.</div>';
            box.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => { state.time = b.dataset.slot; draw(); }));
        };
        el.querySelector('#ap-new-barber').addEventListener('change', e => { state.barber = e.target.value; state.time = ''; draw(); });
        el.querySelector('#ap-new-date').addEventListener('change', e => { state.date = e.target.value; state.time = ''; draw(); });
        el.querySelectorAll('[data-svc]').forEach(c => c.addEventListener('change', () => { state.time = ''; draw(); }));
        el.querySelector('#ap-new-form').addEventListener('submit', async event => {
            event.preventDefault();
            const clientId = el.querySelector('#ap-new-client').value;
            const walkName = el.querySelector('#ap-new-name').value.trim();
            if (!clientId && !walkName) return window.GabyData.toast('Escoge un cliente o escribe el nombre.', 'warning');
            if (!names().length) return window.GabyData.toast('Escoge al menos un servicio.', 'warning');
            if (!state.time) return window.GabyData.toast('Escoge una hora disponible.', 'warning');
            const ok = await ctx.commit(s => {
                B().createAppointment(s, {
                    client: clientId ? s.clients.find(c => c.id === clientId) : null,
                    walkIn: clientId ? null : { name: walkName, phone: el.querySelector('#ap-new-phone').value.trim() },
                    barberId: state.barber, services: B().findServices(names(), s), date: state.date, time: state.time,
                    notes: el.querySelector('#ap-new-notes').value.trim(), by: ctx.actorName, source: 'manual'
                });
            }, { success: 'Cita creada.', error: 'No se pudo crear la cita.' });
            if (ok) modal.close();
        });
    }

    // ---------------------------------------------------------------------
    // DASHBOARD
    // ---------------------------------------------------------------------
    function renderDashboard(ctx) {
        const db = ctx.getDb();
        const list = scopedAppointments(ctx);
        const t = today();
        const todays = list.filter(a => dayOf(a) === t).sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));
        const now = new Date();
        const next = list.filter(a => B().ACTIVE.includes(a.status) && B().parseLocal(a.dateTime) >= now).sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)))[0];
        const newClients = (db.clients || []).filter(c => String(c.registeredAt || '').slice(0, 10) === t).length;
        const weekFrom = B().dateKey(B().addDays(now, -6));
        // PR #17 (B): las estadísticas no pueden tumbar el inicio. Si una cita
        // trae una fecha rota, stats() lanzaba y renderSection mostraba solo el
        // aviso de error: el inicio quedaba vacío. Se usa un respaldo vacío.
        const safeStats = options => {
            try { return B().stats(db, options); } catch (error) { console.error('[Panel] No se pudieron calcular las estadísticas del inicio:', error); return { barbers: [], services: [] }; }
        };
        const statsWeek = safeStats({ barberId: ctx.isAdmin() ? null : ctx.config.role, from: weekFrom, to: t });
        const stats30 = safeStats({ barberId: ctx.isAdmin() ? null : ctx.config.role, from: B().dateKey(B().addDays(now, -29)), to: t });
        const lowStock = (db.inventory || []).filter(i => Number(i.qty) <= Number(i.minQty));
        const pending = pendingRequests(ctx);
        const alerts = (db.notifications || []).filter(n => n.audience === 'staff' && !n.readAt && (n.type === 'alerta-noshow' || n.type === 'bloqueo'));
        // PR #17 (B): conteos por estado, directos de las citas del barbero
        // (sin pasar por stats). "Citas hoy" incluye canceladas y rechazadas.
        const countByStatus = status => list.filter(a => a.status === status).length;
        const counts = { today: todays.length, pendiente: countByStatus('PENDIENTE'), aprobada: countByStatus('APROBADA'), cancelada: countByStatus('CANCELADA'), rechazada: countByStatus('RECHAZADA') };
        // Actividad reciente: las 8 citas más recientes, INCLUYENDO canceladas y
        // rechazadas (antes el inicio no las mostraba en ningún lado).
        const recent = list.slice().sort((a, b) => String(b.dateTime || b.createdAt || '').localeCompare(String(a.dateTime || a.createdAt || ''))).slice(0, 8);
        const me = db.barbers.find(b => b.id === ctx.config.role);
        const available = !me || me.active !== false;
        const online = db.settings.shopMode !== 'offline';
        content().innerHTML = `
            ${me ? `
            <section class="card ap-availability" style="margin-bottom:18px;">
                <div>
                    <div class="section-title" style="margin-bottom:4px;">Tu disponibilidad</div>
                    <div class="item-meta">${available ? 'Los clientes pueden reservar contigo en la página.' : 'No apareces disponible: los clientes no pueden reservar contigo.'}</div>
                </div>
                <button type="button" class="ap-switch ${available ? 'on' : ''}" role="switch" aria-checked="${available}" data-availability aria-label="Disponible para reservas">
                    <span class="ap-switch-track"><span class="ap-switch-thumb"></span></span>
                    <span class="ap-switch-label">${available ? 'Disponible' : 'No disponible'}</span>
                </button>
            </section>` : ''}
            ${ctx.isAdmin() ? `
            <section class="card ap-availability" style="margin-bottom:18px;">
                <div class="section-title" style="margin-bottom:0;">Estado público de la barbería</div>
                <button type="button" class="ap-switch ${online ? 'on' : ''}" role="switch" aria-checked="${online}" data-shop-online aria-label="Barbería en línea">
                    <span class="ap-switch-track"><span class="ap-switch-thumb"></span></span>
                    <span class="ap-switch-label">${online ? 'En línea' : 'Fuera de línea'}</span>
                </button>
            </section>` : ''}
            ${pending.length ? `
            <section class="card" style="margin-bottom:18px;">
                <div class="section-title-row"><div class="section-title">Solicitudes por aprobar (${pending.length})</div></div>
                <div class="item-meta" style="margin-bottom:10px;">El horario ya está apartado para el cliente. Apruébala o recházala para avisarle.</div>
                <div class="list-grid">${pending.slice(0, 8).map(a => requestRow(ctx, a)).join('')}</div>
                ${pending.length > 8 ? '<button class="action-btn notify" data-go="appointments" style="margin-top:10px;">Ver todas</button>' : ''}
            </section>` : ''}
            <section class="card">
                <div class="section-title-row"><div class="section-title">Hoy · ${B().formatDate(t)}</div><button class="btn btn-primary" type="button" data-new>+ Nueva cita</button></div>
                <div class="ap-tiles">
                    <div class="ap-tile"><span>Citas hoy</span><strong data-ap-count="today">${counts.today}</strong></div>
                    <div class="ap-tile"><span>Pendientes</span><strong data-ap-count="pendiente">${counts.pendiente}</strong><small>En total</small></div>
                    <div class="ap-tile"><span>Aprobadas</span><strong data-ap-count="aprobada">${counts.aprobada}</strong><small>En total</small></div>
                    <div class="ap-tile"><span>Canceladas</span><strong data-ap-count="cancelada">${counts.cancelada}</strong><small>En total</small></div>
                    <div class="ap-tile"><span>Rechazadas</span><strong data-ap-count="rechazada">${counts.rechazada}</strong><small>En total</small></div>
                    <div class="ap-tile"><span>Completadas</span><strong>${todays.filter(a => a.status === 'COMPLETADA').length}</strong></div>
                    <div class="ap-tile"><span>Por atender</span><strong>${todays.filter(a => B().ACTIVE.includes(a.status)).length}</strong></div>
                    <div class="ap-tile"><span>No-shows</span><strong>${todays.filter(a => a.status === 'NO_SHOW').length}</strong></div>
                    <div class="ap-tile"><span>Clientes nuevos</span><strong>${newClients}</strong></div>
                    <div class="ap-tile"><span>Próxima cita</span><strong style="font-size:1.1rem;">${next ? `${B().relativeDay(dayOf(next))} ${timeOf(next)}` : '—'}</strong><small>${next ? esc(`${next.client} · ${next.service}`) : 'Sin citas próximas'}</small></div>
                    <div class="ap-tile"><span>Barbero con más citas (7 días)</span><strong style="font-size:1.1rem;">${esc(statsWeek.barbers[0] ? statsWeek.barbers[0][0] : '—')}</strong><small>${statsWeek.barbers[0] ? `${statsWeek.barbers[0][1]} cita(s)` : ''}</small></div>
                    <div class="ap-tile"><span>Servicio más pedido (30 días)</span><strong style="font-size:1.1rem;">${esc(stats30.services[0] ? stats30.services[0][0] : '—')}</strong><small>${stats30.services[0] ? `${stats30.services[0][1]} vez/veces` : ''}</small></div>
                </div>
            </section>
            ${(lowStock.length || alerts.length) ? `
            <section class="card" style="margin-top:18px;">
                <div class="section-title">Atención</div>
                <div class="list-grid">
                    ${alerts.map(n => `<div class="ap-danger"><strong>${esc(n.title)}:</strong> ${esc(n.body)}</div>`).join('')}
                    ${lowStock.length ? `<div class="ap-warning">Inventario bajo: ${lowStock.map(i => esc(`${i.name} (${i.qty})`)).join(', ')}. <button class="action-btn approve" data-go="inventory">Ver inventario</button></div>` : ''}
                </div>
            </section>` : ''}
            <div class="two-col" style="margin-top:18px;">
                <section class="card">
                    <div class="section-title">Agenda de hoy</div>
                    ${todays.length ? `<div class="ap-day-list">${todays.map(a => `<div class="ap-day-row"><time>${timeOf(a)}</time><button type="button" class="ap-event ap-s-${a.status}" data-open="${a.code}"><strong>${esc(a.client)} · ${esc(a.service)}</strong><span>${esc(a.barberName || ctx.barberName(a.barber))} · ${B().formatDuration(B().appointmentDuration(a, db))} · ${esc(B().statusLabel(a.status))}</span></button></div>`).join('')}</div>` : '<div class="empty">No hay citas hoy.</div>'}
                </section>
                <section class="card">
                    <div class="section-title">Búsqueda rápida</div>
                    <input class="form-input" id="ap-quick-search" placeholder="Nombre, teléfono, correo, código, barbero o servicio" value="${esc(ui.search)}">
                    <div class="ap-search-results" id="ap-quick-results"></div>
                </section>
            </div>
            <section class="card" style="margin-top:18px;">
                <div class="section-title-row"><div class="section-title">Actividad reciente</div><button class="action-btn notify" type="button" data-go="appointments">Ver todas las citas</button></div>
                <div class="item-meta" style="margin-bottom:10px;">Las citas más recientes, incluyendo canceladas y rechazadas.</div>
                ${recent.length ? `<div class="ap-recent-list">${recent.map(a => `<div class="ap-recent-row"><time>${esc(B().formatDate(dayOf(a), { day: 'numeric', month: 'short' }))}<br>${timeOf(a)}</time><button type="button" class="ap-event ap-s-${esc(a.status)}" data-open="${esc(a.code)}"><strong>${esc(a.client)} · ${esc(a.service)}</strong><span>${esc(a.barberName || ctx.barberName(a.barber))} · ${esc(B().statusLabel(a.status))}</span></button></div>`).join('')}</div>` : '<div class="empty">Sin citas todavía.</div>'}
            </section>
            ${ctx.renderBarberDirectLinks()}
        `;
        bindCommon(ctx);
        content().querySelector('[data-availability]')?.addEventListener('click', () => ctx.commit(state => {
            const barber = state.barbers.find(b => b.id === ctx.config.role);
            barber.active = !available;
        }, { success: available ? 'Ahora apareces como no disponible.' : 'Ya estás disponible para reservas.', error: 'No se pudo cambiar tu disponibilidad.' }));
        content().querySelector('[data-shop-online]')?.addEventListener('click', () => ctx.commit(state => {
            state.settings.shopMode = online ? 'offline' : 'online';
        }, { success: online ? 'La barbería aparece fuera de línea.' : 'La barbería aparece en línea.', error: 'No se pudo actualizar el estado.' }));
        const input = content().querySelector('#ap-quick-search');
        const run = () => { ui.search = input.value; renderSearchResults(ctx, input.value); };
        input.addEventListener('input', run);
        run();
    }

    function renderSearchResults(ctx, query) {
        const box = content().querySelector('#ap-quick-results');
        const q = query.trim().toLowerCase();
        if (q.length < 2) { box.innerHTML = '<div class="item-meta">Escribe al menos 2 letras.</div>'; return; }
        const db = ctx.getDb();
        const clients = scopedClients(ctx).filter(c => [c.name, c.phone, c.email].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 6);
        const appts = scopedAppointments(ctx).filter(a => [a.code, a.client, a.clientEmail, a.clientPhone, a.service, a.barberName, ctx.barberName(a.barber)].some(v => String(v || '').toLowerCase().includes(q)))
            .sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime))).slice(0, 8);
        box.innerHTML = (clients.map(c => `<button type="button" data-client="${c.id}"><i class="fas fa-user"></i> <strong>${esc(c.name)}</strong> · ${esc(c.phone || '')} · ${esc(c.email || '')}</button>`).join('')
            + appts.map(a => `<button type="button" data-open="${a.code}"><i class="fas fa-calendar"></i> <strong>${esc(a.code)}</strong> · ${esc(a.client)} · ${esc(a.service)} · <span style="text-transform:capitalize;">${esc(fmtDateTime(a))}</span> ${statusBadge(a.status)}${transferBadgeFor(ctx, a)}</button>`).join(''))
            || '<div class="item-meta">Sin resultados.</div>';
        box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openAppointment(ctx, b.dataset.open)));
        box.querySelectorAll('[data-client]').forEach(b => b.addEventListener('click', () => { ui.clientId = b.dataset.client; ctx.go('clients'); }));
    }

    function bindCommon(ctx) {
        content().querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openAppointment(ctx, b.dataset.open)));
        content().querySelectorAll('[data-decide-code]').forEach(b => b.addEventListener('click', () => changeStatus(ctx, b.dataset.decideCode, b.dataset.decide)));
        content().querySelectorAll('[data-notify-code]').forEach(b => b.addEventListener('click', () => openNotifyFor(ctx, b.dataset.notifyCode)));
        bindMoreButtons(ctx, content());
        content().querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => ctx.go(b.dataset.go)));
        content().querySelector('[data-new]')?.addEventListener('click', () => openNewAppointment(ctx));
    }

    // ---------------------------------------------------------------------
    // CALENDARIO (dia / semana / mes)
    // ---------------------------------------------------------------------
    function renderCalendar(ctx) {
        const db = ctx.getDb();
        if (!ui.calDate) ui.calDate = today();
        const barberFilter = isBarberRole(ctx) ? ctx.config.role : ui.calBarber;
        const list = scopedAppointments(ctx).filter(a => barberFilter === 'all' || a.barber === barberFilter);
        const base = B().parseKey(ui.calDate);
        let title = '';
        let body = '';
        const eventBtn = a => `<button type="button" class="ap-event ap-s-${a.status}" data-open="${a.code}"><strong>${timeOf(a)} · ${esc(a.client)}</strong><span>${esc(a.service)} · ${B().appointmentDuration(a, db)} min</span><span>${esc(ctx.barberName(a.barber))}</span><em class="ap-event-status">${esc(B().statusLabel(a.status))}</em>${transferEventLabel(ctx, a)}</button>`;
        const blocksHtml = key => db.timeBlocks.filter(bl => (barberFilter === 'all' || bl.barberId === barberFilter || bl.barberId === 'all') && key >= bl.startDate && key <= (bl.endDate || bl.startDate))
            .map(bl => `<div class="ap-event ap-block-event"><strong>${bl.allDay ? 'Todo el día' : `${B().formatTime(bl.startTime)}–${B().formatTime(bl.endTime)}`}</strong><span>${esc(bl.reason || 'Bloqueado')} · ${esc(ctx.barberName(bl.barberId))}</span></div>`).join('');
        const dayList = key => list.filter(a => dayOf(a) === key).sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));

        if (ui.calView === 'day') {
            title = B().formatDate(ui.calDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            const items = dayList(ui.calDate);
            body = `${blocksHtml(ui.calDate)}${items.length ? `<div class="ap-day-list">${items.map(a => `<div class="ap-day-row"><time>${timeOf(a)}</time>${eventBtn(a)}</div>`).join('')}</div>` : '<div class="empty">Sin citas este día.</div>'}`;
        } else if (ui.calView === 'week') {
            const start = B().addDays(base, -base.getDay());
            const days = Array.from({ length: 7 }, (_, i) => B().dateKey(B().addDays(start, i)));
            title = `Semana del ${B().formatDate(days[0], { day: 'numeric', month: 'short' })} al ${B().formatDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
            body = `<div class="ap-week">${days.map(key => `<div class="ap-day-col ${key === today() ? 'today' : ''}"><h4>${B().formatDate(key, { weekday: 'short', day: 'numeric' })}</h4>${blocksHtml(key)}${dayList(key).map(eventBtn).join('') || '<div class="item-meta">—</div>'}</div>`).join('')}</div>`;
        } else {
            const first = new Date(base.getFullYear(), base.getMonth(), 1);
            const start = B().addDays(first, -first.getDay());
            title = base.toLocaleDateString('es-PR', { month: 'long', year: 'numeric' });
            const cells = Array.from({ length: 42 }, (_, i) => B().addDays(start, i));
            body = `<div class="ap-month">${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => `<div class="ap-dow">${d}</div>`).join('')}${cells.map(date => {
                const key = B().dateKey(date);
                const items = dayList(key);
                return `<button type="button" class="ap-month-cell ${date.getMonth() !== base.getMonth() ? 'other' : ''} ${key === today() ? 'today' : ''}" data-day="${key}"><b>${date.getDate()}</b>${items.slice(0, 3).map(a => `<span class="ap-dot ap-status ap-s-${a.status}" style="display:block;">${timeOf(a)} ${esc(a.client.split(' ')[0])}</span>`).join('')}${items.length > 3 ? `<span class="ap-dot">+${items.length - 3} más</span>` : ''}</button>`;
            }).join('')}</div>`;
        }

        content().innerHTML = `
            <section class="card">
                <div class="ap-cal-head">
                    <div class="ap-chips">${[['day', 'Día'], ['week', 'Semana'], ['month', 'Mes']].map(([id, label]) => `<button class="ap-chip ${ui.calView === id ? 'active' : ''}" data-view="${id}">${label}</button>`).join('')}</div>
                    <h3>${esc(title)}</h3>
                    <div class="ap-chips">
                        <button class="ap-chip" data-nav="-1" aria-label="Anterior"><i class="fas fa-chevron-left"></i></button>
                        <button class="ap-chip" data-nav="0">Hoy</button>
                        <button class="ap-chip" data-nav="1" aria-label="Siguiente"><i class="fas fa-chevron-right"></i></button>
                    </div>
                </div>
                <div class="ap-toolbar">
                    ${!isBarberRole(ctx) ? `<select class="form-input" id="ap-cal-barber">${barberOptions(ctx, ui.calBarber, true)}</select>` : ''}
                    <button class="btn btn-primary" type="button" data-new>+ Nueva cita</button>
                </div>
                ${body}
                <div class="ap-legend">${['APROBADA', 'PENDIENTE', 'COMPLETADA', 'CANCELADA', 'NO_SHOW'].map(statusBadge).join('')}</div>
            </section>
        `;
        bindCommon(ctx);
        content().querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { ui.calView = b.dataset.view; renderCalendar(ctx); }));
        content().querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
            const step = Number(b.dataset.nav);
            if (!step) ui.calDate = today();
            else if (ui.calView === 'day') ui.calDate = B().dateKey(B().addDays(base, step));
            else if (ui.calView === 'week') ui.calDate = B().dateKey(B().addDays(base, step * 7));
            else ui.calDate = B().dateKey(new Date(base.getFullYear(), base.getMonth() + step, 1));
            renderCalendar(ctx);
        }));
        content().querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { ui.calDate = b.dataset.day; ui.calView = 'day'; renderCalendar(ctx); }));
        content().querySelector('#ap-cal-barber')?.addEventListener('change', e => { ui.calBarber = e.target.value; renderCalendar(ctx); });
    }

    // ---------------------------------------------------------------------
    // CITAS (filtros + busqueda)
    // ---------------------------------------------------------------------
    function renderAppointments(ctx) {
        const db = ctx.getDb();
        const t = today();
        const tomorrow = B().dateKey(B().addDays(new Date(), 1));
        const weekEnd = B().dateKey(B().addDays(new Date(), 6));
        const q = ui.apptSearch.trim().toLowerCase();
        const list = scopedAppointments(ctx).filter(a => {
            const d = dayOf(a);
            if (ui.apptQuick === 'today' && d !== t) return false;
            if (ui.apptQuick === 'tomorrow' && d !== tomorrow) return false;
            if (ui.apptQuick === 'week' && (d < t || d > weekEnd)) return false;
            if (ui.apptQuick === 'upcoming' && (d < t || !B().ACTIVE.includes(a.status))) return false;
            if (ui.apptBarber !== 'all' && a.barber !== ui.apptBarber) return false;
            if (ui.apptService !== 'all' && !B().appointmentServiceNames(a).includes(ui.apptService)) return false;
            if (ui.apptStatus !== 'all' && a.status !== ui.apptStatus) return false;
            if (q && ![a.code, a.client, a.clientEmail, a.clientPhone, a.service, ctx.barberName(a.barber)].some(v => String(v || '').toLowerCase().includes(q))) return false;
            return true;
        }).sort((a, b) => ui.apptQuick === 'all' ? String(b.dateTime).localeCompare(String(a.dateTime)) : String(a.dateTime).localeCompare(String(b.dateTime)));
        const requests = pendingRequests(ctx);
        content().innerHTML = `
            ${requests.length ? `
            <section class="card" style="margin-bottom:18px;">
                <div class="section-title">Solicitudes por aprobar (${requests.length})</div>
                <div class="item-meta" style="margin-bottom:10px;">El horario ya está apartado. Apruébala o recházala; si la rechazas, el horario vuelve a quedar libre.</div>
                <div class="list-grid">${requests.map(a => requestRow(ctx, a)).join('')}</div>
            </section>` : ''}
            ${incomingTransferRequests(ctx).length ? `
            <section class="card" style="margin-bottom:18px;">
                <div class="section-title">Transferencias para ti (${incomingTransferRequests(ctx).length})</div>
                <div class="item-meta" style="margin-bottom:10px;">Te quieren pasar estas citas. Acéptalas o recházalas; la cita solo cambia de barbero al aceptar.</div>
                <div class="list-grid">${incomingTransferRequests(ctx).map(r => transferRequestCard(ctx, r)).join('')}</div>
            </section>` : ''}
            <section class="card">
                <div class="section-title-row"><div class="section-title">Citas</div><button class="btn btn-primary" type="button" data-new>+ Nueva cita</button></div>
                <div class="ap-toolbar">
                    <div class="ap-chips">${[['today', 'Hoy'], ['tomorrow', 'Mañana'], ['week', 'Semana'], ['upcoming', 'Próximas'], ['all', 'Todas']].map(([id, label]) => `<button class="ap-chip ${ui.apptQuick === id ? 'active' : ''}" data-quick="${id}">${label}</button>`).join('')}</div>
                </div>
                <div class="ap-toolbar">
                    <input class="form-input" id="ap-appt-search" placeholder="Buscar: nombre, teléfono, correo o código" value="${esc(ui.apptSearch)}">
                    ${!isBarberRole(ctx) ? `<select class="form-input" id="ap-appt-barber">${barberOptions(ctx, ui.apptBarber, true)}</select>` : ''}
                    <select class="form-input" id="ap-appt-service"><option value="all">Todos los servicios</option>${db.services.map(s => `<option ${ui.apptService === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
                    <select class="form-input" id="ap-appt-status"><option value="all">Todos los estados</option>${Object.keys(B().STATUS_LABELS).map(s => `<option value="${s}" ${ui.apptStatus === s ? 'selected' : ''}>${B().statusLabel(s)}</option>`).join('')}</select>
                </div>
                <div class="table-wrap"><table>
                    <thead><tr><th>Fecha y hora</th><th>Cliente</th><th>Servicio</th><th>Barbero</th><th>Estado</th><th>Código</th><th></th></tr></thead>
                    <tbody>${list.map(a => `<tr class="${B().transferStatusFor(db, a.code) ? 'ap-row-transferred' : ''}"><td style="text-transform:capitalize;">${esc(fmtDateTime(a))}</td><td>${esc(a.client)}</td><td>${esc(a.service)}</td><td>${esc(ctx.barberName(a.barber))}</td><td>${statusBadge(a.status)}${transferBadgeFor(ctx, a)}</td><td>${esc(a.code)}</td><td><div class="ap-row-actions">${a.status === 'PENDIENTE' ? `<button class="action-btn approve" type="button" data-decide-code="${esc(a.code)}" data-decide="APROBADA">Aprobar</button><button class="action-btn reject" type="button" data-decide-code="${esc(a.code)}" data-decide="RECHAZADA">Rechazar</button>` : `<button class="action-btn notify" type="button" data-open="${esc(a.code)}">Ver</button>`}${B().ACTIVE.includes(a.status) ? `<button class="action-btn notify" type="button" data-notify-code="${esc(a.code)}">Avisar</button>` : ''}${moreButton(a.code)}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No hay citas con estos filtros.</td></tr>'}</tbody>
                </table></div>
                <div class="item-meta" style="margin-top:10px;">${list.length} cita(s)</div>
            </section>
        `;
        bindCommon(ctx);
        bindTransferResponseButtons(ctx, content());
        content().querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => { ui.apptQuick = b.dataset.quick; renderAppointments(ctx); }));
        const search = content().querySelector('#ap-appt-search');
        search.addEventListener('input', () => { ui.apptSearch = search.value; window.clearTimeout(search.t); search.t = window.setTimeout(() => { renderAppointments(ctx); const s = content().querySelector('#ap-appt-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); });
        content().querySelector('#ap-appt-barber')?.addEventListener('change', e => { ui.apptBarber = e.target.value; renderAppointments(ctx); });
        content().querySelector('#ap-appt-service').addEventListener('change', e => { ui.apptService = e.target.value; renderAppointments(ctx); });
        content().querySelector('#ap-appt-status').addEventListener('change', e => { ui.apptStatus = e.target.value; renderAppointments(ctx); });
    }

    // ---------------------------------------------------------------------
    // CLIENTES (perfil completo, notas internas, bloqueo)
    // ---------------------------------------------------------------------
    function renderClients(ctx) {
        const db = ctx.getDb();
        const q = ui.clientSearch.trim().toLowerCase();
        const clients = scopedClients(ctx).filter(c => !q || [c.name, c.phone, c.email].some(v => String(v || '').toLowerCase().includes(q)))
            .map(c => ({ c, s: B().clientStats(c.id, db), block: B().activeBlock(c.id, db) }))
            .sort((a, b) => b.s.completed - a.s.completed || String(a.c.name).localeCompare(String(b.c.name)));
        const selected = ui.clientId ? scopedClients(ctx).find(c => c.id === ui.clientId) : null;
        content().innerHTML = `
            <div class="two-col">
                <section class="card">
                    <div class="section-title">Clientes (${clients.length})</div>
                    <input class="form-input" id="ap-client-search" placeholder="Buscar por nombre, teléfono o correo" value="${esc(ui.clientSearch)}" style="margin-bottom:12px;">
                    <div class="table-wrap"><table>
                        <thead><tr><th>Cliente</th><th>Visitas</th><th>Última visita</th><th>Próxima cita</th><th></th></tr></thead>
                        <tbody>${clients.map(({ c, s, block }) => {
                            const level = B().noShowLevel(s.noShows, db);
                            return `<tr><td><strong>${esc(c.name)}</strong>${s.isFrequent ? '<span class="ap-badge gold">Frecuente</span>' : ''}${s.noShows ? `<span class="ap-badge ${level.level === 'normal' || level.level === 'advertencia' ? 'amber' : 'red'}">${s.noShows} no-show</span>` : ''}${block ? '<span class="ap-badge red">Bloqueado</span>' : ''}<div class="item-meta">${esc(c.phone || '')}</div></td><td>${s.completed}</td><td>${s.last ? B().formatDate(dayOf(s.last), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td><td>${s.next ? `${B().relativeDay(dayOf(s.next))} ${timeOf(s.next)}` : '—'}</td><td><button class="action-btn approve" data-pick="${c.id}">Ver</button></td></tr>`;
                        }).join('') || '<tr><td colspan="5" class="empty">No hay clientes.</td></tr>'}</tbody>
                    </table></div>
                </section>
                <section class="card">${selected ? clientProfile(ctx, selected) : '<div class="section-title">Perfil del cliente</div><div class="empty">Escoge un cliente para ver su perfil completo.</div>'}</section>
            </div>
        `;
        const search = content().querySelector('#ap-client-search');
        search.addEventListener('input', () => { ui.clientSearch = search.value; window.clearTimeout(search.t); search.t = window.setTimeout(() => { renderClients(ctx); const s = content().querySelector('#ap-client-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); });
        content().querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { ui.clientId = b.dataset.pick; renderClients(ctx); }));
        if (selected) bindClientProfile(ctx, selected);
    }

    function clientProfile(ctx, client) {
        const db = ctx.getDb();
        const s = B().clientStats(client.id, db);
        const block = B().activeBlock(client.id, db);
        const level = B().noShowLevel(s.noShows, db);
        const notes = db.clientNotes.filter(n => n.clientId === client.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const blocks = db.clientBlocks.filter(b => b.clientId === client.id);
        const age = ctx.calculateAge(client.birthDate);
        const canTransfer = canTransferClient(ctx, client, db) && transferTargets(db, client).length > 0;
        return `
            <div class="section-title">${esc(client.name)}${s.isFrequent ? `<span class="ap-badge gold">Cliente frecuente · ${s.completed} visitas</span>` : ''}</div>
            ${block ? `<div class="ap-danger"><strong>Reservas en línea bloqueadas.</strong> Motivo: ${esc(block.reason)} · ${fmtStamp(block.at)} · Responsable: ${esc(block.by)}</div>` : ''}
            ${level.level !== 'normal' ? `<div class="ap-warning">No-shows: ${s.noShows} · ${esc(level.label)}</div>` : ''}
            ${age !== null && age < 18 ? '<div class="ap-warning">Cliente menor de edad.</div>' : ''}
            <div class="form-actions" style="justify-content:flex-start;">${contactButtons(client.phone, client.email)}<button class="action-btn notify" data-crm="${client.id}">Ficha CRM</button><button class="action-btn approve" data-new-for="${client.id}">Nueva cita</button>${canTransfer ? `<button class="action-btn notify" type="button" data-transfer-client>Transferir cliente</button>` : ''}</div>
            <div class="ap-kv" style="margin-top:10px;">
                <div><small>Teléfono</small>${esc(client.phone || '—')}</div>
                <div><small>Correo</small>${esc(client.email || '—')}</div>
                <div><small>Cliente desde</small>${client.registeredAt ? new Date(client.registeredAt).toLocaleDateString('es-PR', { dateStyle: 'medium' }) : '—'}</div>
                <div><small>Próxima cita</small>${s.next ? `${esc(fmtDateTime(s.next))} · ${esc(s.next.service)}` : '—'}</div>
                <div><small>Última visita</small>${s.last ? esc(B().formatDate(dayOf(s.last), { day: 'numeric', month: 'long', year: 'numeric' })) : '—'}</div>
                <div><small>Citas totales</small>${s.total}</div>
                <div><small>Completadas</small>${s.completed}</div>
                <div><small>Canceladas</small>${s.cancelled}</div>
                <div><small>No-shows</small>${s.noShows}</div>
                <div><small>Barbero asignado</small>${esc(client.preferredBarber ? ctx.barberName(client.preferredBarber) : '—')}</div>
                <div><small>Barbero frecuente</small>${esc(s.frequentBarber ? ctx.barberName(s.frequentBarber) : '—')}</div>
                <div><small>Servicio frecuente</small>${esc(s.frequentService || '—')}</div>
                <div><small>Recorte / barba</small>${esc([client.haircut, client.beard].filter(Boolean).join(' · ') || '—')}</div>
            </div>
            <div class="section-title" style="margin-top:16px;">Notas internas</div>
            <div class="item-meta">Solo las ve el personal. Usa notas sobre el servicio (ej. "Prefiere low fade", "Barba #2"); no guardes información sensible.</div>
            <form id="ap-note-form" style="display:flex; gap:8px; margin:10px 0;"><input class="form-input" id="ap-note-text" maxlength="200" placeholder="Nueva nota" required><button class="btn btn-primary" type="submit">Añadir</button></form>
            <div class="list-grid">${notes.map(n => `<div class="mini-card"><div>${esc(n.text)}</div><div class="item-meta" style="margin-top:6px;">${esc(n.author)} · ${fmtStamp(n.createdAt)} ${n.author === ctx.actorName || ctx.isAdmin() ? `<button class="action-btn reject" data-del-note="${n.id}" style="margin-left:6px;">Borrar</button>` : ''}</div></div>`).join('') || '<div class="empty">Sin notas.</div>'}</div>
            ${ctx.isAdmin() ? `
                <div class="section-title" style="margin-top:16px;">Reservas en línea</div>
                ${block ? `<button class="btn btn-primary" type="button" data-unblock>Desbloquear reservas en línea</button>` : `
                <form id="ap-block-form" class="form-grid">
                    <div class="form-group full"><label class="form-label">Motivo del bloqueo</label><select class="form-input" id="ap-block-reason" required><option value="">Selecciona</option><option>Reservaciones falsas</option><option>Múltiples no-shows</option><option>Conducta inapropiada</option><option>Spam</option><option>Otro</option></select></div>
                    <div class="form-group full"><label class="form-label">Detalle (interno)</label><input class="form-input" id="ap-block-detail" maxlength="200"></div>
                    <div class="form-group full"><button class="btn btn-ghost" type="submit">Bloquear reservas en línea</button><div class="item-meta">El cliente solo verá: "${esc(B().BLOCKED_MESSAGE)}"</div></div>
                </form>`}
                ${blocks.length ? `<div class="ap-history" style="margin-top:10px;">${blocks.map(b => `<div><b>${b.active ? 'Activo' : 'Retirado'}</b> · ${esc(b.reason)} · ${fmtStamp(b.at)} · ${esc(b.by)}${b.removedAt ? ` · retirado ${fmtStamp(b.removedAt)} por ${esc(b.removedBy)}` : ''}</div>`).join('')}</div>` : ''}
            ` : ''}
            <div class="section-title" style="margin-top:16px;">Historial de citas</div>
            <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Servicio</th><th>Barbero</th><th>Estado</th><th></th></tr></thead><tbody>
                ${s.history.map(a => `<tr><td style="text-transform:capitalize;">${esc(fmtDateTime(a))}</td><td>${esc(a.service)}</td><td>${esc(ctx.barberName(a.barber))}</td><td>${statusBadge(a.status)}</td><td><button class="action-btn approve" data-open="${a.code}">Ver</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin citas.</td></tr>'}
            </tbody></table></div>
        `;
    }

    function canTransferClient(ctx, client, state) {
        return ctx.isAdmin() || (client.preferredBarber
            ? client.preferredBarber === ctx.config.role
            : state.appointments.some(appointment => appointment.clientId === client.id && appointment.barber === ctx.config.role));
    }

    function transferTargets(state, client) {
        return state.barbers.filter(barber => barber.active !== false && barber.id !== client.preferredBarber);
    }

    function openClientTransfer(ctx, client) {
        const targets = transferTargets(ctx.getDb(), client);
        const modal = openModal(`
            <div class="section-title">Transferir a ${esc(client.name)}</div>
            <form class="form-grid">
                <div class="form-group full">
                    <label class="form-label" for="transfer-barber">Barbero que recibirá al cliente</label>
                    <select class="form-input" id="transfer-barber" required>
                        <option value="">Escoge un barbero</option>
                        ${targets.map(barber => `<option value="${esc(barber.id)}">${esc(ctx.barberLabel(barber))}</option>`).join('')}
                    </select>
                    <p class="item-meta">Cambia el barbero asignado a la ficha. Las citas agendadas conservan su barbero.</p>
                </div>
                <div class="form-group full"><button class="btn btn-primary" type="submit">Transferir cliente</button></div>
            </form>
        `);
        modal.el.querySelector('select').focus();
        modal.el.querySelector('form').addEventListener('submit', async event => {
            event.preventDefault();
            const toBarberId = modal.el.querySelector('select').value;
            const submit = modal.el.querySelector('[type="submit"]');
            submit.disabled = true;
            let ok = false;
            try {
                if (window.GabyCloud?.enabled) {
                    await window.GabyCloud.transferClient(client.id, toBarberId, client.preferredBarber);
                    window.GabyData.toast('Cliente transferido.', 'success');
                    ok = true;
                } else {
                    ok = await ctx.commit(state => {
                        const current = state.clients.find(item => item.id === client.id);
                        if (!current || (current.preferredBarber || '') !== (client.preferredBarber || '') || !canTransferClient(ctx, current, state)) {
                            throw Object.assign(new Error('client assignment'), { userMessage: 'La asignación del cliente cambió. Abre su ficha de nuevo.' });
                        }
                        B().transferClient(state, client.id, { toBarberId, by: ctx.actorName, moveUpcoming: false });
                    }, { success: 'Cliente transferido.', error: 'No se pudo transferir al cliente.' });
                }
            } catch (error) {
                window.GabyData.toast(error.userMessage || 'No se pudo transferir al cliente.', 'error');
            } finally {
                submit.disabled = false;
            }
            if (ok) { modal.close(); ctx.rerender(); }
        });
    }

    function bindClientProfile(ctx, client) {
        content().querySelector('[data-transfer-client]')?.addEventListener('click', () => openClientTransfer(ctx, client));
        bindCommon(ctx);
        content().querySelector('[data-crm]')?.addEventListener('click', () => ctx.openCrm(client.id));
        content().querySelector('[data-new-for]')?.addEventListener('click', () => {
            openNewAppointment(ctx);
            const select = document.querySelector('#ap-new-client');
            if (select) select.value = client.id;
        });
        content().querySelector('#ap-note-form').addEventListener('submit', async event => {
            event.preventDefault();
            const text = content().querySelector('#ap-note-text').value.trim();
            if (!text) return;
            await ctx.commit(s => { s.clientNotes.push({ id: window.GabyData.makeId('note'), clientId: client.id, barberId: ctx.config.role, author: ctx.actorName, text, createdAt: new Date().toISOString() }); },
                { success: 'Nota añadida.', error: 'No se pudo guardar la nota.' });
        });
        content().querySelectorAll('[data-del-note]').forEach(b => b.addEventListener('click', async () => {
            if (!window.confirm('¿Borrar esta nota?')) return;
            await ctx.commit(s => { s.clientNotes = s.clientNotes.filter(n => n.id !== b.dataset.delNote); }, { success: 'Nota borrada.', error: 'No se pudo borrar la nota.' });
        }));
        content().querySelector('#ap-block-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            const reason = content().querySelector('#ap-block-reason').value;
            const detail = content().querySelector('#ap-block-detail').value.trim();
            if (!reason) return window.GabyData.toast('Escoge el motivo del bloqueo.', 'warning');
            await ctx.commit(s => { B().blockClient(s, client.id, { reason: detail ? `${reason}: ${detail}` : reason, by: ctx.actorName }); },
                { success: 'El cliente ya no puede reservar en línea.', error: 'No se pudo bloquear.' });
        });
        content().querySelector('[data-unblock]')?.addEventListener('click', async () => {
            await ctx.commit(s => { B().unblockClient(s, client.id, { by: ctx.actorName }); }, { success: 'Reservas en línea desbloqueadas.', error: 'No se pudo desbloquear.' });
        });
    }

    // ---------------------------------------------------------------------
    // SERVICIOS (categorias, duracion, barberos, imagen)
    // ---------------------------------------------------------------------
    function renderServices(ctx) {
        const db = ctx.getDb();
        const categories = [...new Set([...db.settings.serviceCategories, ...db.services.map(s => s.category || 'Otros')])];
        content().innerHTML = `
            <section class="card">
                <div class="section-title-row"><div class="section-title">Servicios</div>${ctx.isAdmin() ? '<button class="btn btn-primary" type="button" data-svc-new>+ Añadir servicio</button>' : ''}</div>
                <div class="ap-warning">Los precios son <strong>informativos</strong>. Se muestran con "Pago presencial en la barbería". La página no cobra.</div>
                ${categories.map(cat => {
                    const items = db.services.filter(s => (s.category || 'Otros') === cat);
                    if (!items.length) return '';
                    return `<div class="section-title" style="margin-top:16px; font-size:1rem;">${esc(cat)}</div><div class="grid-cards">${items.map(s => `
                        <div class="mini-card">
                            <strong>${esc(s.name)}</strong> ${s.active ? '' : '<span class="ap-badge red">Inactivo</span>'}
                            <div class="item-meta" style="margin-top:6px;">${esc(s.price)} · ${B().formatDuration(B().serviceMinutes(s))}</div>
                            <div class="item-meta" style="margin-top:4px;">Con: ${esc(s.barbers && s.barbers.length ? s.barbers.map(id => ctx.barberName(id)).join(', ') : 'Todos los barberos')}</div>
                            ${ctx.isAdmin() ? `<div class="form-actions"><button class="action-btn approve" data-svc-edit="${s.id}">Editar</button><button class="action-btn pending" data-svc-toggle="${s.id}">${s.active ? 'Desactivar' : 'Activar'}</button><button class="action-btn reject" data-svc-del="${s.id}">Eliminar</button></div>` : ''}
                        </div>`).join('')}</div>`;
                }).join('')}
            </section>
            ${ctx.isAdmin() ? `
            <section class="card" style="margin-top:18px;">
                <div class="section-title">Categorías</div>
                <div class="ap-chips">${db.settings.serviceCategories.map(c => `<span class="ap-chip">${esc(c)} <button type="button" data-cat-del="${esc(c)}" aria-label="Quitar ${esc(c)}" style="background:none;border:0;color:inherit;cursor:pointer;">×</button></span>`).join('')}</div>
                <form id="ap-cat-form" style="display:flex; gap:8px; margin-top:10px;"><input class="form-input" id="ap-cat-name" placeholder="Nueva categoría" maxlength="30" required><button class="btn btn-primary" type="submit">Añadir</button></form>
            </section>` : ''}
        `;
        if (!ctx.isAdmin()) return;
        content().querySelector('[data-svc-new]').addEventListener('click', () => serviceForm(ctx, null));
        content().querySelectorAll('[data-svc-edit]').forEach(b => b.addEventListener('click', () => serviceForm(ctx, db.services.find(s => s.id === b.dataset.svcEdit))));
        content().querySelectorAll('[data-svc-toggle]').forEach(b => b.addEventListener('click', () => ctx.commit(s => {
            const svc = s.services.find(x => x.id === b.dataset.svcToggle); svc.active = !svc.active; svc.editedAt = new Date().toISOString();
        }, { success: 'Servicio actualizado.', error: 'No se pudo actualizar.' })));
        content().querySelectorAll('[data-svc-del]').forEach(b => b.addEventListener('click', () => {
            if (!window.confirm('¿Eliminar este servicio? Las citas existentes conservan su nombre.')) return;
            ctx.commit(s => { s.services = s.services.filter(x => x.id !== b.dataset.svcDel); }, { success: 'Servicio eliminado.', error: 'No se pudo eliminar.' });
        }));
        content().querySelectorAll('[data-cat-del]').forEach(b => b.addEventListener('click', () => ctx.commit(s => {
            s.settings.serviceCategories = s.settings.serviceCategories.filter(c => c !== b.dataset.catDel);
        }, { success: 'Categoría quitada.', error: 'No se pudo quitar.' })));
        content().querySelector('#ap-cat-form').addEventListener('submit', event => {
            event.preventDefault();
            const name = content().querySelector('#ap-cat-name').value.trim();
            if (!name) return;
            ctx.commit(s => { if (!s.settings.serviceCategories.includes(name)) s.settings.serviceCategories.push(name); }, { success: 'Categoría añadida.', error: 'No se pudo añadir.' });
        });
    }

    function serviceForm(ctx, service) {
        const db = ctx.getDb();
        const modal = openModal(`
            <div class="section-title">${service ? 'Editar servicio' : 'Añadir servicio'}</div>
            <form id="ap-svc-form" class="form-grid">
                <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="sv-name" value="${esc(service?.name || '')}" required maxlength="60"></div>
                <div class="form-group"><label class="form-label">Categoría</label><select class="form-input" id="sv-cat" required>${db.settings.serviceCategories.map(c => `<option ${service?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
                <div class="form-group"><label class="form-label">Precio (informativo)</label><input class="form-input" id="sv-price" value="${esc(service?.price || '')}" placeholder="$30, Desde $45 o Consultar" required></div>
                <div class="form-group"><label class="form-label">Duración (minutos)</label><input class="form-input" id="sv-min" type="number" min="5" max="600" step="5" value="${esc(service?.minutes || 40)}" required></div>
                <div class="form-group full"><label class="form-label">Subtítulo corto</label><input class="form-input" id="sv-sub" value="${esc(service?.duration || '')}" maxlength="60" placeholder="Ej. Incluye lavado"></div>
                <div class="form-group full"><label class="form-label">Descripción</label><textarea class="form-input" id="sv-desc" rows="3">${esc(service?.description || '')}</textarea></div>
                <div class="form-group full"><label class="form-label">Barberos que lo ofrecen (ninguno marcado = todos)</label><div class="ap-checks">${db.barbers.map(b => `<label><input type="checkbox" data-sv-barber="${b.id}" ${service?.barbers?.includes(b.id) ? 'checked' : ''}>${esc(ctx.barberLabel(b))}</label>`).join('')}</div></div>
                <div class="form-group full"><label class="ap-checks" style="display:block;"><label><input type="checkbox" id="sv-active" ${service?.active === false ? '' : 'checked'}>Activo (visible para reservar)</label></label></div>
                <div class="form-group full"><button class="btn btn-primary" type="submit">${service ? 'Guardar servicio' : 'Crear servicio'}</button></div>
            </form>
        `);
        modal.el.querySelector('#ap-svc-form').addEventListener('submit', async event => {
            event.preventDefault();
            const el = modal.el;
            const payload = {
                name: el.querySelector('#sv-name').value.trim(), category: el.querySelector('#sv-cat').value, price: el.querySelector('#sv-price').value.trim(),
                minutes: Number(el.querySelector('#sv-min').value), duration: el.querySelector('#sv-sub').value.trim(), description: el.querySelector('#sv-desc').value.trim(),
                image: '', barbers: [...el.querySelectorAll('[data-sv-barber]:checked')].map(c => c.dataset.svBarber),
                active: el.querySelector('#sv-active').checked, editedAt: new Date().toISOString()
            };
            if (!payload.minutes || payload.minutes < 5) return window.GabyData.toast('Escribe la duración en minutos.', 'warning');
            const ok = await ctx.commit(s => {
                if (s.services.some(x => x.name.toLowerCase() === payload.name.toLowerCase() && (!service || x.id !== service.id))) throw Object.assign(new Error('dup'), { userMessage: 'Ya existe un servicio con ese nombre.' });
                if (service) Object.assign(s.services.find(x => x.id === service.id), payload);
                else s.services.push({ id: window.GabyData.makeId('service'), requests: 0, ...payload });
            }, { success: service ? 'Servicio guardado.' : 'Servicio creado.', error: 'No se pudo guardar el servicio.' });
            if (ok) modal.close();
        });
    }

    // ---------------------------------------------------------------------
    // HORARIOS (semana por barbero + bloqueos)
    // ---------------------------------------------------------------------
    function renderSchedule(ctx) {
        const db = ctx.getDb();
        if (!ui.scheduleBarber || (!ctx.isAdmin() && ui.scheduleBarber !== ctx.config.role)) ui.scheduleBarber = ctx.config.role;
        const barber = db.barbers.find(b => b.id === ui.scheduleBarber) || db.barbers[0];
        const week = B().weeklySchedule(barber);
        const blocks = db.timeBlocks.filter(bl => (bl.barberId === barber.id || bl.barberId === 'all') && (bl.endDate || bl.startDate) >= today()).sort((a, b) => a.startDate.localeCompare(b.startDate));
        const order = [1, 2, 3, 4, 5, 6, 0];
        content().innerHTML = `
            <section class="card">
                <div class="section-title-row"><div class="section-title">Horario semanal</div>${ctx.isAdmin() ? `<select class="form-input" id="ap-sch-barber" style="max-width:260px;">${barberOptions(ctx, barber.id, false)}</select>` : ''}</div>
                <div class="item-meta" style="margin-bottom:10px;">Los clientes solo ven horas dentro de este horario y del horario de apertura de la barbería. Resumen público: <strong>${esc(B().scheduleSummary(barber))}</strong></div>
                <form id="ap-week-form"><div class="table-wrap"><table class="ap-week-table">
                    <thead><tr><th>Día</th><th>Disponible</th><th>Entrada</th><th>Salida</th><th>Descansos (almuerzo, etc.)</th></tr></thead>
                    <tbody>${order.map(d => {
                        const day = week[d];
                        return `<tr data-day="${d}"><td><strong>${B().DAY_NAMES[d]}</strong></td>
                            <td><input type="checkbox" data-f="on" ${day.off ? '' : 'checked'} aria-label="${B().DAY_NAMES[d]} disponible"></td>
                            <td><input class="form-input" type="time" data-f="start" value="${day.start}"></td>
                            <td><input class="form-input" type="time" data-f="end" value="${day.end}"></td>
                            <td><input class="form-input" data-f="breaks" value="${esc((day.breaks || []).map(b => `${b.start}-${b.end}${b.label ? ` ${b.label}` : ''}`).join(', '))}" placeholder="12:00-13:00 Almuerzo"></td></tr>`;
                    }).join('')}</tbody>
                </table></div>
                <div class="item-meta" style="margin:8px 0;">Descansos: escribe rangos separados por coma, ej. <code>12:00-13:00 Almuerzo, 16:00-16:15 Pausa</code>.</div>
                <button class="btn btn-primary" type="submit">Guardar horario</button></form>
            </section>
            <section class="card" style="margin-top:18px;">
                <div class="section-title">Bloquear horarios</div>
                <div class="item-meta" style="margin-bottom:10px;">Vacaciones, días libres, citas personales o almuerzos especiales. Los clientes no podrán reservar en esos espacios.</div>
                <form id="ap-block-time" class="form-grid">
                    <div class="form-group"><label class="form-label">Tipo</label><select class="form-input" id="bt-type"><option>Vacaciones</option><option>Día libre</option><option>Cita personal</option><option>Almuerzo</option><option>Otro</option></select></div>
                    <div class="form-group"><label class="form-label">Motivo (opcional)</label><input class="form-input" id="bt-reason" maxlength="60"></div>
                    <div class="form-group"><label class="form-label">Desde</label><input class="form-input" type="date" id="bt-from" value="${today()}" required></div>
                    <div class="form-group"><label class="form-label">Hasta</label><input class="form-input" type="date" id="bt-to" value="${today()}" required></div>
                    <div class="form-group full"><label class="ap-checks" style="display:block;"><label><input type="checkbox" id="bt-all" checked>Todo el día</label></label></div>
                    <div class="form-group"><label class="form-label">Hora inicio</label><input class="form-input" type="time" id="bt-start" value="12:00" disabled></div>
                    <div class="form-group"><label class="form-label">Hora fin</label><input class="form-input" type="time" id="bt-end" value="13:00" disabled></div>
                    ${ctx.isAdmin() ? `<div class="form-group full"><label class="ap-checks" style="display:block;"><label><input type="checkbox" id="bt-shop">Aplicar a toda la barbería (todos los barberos)</label></label></div>` : ''}
                    <div class="form-group full"><button class="btn btn-primary" type="submit">Bloquear</button></div>
                </form>
                <div class="table-wrap" style="margin-top:12px;"><table><thead><tr><th>Fechas</th><th>Horario</th><th>Motivo</th><th></th></tr></thead><tbody>
                    ${blocks.map(bl => `<tr><td>${esc(B().formatDate(bl.startDate, { day: 'numeric', month: 'short' }))}${bl.endDate && bl.endDate !== bl.startDate ? ` – ${esc(B().formatDate(bl.endDate, { day: 'numeric', month: 'short' }))}` : ''}</td><td>${bl.allDay ? 'Todo el día' : `${B().formatTime(bl.startTime)} – ${B().formatTime(bl.endTime)}`}</td><td>${esc(bl.reason)}${bl.barberId === 'all' ? ' <span class="ap-badge gold">Toda la barbería</span>' : ''}</td><td><button class="action-btn reject" data-del-block="${bl.id}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin bloqueos próximos.</td></tr>'}
                </tbody></table></div>
            </section>
        `;
        content().querySelector('#ap-sch-barber')?.addEventListener('change', e => { ui.scheduleBarber = e.target.value; renderSchedule(ctx); });
        const all = content().querySelector('#bt-all');
        all.addEventListener('change', () => { content().querySelector('#bt-start').disabled = all.checked; content().querySelector('#bt-end').disabled = all.checked; });
        content().querySelector('#ap-week-form').addEventListener('submit', async event => {
            event.preventDefault();
            const newWeek = week.map(d => ({ ...d }));
            let error = '';
            content().querySelectorAll('tr[data-day]').forEach(row => {
                const d = Number(row.dataset.day);
                const get = f => row.querySelector(`[data-f="${f}"]`);
                const breaks = get('breaks').value.split(',').map(t => t.trim()).filter(Boolean).map(t => {
                    const m = t.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*(.*)$/);
                    if (!m) { error = `Revisa los descansos del ${B().DAY_NAMES[d]} (formato 12:00-13:00 Almuerzo).`; return null; }
                    return { start: m[1].padStart(5, '0'), end: m[2].padStart(5, '0'), label: m[3] || 'Descanso' };
                }).filter(Boolean);
                if (get('on').checked && get('start').value >= get('end').value) error = `La salida del ${B().DAY_NAMES[d]} debe ser después de la entrada.`;
                newWeek[d] = { off: !get('on').checked, start: get('start').value, end: get('end').value, breaks };
            });
            if (error) return window.GabyData.toast(error, 'warning');
            await ctx.commit(s => {
                const target = s.barbers.find(b => b.id === barber.id);
                target.weeklySchedule = newWeek;
                target.schedule = B().scheduleSummary(target);
            }, { success: 'Horario guardado.', error: 'No se pudo guardar el horario.' });
        });
        content().querySelector('#ap-block-time').addEventListener('submit', async event => {
            event.preventDefault();
            const el = content();
            const from = el.querySelector('#bt-from').value;
            const to = el.querySelector('#bt-to').value || from;
            if (to < from) return window.GabyData.toast('La fecha final debe ser igual o posterior a la inicial.', 'warning');
            const allDay = el.querySelector('#bt-all').checked;
            const start = el.querySelector('#bt-start').value;
            const end = el.querySelector('#bt-end').value;
            if (!allDay && start >= end) return window.GabyData.toast('La hora final debe ser después de la inicial.', 'warning');
            const target = el.querySelector('#bt-shop')?.checked ? 'all' : barber.id;
            const reason = el.querySelector('#bt-reason').value.trim() || el.querySelector('#bt-type').value;
            const conflicts = db.appointments.filter(a => B().ACTIVE.includes(a.status) && (target === 'all' || a.barber === target) && dayOf(a) >= from && dayOf(a) <= to &&
                (allDay || (B().toMin(String(a.dateTime).slice(11, 16)) < B().toMin(end) && B().toMin(String(a.dateTime).slice(11, 16)) + B().appointmentDuration(a, db) > B().toMin(start))));
            if (conflicts.length && !window.confirm(`Hay ${conflicts.length} cita(s) en ese periodo (${conflicts.map(a => `${a.client} ${fmtDateTime(a)}`).join('; ')}). El bloqueo no las cancela: reprográmalas o cancélalas desde Citas. ¿Bloquear de todos modos?`)) return;
            await ctx.commit(s => { s.timeBlocks.push({ id: window.GabyData.makeId('blk-time'), barberId: target, startDate: from, endDate: to, allDay, startTime: allDay ? '' : start, endTime: allDay ? '' : end, reason, createdBy: ctx.actorName, createdAt: new Date().toISOString() }); },
                { success: 'Horario bloqueado.', error: 'No se pudo bloquear.' });
        });
        content().querySelectorAll('[data-del-block]').forEach(b => b.addEventListener('click', () => ctx.commit(s => { s.timeBlocks = s.timeBlocks.filter(x => x.id !== b.dataset.delBlock); }, { success: 'Bloqueo quitado.', error: 'No se pudo quitar.' })));
    }

    // ---------------------------------------------------------------------
    // RESENAS (las envia cualquier visitante con su nombre; quedan pendientes hasta publicarlas)
    // ---------------------------------------------------------------------
    function renderReviews(ctx) {
        const db = ctx.getDb();
        const mine = db.reviews.filter(r => ctx.isAdmin() || r.barberId === ctx.config.role || r.barber === ctx.config.role || String(r.barber || '').toLowerCase().includes(ctx.config.role));
        const list = mine.filter(r => ui.reviewFilter === 'all' || (ui.reviewFilter === 'published' && B().publicReviews({ reviews: [r] }).length > 0) || (ui.reviewFilter === 'private' && r.publishConsent !== true && !B().isLegacyReview(r)) || (ui.reviewFilter === 'hidden' && r.status === 'OCULTA'));
        const avg = mine.length ? (mine.reduce((s, r) => s + Number(r.rating || 0), 0) / mine.length).toFixed(1) : '—';
        content().innerHTML = `
            <section class="card">
                <div class="section-title">Reseñas · promedio ${avg} ⭐ (${mine.length})</div>
                <div class="item-meta" style="margin-bottom:10px;">Cualquier persona puede enviar una reseña con su nombre completo, el servicio y su opinión. Llegan como pendientes: publícalas o, si violan las normas, ocúltalas. No se eliminan críticas por ser negativas.</div>
                <div class="ap-chips" style="margin-bottom:12px;">${[['all', 'Todas'], ['published', 'Publicadas'], ['private', 'Sin permiso de publicar'], ['hidden', 'Ocultas']].map(([id, l]) => `<button class="ap-chip ${ui.reviewFilter === id ? 'active' : ''}" data-rf="${id}">${l}</button>`).join('')}</div>
                ${ctx.renderReviewLink()}
                <div class="list-grid" style="margin-top:12px;">${list.map(r => `
                    <article class="feed-card">
                        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                            <div><h4>${esc(r.clientName)} · ${'★'.repeat(Number(r.rating) || 0)}${'☆'.repeat(5 - (Number(r.rating) || 0))}</h4>
                            <div class="item-meta">${esc(B().reviewServiceLabel(r) || (B().isLegacyReview(r) || !r.service ? 'Servicio no indicado' : 'Recorte sin nombre (el cliente no lo sabía)'))} · ${esc((B().reviewBarber(r, db) && ctx.barberLabel(B().reviewBarber(r, db))) || r.barber || 'Sin barbero')} · Enviada ${esc(fmtStamp(r.createdAt))}</div></div>
                            <div>${r.status === 'OCULTA' ? '<span class="ap-badge red">Oculta</span>' : r.status === 'APROBADA' && B().isLegacyReview(r) ? '<span class="ap-badge gold">Publicada (reseña anterior)</span>' : r.publishConsent !== true && !B().isLegacyReview(r) ? '<span class="ap-badge amber">Sin permiso de publicar</span>' : r.status === 'APROBADA' ? '<span class="ap-badge gold">Publicada</span>' : `<span class="ap-badge amber">${esc(r.status)}</span>`}</div>
                        </div>
                        <p>${esc(r.text) || '<em>Sin comentario.</em>'}</p>
                        ${r.hiddenReason ? `<div class="item-meta">Oculta por: ${esc(r.hiddenReason)} (${esc(r.hiddenBy || '')})</div>` : ''}
                        ${ctx.isAdmin() ? `<div class="form-actions">${r.status === 'OCULTA' ? `<button class="action-btn approve" data-rv-show="${r.id}">Volver a mostrar</button>` : `<button class="action-btn reject" data-rv-hide="${r.id}">Ocultar (viola normas)</button>`}${r.status === 'PENDIENTE' ? `<button class="action-btn approve" data-rv-show="${r.id}">Publicar</button>` : ''}</div>` : ''}
                    </article>`).join('') || '<div class="empty">No hay reseñas con este filtro.</div>'}</div>
            </section>
        `;
        ctx.bindReviewLink();
        content().querySelectorAll('[data-rf]').forEach(b => b.addEventListener('click', () => { ui.reviewFilter = b.dataset.rf; renderReviews(ctx); }));
        content().querySelectorAll('[data-rv-hide]').forEach(b => b.addEventListener('click', () => {
            const rule = window.prompt('¿Qué norma viola? (amenazas, datos personales de terceros, contenido ilegal, spam o suplantación)', 'Spam');
            if (!rule) return;
            ctx.commit(s => { const r = s.reviews.find(x => x.id === b.dataset.rvHide); r.status = 'OCULTA'; r.hiddenReason = rule; r.hiddenBy = ctx.actorName; r.hiddenAt = new Date().toISOString(); }, { success: 'Reseña ocultada.', error: 'No se pudo ocultar.' });
        }));
        content().querySelectorAll('[data-rv-show]').forEach(b => b.addEventListener('click', () => ctx.commit(s => { const r = s.reviews.find(x => x.id === b.dataset.rvShow); B().setReviewStatus(r, 'APROBADA'); delete r.hiddenReason; }, { success: 'Reseña visible.', error: 'No se pudo actualizar.' })));
    }

    // ---------------------------------------------------------------------
    // INVENTARIO
    // ---------------------------------------------------------------------
    // Inventario en una sola página: productos a la venta, materiales de la barbería y proveedores.
    // Cada fila tiene un solo botón (Editar); agregar, ocultar y eliminar están dentro de la ventana.
    function renderInventory(ctx) {
        const db = ctx.getDb();
        const admin = ctx.isAdmin();
        const products = (admin ? db.products : db.products.filter(p => p.barberId === ctx.config.role))
            .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const items = db.inventory.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const providers = admin ? (db.providers || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))) : [];
        const stockState = (qty, min) => Number(qty) <= 0 ? ['Agotado', 'red'] : Number(qty) <= Number(min) ? ['Bajo', 'amber'] : ['OK', 'gold'];
        const telLink = phone => { const d = String(phone || '').replace(/\D/g, ''); return d ? `<a href="tel:+${d.length === 10 ? `1${d}` : d}">${esc(phone)}</a>` : '—'; };
        const head = (title, help, button) => `<div class="section-title-row"><div><div class="section-title" style="margin-bottom:4px;">${title}</div><div class="item-meta">${help}</div></div>${button}</div>`;
        content().innerHTML = `
            <section class="card ap-inv-block">
                ${head(admin ? 'Productos a la venta' : 'Mis productos a la venta', 'Salen en la tienda de la página y en el perfil del barbero que los vende.', '<button class="btn btn-primary" type="button" data-add="product">+ Producto</button>')}
                <div class="table-wrap"><table class="ap-inv-table"><thead><tr><th>Producto</th><th>Precio</th><th>Stock</th><th>Estado</th><th></th></tr></thead><tbody>
                    ${products.map(p => `<tr>
                        <td><strong>${esc(p.name)}</strong>${admin ? `<div class="item-meta">${esc(ctx.barberName(p.barberId))}</div>` : ''}</td>
                        <td>${esc(p.price)}</td>
                        <td><span class="ap-badge ${stockState(p.stock, 3)[1]}">${Number(p.stock) || 0}</span></td>
                        <td>${p.active === false ? '<span class="ap-badge">Oculto</span>' : '<span class="ap-badge gold">En la tienda</span>'}</td>
                        <td><button class="action-btn notify" type="button" data-edit-product="${esc(p.id)}">Editar</button></td>
                    </tr>`).join('') || '<tr><td colspan="5" class="empty">Todavía no hay productos a la venta.</td></tr>'}
                </tbody></table></div>
            </section>
            <section class="card ap-inv-block">
                ${head('Materiales de la barbería', 'Ajusta la cantidad desde Editar.', '<button class="btn btn-primary" type="button" data-add="item">+ Material</button>')}
                <div class="table-wrap"><table class="ap-inv-table"><thead><tr><th>Material</th><th>Cantidad</th><th>Estado</th><th></th></tr></thead><tbody>
                    ${items.map(i => `<tr>
                        <td><strong>${esc(i.name)}</strong>${i.category ? `<div class="item-meta">${esc(i.category)}</div>` : ''}</td>
                        <td><strong>${Number(i.qty)}</strong><div class="item-meta">Mínimo ${Number(i.minQty)}</div></td>
                        <td><span class="ap-badge ${stockState(i.qty, i.minQty)[1]}">${stockState(i.qty, i.minQty)[0]}</span></td>
                        <td><button class="action-btn notify" type="button" data-edit-item="${esc(i.id)}">Editar</button></td>
                    </tr>`).join('') || '<tr><td colspan="4" class="empty">Todavía no hay materiales.</td></tr>'}
                </tbody></table></div>
            </section>
            ${admin ? `
            <section class="card ap-inv-block">
                ${head('Proveedores', 'A quién se le compran los productos y materiales.', '<button class="btn btn-primary" type="button" data-add="provider">+ Proveedor</button>')}
                <div class="table-wrap"><table class="ap-inv-table"><thead><tr><th>Proveedor</th><th>Contacto</th><th>Teléfono</th><th></th></tr></thead><tbody>
                    ${providers.map(p => `<tr>
                        <td><strong>${esc(p.name)}</strong>${p.category ? `<div class="item-meta">${esc(p.category)}</div>` : ''}</td>
                        <td>${esc(p.contact || '—')}</td>
                        <td>${telLink(p.phone)}</td>
                        <td><button class="action-btn notify" type="button" data-edit-provider="${esc(p.id)}">Editar</button></td>
                    </tr>`).join('') || '<tr><td colspan="4" class="empty">Todavía no hay proveedores.</td></tr>'}
                </tbody></table></div>
            </section>` : ''}
        `;

        const field = (id, label, value, extra = '') => `<div class="form-group"><label class="form-label" for="${id}">${label}</label><input class="form-input" id="${id}" value="${esc(value ?? '')}" ${extra}></div>`;
        const actions = (isNew, hideLabel) => `<div class="form-group full"><div class="form-actions" style="flex-wrap:wrap;">
            <button class="btn btn-primary" type="submit">${isNew ? 'Añadir' : 'Guardar'}</button>
            ${!isNew && hideLabel ? `<button class="btn btn-ghost" type="button" data-toggle>${hideLabel}</button>` : ''}
            ${isNew ? '' : '<button class="btn btn-danger" type="button" data-delete>Eliminar</button>'}
        </div></div>`;

        function editProduct(id) {
            const p = id ? db.products.find(x => x.id === id) : null;
            const modal = openModal(`
                <div class="section-title">${p ? 'Editar producto' : 'Nuevo producto a la venta'}</div>
                <form class="form-grid" id="inv-product-form">
                    ${field('pf-name', 'Nombre', p?.name, 'required maxlength="60"')}
                    ${field('pf-price', 'Precio', p?.price, 'required placeholder="$20"')}
                    ${field('pf-stock', 'En existencia', p?.stock ?? 0, 'type="number" min="0" required')}
                    ${field('pf-sold', 'Vendidos', p?.sold ?? 0, 'type="number" min="0"')}
                    ${admin ? `<div class="form-group full"><label class="form-label" for="pf-owner">Barbero que lo vende</label><select class="form-input" id="pf-owner">${barberOptions(ctx, p?.barberId || ctx.config.role, false)}</select></div>` : ''}
                    <div class="form-group full"><label class="form-label" for="pf-desc">Descripción</label><textarea class="form-input" id="pf-desc" rows="3">${esc(p?.desc || '')}</textarea></div>
                    <div class="form-group full"><label class="form-label" for="pf-image">Foto (URL, opcional)</label><input class="form-input" id="pf-image" value="${esc(p?.image || '')}" placeholder="https://..."></div>
                    ${actions(!p, p ? (p.active === false ? 'Mostrar en la tienda' : 'Ocultar de la tienda') : '')}
                </form>`, () => ctx.rerender());
            const el = modal.el;
            const v = sel => el.querySelector(sel).value.trim();
            el.querySelector('form').addEventListener('submit', async event => {
                event.preventDefault();
                const payload = { name: v('#pf-name'), price: v('#pf-price'), stock: Number(v('#pf-stock')) || 0, sold: Number(v('#pf-sold')) || 0, desc: v('#pf-desc'), image: v('#pf-image'), barberId: admin ? v('#pf-owner') : ctx.config.role };
                const ok = await ctx.commit(s => {
                    if (p) Object.assign(s.products.find(x => x.id === p.id), payload);
                    else s.products.push({ id: window.GabyData.makeId('product'), active: true, ...payload });
                }, { success: p ? 'Producto guardado.' : 'Producto añadido a la tienda.', error: 'No se pudo guardar el producto.' });
                if (ok) modal.close();
            });
            el.querySelector('[data-toggle]')?.addEventListener('click', async () => {
                if (await ctx.commit(s => { const x = s.products.find(y => y.id === p.id); x.active = x.active === false; }, { success: 'Listo.', error: 'No se pudo cambiar.' })) modal.close();
            });
            el.querySelector('[data-delete]')?.addEventListener('click', async () => {
                if (!window.confirm(`¿Eliminar "${p.name}"?`)) return;
                if (await ctx.commit(s => { s.products = s.products.filter(x => x.id !== p.id); }, { success: 'Producto eliminado.', error: 'No se pudo eliminar.' })) modal.close();
            });
        }

        function editItem(id) {
            const i = id ? db.inventory.find(x => x.id === id) : null;
            const modal = openModal(`
                <div class="section-title">${i ? 'Editar material' : 'Nuevo material'}</div>
                <form class="form-grid">
                    ${field('if-name', 'Nombre', i?.name, 'required maxlength="60"')}
                    ${field('if-cat', 'Categoría (opcional)', i?.category, 'maxlength="40"')}
                    ${field('if-qty', 'Cantidad', i?.qty ?? 0, 'type="number" min="0" required')}
                    ${field('if-min', 'Mínimo antes de avisar', i?.minQty ?? 1, 'type="number" min="0" required')}
                    ${actions(!i)}
                </form>`, () => ctx.rerender());
            const el = modal.el;
            const v = sel => el.querySelector(sel).value.trim();
            el.querySelector('form').addEventListener('submit', async event => {
                event.preventDefault();
                const payload = { name: v('#if-name'), category: v('#if-cat'), qty: Math.max(0, Number(v('#if-qty')) || 0), minQty: Math.max(0, Number(v('#if-min')) || 0), updatedAt: new Date().toISOString() };
                const ok = await ctx.commit(s => {
                    if (i) Object.assign(s.inventory.find(x => x.id === i.id), payload);
                    else s.inventory.push({ id: window.GabyData.makeId('inv'), ...payload });
                }, { success: i ? 'Material guardado.' : 'Material añadido.', error: 'No se pudo guardar.' });
                if (ok) modal.close();
            });
            el.querySelector('[data-delete]')?.addEventListener('click', async () => {
                if (!window.confirm(`¿Eliminar "${i.name}"?`)) return;
                if (await ctx.commit(s => { s.inventory = s.inventory.filter(x => x.id !== i.id); }, { success: 'Material eliminado.', error: 'No se pudo eliminar.' })) modal.close();
            });
        }

        function editProvider(id) {
            const p = id ? db.providers.find(x => x.id === id) : null;
            const modal = openModal(`
                <div class="section-title">${p ? 'Editar proveedor' : 'Nuevo proveedor'}</div>
                <form class="form-grid">
                    ${field('vf-name', 'Nombre', p?.name, 'required maxlength="60"')}
                    ${field('vf-cat', 'Qué provee', p?.category, 'maxlength="60" placeholder="Productos de barba, navajas..."')}
                    ${field('vf-contact', 'Persona de contacto', p?.contact, 'maxlength="60"')}
                    ${field('vf-phone', 'Teléfono', p?.phone, 'type="tel" maxlength="20"')}
                    ${actions(!p)}
                </form>`, () => ctx.rerender());
            const el = modal.el;
            const v = sel => el.querySelector(sel).value.trim();
            el.querySelector('form').addEventListener('submit', async event => {
                event.preventDefault();
                const payload = { name: v('#vf-name'), category: v('#vf-cat'), contact: v('#vf-contact'), phone: v('#vf-phone'), status: p?.status || 'Activo' };
                const ok = await ctx.commit(s => {
                    s.providers = s.providers || [];
                    if (p) Object.assign(s.providers.find(x => x.id === p.id), payload);
                    else s.providers.push({ id: window.GabyData.makeId('prov'), ...payload });
                }, { success: p ? 'Proveedor guardado.' : 'Proveedor añadido.', error: 'No se pudo guardar.' });
                if (ok) modal.close();
            });
            el.querySelector('[data-delete]')?.addEventListener('click', async () => {
                if (!window.confirm(`¿Eliminar a "${p.name}"?`)) return;
                if (await ctx.commit(s => { s.providers = s.providers.filter(x => x.id !== p.id); }, { success: 'Proveedor eliminado.', error: 'No se pudo eliminar.' })) modal.close();
            });
        }

        const adders = { product: () => editProduct(null), item: () => editItem(null), provider: () => editProvider(null) };
        content().querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => adders[b.dataset.add]()));
        content().querySelectorAll('[data-edit-product]').forEach(b => b.addEventListener('click', () => editProduct(b.dataset.editProduct)));
        content().querySelectorAll('[data-edit-item]').forEach(b => b.addEventListener('click', () => editItem(b.dataset.editItem)));
        content().querySelectorAll('[data-edit-provider]').forEach(b => b.addEventListener('click', () => editProvider(b.dataset.editProvider)));
    }

    // ---------------------------------------------------------------------
    // REPORTES
    // ---------------------------------------------------------------------
    function renderReports(ctx, target) {
        const db = ctx.getDb();
        const now = new Date();
        let from;
        let to = today();
        if (ui.reportRange === 'month') from = B().dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
        else if (ui.reportRange === 'custom') { from = ui.reportFrom || today(); to = ui.reportTo || today(); }
        else from = B().dateKey(B().addDays(now, -(Number(ui.reportRange) - 1)));
        const barberId = ctx.isAdmin() ? (ui.reportBarber === 'all' ? null : ui.reportBarber) : ctx.config.role;
        const s = B().stats(db, { barberId, from, to });
        const byWeek = {};
        s.byDay.forEach(([key, n]) => { const d = B().parseKey(key); const w = B().dateKey(B().addDays(d, -d.getDay())); byWeek[w] = (byWeek[w] || 0) + n; });
        const byMonth = {};
        s.byDay.forEach(([key, n]) => { const m = key.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + n; });
        target.innerHTML = `
            <section class="card">
                <div class="section-title">Reportes</div>
                <div class="ap-toolbar">
                    <div class="ap-chips">${[['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['month', 'Este mes'], ['custom', 'Personalizado']].map(([id, l]) => `<button class="ap-chip ${ui.reportRange === id ? 'active' : ''}" data-range="${id}">${l}</button>`).join('')}</div>
                    ${ui.reportRange === 'custom' ? `<input class="form-input" type="date" id="rp-from" value="${from}"><input class="form-input" type="date" id="rp-to" value="${to}">` : ''}
                    ${ctx.isAdmin() ? `<select class="form-input" id="rp-barber">${barberOptions(ctx, ui.reportBarber, true)}</select>` : ''}
                </div>
                <div class="item-meta" style="margin-bottom:10px;">Del ${B().formatDate(from, { day: 'numeric', month: 'short', year: 'numeric' })} al ${B().formatDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div class="ap-tiles">
                    <div class="ap-tile"><span>Citas</span><strong>${s.total}</strong></div>
                    <div class="ap-tile"><span>Completadas</span><strong>${s.completed}</strong></div>
                    <div class="ap-tile"><span>Canceladas</span><strong>${s.cancelled}</strong></div>
                    <div class="ap-tile"><span>No-shows</span><strong>${s.noShows}</strong></div>
                    <div class="ap-tile"><span>Clientes nuevos</span><strong>${s.newClients}</strong></div>
                    <div class="ap-tile"><span>Clientes recurrentes</span><strong>${s.returningClients}</strong></div>
                    <div class="ap-tile"><span>Ingreso estimado</span><strong>$${s.estimatedIncome.toLocaleString('en-US')}</strong><small>Precio del servicio × citas completadas. No es dinero cobrado por la página.</small></div>
                </div>
            </section>
            <div class="two-col" style="margin-top:18px;">
                <section class="card"><div class="section-title">Servicios más reservados</div>${bars(s.services)}</section>
                <section class="card"><div class="section-title">Barberos con más citas</div>${bars(s.barbers)}</section>
                <section class="card"><div class="section-title">Horas con más demanda</div>${bars(s.byHour, 12)}</section>
                <section class="card"><div class="section-title">Días más ocupados</div>${bars(s.byWeekday, 7)}</section>
                <section class="card"><div class="section-title">Citas por día</div>${bars(s.byDay.slice(-14).map(([k, n]) => [B().formatDate(k, { weekday: 'short', day: 'numeric', month: 'short' }), n]), 14)}</section>
                <section class="card"><div class="section-title">Citas por semana / mes</div>${bars(Object.entries(byWeek).map(([k, n]) => [`Semana del ${B().formatDate(k, { day: 'numeric', month: 'short' })}`, n]), 8)}<div style="height:12px"></div>${bars(Object.entries(byMonth).map(([k, n]) => [B().parseKey(`${k}-01`).toLocaleDateString('es-PR', { month: 'long', year: 'numeric' }), n]), 6)}</section>
            </div>
        `;
        target.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { ui.reportRange = b.dataset.range; renderReports(ctx, target); }));
        target.querySelector('#rp-from')?.addEventListener('change', e => { ui.reportFrom = e.target.value; renderReports(ctx, target); });
        target.querySelector('#rp-to')?.addEventListener('change', e => { ui.reportTo = e.target.value; renderReports(ctx, target); });
        target.querySelector('#rp-barber')?.addEventListener('change', e => { ui.reportBarber = e.target.value; renderReports(ctx, target); });
    }

    // ---------------------------------------------------------------------
    // NOTIFICACIONES (personal)
    // ---------------------------------------------------------------------
    function staffNotifications(ctx) {
        const db = ctx.getDb();
        return (db.notifications || []).filter(n => n.audience === 'staff' && (ctx.isAdmin() || !n.barberId || n.barberId === ctx.config.role));
    }

    // Citas próximas que el remitente puede avisar: el admin ve todas; cada
    // barbero solo las suyas. Activas (PENDIENTE/APROBADA) y aún no pasadas.
    function upcomingAppointments(ctx) {
        const now = Date.now();
        return scopedAppointments(ctx)
            .filter(a => B().ACTIVE.includes(a.status) && a.dateTime && (B().parseLocal(a.dateTime) || new Date(0)).getTime() >= now - 5 * 60000)
            .sort((x, y) => String(x.dateTime).localeCompare(String(y.dateTime)));
    }

    // Avisos enviados a clientes (audience 'client'), los más recientes primero.
    function sentClientNotifications(ctx) {
        const db = ctx.getDb();
        return (db.notifications || [])
            .filter(n => n.audience === 'client' && (ctx.isAdmin() || !n.barberId || n.barberId === ctx.config.role))
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    function appointmentLabel(ctx, a) {
        return `${a.code} · ${a.client || 'Cliente'} · ${a.service || ''} · ${fmtDateTime(a)}`;
    }

    // Plantillas profesionales para avisar a un cliente. Se rellenan con la
    // cita elegida; sin cita elegida se usa la versión genérica (para "todas
    // las citas próximas"). La de cancelación es para avisar de una cita que ya
    // se canceló: no cambia el estado (el cambio de estado ya avisa solo).
    const NOTIFY_TEMPLATES = {
        tardanza: {
            title: 'Tu cita va con un poco de retraso',
            body: (a, ctx) => a
                ? `Hola ${a.client}, tu cita de ${a.service} con ${ctx.barberName(a.barber)} (${fmtDateTime(a)}) va con unos minutos de retraso. Te avisamos en cuanto estemos listos para atenderte. Gracias por tu paciencia. — GOAT Style Salon`
                : 'Hola, tu cita de hoy va con unos minutos de retraso. Te avisamos en cuanto estemos listos para atenderte. Gracias por tu paciencia. — GOAT Style Salon'
        },
        recordatorio: {
            title: 'Recordatorio de tu cita',
            body: (a, ctx) => a
                ? `Hola ${a.client}, te recordamos tu cita de ${a.service} con ${ctx.barberName(a.barber)} el ${fmtDateTime(a)}. Si necesitas cambiarla, escríbenos. ¡Te esperamos! — GOAT Style Salon`
                : 'Hola, te recordamos tu cita en GOAT Style Salon. Si necesitas cambiarla, escríbenos. ¡Te esperamos! — GOAT Style Salon'
        },
        cancelacion: {
            title: 'Tu cita fue cancelada',
            body: (a, ctx) => a
                ? `Hola ${a.client}, lamentamos informarte que tu cita de ${a.service} con ${ctx.barberName(a.barber)} del ${fmtDateTime(a)} fue cancelada. Escríbenos para buscar otro horario que te convenga. — GOAT Style Salon`
                : 'Hola, lamentamos informarte que tu cita fue cancelada. Escríbenos para buscar otro horario que te convenga. — GOAT Style Salon'
        }
    };

    // Nota: el push al teléfono de los avisos al cliente que crea una acción
    // del panel (aprobar, rechazar, cancelar, reprogramar) lo envía el propio
    // guardado (supabase-sync.js, al insertar el aviso). El panel NO lo invoca
    // aquí: si lo hiciera, el cliente recibiría el aviso dos veces.

    // Envía el aviso del compositor: una fila por cita destinataria (audience
    // 'client', con su código de cita). Se guarda por el flujo normal de commit,
    // así la inserción pasa la política RLS del personal (is_staff()).
    async function sendManualNotification(ctx) {
        const title = String(ui.notifyTitle || '').trim();
        const body = String(ui.notifyBody || '').trim();
        if (!title || !body) {
            window.GabyData.toast('Escribe el título y el mensaje del aviso.', 'error');
            return;
        }
        let targets = [];
        if (ui.notifyMode === 'all') {
            targets = upcomingAppointments(ctx);
        } else {
            const typed = String(ui.notifyCode || '').trim().toUpperCase();
            const code = typed || String(ui.notifySelect || '').trim().toUpperCase();
            if (!/^GS-\d{6}$/.test(code)) {
                window.GabyData.toast('Elige una cita o escribe un código válido (GS-123456).', 'error');
                return;
            }
            const found = ctx.getDb().appointments.find(a => a.code === code);
            if (!found) {
                window.GabyData.toast('No hay ninguna cita con ese código.', 'error');
                return;
            }
            if (!ctx.isAdmin() && found.barber !== ctx.config.role) {
                window.GabyData.toast('Esa cita no es tuya.', 'error');
                return;
            }
            const when = found.dateTime ? (B().parseLocal(found.dateTime) || new Date(0)).getTime() : 0;
            if (!B().ACTIVE.includes(found.status) || when < Date.now() - 5 * 60000) {
                window.GabyData.toast('Esa cita ya pasó o no está activa.', 'error');
                return;
            }
            targets = [found];
        }
        if (!targets.length) {
            window.GabyData.toast('No hay citas próximas para avisar.', 'error');
            return;
        }
        // PR #17 (D): el cliente que apagó los mensajes no recibe avisos manuales.
        const targeted = targets.length;
        targets = targets.filter(a => {
            const pref = (ctx.getDb().notificationPreferences || []).find(p => p.appointmentCode === a.code);
            return !pref || pref.messages !== false;
        });
        if (!targets.length) {
            window.GabyData.toast(targeted === 1 ? 'Ese cliente tiene los mensajes apagados.' : 'Esos clientes tienen los mensajes apagados.', 'warning');
            return;
        }
        const now = new Date().toISOString();
        const rows = targets.map(a => ({
            id: window.GabyData.makeId('ntf'), audience: 'client', barberId: a.barber || null,
            clientId: a.clientId || null, type: 'manual', title, body,
            appointmentCode: a.code, createdAt: now, readAt: null
        }));
        const saved = await ctx.commit(state => {
            state.notifications = state.notifications || [];
            rows.forEach(row => state.notifications.unshift(row));
        }, { success: `Aviso enviado a ${rows.length} cliente${rows.length === 1 ? '' : 's'}.`, error: 'No se pudo enviar el aviso. Intenta de nuevo.' });
        if (!saved) return;
        ui.notifyTitle = ''; ui.notifyBody = ''; ui.notifyCode = ''; ui.notifySelect = '';
        // Push al teléfono (best-effort): el aviso ya está guardado y visible en
        // la app del cliente aunque el push falle o no tenga dispositivo registrado.
        try {
            const client = await window.GabyCloud?.getClient?.();
            if (client) {
                for (const row of rows) {
                    try { await client.functions.invoke('send-push', { body: { mode: 'send', notificationId: row.id } }); } catch (_) { /* el aviso en la app ya se envió */ }
                }
            }
        } catch (_) { /* el aviso en la app ya se envió */ }
        ctx.rerender();
    }

    // --- Bandeja de solicitudes de transferencia (PR #17) ---
    function renderTransfers(ctx) {
        const mine = scopedTransferRequests(ctx);
        const filter = ui.transferFilter;
        const list = mine.filter(r => {
            if (filter === 'incoming') return r.toBarber === ctx.config.role && r.status === 'pendiente';
            if (filter === 'outgoing') return r.fromBarber === ctx.config.role && r.status === 'pendiente';
            if (filter === 'decided') return r.status !== 'pendiente';
            if (filter === 'all') return true;
            return r.status === 'pendiente';
        }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const counts = {
            pending: mine.filter(r => r.status === 'pendiente').length,
            incoming: mine.filter(r => r.toBarber === ctx.config.role && r.status === 'pendiente').length,
            outgoing: mine.filter(r => r.fromBarber === ctx.config.role && r.status === 'pendiente').length,
            decided: mine.filter(r => r.status !== 'pendiente').length
        };
        content().innerHTML = `
            <section class="card">
                <div class="section-title-row"><div class="section-title">Solicitudes de transferencia</div></div>
                <p class="item-meta">Cuando te pasan una cita, la aceptas o la rechazas aquí. La cita solo cambia de barbero al aceptar; si rechazas, sigue con el barbero original a la misma fecha y hora.</p>
                <div class="ap-chips" style="margin:12px 0;">
                    ${[['pending', `Pendientes (${counts.pending})`], ['incoming', `Recibidas (${counts.incoming})`], ['outgoing', `Enviadas (${counts.outgoing})`], ['decided', `Resueltas (${counts.decided})`], ['all', `Todas (${mine.length})`]].map(([id, label]) => `<button class="ap-chip ${filter === id ? 'active' : ''}" data-transfer-filter="${id}">${label}</button>`).join('')}
                </div>
                <div class="list-grid">${list.map(r => transferRequestCard(ctx, r)).join('') || '<div class="empty">No hay solicitudes con este filtro.</div>'}</div>
            </section>
        `;
        bindCommon(ctx);
        bindTransferResponseButtons(ctx, content());
        content().querySelectorAll('[data-transfer-filter]').forEach(b => b.addEventListener('click', () => { ui.transferFilter = b.dataset.transferFilter; renderTransfers(ctx); }));
    }

    function transferRequestCard(ctx, r) {
        const db = ctx.getDb();
        const a = db.appointments.find(item => item.code === r.appointmentCode);
        const incoming = r.toBarber === ctx.config.role;
        const statusHtml = r.status === 'pendiente'
            ? '<span class="ap-badge amber ap-badge-transfer-pending">Pendiente</span>'
            : r.status === 'aceptada'
                ? '<span class="ap-badge gold ap-badge-transferred">Aceptada · Transferida</span>'
                : '<span class="ap-badge red">Rechazada</span>';
        return `
            <div class="ap-transfer-card ${r.status === 'aceptada' ? 'accepted' : ''}">
                <div>
                    <strong>${a ? esc(a.client) : 'Cita'} · ${a ? esc(a.service) : esc(r.appointmentCode)}</strong> ${statusHtml}
                    <div class="item-meta">${esc(r.appointmentCode)}${a ? ` · <span style="text-transform:capitalize;">${esc(fmtDateTime(a))}</span>` : ''} · De ${esc(ctx.barberName(r.fromBarber))} a ${esc(ctx.barberName(r.toBarber))}</div>
                    ${r.reason ? `<div class="item-meta">Motivo: ${esc(r.reason)}</div>` : ''}
                    <div class="item-meta">Pedida ${fmtStamp(r.createdAt)}${r.decidedAt ? ` · Resuelta ${fmtStamp(r.decidedAt)}${r.decidedBy && r.decidedBy !== 'Sistema' ? ` por ${esc(ctx.barberName(r.decidedBy))}` : r.decidedBy === 'Sistema' ? ' por el sistema' : ''}` : ''}</div>
                </div>
                <div class="ap-request-actions">
                    ${a ? `<button class="action-btn notify" type="button" data-open="${esc(a.code)}">Ver cita</button>` : ''}
                    ${r.status === 'pendiente' && incoming ? `<button class="action-btn approve" type="button" data-transfer-accept="${esc(r.id)}"><i class="fas fa-check"></i> Aceptar</button><button class="action-btn reject" type="button" data-transfer-reject="${esc(r.id)}"><i class="fas fa-xmark"></i> Rechazar</button>` : ''}
                    ${r.status === 'pendiente' && !incoming ? `<span class="item-meta">Esperando respuesta de ${esc(ctx.barberName(r.toBarber))}</span>` : ''}
                </div>
            </div>`;
    }

    // Preferencia del barbero (PR #17, D): avisos de reserva/cancelación de sus citas.
    function barberPref(ctx) {
        const db = ctx.getDb();
        return (db.notificationPreferences || []).find(p => p.barberId === ctx.config.role) || null;
    }

    function barberWantsBookingNotices(ctx) {
        const p = barberPref(ctx);
        return !p || p.bookingAlerts !== false;
    }

    function renderNotifications(ctx) {
        const list = staffNotifications(ctx);
        const key = `staff:${ctx.config.role}`;
        const upcoming = upcomingAppointments(ctx);
        const sent = sentClientNotifications(ctx);
        const db = ctx.getDb();
        const allLabel = ctx.isAdmin() ? 'Todas las citas próximas' : 'Todas mis citas próximas';
        content().innerHTML = `
            <section class="card" style="margin-bottom:18px;">
                <div class="section-title">Mis avisos de reservas</div>
                <p class="item-meta">Activa o apaga los avisos cuando reserven o cancelen una cita contigo. Está activado por defecto.</p>
                <label class="policy-check"><input type="checkbox" id="ap-barber-alerts" ${barberWantsBookingNotices(ctx) ? 'checked' : ''}> Avisarme cuando reserven o cancelen</label>
                <p class="item-meta">Si lo apagas, no te llegará nada de reservas ni cancelaciones de tus citas. Los demás avisos (reseñas, transferencias, alertas) siguen igual.</p>
            </section>
            <section class="card">
                <div class="section-title">Enviar aviso a clientes</div>
                <p class="item-meta">El aviso aparece en la app del cliente y, si tiene las notificaciones activadas, también le llega al teléfono.</p>
                <form id="notify-form" class="form-grid" style="margin-top:12px;">
                    <div class="form-group full">
                        <span class="form-label">Plantillas</span>
                        <div class="ap-notify-templates">${[['tardanza', 'Tardanza'], ['recordatorio', 'Recordatorio'], ['cancelacion', 'Cancelación']].map(([id, label]) => `<button type="button" class="ap-chip" data-template="${id}">${label}</button>`).join('')}</div>
                    </div>
                    <div class="form-group"><label class="form-label" for="nt-title">Título</label><input class="form-input" id="nt-title" maxlength="80" required value="${esc(ui.notifyTitle)}"></div>
                    <div class="form-group full"><label class="form-label" for="nt-body">Mensaje</label><textarea class="form-input" id="nt-body" rows="3" required>${esc(ui.notifyBody)}</textarea></div>
                    <div class="form-group full">
                        <span class="form-label">Destinatarios</span>
                        <label class="policy-check"><input type="radio" name="nt-mode" value="one" ${ui.notifyMode !== 'all' ? 'checked' : ''}> Una cita</label>
                        <label class="policy-check"><input type="radio" name="nt-mode" value="all" ${ui.notifyMode === 'all' ? 'checked' : ''}> ${esc(allLabel)} (${upcoming.length})</label>
                    </div>
                    <div class="form-group full" id="nt-one-fields" ${ui.notifyMode === 'all' ? 'hidden' : ''}>
                        <label class="form-label" for="nt-select">Cita</label>
                        <select class="form-input" id="nt-select">
                            ${upcoming.length ? upcoming.map(a => `<option value="${esc(a.code)}" ${ui.notifySelect === a.code ? 'selected' : ''}>${esc(appointmentLabel(ctx, a))}</option>`).join('') : '<option value="" disabled>Sin citas próximas</option>'}
                        </select>
                        <label class="form-label" for="nt-code" style="margin-top:8px;">O escribe el código de la cita (si lo escribes, se usa este)</label>
                        <input class="form-input" id="nt-code" placeholder="GS-123456" maxlength="9" value="${esc(ui.notifyCode)}">
                    </div>
                    <div class="form-group full"><button class="btn btn-primary" type="submit">Enviar aviso</button></div>
                </form>
            </section>
            <section class="card" style="margin-top:18px;">
                <div class="section-title">Avisos enviados a clientes</div>
                <div class="list-grid">${sent.slice(0, 50).map(n => {
                    const appt = n.appointmentCode ? (db.appointments || []).find(a => a.code === n.appointmentCode) : null;
                    return `<div class="ap-notif ${n.readAt ? '' : 'unread'}"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><span class="item-meta">${fmtStamp(n.createdAt)}${n.appointmentCode ? ` · ${esc(n.appointmentCode)}${appt ? ` · ${esc(appt.client || '')}` : ''} · <button class="action-btn approve" data-open="${esc(n.appointmentCode)}">Ver cita</button>` : ''} · ${n.readAt ? 'Leído' : 'Sin leer'}</span></div>`;
                }).join('') || '<div class="empty">Todavía no has enviado avisos a clientes.</div>'}</div>
            </section>
            <section class="card" style="margin-top:18px;">
                <div class="section-title-row"><div class="section-title">Notificaciones</div><button class="btn btn-ghost" type="button" data-read-all>Marcar todas como leídas</button></div>
                <div class="list-grid">${list.slice(0, 100).map(n => {
                    const read = (n.readBy || []).includes(key);
                    return `<div class="ap-notif ${read ? '' : 'unread'}"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><span class="item-meta">${fmtStamp(n.createdAt)}${n.appointmentCode ? ` · <button class="action-btn approve" data-open="${n.appointmentCode}">Ver cita</button>` : ''}</span></div>`;
                }).join('') || '<div class="empty">No hay notificaciones.</div>'}</div>
            </section>
        `;
        bindCommon(ctx);
        // PR #17 (D): guardar la preferencia del barbero (commit normal: el sync la
        // sube a notification_preferences; RLS solo le deja tocar su propia fila).
        const barberAlerts = content().querySelector('#ap-barber-alerts');
        if (barberAlerts) barberAlerts.addEventListener('change', async () => {
            const on = barberAlerts.checked;
            const saved = await ctx.commit(s => {
                s.notificationPreferences = s.notificationPreferences || [];
                const id = `pref-barber-${ctx.config.role}`;
                const row = s.notificationPreferences.find(p => p.id === id);
                if (row) { row.bookingAlerts = on; row.updatedAt = new Date().toISOString(); }
                else s.notificationPreferences.unshift({ id, barberId: ctx.config.role, appointmentCode: null, bookingAlerts: on, reminders: true, messages: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            }, { success: on ? 'Avisos de reservas activados.' : 'Avisos de reservas apagados. No te llegarán reservas ni cancelaciones nuevas.', error: 'No se pudo guardar la preferencia.' });
            if (!saved) barberAlerts.checked = !on;
        });
        const form = content().querySelector('#notify-form');
        form.querySelectorAll('[data-template]').forEach(b => b.addEventListener('click', () => {
            const tpl = NOTIFY_TEMPLATES[b.dataset.template];
            if (!tpl) return;
            const code = String(ui.notifyCode || ui.notifySelect || '').trim().toUpperCase();
            const appt = /^GS-\d{6}$/.test(code) ? db.appointments.find(a => a.code === code) : null;
            ui.notifyTitle = tpl.title;
            ui.notifyBody = tpl.body(appt, ctx);
            form.querySelector('#nt-title').value = ui.notifyTitle;
            form.querySelector('#nt-body').value = ui.notifyBody;
        }));
        form.querySelector('#nt-title').addEventListener('input', e => { ui.notifyTitle = e.target.value; });
        form.querySelector('#nt-body').addEventListener('input', e => { ui.notifyBody = e.target.value; });
        form.querySelector('#nt-code').addEventListener('input', e => { ui.notifyCode = e.target.value; });
        form.querySelector('#nt-select').addEventListener('change', e => { ui.notifySelect = e.target.value; });
        form.querySelectorAll('[name="nt-mode"]').forEach(radio => radio.addEventListener('change', () => {
            ui.notifyMode = form.querySelector('[name="nt-mode"]:checked').value;
            form.querySelector('#nt-one-fields').hidden = ui.notifyMode === 'all';
        }));
        form.addEventListener('submit', event => {
            event.preventDefault();
            ui.notifyTitle = form.querySelector('#nt-title').value;
            ui.notifyBody = form.querySelector('#nt-body').value;
            ui.notifyCode = form.querySelector('#nt-code').value;
            ui.notifySelect = form.querySelector('#nt-select').value;
            sendManualNotification(ctx);
        });
        content().querySelector('[data-read-all]').addEventListener('click', () => ctx.commit(s => {
            s.notifications.forEach(n => { if (n.audience === 'staff') { n.readBy = n.readBy || []; if (!n.readBy.includes(key)) n.readBy.push(key); } });
        }, { success: 'Notificaciones marcadas como leídas.', error: 'No se pudo actualizar.' }));
    }

    function unreadCount(ctx) {
        const key = `staff:${ctx.config.role}`;
        return staffNotifications(ctx).filter(n => !(n.readBy || []).includes(key)).length;
    }

    // ---------------------------------------------------------------------
    // CONFIGURACION (perfil del barbero y datos de la barberia)
    // ---------------------------------------------------------------------
    function renderSettings(ctx) {
        const db = ctx.getDb();
        const me = db.barbers.find(b => b.id === ctx.config.role) || db.barbers[0];
        const biz = db.settings.business;
        content().innerHTML = `
            <section class="card">
                <div class="section-title">Mi perfil público</div>
                <form id="cfg-me" class="form-grid">
                    <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="me-name" value="${esc(me.name)}" required></div>
                    <div class="form-group"><label class="form-label">Alias</label><input class="form-input" id="me-alias" value="${esc(me.alias)}"></div>
                    <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="me-phone" value="${esc(me.phone)}"></div>
                    <div class="form-group"><label class="form-label">Especialidades (separadas por coma)</label><input class="form-input" id="me-spec" value="${esc((me.specialty || []).join(', '))}"></div>
                    <div class="form-group"><label class="form-label">Instagram</label><input class="form-input" id="me-ig" value="${esc(me.socials?.instagram || '')}"></div>
                    <div class="form-group"><label class="form-label">Facebook</label><input class="form-input" id="me-fb" value="${esc(me.socials?.facebook || '')}"></div>
                    <div class="form-group full"><label class="form-label">Descripción</label><textarea class="form-input" id="me-bio" rows="3">${esc(me.bio || '')}</textarea></div>
                    <div class="form-group full"><div class="item-meta">Tu horario se cambia en <button type="button" class="action-btn approve" data-go="schedule">Horarios</button>.</div><button class="btn btn-primary" type="submit">Guardar mi perfil</button></div>
                </form>
            </section>
            ${ctx.isAdmin() ? `
            <section class="card" style="margin-top:18px;">
                <div class="section-title">Datos de la barbería</div>
                <form id="cfg-biz" class="form-grid">
                    <div class="form-group"><label class="form-label">Nombre de la barbería</label><input class="form-input" id="bz-name" value="${esc(biz.name)}" required></div>
                    <div class="form-group"><label class="form-label">Logo (URL)</label><input class="form-input" id="bz-logo" value="${esc(biz.logo)}"></div>
                    <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="bz-phone" value="${esc(biz.phone)}"></div>
                    <div class="form-group"><label class="form-label">Correo</label><input class="form-input" type="email" id="bz-email" value="${esc(biz.email)}"></div>
                    <div class="form-group full"><label class="form-label">Dirección</label><input class="form-input" id="bz-address" value="${esc(biz.address)}"></div>
                    <div class="form-group"><label class="form-label">Instagram</label><input class="form-input" id="bz-ig" value="${esc(biz.socials?.instagram || '')}"></div>
                    <div class="form-group"><label class="form-label">Facebook</label><input class="form-input" id="bz-fb" value="${esc(biz.socials?.facebook || '')}"></div>
                    <div class="form-group full"><label class="form-label">Aviso principal en la página</label><textarea class="form-input" id="bz-notice" rows="2">${esc(db.settings.closureNotice || '')}</textarea></div>
                    <div class="form-group full"><label class="form-label">Horario de la barbería</label><div class="item-meta">${esc(B().shopHoursSummary())} · Domingo y lunes cerrado. Es el mismo para todos los barberos y no se puede reservar fuera de él.</div></div>
                    <div class="form-group full"><button class="btn btn-primary" type="submit">Guardar datos de la barbería</button></div>
                </form>
            </section>` : ''}
        `;
        bindCommon(ctx);
        content().querySelector('#cfg-me').addEventListener('submit', event => {
            event.preventDefault();
            const v = id => content().querySelector(id).value.trim();
            ctx.commit(s => {
                const b = s.barbers.find(x => x.id === me.id);
                Object.assign(b, { name: v('#me-name'), alias: v('#me-alias'), phone: v('#me-phone'), bio: v('#me-bio'), specialty: v('#me-spec').split(',').map(x => x.trim()).filter(Boolean), socials: { instagram: v('#me-ig'), facebook: v('#me-fb') } });
            }, { success: 'Perfil guardado.', error: 'No se pudo guardar el perfil.' });
        });
        content().querySelector('#cfg-biz')?.addEventListener('submit', event => {
            event.preventDefault();
            const v = id => content().querySelector(id).value.trim();
            ctx.commit(s => {
                s.settings.business = { ...s.settings.business, name: v('#bz-name'), logo: v('#bz-logo'), phone: v('#bz-phone'), email: v('#bz-email'), address: v('#bz-address'), socials: { instagram: v('#bz-ig'), facebook: v('#bz-fb') } };
                s.settings.closureNotice = v('#bz-notice');
            }, { success: 'Datos de la barbería guardados.', error: 'No se pudieron guardar los datos.' });
        });
    }

    // ---------------------------------------------------------------------
    const RENDERERS = {
        dashboard: renderDashboard, calendar: renderCalendar, appointments: renderAppointments, clients: renderClients,
        services: renderServices, schedule: renderSchedule, reviews: renderReviews,
        inventory: renderInventory, notifications: renderNotifications, settings: renderSettings, transfers: renderTransfers
    };

    window.GabyAdminPro = {
        has: id => Boolean(RENDERERS[id]),
        render: (id, ctx) => RENDERERS[id](ctx),
        badge: (id, ctx) => {
            if (id === 'notifications') return unreadCount(ctx);
            if (id === 'appointments') return pendingRequests(ctx).length;
            if (id === 'transfers') return incomingTransferRequests(ctx).length;
            if (id === 'inventory') return ctx.getDb().inventory.filter(i => Number(i.qty) <= Number(i.minQty)).length;
            return 0;
        },
        renderReports,
        openAppointment,
        openNewAppointment
    };
})();
