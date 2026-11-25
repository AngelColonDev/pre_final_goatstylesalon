-- Registrar la ficha del cliente de una reserva en línea (RPC, SECURITY DEFINER).
--
-- La confirmación de una reserva en línea fallaba con "No tienes permiso
-- para hacer este cambio" por DOS inserciones, no una:
-- 1. La ficha del cliente que el PR #15 creaba en local entraba en el push
--    y la única política INSERT de clients (clients_staff_insert, with check
--    is_staff()) la rechazaba para sesiones anónimas.
-- 2. El aviso "Cita recibida" llevaba client_id='cl-…' (id local que no
--    existe en el servidor) y la FK de notifications.client_id lo rechazaba
--    (error 23503). El trigger guard_online_appointment limpia client_id en
--    appointments, pero NO hay trigger que lo limpie en notifications.
-- Por eso en línea NO se crea ficha local (booking-engine.js solo la crea
-- en citas manuales): la cita y el aviso salen con clientId null, como
-- antes del PR #15. La ficha la registra esta función DESPUÉS de que la
-- reserva se guardó bien, igual que el token push usa register_push_token()
-- y marcar-como-leído usa mark_my_notifications_read().
--
-- La función recibe SOLO el código de la cita: el nombre se lee de
-- appointments.client_name (ya limpio por el trigger) y el barbero de
-- appointments.barber_id. No se aceptan nombre ni barbero del navegador:
-- cualquiera que adivinara un código GS-###### podría crear fichas con
-- nombre ajeno o asignar cualquier barbero. Solo actúa si la cita es una
-- reserva en línea, todavía no tiene ficha y se creó hace menos de 15
-- minutos. Si ya tiene ficha, la devuelve sin hacer nada (idempotente).
-- La búsqueda de ficha es igual que la del trigger (lower(name)): una
-- coincidencia la enlaza, cero la crea con preferred_barber = el barbero de
-- la cita, dos o más no crean otra y la cita queda con client_id NULL.
-- pg_advisory_xact_lock evita que dos reservas simultáneas con el mismo
-- nombre nuevo creen dos fichas. También enlaza los avisos de esa cita
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
