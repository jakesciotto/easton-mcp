create table public.scope_grants (
  group_email text not null check (group_email = lower(group_email)),
  scope text not null check (scope in ('leaderboard:read', 'docs:read', 'leaderboard:write', 'docs:write')),
  added_by text not null,
  added_at timestamptz not null default now(),
  primary key (group_email, scope)
);
alter table public.scope_grants enable row level security;
revoke all on public.scope_grants from anon, authenticated;
grant all on public.scope_grants to service_role;
