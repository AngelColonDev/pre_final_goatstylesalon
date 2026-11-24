begin;

alter table public.reviews add column if not exists published_at timestamptz;

create or replace function public.guard_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' then
        if not public.is_admin() then
            raise exception 'Solo el administrador puede moderar reseñas.';
        end if;
        if (to_jsonb(new) - array['status', 'hidden_reason', 'hidden_by', 'hidden_at'])
            is distinct from (to_jsonb(old) - array['status', 'hidden_reason', 'hidden_by', 'hidden_at']) then
            raise exception 'La moderación no puede cambiar la opinión del cliente.';
        end if;
        if new.status = 'OCULTA' then
            if length(trim(new.hidden_reason)) = 0 then
                raise exception 'Indica qué norma viola la reseña.';
            end if;
            new.hidden_by := auth.uid()::text;
            new.hidden_at := now();
        end if;
        new.published_at := old.published_at;
        if old.status <> 'APROBADA' and new.status = 'APROBADA' and new.published_at is null
            and (new.publish_consent is true or (new.publish_consent is null and new.appointment_code is null)) then
            new.published_at := now();
        end if;
        return new;
    end if;
    new.published_at := null;
    if public.is_staff() then
        if new.status = 'APROBADA' and (new.publish_consent is true or (new.publish_consent is null and new.appointment_code is null)) then
            new.published_at := now();
        end if;
        return new;
    end if;
    new.client_name := left(regexp_replace(trim(coalesce(new.client_name, '')), '\s+', ' ', 'g'), 80);
    if length(new.client_name) < 2 then
        raise exception 'Escribe tu nombre completo.';
    end if;
    if length(trim(coalesce(new.service, ''))) = 0 then
        raise exception 'Escoge el servicio que te hiciste.';
    end if;
    if not exists (select 1 from public.barbers where id = new.barber_id) then
        raise exception 'Escoge tu barbero.';
    end if;
    if length(trim(new.text)) > 600 then
        raise exception 'El comentario debe tener como máximo 600 caracteres.';
    end if;
    new.client_id := null;
    new.client_photo := coalesce(new.client_photo, '');
    if new.client_photo <> '' and (length(new.client_photo) > 24000
        or new.client_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$') then
        raise exception 'La foto de la reseña no es válida.';
    end if;
    new.appointment_code := null;
    new.service_date := null;
    new.publish_consent := true;
    new.status := 'PENDIENTE';
    new.created_at := now();
    new.hidden_reason := '';
    new.hidden_by := '';
    new.hidden_at := null;
    return new;
end;
$$;

commit;
