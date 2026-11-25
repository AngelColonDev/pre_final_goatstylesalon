-- =============================================================================
-- PR #17 (C) — Transferencia v2: solicitudes de transferencia con aceptación.
-- Archivo: supabase/migrations/20261124210000_transfer_requests.sql
-- Rama: fix-panel-menu-transfer. Ejecutar UNA vez en Supabase → SQL Editor.
-- Idempotente: se puede volver a ejecutar sin duplicar nada.
--
-- QUÉ CAMBIA RESPECTO A LA v1 (transfer_appointment, PR #15):
-- La v1 movía la cita de inmediato. La v2 crea una SOLICITUD: la cita queda
-- con el barbero original (marcada "Transferencia pendiente" en el panel) y
-- solo cambia de barbero cuando el receptor la ACEPTA. Si la rechaza, todo
-- queda como estaba. La v1 (RPC transfer_appointment) NO se borra: queda para
-- compatibilidad, pero el panel ya no la usa para citas.
--
-- DECISIONES DE DISEÑO (ver README de pr17/c):
-- 1. Estado DERIVADO de transfer_requests, sin columna nueva en appointments:
--    "pendiente" = existe solicitud pendiente para ese código; "transferida" =
--    existe solicitud aceptada. Una sola fuente de verdad, sin riesgo de que
--    la columna y la tabla se desincronicen por sync. El historial de la cita
--    sí guarda la entrada 'Transferida' (como la v1) para auditoría.
-- 2. Los AVISOS los crean las propias RPCs (SECURITY DEFINER, INSERT directo):
--    así el receptor, el barbero original y el cliente reciben su aviso aunque
--    el navegador de quien pidió se cierre justo después de la llamada. El JS
--    solo refleja en local lo que la RPC devuelve (mismo id) y dispara el push
--    con sendPushForNotification(id) por cada aviso devuelto.
-- 3. Las RPCs solo hacen INSERT en notifications, nunca UPDATE: el trigger
--    guard_notification_update NO se dispara y NO hay que tocarlo ni ampliar
--    su excepción (que sigue siendo solo para register_client_for_appointment).
--    El client_id del aviso se fija en el INSERT con el client_id que la cita
--    ya tiene (puede ser null en reservas en línea sin ficha: el cliente lee
--    sus avisos por código con my_notifications(), no por ficha).
-- 4. RLS: solo lectura con ámbito (origen o destino; admin todo). NO hay
--    políticas de INSERT/UPDATE/DELETE: escribir solo se puede por RPC, así
--    ningún cliente puede inventar ni decidir solicitudes por sync directo.
-- 5. Una sola solicitud pendiente por cita (índice único parcial): el segundo
--    intento da error claro en vez de crear un duplicado.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tabla de solicitudes
-- -----------------------------------------------------------------------------
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
-- Una sola solicitud pendiente por cita.
create unique index if not exists transfer_requests_one_pending_per_appointment
    on public.transfer_requests(appointment_code) where status = 'pendiente';

alter table public.transfer_requests enable row level security;
drop policy if exists transfer_requests_staff_read on public.transfer_requests;
create policy transfer_requests_staff_read on public.transfer_requests for select using (
    public.is_admin()
    or from_barber_id = public.my_barber_id()
    or to_barber_id = public.my_barber_id()
);
-- Sin políticas de INSERT/UPDATE/DELETE: solo las RPCs de abajo escriben.

-- -----------------------------------------------------------------------------
-- Etiqueta de barbero ("Gabriel (Gaby)" / "Wilo"), igual que transfer_appointment.
-- -----------------------------------------------------------------------------
create or replace function public.transfer_barber_label(p_barber_id text) returns text
language sql stable security definer set search_path = public as $$
    select case when b.alias <> '' and b.alias is distinct from b.name
        then b.name || ' (' || b.alias || ')' else b.name end
    from public.barbers b where b.id = p_barber_id;
$$;

-- -----------------------------------------------------------------------------
-- request_transfer(p_code, p_to_barber_id, p_reason)
-- Crea la solicitud y avisa al receptor. La cita NO cambia de barbero.
-- Devuelve jsonb { request, notifications: [...] } para que el panel refleje
-- en local exactamente lo creado (mismos ids) sin volver a subirlo por sync.
-- -----------------------------------------------------------------------------
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
    -- El receptor debe tener el hueco libre a esa hora (si no, no tiene
    -- sentido pedirle que acepte). Se vuelve a comprobar al aceptar.
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

    -- Aviso en app al receptor (el push lo dispara el panel con el id
    -- devuelto; send-push lo manda a los tokens de ese barbero).
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

-- -----------------------------------------------------------------------------
-- respond_transfer(p_request_id, p_accept)
-- El receptor (o el admin) acepta o rechaza. Solo al aceptar cambia la cita
-- de barbero. Devuelve jsonb { request, appointment, notifications }.
-- Si la cita ya no está activa cuando se responde, la solicitud se cierra
-- sola como rechazada por el sistema y se avisa al barbero original y al
-- cliente (no queda una solicitud pendiente huérfana).
-- -----------------------------------------------------------------------------
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

    -- La cita ya no está activa (se canceló, completó o rechazó mientras la
    -- solicitud esperaba): se cierra sola como rechazada y se avisa.
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
        -- El hueco puede haberse ocupado desde que se pidió: se comprueba
        -- ahora, con la cita bloqueada. Si está ocupado, la solicitud sigue
        -- pendiente y el receptor puede rechazarla.
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
