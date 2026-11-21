#!/bin/bash
# Load migrations into a Neon-like database and run core flows with Better-Auth-style (non-UUID) user ids.
set -e
P="psql -h /tmp/pg -p 5544 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hxneon" -c "create database hxneon"
for f in tests/neon_stub.sql supabase/migrations/*.sql; do $P -d hxneon -f "$f"; done
$P -d hxneon <<'SQL'
set client_min_messages = notice;
do $$
declare b1 uuid; b2 uuid; d jsonb; ok boolean;
begin
  perform set_config('neon.sim_sub', 'kH7xQ2pLm9VbT4wZ', false);  -- Better Auth style id
  perform set_config('role', 'authenticated', false);
  b1 := (public.create_business('Neon Kada', 'grocery', 'INR', 'ml', true)->>'id')::uuid;
  d := public.dashboard_summary(b1);
  if (d->>'sales_count')::int <> 5 then raise exception 'FAIL demo on neon'; end if;
  perform set_config('neon.sim_sub', 'otherUser123', false);
  b2 := (public.create_business('Other', 'retail', 'AED')->>'id')::uuid;
  begin perform public.dashboard_summary(b1); raise exception 'FAIL isolation';
  exception when sqlstate 'HE002' then null; end;
  if (select count(*) from sales) <> 0 then raise exception 'FAIL rls'; end if;
  perform set_config('neon.sim_sub', '', false);
  perform set_config('role', 'anonymous', false);
  begin perform public.my_businesses(); raise exception 'FAIL anon exec';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.sales; raise exception 'FAIL anon table';
  exception when insufficient_privilege then null; end;
  raise notice 'NEON SIM PASSED (demo seeded %, isolation, RLS, anonymous blocked)', d->>'sales_total';
end $$;
SQL
