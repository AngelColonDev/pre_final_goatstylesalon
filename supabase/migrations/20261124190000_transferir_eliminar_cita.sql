-- Transferir una cita a otro barbero y eliminar citas (RPCs, SECURITY DEFINER).
--
-- El personal no puede hacer estos cambios por sync directo:
-- - appointments_staff_update exige que la fila nueva sea del mismo barbero,
--   así que un barbero no podría pasar una cita a otro barbero.
-- - appointments_admin_delete solo permite borrar al admin.
-- Por eso ambas operaciones pasan por estas funciones, igual que ya lo hacen
-- transfer_client() y mark_my_notifications_read().
--
-- transfer_appointment() devuelve la cita actualizada (jsonb) para que el
-- panel refleje el cambio en local sin volver a subirlo por sync. Si la cita
-- ya está con ese barbero, no hace nada y devuelve la fila tal cual (la
-- operación es idempotente: reintentarla no duplica el historial).
-- delete_appointment() borra la cita y todos sus avisos; devuelve true si
-- borró algo. Solo borra citas que ya no están activas: una cita pendiente o
-- confirmada se cancela primero, para que el cliente reciba el aviso.

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
