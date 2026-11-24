begin;

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

commit;
