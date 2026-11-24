# Esquema de la Ficha de Cliente (CRM) — tablas nuevas

Este documento complementa `supabase/schema.sql` (que ya define `clients`, `appointments`, `barbers`, `staff_roles`, etc.). Aquí solo van las tablas nuevas que necesita la ficha de cliente tipo CRM (`crm/`). Igual que el otro documento, **es solo un mapa de referencia** — el módulo `crm/` hoy usa datos de prueba en `crm/src/data/mockData.ts` con exactamente esta misma forma, para que conectar Supabase después sea cambiar la implementación de `clientRepository.ts`, no la interfaz.

## `memos`
```sql
create table memos (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id) not null,
  type text not null check (type in (
    'Tardanza','Cancelacion','No Show','Advertencia','Excelente Cliente',
    'Cliente Problematico','Preferencia','Recordatorio','Pago Pendiente','Nota General'
  )),
  message text not null,
  priority text not null check (priority in ('Baja','Media','Alta','Critica')),
  created_by uuid references staff_roles(user_id) not null,
  created_at timestamptz not null default now()
);
```
El color (rojo/amarillo/azul/verde) se deriva de `priority` en la interfaz, no se guarda en la base de datos.

## `payments`
```sql
create table payments (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id) not null,
  appointment_code text references appointments(code),
  amount numeric(10,2) not null,
  method text not null check (method in ('Efectivo','Tarjeta','ATH Movil','PayPal','Apple Pay')),
  tip numeric(10,2) default 0,
  paid_at timestamptz not null default now()
);
```
El "balance pendiente" de un cliente = suma de servicios facturados no pagados (se calcula, no se guarda como columna aparte).

## `discounts`
```sql
create table discounts (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id) not null,
  appointment_code text references appointments(code),
  amount numeric(10,2) not null,
  reason text,
  applied_at timestamptz not null default now()
);
```

## `loyalty_accounts` + `loyalty_transactions`
```sql
create table loyalty_accounts (
  client_id text primary key references clients(id),
  points int not null default 0,
  level text not null default 'Bronce' check (level in ('Bronce','Plata','Oro','VIP'))
);

create table loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id) not null,
  points_delta int not null,
  reason text,
  created_at timestamptz not null default now()
);
```
El nivel se recalcula automáticamente según los puntos acumulados (regla de negocio en la aplicación, no en la base de datos).

## `client_change_log` (auditoría)
```sql
create table client_change_log (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id) not null,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid references staff_roles(user_id) not null,
  changed_at timestamptz not null default now()
);
```
Se escribe una fila por cada campo modificado en "Información General", y también un evento por cada memo creado (para que el historial completo del cliente quede en un solo lugar).

## `client_photos`
```sql
create table client_photos (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id) not null,
  url text not null,
  caption text,
  uploaded_at timestamptz not null default now()
);
```

## `client_documents`
```sql
create table client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id) not null,
  name text not null,
  url text not null,
  uploaded_at timestamptz not null default now()
);
```

## `client_alt_phones`
```sql
create table client_alt_phones (
  id uuid primary key default gen_random_uuid(),
  client_id text references clients(id) not null,
  phone text not null,
  owner_name text not null
);
```

## RLS
Todas estas tablas siguen el mismo patrón que `clients` en `supabase/schema.sql`: los clientes no tienen cuenta y no las ven; el barbero ve las de sus citas asignadas y el admin ve todas. `client_change_log` solo debería ser visible/editable por staff (nunca por el cliente), ya que es el registro de auditoría interno.
