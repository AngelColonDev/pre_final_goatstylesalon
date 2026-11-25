-- =============================================================================
-- Goat Style Salon / GOAT Style Salon — esquema de Supabase
-- Pegar completo en Supabase → SQL Editor → Run (se puede volver a ejecutar sin romper).
-- Las columnas reflejan los datos que hoy guarda shared-data.js, y supabase-sync.js
-- traduce entre ambos formatos. Ver docs/supabase-setup.md para los pasos completos.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- Barberos y roles del personal
-- -----------------------------------------------------------------------------
create table if not exists public.barbers (
    id text primary key,
    name text not null,
    alias text default '',
    email text unique,
    phone text default '',
    specialty text[] default '{}',
    bio text default '',
    avatar_url text default '',
    is_admin boolean not null default false,
    active boolean not null default true,
    years_experience int not null default 0,
    vip_clients int not null default 0,
    schedule text default '',
    socials jsonb not null default '{}'::jsonb,
    certifications jsonb not null default '[]'::jsonb,
    before_after jsonb not null default '[]'::jsonb,
    gallery jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
);

-- Une una cuenta de Supabase Auth con un barbero. is_admin = acceso a todo.
create table if not exists public.staff_roles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    barber_id text references public.barbers(id) on delete set null,
    is_admin boolean not null default false
);

-- Funciones auxiliares para las políticas (security definer evita recursion en RLS).
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.staff_roles where user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.staff_roles where user_id = auth.uid() and is_admin);
$$;

create or replace function public.my_barber_id() returns text
language sql stable security definer set search_path = public as $$
    select barber_id from public.staff_roles where user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Clientes: fichas que crea y maneja el personal. Los clientes no tienen cuenta ni
-- contraseña; reservan y dejan reseñas escribiendo su nombre completo.
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
    id text primary key,
    name text not null,
    email text default '',
    phone text default '',
    birth_date date,
    haircut text default '',
    beard text default '',
    preferred_barber text references public.barbers(id) on delete set null,
    photo_url text default '',
    consent jsonb,                -- { termsVersion, privacyVersion, acceptedAt, userAgent, source }
    marketing_consent jsonb,      -- { optIn, updatedAt }
    registered_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Catalogo
-- -----------------------------------------------------------------------------
create table if not exists public.services (
    id text primary key,
    name text not null,
    price text not null default '',
    duration text default '',
    description text default '',
    active boolean not null default true,
    requests int not null default 0
);

create table if not exists public.products (
    id text primary key,
    barber_id text not null references public.barbers(id) on delete cascade,  -- quien lo vende
    name text not null,
    description text default '',
    price text not null default '',
    stock int not null default 0,
    sold int not null default 0,
    image_url text default '',
    active boolean not null default true
);

create table if not exists public.gallery (
    id text primary key,
    title text default '',
    barber_id text references public.barbers(id) on delete cascade,
    image_url text not null
);

create table if not exists public.news (
    id text primary key,
    author_id text references public.barbers(id) on delete set null,
    author_name text default '',
    role text default '',
    title text not null,
    body text not null default '',
    image_url text default '',
    likes int not null default 0,
    comments int not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists public.providers (
    id text primary key,
    name text not null,
    category text default '',
    contact text default '',
    phone text default '',
    status text default 'Activo'
);

-- -----------------------------------------------------------------------------
-- Citas, reseñas y actividad
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
    code text primary key,
    client_id text references public.clients(id) on delete set null,
    client_name text not null default '',
    client_email text default '',
    service text not null,
    price text default '',
    barber_id text references public.barbers(id) on delete set null,
    status text not null default 'PENDIENTE' check (status in ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA')),
    date_time timestamptz,
    vip_details jsonb,
    policy_acceptance jsonb,      -- { versión, acceptedAt }
    canceled_by_client boolean not null default false,
    canceled_at timestamptz,
    cancellation_alert_seen_by text[] not null default '{}',
    created_at timestamptz not null default now()
);

alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check check (status in ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'COMPLETADA', 'NO_SHOW'));
alter table public.appointments add column if not exists duration int not null default 40 check (duration > 0 and duration <= 1440);
alter table public.appointments add column if not exists services text[] not null default '{}';
alter table public.appointments add column if not exists history jsonb not null default '[]';
alter table public.appointments add column if not exists client_phone text not null default '';
alter table public.appointments add column if not exists barber_name text not null default '';
alter table public.appointments add column if not exists source text not null default 'online';
alter table public.appointments add column if not exists notes text not null default '';
alter table public.appointments add column if not exists completed_at timestamptz;
alter table public.appointments add column if not exists no_show_at timestamptz;
alter table public.appointments add column if not exists canceled_by text not null default '';
alter table public.appointments add column if not exists cancel_reason text not null default '';
alter table public.appointments add column if not exists late_cancellation boolean not null default false;
alter table public.appointments add column if not exists reminder_sent_at timestamptz;
alter table public.appointments add column if not exists reminder_1h_sent_at timestamptz;
alter table public.appointments add column if not exists attendance text;
-- Foto de referencia opcional (JPEG reducido en el navegador) y opción "No sé cómo se llama el recorte".
alter table public.appointments add column if not exists reference_photo text not null default '' check (length(reference_photo) <= 400000);
alter table public.appointments add column if not exists unknown_cut boolean not null default false;
alter table public.appointments add column if not exists end_time timestamptz;
update public.appointments set end_time = date_time + make_interval(mins => duration) where end_time is null and date_time is not null;

create or replace function public.set_appointment_end() returns trigger
language plpgsql set search_path = public as $$
begin
    new.end_time := new.date_time + make_interval(mins => new.duration);
    return new;
end;
$$;
drop trigger if exists appointments_end_time on public.appointments;
create trigger appointments_end_time before insert or update on public.appointments for each row execute function public.set_appointment_end();
-- La restricción opera también entre dos reservas simultáneas de distintos teléfonos.
-- Si hay citas antiguas solapadas, la migración se detiene sin eliminar ninguna.
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap' and conrelid = 'public.appointments'::regclass) then
        alter table public.appointments add constraint appointments_no_overlap
        exclude using gist (barber_id with =, tstzrange(date_time, end_time, '[)') with &&)
        where (status in ('PENDIENTE', 'APROBADA') and date_time is not null);
    end if;
end $$;

-- Reservas en línea (sin cuenta): el servidor fija el estado y limpia los campos del personal.
-- La cita se une a una ficha de cliente solo si el nombre coincide con un único cliente.
create or replace function public.guard_online_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_auto boolean;
    v_count int;
    v_match text;
begin
    if public.is_staff() then
        return new;
    end if;
    new.client_name := left(regexp_replace(trim(coalesce(new.client_name, '')), '\s+', ' ', 'g'), 80);
    if length(new.client_name) < 2 then
        raise exception 'Escribe tu nombre completo.';
    end if;
    select coalesce((booking->>'autoConfirm')::boolean, true) into v_auto from public.shop_settings where id = 1;
    new.status := case when coalesce(v_auto, true) then 'APROBADA' else 'PENDIENTE' end;
    new.source := 'online';
    select count(*), min(id) into v_count, v_match from public.clients where lower(name) = lower(new.client_name);
    new.client_id := case when v_count = 1 then v_match else null end;
    new.client_email := '';
    new.client_phone := '';
    new.completed_at := null;
    new.no_show_at := null;
    new.canceled_by_client := false;
    new.canceled_at := null;
    new.canceled_by := '';
    new.cancel_reason := '';
    new.created_at := now();
    return new;
end;
$$;

drop trigger if exists appointments_online_guard on public.appointments;
create trigger appointments_online_guard
    before insert on public.appointments
    for each row execute function public.guard_online_appointment();

create table if not exists public.reviews (
    id text primary key,
    client_id text references public.clients(id) on delete set null,
    client_name text not null default 'Cliente',
    barber text not null default '',
    rating int not null default 5 check (rating between 1 and 5),
    text text not null default '',
    status text not null default 'PENDIENTE' check (status in ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
    created_at timestamptz not null default now()
);

-- Ampliación compatible: conserva las reseñas anteriores sin asumir autorización.
alter table public.reviews add column if not exists appointment_code text references public.appointments(code) on delete set null;
alter table public.reviews add column if not exists barber_id text references public.barbers(id) on delete set null;
alter table public.reviews add column if not exists service text not null default '';
alter table public.reviews add column if not exists service_date date;
alter table public.reviews add column if not exists client_photo text not null default '';
alter table public.reviews add column if not exists publish_consent boolean;
alter table public.reviews add column if not exists hidden_reason text not null default '';
alter table public.reviews add column if not exists hidden_by text not null default '';
alter table public.reviews add column if not exists hidden_at timestamptz;
alter table public.reviews add column if not exists published_at timestamptz;
alter table public.reviews drop constraint if exists reviews_status_check;
alter table public.reviews add constraint reviews_status_check check (status in ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'OCULTA'));
create unique index if not exists reviews_one_per_appointment on public.reviews(appointment_code) where appointment_code is not null;

-- Reseñas sin cuenta: nombre completo, servicio, barbero, estrellas y opinión.
-- Entran como pendientes; el administrador las publica u oculta desde el panel.
create or replace function public.guard_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' then
        if not public.is_admin() then
            raise exception 'Solo el administrador puede moderar reseñas.';
        end if;
        if (to_jsonb(new) - array['status', 'hidden_reason', 'hidden_by', 'hidden_at'])
            is distinct from (to_jsonb(old) - array['status', 'hidden_reason', 'hidden_by', 'hidden_at']) then
            raise exception 'La moderación no puede cambiar la opinión del cliente.';
        end if;
        if new.status = 'OCULTA' then
            if length(trim(new.hidden_reason)) = 0 then
                raise exception 'Indica qué norma viola la reseña.';
            end if;
            new.hidden_by := auth.uid()::text;
            new.hidden_at := now();
        end if;
        new.published_at := old.published_at;
        if old.status <> 'APROBADA' and new.status = 'APROBADA' and new.published_at is null
            and (new.publish_consent is true or (new.publish_consent is null and new.appointment_code is null)) then
            new.published_at := now();
        end if;
        return new;
    end if;
    new.published_at := null;
    if public.is_staff() then
        if new.status = 'APROBADA' and (new.publish_consent is true or (new.publish_consent is null and new.appointment_code is null)) then
            new.published_at := now();
        end if;
        return new;
    end if;
    new.client_name := left(regexp_replace(trim(coalesce(new.client_name, '')), '\s+', ' ', 'g'), 80);
    if length(new.client_name) < 2 then
        raise exception 'Escribe tu nombre completo.';
    end if;
    if length(trim(coalesce(new.service, ''))) = 0 then
        raise exception 'Escoge el servicio que te hiciste.';
    end if;
    if not exists (select 1 from public.barbers where id = new.barber_id) then
        raise exception 'Escoge tu barbero.';
    end if;
    if length(trim(new.text)) > 600 then
        raise exception 'El comentario debe tener como máximo 600 caracteres.';
    end if;
    new.client_id := null;
    new.client_photo := coalesce(new.client_photo, '');
    if new.client_photo <> '' and (length(new.client_photo) > 24000
        or new.client_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$') then
        raise exception 'La foto de la reseña no es válida.';
    end if;
    new.appointment_code := null;
    new.service_date := null;
    if new.publish_consent is null then
        raise exception 'Indica si permites que publiquemos tu reseña en la página.';
    end if;
    new.status := 'PENDIENTE';
    new.created_at := now();
    new.hidden_reason := '';
    new.hidden_by := '';
    new.hidden_at := null;
    return new;
end;
$$;
drop trigger if exists reviews_guard on public.reviews;
create trigger reviews_guard before insert or update on public.reviews for each row execute function public.guard_review();

create table if not exists public.activity_log (
    id text primary key,
    type text default '',
    text text default '',
    created_at timestamptz not null default now()
);

create table if not exists public.barber_applications (
    id text primary key,
    data jsonb not null,
    created_at timestamptz not null default now()
);

-- Configuración global de la barbería (una sola fila, id = 1).
create table if not exists public.shop_settings (
    id int primary key default 1 check (id = 1),
    shop_mode text not null default 'online',
    closure_notice text default '',
    updated_at timestamptz not null default now()
);

-- Datos administrados por los formularios actuales. Las migraciones no pisan valores.
alter table public.shop_settings add column if not exists business jsonb not null default '{}';
alter table public.shop_settings add column if not exists booking jsonb not null default '{}';
alter table public.shop_settings add column if not exists service_categories text[] not null default '{}';
alter table public.barbers add column if not exists weekly_schedule jsonb;
alter table public.services add column if not exists minutes int not null default 40 check (minutes > 0 and minutes <= 600);
alter table public.services add column if not exists category text not null default 'Cortes';
alter table public.services add column if not exists image_url text not null default '';
alter table public.services add column if not exists barber_ids text[] not null default '{}';
alter table public.clients add column if not exists status text not null default 'Activo';
alter table public.clients add column if not exists address text not null default '';
alter table public.clients add column if not exists alt_phones jsonb not null default '[]';
alter table public.clients add column if not exists last_modified_at timestamptz;

-- Cambia exclusivamente el barbero asignado a la ficha y conserva las citas.
create or replace function public.transfer_client(
    p_client_id text, p_to_barber_id text, p_expected_barber_id text
) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_caller text := public.my_barber_id();
    v_admin boolean := public.is_admin();
    v_from text;
    v_modified timestamptz;
begin
    if not v_admin and v_caller is null then
        raise exception 'Solo el personal puede transferir clientes.';
    end if;

    select c.preferred_barber into v_from
    from public.clients c
    where c.id = p_client_id
      and (v_admin or c.preferred_barber = v_caller
           or (c.preferred_barber is null and exists (
               select 1 from public.appointments a
               where a.client_id = c.id and a.barber_id = v_caller
           )))
    for update;

    if not found or v_from is distinct from p_expected_barber_id then
        raise exception 'La asignación del cliente cambió o no tienes acceso. Abre su ficha de nuevo.';
    end if;
    if p_to_barber_id is not distinct from v_from or not exists (
        select 1 from public.barbers b where b.id = p_to_barber_id and b.active
    ) then
        raise exception 'Escoge otro barbero disponible.';
    end if;

    update public.clients set preferred_barber = p_to_barber_id, last_modified_at = now()
    where id = p_client_id returning last_modified_at into v_modified;
    return v_modified;
end;
$$;

revoke execute on function public.transfer_client(text, text, text) from public, anon;
grant execute on function public.transfer_client(text, text, text) to authenticated;

-- Transferir una cita a otro barbero y eliminar citas (RPCs, SECURITY DEFINER).
-- Ver supabase/migrations/20261124190000_transferir_eliminar_cita.sql.
create or replace function public.transfer_appointment(
    p_code text, p_to_barber_id text, p_by text default 'Personal'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_caller text := public.my_barber_id();
    v_admin boolean := public.is_admin();
    v_row public.appointments;
    v_from_label text;
    v_to_label text;
begin
    if not v_admin and v_caller is null then
        raise exception 'Solo el personal puede transferir citas.';
    end if;

    select * into v_row
    from public.appointments a
    where a.code = upper(trim(p_code))
      and (v_admin or a.barber_id = v_caller)
    for update;

    if not found then
        raise exception 'No encontramos esa cita o no es tuya.';
    end if;
    if v_row.status not in ('PENDIENTE', 'APROBADA') then
        raise exception 'Solo se puede transferir una cita pendiente o confirmada.';
    end if;
    if not exists (
        select 1 from public.barbers b where b.id = p_to_barber_id and b.active
    ) then
        raise exception 'Escoge otro barbero disponible.';
    end if;
    if v_row.barber_id is not distinct from p_to_barber_id then
        return to_jsonb(v_row);
    end if;

    select case when b.alias <> '' and b.alias is distinct from b.name
        then b.name || ' (' || b.alias || ')' else b.name end
    into v_from_label from public.barbers b where b.id = v_row.barber_id;
    select case when b.alias <> '' and b.alias is distinct from b.name
        then b.name || ' (' || b.alias || ')' else b.name end
    into v_to_label from public.barbers b where b.id = p_to_barber_id;

    update public.appointments set
        barber_id = p_to_barber_id,
        barber_name = v_to_label,
        history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'at', now(), 'action', 'Transferida', 'by', p_by,
            'detail', 'Antes: ' || coalesce(v_from_label, v_row.barber_id) || ' · Ahora: ' || v_to_label
        ))
    where code = v_row.code
    returning * into v_row;
    return to_jsonb(v_row);
end;
$$;
comment on function public.transfer_appointment(text, text, text) is 'Transfiere una cita a otro barbero (misma fecha y hora) y registra el cambio en su historial. SECURITY DEFINER porque appointments_staff_update no permite cambiar el barbero por sync directo.';
revoke all on function public.transfer_appointment(text, text, text) from public;
grant execute on function public.transfer_appointment(text, text, text) to authenticated;

create or replace function public.delete_appointment(p_code text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_caller text := public.my_barber_id();
    v_admin boolean := public.is_admin();
    v_found boolean;
begin
    if not v_admin and v_caller is null then
        raise exception 'Solo el personal puede eliminar citas.';
    end if;

    delete from public.notifications n
    using public.appointments a
    where n.appointment_code = a.code
      and a.code = upper(trim(p_code))
      and a.status not in ('PENDIENTE', 'APROBADA')
      and (v_admin or a.barber_id = v_caller);

    delete from public.appointments a
    where a.code = upper(trim(p_code))
      and a.status not in ('PENDIENTE', 'APROBADA')
      and (v_admin or a.barber_id = v_caller)
    returning true into v_found;

    if not found then
        raise exception 'No encontramos esa cita, no es tuya o todavía está activa (cancélala primero).';
    end if;
    return coalesce(v_found, true);
end;
$$;
comment on function public.delete_appointment(text) is 'Elimina una cita y sus avisos. Solo citas que ya no están activas; SECURITY DEFINER porque appointments_admin_delete solo permite borrar al admin.';
revoke all on function public.delete_appointment(text) from public;
grant execute on function public.delete_appointment(text) to authenticated;

-- Transferencia v2 (PR #17): solicitudes con aceptación. Ver
-- supabase/migrations/20261124210000_transfer_requests.sql (contenido íntegro).
create table if not exists public.transfer_requests (
    id text primary key,
    appointment_code text not null references public.appointments(code) on delete cascade,
    from_barber_id text not null references public.barbers(id) on delete cascade,
    to_barber_id text not null references public.barbers(id) on delete cascade,
    status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
    requested_by text not null default '',
    reason text not null default '',
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    decided_by text not null default ''
);
create index if not exists transfer_requests_appointment_idx on public.transfer_requests(appointment_code);
create index if not exists transfer_requests_to_idx on public.transfer_requests(to_barber_id, status);
create index if not exists transfer_requests_from_idx on public.transfer_requests(from_barber_id, status);
create unique index if not exists transfer_requests_one_pending_per_appointment
    on public.transfer_requests(appointment_code) where status = 'pendiente';

create or replace function public.transfer_barber_label(p_barber_id text) returns text
language sql stable security definer set search_path = public as $$
    select case when b.alias <> '' and b.alias is distinct from b.name
        then b.name || ' (' || b.alias || ')' else b.name end
    from public.barbers b where b.id = p_barber_id;
$$;

create or replace function public.request_transfer(
    p_code text, p_to_barber_id text, p_reason text default ''
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_caller text := public.my_barber_id();
    v_admin boolean := public.is_admin();
    v_row public.appointments;
    v_req public.transfer_requests;
    v_from_label text;
    v_to_label text;
    v_notice_id text;
    v_notice_ids text[] := '{}';
begin
    if not v_admin and v_caller is null then
        raise exception 'Solo el personal puede pedir una transferencia.';
    end if;
    select * into v_row
    from public.appointments a
    where a.code = upper(trim(p_code))
      and (v_admin or a.barber_id = v_caller)
    for update;
    if not found then
        raise exception 'No encontramos esa cita o no es tuya.';
    end if;
    if v_row.status not in ('PENDIENTE', 'APROBADA') then
        raise exception 'Solo se puede transferir una cita pendiente o confirmada.';
    end if;
    if v_row.barber_id is not distinct from p_to_barber_id then
        raise exception 'Esa cita ya es de ese barbero.';
    end if;
    if not exists (
        select 1 from public.barbers b where b.id = p_to_barber_id and b.active
    ) then
        raise exception 'Escoge otro barbero disponible.';
    end if;
    if exists (
        select 1 from public.transfer_requests r
        where r.appointment_code = v_row.code and r.status = 'pendiente'
    ) then
        raise exception 'Ya hay una solicitud de transferencia pendiente para esta cita.';
    end if;
    if exists (
        select 1 from public.appointments a2
        where a2.barber_id = p_to_barber_id
          and a2.code <> v_row.code
          and a2.status in ('PENDIENTE', 'APROBADA')
          and a2.date_time is not null and v_row.date_time is not null
          and tstzrange(a2.date_time, coalesce(a2.end_time, a2.date_time + make_interval(mins => coalesce(a2.duration, 40))), '[)')
              && tstzrange(v_row.date_time, coalesce(v_row.end_time, v_row.date_time + make_interval(mins => coalesce(v_row.duration, 40))), '[)')
    ) then
        raise exception 'Ese barbero ya tiene una cita a esa hora.';
    end if;
    v_from_label := coalesce(public.transfer_barber_label(v_row.barber_id), v_row.barber_id);
    v_to_label := coalesce(public.transfer_barber_label(p_to_barber_id), p_to_barber_id);
    begin
        insert into public.transfer_requests (id, appointment_code, from_barber_id, to_barber_id, status, requested_by, reason)
        values ('trf-' || gen_random_uuid()::text, v_row.code, v_row.barber_id, p_to_barber_id, 'pendiente', coalesce(v_caller, ''), left(coalesce(p_reason, ''), 300))
        returning * into v_req;
    exception when unique_violation then
        raise exception 'Ya hay una solicitud de transferencia pendiente para esta cita.';
    end;
    v_notice_id := 'ntf-' || gen_random_uuid()::text;
    insert into public.notifications (id, audience, barber_id, client_id, type, title, body, appointment_code)
    values (v_notice_id, 'staff', p_to_barber_id, null, 'transferencia-solicitud',
        'Solicitud de transferencia',
        v_row.client_name || ': ' || v_row.service || ' · ' || to_char(v_row.date_time, 'DD/MM/YYYY HH24:MI')
            || ' — te la quiere pasar ' || v_from_label || '. Acéptala o recházala en Transferencias.'
            || case when length(trim(coalesce(p_reason, ''))) > 0 then ' Motivo: ' || left(trim(p_reason), 200) else '' end,
        v_row.code);
    v_notice_ids := array_append(v_notice_ids, v_notice_id);
    return jsonb_build_object(
        'request', to_jsonb(v_req),
        'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
                          from public.notifications n where n.id = any (v_notice_ids))
    );
end;
$$;
comment on function public.request_transfer(text, text, text) is 'Crea una solicitud de transferencia (v2): la cita queda con el barbero original hasta que el receptor la acepte. SECURITY DEFINER porque solo el personal escribe en transfer_requests (sin políticas de escritura) y porque crea el aviso al receptor. Devuelve la solicitud y sus avisos para reflejarlos en local sin duplicarlos por sync.';
revoke all on function public.request_transfer(text, text, text) from public;
grant execute on function public.request_transfer(text, text, text) to authenticated;

create or replace function public.respond_transfer(
    p_request_id text, p_accept boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_caller text := public.my_barber_id();
    v_admin boolean := public.is_admin();
    v_req public.transfer_requests;
    v_row public.appointments;
    v_from_label text;
    v_to_label text;
    v_notice_ids text[] := '{}';
    v_id text;
    v_date text;
begin
    if not v_admin and v_caller is null then
        raise exception 'Solo el personal puede responder una transferencia.';
    end if;
    select * into v_req
    from public.transfer_requests r
    where r.id = p_request_id
      and (v_admin or r.to_barber_id = v_caller)
    for update;
    if not found then
        raise exception 'No encontramos esa solicitud o no es para ti.';
    end if;
    if v_req.status <> 'pendiente' then
        raise exception 'Esa solicitud ya fue respondida.';
    end if;
    select * into v_row
    from public.appointments a
    where a.code = v_req.appointment_code
    for update;
    if not found then
        raise exception 'No encontramos esa cita.';
    end if;
    v_from_label := coalesce(public.transfer_barber_label(v_req.from_barber_id), v_req.from_barber_id);
    v_to_label := coalesce(public.transfer_barber_label(v_req.to_barber_id), v_req.to_barber_id);
    v_date := to_char(v_row.date_time, 'DD/MM/YYYY HH24:MI');
    if v_row.status not in ('PENDIENTE', 'APROBADA') then
        update public.transfer_requests set status = 'rechazada', decided_at = now(), decided_by = 'Sistema'
        where id = v_req.id returning * into v_req;
        v_id := 'ntf-' || gen_random_uuid()::text;
        insert into public.notifications (id, audience, barber_id, client_id, type, title, body, appointment_code)
        values (v_id, 'staff', v_req.from_barber_id, null, 'transferencia-rechazada',
            'Transferencia cancelada',
            'La transferencia de tu cita ' || v_row.code || ' (' || v_row.client_name || ', ' || v_row.service || ' ' || v_date
                || ') no se hizo porque la cita ya no está activa. Sigue en tu lista como estaba.',
            v_row.code);
        v_notice_ids := array_append(v_notice_ids, v_id);
        v_id := 'ntf-' || gen_random_uuid()::text;
        insert into public.notifications (id, audience, barber_id, client_id, type, title, body, appointment_code)
        values (v_id, 'client', null, v_row.client_id, 'transferencia',
            'Tu cita sigue con el mismo barbero',
            'La transferencia de tu cita ' || v_row.service || ' · ' || v_date || ' no se hizo. Sigue con ' || v_from_label || ' a la misma fecha y hora.',
            v_row.code);
        v_notice_ids := array_append(v_notice_ids, v_id);
        return jsonb_build_object(
            'request', to_jsonb(v_req),
            'appointment', to_jsonb(v_row),
            'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
                              from public.notifications n where n.id = any (v_notice_ids))
        );
    end if;
    if p_accept then
        if exists (
            select 1 from public.appointments a2
            where a2.barber_id = v_req.to_barber_id
              and a2.code <> v_row.code
              and a2.status in ('PENDIENTE', 'APROBADA')
              and a2.date_time is not null and v_row.date_time is not null
              and tstzrange(a2.date_time, coalesce(a2.end_time, a2.date_time + make_interval(mins => coalesce(a2.duration, 40))), '[)')
                  && tstzrange(v_row.date_time, coalesce(v_row.end_time, v_row.date_time + make_interval(mins => coalesce(v_row.duration, 40))), '[)')
        ) then
            raise exception 'Ese barbero ya tiene una cita a esa hora.';
        end if;
        update public.appointments set
            barber_id = v_req.to_barber_id,
            barber_name = v_to_label,
            history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'at', now(), 'action', 'Transferida', 'by', coalesce(v_caller, 'Personal'),
                'detail', 'Antes: ' || v_from_label || ' · Ahora: ' || v_to_label || ' (solicitud aceptada)'
            ))
        where code = v_row.code
        returning * into v_row;
        update public.transfer_requests set status = 'aceptada', decided_at = now(), decided_by = coalesce(v_caller, '')
        where id = v_req.id returning * into v_req;
        v_id := 'ntf-' || gen_random_uuid()::text;
        insert into public.notifications (id, audience, barber_id, client_id, type, title, body, appointment_code)
        values (v_id, 'staff', v_req.from_barber_id, null, 'transferencia-aceptada',
            'Transferencia aceptada',
            v_to_label || ' aceptó tu cita ' || v_row.code || ' (' || v_row.client_name || ', ' || v_row.service || ' ' || v_date || '). Ya está en su lista.',
            v_row.code);
        v_notice_ids := array_append(v_notice_ids, v_id);
        v_id := 'ntf-' || gen_random_uuid()::text;
        insert into public.notifications (id, audience, barber_id, client_id, type, title, body, appointment_code)
        values (v_id, 'client', null, v_row.client_id, 'transferencia',
            'Tu cita cambió de barbero',
            'Tu cita ' || v_row.service || ' · ' || v_date || ' ahora es con ' || v_to_label || '. La fecha y la hora no cambian.',
            v_row.code);
        v_notice_ids := array_append(v_notice_ids, v_id);
    else
        update public.transfer_requests set status = 'rechazada', decided_at = now(), decided_by = coalesce(v_caller, '')
        where id = v_req.id returning * into v_req;
        v_id := 'ntf-' || gen_random_uuid()::text;
        insert into public.notifications (id, audience, barber_id, client_id, type, title, body, appointment_code)
        values (v_id, 'staff', v_req.from_barber_id, null, 'transferencia-rechazada',
            'Transferencia rechazada',
            v_to_label || ' rechazó recibir tu cita ' || v_row.code || ' (' || v_row.client_name || ', ' || v_row.service || ' ' || v_date || '). Sigue contigo a la misma hora.',
            v_row.code);
        v_notice_ids := array_append(v_notice_ids, v_id);
        v_id := 'ntf-' || gen_random_uuid()::text;
        insert into public.notifications (id, audience, barber_id, client_id, type, title, body, appointment_code)
        values (v_id, 'client', null, v_row.client_id, 'transferencia',
            'Tu cita sigue con el mismo barbero',
            'La transferencia de tu cita ' || v_row.service || ' · ' || v_date || ' no se hizo. Sigue con ' || v_from_label || ' a la misma fecha y hora.',
            v_row.code);
        v_notice_ids := array_append(v_notice_ids, v_id);
    end if;
    return jsonb_build_object(
        'request', to_jsonb(v_req),
        'appointment', to_jsonb(v_row),
        'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
                          from public.notifications n where n.id = any (v_notice_ids))
    );
end;
$$;
comment on function public.respond_transfer(text, boolean) is 'Acepta o rechaza una solicitud de transferencia (v2). Solo al aceptar cambia la cita de barbero. SECURITY DEFINER porque solo el personal escribe en transfer_requests y porque crea los avisos al barbero original y al cliente. Si la cita ya no está activa, cierra la solicitud como rechazada por el sistema.';
revoke all on function public.respond_transfer(text, boolean) from public;
grant execute on function public.respond_transfer(text, boolean) to authenticated;


-- -----------------------------------------------------------------------------
-- Ficha CRM (memos, pagos, descuentos). El contenido va en jsonb con la misma forma que crm/src/types.ts.
-- -----------------------------------------------------------------------------
create table if not exists public.memos (
    id text primary key,
    client_id text references public.clients(id) on delete cascade,
    data jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists public.payments (
    id text primary key,
    client_id text references public.clients(id) on delete set null,
    data jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists public.discounts (
    id text primary key,
    client_id text references public.clients(id) on delete set null,
    data jsonb not null,
    created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Avisos del centro de notificaciones y suscripciones push (Firebase).
-- Los clientes no tienen cuenta: leen sus avisos por código de cita con
-- my_notifications(), igual que consultan su cita con appointment_status().
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
    id text primary key,
    audience text not null default 'client' check (audience in ('client', 'staff')),
    barber_id text references public.barbers(id) on delete set null,
    client_id text references public.clients(id) on delete set null,
    type text not null default '',
    title text not null default '',
    body text not null default '',
    appointment_code text references public.appointments(code) on delete set null,
    read_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists notifications_appointment_idx on public.notifications(appointment_code);
create index if not exists notifications_created_idx on public.notifications(created_at desc);

-- Suscripción push de un dispositivo. endpoint guarda el token FCM (el envío lo
-- hace la Edge Function supabase/functions/send-push con la clave de servicio);
-- keys_p256dh/keys_auth quedan reservadas para Web Push directo.
-- appointment_codes: códigos de cita de ese navegador (el servidor solo le manda
-- sus avisos); barber_id: el barbero, cuando el personal activa el push.
create table if not exists public.push_tokens (
    id text primary key,
    endpoint text not null default '',
    keys_p256dh text not null default '',
    keys_auth text not null default '',
    appointment_codes text[] not null default '{}',
    barber_id text references public.barbers(id) on delete set null,
    user_agent text not null default '',
    created_at timestamptz not null default now()
);

-- =============================================================================
-- Row Level Security: nadie puede leer ni escribir nada que no le corresponda.
-- =============================================================================
alter table public.barbers enable row level security;
alter table public.staff_roles enable row level security;
alter table public.clients enable row level security;
alter table public.services enable row level security;
alter table public.products enable row level security;
alter table public.gallery enable row level security;
alter table public.news enable row level security;
alter table public.providers enable row level security;
alter table public.appointments enable row level security;
alter table public.reviews enable row level security;
alter table public.activity_log enable row level security;
alter table public.barber_applications enable row level security;
alter table public.shop_settings enable row level security;
alter table public.memos enable row level security;
alter table public.payments enable row level security;
alter table public.discounts enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;

-- Borra políticas anteriores para poder re-ejecutar este archivo.
do $$
declare pol record;
begin
    for pol in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
        execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    end loop;
end $$;

-- Barberos: publicos para leer; el admin los administra y cada barbero edita su propio perfil.
create policy barbers_read on public.barbers for select using (true);
create policy barbers_admin_write on public.barbers for all using (public.is_admin()) with check (public.is_admin());
create policy barbers_self_update on public.barbers for update using (id = public.my_barber_id()) with check (id = public.my_barber_id());

create policy staff_roles_read on public.staff_roles for select using (user_id = auth.uid() or public.is_admin());
create policy staff_roles_admin on public.staff_roles for all using (public.is_admin()) with check (public.is_admin());

-- Fichas de clientes: solo el personal. El admin ve todas; el barbero ve sus clientes.
create policy clients_staff_read on public.clients for select using (
    public.is_admin()
    or preferred_barber = public.my_barber_id()
    or exists (select 1 from public.appointments a where a.client_id = clients.id and a.barber_id = public.my_barber_id())
);
create policy clients_staff_insert on public.clients for insert with check (public.is_staff());
create policy clients_staff_update on public.clients for update using (public.is_staff()) with check (public.is_staff());
create policy clients_admin_delete on public.clients for delete using (public.is_admin());

-- Catalogo público.
create policy services_read on public.services for select using (true);
create policy services_staff_write on public.services for all using (public.is_staff()) with check (public.is_staff());

create policy products_read on public.products for select using (true);
create policy products_owner_write on public.products for all
    using (public.is_admin() or barber_id = public.my_barber_id())
    with check (public.is_admin() or barber_id = public.my_barber_id());

create policy gallery_read on public.gallery for select using (true);
create policy gallery_owner_write on public.gallery for all
    using (public.is_admin() or barber_id = public.my_barber_id())
    with check (public.is_admin() or barber_id = public.my_barber_id());

create policy news_read on public.news for select using (true);
create policy news_author_write on public.news for all
    using (public.is_admin() or author_id = public.my_barber_id())
    with check (public.is_admin() or author_id = public.my_barber_id());

create policy providers_staff on public.providers for all using (public.is_staff()) with check (public.is_staff());

-- Citas: cualquier visitante puede reservar (el trigger appointments_online_guard fija estado y datos);
-- solo el personal las ve y gestiona: el barbero las suyas, el admin todas.
-- El visitante consulta el estado con su código mediante appointment_status().
create policy appointments_staff_read on public.appointments for select using (public.is_admin() or barber_id = public.my_barber_id());
create policy appointments_online_insert on public.appointments for insert
    with check (source = 'online' and status in ('PENDIENTE', 'APROBADA'));
create policy appointments_staff_insert on public.appointments for insert
    with check (public.is_admin() or barber_id = public.my_barber_id());
create policy appointments_staff_update on public.appointments for update
    using (public.is_admin() or barber_id = public.my_barber_id())
    with check (public.is_admin() or barber_id = public.my_barber_id());
create policy appointments_admin_delete on public.appointments for delete using (public.is_admin());

-- Reseñas: públicas solo si están aprobadas; cualquier visitante las envía como pendientes.
create policy reviews_public_read on public.reviews for select using (
    (status = 'APROBADA' and publish_consent is true)
    or public.is_admin() or barber_id = public.my_barber_id()
);
create policy reviews_public_insert on public.reviews for insert with check (status = 'PENDIENTE' or public.is_staff());
create policy reviews_admin_moderate on public.reviews for update using (public.is_admin()) with check (public.is_admin());

-- Las reservas y reseñas de visitantes también dejan una línea en la actividad (solo el personal la lee).
create policy activity_insert on public.activity_log for insert with check (true);
create policy activity_staff_read on public.activity_log for select using (public.is_staff());

create policy applications_insert on public.barber_applications for insert with check (true);
create policy applications_admin_read on public.barber_applications for select using (public.is_admin());

create policy settings_read on public.shop_settings for select using (true);
create policy settings_admin_write on public.shop_settings for all using (public.is_admin()) with check (public.is_admin());

create policy memos_staff on public.memos for all using (public.is_staff()) with check (public.is_staff());
create policy payments_staff on public.payments for all using (public.is_staff()) with check (public.is_staff());
create policy discounts_staff on public.discounts for all using (public.is_staff()) with check (public.is_staff());

-- Avisos: el personal los ve todos; el visitante solo inserta avisos de cliente
-- (los lee por código con my_notifications()) y solo puede marcarlos como leídos.
create policy notifications_staff_read on public.notifications for select using (
    public.is_admin()
    or barber_id = public.my_barber_id()
    or (barber_id is null and public.is_staff())
);
create policy notifications_client_insert on public.notifications for insert
    with check (audience = 'client' and appointment_code is not null);
create policy notifications_staff_insert on public.notifications for insert with check (public.is_staff());
create policy notifications_client_update on public.notifications for update
    using (audience = 'client') with check (audience = 'client');
create policy notifications_staff_update on public.notifications for update using (public.is_staff()) with check (public.is_staff());
create policy notifications_staff_delete on public.notifications for delete using (public.is_staff());


-- Solicitudes de transferencia: solo lectura con ámbito. El admin las ve
-- todas (igual que appointments_staff_read); cada barbero solo las que lo
-- tienen como origen o destino. Sin políticas de escritura: solo las RPCs.
alter table public.transfer_requests enable row level security;
drop policy if exists transfer_requests_staff_read on public.transfer_requests;
create policy transfer_requests_staff_read on public.transfer_requests for select using (
    public.is_admin()
    or from_barber_id = public.my_barber_id()
    or to_barber_id = public.my_barber_id()
);


-- Suscripciones push: cada dispositivo registra la suya; solo el personal las lee y limpia.
create policy push_tokens_anon_insert on public.push_tokens for insert with check (true);
create policy push_tokens_anon_update on public.push_tokens for update using (true) with check (true);
create policy push_tokens_staff_read on public.push_tokens for select using (public.is_staff());
create policy push_tokens_staff_delete on public.push_tokens for delete using (public.is_staff());

-- =============================================================================
-- Datos iniciales (on conflict do nothing: no pisa cambios hechos después)
-- =============================================================================
insert into public.barbers (id, name, alias, email, phone, specialty, bio, avatar_url, is_admin, active, years_experience, vip_clients, schedule, socials, certifications, gallery) values
('gabriel', 'Gabriel Andres Ortiz', 'Gaby', 'gaby@goatstylesalon.com', '787-218-1068', '{"Fade Premium","Diseño","Celebridades"}', 'Administrador general y fundador de la barbería.',
 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783942400/320ed6b8-6ea7-4309-9f6a-e6ecf33bb939_sop8ao.jpg', true, true, 14, 500, 'Martes a jueves 8:00 AM – 6:00 PM · Viernes 8:00 AM – 8:00 PM · Sábado 7:00 AM – 5:00 PM',
 '{"instagram":"https://www.instagram.com/gabystylee_","facebook":"https://www.facebook.com/share/1F6o7gHn9A/"}',
 '[{"id":"cert-gabriel-1","name":"Barbero"},{"id":"cert-gabriel-2","name":"Estilista"},{"id":"cert-gabriel-3","name":"Colorimetría"}]', '[]'),
('darialex', 'Darialex Rivera Aponte', 'Tazmania', 'darialex@goatstylesalon.com', '787-228-5878', '{"Corte para caballeros","Colorimetría","Barbas largas"}', 'Barbero y cosmetólogo especialista en cortes para caballeros, colorimetría y barbas largas.',
 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1783942759/449dcd8d-1026-4eef-b360-20464ed96cd6_l5ccyi.jpg', false, true, 8, 450, 'Martes a jueves 8:00 AM – 6:00 PM · Viernes 8:00 AM – 8:00 PM · Sábado 7:00 AM – 5:00 PM',
 '{"instagram":"https://www.instagram.com/darialexthebarber"}',
 '[{"id":"cert-darialex-1","name":"Barbero"},{"id":"cert-darialex-2","name":"Cosmetólogo"}]', '[]'),
('wilo', 'Wilo', '', 'wilo@goatstylesalon.com', '939-324-2271', '{}', '',
 'https://res.cloudinary.com/dtw3qx4qq/image/upload/v1785203892/ddd23b62-7c16-46d3-bffd-fe2750215649_najb0v.jpg', false, true, 0, 280, 'Martes a jueves 8:00 AM – 6:00 PM · Viernes 8:00 AM – 8:00 PM · Sábado 7:00 AM – 5:00 PM',
 '{"instagram":"https://www.instagram.com/wilostudio6"}', '[]', '[]')
on conflict (id) do nothing;

insert into public.services (id, name, price, duration, description) values
('service-1', 'Classic Cut', '$35', 'Incluye bebida y lavado', 'Todo corte incluye una bebida de preferencia y lavado de cabello.'),
('service-2', 'Premium Fade', '$40', 'Corte premium', 'Premium Fade con acabado limpio y profesional.'),
('service-3', 'Signature Cut', '$45', 'Traditional Hot Towel Shave', 'Signature Cut con Traditional Hot Towel Shave.'),
('service-4', 'Kids Premium', '$35', 'Hasta 12 años', 'Kids Premium para niños de hasta 12 años.'),
('service-5', 'Baby Cut', 'Consultar', 'Consulta previa', 'Baby Cut sujeto a consulta previa.'),
('service-6', 'Hair Light', '$65', 'Color', 'Hair Light para un look más definido y moderno.'),
('service-7', 'Platinado', '$120', 'No incluye corte', 'Platinado completo. No incluye corte.'),
('service-8', 'Hidratación Capilar', 'Desde $30', 'Tratamiento', 'Tratamiento de hidratación capilar.'),
('service-9', 'Keratina', 'Desde $45', 'Tratamiento', 'Keratina para mejorar la textura y controlar el frizz.'),
('service-10', 'Limpieza Facial Profunda', '$50', 'Facial', 'Limpieza facial profunda.'),
('service-11', 'GOAT VIP Experience', '$100', 'Experiencia completa', 'Incluye Signature Cut, diseño de barba, lavado, toallas calientes, masaje capilar, limpieza facial express, bebida de cortesía y productos premium para finalizar.')
on conflict (id) do nothing;

insert into public.products (id, barber_id, name, description, price, stock, sold, image_url) values
('prod-1', 'gabriel', 'Pomada Premium Mate', 'Fijación fuerte, acabado mate.', '$20', 15, 48, 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80'),
('prod-2', 'gabriel', 'Aceite para Barba Dorado', 'Hidrata y suaviza la barba.', '$25', 8, 35, 'https://images.unsplash.com/photo-1626202373052-2bbb4f5b9d62?auto=format&fit=crop&w=600&q=80'),
('prod-3', 'gabriel', 'Shampoo Artefacto', 'Limpieza profunda sin sulfatos.', '$18', 20, 28, 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=600&q=80'),
('prod-4', 'gabriel', 'Cera Modeladora Classic', 'Para peinados clásicos con brillo.', '$22', 12, 22, 'https://images.unsplash.com/photo-1631730486572-226d1f595b68?auto=format&fit=crop&w=600&q=80')
on conflict (id) do nothing;

insert into public.news (id, author_id, author_name, role, title, body, created_at) values
('news-apertura-2026', 'gabriel', 'Gabriel (Gaby)', 'Admin General', 'Apertura de la nueva barbería',
 'El sábado 7 de noviembre de 2026 abrimos las puertas de nuestra nueva barbería. Te esperamos para celebrar juntos. Ya puedes reservar tu cita desde la página.',
 '2026-10-20T12:00:00Z')
on conflict (id) do nothing;

-- Primera reseña del sitio (aprobada). El guardián de reseñas se pausa solo para esta carga inicial,
-- porque desde el SQL Editor no hay sesión del personal.
alter table public.reviews disable trigger reviews_guard;
insert into public.reviews (id, client_name, barber, rating, text, status, publish_consent, service, created_at, published_at) values
('review-angel-primera', 'Ángel A. Colón Negrón', '', 5, 'Excelente servicio!!!!', 'APROBADA', true, '', '2026-11-18T12:00:00Z', '2026-11-18T12:00:00Z')
on conflict (id) do nothing;
alter table public.reviews enable trigger reviews_guard;

insert into public.shop_settings (id) values (1) on conflict (id) do nothing;

-- =============================================================================
-- Cuentas del personal: primero crea los 3 usuarios en Authentication → Users
-- (gaby@, darialex@, wilo@goatstylesalon.com) y luego ejecuta este bloque.
-- =============================================================================
insert into public.staff_roles (user_id, barber_id, is_admin)
select id, 'gabriel', true from auth.users where email = 'gaby@goatstylesalon.com'
on conflict (user_id) do update set barber_id = excluded.barber_id, is_admin = excluded.is_admin;
insert into public.staff_roles (user_id, barber_id, is_admin)
select id, 'darialex', false from auth.users where email = 'darialex@goatstylesalon.com'
on conflict (user_id) do update set barber_id = excluded.barber_id, is_admin = excluded.is_admin;
insert into public.staff_roles (user_id, barber_id, is_admin)
select id, 'wilo', false from auth.users where email = 'wilo@goatstylesalon.com'
on conflict (user_id) do update set barber_id = excluded.barber_id, is_admin = excluded.is_admin;

-- =============================================================================
-- SEGURIDAD Y PANEL TECNICO (agregado despues; se puede ejecutar sobre lo anterior)
-- =============================================================================

-- Rol de desarrollador (Angel) y cambio obligatorio de contrasena del personal.
alter table public.staff_roles add column if not exists is_developer boolean not null default false;
alter table public.staff_roles add column if not exists must_change_password boolean not null default false;

create or replace function public.is_developer() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.staff_roles where user_id = auth.uid() and is_developer);
$$;

-- Configuracion global del sitio (modo mantenimiento). Todos la leen; solo el desarrollador la cambia.
create table if not exists public.site_config (
    id int primary key default 1 check (id = 1),
    maintenance jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);
alter table public.site_config enable row level security;
drop policy if exists site_config_read on public.site_config;
drop policy if exists site_config_dev_write on public.site_config;
create policy site_config_read on public.site_config for select using (true);
create policy site_config_dev_write on public.site_config for all using (public.is_developer()) with check (public.is_developer());
insert into public.site_config (id) values (1) on conflict (id) do nothing;

-- Intentos fallidos y bloqueos de las cuentas del personal. Solo el desarrollador los lee
-- directamente; el sitio usa las funciones de abajo.
create table if not exists public.login_attempts (
    email text primary key,
    count int not null default 0,
    account_type text default 'staff',
    last_at timestamptz not null default now()
);

create table if not exists public.account_locks (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    account_type text not null default 'staff',
    user_id uuid,
    attempts int not null default 3,
    user_agent text default '',
    status text not null default 'BLOQUEADA' check (status in ('BLOQUEADA', 'MANTENER_BLOQUEADA', 'DESBLOQUEADA')),
    locked_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolved_by uuid
);

alter table public.login_attempts enable row level security;
alter table public.account_locks enable row level security;
drop policy if exists login_attempts_dev on public.login_attempts;
drop policy if exists account_locks_dev on public.account_locks;
create policy login_attempts_dev on public.login_attempts for all using (public.is_developer()) with check (public.is_developer());
create policy account_locks_dev on public.account_locks for all using (public.is_developer()) with check (public.is_developer());

-- Esta bloqueada esta cuenta? (se consulta antes de iniciar sesion)
create or replace function public.login_guard(p_email text) returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object('locked', exists (
        select 1 from public.account_locks where lower(email) = lower(trim(p_email)) and status <> 'DESBLOQUEADA'
    ));
$$;

-- Registra un intento fallido; al tercero bloquea la cuenta (si existe).
-- Responde igual exista o no la cuenta, para no revelar que correos estan registrados.
create or replace function public.register_failed_login(p_email text, p_user_agent text default '') returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
    v_email text := lower(trim(p_email));
    v_count int;
    v_user uuid;
begin
    insert into public.login_attempts (email, count, account_type, last_at)
    values (v_email, 1, 'staff', now())
    on conflict (email) do update set count = public.login_attempts.count + 1, last_at = now()
    returning count into v_count;

    if v_count >= 3 then
        select id into v_user from auth.users where lower(email) = v_email;
        if v_user is not null and not exists (
            select 1 from public.account_locks where lower(email) = v_email and status <> 'DESBLOQUEADA'
        ) then
            insert into public.account_locks (email, account_type, user_id, attempts, user_agent)
            values (v_email, 'staff', v_user, v_count, left(coalesce(p_user_agent, ''), 400));
        end if;
    end if;
    return jsonb_build_object('locked', v_count >= 3, 'attempts_left', greatest(0, 3 - v_count));
end;
$$;

create or replace function public.clear_login_attempts() returns void
language sql security definer set search_path = public as $$
    delete from public.login_attempts where email = lower(auth.email());
$$;

create or replace function public.must_change_password() returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((select must_change_password from public.staff_roles where user_id = auth.uid()), false);
$$;

create or replace function public.clear_must_change_password() returns void
language plpgsql security definer set search_path = public as $$
begin
    update public.staff_roles set must_change_password = false where user_id = auth.uid();
end;
$$;

-- Lista para el panel tecnico con los datos de contacto necesarios para verificar a la persona.
create or replace function public.locked_accounts() returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.is_developer() then
        raise exception 'Solo el desarrollador puede ver los bloqueos.';
    end if;
    return query
    select jsonb_build_object(
        'id', l.id, 'email', l.email, 'accountType', l.account_type, 'accountId', l.user_id, 'attempts', l.attempts,
        'userAgent', l.user_agent, 'status', l.status, 'lockedAt', l.locked_at, 'resolvedAt', l.resolved_at,
        'profile', jsonb_build_object('name', b.name, 'phone', b.phone, 'barberId', b.id)
    )
    from public.account_locks l
    left join public.staff_roles s on s.user_id = l.user_id
    left join public.barbers b on b.id = s.barber_id
    order by l.locked_at desc;
end;
$$;

create or replace function public.resolve_account_lock(p_lock_id uuid, p_unlock boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
    v_lock public.account_locks;
begin
    if not public.is_developer() then
        raise exception 'Solo el desarrollador puede desbloquear cuentas.';
    end if;
    update public.account_locks
        set status = case when p_unlock then 'DESBLOQUEADA' else 'MANTENER_BLOQUEADA' end,
            resolved_at = now(), resolved_by = auth.uid()
        where id = p_lock_id
        returning * into v_lock;
    if p_unlock and v_lock.id is not null then
        delete from public.login_attempts where email = lower(v_lock.email);
        -- Al desbloquear se exige una contrasena nueva.
        update public.staff_roles set must_change_password = true where user_id = v_lock.user_id;
    end if;
end;
$$;

revoke all on function public.login_guard(text) from public;
revoke all on function public.register_failed_login(text, text) from public;
grant execute on function public.login_guard(text) to anon, authenticated;
grant execute on function public.register_failed_login(text, text) to anon, authenticated;
grant execute on function public.clear_login_attempts() to authenticated;
grant execute on function public.must_change_password() to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
grant execute on function public.locked_accounts() to authenticated;
grant execute on function public.resolve_account_lock(uuid, boolean) to authenticated;
grant execute on function public.is_developer() to authenticated;

-- Ocupación pública limitada: nunca devuelve identidad ni código de las citas (solo el personal ve el código).
create or replace function public.booking_busy_slots()
returns table (barber_id text, date_time timestamptz, duration int, own_code text)
language sql stable security definer set search_path = public as $$
    select a.barber_id, a.date_time, a.duration,
        case when public.is_admin() or a.barber_id = public.my_barber_id() then a.code else null end
    from public.appointments a
    where a.status in ('PENDIENTE', 'APROBADA')
      and a.date_time >= now() - interval '1 day'
      and a.date_time <= now() + interval '366 days';
$$;
revoke all on function public.booking_busy_slots() from public;
grant execute on function public.booking_busy_slots() to anon, authenticated;

-- Consultar el estado de una cita con su código (sin cuenta). No devuelve nombre ni contacto.
drop function if exists public.appointment_status(text);
create or replace function public.appointment_status(p_code text)
returns table (code text, status text, service text, date_time timestamptz, barber_name text)
language sql stable security definer set search_path = public as $$
    select a.code, a.status, a.service, a.date_time, a.barber_name
    from public.appointments a
    where a.code = upper(trim(p_code))
    limit 1;
$$;
revoke all on function public.appointment_status(text) from public;
grant execute on function public.appointment_status(text) to anon, authenticated;

-- Sin sesión del personal, un aviso solo puede cambiar su contenido (título,
-- cuerpo, tipo, leído): los datos que lo identifican no se pueden tocar.
-- Excepción estricta: enlazar el aviso a la ficha de su cita cuando la RPC
-- register_client_for_appointment() registra al cliente de una reserva en
-- línea. El aviso solo toma la misma ficha que su cita ya tiene (la RPC
-- actualiza la cita antes que los avisos), así que no se puede desviar un
-- aviso a otra ficha: cualquier otro cambio de client_id sigue rechazado.
create or replace function public.guard_notification_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if public.is_staff() then
        return new;
    end if;
    -- Excepción estricta: enlazar el aviso a la ficha de su cita. El aviso
    -- solo toma la misma ficha que su cita ya tiene (la RPC actualiza la
    -- cita antes que los avisos), así que no se puede desviar un aviso a
    -- otra ficha: cualquier otro cambio de client_id sigue rechazado abajo.
    if old.client_id is null
        and new.client_id is not null
        and new.id is not distinct from old.id
        and new.audience is not distinct from old.audience
        and new.appointment_code is not distinct from old.appointment_code
        and new.barber_id is not distinct from old.barber_id
        and exists (
            select 1 from public.appointments a
            where a.code = new.appointment_code
              and a.client_id = new.client_id
        ) then
        return new;
    end if;
    if new.id is distinct from old.id
        or new.audience is distinct from old.audience
        or new.appointment_code is distinct from old.appointment_code
        or new.barber_id is distinct from old.barber_id
        or new.client_id is distinct from old.client_id then
        raise exception 'No puedes cambiar a quién pertenece este aviso.';
    end if;
    return new;
end;
$$;
drop trigger if exists notifications_update_guard on public.notifications;
create trigger notifications_update_guard before update on public.notifications for each row execute function public.guard_notification_update();

-- Avisos de un cliente por sus códigos de cita (sin cuenta). Solo devuelve avisos
-- de cliente de esos códigos; nunca avisos del personal ni de otros clientes.
create or replace function public.my_notifications(p_codes text[])
returns table (id text, audience text, barber_id text, client_id text, type text, title text, body text, appointment_code text, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
    select n.id, n.audience, n.barber_id, n.client_id, n.type, n.title, n.body, n.appointment_code, n.read_at, n.created_at
    from public.notifications n
    where n.audience = 'client'
      and n.appointment_code = any (p_codes)
    order by n.created_at desc
    limit 200;
$$;
revoke all on function public.my_notifications(text[]) from public;
grant execute on function public.my_notifications(text[]) to anon, authenticated;

-- Marcar avisos de cliente como leídos por sus códigos de cita (sin cuenta).
-- SECURITY DEFINER porque anon no puede hacer UPDATE directo sobre notifications
-- bajo RLS (la política notifications_client_update devuelve 0 filas aunque el
-- aviso sea de cliente). Solo toca avisos de cliente de los códigos pasados y
-- nunca sobrescribe un read_at ya fijado.
create or replace function public.mark_my_notifications_read(p_ids text[], p_codes text[])
returns table (id text)
language sql security definer set search_path = public as $$
    update public.notifications n
    set read_at = coalesce(n.read_at, now())
    where n.audience = 'client'
      and n.id = any (p_ids)
      and n.appointment_code = any (p_codes)
      and n.read_at is null
    returning n.id;
$$;
comment on function public.mark_my_notifications_read(text[], text[]) is 'Marca avisos de cliente como leídos por sus códigos de cita. SECURITY DEFINER porque anon no puede hacer UPDATE directo sobre notifications bajo RLS (la política notifications_client_update devuelve 0 filas).';
revoke all on function public.mark_my_notifications_read(text[], text[]) from public;
grant execute on function public.mark_my_notifications_read(text[], text[]) to anon, authenticated;

-- Registrar o renovar el token push de un dispositivo por su endpoint FCM.
-- SECURITY DEFINER porque el visitante no puede mantener sus códigos al día
-- con el sync normal (pull() vacía pushTokens para anon y cada activación
-- insertaba otra fila con el mismo endpoint). Une los códigos nuevos con los
-- que ya tenía (sin duplicados), conserva el id y borra filas duplicadas del
-- mismo endpoint. barber_id solo se fija cuando quien llama es del personal.
create or replace function public.register_push_token(p_endpoint text, p_codes text[], p_user_agent text)
returns text
language plpgsql security definer set search_path = public as $$
declare
    v_id text;
    v_codes text[];
    v_new text[];
    v_staff boolean;
    v_barber text;
begin
    if p_endpoint is null or p_endpoint = '' then
        return null;
    end if;
    v_staff := public.is_staff();
    v_barber := case when v_staff then public.my_barber_id() else null end;
    -- Códigos nuevos limpios (sin nulos ni vacíos).
    v_new := coalesce(array(
        select distinct code from unnest(coalesce(p_codes, '{}')) as code
        where code is not null and code <> ''
    ), '{}');

    -- Deduplicar por endpoint: quedarse con la fila más vieja.
    delete from public.push_tokens
    where endpoint = p_endpoint
      and id not in (
          select id from public.push_tokens
          where endpoint = p_endpoint
          order by created_at asc, id asc
          limit 1
      );

    select id, appointment_codes into v_id, v_codes
    from public.push_tokens where endpoint = p_endpoint limit 1;

    if v_id is null then
        v_id := 'tok-' || gen_random_uuid()::text;
        insert into public.push_tokens (id, endpoint, keys_p256dh, keys_auth, appointment_codes, barber_id, user_agent)
        values (v_id, p_endpoint, '', '', v_new, v_barber, coalesce(p_user_agent, ''));
    else
        v_codes := coalesce(array(
            select distinct code
            from unnest(coalesce(v_codes, '{}') || v_new) as code
            where code is not null and code <> ''
        ), '{}');
        update public.push_tokens
        set appointment_codes = v_codes,
            user_agent = case when p_user_agent is not null and p_user_agent <> '' then p_user_agent else user_agent end,
            barber_id = case when v_staff then coalesce(v_barber, barber_id) else barber_id end
        where id = v_id;
    end if;
    return v_id;
end;
$$;
comment on function public.register_push_token(text, text[], text) is 'Registra o renueva el token push de un dispositivo por su endpoint FCM. SECURITY DEFINER porque el visitante no puede mantener sus códigos al día con el sync normal (pull() vacía pushTokens para anon). Une los códigos nuevos con los que ya tenía y borra filas duplicadas del mismo endpoint.';
revoke all on function public.register_push_token(text, text[], text) from public;
grant execute on function public.register_push_token(text, text[], text) to anon, authenticated;

-- Registrar la ficha del cliente de una reserva en línea.
-- SECURITY DEFINER porque el visitante anónimo no puede insertar en clients
-- por sync (clients_staff_insert exige is_staff()): si la ficha entrara en
-- el push, toda la inserción fallaría por RLS y la confirmación mostraría
-- "No tienes permiso para hacer este cambio". En línea no se crea ficha
-- local (solo en citas manuales): la cita y el aviso salen con clientId
-- null, como antes del PR #15, y la ficha la registra esta función después
-- de que la reserva se guardó bien. Recibe SOLO el código: el nombre se lee
-- de appointments.client_name (ya limpio por el trigger) y el barbero de
-- appointments.barber_id. Solo actúa si la cita es una reserva en línea,
-- todavía no tiene ficha y se creó hace menos de 15 minutos. Si ya tiene
-- ficha, la devuelve sin hacer nada (idempotente). La búsqueda es igual que
-- la del trigger (lower(name)): una coincidencia la enlaza, cero la crea
-- con preferred_barber = el barbero de la cita, dos o más no crean otra y
-- la cita queda con client_id NULL. También enlaza los avisos de esa cita
-- que todavía no tienen client_id.
create or replace function public.register_client_for_appointment(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_row public.appointments;
    v_name text;
    v_count int;
    v_id text;
    v_out jsonb;
begin
    select * into v_row
    from public.appointments a
    where a.code = upper(trim(p_code))
    for update;

    if not found then
        raise exception 'No encontramos esa cita.';
    end if;

    if v_row.source is distinct from 'online' then
        raise exception 'Esa cita no es una reserva en línea.';
    end if;

    -- Ya tiene ficha: devolverla sin hacer nada (idempotente).
    if v_row.client_id is not null then
        select to_jsonb(c) into v_out from public.clients c where c.id = v_row.client_id;
        return v_out;
    end if;

    if v_row.created_at is null or v_row.created_at <= now() - interval '15 minutes' then
        raise exception 'Esa cita ya no admite registro de cliente.';
    end if;

    -- El nombre ya viene limpio del trigger guard_online_appointment.
    v_name := v_row.client_name;
    if v_name is null or length(trim(v_name)) < 2 then
        raise exception 'Escribe tu nombre completo.';
    end if;

    -- Que dos reservas simultáneas con el mismo nombre nuevo no creen dos fichas.
    perform pg_advisory_xact_lock(hashtext(lower(v_name)));

    -- Igual que el trigger: una coincidencia la enlaza, cero la crea, dos o
    -- más no crean otra y la cita queda con client_id NULL.
    select count(*), min(id) into v_count, v_id
    from public.clients
    where lower(name) = lower(v_name);

    if v_count = 1 then
        null; -- v_id ya es la ficha existente.
    elsif v_count = 0 then
        v_id := 'cl-' || gen_random_uuid()::text;
        insert into public.clients (id, name, email, phone, birth_date, haircut, beard, preferred_barber, photo_url, consent, marketing_consent, registered_at, status, address, alt_phones, last_modified_at)
        values (v_id, v_name, '', '', null, '', '', v_row.barber_id, '', null, null, now(), 'Activo', '', '[]'::jsonb, null);
    else
        return null;
    end if;

    update public.appointments set client_id = v_id where code = v_row.code;
    update public.notifications set client_id = v_id where appointment_code = v_row.code and client_id is null;

    select to_jsonb(c) into v_out from public.clients c where c.id = v_id;
    return v_out;
end;
$$;
comment on function public.register_client_for_appointment(text) is 'Registra la ficha del cliente de una reserva en línea y la une a la cita y a sus avisos. SECURITY DEFINER porque el visitante anónimo no puede insertar en clients por sync (clients_staff_insert exige is_staff()). Solo recibe el código: el nombre y el barbero se leen de la cita.';
revoke all on function public.register_client_for_appointment(text) from public;
grant execute on function public.register_client_for_appointment(text) to anon, authenticated;

-- Cuenta de Angel (desarrollador): creala en Authentication > Users, cambia el correo abajo y ejecuta:
-- insert into public.staff_roles (user_id, barber_id, is_admin, is_developer)
-- select id, null, false, true from auth.users where email = 'TU-CORREO@ejemplo.com'
-- on conflict (user_id) do update set is_developer = true;

-- =============================================================================
-- PR #17 (D + E) — BLOQUE PARA supabase/schema.sql (pegar al final del archivo).
-- Es el MISMO contenido que 20261124220000_notification_preferences.sql: aplica
-- UNO de los dos, no los dos (la migración es la vía recomendada; este bloque es
-- para que schema.sql, que es el esquema completo del repo, no quede desactualizado).
-- Si ya aplicaste la migración, pegar este bloque es seguro: todo es IF NOT EXISTS /
-- CREATE OR REPLACE / DROP POLICY IF EXISTS.
-- =============================================================================
-- -----------------------------------------------------------------------------
-- 1. Tabla de preferencias
--    booking_alerts: barbero = avisos de reserva/cancelación de SUS citas;
--                    cliente = avisos de SUS citas (recordatorios incluidos).
--    reminders: recordatorios (cliente 24 h / 1 h; barbero 1 h).
--    messages: mensajes manuales de la barbería al cliente.
--    Sin fila, todo activo (los interruptores nacen encendidos).
-- -----------------------------------------------------------------------------
create table if not exists public.notification_preferences (
    id text primary key,
    barber_id text references public.barbers(id) on delete cascade,
    appointment_code text references public.appointments(code) on delete cascade,
    booking_alerts boolean not null default true,
    reminders boolean not null default true,
    messages boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint notification_preferences_scope_check check (
        (barber_id is not null and appointment_code is null) or
        (barber_id is null and appointment_code is not null)
    ),
    constraint notification_preferences_barber_unique unique (barber_id),
    constraint notification_preferences_code_unique unique (appointment_code)
);
create index if not exists notification_preferences_barber_idx on public.notification_preferences(barber_id);
create index if not exists notification_preferences_code_idx on public.notification_preferences(appointment_code);

alter table public.notification_preferences enable row level security;

-- El personal lee su propia fila (el admin, todas); el cliente NO lee la tabla
-- directamente: sus preferencias se leen por RPC (my_notification_preferences).
drop policy if exists notification_preferences_staff_read on public.notification_preferences;
create policy notification_preferences_staff_read on public.notification_preferences for select
    using (public.is_admin() or barber_id = public.my_barber_id());

-- El personal escribe solo su propia fila (el admin, cualquiera). Sin política
-- de escritura para anon: el cliente escribe solo por RPC
-- (set_my_notification_preference, SECURITY DEFINER).
drop policy if exists notification_preferences_staff_insert on public.notification_preferences;
create policy notification_preferences_staff_insert on public.notification_preferences for insert
    with check (public.is_admin() or barber_id = public.my_barber_id());
drop policy if exists notification_preferences_staff_update on public.notification_preferences;
create policy notification_preferences_staff_update on public.notification_preferences for update
    using (public.is_admin() or barber_id = public.my_barber_id())
    with check (public.is_admin() or barber_id = public.my_barber_id());
drop policy if exists notification_preferences_staff_delete on public.notification_preferences;
create policy notification_preferences_staff_delete on public.notification_preferences for delete
    using (public.is_admin() or barber_id = public.my_barber_id());

-- -----------------------------------------------------------------------------
-- 2. RPCs del cliente (sin cuenta): lee/escribe solo por sus códigos de cita,
--    igual que my_notifications() / mark_my_notifications_read().
-- -----------------------------------------------------------------------------
create or replace function public.my_notification_preferences(p_codes text[])
returns setof public.notification_preferences
language sql security definer set search_path = public, pg_temp as $$
    select * from public.notification_preferences where appointment_code = any(p_codes);
$$;
comment on function public.my_notification_preferences(text[]) is 'Preferencias de avisos del cliente por sus códigos de cita. SECURITY DEFINER porque anon no puede leer notification_preferences bajo RLS.';
revoke all on function public.my_notification_preferences(text[]) from public;
grant execute on function public.my_notification_preferences(text[]) to anon, authenticated;

create or replace function public.set_my_notification_preference(
    p_code text, p_booking_alerts boolean, p_reminders boolean, p_messages boolean
)
returns public.notification_preferences
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_code text := upper(trim(p_code));
    v_row public.notification_preferences;
begin
    if not exists (select 1 from public.appointments where code = v_code) then
        raise exception 'No encontramos esa cita.';
    end if;
    insert into public.notification_preferences
        (id, barber_id, appointment_code, booking_alerts, reminders, messages)
    values
        ('pref-' || v_code, null, v_code,
         coalesce(p_booking_alerts, true), coalesce(p_reminders, true), coalesce(p_messages, true))
    on conflict (appointment_code) do update set
        booking_alerts = excluded.booking_alerts,
        reminders = excluded.reminders,
        messages = excluded.messages,
        updated_at = now()
    returning * into v_row;
    return v_row;
end;
$$;
comment on function public.set_my_notification_preference(text, boolean, boolean, boolean) is 'Guarda la preferencia de avisos del cliente para una cita. SECURITY DEFINER porque anon no puede escribir en notification_preferences bajo RLS. Solo acepta códigos de cita que existen.';
revoke all on function public.set_my_notification_preference(text, boolean, boolean, boolean) from public;
grant execute on function public.set_my_notification_preference(text, boolean, boolean, boolean) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. (E) Trigger guard_online_appointment: validar y CONSERVAR el correo.
--    Antes: `new.client_email := '';` — el correo del formulario se perdía en
--    el servidor aunque el navegador lo enviara. Ahora: se normaliza y, si no
--    tiene formato válido, la reserva no se guarda (el formulario y el motor ya
--    lo exigen antes, así que esto es la última defensa).
-- -----------------------------------------------------------------------------
create or replace function public.guard_online_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_auto boolean;
    v_count int;
    v_match text;
begin
    if public.is_staff() then
        return new;
    end if;
    new.client_name := left(regexp_replace(trim(coalesce(new.client_name, '')), '\s+', ' ', 'g'), 80);
    if length(new.client_name) < 2 then
        raise exception 'Escribe tu nombre completo.';
    end if;
    -- PR #17 (E): el correo es obligatorio en reservas en línea y se conserva.
    new.client_email := lower(left(trim(coalesce(new.client_email, '')), 120));
    if new.client_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
        raise exception 'Escribe un correo electrónico válido.';
    end if;
    select coalesce((booking->>'autoConfirm')::boolean, true) into v_auto from public.shop_settings where id = 1;
    new.status := case when coalesce(v_auto, true) then 'APROBADA' else 'PENDIENTE' end;
    new.source := 'online';
    select count(*), min(id) into v_count, v_match from public.clients where lower(name) = lower(new.client_name);
    new.client_id := case when v_count = 1 then v_match else null end;
    new.client_phone := '';
    new.completed_at := null;
    new.no_show_at := null;
    new.canceled_by_client := false;
    new.canceled_at := null;
    new.canceled_by := '';
    new.cancel_reason := '';
    new.created_at := now();
    return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. (E) register_client_for_appointment: copiar el correo de la cita a la ficha.
--    Antes creaba la ficha con email '' y nunca lo completaba.
-- -----------------------------------------------------------------------------
create or replace function public.register_client_for_appointment(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_row public.appointments;
    v_name text;
    v_count int;
    v_id text;
    v_out jsonb;
begin
    select * into v_row
    from public.appointments a
    where a.code = upper(trim(p_code))
    for update;

    if not found then
        raise exception 'No encontramos esa cita.';
    end if;

    if v_row.source is distinct from 'online' then
        raise exception 'Esa cita no es una reserva en línea.';
    end if;

    -- Ya tiene ficha: devolverla sin hacer nada (idempotente).
    if v_row.client_id is not null then
        select to_jsonb(c) into v_out from public.clients c where c.id = v_row.client_id;
        return v_out;
    end if;

    if v_row.created_at is null or v_row.created_at <= now() - interval '15 minutes' then
        raise exception 'Esa cita ya no admite registro de cliente.';
    end if;

    -- El nombre ya viene limpio del trigger guard_online_appointment.
    v_name := v_row.client_name;
    if v_name is null or length(trim(v_name)) < 2 then
        raise exception 'Escribe tu nombre completo.';
    end if;

    -- Que dos reservas simultáneas con el mismo nombre nuevo no creen dos fichas.
    perform pg_advisory_xact_lock(hashtext(lower(v_name)));

    -- Igual que el trigger: una coincidencia la enlaza, cero la crea, dos o
    -- más no crean otra y la cita queda con client_id NULL.
    select count(*), min(id) into v_count, v_id
    from public.clients
    where lower(name) = lower(v_name);

    if v_count = 1 then
        -- PR #17 (E): si la ficha existente no tenía correo, se completa con el de la cita.
        update public.clients set email = v_row.client_email
        where id = v_id and (email is null or email = '') and v_row.client_email <> '';
    elsif v_count = 0 then
        v_id := 'cl-' || gen_random_uuid()::text;
        insert into public.clients (id, name, email, phone, birth_date, haircut, beard, preferred_barber, photo_url, consent, marketing_consent, registered_at, status, address, alt_phones, last_modified_at)
        values (v_id, v_name, coalesce(nullif(v_row.client_email, ''), ''), '', null, '', '', v_row.barber_id, '', null, null, now(), 'Activo', '', '[]'::jsonb, null);
    else
        return null;
    end if;

    update public.appointments set client_id = v_id where code = v_row.code;
    update public.notifications set client_id = v_id where appointment_code = v_row.code and client_id is null;

    select to_jsonb(c) into v_out from public.clients c where c.id = v_id;
    return v_out;
end;
$$;
comment on function public.register_client_for_appointment(text) is 'Registra la ficha del cliente de una reserva en línea y la une a la cita y a sus avisos. SECURITY DEFINER porque el visitante anónimo no puede insertar en clients por sync (clients_staff_insert exige is_staff()). Solo recibe el código: el nombre, el correo y el barbero se leen de la cita.';
revoke all on function public.register_client_for_appointment(text) from public;
grant execute on function public.register_client_for_appointment(text) to anon, authenticated;
