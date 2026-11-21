#!/bin/bash
# Recreate a fresh database and load stub + migrations.
set -e
P="psql -h /tmp/pg -p 5544 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists hx" -c "create database hx"
for f in tests/supabase_stub.sql supabase/migrations/*.sql; do $P -d hx -f "$f"; done
echo loaded
