-- HisabEasy API tests. Run: tests/load.sh && psql ... -f tests/test_api.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  perform set_config('role', case when u is null then 'anon' else 'authenticated' end, false);
end $$;

create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', false);
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

-- Expect a statement to fail with a given SQLSTATE.
create or replace function pg_temp.expect_err(p_sql text, p_code text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL [%]: expected error % but it succeeded', p_label, p_code;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'FAIL [%' then raise; end if;
  if sqlstate <> p_code then
    raise exception 'FAIL [%]: expected %, got % (%)', p_label, p_code, sqlstate, sqlerrm;
  end if;
  raise notice 'ok  %', p_label;
end $$;

create or replace function pg_temp.eq(p_got anyelement, p_want anyelement, p_label text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception 'FAIL [%]: got %, want %', p_label, p_got, p_want; end if;
  raise notice 'ok  %', p_label;
end $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'owner@b.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff@a.test');

set client_min_messages = notice;

do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000000a';
  ub uuid := '00000000-0000-0000-0000-00000000000b';
  us uuid := '00000000-0000-0000-0000-00000000000c';
  biz uuid; bizb uuid; demo uuid; cust uuid; c2 uuid; prod uuid; s jsonb; s2 jsonb; ref uuid; r jsonb; v numeric; n int; d date;
begin
  -- ── anonymous cannot call anything
  perform pg_temp.as_user(null);
  perform pg_temp.expect_err($q$select public.my_businesses()$q$, '42501', 'anon cannot execute API');

  -- ── onboarding
  perform pg_temp.as_user(ua);
  biz := (public.create_business('ABC Stores', 'grocery', 'INR', 'ml')->>'id')::uuid;
  perform pg_temp.eq(jsonb_array_length(public.my_businesses()), 1, 'owner sees own business');
  d := public._today(biz);

  -- ── spec example: Mohammed ₹2,000 credit, pays ₹500 → ₹1,500
  cust := (public.upsert_customer(biz, null, 'Mohammed', '98470 12345')->>'id')::uuid;
  s := public.record_sale(biz, gen_random_uuid(), '[{"name":"Provisions","qty":1,"unit_price":2000}]', cust,
                          0, 0, 0, 'credit', null, d + 7);
  perform pg_temp.eq((s->>'credit_amount')::numeric, 2000.00, 'credit sale posts full amount to khata');
  perform pg_temp.eq((s->>'payment_method'), 'credit', 'method stored as credit');
  r := public.record_payment(biz, gen_random_uuid(), cust, 500, 'cash');
  perform pg_temp.eq((r->>'balance')::numeric, 1500.00, 'Mohammed balance 1500 after part payment');
  r := public.get_customer(biz, cust);
  perform pg_temp.eq((r->>'total_purchases')::numeric, 2000.00, 'profile total purchases');
  perform pg_temp.eq((r->>'total_payments')::numeric, 500.00, 'profile total payments');
  perform pg_temp.eq((r->>'phone'), '9847012345', 'phone normalised');
  r := public.dashboard_summary(biz);
  perform pg_temp.eq((r->>'sales_total')::numeric, 2000.00, 'dashboard sales today');
  perform pg_temp.eq((r->>'cash_received')::numeric, 500.00, 'dashboard cash received = payment only');
  perform pg_temp.eq((r->>'customer_outstanding')::numeric, 1500.00, 'dashboard customer outstanding');
  r := public.customer_ledger(biz, cust);
  perform pg_temp.eq((r->-1->>'running_balance')::numeric, 1500.00, 'ledger running balance ends at 1500');

  -- ── idempotency: same client_ref twice = one record
  ref := gen_random_uuid();
  s := public.record_sale(biz, ref, '[{"name":"Tea","qty":2,"unit_price":15}]');
  s2 := public.record_sale(biz, ref, '[{"name":"Tea","qty":2,"unit_price":15}]');
  perform pg_temp.eq(s->>'id', s2->>'id', 'retry returns same sale');
  perform pg_temp.eq((s2->>'duplicate')::boolean, true, 'retry flagged duplicate');
  perform pg_temp.eq((select count(*)::int from sales where client_ref = ref), 1, 'only one sale row');
  ref := gen_random_uuid();
  perform public.record_payment(biz, ref, cust, 100, 'upi');
  perform public.record_payment(biz, ref, cust, 100, 'upi');
  perform pg_temp.eq(public._customer_balance(cust), 1400.00, 'payment retry not double-counted');

  -- ── totals: discount + tax + partial payment computed on server
  prod := (public.upsert_product(biz, null, 'Coconut Oil 1L', 'OIL1', null, 'Oil', 'btl', 160, 190, 10, 3)->>'id')::uuid;
  s := public.record_sale(biz, gen_random_uuid(),
        jsonb_build_array(jsonb_build_object('product_id', prod, 'qty', 2, 'unit_price', 100),
                          '{"name":"Loose rice","qty":1.5,"unit_price":37}'::jsonb),
        cust, 10.50, 5, 100, 'cash');
  perform pg_temp.eq((s->>'subtotal')::numeric, 255.50, 'subtotal 2x100 + 1.5x37');
  perform pg_temp.eq((s->>'tax_amount')::numeric, 12.25, 'tax 5% after discount');
  perform pg_temp.eq((s->>'total')::numeric, 257.25, 'total');
  perform pg_temp.eq((s->>'credit_amount')::numeric, 157.25, 'unpaid part to khata');
  perform pg_temp.eq((s->>'cost_total')::numeric, 320.00, 'cost from purchase price');
  perform pg_temp.eq(public._customer_balance(cust), 1557.25, 'balance after partial-paid sale');

  -- ── inventory deduction and cancel reversal
  perform pg_temp.eq((select stock_qty from products where id = prod), 8.000, 'stock deducted 10 → 8');
  r := public.cancel_sale(biz, (s->>'id')::uuid, 'Wrong customer');
  perform pg_temp.eq(r->>'status', 'cancelled', 'sale cancelled');
  perform pg_temp.eq((select stock_qty from products where id = prod), 10.000, 'stock restored on cancel');
  perform pg_temp.eq(public._customer_balance(cust), 1400.00, 'khata reversed on cancel');
  perform pg_temp.expect_err(format('select public.cancel_sale(%L, %L, %L)', biz, s->>'id', 'again'), 'HE040', 'cannot cancel twice');
  perform pg_temp.eq((select sum(qty_change) from stock_movements where product_id = prod), 10.000, 'movements sum = stock');
  r := public.adjust_stock(biz, gen_random_uuid(), prod, 12, 'stock_in', 155, 'Wholesaler');
  perform pg_temp.eq((r->>'stock_qty')::numeric, 22.000, 'stock in adds');
  perform pg_temp.eq((r->>'purchase_price')::numeric, 155.00, 'stock in updates cost');
  r := public.adjust_stock(biz, gen_random_uuid(), prod, -2, 'damage', null, 'Leaked');
  perform pg_temp.eq((r->>'stock_qty')::numeric, 20.000, 'damage reduces');
  perform pg_temp.expect_err(format('update businesses set name = %L where id = %L', 'x', biz), '42501', 'direct table update denied');
end $$;

do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000000a';
  ub uuid := '00000000-0000-0000-0000-00000000000b';
  us uuid := '00000000-0000-0000-0000-00000000000c';
  biz uuid; bizb uuid; demo uuid; cust uuid; c2 uuid; prod uuid; s jsonb; r jsonb; d date; n int; v numeric;
begin
  perform pg_temp.as_user(ua);
  select id into biz from businesses where name = 'ABC Stores';
  select id into cust from customers where name = 'Mohammed' and business_id = biz;
  select id into prod from products where business_id = biz limit 1;
  d := public._today(biz);

  -- inventory switched off → sale doesn't move stock
  perform public.update_business(biz, '{"track_inventory": false}');
  perform public.record_sale(biz, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', prod, 'qty', 1)));
  perform pg_temp.eq((select stock_qty from products where id = prod), 20.000, 'no deduction when inventory off');
  perform public.update_business(biz, '{"track_inventory": true}');

  -- ── validation
  perform pg_temp.expect_err(format($q$select public.record_sale(%L, gen_random_uuid(), '[{"name":"x","qty":1,"unit_price":50}]', null, 0, 0, 0, 'credit')$q$, biz), 'HE010', 'credit sale needs a customer');
  perform pg_temp.expect_err(format($q$select public.record_sale(%L, gen_random_uuid(), '[{"name":"x","qty":1,"unit_price":50}]', null, 0, 0, 60)$q$, biz), 'HE010', 'paid > total rejected');
  perform pg_temp.expect_err(format($q$select public.record_sale(%L, gen_random_uuid(), '[{"name":"x","qty":-1,"unit_price":50}]')$q$, biz), 'HE010', 'negative qty rejected');
  perform pg_temp.expect_err(format($q$select public.record_sale(%L, gen_random_uuid(), '[{"name":"x","qty":1,"unit_price":10.555}]')$q$, biz), 'HE010', '3-decimal price rejected');
  perform pg_temp.expect_err(format($q$select public.record_sale(%L, gen_random_uuid(), '[{"name":"x","qty":1,"unit_price":10}]', null, 20)$q$, biz), 'HE010', 'discount > bill rejected');
  perform pg_temp.expect_err(format($q$select public.record_sale(%L, gen_random_uuid(), '[]')$q$, biz), 'HE010', 'empty bill rejected');
  perform pg_temp.expect_err(format($q$select public.record_sale(%L, gen_random_uuid(), '[{"name":"x","qty":1,"unit_price":10}]', null, 0, 0, null, 'cash', %L)$q$, biz, d + 5), 'HE010', 'future date rejected');
  perform pg_temp.expect_err(format($q$select public.record_payment(%L, gen_random_uuid(), %L, 0)$q$, biz, cust), 'HE010', 'zero payment rejected');
  perform pg_temp.expect_err(format($q$select public.record_expense(%L, gen_random_uuid(), 'party', 100)$q$, biz), 'HE010', 'unknown expense category rejected');
  perform pg_temp.expect_err(format($q$select public.upsert_customer(%L, %L, p_archived => true)$q$, biz, cust), 'HE040', 'cannot archive customer with balance');

  -- ── credit limit
  c2 := (public.upsert_customer(biz, null, 'Limited', null, null, 1000)->>'id')::uuid;
  perform public.add_credit(biz, gen_random_uuid(), c2, 900);
  perform pg_temp.expect_err(format($q$select public.add_credit(%L, gen_random_uuid(), %L, 200)$q$, biz, c2), 'HE040', 'credit limit enforced');

  -- ── overdue (FIFO): old credit due in past, partial payment leaves it overdue, full clears it
  perform public.add_credit(biz, gen_random_uuid(), c2, 50, d - 10, d - 3);
  -- c2 entries in date order: 50 (d-10, due d-3), 900 (d, no due)
  perform pg_temp.eq(public._customer_overdue_since(c2, d), d - 3, 'overdue since due date');
  perform public.record_payment(biz, gen_random_uuid(), c2, 30);
  perform pg_temp.eq(public._customer_overdue_since(c2, d), d - 3, 'still overdue after partial');
  perform public.record_payment(biz, gen_random_uuid(), c2, 20);
  perform pg_temp.eq(public._customer_overdue_since(c2, d), null::date, 'oldest due cleared → not overdue');
  perform pg_temp.eq(jsonb_array_length(public.list_customers(biz, null, 'overdue')), 0, 'overdue list empty');

  -- ── reversals
  r := public.record_payment(biz, gen_random_uuid(), c2, 100);
  perform public.reverse_payment(biz, (r->>'id')::uuid, 'Cheque bounced');
  perform pg_temp.eq(public._customer_balance(c2), 900.00, 'payment reversal restores balance');
  perform pg_temp.expect_err(format('select public.reverse_payment(%L, %L, %L)', biz, r->>'id', 'again'), 'HE040', 'cannot reverse twice');
  r := public.add_credit(biz, gen_random_uuid(), c2, 40);
  perform public.reverse_ledger_entry(biz, (r->>'id')::uuid, 'Entered twice');
  perform pg_temp.eq(public._customer_balance(c2), 900.00, 'manual credit reversal');

  -- ── expenses and profit
  perform public.record_expense(biz, gen_random_uuid(), 'electricity', 300, null, 'upi');
  perform public.record_expense(biz, gen_random_uuid(), 'purchases', 1000, null, 'cash');
  r := public.dashboard_summary(biz);
  perform pg_temp.eq((r->>'expenses_total')::numeric, 1300.00, 'expenses total includes purchases');
  perform pg_temp.eq((r->>'operating_expenses')::numeric, 300.00, 'net profit excludes purchases');
  perform pg_temp.eq((r->>'net_profit')::numeric, (r->>'gross_profit')::numeric - 300, 'net = gross − opex');

  -- ── tenant isolation
  perform pg_temp.as_user(ub);
  bizb := (public.create_business('Other Mart', 'retail', 'AED', 'en')->>'id')::uuid;
  perform pg_temp.expect_err(format('select public.dashboard_summary(%L)', biz), 'HE002', 'other shop blocked (dashboard)');
  perform pg_temp.expect_err(format('select public.get_customer(%L, %L)', biz, cust), 'HE002', 'other shop blocked (customer)');
  perform pg_temp.expect_err(format('select public.get_customer(%L, %L)', bizb, cust), 'HE020', 'foreign id via own shop → not found');
  perform pg_temp.expect_err(format($q$select public.record_payment(%L, gen_random_uuid(), %L, 10)$q$, bizb, cust), 'HE020', 'cannot pay into another shop''s customer');
  perform pg_temp.eq((select count(*)::int from sales), 0, 'RLS: other owner sees 0 sales rows');
  perform pg_temp.eq((select count(*)::int from customers), 0, 'RLS: other owner sees 0 customers');
  perform pg_temp.expect_err(format($q$insert into customers(business_id, name) values (%L, 'x')$q$, bizb), '42501', 'direct table insert denied');
  perform pg_temp.expect_err($q$select * from audit_log$q$, '42501', 'audit log not readable by app');

  -- ── roles: staff can sell but not cancel
  perform pg_temp.as_admin();
  insert into business_members(business_id, user_id, role) values (biz, us, 'staff');
  perform pg_temp.as_user(us);
  s := public.record_sale(biz, gen_random_uuid(), '[{"name":"Soap","qty":1,"unit_price":40}]');
  perform pg_temp.expect_err(format('select public.cancel_sale(%L, %L, %L)', biz, s->>'id', 'mistake'), 'HE003', 'staff cannot cancel');
  perform pg_temp.expect_err(format($q$select public.update_business(%L, '{"name":"Hacked"}')$q$, biz), 'HE003', 'staff cannot edit business');

  -- ── money rows cannot be altered even by an admin session
  perform pg_temp.as_admin();
  perform pg_temp.expect_err(format('update sales set total = 1 where id = %L', s->>'id'), 'P0001', 'sale amount locked');
  perform pg_temp.expect_err(format('delete from sales where id = %L', s->>'id'), 'P0001', 'sale cannot be deleted');
  perform pg_temp.expect_err('update ledger_entries set amount = 1', 'P0001', 'ledger append-only');
  perform pg_temp.eq((select count(*) > 20 from audit_log where business_id = biz), true, 'audit log written');

  -- ── plan limit configurable from data
  update plans set limits = jsonb_set(limits, '{max_customers}', '1') where code = 'free';
  perform pg_temp.as_user(ub);
  perform public.upsert_customer(bizb, null, 'First');
  perform pg_temp.expect_err(format($q$select public.upsert_customer(%L, null, 'Second')$q$, bizb), 'HE030', 'plan customer limit enforced');
  perform pg_temp.as_admin();
  update plans set limits = jsonb_set(limits, '{max_customers}', '50') where code = 'free';

  -- ── demo data is internally consistent
  perform pg_temp.as_user(ua);
  demo := (public.create_business('Demo Kada', 'grocery', 'INR', 'en', true)->>'id')::uuid;
  r := public.dashboard_summary(demo);
  perform pg_temp.eq((r->>'customer_outstanding')::numeric,
     (select sum(b) from (select public._customer_balance(id) b from customers where business_id = demo) t where b > 0),
     'demo: outstanding = sum of balances');
  perform pg_temp.eq((select count(*)::int from products p where business_id = demo and
     p.stock_qty <> coalesce((select sum(qty_change) from stock_movements m where m.product_id = p.id), 0)), 0,
     'demo: every product stock = sum of movements');
  perform pg_temp.eq((r->>'net_profit')::numeric > 0, true, 'demo today is profitable');
  perform pg_temp.eq((r->>'overdue_count')::int >= 1, true, 'demo has overdue customers');
  perform pg_temp.eq((r->>'low_stock_count')::int >= 2, true, 'demo has low-stock items');
  perform pg_temp.eq((r->>'sales_count')::int, 5, 'demo has 5 bills today');
  perform pg_temp.eq(jsonb_array_length(r->'recent') > 0, true, 'demo recent activity');
  perform pg_temp.eq((select count(*)::int from sales where business_id = demo and paid_amount + credit_amount <> total), 0, 'demo: paid + credit = total');
  raise notice 'demo dashboard: %', r - 'recent' - 'low_stock' - 'overdue';

  -- AED demo
  perform pg_temp.as_user(ub);
  demo := (public.create_business('Dubai Grocery', 'grocery', 'AED', 'en', true)->>'id')::uuid;
  perform pg_temp.eq((select timezone from businesses where id = demo), 'Asia/Dubai', 'AED shop uses Dubai time');
  raise notice 'ALL TESTS PASSED';
end $$;
