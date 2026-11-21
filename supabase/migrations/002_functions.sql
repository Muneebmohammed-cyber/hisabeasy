-- HisabEasy · 002 · API functions (called via Supabase RPC)
-- Every function: checks the caller, checks membership/role, validates input,
-- writes everything in one transaction, returns jsonb.
-- Error codes: HE001 not signed in · HE002 not a member · HE003 role · HE010 validation
--              HE020 not found · HE030 plan limit · HE040 state (already cancelled etc.)

-- ───────────────────────────── helpers ────────────────────────────────────────
create or replace function public._uid() returns uuid
language plpgsql stable as $$
declare v uuid := public.current_user_id();
begin
  if v is null then raise exception 'Please sign in' using errcode = 'HE001'; end if;
  return v;
end $$;

create or replace function public._fail(p_code text, p_msg text) returns void
language plpgsql as $$
begin
  raise exception '%', p_msg using errcode = p_code;
end $$;

create or replace function public.require_member(p_business uuid, p_roles text[] default null) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text;
begin
  select role into v_role from business_members where business_id = p_business and user_id = _uid();
  if v_role is null then perform _fail('HE002', 'You do not have access to this business'); end if;
  if p_roles is not null and not (v_role = any(p_roles)) then
    perform _fail('HE003', 'Only the owner or a manager can do this');
  end if;
  return v_role;
end $$;

create or replace function public._money(p_value numeric, p_label text, p_allow_zero boolean default true) returns numeric
language plpgsql immutable as $$
begin
  if p_value is null then perform _fail('HE010', p_label || ' is required'); end if;
  if p_value < 0 then perform _fail('HE010', p_label || ' cannot be negative'); end if;
  if not p_allow_zero and p_value = 0 then perform _fail('HE010', p_label || ' must be more than zero'); end if;
  if p_value <> round(p_value, 2) then perform _fail('HE010', p_label || ' can have at most 2 decimals'); end if;
  if p_value >= 1e12 then perform _fail('HE010', p_label || ' is too large'); end if;
  return p_value;
end $$;

create or replace function public._today(p_business uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce((select timezone from businesses where id = p_business), 'Asia/Kolkata'))::date;
$$;

create or replace function public._check_date(p_business uuid, p_date date, p_label text) returns date
language plpgsql stable as $$
declare v_today date := _today(p_business);
begin
  if p_date is null then return v_today; end if;
  if p_date > v_today + 1 then perform _fail('HE010', p_label || ' cannot be in the future'); end if;
  if p_date < v_today - 3650 then perform _fail('HE010', p_label || ' is too far in the past'); end if;
  return p_date;
end $$;

create or replace function public._customer_balance(p_customer uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0)::numeric(14,2) from ledger_entries where customer_id = p_customer;
$$;

create or replace function public._plan_limit(p_business uuid, p_key text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select (p.limits ->> p_key)::int from businesses b join plans p on p.code = b.plan_code where b.id = p_business;
$$;

-- Earliest due date that is still unpaid (payments settle the oldest credit first).
create or replace function public._customer_overdue_since(p_customer uuid, p_today date) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  with neg as (select coalesce(-sum(amount), 0) as paid from ledger_entries where customer_id = p_customer and amount < 0),
  pos as (
    select due_date, sum(amount) over (order by entry_date, created_at, id) as cum
    from ledger_entries where customer_id = p_customer and amount > 0
  )
  select min(pos.due_date) from pos, neg
  where pos.cum > neg.paid and pos.due_date is not null and pos.due_date < p_today;
$$;

-- ───────────────────────────── onboarding ─────────────────────────────────────
create or replace function public.create_business(
  p_name text, p_category text default 'grocery', p_currency text default 'INR',
  p_language text default 'en', p_with_demo boolean default false, p_owner_name text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_id uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then perform _fail('HE010', 'Business name is required'); end if;
  if p_currency not in ('INR','AED') then perform _fail('HE010', 'Currency must be INR or AED'); end if;
  insert into businesses(name, category, currency, language, timezone, created_by)
  values (trim(p_name), coalesce(p_category, 'grocery'), p_currency, coalesce(p_language, 'en'),
          case when p_currency = 'AED' then 'Asia/Dubai' else 'Asia/Kolkata' end, v_uid)
  returning id into v_id;
  insert into business_members(business_id, user_id, role) values (v_id, v_uid, 'owner');
  insert into profiles(user_id, full_name, language, active_business_id)
  values (v_uid, p_owner_name, coalesce(p_language, 'en'), v_id)
  on conflict (user_id) do update set active_business_id = excluded.active_business_id,
    language = excluded.language, full_name = coalesce(excluded.full_name, profiles.full_name);
  if p_with_demo then perform seed_demo(v_id); end if;
  return (select to_jsonb(b) from businesses b where id = v_id);
end $$;

create or replace function public.my_businesses() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object('role', m.role,
           'is_active', b.id = (select active_business_id from profiles where user_id = public.current_user_id()))
         order by b.created_at), '[]'::jsonb)
  from business_members m join businesses b on b.id = m.business_id
  where m.user_id = public.current_user_id();
$$;

create or replace function public.update_business(p_business uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_member(p_business, array['owner']);
  update businesses set
    name            = coalesce(nullif(trim(p_patch->>'name'), ''), name),
    category        = coalesce(p_patch->>'category', category),
    currency        = coalesce(p_patch->>'currency', currency),
    language        = coalesce(p_patch->>'language', language),
    phone           = case when p_patch ? 'phone' then nullif(p_patch->>'phone','') else phone end,
    address         = case when p_patch ? 'address' then nullif(p_patch->>'address','') else address end,
    tax_rate        = coalesce((p_patch->>'tax_rate')::numeric, tax_rate),
    track_inventory = coalesce((p_patch->>'track_inventory')::boolean, track_inventory),
    timezone        = coalesce(p_patch->>'timezone', timezone)
  where id = p_business;
  return (select to_jsonb(b) from businesses b where id = p_business);
end $$;

create or replace function public.set_active_business(p_business uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_member(p_business);
  insert into profiles(user_id, active_business_id) values (_uid(), p_business)
  on conflict (user_id) do update set active_business_id = excluded.active_business_id;
end $$;

create or replace function public.plan_usage(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_member(p_business);
  return (
    select jsonb_build_object(
      'plan', to_jsonb(p),
      'customers', (select count(*) from customers where business_id = p_business and not archived),
      'products',  (select count(*) from products  where business_id = p_business and not archived),
      'users',     (select count(*) from business_members where business_id = p_business))
    from businesses b join plans p on p.code = b.plan_code where b.id = p_business);
end $$;

-- ───────────────────────────── customers (Khata) ──────────────────────────────
create or replace function public.upsert_customer(
  p_business uuid, p_id uuid default null, p_name text default null, p_phone text default null,
  p_notes text default null, p_credit_limit numeric default null, p_opening_balance numeric default 0,
  p_archived boolean default null, p_client_ref uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_id uuid; v_limit int; v_phone text;
begin
  perform require_member(p_business);
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  if p_id is null then
    if p_client_ref is not null then
      select id into v_id from customers where business_id = p_business and client_ref = p_client_ref;
      if v_id is not null then return get_customer(p_business, v_id); end if;
    end if;
    if p_name is null or length(trim(p_name)) = 0 then perform _fail('HE010', 'Customer name is required'); end if;
    v_limit := _plan_limit(p_business, 'max_customers');
    if v_limit is not null and (select count(*) from customers where business_id = p_business and not archived) >= v_limit then
      perform _fail('HE030', 'Your plan allows ' || v_limit || ' customers. Upgrade to add more.');
    end if;
    perform _money(coalesce(p_opening_balance, 0), 'Opening balance');
    insert into customers(business_id, name, phone, notes, credit_limit, client_ref, created_by)
    values (p_business, trim(p_name), v_phone, p_notes, p_credit_limit, p_client_ref, v_uid)
    returning id into v_id;
    if coalesce(p_opening_balance, 0) > 0 then
      insert into ledger_entries(business_id, customer_id, entry_type, amount, entry_date, note, created_by)
      values (p_business, v_id, 'opening_balance', p_opening_balance, _today(p_business), 'Opening balance', v_uid);
    end if;
  else
    select id into v_id from customers where id = p_id and business_id = p_business;
    if v_id is null then perform _fail('HE020', 'Customer not found'); end if;
    if p_archived and _customer_balance(v_id) <> 0 then
      perform _fail('HE040', 'Settle the balance before archiving this customer');
    end if;
    update customers set
      name = coalesce(nullif(trim(p_name), ''), name),
      phone = case when p_phone is not null then v_phone else phone end,
      notes = coalesce(p_notes, notes),
      credit_limit = case when p_credit_limit is not null then nullif(p_credit_limit, 0) else credit_limit end,
      archived = coalesce(p_archived, archived)
    where id = v_id;
  end if;
  return get_customer(p_business, v_id);
end $$;

create or replace function public.get_customer(p_business uuid, p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_today date;
begin
  perform require_member(p_business);
  v_today := _today(p_business);
  select to_jsonb(c) || jsonb_build_object(
    'balance', _customer_balance(c.id),
    'total_purchases', coalesce((select sum(total) from sales s where s.customer_id = c.id and s.status = 'active'), 0)
                     + coalesce((select sum(amount) from ledger_entries l where l.customer_id = c.id and l.entry_type in ('credit_given','opening_balance')
                                 and not exists (select 1 from ledger_entries r where r.reverses_id = l.id)), 0),
    'total_payments', coalesce((select sum(amount) from payments p where p.customer_id = c.id and p.status = 'active'), 0)
                    + coalesce((select sum(paid_amount) from sales s where s.customer_id = c.id and s.status = 'active'), 0),
    'last_activity', greatest(
        (select max(entry_date) from ledger_entries l where l.customer_id = c.id),
        (select max(sale_date) from sales s where s.customer_id = c.id)),
    'next_due', (select min(due_date) from ledger_entries l where l.customer_id = c.id and l.amount > 0 and l.due_date >= v_today),
    'overdue_since', _customer_overdue_since(c.id, v_today))
  into v from customers c where c.id = p_customer and c.business_id = p_business;
  if v is null then perform _fail('HE020', 'Customer not found'); end if;
  return v;
end $$;

create or replace function public.list_customers(p_business uuid, p_search text default null, p_filter text default 'all') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date;
begin
  perform require_member(p_business);
  v_today := _today(p_business);
  return coalesce((
    select jsonb_agg(x order by (x->>'balance')::numeric desc, x->>'name')
    from (
      select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone,
               'balance', _customer_balance(c.id),
               'overdue_since', _customer_overdue_since(c.id, v_today),
               'last_activity', (select max(entry_date) from ledger_entries l where l.customer_id = c.id)) as x
      from customers c
      where c.business_id = p_business and not c.archived
        and (p_search is null or c.name ilike '%' || p_search || '%' or c.phone like '%' || p_search || '%')
    ) t
    where p_filter = 'all'
       or (p_filter = 'due' and (x->>'balance')::numeric > 0)
       or (p_filter = 'overdue' and x->>'overdue_since' is not null)
  ), '[]'::jsonb);
end $$;

create or replace function public.customer_ledger(p_business uuid, p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_member(p_business);
  if not exists (select 1 from customers where id = p_customer and business_id = p_business) then
    perform _fail('HE020', 'Customer not found');
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(t) - 'k1' - 'k2' order by k1, k2, id) from (
      select l.id, l.entry_type, l.amount, l.entry_date, l.due_date, l.note, l.sale_id, l.payment_id,
             s.invoice_no, p.method,
             exists (select 1 from ledger_entries r where r.reverses_id = l.id) as reversed,
             sum(l.amount) over (order by l.entry_date, l.created_at, l.id) as running_balance,
             l.entry_date as k1, l.created_at as k2
      from ledger_entries l
      left join sales s on s.id = l.sale_id
      left join payments p on p.id = l.payment_id
      where l.customer_id = p_customer
    ) t
  ), '[]'::jsonb);
end $$;

create or replace function public.add_credit(
  p_business uuid, p_client_ref uuid, p_customer uuid, p_amount numeric,
  p_date date default null, p_due_date date default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_id uuid; v_limit numeric; v_date date;
begin
  perform require_member(p_business);
  if p_client_ref is null then perform _fail('HE010', 'client_ref is required'); end if;
  perform pg_advisory_xact_lock(hashtext(p_client_ref::text));
  select id into v_id from ledger_entries where business_id = p_business and client_ref = p_client_ref;
  if v_id is not null then return (select to_jsonb(l) from ledger_entries l where id = v_id); end if;
  perform _money(p_amount, 'Amount', false);
  select credit_limit into v_limit from customers where id = p_customer and business_id = p_business and not archived;
  if not found then perform _fail('HE020', 'Customer not found'); end if;
  if v_limit is not null and _customer_balance(p_customer) + p_amount > v_limit then
    perform _fail('HE040', 'This would cross the customer''s credit limit');
  end if;
  v_date := _check_date(p_business, p_date, 'Date');
  if p_due_date is not null and p_due_date < v_date then perform _fail('HE010', 'Due date cannot be before the credit date'); end if;
  insert into ledger_entries(business_id, customer_id, entry_type, amount, entry_date, due_date, note, client_ref, created_by)
  values (p_business, p_customer, 'credit_given', p_amount, v_date, p_due_date, p_note, p_client_ref, v_uid)
  returning id into v_id;
  return (select to_jsonb(l) from ledger_entries l where id = v_id);
end $$;

create or replace function public.record_payment(
  p_business uuid, p_client_ref uuid, p_customer uuid, p_amount numeric,
  p_method text default 'cash', p_date date default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_id uuid; v_date date;
begin
  perform require_member(p_business);
  if p_client_ref is null then perform _fail('HE010', 'client_ref is required'); end if;
  perform pg_advisory_xact_lock(hashtext(p_client_ref::text));
  select id into v_id from payments where business_id = p_business and client_ref = p_client_ref;
  if v_id is not null then return (select to_jsonb(p) from payments p where id = v_id); end if;
  perform _money(p_amount, 'Amount', false);
  if p_method not in ('cash','upi','bank','card') then perform _fail('HE010', 'Choose a payment method'); end if;
  if not exists (select 1 from customers where id = p_customer and business_id = p_business) then
    perform _fail('HE020', 'Customer not found');
  end if;
  v_date := _check_date(p_business, p_date, 'Payment date');
  insert into payments(business_id, customer_id, amount, method, payment_date, note, client_ref, created_by)
  values (p_business, p_customer, p_amount, p_method, v_date, p_note, p_client_ref, v_uid)
  returning id into v_id;
  insert into ledger_entries(business_id, customer_id, entry_type, amount, entry_date, payment_id, note, created_by)
  values (p_business, p_customer, 'payment', -p_amount, v_date, v_id, p_note, v_uid);
  return (select to_jsonb(p) || jsonb_build_object('balance', _customer_balance(p_customer)) from payments p where id = v_id);
end $$;

create or replace function public.reverse_payment(p_business uuid, p_payment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_pay payments; v_entry uuid;
begin
  perform require_member(p_business, array['owner','manager']);
  if p_reason is null or length(trim(p_reason)) < 3 then perform _fail('HE010', 'Give a reason (at least 3 letters)'); end if;
  select * into v_pay from payments where id = p_payment and business_id = p_business for update;
  if not found then perform _fail('HE020', 'Payment not found'); end if;
  if v_pay.status <> 'active' then perform _fail('HE040', 'This payment is already reversed'); end if;
  update payments set status = 'reversed', reversed_at = now(), reversed_by = v_uid, reverse_reason = trim(p_reason) where id = p_payment;
  select id into v_entry from ledger_entries where payment_id = p_payment and entry_type = 'payment';
  insert into ledger_entries(business_id, customer_id, entry_type, amount, entry_date, payment_id, reverses_id, note, created_by)
  values (p_business, v_pay.customer_id, 'reversal', v_pay.amount, _today(p_business), p_payment, v_entry, 'Payment reversed: ' || trim(p_reason), v_uid);
  return (select to_jsonb(p) from payments p where id = p_payment);
end $$;

-- Reverse a manual credit or opening balance entered by mistake.
create or replace function public.reverse_ledger_entry(p_business uuid, p_entry uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_l ledger_entries; v_id uuid;
begin
  perform require_member(p_business, array['owner','manager']);
  if p_reason is null or length(trim(p_reason)) < 3 then perform _fail('HE010', 'Give a reason (at least 3 letters)'); end if;
  select * into v_l from ledger_entries where id = p_entry and business_id = p_business for update;
  if not found then perform _fail('HE020', 'Entry not found'); end if;
  if v_l.entry_type not in ('credit_given','opening_balance') then
    perform _fail('HE040', 'Cancel the bill or reverse the payment instead');
  end if;
  if exists (select 1 from ledger_entries where reverses_id = p_entry) then perform _fail('HE040', 'Already reversed'); end if;
  insert into ledger_entries(business_id, customer_id, entry_type, amount, entry_date, reverses_id, note, created_by)
  values (p_business, v_l.customer_id, 'reversal', -v_l.amount, _today(p_business), p_entry, 'Credit reversed: ' || trim(p_reason), v_uid)
  returning id into v_id;
  return (select to_jsonb(l) from ledger_entries l where id = v_id);
end $$;

-- ───────────────────────────── products / inventory ───────────────────────────
create or replace function public._product_json(p products) returns jsonb
language sql stable as $$
  select to_jsonb(p) || jsonb_build_object(
    'stock_status', case when not p.track_stock then 'untracked'
                         when p.stock_qty <= 0 then 'out'
                         when p.stock_qty <= p.min_stock then 'low' else 'ok' end,
    'stock_value', round(greatest(p.stock_qty, 0) * p.purchase_price, 2));
$$;

create or replace function public.upsert_product(
  p_business uuid, p_id uuid default null, p_name text default null, p_sku text default null,
  p_barcode text default null, p_category text default null, p_unit text default null,
  p_purchase_price numeric default null, p_selling_price numeric default null,
  p_opening_stock numeric default 0, p_min_stock numeric default null, p_track_stock boolean default null,
  p_archived boolean default null, p_client_ref uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_id uuid; v_limit int; v_p products;
begin
  perform require_member(p_business);
  if p_purchase_price is not null then perform _money(p_purchase_price, 'Purchase price'); end if;
  if p_selling_price is not null then perform _money(p_selling_price, 'Selling price'); end if;
  if p_min_stock is not null and p_min_stock < 0 then perform _fail('HE010', 'Minimum stock cannot be negative'); end if;
  if p_id is null then
    if p_client_ref is not null then
      select * into v_p from products where business_id = p_business and client_ref = p_client_ref;
      if found then return _product_json(v_p); end if;
    end if;
    if p_name is null or length(trim(p_name)) = 0 then perform _fail('HE010', 'Product name is required'); end if;
    v_limit := _plan_limit(p_business, 'max_products');
    if v_limit is not null and (select count(*) from products where business_id = p_business and not archived) >= v_limit then
      perform _fail('HE030', 'Your plan allows ' || v_limit || ' products. Upgrade to add more.');
    end if;
    if coalesce(p_opening_stock, 0) < 0 then perform _fail('HE010', 'Opening stock cannot be negative'); end if;
    insert into products(business_id, name, sku, barcode, category, unit, purchase_price, selling_price,
                         stock_qty, min_stock, track_stock, client_ref, created_by)
    values (p_business, trim(p_name), nullif(p_sku,''), nullif(p_barcode,''), nullif(p_category,''), coalesce(nullif(p_unit,''), 'pcs'),
            coalesce(p_purchase_price, 0), coalesce(p_selling_price, 0), coalesce(p_opening_stock, 0),
            coalesce(p_min_stock, 0), coalesce(p_track_stock, true), p_client_ref, v_uid)
    returning id into v_id;
    if coalesce(p_opening_stock, 0) > 0 then
      insert into stock_movements(business_id, product_id, qty_change, reason, unit_cost, note, created_by)
      values (p_business, v_id, p_opening_stock, 'opening', coalesce(p_purchase_price, 0), 'Opening stock', v_uid);
    end if;
  else
    select id into v_id from products where id = p_id and business_id = p_business;
    if v_id is null then perform _fail('HE020', 'Product not found'); end if;
    -- stock_qty is never edited here: use adjust_stock so there is a movement row.
    update products set
      name = coalesce(nullif(trim(p_name), ''), name),
      sku = case when p_sku is not null then nullif(p_sku,'') else sku end,
      barcode = case when p_barcode is not null then nullif(p_barcode,'') else barcode end,
      category = case when p_category is not null then nullif(p_category,'') else category end,
      unit = coalesce(nullif(p_unit,''), unit),
      purchase_price = coalesce(p_purchase_price, purchase_price),
      selling_price = coalesce(p_selling_price, selling_price),
      min_stock = coalesce(p_min_stock, min_stock),
      track_stock = coalesce(p_track_stock, track_stock),
      archived = coalesce(p_archived, archived)
    where id = v_id;
  end if;
  select * into v_p from products where id = v_id;
  return _product_json(v_p);
end $$;

create or replace function public.list_products(p_business uuid, p_search text default null, p_filter text default 'all') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_member(p_business);
  return coalesce((
    select jsonb_agg(_product_json(p) order by p.name)
    from products p
    where p.business_id = p_business and not p.archived
      and (p_search is null or p.name ilike '%' || p_search || '%' or p.sku ilike p_search || '%' or p.barcode = p_search)
      and (p_filter = 'all'
           or (p_filter = 'low' and p.track_stock and p.stock_qty <= p.min_stock)
           or (p_filter = 'out' and p.track_stock and p.stock_qty <= 0))
  ), '[]'::jsonb);
end $$;

create or replace function public.adjust_stock(
  p_business uuid, p_client_ref uuid, p_product uuid, p_qty_change numeric,
  p_reason text default 'stock_in', p_unit_cost numeric default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_p products;
begin
  perform require_member(p_business);
  if p_client_ref is null then perform _fail('HE010', 'client_ref is required'); end if;
  perform pg_advisory_xact_lock(hashtext(p_client_ref::text));
  if exists (select 1 from stock_movements where business_id = p_business and client_ref = p_client_ref) then
    select * into v_p from products where id = p_product; return _product_json(v_p);
  end if;
  if p_reason not in ('stock_in','adjustment','damage') then perform _fail('HE010', 'Unknown stock reason'); end if;
  if p_qty_change is null or p_qty_change = 0 then perform _fail('HE010', 'Quantity is required'); end if;
  if p_qty_change <> round(p_qty_change, 3) then perform _fail('HE010', 'Quantity can have at most 3 decimals'); end if;
  if p_reason = 'stock_in' and p_qty_change < 0 then perform _fail('HE010', 'Stock in must be a positive quantity'); end if;
  if p_reason = 'damage' and p_qty_change > 0 then perform _fail('HE010', 'Damage must reduce stock'); end if;
  if p_unit_cost is not null then perform _money(p_unit_cost, 'Cost'); end if;
  select * into v_p from products where id = p_product and business_id = p_business for update;
  if not found then perform _fail('HE020', 'Product not found'); end if;
  insert into stock_movements(business_id, product_id, qty_change, reason, unit_cost, note, client_ref, created_by)
  values (p_business, p_product, p_qty_change, p_reason, coalesce(p_unit_cost, v_p.purchase_price), p_note, p_client_ref, v_uid);
  update products set stock_qty = stock_qty + p_qty_change,
                      purchase_price = case when p_reason = 'stock_in' and p_unit_cost is not null then p_unit_cost else purchase_price end
  where id = p_product returning * into v_p;
  return _product_json(v_p);
end $$;

create or replace function public.stock_history(p_business uuid, p_product uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_member(p_business);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'qty_change', m.qty_change, 'reason', m.reason,
             'unit_cost', m.unit_cost, 'note', m.note, 'created_at', m.created_at,
             'invoice_no', s.invoice_no, 'sale_id', m.sale_id) order by m.created_at desc)
    from stock_movements m left join sales s on s.id = m.sale_id
    where m.product_id = p_product and m.business_id = p_business
  ), '[]'::jsonb);
end $$;

-- ───────────────────────────── sales ──────────────────────────────────────────
-- p_items: [{"product_id": uuid?, "name": text?, "qty": n, "unit_price": n?}]
create or replace function public.record_sale(
  p_business uuid, p_client_ref uuid, p_items jsonb, p_customer uuid default null,
  p_discount numeric default 0, p_tax_rate numeric default null, p_paid numeric default null,
  p_method text default 'cash', p_sale_date date default null, p_due_date date default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := _uid(); v_biz businesses; v_sale_id uuid; v_no int; v_item jsonb; v_p products;
  v_qty numeric; v_price numeric; v_cost numeric; v_name text; v_unit text; v_line numeric;
  v_subtotal numeric := 0; v_cost_total numeric := 0; v_discount numeric; v_tax_rate numeric;
  v_tax numeric; v_total numeric; v_paid numeric; v_credit numeric; v_method text; v_date date;
  v_limit numeric;
  v_lines jsonb := '[]'::jsonb;
begin
  perform require_member(p_business);
  if p_client_ref is null then perform _fail('HE010', 'client_ref is required'); end if;
  perform pg_advisory_xact_lock(hashtext(p_client_ref::text));
  select id into v_sale_id from sales where business_id = p_business and client_ref = p_client_ref;
  if v_sale_id is not null then return get_sale(p_business, v_sale_id) || '{"duplicate":true}'; end if;

  select * into v_biz from businesses where id = p_business;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform _fail('HE010', 'Add at least one item or an amount');
  end if;
  if jsonb_array_length(p_items) > 200 then perform _fail('HE010', 'Too many items in one bill'); end if;
  if p_customer is not null and not exists (select 1 from customers where id = p_customer and business_id = p_business and not archived) then
    perform _fail('HE020', 'Customer not found');
  end if;

  -- 1. price every line on the server
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then perform _fail('HE010', 'Quantity must be more than zero'); end if;
    if v_qty <> round(v_qty, 3) then perform _fail('HE010', 'Quantity can have at most 3 decimals'); end if;
    if v_item ? 'product_id' and nullif(v_item->>'product_id','') is not null then
      select * into v_p from products where id = (v_item->>'product_id')::uuid and business_id = p_business;
      if not found then perform _fail('HE020', 'Product not found'); end if;
      v_name := v_p.name; v_unit := v_p.unit; v_cost := v_p.purchase_price;
      v_price := coalesce((v_item->>'unit_price')::numeric, v_p.selling_price);
    else
      v_p := null;
      v_name := coalesce(nullif(trim(v_item->>'name'), ''), 'Item'); v_unit := null; v_cost := 0;
      v_price := (v_item->>'unit_price')::numeric;
    end if;
    perform _money(v_price, 'Price');
    v_line := round(v_qty * v_price, 2);
    v_subtotal := v_subtotal + v_line;
    v_cost_total := v_cost_total + round(v_qty * v_cost, 2);
    v_lines := v_lines || jsonb_build_object('product_id', v_p.id, 'name', v_name, 'unit', v_unit, 'qty', v_qty,
                                             'unit_price', v_price, 'unit_cost', v_cost, 'line_total', v_line,
                                             'track', v_p.id is not null and v_p.track_stock and v_biz.track_inventory);
  end loop;

  -- 2. totals
  v_discount := _money(coalesce(p_discount, 0), 'Discount');
  if v_discount > v_subtotal then perform _fail('HE010', 'Discount cannot be more than the bill'); end if;
  v_tax_rate := coalesce(p_tax_rate, v_biz.tax_rate);
  if v_tax_rate < 0 or v_tax_rate > 100 then perform _fail('HE010', 'Tax rate must be 0–100%'); end if;
  v_tax := round((v_subtotal - v_discount) * v_tax_rate / 100, 2);
  v_total := v_subtotal - v_discount + v_tax;
  if v_total = 0 then perform _fail('HE010', 'Bill total is zero'); end if;

  if p_method not in ('cash','upi','bank','card','credit') then perform _fail('HE010', 'Choose a payment method'); end if;
  v_paid := case when p_paid is not null then _money(p_paid, 'Paid amount')
                 when p_method = 'credit' then 0 else v_total end;
  if v_paid > v_total then perform _fail('HE010', 'Paid amount is more than the bill total'); end if;
  v_credit := v_total - v_paid;
  if v_credit > 0 and p_customer is null then perform _fail('HE010', 'Choose a customer for a credit (udhar) sale'); end if;
  v_method := case when v_paid = 0 then 'credit' when p_method = 'credit' then 'cash' else p_method end;
  if v_credit > 0 then
    select credit_limit into v_limit from customers where id = p_customer;
    if v_limit is not null and _customer_balance(p_customer) + v_credit > v_limit then
      perform _fail('HE040', 'This would cross the customer''s credit limit');
    end if;
  end if;
  v_date := _check_date(p_business, p_sale_date, 'Sale date');
  if p_due_date is not null and p_due_date < v_date then perform _fail('HE010', 'Due date cannot be before the sale date'); end if;

  -- 3. write: invoice number under row lock, sale, lines, stock, ledger
  update businesses set next_invoice_no = next_invoice_no + 1 where id = p_business returning next_invoice_no - 1 into v_no;
  insert into sales(business_id, invoice_no, customer_id, sale_date, subtotal, discount, tax_rate, tax_amount, total,
                    paid_amount, credit_amount, cost_total, payment_method, due_date, note, client_ref, created_by)
  values (p_business, v_no, p_customer, v_date, v_subtotal, v_discount, v_tax_rate, v_tax, v_total,
          v_paid, v_credit, v_cost_total, v_method, case when v_credit > 0 then p_due_date end, p_note, p_client_ref, v_uid)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(v_lines) loop
    insert into sale_items(sale_id, business_id, product_id, name, qty, unit, unit_price, unit_cost, line_total)
    values (v_sale_id, p_business, nullif(v_item->>'product_id','')::uuid, v_item->>'name', (v_item->>'qty')::numeric,
            v_item->>'unit', (v_item->>'unit_price')::numeric, (v_item->>'unit_cost')::numeric, (v_item->>'line_total')::numeric);
    if (v_item->>'track')::boolean then
      update products set stock_qty = stock_qty - (v_item->>'qty')::numeric where id = (v_item->>'product_id')::uuid;
      insert into stock_movements(business_id, product_id, qty_change, reason, unit_cost, sale_id, created_by)
      values (p_business, (v_item->>'product_id')::uuid, -(v_item->>'qty')::numeric, 'sale', (v_item->>'unit_cost')::numeric, v_sale_id, v_uid);
    end if;
  end loop;

  if v_credit > 0 then
    insert into ledger_entries(business_id, customer_id, entry_type, amount, entry_date, due_date, sale_id, note, created_by)
    values (p_business, p_customer, 'credit_sale', v_credit, v_date, p_due_date, v_sale_id, 'Bill #' || v_no, v_uid);
  end if;

  return get_sale(p_business, v_sale_id);
end $$;

create or replace function public.get_sale(p_business uuid, p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  perform require_member(p_business);
  select to_jsonb(s) || jsonb_build_object(
    'customer_name', c.name, 'customer_phone', c.phone,
    'customer_balance', case when c.id is not null then _customer_balance(c.id) end,
    'business', jsonb_build_object('name', b.name, 'phone', b.phone, 'address', b.address, 'currency', b.currency),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.name) from sale_items i where i.sale_id = s.id), '[]'::jsonb))
  into v
  from sales s join businesses b on b.id = s.business_id left join customers c on c.id = s.customer_id
  where s.id = p_sale and s.business_id = p_business;
  if v is null then perform _fail('HE020', 'Bill not found'); end if;
  return v;
end $$;

create or replace function public.list_sales(
  p_business uuid, p_from date default null, p_to date default null,
  p_customer uuid default null, p_limit int default 100
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_member(p_business);
  return coalesce((
    select jsonb_agg(x order by (x->>'sale_date') desc, (x->>'invoice_no')::int desc) from (
      select jsonb_build_object('id', s.id, 'invoice_no', s.invoice_no, 'sale_date', s.sale_date, 'total', s.total,
               'paid_amount', s.paid_amount, 'credit_amount', s.credit_amount, 'payment_method', s.payment_method,
               'status', s.status, 'customer_name', c.name, 'created_at', s.created_at,
               'item_count', (select count(*) from sale_items i where i.sale_id = s.id)) as x
      from sales s left join customers c on c.id = s.customer_id
      where s.business_id = p_business
        and (p_from is null or s.sale_date >= p_from) and (p_to is null or s.sale_date <= p_to)
        and (p_customer is null or s.customer_id = p_customer)
      order by s.sale_date desc, s.invoice_no desc
      limit least(coalesce(p_limit, 100), 500)
    ) t
  ), '[]'::jsonb);
end $$;

create or replace function public.cancel_sale(p_business uuid, p_sale uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_s sales; v_m stock_movements; v_entry ledger_entries;
begin
  perform require_member(p_business, array['owner','manager']);
  if p_reason is null or length(trim(p_reason)) < 3 then perform _fail('HE010', 'Give a reason (at least 3 letters)'); end if;
  select * into v_s from sales where id = p_sale and business_id = p_business for update;
  if not found then perform _fail('HE020', 'Bill not found'); end if;
  if v_s.status <> 'active' then perform _fail('HE040', 'This bill is already cancelled'); end if;

  update sales set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = trim(p_reason) where id = p_sale;

  for v_m in select * from stock_movements where sale_id = p_sale and reason = 'sale' loop
    update products set stock_qty = stock_qty - v_m.qty_change where id = v_m.product_id;
    insert into stock_movements(business_id, product_id, qty_change, reason, unit_cost, sale_id, note, created_by)
    values (p_business, v_m.product_id, -v_m.qty_change, 'sale_cancel', v_m.unit_cost, p_sale, 'Bill #' || v_s.invoice_no || ' cancelled', v_uid);
  end loop;

  select * into v_entry from ledger_entries where sale_id = p_sale and entry_type = 'credit_sale';
  if found then
    insert into ledger_entries(business_id, customer_id, entry_type, amount, entry_date, sale_id, reverses_id, note, created_by)
    values (p_business, v_entry.customer_id, 'reversal', -v_entry.amount, _today(p_business), p_sale, v_entry.id,
            'Bill #' || v_s.invoice_no || ' cancelled: ' || trim(p_reason), v_uid);
  end if;
  return get_sale(p_business, p_sale);
end $$;

-- ───────────────────────────── expenses ───────────────────────────────────────
create or replace function public.record_expense(
  p_business uuid, p_client_ref uuid, p_category text, p_amount numeric,
  p_date date default null, p_method text default 'cash', p_note text default null, p_bill_path text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_id uuid;
begin
  perform require_member(p_business);
  if p_client_ref is null then perform _fail('HE010', 'client_ref is required'); end if;
  perform pg_advisory_xact_lock(hashtext(p_client_ref::text));
  select id into v_id from expenses where business_id = p_business and client_ref = p_client_ref;
  if v_id is not null then return (select to_jsonb(e) from expenses e where id = v_id); end if;
  perform _money(p_amount, 'Amount', false);
  if p_category not in ('rent','electricity','salary','transport','purchases','maintenance','misc') then
    perform _fail('HE010', 'Choose a category');
  end if;
  if p_method not in ('cash','upi','bank','card') then perform _fail('HE010', 'Choose a payment method'); end if;
  insert into expenses(business_id, category, amount, expense_date, method, note, bill_path, client_ref, created_by)
  values (p_business, p_category, p_amount, _check_date(p_business, p_date, 'Expense date'), p_method, p_note, p_bill_path, p_client_ref, v_uid)
  returning id into v_id;
  return (select to_jsonb(e) from expenses e where id = v_id);
end $$;

create or replace function public.cancel_expense(p_business uuid, p_expense uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := _uid(); v_status text;
begin
  perform require_member(p_business, array['owner','manager']);
  if p_reason is null or length(trim(p_reason)) < 3 then perform _fail('HE010', 'Give a reason (at least 3 letters)'); end if;
  select status into v_status from expenses where id = p_expense and business_id = p_business for update;
  if v_status is null then perform _fail('HE020', 'Expense not found'); end if;
  if v_status <> 'active' then perform _fail('HE040', 'Already cancelled'); end if;
  update expenses set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = trim(p_reason) where id = p_expense;
  return (select to_jsonb(e) from expenses e where id = p_expense);
end $$;

create or replace function public.list_expenses(p_business uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_member(p_business);
  return coalesce((
    select jsonb_agg(to_jsonb(e) order by e.expense_date desc, e.created_at desc)
    from expenses e
    where e.business_id = p_business
      and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
  ), '[]'::jsonb);
end $$;

-- ───────────────────────────── dashboard ──────────────────────────────────────
create or replace function public.dashboard_summary(p_business uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date; v_sales record; v_exp numeric; v_opex numeric; v_pay numeric; v_credit_given numeric;
  v_gross numeric;
begin
  perform require_member(p_business);
  v_day := coalesce(p_date, _today(p_business));

  select coalesce(sum(total),0) as total, count(*) as cnt, coalesce(sum(tax_amount),0) as tax,
         coalesce(sum(cost_total),0) as cost, coalesce(sum(paid_amount),0) as paid, coalesce(sum(credit_amount),0) as credit
  into v_sales from sales where business_id = p_business and sale_date = v_day and status = 'active';

  select coalesce(sum(amount),0), coalesce(sum(amount) filter (where category <> 'purchases'),0)
  into v_exp, v_opex from expenses where business_id = p_business and expense_date = v_day and status = 'active';

  select coalesce(sum(amount),0) into v_pay from payments where business_id = p_business and payment_date = v_day and status = 'active';
  select coalesce(sum(amount),0) into v_credit_given from ledger_entries
   where business_id = p_business and entry_date = v_day and entry_type = 'credit_given';

  v_gross := v_sales.total - v_sales.tax - v_sales.cost;

  return jsonb_build_object(
    'date', v_day,
    'sales_total', v_sales.total, 'sales_count', v_sales.cnt, 'tax_collected', v_sales.tax,
    'cost_of_goods', v_sales.cost, 'gross_profit', v_gross,
    'expenses_total', v_exp, 'operating_expenses', v_opex, 'net_profit', v_gross - v_opex,
    'cash_received', v_sales.paid + v_pay, 'payments_received', v_pay,
    'credit_given', v_sales.credit + v_credit_given,
    'yesterday_sales', (select coalesce(sum(total),0) from sales where business_id = p_business and sale_date = v_day - 1 and status = 'active'),
    'customer_outstanding', (select coalesce(sum(b),0) from (select sum(amount) b from ledger_entries where business_id = p_business group by customer_id) t where b > 0),
    'customers_with_dues', (select count(*) from (select sum(amount) b from ledger_entries where business_id = p_business group by customer_id) t where b > 0),
    'low_stock_count', (select count(*) from products where business_id = p_business and not archived and track_stock and stock_qty <= min_stock),
    'low_stock', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', id, 'name', name, 'stock_qty', stock_qty, 'min_stock', min_stock, 'unit', unit) x
        from products where business_id = p_business and not archived and track_stock and stock_qty <= min_stock
        order by stock_qty - min_stock, name limit 5) t), '[]'::jsonb),
    'overdue', coalesce((select jsonb_agg(x order by x->>'overdue_since') from (
        select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'balance', _customer_balance(c.id),
                                  'overdue_since', _customer_overdue_since(c.id, v_day)) x
        from customers c where c.business_id = p_business and not c.archived) t
        where x->>'overdue_since' is not null limit 5), '[]'::jsonb),
    'overdue_count', (select count(*) from customers c where c.business_id = p_business and not c.archived
                        and _customer_overdue_since(c.id, v_day) is not null),
    'recent', coalesce((select jsonb_agg(r order by r->>'date' desc, r->>'at' desc) from (select r from (
        (select jsonb_build_object('kind','sale','id',s.id,'title',s.invoice_no::text,'sub',coalesce(c.name,''),
                'amount',s.total,'status',s.status,'at',s.created_at,'date',s.sale_date) r
           from sales s left join customers c on c.id = s.customer_id where s.business_id = p_business order by s.sale_date desc, s.created_at desc limit 8)
        union all
        (select jsonb_build_object('kind','payment','id',p.id,'title',c.name,'sub','Payment received','amount',p.amount,
                'status',p.status,'at',p.created_at,'date',p.payment_date,'customer_id',c.id)
           from payments p join customers c on c.id = p.customer_id where p.business_id = p_business order by p.payment_date desc, p.created_at desc limit 8)
        union all
        (select jsonb_build_object('kind','expense','id',e.id,'title',e.category,'sub',coalesce(e.note,''),'amount',e.amount,
                'status',e.status,'at',e.created_at,'date',e.expense_date)
           from expenses e where e.business_id = p_business order by e.expense_date desc, e.created_at desc limit 8)
        union all
        (select jsonb_build_object('kind','credit','id',l.id,'title',c.name,'sub','Credit given','amount',l.amount,
                'status','active','at',l.created_at,'date',l.entry_date,'customer_id',c.id)
           from ledger_entries l join customers c on c.id = l.customer_id
           where l.business_id = p_business and l.entry_type = 'credit_given' order by l.entry_date desc, l.created_at desc limit 8)
      ) u order by r->>'date' desc, r->>'at' desc limit 8) w), '[]'::jsonb)
  );
end $$;

-- ───────────────────────────── grants ─────────────────────────────────────────
revoke execute on all functions in schema public from public;
do $$ begin
  -- Supabase calls its public role "anon", Neon's Data API calls it "anonymous".
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anonymous') then
    execute 'revoke execute on all functions in schema public from anonymous';
    execute 'revoke all on all tables in schema public from anonymous';
  end if;
end $$;
grant usage on schema public to authenticated;
grant execute on all functions in schema public to authenticated;
-- internal helpers stay callable (they are needed by RLS and the functions) but expose nothing on their own.
