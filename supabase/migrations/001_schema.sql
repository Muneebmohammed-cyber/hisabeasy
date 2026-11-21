-- HisabEasy · 001 · Schema
-- Target: Supabase (PostgreSQL 15+). All money numeric(14,2), quantities numeric(14,3).
-- Financial tables are append-only from the app's point of view: writes go through
-- security-definer functions (002_functions.sql); cancels create reversals.

-- gen_random_uuid() is built into PostgreSQL 13+.

-- ───────────────────────────── Plans (configurable, not hardcoded) ─────────────
create table if not exists public.plans (
  code        text primary key,
  name        text not null,
  price_inr   numeric(10,2) not null default 0,
  price_aed   numeric(10,2) not null default 0,
  limits      jsonb not null default '{}'::jsonb,   -- {"max_customers":50,"max_products":100,"max_users":1,"features":[...]}
  is_active   boolean not null default true,
  sort_order  int not null default 0
);

insert into public.plans (code, name, price_inr, price_aed, limits, sort_order) values
  ('free', 'Free', 0, 0,
   '{"max_customers":50,"max_products":100,"max_users":1,"features":["sales","expenses","khata_basic","inventory_basic"]}', 1),
  ('pro', 'Pro', 199, 15,
   '{"max_customers":null,"max_products":null,"max_users":2,"features":["sales","expenses","khata","inventory","reminders","reports","exports"]}', 2),
  ('business', 'Business', 499, 39,
   '{"max_customers":null,"max_products":null,"max_users":10,"features":["sales","expenses","khata","inventory","reminders","reports","exports","staff","branches","advanced_reports","priority_support"]}', 3)
on conflict (code) do nothing;

-- ───────────────────────────── Tenancy ────────────────────────────────────────
create table if not exists public.businesses (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 1 and 120),
  category         text not null default 'grocery',
  currency         char(3) not null default 'INR' check (currency in ('INR','AED')),
  language         text not null default 'en' check (language in ('en','ml','hi','ta','kn','ar')),
  timezone         text not null default 'Asia/Kolkata',
  phone            text,
  address          text,
  plan_code        text not null default 'free' references public.plans(code),
  tax_rate         numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  track_inventory  boolean not null default true,
  next_invoice_no  int not null default 1,
  created_by       uuid not null,
  created_at       timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null,
  role         text not null default 'staff' check (role in ('owner','manager','staff')),
  created_at   timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index if not exists business_members_user_idx on public.business_members(user_id);

create table if not exists public.profiles (
  user_id             uuid primary key,
  full_name           text,
  phone               text,
  language            text default 'en',
  active_business_id  uuid references public.businesses(id) on delete set null,
  created_at          timestamptz not null default now()
);

-- ───────────────────────────── Master data ────────────────────────────────────
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 120),
  phone         text check (phone is null or phone ~ '^\+?[0-9 ]{6,20}$'),
  notes         text,
  credit_limit  numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  archived      boolean not null default false,
  client_ref    uuid,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (business_id, client_ref)
);
create index if not exists customers_business_idx on public.customers(business_id, archived);

create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  sku             text,
  barcode         text,
  category        text,
  unit            text not null default 'pcs',
  purchase_price  numeric(14,2) not null default 0 check (purchase_price >= 0),
  selling_price   numeric(14,2) not null default 0 check (selling_price >= 0),
  stock_qty       numeric(14,3) not null default 0,
  min_stock       numeric(14,3) not null default 0 check (min_stock >= 0),
  track_stock     boolean not null default true,
  image_path      text,
  archived        boolean not null default false,
  client_ref      uuid,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (business_id, client_ref)
);
create index if not exists products_business_idx on public.products(business_id, archived);
create unique index if not exists products_barcode_uq on public.products(business_id, barcode) where barcode is not null and archived = false;

-- ───────────────────────────── Sales ──────────────────────────────────────────
create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  invoice_no      int not null,
  customer_id     uuid references public.customers(id),
  sale_date       date not null,
  subtotal        numeric(14,2) not null check (subtotal >= 0),
  discount        numeric(14,2) not null default 0 check (discount >= 0),
  tax_rate        numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  tax_amount      numeric(14,2) not null default 0 check (tax_amount >= 0),
  total           numeric(14,2) not null check (total >= 0),
  paid_amount     numeric(14,2) not null default 0 check (paid_amount >= 0),
  credit_amount   numeric(14,2) not null default 0 check (credit_amount >= 0),
  cost_total      numeric(14,2) not null default 0 check (cost_total >= 0),
  payment_method  text not null check (payment_method in ('cash','upi','bank','card','credit','mixed')),
  due_date        date,
  note            text,
  status          text not null default 'active' check (status in ('active','cancelled')),
  client_ref      uuid not null,
  created_by      uuid,
  created_at      timestamptz not null default clock_timestamp(),
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  cancel_reason   text,
  check (discount <= subtotal),
  check (paid_amount + credit_amount = total),
  check (credit_amount = 0 or customer_id is not null),
  unique (business_id, client_ref),
  unique (business_id, invoice_no)
);
create index if not exists sales_business_date_idx on public.sales(business_id, sale_date desc);
create index if not exists sales_customer_idx on public.sales(customer_id);

create table if not exists public.sale_items (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.sales(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  product_id   uuid references public.products(id),
  name         text not null,
  qty          numeric(14,3) not null check (qty > 0),
  unit         text,
  unit_price   numeric(14,2) not null check (unit_price >= 0),
  unit_cost    numeric(14,2) not null default 0 check (unit_cost >= 0),
  line_total   numeric(14,2) not null check (line_total >= 0)
);
create index if not exists sale_items_sale_idx on public.sale_items(sale_id);
create index if not exists sale_items_product_idx on public.sale_items(product_id);

-- ───────────────────────────── Khata: payments + ledger ───────────────────────
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_id   uuid not null references public.customers(id),
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null check (method in ('cash','upi','bank','card')),
  payment_date  date not null,
  note          text,
  status        text not null default 'active' check (status in ('active','reversed')),
  client_ref    uuid not null,
  created_by    uuid,
  created_at    timestamptz not null default clock_timestamp(),
  reversed_at   timestamptz,
  reversed_by   uuid,
  reverse_reason text,
  unique (business_id, client_ref)
);
create index if not exists payments_business_date_idx on public.payments(business_id, payment_date desc);

-- amount > 0 ⇒ customer owes more; amount < 0 ⇒ owes less.
create table if not exists public.ledger_entries (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_id   uuid not null references public.customers(id),
  entry_type    text not null check (entry_type in ('credit_sale','credit_given','payment','opening_balance','reversal')),
  amount        numeric(14,2) not null check (amount <> 0),
  entry_date    date not null,
  due_date      date,
  sale_id       uuid references public.sales(id),
  payment_id    uuid references public.payments(id),
  reverses_id   uuid references public.ledger_entries(id),
  note          text,
  client_ref    uuid,
  created_by    uuid,
  created_at    timestamptz not null default clock_timestamp(),
  unique (business_id, client_ref)
);
create index if not exists ledger_customer_idx on public.ledger_entries(customer_id, entry_date, created_at);
create unique index if not exists ledger_one_reversal_uq on public.ledger_entries(reverses_id) where reverses_id is not null;

-- ───────────────────────────── Expenses ───────────────────────────────────────
create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  category      text not null check (category in ('rent','electricity','salary','transport','purchases','maintenance','misc')),
  amount        numeric(14,2) not null check (amount > 0),
  expense_date  date not null,
  method        text not null default 'cash' check (method in ('cash','upi','bank','card')),
  note          text,
  bill_path     text,
  status        text not null default 'active' check (status in ('active','cancelled')),
  client_ref    uuid not null,
  created_by    uuid,
  created_at    timestamptz not null default clock_timestamp(),
  cancelled_at  timestamptz,
  cancelled_by  uuid,
  cancel_reason text,
  unique (business_id, client_ref)
);
create index if not exists expenses_business_date_idx on public.expenses(business_id, expense_date desc);

-- ───────────────────────────── Inventory movements ────────────────────────────
create table if not exists public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  qty_change   numeric(14,3) not null check (qty_change <> 0),
  reason       text not null check (reason in ('opening','sale','sale_cancel','stock_in','adjustment','damage')),
  unit_cost    numeric(14,2),
  sale_id      uuid references public.sales(id),
  note         text,
  client_ref   uuid,
  created_by   uuid,
  created_at   timestamptz not null default clock_timestamp(),
  unique (business_id, client_ref)
);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);

-- ───────────────────────────── Audit log ──────────────────────────────────────
create table if not exists public.audit_log (
  id           bigserial primary key,
  business_id  uuid,
  table_name   text not null,
  record_id    uuid,
  action       text not null,
  old_data     jsonb,
  new_data     jsonb,
  actor        uuid,
  at           timestamptz not null default now()
);
create index if not exists audit_business_idx on public.audit_log(business_id, at desc);

create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
begin
  if tg_op = 'DELETE' then
    insert into audit_log(business_id, table_name, record_id, action, old_data, actor)
    values (old.business_id, tg_table_name, old.id, tg_op, to_jsonb(old), v_actor);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into audit_log(business_id, table_name, record_id, action, old_data, new_data, actor)
    values (new.business_id, tg_table_name, new.id, tg_op, to_jsonb(old), to_jsonb(new), v_actor);
    return new;
  else
    insert into audit_log(business_id, table_name, record_id, action, new_data, actor)
    values (new.business_id, tg_table_name, new.id, tg_op, to_jsonb(new), v_actor);
    return new;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sales','payments','ledger_entries','expenses','stock_movements','customers','products'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- Money rows can never be deleted, and their amounts can never change after insert.
create or replace function public.tg_protect_money() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Financial records cannot be deleted; cancel or reverse instead' using errcode = 'P0001';
  end if;
  if tg_table_name in ('ledger_entries','stock_movements','sale_items') then
    raise exception 'Ledger lines are append-only';
  end if;
  -- Only status / cancel fields may change; compare everything else.
  if (to_jsonb(new) - array['status','cancelled_at','cancelled_by','cancel_reason','reversed_at','reversed_by','reverse_reason'])
     is distinct from
     (to_jsonb(old) - array['status','cancelled_at','cancelled_by','cancel_reason','reversed_at','reversed_by','reverse_reason']) then
    raise exception 'Financial records are locked; cancel and re-enter instead';
  end if;
  if old.status <> 'active' then
    raise exception 'A cancelled or reversed record cannot be changed';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sales','sale_items','payments','ledger_entries','expenses','stock_movements'] loop
    execute format('drop trigger if exists protect_%1$s on public.%1$s', t);
    execute format('create trigger protect_%1$s before update or delete on public.%1$s for each row execute function public.tg_protect_money()', t);
  end loop;
end $$;
-- Note: business deletion (on delete cascade) is an admin-only operation; to allow it,
-- disable the protect_* triggers within that admin transaction.

-- ───────────────────────────── Row-level security ─────────────────────────────
create or replace function public.is_member(p_business uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from business_members m where m.business_id = p_business and m.user_id = auth.uid());
$$;

alter table public.plans enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.expenses enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_log enable row level security;

-- Read-only policies (useful for realtime / future direct reads). No write policies exist:
-- every write goes through the functions in 002.
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated using (is_active);
drop policy if exists businesses_read on public.businesses;
create policy businesses_read on public.businesses for select to authenticated using (is_member(id));
drop policy if exists members_read on public.business_members;
create policy members_read on public.business_members for select to authenticated using (is_member(business_id));
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['customers','products','sales','sale_items','payments','ledger_entries','expenses','stock_movements'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.is_member(business_id))', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.audit_log from authenticated;
