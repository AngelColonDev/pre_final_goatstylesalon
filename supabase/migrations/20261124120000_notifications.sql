begin;

-- =============================================================================
-- Notificaciones y push (2026-11-24)
-- Centro de avisos para clientes (notificaciones.html), recordatorios de citas
-- y suscripciones push de Firebase (FCM). Los clientes no tienen cuenta: leen
-- sus avisos por código de cita con my_notifications(), igual que consultan el
-- estado de su cita con appointment_status().
-- Se puede ejecutar varias veces sin romper nada.
-- =============================================================================

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

alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;

drop policy if exists notifications_staff_read on public.notifications;
drop policy if exists notifications_client_insert on public.notifications;
drop policy if exists notifications_staff_insert on public.notifications;
drop policy if exists notifications_client_update on public.notifications;
drop policy if exists notifications_staff_update on public.notifications;
drop policy if exists notifications_staff_delete on public.notifications;
drop policy if exists push_tokens_anon_insert on public.push_tokens;
drop policy if exists push_tokens_anon_update on public.push_tokens;
drop policy if exists push_tokens_staff_read on public.push_tokens;
drop policy if exists push_tokens_staff_delete on public.push_tokens;

-- Avisos: el personal los ve todos (el barbero los suyos y los sin barbero);
-- el visitante solo inserta avisos de cliente con código de cita, y solo puede
-- marcarlos como leídos (lo limita el trigger guard_notification_update).
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

-- Suscripciones push: cada dispositivo registra la suya; solo el personal las
-- lee y las limpia. El borrado local no borra la fila (noDelete en supabase-sync.js):
-- un token inválido se elimina cuando FCM lo rechaza al enviar.
create policy push_tokens_anon_insert on public.push_tokens for insert with check (true);
create policy push_tokens_anon_update on public.push_tokens for update using (true) with check (true);
create policy push_tokens_staff_read on public.push_tokens for select using (public.is_staff());
create policy push_tokens_staff_delete on public.push_tokens for delete using (public.is_staff());

-- Sin sesión del personal, un aviso solo se puede marcar como leído (read_at).
-- Cualquier otro cambio se rechaza, aunque la política de update lo permita.
create or replace function public.guard_notification_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if public.is_staff() then
        return new;
    end if;
    if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
        raise exception 'Solo puedes marcar tus avisos como leídos.';
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

commit;
