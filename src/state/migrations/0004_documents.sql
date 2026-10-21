create table public.documents (
  drive_id text primary key,
  kind text not null check (kind in ('drive', 'folder', 'doc', 'sheet', 'slides')),
  title text not null,
  writable boolean not null default false,
  added_by text not null,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);

create index documents_live_idx on public.documents (removed_at) where removed_at is null;

alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
grant all on public.documents to service_role;
