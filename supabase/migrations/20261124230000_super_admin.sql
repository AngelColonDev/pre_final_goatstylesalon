-- =============================================================================
-- GOAT Style Salon — Panel de Super Administrador (PR #18, ítem F)
-- Migración: 20261124230000_super_admin.sql
-- Rama: super-admin. Aplicar en Supabase → SQL Editor → Run, ANTES del merge.
--
-- Crea: profiles (con rol super_admin), is_super_admin(), login en servidor
-- (record_login_attempt / check_login_allowed + admin_settings), audit_log
-- inmutable, maintenance, area_permissions + plantillas, tickets (+ mensajes
-- y respuestas guardadas), error_logs y las RPCs SECURITY DEFINER del panel.
--
-- NO toca las políticas existentes: solo AÑADE políticas permisivas para el
-- super_admin sobre las tablas que ya existen. No borra ni reescribe ninguna
-- política de schema.sql. No crea usuarios de Auth ni inventa emails.
--
-- REQUISITO PREVIO: los 3 usuarios del personal ya deben existir en
-- Authentication → Users (gaby@, darialex@, wilo@goatstylesalon.com), como
-- ya pedía schema.sql. El email del SUPER_ADMIN (Ángel) NO está en el repo:
-- ver el bloque "PRIMER SUPER_ADMIN" al final de este archivo y el README.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Extensiones / compatibilidad con lo que ya existe
-- -----------------------------------------------------------------------------
-- login_attempts ya existe en schema.sql (email, count, account_type,
-- last_at). Solo se añaden las columnas que faltan para el bloqueo en
-- servidor; register_failed_login / login_guard / account_locks se conservan
-- tal cual para no romper el panel técnico actual.
alter table public.login_attempts
    add column if not exists blocked_until timestamptz,
    add column if not exists last_ip text,
    add column if not exists last_device text;

-- -----------------------------------------------------------------------------
-- 1. profiles — cuentas con rol (el plan original la proponía con
-- cliente/barbero/admin; aquí se crea de verdad, ampliada con super_admin)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text not null,
    nombre text not null default '',
    role text not null default 'cliente'
        check (role in ('cliente', 'barbero', 'admin', 'super_admin')),
    estado text not null default 'activo'
        check (estado in ('activo', 'bloqueado', 'suspendido', 'cancelado')),
    motivo text,                       -- motivo del último cambio de estado
    suspendido_hasta timestamptz,      -- solo cuando estado = 'suspendido'
    ultimo_login_at timestamptz,
    barber_id text references public.barbers (id) on delete set null,
    -- Seguridad: la forma honesta de "cerrar sesiones" sin service_role.
    -- Los paneles revisan estos flags al cargar y obligan a reautenticarse.
    force_reauth boolean not null default false,
    force_password_change boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_barber_idx on public.profiles (barber_id);

-- Solo el super_admin puede cambiar rol, estado o flags de seguridad de un
-- perfil. Un barbero/admin puede editar su propio nombre, nada más.
create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if public.is_super_admin() then
        return new;
    end if;
    if new.role is distinct from old.role
        or new.estado is distinct from old.estado
        or new.barber_id is distinct from old.barber_id
        or new.force_reauth is distinct from old.force_reauth
        or new.force_password_change is distinct from old.force_password_change
        or new.suspendido_hasta is distinct from old.suspendido_hasta
        or new.motivo is distinct from old.motivo then
        raise exception 'Solo el super administrador puede cambiar rol, estado o flags de seguridad.';
    end if;
    if new.id is distinct from old.id or new.email is distinct from old.email then
        raise exception 'El id y el email de un perfil no se pueden cambiar desde el panel.';
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
    before update on public.profiles
    for each row execute function public.profiles_guard();

-- updated_at automático.
create or replace function public.set_updated_at()
returns trigger
language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();

-- true solo si auth.uid() tiene role = 'super_admin' y estado = 'activo'.
-- SECURITY DEFINER para no entrar en recursión con las políticas RLS.
create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'super_admin' and estado = 'activo'
    );
$$;

-- Cuando se crea un usuario en Auth, nace su perfil como cliente. El super
-- admin luego le sube el rol con set_profile_role() / grant_super_admin().
-- (Si el proyecto no permite triggers sobre auth.users, este bloque avisa y
-- la migración sigue: el alta de perfiles la hace entonces el super_admin.)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, email, nombre, role, estado)
    values (new.id, coalesce(new.email, ''), '', 'cliente', 'activo')
    on conflict (id) do nothing;
    return new;
end;
$$;

do $$
begin
    execute 'drop trigger if exists on_auth_user_created on auth.users';
    execute 'create trigger on_auth_user_created after insert on auth.users '
         || 'for each row execute function public.handle_new_auth_user()';
exception when others then
    raise notice 'No se pudo crear el trigger sobre auth.users (%). Los perfiles se crearán desde el panel.', sqlerrm;
end $$;

-- Poblar profiles para los 3 barberos existentes desde staff_roles, con sus
-- emails reales del repo (gaby@, darialex@, wilo@goatstylesalon.com).
-- gaby es admin; darialex y wilo son barberos. Nunca degrada a un
-- super_admin ya otorgado.
insert into public.profiles (id, email, nombre, role, estado, barber_id)
select u.id, u.email, coalesce(b.name, ''), case when s.is_admin then 'admin' else 'barbero' end, 'activo', s.barber_id
from public.staff_roles s
join auth.users u on u.id = s.user_id
left join public.barbers b on b.id = s.barber_id
on conflict (id) do update set
    email = excluded.email,
    nombre = excluded.nombre,
    role = case when public.profiles.role = 'super_admin' then public.profiles.role else excluded.role end,
    barber_id = excluded.barber_id;

-- -----------------------------------------------------------------------------
-- 2. RLS de profiles
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
    for select using (id = auth.uid() or public.is_super_admin());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
    for update using (id = auth.uid() or public.is_super_admin())
    with check (id = auth.uid() or public.is_super_admin());

-- Solo el super_admin inserta/borra perfiles directamente (el alta normal la
-- hace el trigger on_auth_user_created, que es SECURITY DEFINER).
drop policy if exists profiles_super_admin_write on public.profiles;
create policy profiles_super_admin_write on public.profiles
    for all using (public.is_super_admin())
    with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 3. El super_admin también ve y gestiona las tablas que ya existen.
--    Políticas ADITIVAS: no se toca ninguna política existente de schema.sql
--    (las permisivas se suman con OR; nada de lo que ya funcionaba se rompe).
--    Los clientes NO tienen cuenta de Auth (reservan por código), así que su
--    acceso sigue siendo por RPC (appointment_status, my_notifications):
--    aquí no se inventa un acceso de cliente por RLS sobre clients.
-- -----------------------------------------------------------------------------
drop policy if exists barbers_super_admin on public.barbers;
create policy barbers_super_admin on public.barbers
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists staff_roles_super_admin on public.staff_roles;
create policy staff_roles_super_admin on public.staff_roles
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists clients_super_admin on public.clients;
create policy clients_super_admin on public.clients
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists services_super_admin on public.services;
create policy services_super_admin on public.services
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists products_super_admin on public.products;
create policy products_super_admin on public.products
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists gallery_super_admin on public.gallery;
create policy gallery_super_admin on public.gallery
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists news_super_admin on public.news;
create policy news_super_admin on public.news
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists providers_super_admin on public.providers;
create policy providers_super_admin on public.providers
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists appointments_super_admin on public.appointments;
create policy appointments_super_admin on public.appointments
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists reviews_super_admin on public.reviews;
create policy reviews_super_admin on public.reviews
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists activity_super_admin on public.activity_log;
create policy activity_super_admin on public.activity_log
    for select using (public.is_super_admin());

drop policy if exists applications_super_admin on public.barber_applications;
create policy applications_super_admin on public.barber_applications
    for select using (public.is_super_admin());

drop policy if exists settings_super_admin on public.shop_settings;
create policy settings_super_admin on public.shop_settings
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists memos_super_admin on public.memos;
create policy memos_super_admin on public.memos
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists payments_super_admin on public.payments;
create policy payments_super_admin on public.payments
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists discounts_super_admin on public.discounts;
create policy discounts_super_admin on public.discounts
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists notifications_super_admin on public.notifications;
create policy notifications_super_admin on public.notifications
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists push_tokens_super_admin on public.push_tokens;
create policy push_tokens_super_admin on public.push_tokens
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists site_config_super_admin on public.site_config;
create policy site_config_super_admin on public.site_config
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists login_attempts_super_admin on public.login_attempts;
create policy login_attempts_super_admin on public.login_attempts
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists account_locks_super_admin on public.account_locks;
create policy account_locks_super_admin on public.account_locks
    for all using (public.is_super_admin()) with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 4. admin_settings — configuración que el super_admin puede cambiar
--    (máximo de intentos de login, minutos de bloqueo). Por defecto 3 y 15.
-- -----------------------------------------------------------------------------
create table if not exists public.admin_settings (
    key text primary key,
    value_int int,
    value_text text,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users (id) on delete set null
);

insert into public.admin_settings (key, value_int) values
    ('max_login_attempts', 3),
    ('lockout_minutes', 15)
on conflict (key) do nothing;

alter table public.admin_settings enable row level security;

drop policy if exists admin_settings_super_admin on public.admin_settings;
create policy admin_settings_super_admin on public.admin_settings
    for all using (public.is_super_admin()) with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 5. audit_log — quién, qué, a quién, cuándo, antes/después.
--    Solo INSERT (desde las RPCs, que son SECURITY DEFINER) y SELECT para el
--    super_admin. SIN UPDATE ni DELETE para nadie: ni siquiera el super_admin
--    puede borrarlo ni editarlo (el trigger lo impide hasta para el dueño).
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references auth.users (id) on delete set null,
    actor_email text,
    action text not null,
    target_type text not null default '',
    target_id text not null default '',
    before_data jsonb,
    after_data jsonb,
    created_at timestamptz not null default now()
);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, created_at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_type, target_id);

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql as $$
begin
    raise exception 'audit_log no se puede modificar ni borrar.';
end;
$$;

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable
    before update or delete on public.audit_log
    for each row execute function public.audit_log_immutable();

alter table public.audit_log enable row level security;

-- Intencionadamente NO hay política de INSERT/UPDATE/DELETE: el acceso
-- directo queda bloqueado para todos los roles; solo las RPCs SECURITY
-- DEFINER escriben, y solo el super_admin lee.
drop policy if exists audit_log_super_admin_read on public.audit_log;
create policy audit_log_super_admin_read on public.audit_log
    for select using (public.is_super_admin());

-- Helper que llaman las RPCs sensibles. No se concede a anon.
create or replace function public.log_audit(
    p_action text, p_target_type text, p_target_id text,
    p_before jsonb default null, p_after jsonb default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
    v_id uuid;
    v_actor uuid := auth.uid();
    v_email text;
begin
    select email into v_email from auth.users where id = v_actor;
    insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, before_data, after_data)
    values (v_actor, v_email, p_action, p_target_type, p_target_id, p_before, p_after)
    returning id into v_id;
    return v_id;
end;
$$;
revoke all on function public.log_audit(text, text, text, jsonb, jsonb) from public;
grant execute on function public.log_audit(text, text, text, jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Intentos de login EN EL SERVIDOR (nunca en localStorage)
--    Reutiliza login_attempts / account_locks, que ya existen. El frontend
--    debe llamar a estas RPCs en vez de a register_failed_login (que se
--    conserva por compatibilidad con el panel técnico actual).
-- -----------------------------------------------------------------------------
create or replace function public.check_login_allowed(p_email text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_email text := lower(trim(p_email));
    v_max int;
    v_row public.login_attempts;
begin
    select coalesce(value_int, 3) into v_max
    from public.admin_settings where key = 'max_login_attempts';
    select * into v_row from public.login_attempts where email = v_email;
    if v_row.email is null then
        return jsonb_build_object('allowed', true, 'attempts', 0,
            'attempts_left', v_max, 'blocked_until', null);
    end if;
    -- Bloqueo caducado: se considera libre (el contador se resetea al
    -- registrar el siguiente intento fallido).
    if v_row.blocked_until is not null and v_row.blocked_until <= now() then
        return jsonb_build_object('allowed', true, 'attempts', 0,
            'attempts_left', v_max, 'blocked_until', null);
    end if;
    return jsonb_build_object(
        'allowed', v_row.blocked_until is null or v_row.blocked_until <= now(),
        'attempts', coalesce(v_row.count, 0),
        'attempts_left', greatest(0, v_max - coalesce(v_row.count, 0)),
        'blocked_until', v_row.blocked_until);
end;
$$;

create or replace function public.record_login_attempt(
    p_email text, p_exito boolean,
    p_ip text default null, p_dispositivo text default null
)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
    v_email text := lower(trim(p_email));
    v_max int;
    v_lock_min int;
    v_count int;
    v_blocked timestamptz;
    v_user uuid;
begin
    if v_email = '' then
        raise exception 'El email no puede estar vacío.';
    end if;
    select coalesce(value_int, 3) into v_max
    from public.admin_settings where key = 'max_login_attempts';
    select coalesce(value_int, 15) into v_lock_min
    from public.admin_settings where key = 'lockout_minutes';

    if p_exito then
        insert into public.login_attempts (email, count, account_type, last_at, blocked_until, last_ip, last_device)
        values (v_email, 0, 'staff', now(), null, p_ip, p_dispositivo)
        on conflict (email) do update set
            count = 0, blocked_until = null, last_at = now(),
            last_ip = excluded.last_ip, last_device = excluded.last_device;
        return jsonb_build_object('locked', false, 'attempts_left', v_max, 'blocked_until', null);
    end if;

    -- Si el bloqueo anterior ya caducó, el contador vuelve a cero.
    update public.login_attempts set count = 0, blocked_until = null
    where email = v_email and blocked_until is not null and blocked_until <= now();

    insert into public.login_attempts (email, count, account_type, last_at, blocked_until, last_ip, last_device)
    values (v_email, 1, 'staff', now(), null, p_ip, p_dispositivo)
    on conflict (email) do update set
        count = public.login_attempts.count + 1,
        last_at = now(),
        last_ip = excluded.last_ip,
        last_device = excluded.last_device,
        blocked_until = case
            when public.login_attempts.blocked_until is not null
                 and public.login_attempts.blocked_until > now()
                then public.login_attempts.blocked_until
            when public.login_attempts.count + 1 >= v_max
                then now() + make_interval(mins => v_lock_min)
            else null end
    returning count, blocked_until into v_count, v_blocked;

    if v_count >= v_max then
        -- Espejo del comportamiento actual: si la cuenta existe en Auth y
        -- no tiene un bloqueo activo, queda registrada en account_locks.
        select id into v_user from auth.users where lower(email) = v_email;
        if v_user is not null and not exists (
            select 1 from public.account_locks
            where lower(email) = v_email and status <> 'DESBLOQUEADA'
        ) then
            insert into public.account_locks (email, account_type, user_id, attempts, user_agent)
            values (v_email, 'staff', v_user, v_count, left(coalesce(p_dispositivo, ''), 400));
        end if;
    end if;

    return jsonb_build_object(
        'locked', v_count >= v_max,
        'attempts_left', greatest(0, v_max - v_count),
        'blocked_until', v_blocked);
end;
$$;

revoke all on function public.check_login_allowed(text) from public;
revoke all on function public.record_login_attempt(text, boolean, text, text) from public;
grant execute on function public.check_login_allowed(text) to anon, authenticated;
grant execute on function public.record_login_attempt(text, boolean, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. maintenance — global y por área. La lista blanca es implícita:
--    is_super_admin() siempre pasa (las RPCs y las políticas lo garantizan).
--    Lectura pública SOLO de filas activas y solo de columnas no sensibles
--    (toda la tabla es no sensible por diseño: área, activa, mensaje, inicio,
--    fin). Escritura solo super_admin.
--    Áreas previstas: global, reservas, pagos, avisos, panel, clientes.
--    Convive con site_config.maintenance (panel técnico actual); esta tabla
--    es la canónica para el panel de super admin.
-- -----------------------------------------------------------------------------
create table if not exists public.maintenance (
    area text primary key,               -- 'global' = toda la barbería
    activa boolean not null default false,
    mensaje text not null default '',
    inicia_at timestamptz,
    termina_at timestamptz,
    updated_by uuid references auth.users (id) on delete set null,
    updated_at timestamptz not null default now()
);

insert into public.maintenance (area, activa, mensaje) values
    ('global', false, ''),
    ('reservas', false, ''),
    ('pagos', false, ''),
    ('avisos', false, ''),
    ('panel', false, ''),
    ('clientes', false, '')
on conflict (area) do nothing;

alter table public.maintenance enable row level security;

drop policy if exists maintenance_public_read on public.maintenance;
create policy maintenance_public_read on public.maintenance
    for select using (activa = true);

drop policy if exists maintenance_super_admin on public.maintenance;
create policy maintenance_super_admin on public.maintenance
    for all using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.set_maintenance(
    p_area text, p_activa boolean, p_mensaje text default '',
    p_inicia_at timestamptz default null, p_termina_at timestamptz default null
)
returns public.maintenance
language plpgsql security definer set search_path = public as $$
declare
    v_row public.maintenance;
    v_before jsonb;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede cambiar el mantenimiento.';
    end if;
    if p_area is null or btrim(p_area) = '' then
        raise exception 'Indica el área (global, reservas, pagos, avisos, panel o clientes).';
    end if;
    select to_jsonb(m) into v_before from public.maintenance m where m.area = p_area;
    insert into public.maintenance (area, activa, mensaje, inicia_at, termina_at, updated_by)
    values (p_area, p_activa, coalesce(p_mensaje, ''), p_inicia_at, p_termina_at, auth.uid())
    on conflict (area) do update set
        activa = excluded.activa, mensaje = excluded.mensaje,
        inicia_at = excluded.inicia_at, termina_at = excluded.termina_at,
        updated_by = excluded.updated_by, updated_at = now()
    returning * into v_row;
    perform public.log_audit('maintenance.set', 'maintenance', p_area, v_before, to_jsonb(v_row));
    return v_row;
end;
$$;

revoke all on function public.set_maintenance(text, boolean, text, timestamptz, timestamptz) from public;
grant execute on function public.set_maintenance(text, boolean, text, timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. area_permissions — matriz por barbero y por barbería + plantillas
-- -----------------------------------------------------------------------------
create table if not exists public.area_permissions (
    barber_id text not null references public.barbers (id) on delete cascade,
    area text not null,
    permitido boolean not null default false,
    updated_by uuid references auth.users (id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (barber_id, area)
);

create table if not exists public.permission_templates (
    id text primary key,                 -- 'basico' | 'encargado'
    nombre text not null,
    descripcion text not null default '',
    permisos jsonb not null default '{}'::jsonb,  -- { "reservas": true, ... }
    created_at timestamptz not null default now()
);

insert into public.permission_templates (id, nombre, descripcion, permisos) values
('basico', 'Barbero básico',
 'Reservas, clientes, servicios y avisos. Sin productos, galería, noticias, pagos, descuentos, ajustes ni reportes.',
 '{"reservas": true, "clientes": true, "servicios": true, "avisos": true, "productos": false, "galeria": false, "noticias": false, "pagos": false, "descuentos": false, "ajustes": false, "reportes": false}'::jsonb),
('encargado', 'Barbero encargado',
 'Todo lo del barbero básico más productos, galería, noticias, pagos, descuentos y reportes. Sin ajustes.',
 '{"reservas": true, "clientes": true, "servicios": true, "avisos": true, "productos": true, "galeria": true, "noticias": true, "pagos": true, "descuentos": true, "reportes": true, "ajustes": false}'::jsonb)
on conflict (id) do update set
    nombre = excluded.nombre, descripcion = excluded.descripcion, permisos = excluded.permisos;

alter table public.area_permissions enable row level security;
alter table public.permission_templates enable row level security;

drop policy if exists area_permissions_self_read on public.area_permissions;
create policy area_permissions_self_read on public.area_permissions
    for select using (public.is_super_admin() or barber_id = public.my_barber_id());

drop policy if exists area_permissions_super_admin on public.area_permissions;
create policy area_permissions_super_admin on public.area_permissions
    for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists permission_templates_read on public.permission_templates;
create policy permission_templates_read on public.permission_templates
    for select using (public.is_staff() or public.is_super_admin());

drop policy if exists permission_templates_super_admin on public.permission_templates;
create policy permission_templates_super_admin on public.permission_templates
    for all using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.set_area_permission(
    p_barber_id text, p_area text, p_permitido boolean
)
returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede cambiar permisos por área.';
    end if;
    if not exists (select 1 from public.barbers where id = p_barber_id) then
        raise exception 'Ese barbero no existe.';
    end if;
    insert into public.area_permissions (barber_id, area, permitido, updated_by)
    values (p_barber_id, p_area, p_permitido, auth.uid())
    on conflict (barber_id, area) do update set
        permitido = excluded.permitido, updated_by = excluded.updated_by, updated_at = now();
    perform public.log_audit('permissions.set', 'area_permissions', p_barber_id || '/' || p_area, null,
        jsonb_build_object('barber_id', p_barber_id, 'area', p_area, 'permitido', p_permitido));
end;
$$;

create or replace function public.apply_permission_template(
    p_barber_id text, p_template_id text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_perms jsonb;
    v_area text;
    v_val boolean;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede aplicar plantillas de permisos.';
    end if;
    if not exists (select 1 from public.barbers where id = p_barber_id) then
        raise exception 'Ese barbero no existe.';
    end if;
    select permisos into v_perms from public.permission_templates where id = p_template_id;
    if v_perms is null then
        raise exception 'Esa plantilla no existe.';
    end if;
    delete from public.area_permissions where barber_id = p_barber_id;
    for v_area, v_val in select key, (value)::boolean from jsonb_each(v_perms) loop
        insert into public.area_permissions (barber_id, area, permitido, updated_by)
        values (p_barber_id, v_area, v_val, auth.uid());
    end loop;
    perform public.log_audit('permissions.apply_template', 'area_permissions', p_barber_id, null,
        jsonb_build_object('barber_id', p_barber_id, 'template', p_template_id, 'permisos', v_perms));
    return v_perms;
end;
$$;

revoke all on function public.set_area_permission(text, text, boolean) from public;
revoke all on function public.apply_permission_template(text, text) from public;
grant execute on function public.set_area_permission(text, text, boolean) to authenticated;
grant execute on function public.apply_permission_template(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. tickets — soporte (categoría, prioridad, estado, conversación hija,
--    notas internas y respuestas guardadas)
-- -----------------------------------------------------------------------------
create table if not exists public.tickets (
    id uuid primary key default gen_random_uuid(),
    categoria text not null default 'otro'
        check (categoria in ('cuenta', 'citas', 'pagos', 'error_tecnico', 'otro')),
    prioridad text not null default 'media'
        check (prioridad in ('baja', 'media', 'alta', 'urgente')),
    estado text not null default 'abierto'
        check (estado in ('abierto', 'en_proceso', 'resuelto')),
    titulo text not null default '',
    descripcion text not null default '',
    reporter_name text not null default '',
    reporter_email text not null default '',
    created_by uuid references auth.users (id) on delete set null,
    barber_id text references public.barbers (id) on delete set null,
    assigned_to uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists tickets_estado_idx on public.tickets (estado, created_at desc);
create index if not exists tickets_barber_idx on public.tickets (barber_id);

drop trigger if exists tickets_updated_at on public.tickets;
create trigger tickets_updated_at
    before update on public.tickets
    for each row execute function public.set_updated_at();

create table if not exists public.ticket_messages (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null references public.tickets (id) on delete cascade,
    author_id uuid references auth.users (id) on delete set null,
    author_role text not null default 'cliente',
    mensaje text not null default '',
    is_internal boolean not null default false,  -- nota interna: solo super_admin
    created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

create table if not exists public.saved_replies (
    id uuid primary key default gen_random_uuid(),
    titulo text not null,
    cuerpo text not null default '',
    categoria text not null default 'otro'
        check (categoria in ('cuenta', 'citas', 'pagos', 'error_tecnico', 'otro')),
    created_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now()
);

insert into public.saved_replies (titulo, cuerpo, categoria) values
('Cita recibida', '¡Gracias por escribir! Recibimos tu solicitud de cita y el barbero la revisará. Te avisaremos cuando se confirme.', 'citas'),
('Cita cancelada', 'Tu cita quedó cancelada. Si quieres, puedes reservar otro horario desde la página.', 'citas'),
('Problema con la página', 'Gracias por avisar. Estamos revisando el error y te escribiremos cuando esté resuelto.', 'error_tecnico')
on conflict (id) do nothing;

alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.saved_replies enable row level security;

-- Tickets: el super_admin ve todos; cada barbero ve los suyos; cualquiera
-- (incluso sin cuenta) puede abrir uno.
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets
    for select using (
        public.is_super_admin()
        or created_by = auth.uid()
        or barber_id = public.my_barber_id()
    );

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
    for insert with check (true);

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
    for update using (
        public.is_super_admin() or barber_id = public.my_barber_id()
    ) with check (
        public.is_super_admin() or barber_id = public.my_barber_id()
    );

drop policy if exists tickets_super_admin_delete on public.tickets;
create policy tickets_super_admin_delete on public.tickets
    for delete using (public.is_super_admin());

-- Mensajes: notas internas solo para el super_admin; el resto lo ven el
-- super_admin, el autor y el barbero del ticket.
drop policy if exists ticket_messages_read on public.ticket_messages;
create policy ticket_messages_read on public.ticket_messages
    for select using (
        public.is_super_admin()
        or (not is_internal and (
            author_id = auth.uid()
            or exists (select 1 from public.tickets t
                       where t.id = ticket_messages.ticket_id
                         and (t.created_by = auth.uid() or t.barber_id = public.my_barber_id()))
        ))
    );

drop policy if exists ticket_messages_insert on public.ticket_messages;
create policy ticket_messages_insert on public.ticket_messages
    for insert with check (not is_internal or public.is_super_admin());

-- Respuestas guardadas: las lee el personal; solo el super_admin las crea,
-- edita o borra.
drop policy if exists saved_replies_read on public.saved_replies;
create policy saved_replies_read on public.saved_replies
    for select using (public.is_staff() or public.is_super_admin());

drop policy if exists saved_replies_super_admin on public.saved_replies;
create policy saved_replies_super_admin on public.saved_replies
    for all using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.set_ticket_status(p_ticket_id uuid, p_estado text)
returns void
language plpgsql security definer set search_path = public as $$
declare
    v_before jsonb;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede cambiar el estado de un ticket.';
    end if;
    if p_estado not in ('abierto', 'en_proceso', 'resuelto') then
        raise exception 'Estado de ticket no válido.';
    end if;
    select to_jsonb(t) into v_before from public.tickets t where t.id = p_ticket_id;
    if v_before is null then
        raise exception 'Ese ticket no existe.';
    end if;
    update public.tickets set estado = p_estado where id = p_ticket_id;
    perform public.log_audit('ticket.set_status', 'tickets', p_ticket_id::text, v_before,
        jsonb_build_object('estado', p_estado));
end;
$$;

create or replace function public.add_ticket_reply(
    p_ticket_id uuid, p_mensaje text, p_is_internal boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
    v_id uuid;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede responder tickets desde el panel.';
    end if;
    if not exists (select 1 from public.tickets where id = p_ticket_id) then
        raise exception 'Ese ticket no existe.';
    end if;
    insert into public.ticket_messages (ticket_id, author_id, author_role, mensaje, is_internal)
    values (p_ticket_id, auth.uid(), 'super_admin', p_mensaje, coalesce(p_is_internal, false))
    returning id into v_id;
    perform public.log_audit('ticket.reply', 'tickets', p_ticket_id::text, null,
        jsonb_build_object('message_id', v_id, 'is_internal', coalesce(p_is_internal, false)));
    return v_id;
end;
$$;

revoke all on function public.set_ticket_status(uuid, text) from public;
revoke all on function public.add_ticket_reply(uuid, text, boolean) from public;
grant execute on function public.set_ticket_status(uuid, text) to authenticated;
grant execute on function public.add_ticket_reply(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. error_logs — el frontend reporta errores (mensaje, stack, página,
--     usuario). Escritura abierta, lectura solo super_admin, sin UPDATE/DELETE.
-- -----------------------------------------------------------------------------
create table if not exists public.error_logs (
    id uuid primary key default gen_random_uuid(),
    mensaje text not null default '',
    stack text,
    pagina text,
    usuario text,
    user_agent text,
    created_at timestamptz not null default now()
);
create index if not exists error_logs_created_idx on public.error_logs (created_at desc);

alter table public.error_logs enable row level security;

drop policy if exists error_logs_insert on public.error_logs;
create policy error_logs_insert on public.error_logs
    for insert with check (true);

drop policy if exists error_logs_super_admin_read on public.error_logs;
create policy error_logs_super_admin_read on public.error_logs
    for select using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 11. RPCs de cuentas — todas verifican is_super_admin() y escriben en
--     audit_log. Ninguna recibe ni guarda service_role keys ni contraseñas.
-- -----------------------------------------------------------------------------

-- Otorgar (o quitar) el rol de super_admin a un usuario EXISTENTE de Auth.
-- Exige que quien llama YA sea super_admin: el PRIMER super_admin NO se
-- otorga con esta RPC, sino con el bloque SQL del final (SQL Editor).
create or replace function public.grant_super_admin(p_email text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
    v_user uuid;
    v_before jsonb;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede otorgar ese rol.';
    end if;
    select id into v_user from auth.users where lower(email) = lower(trim(p_email));
    if v_user is null then
        raise exception 'No existe un usuario de Auth con ese email. Créalo primero en Authentication → Users.';
    end if;
    select to_jsonb(p) into v_before from public.profiles p where p.id = v_user;
    insert into public.profiles (id, email, nombre, role, estado)
    values (v_user, lower(trim(p_email)), '', 'super_admin', 'activo')
    on conflict (id) do update set role = 'super_admin', estado = 'activo', updated_at = now();
    perform public.log_audit('profile.grant_super_admin', 'profiles', v_user::text, v_before,
        jsonb_build_object('role', 'super_admin'));
    return v_user;
end;
$$;

-- Cambiar el rol de un perfil (cliente/barbero/admin/super_admin).
create or replace function public.set_profile_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
declare
    v_before jsonb;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede cambiar roles.';
    end if;
    if p_role not in ('cliente', 'barbero', 'admin', 'super_admin') then
        raise exception 'Rol no válido.';
    end if;
    select to_jsonb(p) into v_before from public.profiles p where p.id = p_user_id;
    if v_before is null then
        raise exception 'Ese perfil no existe.';
    end if;
    update public.profiles set role = p_role where id = p_user_id;
    perform public.log_audit('profile.set_role', 'profiles', p_user_id::text, v_before,
        jsonb_build_object('role', p_role));
end;
$$;

-- Bloquear / suspender / cancelar / reactivar una cuenta.
-- Cancelar EXIGE motivo (la confirmación escribiendo "CANCELAR" es de la UI,
-- no de la BD). Bloquear, suspender o cancelar marca force_reauth para que
-- los paneles obliguen a reautenticarse al cargar.
create or replace function public.set_account_status(
    p_user_id uuid, p_estado text, p_motivo text default null,
    p_suspendido_hasta timestamptz default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
    v_before jsonb;
    v_force boolean := false;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede cambiar el estado de una cuenta.';
    end if;
    if p_estado not in ('activo', 'bloqueado', 'suspendido', 'cancelado') then
        raise exception 'Estado no válido.';
    end if;
    if p_estado = 'cancelado' and (p_motivo is null or btrim(p_motivo) = '') then
        raise exception 'Cancelar una cuenta exige un motivo.';
    end if;
    if p_estado = 'suspendido' and p_suspendido_hasta is null then
        raise exception 'Suspender exige una fecha de fin (suspendido_hasta).';
    end if;
    select to_jsonb(p) into v_before from public.profiles p where p.id = p_user_id;
    if v_before is null then
        raise exception 'Ese perfil no existe.';
    end if;
    v_force := p_estado <> 'activo';
    update public.profiles
    set estado = p_estado,
        motivo = p_motivo,
        suspendido_hasta = case when p_estado = 'suspendido' then p_suspendido_hasta else null end,
        force_reauth = case when v_force then true else force_reauth end
    where id = p_user_id;
    perform public.log_audit('account.set_status', 'profiles', p_user_id::text, v_before,
        jsonb_build_object('estado', p_estado, 'motivo', p_motivo,
            'suspendido_hasta', p_suspendido_hasta, 'force_reauth', v_force));
end;
$$;

-- Desbloquear una cuenta: limpia intentos, marca sus bloqueos como
-- resueltos y, si el perfil estaba bloqueado, lo reactiva.
create or replace function public.unlock_account(p_email text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
    v_email text := lower(trim(p_email));
    v_user uuid;
    v_before jsonb;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede desbloquear cuentas.';
    end if;
    select id into v_user from auth.users where lower(email) = v_email;
    delete from public.login_attempts where email = v_email;
    update public.account_locks
    set status = 'DESBLOQUEADA', resolved_at = now(), resolved_by = auth.uid()
    where lower(email) = v_email and status <> 'DESBLOQUEADA';
    if v_user is not null then
        select to_jsonb(p) into v_before from public.profiles p where p.id = v_user;
        update public.profiles set estado = 'activo', motivo = null, suspendido_hasta = null
        where id = v_user and estado = 'bloqueado';
        -- Al desbloquear se exige una contraseña nueva (igual que el flujo
        -- actual de resolve_account_lock).
        update public.staff_roles set must_change_password = true where user_id = v_user;
    end if;
    perform public.log_audit('account.unlock', 'profiles', coalesce(v_user::text, v_email), v_before,
        jsonb_build_object('email', v_email, 'estado', 'activo'));
    return jsonb_build_object('unlocked', true, 'email', v_email);
end;
$$;

-- Forzar cambio de contraseña: marca el flag, NO cambia la contraseña
-- directamente (eso lo hace el usuario o el email de restablecimiento).
-- También marca force_reauth para que el panel lo obligue al cargar.
create or replace function public.force_password_change(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
    v_before jsonb;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede forzar un cambio de contraseña.';
    end if;
    select to_jsonb(p) into v_before from public.profiles p where p.id = p_user_id;
    if v_before is null then
        raise exception 'Ese perfil no existe.';
    end if;
    update public.profiles
    set force_password_change = true, force_reauth = true
    where id = p_user_id;
    update public.staff_roles set must_change_password = true where user_id = p_user_id;
    perform public.log_audit('account.force_password_change', 'profiles', p_user_id::text, v_before,
        jsonb_build_object('force_password_change', true, 'force_reauth', true));
end;
$$;

-- "Cerrar todas las sesiones": LÍMITE HONESTO — sin la Admin API de Supabase
-- Auth (service_role) NO se pueden revocar sesiones reales desde el
-- frontend. Esta RPC hace lo más cercano y seguro desde SQL: marca
-- force_reauth (los paneles revisan el flag al cargar y cierran la sesión
-- local + piden login de nuevo) y deja constancia en audit_log. La
-- revocación real se hace a mano en el dashboard de Supabase
-- (Authentication → Users → usuario → "Delete user sessions" / ban).
-- Devuelve revoked = false a propósito: nunca debe parecer que revocó algo.
create or replace function public.close_user_sessions(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_before jsonb;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede cerrar sesiones.';
    end if;
    select to_jsonb(p) into v_before from public.profiles p where p.id = p_user_id;
    if v_before is null then
        raise exception 'Ese perfil no existe.';
    end if;
    update public.profiles set force_reauth = true where id = p_user_id;
    perform public.log_audit('account.close_sessions', 'profiles', p_user_id::text, v_before,
        jsonb_build_object('force_reauth', true, 'revoked', false));
    return jsonb_build_object(
        'revoked', false,
        'force_reauth', true,
        'message', 'Sesiones marcadas para reautenticación en los paneles. La revocación real de sesiones de Supabase Auth requiere la Admin API (service_role) o hacerlo a mano en Authentication → Users.');
end;
$$;

-- Cambiar el máximo de intentos de login (1–10).
create or replace function public.set_max_login_attempts(p_max int)
returns int
language plpgsql security definer set search_path = public as $$
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede cambiar el máximo de intentos.';
    end if;
    if p_max < 1 or p_max > 10 then
        raise exception 'El máximo de intentos debe estar entre 1 y 10.';
    end if;
    insert into public.admin_settings (key, value_int, updated_by)
    values ('max_login_attempts', p_max, auth.uid())
    on conflict (key) do update set value_int = excluded.value_int, updated_by = excluded.updated_by, updated_at = now();
    perform public.log_audit('settings.max_login_attempts', 'admin_settings', 'max_login_attempts', null,
        jsonb_build_object('max_login_attempts', p_max));
    return p_max;
end;
$$;

-- Notificación masiva: inserta en notifications; el push lo dispara el flujo
-- existente (Edge Function send-push con la clave de servicio). No envía
-- nada directamente y no acepta destinatarios vacíos para clientes.
create or replace function public.send_mass_notification(
    p_title text, p_body text, p_audience text,
    p_client_ids text[] default '{}'::text[],
    p_barber_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_n int := 0;
    v_id text;
    v_barber text;
    v_client text;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede enviar notificaciones masivas.';
    end if;
    if p_audience not in ('client', 'staff') then
        raise exception 'La audiencia debe ser client o staff.';
    end if;
    if p_audience = 'staff' then
        if coalesce(array_length(p_barber_ids, 1), 0) = 0 then
            for v_barber in select id from public.barbers where active loop
                insert into public.notifications (id, audience, barber_id, type, title, body)
                values ('nt-mass-' || gen_random_uuid()::text, 'staff', v_barber, 'masiva', p_title, p_body);
                v_n := v_n + 1;
            end loop;
        else
            foreach v_barber in array p_barber_ids loop
                insert into public.notifications (id, audience, barber_id, type, title, body)
                values ('nt-mass-' || gen_random_uuid()::text, 'staff', v_barber, 'masiva', p_title, p_body);
                v_n := v_n + 1;
            end loop;
        end if;
    else
        if coalesce(array_length(p_client_ids, 1), 0) = 0 then
            raise exception 'Indica al menos un cliente destinatario (client_ids). No hay envío masivo a todos los clientes sin lista.';
        end if;
        foreach v_client in array p_client_ids loop
            insert into public.notifications (id, audience, client_id, type, title, body)
            values ('nt-mass-' || gen_random_uuid()::text, 'client', v_client, 'masiva', p_title, p_body);
            v_n := v_n + 1;
        end loop;
    end if;
    perform public.log_audit('notification.mass_send', 'notifications', 'mass', null,
        jsonb_build_object('audience', p_audience, 'title', p_title, 'count', v_n));
    return jsonb_build_object('inserted', v_n, 'audience', p_audience);
end;
$$;

-- Exportar datos: devuelve las filas como JSONB (el CSV se genera en el
-- frontend). Solo tablas de la lista blanca; nunca auth.users ni secretos.
create or replace function public.export_data(p_table text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_out jsonb;
begin
    if not public.is_super_admin() then
        raise exception 'Solo el super administrador puede exportar datos.';
    end if;
    if p_table not in ('clients', 'appointments', 'notifications', 'profiles',
                       'tickets', 'error_logs', 'audit_log', 'login_attempts',
                       'barbers', 'services', 'reviews') then
        raise exception 'Esa tabla no se puede exportar.';
    end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), %L::jsonb) from public.%I t',
                   '[]'::jsonb, p_table) into v_out;
    perform public.log_audit('data.export', p_table, p_table, null,
        jsonb_build_object('rows', jsonb_array_length(coalesce(v_out, '[]'::jsonb))));
    return v_out;
end;
$$;

revoke all on function public.grant_super_admin(text) from public;
revoke all on function public.set_profile_role(uuid, text) from public;
revoke all on function public.set_account_status(uuid, text, text, timestamptz) from public;
revoke all on function public.unlock_account(text) from public;
revoke all on function public.force_password_change(uuid) from public;
revoke all on function public.close_user_sessions(uuid) from public;
revoke all on function public.set_max_login_attempts(int) from public;
revoke all on function public.send_mass_notification(text, text, text, text[], text[]) from public;
revoke all on function public.export_data(text) from public;
grant execute on function public.grant_super_admin(text) to authenticated;
grant execute on function public.set_profile_role(uuid, text) to authenticated;
grant execute on function public.set_account_status(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.unlock_account(text) to authenticated;
grant execute on function public.force_password_change(uuid) to authenticated;
grant execute on function public.close_user_sessions(uuid) to authenticated;
grant execute on function public.set_max_login_attempts(int) to authenticated;
grant execute on function public.send_mass_notification(text, text, text, text[], text[]) to authenticated;
grant execute on function public.export_data(text) to authenticated;
grant execute on function public.is_super_admin() to anon, authenticated;

-- Permisos de tablas nuevas (RLS sigue mandando; los grants solo permiten
-- llegar a la política).
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select on public.audit_log to authenticated;
grant select on public.admin_settings to authenticated;
grant select on public.maintenance to anon, authenticated;
grant select, insert, update, delete on public.maintenance to authenticated;
grant select, insert, update, delete on public.area_permissions to authenticated;
grant select on public.permission_templates to authenticated;
grant select, insert, update, delete on public.permission_templates to authenticated;
grant select, insert, update, delete on public.tickets to anon, authenticated;
grant select, insert on public.ticket_messages to anon, authenticated;
grant select on public.saved_replies to authenticated;
grant select, insert, update, delete on public.saved_replies to authenticated;
grant insert on public.error_logs to anon, authenticated;
grant select on public.error_logs to authenticated;

commit;

-- =============================================================================
-- PRIMER SUPER_ADMIN — ejecutar UNA VEZ en el SQL Editor (como postgres),
-- DESPUÉS de crear el usuario en Authentication → Users.
-- NO está el email de Ángel en el repo: sustituye EL_EMAIL_DEL_SUPER_ADMIN
-- por su email real de Auth. Sin este paso no hay super_admin y el panel no
-- tiene a quién dejar entrar. Esta es la única vía del primer otorgamiento:
-- grant_super_admin() exige que quien llama ya sea super_admin.
-- =============================================================================
-- insert into public.profiles (id, email, nombre, role, estado)
-- select id, email, '', 'super_admin', 'activo'
-- from auth.users where lower(email) = lower('EL_EMAIL_DEL_SUPER_ADMIN')
-- on conflict (id) do update set role = 'super_admin', estado = 'activo', updated_at = now();
--
-- Verificación inmediata (debe devolver 1 fila):
-- select id, email, role, estado from public.profiles where role = 'super_admin';
