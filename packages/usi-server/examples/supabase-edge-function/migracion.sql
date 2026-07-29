-- Migración para hacer una app Supabase compatible con USI.
--
-- Dos partes, y la segunda es la que se olvida:
--   1. Marcar las entidades sintéticas.
--   2. **Sacarlas de todo lo que cuenta como negocio.**
--
-- Si los usuarios sintéticos entran en los reportes, en el ranking o en las
-- notificaciones, los números dejan de significar nada y alguien real recibe
-- un aviso de una cuenta que no existe. Poblar un entorno de demo y ensuciar
-- las métricas son dos cosas distintas: esta migración mantiene la diferencia.

-- ───────────────────────── 1. Marcado sintético ─────────────────────────

-- Se repite por cada tabla poblable. `synthetic` va NOT NULL DEFAULT false para
-- que lo existente quede marcado como real sin tocar una fila.
do $$
declare
  tabla text;
begin
  foreach tabla in array array['profiles', 'posts', 'reactions', 'messages'] loop
    execute format($f$
      alter table public.%I
        add column if not exists synthetic     boolean not null default false,
        add column if not exists simulation_id text,
        add column if not exists agent_id      text,
        add column if not exists created_by    text;
    $f$, tabla);

    -- Índice parcial: solo indexa lo sintético, que es una fracción mínima de
    -- la tabla. Un índice completo sobre una columna casi siempre false no
    -- serviría de nada y ocuparía lugar.
    execute format($f$
      create index if not exists %I on public.%I (simulation_id)
        where synthetic = true;
    $f$, tabla || '_sintetico_idx', tabla);
  end loop;
end $$;

-- Coherencia: si algo es sintético, tiene que decir de qué simulación viene.
-- Sin esto, una fila sintética sin `simulation_id` sería imposible de purgar
-- por ejecución y quedaría huérfana para siempre.
alter table public.profiles
  drop constraint if exists profiles_sintetico_coherente,
  add constraint profiles_sintetico_coherente
    check (not synthetic or simulation_id is not null);

-- ──────────────────── 2. Excluir lo sintético del negocio ────────────────────

-- Vistas para la app: por defecto, nadie ve agentes.
create or replace view public.profiles_reales as
  select * from public.profiles where synthetic = false;

create or replace view public.posts_reales as
  select * from public.posts where synthetic = false;

comment on view public.profiles_reales is
  'Perfiles de personas reales. Usar esta vista en reportes, métricas de negocio,
   facturación y cualquier envío de notificaciones.';

-- ─────────────────── 3. Tablas de apoyo del helper USI ───────────────────

-- Idempotencia: una Edge Function puede tener varias instancias, así que el
-- mapa en memoria del helper no alcanza — un reintento que caiga en otra
-- instancia duplicaría datos.
create table if not exists public.usi_idempotency (
  key        text primary key,
  value      jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists usi_idempotency_created_at_idx
  on public.usi_idempotency (created_at);

-- Nonces de purga: mismo motivo, y además tienen que ser de un solo uso de
-- verdad, no "de un solo uso por instancia".
create table if not exists public.usi_purge_tokens (
  token      text primary key,
  expires_at timestamptz not null,
  used       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auditoría del lado de la app: qué se aplicó realmente.
create table if not exists public.usi_audit (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  operation     text not null,
  entity_type   text not null,
  entity_id     text not null,
  simulation_id text not null,
  agent_id      text,
  result        text not null
);

create index if not exists usi_audit_simulacion_idx
  on public.usi_audit (simulation_id, at desc);

-- ─────────────────────────── 4. RLS ───────────────────────────

-- Las tablas de apoyo solo las toca la Edge Function con la service role key.
alter table public.usi_idempotency  enable row level security;
alter table public.usi_purge_tokens enable row level security;
alter table public.usi_audit        enable row level security;

-- Sin políticas: con RLS activo y ninguna política, nadie que use la anon key o
-- una sesión de usuario puede leerlas ni escribirlas. La service role saltea RLS
-- y es la única que las usa.

-- ─────────────────────── 5. Limpieza programada ───────────────────────

-- Requiere pg_cron. Si no está disponible, se puede correr a mano o desde un job.
-- select cron.schedule('usi-limpieza', '0 4 * * *', $$
--   delete from public.usi_idempotency where created_at < now() - interval '2 days';
--   delete from public.usi_purge_tokens where expires_at < now() - interval '1 day';
--   delete from public.usi_audit where at < now() - interval '90 days';
-- $$);
