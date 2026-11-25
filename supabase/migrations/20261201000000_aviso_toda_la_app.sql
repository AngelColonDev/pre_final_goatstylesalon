begin;

-- =============================================================================
-- Aviso a toda la app (2026-12-01) — PREPARADA, pendiente de aplicar
-- Qué hace: permite una nueva audiencia 'app' en public.notifications, para
--   enviar un aviso general a TODAS las personas con la app instalada (todos
--   los tokens registrados en public.push_tokens), aunque nunca hayan sacado
--   una cita (un visitante anónimo que activó el push en Ajustes queda
--   registrado con appointment_codes vacío y también debe recibirlo).
-- Por qué hace falta: la tabla notifications tenía un CHECK que solo permitía
--   audience en ('client', 'staff'), así que insertar una fila con
--   audience = 'app' fallaba; y la RPC my_notifications() solo devolvía avisos
--   de cliente por código de cita, así que un visitante sin citas no vería el
--   aviso general en la campana.
-- IMPORTANTE: esta migración sola NO envía push a nadie. Para que el push
--   salga, la Edge Function send-push debe redesplegarse con la rama 'app' en
--   tokensForNotification() (devuelve todos los tokens de push_tokens, sin
--   filtros). Sin ese redespliegue, el aviso queda visible en la campana pero
--   no suena en los teléfonos.
-- Se puede ejecutar varias veces sin romper nada (idempotente).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) Ampliar el CHECK de audience de notifications para permitir 'app'.
--    Se localiza la restricción de forma segura: se busca en pg_constraint,
--    por tabla y por la definición (que mencione 'audience'), se borra si
--    existe y se crea notifications_audience_check con los tres valores.
-- -----------------------------------------------------------------------------
do $$
declare
    v_constraint text;
begin
    select con.conname
      into v_constraint
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'notifications'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%audience%'
     limit 1;

    if v_constraint is not null then
        execute format('alter table public.notifications drop constraint %I', v_constraint);
    end if;

    alter table public.notifications
        add constraint notifications_audience_check
        check (audience in ('client', 'staff', 'app'));
end;
$$;

-- -----------------------------------------------------------------------------
-- b) Recrear public.my_notifications(p_codes text[]) con la MISMA firma y las
--    MISMAS columnas, añadiendo los avisos de audiencia 'app': se devuelven
--    para cualquier visitante, tenga o no códigos de cita (incluso con
--    p_codes vacío o nulo). Se mantienen el orden (created_at desc) y el
--    límite (200). Definición base: migración
--    20261124120000_notifications.sql.
-- -----------------------------------------------------------------------------
create or replace function public.my_notifications(p_codes text[])
returns table (id text, audience text, barber_id text, client_id text, type text, title text, body text, appointment_code text, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
    select n.id, n.audience, n.barber_id, n.client_id, n.type, n.title, n.body, n.appointment_code, n.read_at, n.created_at
    from public.notifications n
    where n.audience = 'app'
       or (n.audience = 'client'
           and n.appointment_code = any (p_codes))
    order by n.created_at desc
    limit 200;
$$;
revoke all on function public.my_notifications(text[]) from public;
grant execute on function public.my_notifications(text[]) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- d) Política de inserción del personal: NO hace falta ninguna política nueva.
--    La política existente notifications_staff_insert
--      create policy notifications_staff_insert on public.notifications
--        for insert with check (public.is_staff());
--    solo exige que quien inserta sea personal (is_staff()); no limita el
--    valor de audience. Por tanto, el Super Admin ya puede insertar filas con
--    audience = 'app' en cuanto el CHECK de arriba lo permita.
-- -----------------------------------------------------------------------------

commit;
