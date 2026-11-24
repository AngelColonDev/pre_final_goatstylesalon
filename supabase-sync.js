(function () {
    // =========================================================================
    // GabyCloud: puente entre los datos locales (shared-data.js) y Supabase.
    // - Si supabase-config.js esta vacio: no hace nada (GabyCloud.enabled = false).
    // - Si esta configurado:
    //     * al abrir una página descarga lo que el usuario puede ver (RLS decide) y lo pone en el estado local;
    //     * cada cambio guardado con GabyData.updateState/commit se compara con el estado anterior
    //       y se envia a Supabase (upsert de lo nuevo/cambiado, delete de lo borrado);
    //     * el inicio y cierre de sesión del personal pasan por Supabase Auth
    //       (las contraseñas nunca se guardan en el navegador);
    //     * los clientes no tienen cuenta: reservan y reseñan con su nombre completo.
    // =========================================================================
    const config = window.GABY_SUPABASE || {};
    const enabled = Boolean(config.url && config.anonKey);
    const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

    let clientPromise = null;
    let applyingRemote = false;

    function loadLibrary() {
        if (window.supabase && window.supabase.createClient) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = SUPABASE_JS;
            script.onload = () => resolve();
            script.onerror = () => reject(withMessage(new Error('supabase-js'), 'No se pudo conectar con el servidor. Revisa tu conexion a internet.'));
            document.head.appendChild(script);
        });
    }

    function getClient() {
        if (!enabled) return Promise.resolve(null);
        if (!clientPromise) {
            clientPromise = loadLibrary().then(() => window.supabase.createClient(config.url, config.anonKey, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
            }));
        }
        return clientPromise;
    }

    function withMessage(error, message) {
        error.userMessage = message;
        return error;
    }

    // Traduce errores comunes de Supabase a mensajes claros para el usuario.
    function friendly(error) {
        const raw = String((error && (error.message || error.error_description)) || error || '');
        if (/Invalid login credentials/i.test(raw)) return 'Correo o contraseña incorrectos.';
        if (/Password should be at least/i.test(raw)) return 'La contraseña es muy corta (mínimo 6 caracteres).';
        if (/row-level security|permission denied/i.test(raw)) return 'No tienes permiso para hacer este cambio.';
        if (/Failed to fetch|NetworkError/i.test(raw)) return 'No hay conexion con el servidor. Intenta de nuevo.';
        return raw || 'Ocurrio un error inesperado.';
    }

    function raise(error) {
        throw withMessage(error instanceof Error ? error : new Error(friendly(error)), friendly(error));
    }

    // -------------------------------------------------------------------------
    // Correspondencia entre colecciones locales y tablas de Supabase
    // -------------------------------------------------------------------------
    const toDate = value => (value ? new Date(value).toISOString() : null);
    const toLocalDateTime = value => {
        if (!value) return '';
        const d = new Date(value);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const tables = {
        barbers: {
            table: 'barbers', key: 'id',
            toRow: b => ({ id: b.id, name: b.name, alias: b.alias || '', email: b.email || null, phone: b.phone || '', specialty: b.specialty || [], bio: b.bio || '', avatar_url: b.avatar || '', is_admin: Boolean(b.isAdmin), active: b.active !== false, years_experience: Number(b.yearsExperience || 0), vip_clients: Number(b.vipClients || 0), schedule: b.schedule || '', socials: b.socials || {}, certifications: b.certifications || [], before_after: b.beforeAfter || [], gallery: b.gallery || [], updated_at: new Date().toISOString() }),
            fromRow: r => ({ id: r.id, name: r.name, alias: r.alias, email: r.email, phone: r.phone, specialty: r.specialty || [], bio: r.bio, avatar: r.avatar_url, isAdmin: r.is_admin, active: r.active, yearsExperience: r.years_experience, vipClients: r.vip_clients, schedule: r.schedule, socials: r.socials || {}, certifications: r.certifications || [], beforeAfter: r.before_after || [], gallery: r.gallery || [] })
        },
        services: {
            table: 'services', key: 'id',
            toRow: s => ({ id: s.id, name: s.name, price: s.price || '', duration: s.duration || '', description: s.description || '', active: s.active !== false, requests: Number(s.requests || 0) }),
            fromRow: r => ({ id: r.id, name: r.name, price: r.price, duration: r.duration, description: r.description, active: r.active, requests: r.requests })
        },
        products: {
            table: 'products', key: 'id',
            toRow: p => ({ id: p.id, barber_id: p.barberId, name: p.name, description: p.desc || '', price: p.price || '', stock: Number(p.stock || 0), sold: Number(p.sold || 0), image_url: p.image || '', active: p.active !== false }),
            fromRow: r => ({ id: r.id, barberId: r.barber_id, name: r.name, desc: r.description, price: r.price, stock: r.stock, sold: r.sold, image: r.image_url, active: r.active })
        },
        gallery: {
            table: 'gallery', key: 'id',
            toRow: g => ({ id: g.id, title: g.title || '', barber_id: g.barber || null, image_url: g.image }),
            fromRow: r => ({ id: r.id, title: r.title, barber: r.barber_id, image: r.image_url })
        },
        news: {
            table: 'news', key: 'id',
            toRow: n => ({ id: n.id, author_id: n.authorId || null, author_name: n.authorName || '', role: n.role || '', title: n.title, body: n.body || '', image_url: n.image || '', likes: Number(n.likes || 0), comments: Number(n.comments || 0), created_at: toDate(n.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ id: r.id, authorId: r.author_id, authorName: r.author_name, role: r.role, title: r.title, body: r.body, image: r.image_url, likes: r.likes, comments: r.comments, createdAt: r.created_at })
        },
        providers: {
            table: 'providers', key: 'id', staffOnly: true,
            toRow: p => ({ id: p.id, name: p.name, category: p.category || '', contact: p.contact || '', phone: p.phone || '', status: p.status || 'Activo' }),
            fromRow: r => ({ id: r.id, name: r.name, category: r.category, contact: r.contact, phone: r.phone, status: r.status })
        },
        clients: {
            // Fichas de clientes que maneja el personal (los clientes no tienen cuenta).
            table: 'clients', key: 'id', staffOnly: true,
            toRow: c => ({ id: c.id, name: c.name, email: c.email || '', phone: c.phone || '', birth_date: c.birthDate || null, haircut: c.haircut || '', beard: c.beard || '', preferred_barber: c.preferredBarber || null, photo_url: c.photo || '', consent: c.consent || null, marketing_consent: c.marketingConsent || null, registered_at: toDate(c.registeredAt) || new Date().toISOString() }),
            fromRow: r => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, birthDate: r.birth_date || '', haircut: r.haircut, beard: r.beard, preferredBarber: r.preferred_barber, photo: r.photo_url, consent: r.consent, marketingConsent: r.marketing_consent, registeredAt: r.registered_at })
        },
        appointments: {
            table: 'appointments', key: 'code',
            toRow: a => ({ code: a.code, client_id: a.clientId || null, client_name: a.client || '', client_email: a.clientEmail || '', service: a.service, price: a.price || '', barber_id: a.barber || null, status: a.status || 'PENDIENTE', date_time: toDate(a.dateTime), vip_details: a.vipDetails || null, policy_acceptance: a.policyAcceptance || null, canceled_by_client: Boolean(a.canceledByClient), canceled_at: toDate(a.canceledAt), cancellation_alert_seen_by: a.cancellationAlertSeenBy || [], created_at: toDate(a.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ code: r.code, clientId: r.client_id, client: r.client_name, clientEmail: r.client_email, service: r.service, price: r.price, barber: r.barber_id, status: r.status, dateTime: toLocalDateTime(r.date_time), vipDetails: r.vip_details, policyAcceptance: r.policy_acceptance, canceledByClient: r.canceled_by_client, canceledAt: r.canceled_at, cancellationAlertSeenBy: r.cancellation_alert_seen_by || [], createdAt: r.created_at })
        },
        reviews: {
            table: 'reviews', key: 'id',
            toRow: r => ({ id: r.id, client_id: r.clientId || null, client_name: r.clientName || 'Cliente', barber: r.barber || '', barber_id: r.barberId || null, appointment_code: r.appointmentCode || null, service: r.service || '', service_date: r.serviceDate || null, publish_consent: typeof r.publishConsent === 'boolean' ? r.publishConsent : null, hidden_reason: r.hiddenReason || '', hidden_by: r.hiddenBy || '', hidden_at: toDate(r.hiddenAt), rating: Number(r.rating), text: r.text || '', status: r.status || 'APROBADA', created_at: toDate(r.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ id: r.id, clientId: r.client_id, clientName: r.client_name, barber: r.barber, barberId: r.barber_id, appointmentCode: r.appointment_code, service: r.service, serviceDate: r.service_date, publishConsent: r.publish_consent, hiddenReason: r.hidden_reason, hiddenBy: r.hidden_by, hiddenAt: r.hidden_at, rating: r.rating, text: r.text, status: r.status, createdAt: r.created_at, publishedAt: r.published_at ?? null })
        },
        activity: {
            table: 'activity_log', key: 'id', staffOnly: true, noDelete: true,
            toRow: a => ({ id: a.id, type: a.type || '', text: a.text || '', created_at: toDate(a.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ id: r.id, type: r.type, text: r.text, createdAt: r.created_at })
        },
        barberApplications: {
            table: 'barber_applications', key: 'id', staffOnly: true, noDelete: true,
            toRow: a => ({ id: a.id, data: a, created_at: toDate(a.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ ...(r.data || {}), id: r.id })
        },
        memos: {
            table: 'memos', key: 'id', staffOnly: true,
            toRow: m => ({ id: m.id, client_id: m.clientId || null, data: m, created_at: toDate(m.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ ...(r.data || {}), id: r.id })
        },
        payments: {
            table: 'payments', key: 'id', staffOnly: true,
            toRow: p => ({ id: p.id, client_id: p.clientId || null, data: p, created_at: toDate(p.paidAt || p.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ ...(r.data || {}), id: r.id })
        },
        discounts: {
            table: 'discounts', key: 'id', staffOnly: true,
            toRow: d => ({ id: d.id, client_id: d.clientId || null, data: d, created_at: toDate(d.appliedAt || d.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ ...(r.data || {}), id: r.id })
        },
        notifications: {
            // Avisos del centro de notificaciones. El personal los ve todos por sync;
            // el cliente solo los suyos, por código de cita, con myNotifications() (RPC).
            // Sin sesión del personal, el visitante solo puede insertar avisos de cliente
            // (la política notifications_staff_insert exige is_staff()): si el aviso del
            // personal entrara en el push, toda la inserción fallaría por RLS y la reserva
            // no mostraría la confirmación. El aviso del personal se queda solo en local.
            // staffRole se lee en tiempo de llamada (diff/push), no en la definición,
            // así que no hay problema de TDZ aunque se declare después del mapa.
            table: 'notifications', key: 'id', staffOnly: true,
            filter: n => staffRole ? true : n.audience === 'client',
            toRow: n => ({ id: n.id, audience: n.audience || 'staff', barber_id: n.barberId || null, client_id: n.clientId || null, type: n.type || '', title: n.title || '', body: n.body || '', appointment_code: n.appointmentCode || null, read_at: toDate(n.readAt), created_at: toDate(n.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ id: r.id, audience: r.audience, barberId: r.barber_id, clientId: r.client_id, type: r.type, title: r.title, body: r.body, appointmentCode: r.appointment_code, readAt: r.read_at, createdAt: r.created_at })
        },
        pushTokens: {
            // Suscripciones push de cada dispositivo (FCM). Sin borrado por sync:
            // un token viejo se limpia en el servidor cuando FCM lo rechaza.
            table: 'push_tokens', key: 'id', staffOnly: true, noDelete: true,
            toRow: t => ({ id: t.id, endpoint: t.endpoint || '', keys_p256dh: (t.keys && t.keys.p256dh) || '', keys_auth: (t.keys && t.keys.auth) || '', appointment_codes: t.appointmentCodes || [], barber_id: t.barberId || null, user_agent: t.userAgent || '', created_at: toDate(t.createdAt) || new Date().toISOString() }),
            fromRow: r => ({ id: r.id, endpoint: r.endpoint, keys: { p256dh: r.keys_p256dh || '', auth: r.keys_auth || '' }, appointmentCodes: r.appointment_codes || [], barberId: r.barber_id, userAgent: r.user_agent || '', createdAt: r.created_at })
        }
    };

    // Campos de la plataforma de citas que el esquema anterior descartaba.
    // Se mapean explícitamente para no enviar contraseñas ni estado de sesión.
    function extendFields(collection, fields) {
        const map = tables[collection];
        const toRow = map.toRow;
        const fromRow = map.fromRow;
        map.toRow = item => {
            const row = toRow(item);
            fields.forEach(([local, remote, fallback]) => { row[remote] = item[local] ?? fallback; });
            return row;
        };
        map.fromRow = row => {
            const item = fromRow(row);
            fields.forEach(([local, remote, fallback]) => { item[local] = row[remote] ?? fallback; });
            return item;
        };
    }
    extendFields('barbers', [['weeklySchedule', 'weekly_schedule', null]]);
    extendFields('reviews', [['clientPhoto', 'client_photo', '']]);
    extendFields('services', [['minutes', 'minutes', 40], ['category', 'category', 'Cortes'], ['image', 'image_url', ''], ['barbers', 'barber_ids', []]]);
    extendFields('clients', [['status', 'status', 'Activo'], ['address', 'address', ''], ['altPhones', 'alt_phones', []], ['lastModifiedAt', 'last_modified_at', null]]);
    extendFields('appointments', [
        ['duration', 'duration', 40], ['services', 'services', []], ['history', 'history', []],
        ['clientPhone', 'client_phone', ''], ['barberName', 'barber_name', ''], ['source', 'source', 'online'],
        ['notes', 'notes', ''], ['completedAt', 'completed_at', null], ['noShowAt', 'no_show_at', null],
        ['canceledBy', 'canceled_by', ''], ['cancelReason', 'cancel_reason', ''],
        ['lateCancellation', 'late_cancellation', false], ['reminderSentAt', 'reminder_sent_at', null],
        ['reminder1hSentAt', 'reminder_1h_sent_at', null],
        ['attendance', 'attendance', null], ['referencePhoto', 'reference_photo', ''], ['unknownCut', 'unknown_cut', false]
    ]);

    // -------------------------------------------------------------------------
    // Descargar (pull)
    // -------------------------------------------------------------------------
    let staffRole = null; // { barber_id, is_admin } si el usuario es del personal

    async function loadStaffRole(client, userId) {
        if (!userId) return null;
        const { data } = await client.from('staff_roles').select('barber_id, is_admin, is_developer').eq('user_id', userId).maybeSingle();
        return data || null;
    }

    async function pull() {
        const client = await getClient();
        if (!client) return;
        const { data: { session } } = await client.auth.getSession();
        const userId = session && session.user ? session.user.id : null;
        staffRole = await loadStaffRole(client, userId);

        const results = {};
        const { data: busySlots, error: busyError } = await client.rpc('booking_busy_slots');
        if (busyError) console.warn('[GabyCloud] No se pudo actualizar la disponibilidad:', busyError.message);
        let attempted = 0;
        let failed = 0;
        await Promise.all(Object.entries(tables).map(async ([collection, map]) => {
            if (map.staffOnly && !staffRole) return;
            attempted += 1;
            const { data, error } = await client.from(map.table).select('*');
            if (error) {
                failed += 1;
                console.warn(`[GabyCloud] No se pudo leer ${map.table}:`, error.message);
                return;
            }
            results[collection] = data.map(map.fromRow);
        }));
        // Si no se pudo leer nada, el servidor no está disponible: se mantienen los datos locales.
        if (attempted && failed === attempted) raise(new Error('Failed to fetch'));

        const { data: settingsRow } = await client.from('shop_settings').select('*').eq('id', 1).maybeSingle();
        // Modo mantenimiento global (lo cambia el desarrollador desde ops/).
        const { data: siteConfig } = await client.from('site_config').select('maintenance').eq('id', 1).maybeSingle();
        // Bloqueos de cuentas (solo el desarrollador puede leerlos).
        let locks = null;
        if (staffRole && staffRole.is_developer) {
            const { data, error } = await client.rpc('locked_accounts');
            if (!error) locks = data;
        }

        applyingRemote = true;
        try {
            const state = window.GabyData.getState();
            state.busySlots = (busySlots || []).map(row => ({ barber: row.barber_id, dateTime: toLocalDateTime(row.date_time), duration: row.duration, code: row.own_code }));
            Object.entries(results).forEach(([collection, rows]) => { state[collection] = rows; });
            if (!staffRole) Object.entries(tables).forEach(([collection, map]) => { if (map.staffOnly) state[collection] = []; });
            // Avisos del cliente: no puede leer la tabla; los pide por sus códigos de cita (RPC my_notifications).
            if (!staffRole) {
                const codes = myAppointmentCodes();
                if (codes.length) {
                    try { state.notifications = await myNotifications(codes); }
                    catch (error) { console.warn('[GabyCloud] No se pudieron leer tus avisos:', error.message); }
                }
            }
            if (!staffRole && !results.appointments) state.appointments = [];
            if (settingsRow) {
                state.settings.shopMode = settingsRow.shop_mode;
                state.settings.closureNotice = settingsRow.closure_notice || '';
                if (settingsRow.business && Object.keys(settingsRow.business).length) state.settings.business = { ...state.settings.business, ...settingsRow.business };
                if (settingsRow.booking && Object.keys(settingsRow.booking).length) {
                    const remoteBooking = settingsRow.booking;
                    state.settings.booking = {
                        ...state.settings.booking,
                        ...remoteBooking,
                        cancellationPolicyVersion: remoteBooking.cancellationPolicyVersion
                    };
                }
                if (settingsRow.service_categories?.length) state.settings.serviceCategories = settingsRow.service_categories;
            }
            if (siteConfig && siteConfig.maintenance && Object.keys(siteConfig.maintenance).length) {
                state.settings.maintenance = { ...state.settings.maintenance, ...siteConfig.maintenance };
            }
            if (locks) state.security.locks = locks;
            window.GabyData.saveState(state);
        } finally {
            applyingRemote = false;
        }
        window.dispatchEvent(new CustomEvent('gabycloudready', { detail: { userId, staffRole } }));
    }

    // -------------------------------------------------------------------------
    // Subir cambios (push): se ejecuta después de cada updateState
    // -------------------------------------------------------------------------
    function diff(map, before, after) {
        const keyOf = item => item[map.key];
        const ok = item => !map.filter || map.filter(item);
        const prevById = new Map((before || []).filter(ok).map(item => [keyOf(item), item]));
        const nextById = new Map((after || []).filter(ok).map(item => [keyOf(item), item]));
        const inserts = [];
        const updates = [];
        const deletes = [];
        nextById.forEach((item, key) => {
            const prev = prevById.get(key);
            if (!prev) inserts.push(map.toRow(item));
            else if (JSON.stringify(prev) !== JSON.stringify(item)) updates.push(map.toRow(item));
        });
        if (!map.noDelete) prevById.forEach((item, key) => { if (!nextById.has(key)) deletes.push(key); });
        return { inserts, updates, deletes };
    }

    async function push(previous, next) {
        if (applyingRemote) return;
        const client = await getClient();
        if (!client) return;
        const failures = [];
        // Avisos de cliente recién insertados en este push: cuando el guardado
        // termina bien se les envía el push al teléfono (ver abajo).
        const newClientNotices = [];
        for (const [collection, map] of Object.entries(tables)) {
            const { inserts, updates, deletes } = diff(map, previous[collection], next[collection]);
            // insert para lo nuevo (algunas tablas solo permiten crear) y update fila por fila para lo cambiado.
            if (inserts.length) {
                const { error } = await client.from(map.table).insert(inserts);
                if (error) failures.push(error);
                else if (collection === 'notifications') {
                    // Solo avisos de cliente (los del personal no van al teléfono
                    // del cliente) y nunca los manuales: el compositor del panel
                    // ya les envía el push él mismo después de guardar
                    // (staff/admin-pro.js), y si lo hiciéramos aquí también el
                    // cliente recibiría el aviso dos veces.
                    inserts
                        .filter(row => row.audience === 'client' && row.type !== 'manual')
                        .forEach(row => newClientNotices.push(row.id));
                }
            }
            for (const row of updates) {
                const { error } = await client.from(map.table).update(row).eq(map.key, row[map.key]);
                if (error) failures.push(error);
            }
            if (deletes.length) {
                const { error } = await client.from(map.table).delete().in(map.key, deletes);
                if (error) failures.push(error);
            }
        }
        const settingsChanged = ['shopMode', 'closureNotice', 'business', 'booking', 'serviceCategories'].some(key => JSON.stringify(previous.settings[key]) !== JSON.stringify(next.settings[key]));
        if (settingsChanged && staffRole && staffRole.is_admin) {
            const { error } = await client.from('shop_settings').upsert({ id: 1, shop_mode: next.settings.shopMode, closure_notice: next.settings.closureNotice || '', business: next.settings.business, booking: next.settings.booking, service_categories: next.settings.serviceCategories, updated_at: new Date().toISOString() });
            if (error) failures.push(error);
        }
        const maintenanceChanged = JSON.stringify(previous.settings.maintenance) !== JSON.stringify(next.settings.maintenance);
        if (maintenanceChanged && staffRole && staffRole.is_developer) {
            const { error } = await client.from('site_config').upsert({ id: 1, maintenance: next.settings.maintenance, updated_at: new Date().toISOString() });
            if (error) failures.push(error);
        }
        if (failures.length) {
            console.error('[GabyCloud] Error al guardar en Supabase:', failures);
            raise(failures[0]);
        }
        // Push al teléfono (best-effort): el aviso ya está guardado y visible
        // en la app aunque el push falle o no haya dispositivo registrado.
        // No se espera la respuesta: no debe retrasar ni romper el guardado.
        // Solo se invoca cuando todo el guardado terminó bien, para no avisar
        // de un aviso que se deshizo por un error en otra tabla.
        if (newClientNotices.length && client.functions && typeof client.functions.invoke === 'function') {
            for (const id of newClientNotices) {
                try {
                    const sent = client.functions.invoke('send-push', { body: { mode: 'send', notificationId: id } });
                    if (sent && typeof sent.catch === 'function') sent.catch(() => { /* el aviso en la app ya se envió */ });
                } catch (_) { /* el aviso en la app ya se envió */ }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Autenticación (solo personal)
    // -------------------------------------------------------------------------
    async function signIn(email, password) {
        const client = await getClient();
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) raise(error);
        await pull();
        return { user: data.user, staffRole };
    }

    async function signOut() {
        const client = await getClient();
        if (client) await client.auth.signOut();
        staffRole = null;
        await pull();
    }

    async function updatePassword(password) {
        const client = await getClient();
        const { error } = await client.auth.updateUser({ password });
        if (error) raise(error);
    }

    // Personal: inicia sesión y devuelve a que panel debe ir.
    async function staffSignIn(email, password) {
        const result = await signIn(email, password);
        if (!result.staffRole) {
            await signOut();
            throw withMessage(new Error('not staff'), 'Esta cuenta no pertenece al personal.');
        }
        const folder = { gabriel: 'gaby', darialex: 'darialex', wilo: 'wilo' }[result.staffRole.barber_id] || result.staffRole.barber_id;
        return { portal: `staff/${folder}/index.html`, role: result.staffRole };
    }

    // Verifica que la persona del panel tenga sesión de personal con el rol correcto.
    async function requireStaff(barberId, isAdminPanel) {
        await ready;
        if (!staffRole) return false;
        if (staffRole.is_admin) return true;
        return !isAdminPanel && staffRole.barber_id === barberId;
    }

    // Estado de una cita por su código (los visitantes no pueden leer la tabla de citas).
    async function transferClient(clientId, toBarberId, expectedBarberId) {
        const client = await getClient();
        const { data, error } = await client.rpc('transfer_client', {
            p_client_id: clientId, p_to_barber_id: toBarberId, p_expected_barber_id: expectedBarberId || null
        });
        if (error) raise(error);
        const state = window.GabyData.getState();
        const record = state.clients.find(item => item.id === clientId);
        if (record) {
            record.preferredBarber = toBarberId;
            record.lastModifiedAt = data;
            window.GabyData.saveState(state);
        }
    }

    // Transfiere UNA cita a otro barbero (RPC SECURITY DEFINER: el personal no
    // puede cambiar el barbero por sync directo — la política
    // appointments_staff_update exige que la fila nueva sea del mismo barbero).
    // La RPC actualiza la cita y su historial en el servidor; aquí se refleja
    // el mismo cambio en local con saveState (sin commit) para que el próximo
    // commit no intente subirlo por sync. Los avisos los crea después el motor
    // (GabyBooking.transferAppointment) en un commit normal.
    // Devuelve la cita actualizada o null si no hay Supabase.
    async function transferAppointment(code, toBarberId, actorName) {
        const client = await getClient();
        if (!client) return null;
        const { data, error } = await client.rpc('transfer_appointment', {
            p_code: String(code || '').trim().toUpperCase(), p_to_barber_id: toBarberId, p_by: actorName || 'Personal'
        });
        if (error) raise(error);
        if (!data) return null;
        const row = tables.appointments.fromRow(data);
        const state = window.GabyData.getState();
        const local = (state.appointments || []).find(item => item.code === row.code);
        if (local) {
            local.barber = row.barber;
            local.barberName = row.barberName;
            local.history = row.history;
            window.GabyData.saveState(state);
        }
        return row;
    }

    // Elimina una cita y sus avisos (RPC SECURITY DEFINER: solo el admin puede
    // borrar citas por sync directo — appointments_admin_delete). Como en la
    // transferencia, el borrado local va por saveState (sin commit) para que el
    // próximo commit no intente borrarlo por sync.
    async function deleteAppointment(code) {
        const client = await getClient();
        if (!client) return false;
        const { data, error } = await client.rpc('delete_appointment', {
            p_code: String(code || '').trim().toUpperCase()
        });
        if (error) raise(error);
        if (!data) return false;
        const state = window.GabyData.getState();
        state.appointments = (state.appointments || []).filter(item => item.code !== code);
        state.notifications = (state.notifications || []).filter(item => item.appointmentCode !== code);
        window.GabyData.saveState(state);
        return true;
    }

    // Envía el push de UN aviso que ya existe (misma llamada que hace el
    // compositor de avisos). Best-effort: nunca lanza; el aviso en la app ya
    // está guardado aunque el push falle. Se usa para avisos del personal
    // (por ejemplo, la transferencia), que el guardado automático no empuja:
    // push() solo empuja avisos de cliente.
    async function sendPushForNotification(notificationId) {
        try {
            const client = await getClient();
            if (!client || !client.functions || typeof client.functions.invoke !== 'function') return false;
            if (!notificationId) return false;
            await client.functions.invoke('send-push', { body: { mode: 'send', notificationId } });
            return true;
        } catch (error) {
            console.error('[GabyCloud] No se pudo enviar el push del aviso:', error);
            return false;
        }
    }

    // Códigos de las citas reservadas desde este navegador (sin cuenta).
    function myAppointmentCodes() {
        try {
            const list = JSON.parse(localStorage.getItem('gs_my_appointments') || '[]');
            return Array.isArray(list) ? list.map(item => item && item.code).filter(Boolean) : [];
        } catch (_) { return []; }
    }

    // Avisos del cliente por sus códigos de cita (sin cuenta). El servidor solo
    // devuelve avisos de cliente de esos códigos (RPC my_notifications).
    async function myNotifications(codes) {
        const client = await getClient();
        if (!client || !codes || !codes.length) return [];
        const { data, error } = await client.rpc('my_notifications', { p_codes: codes });
        if (error) raise(error);
        return (data || []).map(tables.notifications.fromRow);
    }

    async function appointmentStatus(code) {
        const client = await getClient();
        const { data, error } = await client.rpc('appointment_status', { p_code: code });
        if (error) raise(error);
        const row = Array.isArray(data) ? data[0] : data;
        return row ? { code: row.code, status: row.status, service: row.service, dateTime: toLocalDateTime(row.date_time), barberName: row.barber_name || '' } : null;
    }

    // Marca avisos de cliente como leídos en la base de datos (RPC SECURITY
    // DEFINER: anon no puede hacer UPDATE directo sobre notifications bajo RLS,
    // aunque la política notifications_client_update lo permita; verificado en
    // vivo: el UPDATE devuelve 0 filas). Devuelve cuántos avisos se marcaron.
    // Nunca lanza: si falla, el aviso queda marcado solo en este navegador y se
    // reintentará la próxima vez que se abra la página. Sin configuración de
    // Supabase no hace nada.
    async function markNotificationsRead(ids, codes) {
        try {
            const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
            const known = Array.isArray(codes) ? codes.filter(Boolean) : [];
            if (!list.length || !known.length) return 0;
            const client = await getClient();
            if (!client) return 0;
            const { data, error } = await client.rpc('mark_my_notifications_read', { p_ids: list, p_codes: known });
            if (error) throw error;
            return Array.isArray(data) ? data.length : 0;
        } catch (error) {
            console.error('[GabyCloud] No se pudo marcar como leído en el servidor:', error);
            return 0;
        }
    }

    // Registra o renueva el token push de este dispositivo (RPC SECURITY
    // DEFINER: el visitante no puede mantener sus códigos al día con el sync
    // normal — pull() vacía pushTokens para anon, así que el UPDATE directo
    // nunca llega y cada activación insertaba otra fila con el mismo endpoint.
    // La RPC une los códigos por endpoint y borra duplicados). Devuelve el id
    // de la fila o null si no se pudo registrar. Nunca lanza: si falla, el
    // push queda como estaba y se reintentará en la próxima apertura.
    // Sin configuración de Supabase no hace nada.
    async function registerPushToken(endpoint, codes, userAgent) {
        try {
            if (!endpoint) return null;
            const list = Array.isArray(codes) ? codes.filter(Boolean) : [];
            const client = await getClient();
            if (!client) return null;
            const { data, error } = await client.rpc('register_push_token', { p_endpoint: endpoint, p_codes: list, p_user_agent: userAgent || '' });
            if (error) throw error;
            return (typeof data === 'string' && data) ? data : null;
        } catch (error) {
            console.error('[GabyCloud] No se pudo registrar el token push en el servidor:', error);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    let ready = Promise.resolve();
    if (enabled) {
        window.GabyData.addCommitHook(push);
        ready = pull().catch(error => {
            console.error('[GabyCloud] Error al descargar datos:', error);
            const warn = () => window.GabyToast && window.GabyToast.show('No se pudo conectar con el servidor. Algunos datos pueden no estar actualizados.', 'warning');
            if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', warn);
            else warn();
        });
    }

    window.GabyCloud = {
        enabled,
        get ready() { return ready; },
        get staffRole() { return staffRole; },
        getClient,
        pull,
        signIn,
        signOut,
        updatePassword,
        staffSignIn,
        requireStaff,
        appointmentStatus,
        myNotifications,
        markNotificationsRead,
        registerPushToken,
        myAppointmentCodes,
        transferClient,
        transferAppointment,
        deleteAppointment,
        sendPushForNotification,
        friendly
    };
})();
