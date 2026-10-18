-- Temporary relay only; attendance results are never saved here.
create table public.eigenroll_capture_sessions (
 id uuid primary key, expires_at timestamptz not null,
 payload jsonb default null
);
create index eigenroll_capture_expiry on public.eigenroll_capture_sessions(expires_at);
alter table public.eigenroll_capture_sessions enable row level security;
revoke all on public.eigenroll_capture_sessions from public, anon, authenticated;
grant select,insert,update,delete on public.eigenroll_capture_sessions to anon;
create policy django_only on public.eigenroll_capture_sessions to anon
using ((select public.eigenroll_server_authorized()))
with check ((select public.eigenroll_server_authorized()));
