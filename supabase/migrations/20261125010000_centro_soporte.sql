-- =============================================================================
-- GOAT Style Salon — Centro de Soporte Técnico
-- Migración: 20261125010000_centro_soporte.sql
--
-- Crea las tablas del Centro de Soporte (memos de soporte, lecturas, registro
-- de sincronización, pruebas de velocidad, registro de notificaciones y el
-- sistema legal), la columna error_logs.resuelto y los buckets privados de
-- Storage del soporte. NO crea RPCs nuevas: todo lo delicado (login, cuentas,
-- mantenimiento, permisos, notificaciones masivas, export_data) ya existe en
-- la migración 20261124230000_super_admin.sql y en schema.sql.
--
-- DECISIÓN DE MAPEO (conflicto resuelto): public.memos YA EXISTE como tabla
-- CRM (id text pk, client_id, data jsonb), por lo que la tabla de memos del
-- Centro de Soporte se llama public.support_memos. No se toca public.memos.
--
-- Re-ejecutable: todo es IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT
-- DO NOTHING, siguiendo el patrón de la migración del Super Admin (PR #18).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. unaccent + wrapper inmutable para búsqueda en español
--    La extensión se pide dentro de un DO con handler: si el entorno no la
--    soporta, la migración sigue. El wrapper nace SIEMPRE con un fallback
--    translate() (vocales acentuadas, ñ y ü) y solo se reemplaza por la
--    versión con unaccent() si la extensión está disponible Y la función
--    resultante se ejecuta sin error (se prueba dentro del mismo bloque:
--    si algo falla, el bloque se revierte y queda el fallback).
-- -----------------------------------------------------------------------------
do $$
begin
    create extension if not exists unaccent;
exception when others then
    raise notice 'unaccent no disponible (%): se usará el fallback translate() en immutable_unaccent().', sqlerrm;
end $$;

create or replace function public.immutable_unaccent(p_text text)
returns text
language sql immutable parallel safe as $$
    select translate(
        coalesce(p_text, ''),
        'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ',
        'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOUUUUN'
    )
$$;

do $$
begin
    execute 'create or replace function public.immutable_unaccent(p_text text) '
         || 'returns text language sql immutable parallel safe as $func$ '
         || 'select public.unaccent(coalesce(p_text, '''')) $func$';
    -- Prueba real: si unaccent() no existe o falla, salta al handler y el
    -- bloque se revierte, dejando intacta la versión fallback de arriba.
    perform public.immutable_unaccent('áéíóúñü');
    raise notice 'immutable_unaccent(): usando unaccent().';
exception when others then
    raise notice 'immutable_unaccent(): unaccent() no usable (%); se mantiene el fallback translate().', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 1. support_memos — memos del Centro de Soporte (ver decisión de mapeo arriba)
-- -----------------------------------------------------------------------------
create table if not exists public.support_memos (
    id uuid primary key default gen_random_uuid(),
    titulo text not null default '',
    mensaje text not null default '',
    destinatario_tipo text not null default 'barberos'
        check (destinatario_tipo in ('clientes', 'barberos', 'persona')),
    destinatario_id text,
    destinatario_nombre text not null default '',
    prioridad text not null default 'normal'
        check (prioridad in ('normal', 'importante', 'urgente')),
    etiquetas text[] not null default '{}',
    imagen_url text,
    enviar_push boolean not null default false,
    estado text not null default 'borrador'
        check (estado in ('borrador', 'enviado', 'archivado')),
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    search_tsv tsvector generated always as (
        to_tsvector('spanish', public.immutable_unaccent(coalesce(titulo, '') || ' ' || coalesce(mensaje, '')))
    ) stored
);
create index if not exists support_memos_search_idx on public.support_memos using gin (search_tsv);
create index if not exists support_memos_created_idx on public.support_memos (created_at desc);

create table if not exists public.memo_reads (
    id uuid primary key default gen_random_uuid(),
    memo_id uuid not null references public.support_memos (id) on delete cascade,
    lector text not null default '',
    lector_id text,
    leido_at timestamptz not null default now()
);
create index if not exists memo_reads_memo_idx on public.memo_reads (memo_id);
create index if not exists memo_reads_leido_idx on public.memo_reads (leido_at);

create table if not exists public.sync_queue_log (
    id uuid primary key default gen_random_uuid(),
    queue_id text,
    tipo text not null default '',
    tabla text not null default '',
    resultado text not null default ''
        check (resultado in ('subido', 'fallido', 'descartado', 'prueba')),
    motivo text not null default '',
    created_at timestamptz not null default now()
);
create index if not exists sync_queue_log_created_idx on public.sync_queue_log (created_at desc);

create table if not exists public.speed_tests (
    id uuid primary key default gen_random_uuid(),
    descarga_mbps numeric,
    latencia_ms int,
    estabilidad_ms int[] not null default '{}',
    veredicto text not null default '',
    created_by uuid,
    created_at timestamptz not null default now()
);
create index if not exists speed_tests_created_idx on public.speed_tests (created_at desc);

create table if not exists public.notifications_log (
    id uuid primary key default gen_random_uuid(),
    titulo text not null default '',
    cuerpo text not null default '',
    audiencia text not null default 'todos'
        check (audiencia in ('todos', 'barberos', 'clientes', 'persona')),
    destinatario text not null default '',
    estado text not null default 'enviado'
        check (estado in ('enviado', 'programada', 'fallido')),
    programada_at timestamptz,
    enviado_at timestamptz,
    created_by uuid,
    created_at timestamptz not null default now()
);
create index if not exists notifications_log_created_idx on public.notifications_log (created_at desc);
create index if not exists notifications_log_programada_idx on public.notifications_log (programada_at);

-- -----------------------------------------------------------------------------
-- 2. Sistema legal — documentos, ajuste global y aceptaciones
-- -----------------------------------------------------------------------------
create table if not exists public.legal_documents (
    slug text primary key,
    titulo text not null,
    contenido text not null,
    version int not null default 1,
    updated_at timestamptz not null default now(),
    updated_by uuid
);

create table if not exists public.legal_settings (
    id int primary key check (id = 1),
    require_reaccept boolean not null default false,
    updated_at timestamptz not null default now(),
    updated_by uuid
);
insert into public.legal_settings (id, require_reaccept) values (1, false)
on conflict (id) do nothing;

create table if not exists public.legal_acceptances (
    id uuid primary key default gen_random_uuid(),
    version int not null,
    user_agent text not null default '',
    created_at timestamptz not null default now()
);
create index if not exists legal_acceptances_created_idx on public.legal_acceptances (created_at desc);

-- -----------------------------------------------------------------------------
-- 3. error_logs.resuelto — sin tocar las políticas existentes (insert y
--    super_admin_read); solo se AÑADE la política de UPDATE del super_admin.
-- -----------------------------------------------------------------------------
alter table public.error_logs add column if not exists resuelto boolean not null default false;

drop policy if exists error_logs_super_admin_update on public.error_logs;
create policy error_logs_super_admin_update on public.error_logs
    for update using (public.is_super_admin()) with check (public.is_super_admin());

grant update on public.error_logs to authenticated;

-- -----------------------------------------------------------------------------
-- 4. RLS + políticas + grants de las tablas nuevas
--    Patrón del repo (PR #18): RLS manda; los grants solo permiten llegar a
--    la política. drop policy if exists + create en todo.
-- -----------------------------------------------------------------------------
alter table public.support_memos enable row level security;
alter table public.memo_reads enable row level security;
alter table public.sync_queue_log enable row level security;
alter table public.speed_tests enable row level security;
alter table public.notifications_log enable row level security;
alter table public.legal_documents enable row level security;
alter table public.legal_settings enable row level security;
alter table public.legal_acceptances enable row level security;

-- Tablas solo del super_admin (FOR ALL a authenticated, gated por is_super_admin()).
drop policy if exists support_memos_super_admin on public.support_memos;
create policy support_memos_super_admin on public.support_memos
    for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists memo_reads_super_admin on public.memo_reads;
create policy memo_reads_super_admin on public.memo_reads
    for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists sync_queue_log_super_admin on public.sync_queue_log;
create policy sync_queue_log_super_admin on public.sync_queue_log
    for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists speed_tests_super_admin on public.speed_tests;
create policy speed_tests_super_admin on public.speed_tests
    for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists notifications_log_super_admin on public.notifications_log;
create policy notifications_log_super_admin on public.notifications_log
    for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- legal_documents: lectura pública; escritura solo super_admin.
drop policy if exists legal_documents_public_read on public.legal_documents;
create policy legal_documents_public_read on public.legal_documents
    for select to anon, authenticated using (true);

drop policy if exists legal_documents_super_admin_write on public.legal_documents;
create policy legal_documents_super_admin_write on public.legal_documents
    for insert to authenticated with check (public.is_super_admin());

drop policy if exists legal_documents_super_admin_update on public.legal_documents;
create policy legal_documents_super_admin_update on public.legal_documents
    for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists legal_documents_super_admin_delete on public.legal_documents;
create policy legal_documents_super_admin_delete on public.legal_documents
    for delete to authenticated using (public.is_super_admin());

-- legal_settings: lectura pública; UPDATE solo super_admin.
drop policy if exists legal_settings_public_read on public.legal_settings;
create policy legal_settings_public_read on public.legal_settings
    for select to anon, authenticated using (true);

drop policy if exists legal_settings_super_admin_update on public.legal_settings;
create policy legal_settings_super_admin_update on public.legal_settings
    for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- legal_acceptances: cualquiera registra su aceptación; solo el super_admin las lee.
drop policy if exists legal_acceptances_public_insert on public.legal_acceptances;
create policy legal_acceptances_public_insert on public.legal_acceptances
    for insert to anon, authenticated with check (true);

drop policy if exists legal_acceptances_super_admin_read on public.legal_acceptances;
create policy legal_acceptances_super_admin_read on public.legal_acceptances
    for select to authenticated using (public.is_super_admin());

-- Grants coherentes con las políticas.
grant select, insert, update, delete on public.support_memos to authenticated;
grant select, insert, update, delete on public.memo_reads to authenticated;
grant select, insert, update, delete on public.sync_queue_log to authenticated;
grant select, insert, update, delete on public.speed_tests to authenticated;
grant select, insert, update, delete on public.notifications_log to authenticated;
grant select on public.legal_documents to anon, authenticated;
grant insert, update, delete on public.legal_documents to authenticated;
grant select on public.legal_settings to anon, authenticated;
grant update on public.legal_settings to authenticated;
grant insert on public.legal_acceptances to anon, authenticated;
grant select on public.legal_acceptances to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Storage — buckets privados del soporte y sus políticas.
--    Todo envuelto en DO con guardas: si el esquema storage no existe (p. ej.
--    en un Postgres local / PGlite sin Storage), se salta sin fallar.
-- -----------------------------------------------------------------------------
do $$
begin
    if to_regnamespace('storage') is null
       or not exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
        raise notice 'Sin esquema storage: se saltan los buckets del Centro de Soporte.';
        return;
    end if;
    insert into storage.buckets (id, name, public) values
        ('soporte-pruebas', 'soporte-pruebas', false),
        ('soporte-adjuntos', 'soporte-adjuntos', false)
    on conflict (id) do nothing;
exception when others then
    raise notice 'No se pudieron crear los buckets de soporte (%).', sqlerrm;
end $$;

do $$
begin
    if to_regnamespace('storage') is null
       or not exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
        raise notice 'Sin storage.objects: se saltan las políticas de Storage del Centro de Soporte.';
        return;
    end if;
    execute 'drop policy if exists soporte_pruebas_super_admin on storage.objects';
    execute 'create policy soporte_pruebas_super_admin on storage.objects '
         || 'for all to authenticated '
         || 'using (bucket_id = ''soporte-pruebas'' and public.is_super_admin()) '
         || 'with check (bucket_id = ''soporte-pruebas'' and public.is_super_admin())';
    execute 'drop policy if exists soporte_adjuntos_super_admin on storage.objects';
    execute 'create policy soporte_adjuntos_super_admin on storage.objects '
         || 'for all to authenticated '
         || 'using (bucket_id = ''soporte-adjuntos'' and public.is_super_admin()) '
         || 'with check (bucket_id = ''soporte-adjuntos'' and public.is_super_admin())';
exception when others then
    raise notice 'No se pudieron crear las políticas de Storage del soporte (%).', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Seed legal — textos EXACTOS de centro-soporte/legal-texts.md
--    (párrafos numerados unidos con doble salto de línea, sin el encabezado
--    markdown). version = 1 y fecha fija de la versión inicial.
-- -----------------------------------------------------------------------------
insert into public.legal_documents (slug, titulo, contenido, version, updated_at) values
    ('terminos', 'Términos de Uso', '1. Aceptación. Al usar la aplicación y el sitio web de GOAT Style Salon aceptas estos Términos de Uso. Si no estás de acuerdo, no uses la plataforma.

2. El servicio. GOAT Style Salon ofrece una plataforma para consultar servicios y barberos, reservar citas en línea, recibir avisos y gestionar tus citas. La plataforma es una herramienta de reservación: el servicio de barbería lo presta cada barbero en el local, en Barranquitas, Puerto Rico.

3. Reservas. Al reservar en línea, tu cita queda en estado PENDIENTE hasta que el barbero la apruebe. Recibirás un aviso cuando se apruebe, se rechace o se cancele. La confirmación final de tu cita es la aprobación del barbero, no el envío del formulario.

4. Tus responsabilidades. Debes dar información verdadera al reservar (nombre, teléfono y correo), llegar a tiempo a tu cita y tratar con respeto al personal. Eres responsable del uso que se haga de tu dispositivo y de tus datos de acceso.

5. Cuentas. Algunas funciones (paneles de barberos y administración) requieren cuenta. No compartas tu contraseña. Podemos suspender cuentas que hagan mal uso de la plataforma, intenten acceder sin autorización o afecten a otros usuarios.

6. Contenido y reseñas. Las reseñas y comentarios que publiques deben ser verdaderos y respetuosos. Podemos retirar contenido ofensivo, falso o que viole derechos de terceros.

7. Propiedad intelectual. El diseño, los textos, el logotipo y el código de la plataforma pertenecen a GOAT Style Salon y a Ángel Tech Solutions. No puedes copiarlos ni usarlos con fines comerciales sin autorización escrita.

8. Disponibilidad. Procuramos que la plataforma funcione sin interrupciones, pero puede haber pausas por mantenimiento o fallas técnicas. No garantizamos disponibilidad continua ni ausencia de errores.

9. Responsabilidad. En la medida que permite la ley, GOAT Style Salon no se responsabiliza por daños indirectos derivados del uso de la plataforma. Nada en estos términos limita los derechos que te reconoce la ley de Puerto Rico como consumidor.

10. Cambios. Podemos actualizar estos términos. Cuando el cambio sea importante, la plataforma te pedirá aceptarlos de nuevo antes de seguir usándola. La fecha de la última actualización aparece al inicio del documento.

11. Ley aplicable. Estos términos se rigen por las leyes del Estado Libre Asociado de Puerto Rico.

12. Contacto. GOAT Style Salon, Barranquitas, Puerto Rico. Teléfono y WhatsApp: 787-218-1068. Correo: support@goatstylesalon.com.', 1, '2026-11-25T12:00:00-04:00'::timestamptz),
    ('privacidad', 'Política de Privacidad', '1. Quiénes somos. GOAT Style Salon (Barranquitas, Puerto Rico) es responsable de los datos que se recogen en esta plataforma. Contacto: 787-218-1068 y support@goatstylesalon.com.

2. Qué datos recogemos. Al reservar: tu nombre, teléfono, correo electrónico, el servicio y el barbero que eliges, y la fecha y hora de la cita. Si creas una cuenta: tu correo y los datos de tu perfil. Automáticamente: datos técnicos básicos del dispositivo y registros de errores para mejorar la plataforma, y, solo si lo autorizas, el identificador de notificaciones push de tu dispositivo.

3. Para qué los usamos. Para crear y gestionar tus citas, avisarte de aprobaciones, cambios, cancelaciones y recordatorios, prestar el servicio de barbería, mantener la seguridad de la plataforma y cumplir obligaciones legales. No vendemos tus datos personales.

4. Con quién se comparten. Con el barbero que atenderá tu cita (nombre, servicio y hora). Con nuestros proveedores técnicos: Supabase (base de datos y cuentas) y Firebase de Google (envío de notificaciones push), que tratan los datos solo para prestarnos el servicio. No compartimos tus datos con terceros para mercadeo.

5. Cuánto tiempo los guardamos. Los datos de tus citas se conservan mientras sean necesarios para el servicio y para nuestros registros comerciales. Puedes pedir su eliminación según el punto 7.

6. Seguridad. Usamos conexiones cifradas, control de acceso por roles y registros de auditoría. Ningún sistema es perfecto, pero protegemos tus datos con medidas razonables y revisadas.

7. Tus derechos. Puedes pedir acceso a tus datos, corregirlos, o pedir que los eliminemos, escribiéndonos a support@goatstylesalon.com o llamando al 787-218-1068. Responderemos en un plazo razonable.

8. Menores. La plataforma está dirigida a personas con capacidad para contratar el servicio. Los menores deben reservar con la autorización de su padre, madre o encargado.

9. Notificaciones. Si activas las notificaciones push, puedes desactivarlas en cualquier momento en los ajustes de tu dispositivo o de la aplicación.

10. Cambios. Si cambiamos esta política de forma importante, lo avisaremos en la plataforma y, cuando aplique, te pediremos aceptarla de nuevo. Fecha de última actualización al inicio del documento.', 1, '2026-11-25T12:00:00-04:00'::timestamptz),
    ('cookies', 'Política de Cookies y Almacenamiento Local', '1. Qué usamos. Esta plataforma funciona como aplicación web progresiva (PWA). Para funcionar usa almacenamiento local de tu navegador (localStorage e IndexedDB) y un Service Worker que guarda archivos en caché. Esto cumple funciones parecidas a las cookies, aunque técnicamente no todo son cookies.

2. Para qué. Guardamos: tu sesión iniciada (solo paneles con cuenta), tus preferencias (idioma, tema, ajustes de notificaciones), tus citas hechas desde ese dispositivo, la versión de los términos que aceptaste y archivos en caché para que la app abra rápido y funcione con conexión limitada.

3. Qué NO hacemos. No usamos cookies de publicidad ni rastreadores de terceros para crear perfiles de anuncios. Los únicos servicios externos que reciben datos técnicos son Supabase y Firebase, descritos en la Política de Privacidad.

4. Cómo controlarlo. Puedes borrar el almacenamiento y la caché desde los ajustes de tu navegador o desinstalando la aplicación; al hacerlo se cerrará tu sesión y se perderán las preferencias guardadas en ese dispositivo. Si bloqueas todo el almacenamiento, partes de la plataforma pueden dejar de funcionar.

5. Cambios. Actualizaremos esta política si cambian las tecnologías que usamos, indicando la fecha al inicio del documento. Contacto: support@goatstylesalon.com, 787-218-1068.', 1, '2026-11-25T12:00:00-04:00'::timestamptz),
    ('reservas', 'Política de Reservas y Cancelaciones', '1. Cómo se confirma una cita. Las reservas en línea quedan PENDIENTES hasta que el barbero las revisa y las aprueba. Te avisaremos por la aplicación, por correo o por WhatsApp cuando tu cita sea aprobada, rechazada o reprogramada.

2. Llegadas tarde. Te pedimos llegar 5 minutos antes. Si llegas más de 10 minutos tarde, el barbero puede atenderte según disponibilidad o reprogramar tu cita.

3. Cancelar o cambiar tu cita. Puedes cancelar desde la aplicación o llamando al 787-218-1068, idealmente con al menos 2 horas de anticipación, para que otra persona pueda usar ese espacio.

4. Ausencias. Las ausencias repetidas sin aviso pueden limitar tu posibilidad de reservar en línea en el futuro.

5. Cambios por la barbería. Si el barbero debe cancelar o mover tu cita (emergencia, enfermedad o cierre del local), te avisaremos lo antes posible y te ofreceremos otro horario.

6. Precios. Los precios mostrados en la plataforma son los del servicio en el local y pueden cambiar sin aviso previo; el precio válido es el confirmado por el barbero al aprobar tu cita.', 1, '2026-11-25T12:00:00-04:00'::timestamptz),
    ('pagos', 'Política de Pagos', '1. Pago presencial. Todos los pagos se hacen en persona, en la barbería, al momento de recibir el servicio.

2. Sin pagos en línea. Esta plataforma NO cobra pagos, depósitos ni anticipos en línea, y nunca te pedirá datos de tarjeta por la aplicación, por correo ni por WhatsApp. Si alguien te los pide a nuestro nombre, no los des y avísanos al 787-218-1068.

3. Métodos aceptados. Los métodos de pago aceptados en el local son los que te confirme el barbero al momento del servicio.

4. Reembolsos. Como el pago es presencial y posterior al servicio, cualquier ajuste o reclamación se atiende directamente en el local o por teléfono, caso por caso, conforme a la ley de protección al consumidor de Puerto Rico.', 1, '2026-11-25T12:00:00-04:00'::timestamptz)
on conflict (slug) do nothing;

commit;
