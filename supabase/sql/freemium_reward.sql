-- Recompensa freemium por visualización del anuncio.
-- Aplicar únicamente en Supabase de testing antes de probar la rama Freemium.

create schema if not exists private;

create table if not exists private.ad_reward_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists ad_reward_events_user_created_idx
  on private.ad_reward_events (user_id, created_at desc);

alter table private.ad_reward_events enable row level security;
revoke all on table private.ad_reward_events from anon, authenticated;

create or replace function public.iniciar_anuncio_match()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'auth_required';
  end if;

  if not exists (
    select 1
    from public.perfiles
    where id = v_user_id and rol = 'c'
  ) then
    raise exception 'solo_postulantes';
  end if;

  insert into private.ad_reward_events (user_id)
  values (v_user_id)
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.reclamar_match_anuncio(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_created_at timestamptz;
  v_claimed_at timestamptz;
  v_cupo integer;
begin
  if v_user_id is null then
    raise exception 'auth_required';
  end if;

  select created_at, claimed_at
    into v_created_at, v_claimed_at
  from private.ad_reward_events
  where id = p_event_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'anuncio_no_valido';
  end if;

  if v_claimed_at is not null then
    raise exception 'anuncio_ya_reclamado';
  end if;

  if v_created_at > now() - interval '5 seconds' then
    raise exception 'anuncio_tiempo_insuficiente';
  end if;

  if v_created_at < now() - interval '15 minutes' then
    raise exception 'anuncio_expirado';
  end if;

  update private.ad_reward_events
  set claimed_at = now()
  where id = p_event_id;

  update public.perfiles
  set cupo = coalesce(cupo, 0) + 1
  where id = v_user_id and rol = 'c'
  returning cupo into v_cupo;

  if not found then
    raise exception 'solo_postulantes';
  end if;

  return v_cupo;
end;
$$;

revoke all on function public.iniciar_anuncio_match() from public, anon;
revoke all on function public.reclamar_match_anuncio(uuid) from public, anon;
grant execute on function public.iniciar_anuncio_match() to authenticated;
grant execute on function public.reclamar_match_anuncio(uuid) to authenticated;
