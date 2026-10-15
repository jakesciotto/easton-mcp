create table public.oauth_clients (
  client_id text primary key,
  source text not null check (source in ('dcr', 'cimd')),
  client_name text,
  client_secret_hash text,
  client_secret_expires_at timestamptz,
  token_endpoint_auth_method text not null default 'none',
  redirect_uris text[] not null,
  grant_types text[] not null default array['authorization_code', 'refresh_token'],
  scope text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.auth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients (client_id),
  subject text not null,
  role text not null check (role in ('coach', 'admin')),
  scopes text[] not null,
  code_challenge text not null,
  redirect_uri text not null,
  resource text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index auth_codes_expires_at_idx on public.auth_codes (expires_at);

create table public.refresh_tokens (
  token_hash text primary key,
  family_id uuid not null,
  client_id text not null references public.oauth_clients (client_id),
  subject text not null,
  role text not null check (role in ('coach', 'admin')),
  scopes text[] not null,
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index refresh_tokens_subject_idx on public.refresh_tokens (subject);
create index refresh_tokens_family_id_idx on public.refresh_tokens (family_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  subject text not null,
  client_id text,
  tool text not null,
  input_hash text not null,
  input jsonb,
  idempotency_key text,
  outcome text not null check (outcome in ('ok', 'error', 'denied', 'replayed')),
  result jsonb,
  error text,
  duration_ms integer not null
);

create index audit_log_subject_at_idx on public.audit_log (subject, at desc);
create unique index audit_log_idempotency_idx
  on public.audit_log (subject, tool, idempotency_key)
  where idempotency_key is not null and outcome = 'ok';

alter table public.oauth_clients enable row level security;
alter table public.auth_codes enable row level security;
alter table public.refresh_tokens enable row level security;
alter table public.audit_log enable row level security;

revoke all on schema public from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
