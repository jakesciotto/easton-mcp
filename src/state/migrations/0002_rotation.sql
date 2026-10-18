create or replace function public.rotate_refresh_token(old_hash text, next jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fam uuid;
begin
  update public.refresh_tokens
     set rotated_at = now()
   where token_hash = old_hash
     and rotated_at is null
     and revoked_at is null
  returning family_id into fam;
  if fam is null then
    return false;
  end if;
  insert into public.refresh_tokens (token_hash, family_id, client_id, subject, role, scopes, expires_at)
  values (
    next->>'token_hash',
    fam,
    next->>'client_id',
    next->>'subject',
    next->>'role',
    array(select jsonb_array_elements_text(next->'scopes')),
    (next->>'expires_at')::timestamptz
  );
  return true;
end
$$;

revoke execute on function public.rotate_refresh_token(text, jsonb) from public, anon, authenticated;
grant execute on function public.rotate_refresh_token(text, jsonb) to service_role;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
