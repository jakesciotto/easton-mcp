alter table public.auth_codes drop constraint auth_codes_client_id_fkey;
alter table public.refresh_tokens drop constraint refresh_tokens_client_id_fkey;
