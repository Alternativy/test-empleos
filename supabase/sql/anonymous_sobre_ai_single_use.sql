create schema if not exists private;
create table if not exists private.anonymous_ai_usage (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
revoke all on table private.anonymous_ai_usage from public, anon, authenticated;
create or replace function public.reserve_anonymous_ai_usage(p_key_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare inserted_hash text;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_anonymous_key'; end if;
  insert into private.anonymous_ai_usage(key_hash, status) values (p_key_hash, 'pending')
  on conflict (key_hash) do update set status='pending', created_at=now(), completed_at=null
    where private.anonymous_ai_usage.status='pending'
      and private.anonymous_ai_usage.created_at < now() - interval '10 minutes'
  returning key_hash into inserted_hash;
  return jsonb_build_object('allowed', inserted_hash is not null);
end; $$;
create or replace function public.complete_anonymous_ai_usage(p_key_hash text, p_success boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_success then
    update private.anonymous_ai_usage set status='completed', completed_at=now()
      where key_hash=p_key_hash and status='pending';
  else
    delete from private.anonymous_ai_usage where key_hash=p_key_hash and status='pending';
  end if;
end; $$;
revoke all on function public.reserve_anonymous_ai_usage(text) from public, anon, authenticated;
revoke all on function public.complete_anonymous_ai_usage(text, boolean) from public, anon, authenticated;
grant execute on function public.reserve_anonymous_ai_usage(text) to service_role;
grant execute on function public.complete_anonymous_ai_usage(text, boolean) to service_role;