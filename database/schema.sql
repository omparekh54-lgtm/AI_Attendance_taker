-- Replace SERVER_TOKEN_SHA256 with the SHA256 of a random 48-byte server token.
-- The token itself belongs only in Django's EIGENROLL_SERVER_TOKEN environment variable.
create function public.eigenroll_server_authorized() returns boolean
language sql stable security invoker set search_path = '' as $$
 select coalesce(encode(sha256(convert_to(current_setting('request.headers',true)::json->>'x-eigenroll-server','UTF8')),'hex') = 'SERVER_TOKEN_SHA256',false)
$$;
revoke all on function public.eigenroll_server_authorized() from public;
grant execute on function public.eigenroll_server_authorized() to anon;
create table public.eigenroll_entities (
 id text primary key, kind text not null check(kind in ('classes','students','sessions','models')),
 payload jsonb not null, revision integer not null default 1,
 updated_at timestamptz not null default now()
);
create index eigenroll_entities_kind_id on public.eigenroll_entities(kind,id);
create table public.eigenroll_enrollments (
 id uuid primary key default gen_random_uuid(), class_id text not null,
 roll text not null, payload jsonb not null, created_at timestamptz not null default now(),
 unique(class_id,roll)
);
create table public.eigenroll_limits (id text primary key, count integer not null default 0);
create function public.eigenroll_consume_limit(bucket text, maximum integer) returns boolean
language sql volatile security invoker set search_path='' as $$
 with updated as (insert into public.eigenroll_limits(id,count) values(bucket,1)
 on conflict(id) do update set count=eigenroll_limits.count+1 returning count)
 select count<=maximum from updated
$$;
revoke all on function public.eigenroll_consume_limit(text,integer) from public;
grant execute on function public.eigenroll_consume_limit(text,integer) to anon;
alter table public.eigenroll_entities enable row level security;
alter table public.eigenroll_enrollments enable row level security;
alter table public.eigenroll_limits enable row level security;
revoke all on public.eigenroll_entities,public.eigenroll_enrollments,public.eigenroll_limits from anon,authenticated;
grant select,insert,update,delete on public.eigenroll_entities,public.eigenroll_enrollments,public.eigenroll_limits to anon;
create policy django_only on public.eigenroll_entities to anon using ((select public.eigenroll_server_authorized())) with check ((select public.eigenroll_server_authorized()));
create policy django_only on public.eigenroll_enrollments to anon using ((select public.eigenroll_server_authorized())) with check ((select public.eigenroll_server_authorized()));
create policy django_only on public.eigenroll_limits to anon using ((select public.eigenroll_server_authorized())) with check ((select public.eigenroll_server_authorized()));
