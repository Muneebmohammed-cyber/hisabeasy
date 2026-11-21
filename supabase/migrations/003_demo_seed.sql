-- HisabEasy · 003 · Sample data for new shops (onboarding "Load sample data")
-- Uses the real API functions so every balance, stock level and ledger line is consistent.

create or replace function public.seed_demo(p_business uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur text; f numeric; d date;
  rice uuid; oil uuid; sugar uuid; tea uuid; milk uuid; atta uuid; dal uuid; biscuit uuid; soap uuid; egg uuid;
  mohammed uuid; fathima uuid; rajesh uuid; anjali uuid; suresh uuid; biju uuid;
  v_sale jsonb;
begin
  perform require_member(p_business, array['owner']);
  select currency into v_cur from businesses where id = p_business;
  f := case when v_cur = 'AED' then 0.045 else 1 end;   -- rough INR→AED so prices look local
  d := _today(p_business);

  rice    := (upsert_product(p_business, null, 'Kerala Matta Rice', 'RICE-MT', '8901000000011', 'Grains', 'kg', round(48*f,2), round(56*f,2), 120, 25)->>'id')::uuid;
  oil     := (upsert_product(p_business, null, 'Coconut Oil 1L', 'OIL-CN1', '8901000000028', 'Oil', 'btl', round(165*f,2), round(190*f,2), 30, 8)->>'id')::uuid;
  sugar   := (upsert_product(p_business, null, 'Sugar', 'SUG-1', '8901000000035', 'Grocery', 'kg', round(40*f,2), round(46*f,2), 60, 15)->>'id')::uuid;
  tea     := (upsert_product(p_business, null, 'Tea Powder 250g', 'TEA-250', '8901000000042', 'Beverages', 'pkt', round(95*f,2), round(110*f,2), 6, 10)->>'id')::uuid;
  milk    := (upsert_product(p_business, null, 'Milk 500ml', 'MLK-500', '8901000000059', 'Dairy', 'pkt', round(25*f,2), round(28*f,2), 60, 20)->>'id')::uuid;
  atta    := (upsert_product(p_business, null, 'Wheat Atta 1kg', 'ATA-1', '8901000000066', 'Grains', 'pkt', round(50*f,2), round(58*f,2), 25, 10)->>'id')::uuid;
  dal     := (upsert_product(p_business, null, 'Toor Dal 1kg', 'DAL-T1', '8901000000073', 'Pulses', 'pkt', round(140*f,2), round(160*f,2), 6, 5)->>'id')::uuid;
  biscuit := (upsert_product(p_business, null, 'Biscuits', 'BIS-1', '8901000000080', 'Snacks', 'pkt', round(8*f,2), round(10*f,2), 150, 30)->>'id')::uuid;
  soap    := (upsert_product(p_business, null, 'Bath Soap', 'SOP-1', '8901000000097', 'Personal care', 'pcs', round(32*f,2), round(40*f,2), 45, 12)->>'id')::uuid;
  egg     := (upsert_product(p_business, null, 'Eggs', 'EGG-1', null, 'Dairy', 'pcs', round(6*f,2), round(7*f,2), 0, 30)->>'id')::uuid;

  mohammed := (upsert_customer(p_business, null, 'Mohammed', '9847012345', 'Regular, pays monthly')->>'id')::uuid;
  fathima  := (upsert_customer(p_business, null, 'Fathima', '9746023456')->>'id')::uuid;
  rajesh   := (upsert_customer(p_business, null, 'Rajesh Kumar', '9895034567')->>'id')::uuid;
  anjali   := (upsert_customer(p_business, null, 'Anjali Nair', '9447045678')->>'id')::uuid;
  suresh   := (upsert_customer(p_business, null, 'Suresh (Tea Shop)', '9961056789', 'Buys milk and sugar daily', round(5000*f,2), round(1200*f,2))->>'id')::uuid;
  biju     := (upsert_customer(p_business, null, 'Biju', '9037067890')->>'id')::uuid;

  -- Six days of trading
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', rice, 'qty', 10), jsonb_build_object('product_id', oil, 'qty', 2),
    jsonb_build_object('product_id', dal, 'qty', 2), jsonb_build_object('product_id', sugar, 'qty', 5),
    jsonb_build_object('product_id', tea, 'qty', 2), jsonb_build_object('product_id', atta, 'qty', 4)),
    mohammed, round(10*f,2), 0, 0, 'credit', d - 6, d - 1, 'Monthly provisions');   -- Mohammed: credit, now overdue

  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', milk, 'qty', 6), jsonb_build_object('product_id', biscuit, 'qty', 4)), null, 0, 0, null, 'cash', d - 6);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', soap, 'qty', 3), jsonb_build_object('product_id', oil, 'qty', 1)), null, 0, 0, null, 'upi', d - 5);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', rice, 'qty', 5), jsonb_build_object('product_id', dal, 'qty', 1)),
    fathima, 0, 0, round(300*f,2), 'cash', d - 5, d + 5);                              -- Fathima: part paid
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', milk, 'qty', 20), jsonb_build_object('product_id', sugar, 'qty', 5)),
    suresh, 0, 0, 0, 'credit', d - 4, d - 2);                                          -- Suresh: overdue
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('name', 'Loose items', 'qty', 1, 'unit_price', round(240*f,2))), null, 0, 0, null, 'cash', d - 4);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', atta, 'qty', 3), jsonb_build_object('product_id', biscuit, 'qty', 10),
    jsonb_build_object('product_id', soap, 'qty', 2)), null, 0, 0, null, 'card', d - 3);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', rice, 'qty', 25), jsonb_build_object('product_id', oil, 'qty', 3)),
    rajesh, round(50*f,2), 0, round(1000*f,2), 'upi', d - 2, d + 10);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', milk, 'qty', 4), jsonb_build_object('product_id', tea, 'qty', 1)), null, 0, 0, null, 'cash', d - 1);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', sugar, 'qty', 2), jsonb_build_object('product_id', biscuit, 'qty', 6)),
    anjali, 0, 0, 0, 'credit', d - 1, d + 7);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', rice, 'qty', 20), jsonb_build_object('product_id', oil, 'qty', 4),
    jsonb_build_object('product_id', atta, 'qty', 3), jsonb_build_object('name', 'Vegetables (loose)', 'qty', 1, 'unit_price', round(380*f,2))),
    null, 0, 0, null, 'upi', d - 1);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', biscuit, 'qty', 20), jsonb_build_object('product_id', milk, 'qty', 8)), null, 0, 0, null, 'cash', d - 1);
  -- Today
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', rice, 'qty', 5), jsonb_build_object('product_id', milk, 'qty', 4),
    jsonb_build_object('product_id', oil, 'qty', 1)), null, 0, 0, null, 'cash', d);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', soap, 'qty', 4), jsonb_build_object('product_id', atta, 'qty', 2)), null, 0, 0, null, 'upi', d);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', dal, 'qty', 1), jsonb_build_object('product_id', sugar, 'qty', 2)),
    biju, 0, 0, round(100*f,2), 'cash', d, d + 3);

  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('product_id', rice, 'qty', 25), jsonb_build_object('product_id', oil, 'qty', 2),
    jsonb_build_object('product_id', tea, 'qty', 1)), null, 0, 0, null, 'upi', d);
  perform record_sale(p_business, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('name', 'Vegetables (loose)', 'qty', 1, 'unit_price', round(420*f,2)),
    jsonb_build_object('product_id', biscuit, 'qty', 12)), null, 0, 0, null, 'cash', d);

  -- The spec's example: Mohammed ₹2,000 credit, pays ₹500 → ₹1,500 outstanding
  perform add_credit(p_business, gen_random_uuid(), mohammed, round(2000*f,2), d - 3, d + 4, 'Rice bag and oil tin (no bill)');
  perform record_payment(p_business, gen_random_uuid(), mohammed, round(500*f,2), 'cash', d - 1, 'Part payment');
  perform record_payment(p_business, gen_random_uuid(), fathima, round(200*f,2), 'upi', d);
  perform record_payment(p_business, gen_random_uuid(), suresh, round(500*f,2), 'cash', d - 2);

  perform record_expense(p_business, gen_random_uuid(), 'rent', round(12000*f,2), d - 6, 'bank', 'Shop rent');
  perform record_expense(p_business, gen_random_uuid(), 'electricity', round(1850*f,2), d - 4, 'upi', 'KSEB bill');
  perform record_expense(p_business, gen_random_uuid(), 'transport', round(350*f,2), d - 2, 'cash', 'Auto for stock pickup');
  perform record_expense(p_business, gen_random_uuid(), 'misc', round(120*f,2), d, 'cash', 'Tea and snacks');
  perform record_expense(p_business, gen_random_uuid(), 'transport', round(200*f,2), d, 'cash', 'Delivery to Suresh');

  perform adjust_stock(p_business, gen_random_uuid(), sugar, 20, 'stock_in', round(39*f,2), 'From wholesaler');
end $$;

revoke execute on function public.seed_demo(uuid) from public;
grant execute on function public.seed_demo(uuid) to authenticated;

-- Supabase grants EXECUTE on new functions to anon by default; the API is for signed-in users only.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anonymous') then
    execute 'revoke execute on all functions in schema public from anonymous';
  end if;
end $$;
