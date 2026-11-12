-- Denuncias de empresas y verificación manual por el equipo de Match Empleos.
-- Aplicado en el proyecto Supabase de testing: gtnxlkqumppeintdpycn.

create table if not exists public.denuncias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.perfiles(id) on delete restrict,
  denunciante_id uuid not null default auth.uid() references public.perfiles(id) on delete restrict,
  postulacion_id text not null references public.postulaciones(id) on delete restrict,
  chat_id text references public.chats(id) on delete set null,
  motivo text not null check (motivo in (
    'Es una empresa falsa',
    'Suplantación de identidad',
    'Lenguaje inapropiado',
    'Condiciones Inaceptables',
    'Contenidos obscenos o de odio',
    'Spam o Confuso',
    'Otros'
  )),
  motivo_otro text,
  mensaje text not null default '' check (char_length(mensaje) <= 2000),
  estado text not null default 'pendiente' check (estado in ('pendiente','en_revision','resuelta','desestimada')),
  created_at timestamptz not null default now(),
  constraint denuncias_motivo_otro_check check (
    (motivo = 'Otros' and nullif(btrim(motivo_otro), '') is not null)
    or (motivo <> 'Otros' and motivo_otro is null)
  )
);

create index if not exists denuncias_empresa_created_idx on public.denuncias (empresa_id, created_at desc);
create index if not exists denuncias_estado_created_idx on public.denuncias (estado, created_at desc);
create index if not exists denuncias_postulacion_idx on public.denuncias (postulacion_id);

alter table public.denuncias enable row level security;
revoke all on public.denuncias from anon, authenticated;
grant insert on public.denuncias to authenticated;

drop policy if exists "Los postulantes pueden denunciar empresas vinculadas a sus postulaciones" on public.denuncias;
create policy "Los postulantes pueden denunciar empresas vinculadas a sus postulaciones"
on public.denuncias
for insert
to authenticated
with check (
  denuncias.denunciante_id = (select auth.uid())
  and exists (
    select 1
    from public.perfiles perfil
    join public.postulaciones p on p.candidato_id = perfil.id
    join public.busquedas b on b.id = p.oferta_id
    where perfil.id = (select auth.uid())
      and perfil.rol = 'c'
      and p.id = denuncias.postulacion_id
      and b.empresa_id = denuncias.empresa_id
      and (
        denuncias.chat_id is null
        or exists (
          select 1 from public.chats ch
          where ch.id = denuncias.chat_id
            and ch.postulacion_id = p.id
            and ch.candidato_id = perfil.id
            and ch.empresa_id = b.empresa_id
        )
      )
  )
);

-- Esta tabla es el único dato público de verificación. No se puede escribir desde el frontend.
create table if not exists public.empresas_verificadas (
  empresa_id uuid primary key references public.perfiles(id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table public.empresas_verificadas enable row level security;
revoke all on public.empresas_verificadas from anon, authenticated;
grant select on public.empresas_verificadas to authenticated;
drop policy if exists "Usuarios autenticados pueden consultar empresas verificadas" on public.empresas_verificadas;
create policy "Usuarios autenticados pueden consultar empresas verificadas"
on public.empresas_verificadas
for select
to authenticated
using (true);

-- Expediente interno. No está expuesto al Data API ni a usuarios finales.
create schema if not exists private;
create table if not exists private.empresa_verificacion_revisiones (
  empresa_id uuid primary key references public.perfiles(id) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente','verificada','rechazada')),
  notas_internas text,
  revisado_por uuid references auth.users(id) on delete set null,
  revisado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.empresa_verificacion_revisiones enable row level security;
revoke all on private.empresa_verificacion_revisiones from anon, authenticated;

create or replace function private.sync_empresa_verificada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado = 'verificada' then
    insert into public.empresas_verificadas (empresa_id, verified_at)
    values (new.empresa_id, coalesce(new.revisado_at, now()))
    on conflict (empresa_id) do update
      set verified_at = excluded.verified_at;
  else
    delete from public.empresas_verificadas where empresa_id = new.empresa_id;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_empresa_verificada() from public, anon, authenticated;

drop trigger if exists sync_empresa_verificada on private.empresa_verificacion_revisiones;
create trigger sync_empresa_verificada
after insert or update of estado, revisado_at on private.empresa_verificacion_revisiones
for each row execute function private.sync_empresa_verificada();

comment on table public.denuncias is 'Denuncias de empresas enviadas por postulantes. El equipo Match Empleos las revisa desde Supabase SQL Editor con permisos administrativos.';
comment on table public.empresas_verificadas is 'Listado público mínimo de empresas verificadas; solo el equipo Match Empleos puede modificarlo desde SQL Editor.';
comment on table private.empresa_verificacion_revisiones is 'Registro interno de revisión y verificación de empresas; accesible al equipo desde SQL Editor.';


-- Los postulantes también pueden consultar las búsquedas a las que ya se postularon,
-- aunque hayan sido pausadas o cerradas, para poder denunciar y revisar el chat.
drop policy if exists "candidatos puede leer busquedas activas" on public.busquedas;
create policy "candidatos leen busquedas activas y postulaciones propias"
on public.busquedas
for select
to authenticated
using (
  estado = 'Activa'
  or exists (
    select 1
    from public.postulaciones p
    where p.oferta_id = busquedas.id
      and p.candidato_id = (select auth.uid())
  )
);


-- Mantener el texto exacto que presenta el formulario de denuncia.
alter table public.denuncias drop constraint if exists denuncias_motivo_check;
alter table public.denuncias add constraint denuncias_motivo_check check (motivo in (
  'Es una empresa falsa',
  'Suplantación de identidad',
  'Lenguaje inapropiado',
  'Condiciones Inaceptables',
  'Contenidos obscenos o de odio',
  'Spam o Confuso',
  'Otros'
));
