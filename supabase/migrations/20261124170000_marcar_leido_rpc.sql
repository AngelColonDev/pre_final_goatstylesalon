-- Marcar avisos de cliente como leídos (RPC, SECURITY DEFINER).
--
-- El rol anon NO puede hacer UPDATE directo sobre public.notifications aunque la
-- política notifications_client_update lo permita: verificado en vivo, el UPDATE
-- devuelve 0 filas afectadas (PostgREST responde 204 y read_at queda NULL).
-- Por eso el cliente marca como leído a través de esta función, igual que ya
-- lee sus avisos con my_notifications().
--
-- La prueba de propiedad es conocer el código de cita (GS-######): solo se
-- actualizan avisos de cliente cuyo appointment_code está entre los códigos que
-- el navegador guarda en su lista "Mis citas". Un aviso ya leído no se toca
-- (read_at se conserva con coalesce).
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
