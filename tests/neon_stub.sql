-- Simulates Neon Data API: roles authenticated/anonymous, auth.user_id() from pg_session_jwt (text ids).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then create role anonymous nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.user_id() returns text language sql stable as $$ select nullif(current_setting('neon.sim_sub', true), '') $$;
grant usage on schema auth to anonymous, authenticated;
grant execute on function auth.user_id() to anonymous, authenticated;
