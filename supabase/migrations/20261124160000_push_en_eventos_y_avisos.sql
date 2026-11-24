begin;

-- =============================================================================
-- Push en eventos y avisos de cliente (2026-11-24)
-- 1) El push al teléfono también se envía al reservar y al cambiar la cita:
--    eso lo hace el cliente web (supabase-sync.js invoca send-push al insertar
--    un aviso de cliente); aquí no hace falta nada en la base de datos.
-- 2) El guard de avisos solo protege la identidad del aviso (id, audiencia,
--    código de cita, barbero, cliente): el contenido (título, cuerpo, tipo,
--    leído) sí se puede cambiar sin sesión del personal. Antes solo se podía
--    cambiar read_at, así que marcar como leído fallaba cuando la fila enviada
--    difería en cualquier otro campo, y la app no podía corregir la redacción
--    de un aviso de cliente (de "Cita recibida" a "Cita confirmada").
-- Se puede ejecutar varias veces sin romper nada.
-- =============================================================================

-- Sin sesión del personal, un aviso solo puede cambiar su contenido (título,
-- cuerpo, tipo, leído): los datos que lo identifican no se pueden tocar.
create or replace function public.guard_notification_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if public.is_staff() then
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

commit;
