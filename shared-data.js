(function () {
    // Horario de la barbería, igual para todos los barberos (0 = domingo; null = cerrado).
    const SHOP_HOURS = [null, null, { open: '08:00', close: '18:00' }, { open: '08:00', close: '18:00' }, { open: '08:00', close: '18:00' }, { open: '08:00', close: '20:00' }, { open: '07:00', close: '17:00' }];
    const SCHEDULE_TEXT = 'Martes a jueves 8:00 AM – 6:00 PM · Viernes 8:00 AM – 8:00 PM · Sábado 7:00 AM – 5:00 PM · Domingo y lunes cerrado';

    // Ajusta un horario semanal al de la barbería y conserva los descansos que estén dentro.
    function applyShopHours(week) {
        return SHOP_HOURS.map((hours, day) => {
            const saved = (Array.isArray(week) && week[day]) || {};
            if (!hours) return { off: true, start: '08:00', end: '18:00', breaks: [] };
            const breaks = (saved.breaks || []).filter(br => br.start >= hours.open && br.end <= hours.close);
            return { off: false, start: hours.open, end: hours.close, breaks };
        });
    }

    const STORAGE_KEY = 'gs_crm';

    const defaultState = {
        settings: {
            shopMode: 'online',
            closureNotice: '',
            defaultLanguage: 'es',
            theme: 'dark',
            // Datos del negocio (Configuracion general del panel).
            business: {
                name: 'Goat Style Salon',
                logo: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783972135/b3a13ac1-cac2-4367-9c0d-5946397d4ff9-removebg-preview_xhkncw.png',
                phone: '787-218-1068',
                email: '',
                address: 'Barranquitas, Puerto Rico',
                socials: { instagram: 'https://www.instagram.com/gabystylee_', facebook: 'https://www.facebook.com/share/1F6o7gHn9A/' },
                // Horario de apertura de la barberia (0 = domingo). null = cerrado.
                hours: SHOP_HOURS.map(hours => hours && { ...hours })
            },
            // Reglas de reservacion (Configuracion general del panel).
            booking: {
                // Las citas en linea quedan Pendientes hasta que el barbero las apruebe o rechace.
                // El horario queda apartado desde que el cliente la pide (no se puede reservar dos veces).
                autoConfirm: false,
                approvalFlowVersion: 1,
                unknownCutMinutes: 40,
                slotStep: 15,
                minNoticeHours: 2,
                maxAdvanceDays: 30,
                maxFutureAppointments: 3,
                cancellationPolicyVersion: 1,
                cancelPolicyHours: 2,
                lateCancelFee: 'el precio total de los servicios reservados',
                onlineChangeMinHours: 2,
                graceMinutes: 10,
                reminderHours: 24,
                frequentClientVisits: 5,
                noShowRules: { enabled: true, warnAt: 1, alertAt: 2, blockAt: 3 }
            },
            // Preferencias de avisos del cliente (notificaciones.html y settings-notifications.html).
            notifications: {
                reminders: true,       // recordatorios 24 h y 1 h antes de la cita
                bookings: true,        // confirmación, aprobación y cambios de mis citas
                cancellations: true,   // cancelaciones de mis citas
                messages: true,        // mensajes de la barbería
                push: false            // notificaciones push (requiere Firebase configurado)
            },
            serviceCategories: ['Cortes', 'Barba', 'Combos', 'Diseños', 'Tratamientos', 'Faciales', 'Color', 'VIP'],
            // Modo mantenimiento: lo controla Angel desde su panel privado (ops/).
            maintenance: {
                enabled: false,
                title: 'Estamos en mantenimiento',
                message: 'Estamos mejorando la página para darte una mejor experiencia. Vuelve pronto.',
                eta: '',
                allowStaff: true,
                sections: { reservas: false, tienda: false, resenas: false, noticias: false, barberos: false, servicios: false, soporte: false },
                updatedAt: ''
            },
            updatedAt: new Date().toISOString()
        },
        barbers: [
            {
                id: 'gabriel',
                name: 'Gabriel Andres Ortiz',
                alias: 'Gaby',
                email: 'gaby@goatstylesalon.com',
                phone: '787-218-1068',
                specialty: ['Fade Premium', 'Diseño', 'Celebridades'],
                bio: 'Administrador general y fundador de la barbería.',
                avatar: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783942400/320ed6b8-6ea7-4309-9f6a-e6ecf33bb939_sop8ao.jpg',
                isAdmin: true,
                active: true,
                yearsExperience: 14,
                vipClients: 500,
                schedule: SCHEDULE_TEXT,
                // Horario semanal (0 = domingo ... 6 = sabado). Lo cambia el administrador en Horarios.
                weeklySchedule: [
                    { off: true, start: '08:00', end: '18:00', breaks: [] },
                    { off: true, start: '08:00', end: '18:00', breaks: [] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '20:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] },
                    { off: false, start: '07:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] }
                ],
                socials: {
                    instagram: 'https://www.instagram.com/gabystylee_',
                    facebook: 'https://www.facebook.com/share/1F6o7gHn9A/'
                },
                gallery: [
                    'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783942400/320ed6b8-6ea7-4309-9f6a-e6ecf33bb939_sop8ao.jpg',
                    'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=200&q=80',
                    'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=200&q=80'
                ],
                certifications: [
                    { id: 'cert-gabriel-1', name: 'Barbero' },
                    { id: 'cert-gabriel-2', name: 'Estilista' },
                    { id: 'cert-gabriel-3', name: 'Colorimetría' }
                ],
                beforeAfter: [
                    { id: 'ba-gabriel-1', label: 'Fade Premium', before: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=600&q=80', after: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=600&q=80' },
                    { id: 'ba-gabriel-2', label: 'Signature Cut', before: 'https://images.unsplash.com/photo-1517832606299-7ae9b720a186?auto=format&fit=crop&w=600&q=80', after: 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=600&q=80' }
                ]
            },
            {
                id: 'darialex',
                name: 'Darialex Rivera Aponte',
                alias: 'Tazmania',
                email: 'darialex@goatstylesalon.com',
                phone: '787-228-5878',
                specialty: ['Corte para caballeros', 'Colorimetría', 'Barbas largas'],
                bio: 'Barbero y cosmetólogo especialista en cortes para caballeros, colorimetría y barbas largas.',
                avatar: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783942759/449dcd8d-1026-4eef-b360-20464ed96cd6_l5ccyi.jpg',
                isAdmin: false,
                active: true,
                yearsExperience: 8,
                vipClients: 450,
                schedule: SCHEDULE_TEXT,
                weeklySchedule: [
                    { off: true, start: '08:00', end: '18:00', breaks: [] },
                    { off: true, start: '08:00', end: '18:00', breaks: [] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '13:00', end: '14:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '13:00', end: '14:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '13:00', end: '14:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '20:00', breaks: [{ start: '13:00', end: '14:00', label: 'Almuerzo' }] },
                    { off: false, start: '07:00', end: '17:00', breaks: [{ start: '13:00', end: '14:00', label: 'Almuerzo' }] }
                ],
                socials: {
                    instagram: 'https://www.instagram.com/darialexthebarber'
                },
                gallery: [
                    'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783942759/449dcd8d-1026-4eef-b360-20464ed96cd6_l5ccyi.jpg',
                    'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=200&q=80',
                    'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=200&q=80'
                ],
                certifications: [
                    { id: 'cert-darialex-1', name: 'Barbero' },
                    { id: 'cert-darialex-2', name: 'Cosmetólogo' }
                ],
                beforeAfter: [
                    { id: 'ba-darialex-1', label: 'Barba Detallada', before: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=600&q=80', after: 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=600&q=80' },
                    { id: 'ba-darialex-2', label: 'Color y Rapado', before: 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&w=600&q=80', after: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=600&q=80' }
                ]
            },
            {
                id: 'wilo',
                name: 'Wilo',
                alias: '',
                email: 'wilo@goatstylesalon.com',
                phone: '939-324-2271',
                specialty: [],
                bio: '',
                avatar: 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1785203892/ddd23b62-7c16-46d3-bffd-fe2750215649_najb0v.jpg',
                isAdmin: false,
                active: true,
                yearsExperience: 0,
                vipClients: 280,
                schedule: SCHEDULE_TEXT,
                weeklySchedule: [
                    { off: true, start: '08:00', end: '18:00', breaks: [] },
                    { off: true, start: '08:00', end: '18:00', breaks: [] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] },
                    { off: false, start: '08:00', end: '20:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] },
                    { off: false, start: '07:00', end: '17:00', breaks: [{ start: '12:00', end: '13:00', label: 'Almuerzo' }] }
                ],
                socials: {
                    instagram: 'https://www.instagram.com/wilostudio6'
                },
                gallery: [
                    'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1785203892/ddd23b62-7c16-46d3-bffd-fe2750215649_najb0v.jpg'
                ],
                certifications: [],
                beforeAfter: []
            }
        ],
        clients: [],
        appointments: [],
        reviews: [],
        news: [
            {
                id: 'news-apertura-2026',
                authorId: 'gabriel',
                authorName: 'Gabriel (Gaby)',
                role: 'Admin General',
                title: 'Apertura de la nueva barbería',
                body: 'El sábado 7 de noviembre de 2026 abrimos las puertas de nuestra nueva barbería. Te esperamos para celebrar juntos. Ya puedes reservar tu cita desde la página.',
                createdAt: '2026-10-20T12:00:00.000Z',
                likes: 0,
                comments: 0,
                image: ''
            }
        ],
        providers: [
            { id: 'prov-1', name: 'Artefacto Grooming', category: 'Productos', contact: 'artefacto@example.com', phone: '787-555-1001', status: 'Activo' },
            { id: 'prov-2', name: 'Gold Blade Supply', category: 'Herramientas', contact: 'goldblade@example.com', phone: '787-555-1002', status: 'Activo' }
        ],
        gallery: [
            { id: 'gal-1', title: 'Fade Premium', barber: 'gabriel', image: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=800&q=80' },
            { id: 'gal-2', title: 'Barba Detallada', barber: 'darialex', image: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=800&q=80' },
            { id: 'gal-3', title: 'Servicio VIP', barber: 'gabriel', image: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=800&q=80' }
        ],
        services: [
            { id: 'service-1', minutes: 40, category: 'Cortes', barbers: [], image: '', name: 'Classic Cut', price: '$35', duration: 'Incluye bebida y lavado', active: true, description: 'Todo corte incluye una bebida de preferencia y lavado de cabello.', requests: 31 },
            { id: 'service-2', minutes: 45, category: 'Cortes', barbers: [], image: '', name: 'Premium Fade', price: '$40', duration: 'Corte premium', active: true, description: 'Premium Fade con acabado limpio y profesional.', requests: 42 },
            { id: 'service-3', minutes: 60, category: 'Combos', barbers: [], image: '', name: 'Signature Cut', price: '$45', duration: 'Traditional Hot Towel Shave', active: true, description: 'Signature Cut con Traditional Hot Towel Shave.', requests: 18 },
            { id: 'service-4', minutes: 30, category: 'Cortes', barbers: [], image: '', name: 'Kids Premium', price: '$35', duration: 'Hasta 12 años', active: true, description: 'Kids Premium para niños de hasta 12 años.', requests: 14 },
            { id: 'service-5', minutes: 30, category: 'Cortes', barbers: [], image: '', name: 'Baby Cut', price: 'Consultar', duration: 'Consulta previa', active: true, description: 'Baby Cut sujeto a consulta previa.', requests: 5 },
            { id: 'service-6', minutes: 90, category: 'Color', barbers: [], image: '', name: 'Hair Light', price: '$65', duration: 'Color', active: true, description: 'Hair Light para un look más definido y moderno.', requests: 11 },
            { id: 'service-7', minutes: 180, category: 'Color', barbers: [], image: '', name: 'Platinado', price: '$120', duration: 'No incluye corte', active: true, description: 'Platinado completo. No incluye corte.', requests: 7 },
            { id: 'service-8', minutes: 30, category: 'Tratamientos', barbers: [], image: '', name: 'Hidratación Capilar', price: 'Desde $30', duration: 'Tratamiento', active: true, description: 'Tratamiento de hidratación capilar.', requests: 10 },
            { id: 'service-9', minutes: 90, category: 'Tratamientos', barbers: [], image: '', name: 'Keratina', price: 'Desde $45', duration: 'Tratamiento', active: true, description: 'Keratina para mejorar la textura y controlar el frizz.', requests: 8 },
            { id: 'service-10', minutes: 45, category: 'Faciales', barbers: [], image: '', name: 'Limpieza Facial Profunda', price: '$50', duration: 'Facial', active: true, description: 'Limpieza facial profunda.', requests: 9 },
            { id: 'service-11', minutes: 120, category: 'VIP', barbers: [], image: '', name: 'GOAT VIP Experience', price: '$100', duration: 'Experiencia completa', active: true, description: 'Incluye Signature Cut, diseño de barba, lavado, toallas calientes, masaje capilar, limpieza facial express, bebida de cortesía y productos premium para finalizar.', requests: 16 }
        ],
        products: [
            { id: 'prod-1', barberId: 'gabriel', name: 'Pomada Premium Mate', desc: 'Fijación fuerte, acabado mate.', price: '$20', stock: 15, sold: 48, image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80', active: true },
            { id: 'prod-2', barberId: 'gabriel', name: 'Aceite para Barba Dorado', desc: 'Hidrata y suaviza la barba.', price: '$25', stock: 8, sold: 35, image: 'https://images.unsplash.com/photo-1626202373052-2bbb4f5b9d62?auto=format&fit=crop&w=600&q=80', active: true },
            { id: 'prod-3', barberId: 'gabriel', name: 'Shampoo Artefacto', desc: 'Limpieza profunda sin sulfatos.', price: '$18', stock: 20, sold: 28, image: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=600&q=80', active: true },
            { id: 'prod-4', barberId: 'gabriel', name: 'Cera Modeladora Classic', desc: 'Para peinados clásicos con brillo.', price: '$22', stock: 12, sold: 22, image: 'https://images.unsplash.com/photo-1631730486572-226d1f595b68?auto=format&fit=crop&w=600&q=80', active: true }
        ],
        activity: [],
        barberApplications: [],
        memos: [],
        payments: [],
        discounts: [],
        loyaltyAccounts: [],
        clientChangeLog: [],
        // Sistema de citas (booking-engine.js)
        timeBlocks: [],
        notifications: [],
        pushTokens: [],
        inventory: [],
        clientNotes: [],
        clientBlocks: [],
        // Seguridad de inicio de sesion del personal (security.js): intentos fallidos, bloqueos y claves.
        security: {
            attempts: {},
            locks: [],
            staffAuth: {},
            devAuth: null
        }
    };

    // Datos de las antiguas cuentas de clientes que ya no se usan (los clientes no inician sesion).
    const RETIRED_CLIENT_FIELDS = ['password', 'passwordHash', 'mustChangePassword', 'passwordUpdatedAt', 'favorites'];

    function removeClientAccountData(state) {
        delete state.session;
        delete state.waitlist;
        state.clients = (state.clients || []).map(client => {
            const copy = { ...client };
            RETIRED_CLIENT_FIELDS.forEach(field => { delete copy[field]; });
            return copy;
        });
        // Los avisos de clientes se conservan: van por código de cita, no por cuenta
        // (las cuentas de cliente ya no existen).
        state.security.locks = (state.security.locks || []).filter(lock => lock.accountType !== 'client');
        Object.keys(state.security.attempts || {}).forEach(email => {
            if (state.security.attempts[email]?.type !== 'staff') delete state.security.attempts[email];
        });
        if (state.settings.maintenance?.sections) delete state.settings.maintenance.sections.cuentas;
        // Los ajustes de notificaciones del cliente se conservan (settings-notifications.html).
        // Los permisos del dispositivo siguen sin usarse.
        delete state.settings.permissions;
        return state;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeServices(services) {
        const defaults = clone(defaultState.services);
        const saved = Array.isArray(services) ? services : [];

        const mergedDefaults = defaults.map(defaultService => {
            const savedService = saved.find(service => service.id === defaultService.id || service.name === defaultService.name);
            // Si el administrador edito el servicio en el panel (editedAt), se respeta lo guardado.
            if (savedService && savedService.editedAt) {
                return { ...defaultService, ...savedService, id: defaultService.id, image: '' };
            }
            return {
                ...defaultService,
                ...(savedService || {}),
                id: defaultService.id,
                name: defaultService.name,
                price: defaultService.price,
                duration: defaultService.duration,
                description: defaultService.description,
                minutes: savedService?.minutes || defaultService.minutes,
                category: savedService?.category || defaultService.category,
                barbers: savedService?.barbers || defaultService.barbers,
                image: '', // Por ahora ningún servicio tiene imagen.
                active: savedService?.active ?? true
            };
        });

        const extraServices = saved
            .filter(service => !defaults.some(defaultService => defaultService.id === service.id || defaultService.name === service.name))
            .map(service => ({ minutes: 40, category: 'Cortes', barbers: [], ...service, image: '' }));
        return [...mergedDefaults, ...extraServices];
    }

    const PROFILE_VERSION = 2;
    const PROFILE_UPDATES = {
        gabriel: ['vipClients'],
        darialex: ['name', 'specialty', 'bio', 'yearsExperience', 'vipClients'],
        wilo: ['vipClients']
    };

    function normalizeBarbers(barbers) {
        const defaults = clone(defaultState.barbers);
        const saved = Array.isArray(barbers) ? barbers : [];

        const mergedDefaults = defaults.map(defaultBarber => {
            const savedBarber = saved.find(barber => barber.id === defaultBarber.id);
            // Datos que el dueño actualizó (versión 2): reemplazan una sola vez lo guardado antes;
            // después se respetan los cambios hechos en el panel.
            const update = savedBarber && savedBarber.profileVersion !== PROFILE_VERSION
                ? Object.fromEntries((PROFILE_UPDATES[defaultBarber.id] || []).map(field => [field, defaultBarber[field]]))
                : {};
            const legacy = savedBarber ? {
                // Los correos pasaron de @gabystyle.com a @goatstylesalon.com.
                email: /@gabystyle\.com$/i.test(savedBarber.email || '') ? defaultBarber.email : savedBarber.email,
                // Valor anterior de experiencia de Gabriel (10) -> 14.
                yearsExperience: defaultBarber.id === 'gabriel' && Number(savedBarber.yearsExperience) === 10 ? defaultBarber.yearsExperience : savedBarber.yearsExperience,
                // Correccion ortografica de especialidades guardadas sin tilde.
                specialty: (savedBarber.specialty || defaultBarber.specialty).map(item => SPECIALTY_FIXES[item] || item)
            } : {};
            return {
                ...defaultBarber,
                ...(savedBarber || {}),
                ...legacy,
                ...update,
                profileVersion: PROFILE_VERSION,
                id: defaultBarber.id,
                // avatar/gallery are brand photo assets with no edit UI in the admin panel,
                // so a saved copy can only be stale leftover data - always use the current default.
                avatar: defaultBarber.avatar,
                gallery: defaultBarber.gallery,
                // Certifications are shown in generic form only (no institution/year), and have no edit UI either.
                certifications: defaultBarber.certifications,
                weeklySchedule: applyShopHours(savedBarber?.weeklySchedule || defaultBarber.weeklySchedule),
                schedule: SCHEDULE_TEXT,
                beforeAfter: savedBarber?.beforeAfter || defaultBarber.beforeAfter
            };
        });

        const extraBarbers = saved
            .filter(barber => !defaults.some(defaultBarber => defaultBarber.id === barber.id))
            .map(barber => ({
                ...barber,
                weeklySchedule: applyShopHours(barber.weeklySchedule),
                schedule: SCHEDULE_TEXT,
                certifications: (barber.certifications || []).map(cert => ({ id: cert.id, name: cert.name }))
            }));
        return [...mergedDefaults, ...extraBarbers];
    }

    // Every product belongs to the barber who sells it. Older saved products had no owner,
    // so they are assigned to the main admin (Gaby).
    function normalizeProducts(products) {
        const list = Array.isArray(products) && products.length ? products : clone(defaultState.products);
        return list.map(product => ({ ...product, barberId: product.barberId || 'gabriel' }));
    }

    const SPECIALTY_FIXES = { Diseno: 'Diseño' };

    // Quita las noticias de demostración y garantiza la noticia de apertura de Gaby.
    const DEMO_NEWS_IDS = ['news-1', 'news-2'];
    const DEMO_APPOINTMENT_CODES = ['GS-123456', 'GS-789012'];
    const DEMO_REVIEW_IDS = ['review-1', 'review-2'];
    // Primera reseña del sitio. Se agrega una sola vez; si el personal la oculta o la borra, se respeta.
    const FIRST_REVIEW = {
        id: 'review-angel-primera', clientName: 'Ángel A. Colón Negrón', barber: '', service: '',
        rating: 5, text: 'Excelente servicio!!!!', status: 'APROBADA', publishConsent: true,
        createdAt: '2026-11-18T12:00:00.000Z', publishedAt: '2026-11-18T12:00:00.000Z'
    };
    const DEMO_ACTIVITY_IDS = ['act-1', 'act-2'];
    function normalizeNews(news) {
        const defaults = clone(defaultState.news);
        const saved = (Array.isArray(news) ? news : [])
            .filter(item => !DEMO_NEWS_IDS.includes(item.id))
            // La noticia de apertura guardada con el texto viejo (sin tildes) toma el texto corregido.
            .map(item => {
                const fallback = defaults.find(def => def.id === item.id);
                return fallback && item.title === 'Apertura de la nueva barberia' ? { ...item, title: fallback.title, body: fallback.body } : item;
            });
        const missingDefaults = defaults.filter(item => !saved.some(savedItem => savedItem.id === item.id));
        return [...saved, ...missingDefaults];
    }

    // Con Supabase configurado (supabase-config.js) los datos reales vienen del servidor:
    // no se inyectan citas, reseñas ni actividad de demostración.
    function cloudMode() {
        const cfg = window.GABY_SUPABASE;
        return Boolean(cfg && cfg.url && cfg.anonKey);
    }

    function ensureStateShape(state) {
        const merged = clone(defaultState);
        Object.assign(merged, state || {});
        merged.settings = { ...defaultState.settings, ...(state?.settings || {}) };
        merged.settings.maintenance = {
            ...defaultState.settings.maintenance,
            ...(state?.settings?.maintenance || {}),
            sections: { ...defaultState.settings.maintenance.sections, ...(state?.settings?.maintenance?.sections || {}) }
        };
        merged.security = { ...clone(defaultState.security), ...(state?.security || {}) };
        merged.settings.business = { ...defaultState.settings.business, ...(state?.settings?.business || {}) };
        merged.settings.business.hours = SHOP_HOURS.map(hours => hours && { ...hours });
        merged.settings.booking = {
            ...defaultState.settings.booking,
            ...(state?.settings?.booking || {}),
            noShowRules: { ...defaultState.settings.booking.noShowRules, ...(state?.settings?.booking?.noShowRules || {}) }
        };
        merged.settings.notifications = {
            ...defaultState.settings.notifications,
            ...(state?.settings?.notifications || {})
        };
        // Migracion: las barberias que tenian confirmacion automatica pasan a aprobacion del barbero (una sola vez).
        if (!state?.settings?.booking?.approvalFlowVersion) {
            merged.settings.booking.autoConfirm = false;
            merged.settings.booking.approvalFlowVersion = 1;
        }
        if (!state?.settings?.booking?.cancellationPolicyVersion) {
            const defaults = defaultState.settings.booking;
            merged.settings.booking.cancellationPolicyVersion = defaults.cancellationPolicyVersion;
            merged.settings.booking.cancelPolicyHours = defaults.cancelPolicyHours;
            merged.settings.booking.lateCancelFee = defaults.lateCancelFee;
        }
        merged.settings.serviceCategories = state?.settings?.serviceCategories?.length ? state.settings.serviceCategories : clone(defaultState.settings.serviceCategories);
        ['timeBlocks', 'notifications', 'clientNotes', 'clientBlocks'].forEach(key => {
            merged[key] = Array.isArray(state?.[key]) ? state[key] : [];
        });
        merged.inventory = Array.isArray(state?.inventory) ? state.inventory : clone(defaultState.inventory);
        merged.barbers = normalizeBarbers(state?.barbers);
        merged.clients = state?.clients || [];
        if (cloudMode()) {
            merged.appointments = state?.appointments || [];
            merged.reviews = state?.reviews || [];
            merged.activity = state?.activity || [];
        } else {
            // Se quitan las citas y resenas de demostracion que existian en versiones anteriores.
            merged.appointments = (state?.appointments || []).filter(item => !DEMO_APPOINTMENT_CODES.includes(item.code));
            merged.reviews = (state?.reviews || []).filter(item => !DEMO_REVIEW_IDS.includes(item.id));
            if (!merged.settings.firstReviewSeeded) {
                if (!merged.reviews.some(item => item.id === FIRST_REVIEW.id)) merged.reviews.push(clone(FIRST_REVIEW));
                merged.settings.firstReviewSeeded = true;
            }
        }
        merged.news = normalizeNews(state?.news);
        merged.providers = state?.providers?.length ? state.providers : clone(defaultState.providers);
        merged.gallery = state?.gallery?.length ? state.gallery : clone(defaultState.gallery);
        merged.services = normalizeServices(state?.services);
        merged.products = normalizeProducts(state?.products);
        if (!cloudMode()) merged.activity = (state?.activity || []).filter(item => !DEMO_ACTIVITY_IDS.includes(item.id));
        merged.barberApplications = state?.barberApplications || [];
        merged.memos = state?.memos || [];
        merged.payments = state?.payments || [];
        merged.discounts = state?.discounts || [];
        merged.loyaltyAccounts = state?.loyaltyAccounts || [];
        merged.clientChangeLog = state?.clientChangeLog || [];
        // El nombre del negocio es Goat Style Salon (antes se guardaba "Gaby Style Barber Studio").
        if (/gaby style/i.test(merged.settings.business.name || '')) merged.settings.business.name = 'Goat Style Salon';
        return removeClientAccountData(merged);
    }

    function saveState(state) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        window.dispatchEvent(new CustomEvent('gabydatachange', {
            detail: {
                key: STORAGE_KEY,
                state: clone(state)
            }
        }));
        return state;
    }

    function getState() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            // ensureStateShape decide si van datos de demostración (solo sin Supabase).
            return saveState(ensureStateShape({}));
        }

        try {
            const parsed = JSON.parse(stored);
            const normalized = ensureStateShape(parsed);

            if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
                return saveState(normalized);
            }

            return normalized;
        } catch (error) {
            return saveState(clone(defaultState));
        }
    }

    // Funciones que se ejecutan después de cada cambio guardado (por ejemplo, la sincronización
    // con Supabase en supabase-sync.js). Reciben (estadoAnterior, estadoNuevo) y pueden devolver una promesa.
    const commitHooks = [];
    let lastCommitPromise = Promise.resolve();

    function addCommitHook(hook) {
        commitHooks.push(hook);
    }

    function updateState(mutator) {
        const previous = getState();
        const state = clone(previous);
        mutator(state);
        state.settings.updatedAt = new Date().toISOString();
        saveState(state);
        lastCommitPromise = Promise.all(commitHooks.map(hook => hook(previous, state)));
        // Evita avisos de "promesa no manejada" cuando el cambio no se hizo con commit().
        lastCommitPromise.catch(() => {});
        return state;
    }

    // Guarda un cambio y muestra un mensaje de éxito o error.
    // Uso: GabyData.commit(state => {...}, { success: 'Cambios guardados', error: 'No se pudo guardar' })
    // Devuelve una promesa con true/false. Si success es null no se muestra mensaje de éxito.
    async function commit(mutator, messages) {
        const options = messages || {};
        const previous = getState();
        let submitted = null;
        try {
            submitted = JSON.stringify(updateState(mutator));
            await lastCommitPromise;
            if (options.success !== null) toast(options.success || 'Cambios guardados correctamente.', 'success');
            return true;
        } catch (error) {
            // Un rechazo del servidor no debe dejar una cita o reseña ficticia guardada.
            // No sobrescribir otro cambio que haya ocurrido mientras se guardaba este.
            if (submitted && localStorage.getItem(STORAGE_KEY) === submitted) {
                saveState(previous);
                if (window.GabyCloud?.enabled) {
                    try { await window.GabyCloud.pull(); } catch (_) { /* conservar el último estado local válido */ }
                }
            }
            console.error(error);
            const detail = error && error.name === 'QuotaExceededError'
                ? ' El almacenamiento del navegador esta lleno (prueba con una foto más liviana).'
                : (error && error.userMessage ? ` ${error.userMessage}` : '');
            toast(`${options.error || 'No se pudo guardar el cambio.'}${detail}`, 'error');
            return false;
        }
    }

    // ---------------------------------------------------------------------
    // Mensajes emergentes (toasts) para confirmar guardados, errores y avisos.
    // ---------------------------------------------------------------------
    function ensureToastHost() {
        let host = document.getElementById('gaby-toasts');
        if (host) return host;
        if (!document.getElementById('gaby-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'gaby-toast-styles';
            style.textContent = `
                #gaby-toasts { position: fixed; z-index: 6000; top: 1rem; right: 1rem; left: auto; display: grid; gap: .6rem; width: min(380px, calc(100vw - 2rem)); pointer-events: none; font-family: 'Inter', system-ui, sans-serif; }
                @media (max-width: 968px) { #gaby-toasts { left: 1rem; right: 1rem; width: auto; } }
                .gaby-toast { pointer-events: auto; display: grid; grid-template-columns: auto 1fr auto; gap: .75rem; align-items: start; padding: .9rem 1rem; border-radius: 16px; background: #151515; color: #f5f1e8; border: 1px solid rgba(255,255,255,.12); border-left: 4px solid #d4af37; box-shadow: 0 16px 40px rgba(0,0,0,.45); font-size: .9rem; line-height: 1.45; animation: gaby-toast-in .22s ease-out; }
                body.light-mode .gaby-toast { background: #fff; color: #111; border-color: rgba(0,0,0,.1); box-shadow: 0 14px 34px rgba(16,24,40,.16); }
                .gaby-toast.success { border-left-color: #4ecb71; }
                .gaby-toast.error { border-left-color: #e5484d; }
                .gaby-toast.warning { border-left-color: #f1be5d; }
                .gaby-toast-icon { font-weight: 800; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: .8rem; color: #111; background: #d4af37; }
                .gaby-toast.success .gaby-toast-icon { background: #4ecb71; }
                .gaby-toast.error .gaby-toast-icon { background: #e5484d; color: #fff; }
                .gaby-toast.warning .gaby-toast-icon { background: #f1be5d; }
                .gaby-toast a { color: inherit; font-weight: 700; text-decoration: underline; }
                .gaby-toast-close { background: none; border: 0; color: inherit; opacity: .6; cursor: pointer; font-size: 1.1rem; line-height: 1; padding: 0 .1rem; }
                .gaby-toast-close:hover { opacity: 1; }
                @keyframes gaby-toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
            `;
            document.head.appendChild(style);
        }
        host = document.createElement('div');
        host.id = 'gaby-toasts';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
        return host;
    }

    // type: 'success' | 'error' | 'warning' | 'info'. El mensaje puede incluir un enlace (HTML de confianza).
    function toast(message, type, options) {
        if (!document.body) return;
        const kind = type || 'info';
        const icons = { success: '✓', error: '!', warning: '!', info: 'i' };
        const host = ensureToastHost();
        const item = document.createElement('div');
        item.className = `gaby-toast ${kind}`;
        if (kind === 'error') item.setAttribute('role', 'alert');
        item.innerHTML = `<span class="gaby-toast-icon" aria-hidden="true">${icons[kind] || 'i'}</span><div></div><button type="button" class="gaby-toast-close" aria-label="Cerrar">&times;</button>`;
        item.querySelector('div').innerHTML = message;
        item.querySelector('button').addEventListener('click', () => item.remove());
        host.appendChild(item);
        const duration = (options && options.duration) || (kind === 'error' ? 8000 : 4500);
        window.setTimeout(() => item.remove(), duration);
    }

    window.GabyToast = { show: toast };

    function makeId(prefix) {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    // Ubicación de la barbería: cuando tengas la dirección exacta, escribela en `address`
    // (y si quieres, las coordenadas). Los botones "Cómo llegar" de todo el sitio usan esto.
    const SHOP_LOCATION = {
        name: 'Goat Style Salon',
        address: '',
        fallbackQuery: 'Barranquitas, Puerto Rico',
        lat: null,
        lng: null
    };

    function getShopDestination() {
        if (SHOP_LOCATION.lat !== null && SHOP_LOCATION.lng !== null) return `${SHOP_LOCATION.lat},${SHOP_LOCATION.lng}`;
        return SHOP_LOCATION.address || SHOP_LOCATION.fallbackQuery;
    }

    function getDirectionsLinks() {
        const destination = encodeURIComponent(getShopDestination());
        return {
            google: `https://www.google.com/maps/dir/?api=1&destination=${destination}`,
            waze: `https://waze.com/ul?q=${destination}&navigate=yes`,
            apple: `https://maps.apple.com/?daddr=${destination}`,
            embed: `https://www.google.com/maps?q=${destination}&output=embed`
        };
    }

    window.GabyData = {
        STORAGE_KEY,
        SHOP_LOCATION,
        getDirectionsLinks,
        defaultState,
        clone,
        getState,
        saveState,
        updateState,
        commit,
        addCommitHook,
        toast,
        makeId
    };
})();






