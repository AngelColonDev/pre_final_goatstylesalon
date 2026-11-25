-- =============================================================================
-- PR #17 (D + E) — Preferencias de notificación + correo obligatorio en la reserva
-- Migración: 20261124220000_notification_preferences.sql
-- Proyecto: goat-style-salon. Aplicar en el SQL Editor de Supabase (o con
-- `supabase db push`) ANTES de publicar los archivos JS/HTML del PR #17.
-- Re-ejecutable: todo usa IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
--
-- D. Tabla nueva `notification_preferences` (una fila por barbero o por código
--    de cita). Decisión: tabla propia en vez de un campo en `shop_settings`,
--    porque `shop_settings` es UNA sola fila (id = 1) que solo el admin puede
--    escribir, y aquí cada barbero escribe SOLO su fila y cada cliente escribe
--    SOLO la de sus códigos de cita — eso exige RLS por fila, imposible en un
--    jsonb compartido. Además sobrevive al merge de `settings` de shared-data.js.
-- E. El trigger guard_online_appointment BORRABA el correo (`new.client_email
--    := ''`): aquí se valida y se conserva. Y register_client_for_appointment
--    creaba la ficha con email '': aquí copia el de la cita.
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
