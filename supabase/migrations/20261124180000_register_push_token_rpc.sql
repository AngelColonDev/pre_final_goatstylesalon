-- Registrar o renovar el token push de un dispositivo (RPC, SECURITY DEFINER).
--
-- El visitante no puede mantener sus códigos de cita al día con el sync
-- normal: pull() vacía pushTokens para anon (staffOnly) y el UPDATE directo
-- por endpoint nunca llega (la fila local no existe tras el pull, así que
-- cada activación insertaba otra fila con el mismo endpoint). Por eso el
-- registro del token pasa por esta función, igual que marcar-como-leído usa
-- mark_my_notifications_read().
--
-- La función identifica la fila por el endpoint FCM (solo ese teléfono lo
-- conoce): si no existe, la crea con los códigos pasados; si existe, une los
-- códigos nuevos con los que ya tenía (sin duplicados) y conserva su id. Si
-- hay varias filas con el mismo endpoint, se queda con la más vieja y borra
-- las demás. barber_id solo se fija cuando quien llama es del personal.
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
