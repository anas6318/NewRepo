-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 — Supplier-confirmed size charts + honest supplier availability
--
-- Scope: size_charts content, products.data availability defaults, and
-- fan-type size options. Nothing here touches authentication, roles, RLS
-- policies, profiles_role_guard, prevent_role_escalation, any other trigger,
-- or payment logic. No table is truncated and no unrelated column is reset.
--
-- Safe to re-run: every statement is an upsert or a guarded, targeted
-- UPDATE that only fills values that are still missing.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Supplier-confirmed charts ──────────────────────────────────────────
-- Fan / Player / Kids / Training suit. Generated from src/services/sizing.ts
-- via scripts/generate-size-chart-sql.mjs so SQL and TypeScript cannot drift.
-- `widthFlatCm` is armpit-to-armpit width with the garment laid flat, NOT a
-- chest circumference. The training-suit chart keeps the supplier's `bustCm`
-- as supplied. Fan has no 4XL row: the supplier has not confirmed one.
insert into public.size_charts (id, data) values
  ('fan', '{"id":"fan","name":{"ar":"نسخة المشجع","he":"גרסת אוהד","en":"Fan version"},"note":{"ar":"قياسات مؤكدة من المورد للقميص نفسه. العرض يُقاس والقميص مسطّح من إبط إلى إبط، وليس محيط الصدر.","he":"מידות שאושרו מול הספק ומתייחסות לחולצה עצמה. הרוחב נמדד כשהחולצה מונחת שטוח, מבית שחי לבית שחי — ולא היקף חזה.","en":"Supplier-confirmed garment measurements. Width is measured with the jersey laid flat, armpit to armpit — it is not a chest circumference."},"columns":[{"key":"lengthCm","labelKey":"sizeGuide.colJerseyLength","unit":"cm"},{"key":"widthFlatCm","labelKey":"sizeGuide.colWidthFlat","unit":"cm"},{"key":"heightCm","labelKey":"sizeGuide.colHeight","unit":"cm"},{"key":"weightKg","labelKey":"sizeGuide.colWeight","unit":"kg"}],"rows":[{"size":"S","values":{"lengthCm":{"min":69,"max":71},"widthFlatCm":{"min":53,"max":55},"heightCm":{"min":162,"max":170},"weightKg":{"min":50,"max":62}}},{"size":"M","values":{"lengthCm":{"min":71,"max":73},"widthFlatCm":{"min":55,"max":57},"heightCm":{"min":170,"max":176},"weightKg":{"min":62,"max":78}}},{"size":"L","values":{"lengthCm":{"min":73,"max":75},"widthFlatCm":{"min":57,"max":58},"heightCm":{"min":176,"max":182},"weightKg":{"min":78,"max":83}}},{"size":"XL","values":{"lengthCm":{"min":75,"max":78},"widthFlatCm":{"min":58,"max":60},"heightCm":{"min":182,"max":190},"weightKg":{"min":83,"max":90}}},{"size":"2XL","values":{"lengthCm":{"min":78,"max":81},"widthFlatCm":{"min":60,"max":62},"heightCm":{"min":190,"max":195},"weightKg":{"min":90,"max":97}}},{"size":"3XL","values":{"lengthCm":{"min":81,"max":83},"widthFlatCm":{"min":62,"max":64},"heightCm":{"min":192,"max":197},"weightKg":{"min":97,"max":104}}}],"confirmation":"supplier_confirmed","isPlaceholder":false}'::jsonb),
  ('player', '{"id":"player","name":{"ar":"نسخة اللاعب (قصّة ضيقة)","he":"גרסת שחקן (גזרה צמודה)","en":"Player version (athletic cut)"},"note":{"ar":"قياسات مؤكدة من المورد للقميص نفسه. العرض يُقاس والقميص مسطّح من إبط إلى إبط، وليس محيط الصدر.","he":"מידות שאושרו מול הספק ומתייחסות לחולצה עצמה. הרוחב נמדד כשהחולצה מונחת שטוח, מבית שחי לבית שחי — ולא היקף חזה.","en":"Supplier-confirmed garment measurements. Width is measured with the jersey laid flat, armpit to armpit — it is not a chest circumference."},"columns":[{"key":"lengthCm","labelKey":"sizeGuide.colJerseyLength","unit":"cm"},{"key":"widthFlatCm","labelKey":"sizeGuide.colWidthFlat","unit":"cm"},{"key":"heightCm","labelKey":"sizeGuide.colHeight","unit":"cm"},{"key":"weightKg","labelKey":"sizeGuide.colWeight","unit":"kg"}],"rows":[{"size":"S","values":{"lengthCm":{"min":69},"widthFlatCm":{"min":49,"max":51},"heightCm":{"min":162,"max":170},"weightKg":{"min":50,"max":62}}},{"size":"M","values":{"lengthCm":{"min":69,"max":71},"widthFlatCm":{"min":51,"max":53},"heightCm":{"min":170,"max":176},"weightKg":{"min":62,"max":78}}},{"size":"L","values":{"lengthCm":{"min":71,"max":73},"widthFlatCm":{"min":53,"max":55},"heightCm":{"min":176,"max":182},"weightKg":{"min":78,"max":83}}},{"size":"XL","values":{"lengthCm":{"min":73,"max":75},"widthFlatCm":{"min":55,"max":57},"heightCm":{"min":182,"max":190},"weightKg":{"min":83,"max":90}}},{"size":"2XL","values":{"lengthCm":{"min":75,"max":77},"widthFlatCm":{"min":57,"max":59},"heightCm":{"min":190,"max":195},"weightKg":{"min":90,"max":97}}}],"confirmation":"supplier_confirmed","isPlaceholder":false}'::jsonb),
  ('kids', '{"id":"kids","name":{"ar":"طقم أطفال","he":"סט ילדים","en":"Kids kit"},"note":{"ar":"قياسات مؤكدة من المورد للطقم. العمر الموصى به إرشادي فقط — قارن قياسات القطعة أولًا.","he":"מידות שאושרו מול הספק עבור הסט. הגיל המומלץ הוא הכוונה בלבד — השוו קודם את מידות הפריט.","en":"Supplier-confirmed measurements for the kit. Recommended age is guidance only — compare the garment measurements first."},"columns":[{"key":"lengthCm","labelKey":"sizeGuide.colShirtLength","unit":"cm"},{"key":"halfChestCm","labelKey":"sizeGuide.colHalfChest","unit":"cm"},{"key":"shortsLengthCm","labelKey":"sizeGuide.colShortsLength","unit":"cm"},{"key":"waistCm","labelKey":"sizeGuide.colWaist","unit":"cm"},{"key":"heightCm","labelKey":"sizeGuide.colHeight","unit":"cm"},{"key":"age","labelKey":"sizeGuide.colAge","unit":"age"}],"rows":[{"size":"16","values":{"lengthCm":{"min":43},"halfChestCm":{"min":32},"shortsLengthCm":{"min":32},"waistCm":{"min":20,"max":37},"heightCm":{"min":95,"max":105},"age":{"min":2,"max":3}}},{"size":"18","values":{"lengthCm":{"min":47},"halfChestCm":{"min":34},"shortsLengthCm":{"min":34},"waistCm":{"min":21,"max":39},"heightCm":{"min":105,"max":115},"age":{"min":3,"max":4}}},{"size":"20","values":{"lengthCm":{"min":50},"halfChestCm":{"min":36},"shortsLengthCm":{"min":36},"waistCm":{"min":22,"max":41},"heightCm":{"min":115,"max":125},"age":{"min":4,"max":5}}},{"size":"22","values":{"lengthCm":{"min":53},"halfChestCm":{"min":38},"shortsLengthCm":{"min":38},"waistCm":{"min":23,"max":42},"heightCm":{"min":125,"max":135},"age":{"min":6,"max":7}}},{"size":"24","values":{"lengthCm":{"min":56},"halfChestCm":{"min":40},"shortsLengthCm":{"min":39},"waistCm":{"min":24,"max":44},"heightCm":{"min":135,"max":145},"age":{"min":8,"max":9}}},{"size":"26","values":{"lengthCm":{"min":58},"halfChestCm":{"min":42},"shortsLengthCm":{"min":40},"waistCm":{"min":25,"max":47},"heightCm":{"min":145,"max":155},"age":{"min":10,"max":11}}},{"size":"28","values":{"lengthCm":{"min":61},"halfChestCm":{"min":44},"shortsLengthCm":{"min":43},"waistCm":{"min":26,"max":50},"heightCm":{"min":155,"max":165},"age":{"min":11,"max":12}}}],"confirmation":"supplier_confirmed","isPlaceholder":false}'::jsonb),
  ('training-suit', '{"id":"training-suit","name":{"ar":"بدلة تدريب","he":"חליפת אימון","en":"Training suit"},"note":{"ar":"قياسات مؤكدة من المورد لبدلة التدريب. قيمة الصدر مُعطاة من المورد كمحيط صدر وليست عرضًا مسطحًا.","he":"מידות שאושרו מול הספק לחליפת האימון. ערך החזה נמסר על ידי הספק כהיקף חזה ואינו רוחב שטוח.","en":"Supplier-confirmed measurements for the training suit. The bust value is supplied by the supplier as a chest measurement, not a flat width."},"columns":[{"key":"lengthCm","labelKey":"sizeGuide.colGarmentLength","unit":"cm"},{"key":"bustCm","labelKey":"sizeGuide.colBust","unit":"cm"},{"key":"heightCm","labelKey":"sizeGuide.colHeight","unit":"cm"},{"key":"weightKg","labelKey":"sizeGuide.colWeight","unit":"kg"}],"rows":[{"size":"S","values":{"lengthCm":{"min":69},"bustCm":{"min":100},"heightCm":{"min":155,"max":170},"weightKg":{"min":55,"max":65}}},{"size":"M","values":{"lengthCm":{"min":71},"bustCm":{"min":104},"heightCm":{"min":165,"max":175},"weightKg":{"min":60,"max":75}}},{"size":"L","values":{"lengthCm":{"min":73},"bustCm":{"min":108},"heightCm":{"min":170,"max":185},"weightKg":{"min":70,"max":85}}},{"size":"XL","values":{"lengthCm":{"min":75},"bustCm":{"min":112},"heightCm":{"min":180,"max":195},"weightKg":{"min":80,"max":100}}},{"size":"2XL","values":{"lengthCm":{"min":77},"bustCm":{"min":116},"heightCm":{"min":195,"max":210},"weightKg":{"min":95,"max":115}}}],"confirmation":"supplier_confirmed","isPlaceholder":false}'::jsonb)
on conflict (id) do update set data = excluded.data;

-- ── 2. Unconfirmed types stay explicitly preliminary ──────────────────────
-- Retro, standard long sleeve and hoodie keep their existing rows, but are
-- flagged so the storefront never presents them as supplier-confirmed.
update public.size_charts
set data = data
  || jsonb_build_object('confirmation', 'preliminary', 'isPlaceholder', true)
where id in ('retro', 'long-sleeve', 'hoodie')
  and coalesce(data->>'confirmation', '') <> 'preliminary';

-- ── 3. Product availability defaults ──────────────────────────────────────
-- Catalog presence is not inventory, and publishing a product is not a
-- supplier confirmation. The catalog is built from the supplier's Yupoo
-- album, which shows a design is generally offered — never that a given
-- version and size can be produced today. Every product without an explicit
-- record is therefore backfilled as `confirmation_required`; only an owner
-- action (recorded with a check date) may promote it to `available`.
-- Products that already carry an availability record are left untouched.
update public.products
set data = data || jsonb_build_object(
      'availability',
      jsonb_build_object(
        'status',
        case
          when status = 'archived'    then 'discontinued'
          when status = 'unavailable' then 'unavailable'
          else 'confirmation_required'
        end
      )
    )
where data->'availability' is null;

-- Any pre-existing record claiming `available` without a recorded check date
-- is not a confirmation. Downgrade it rather than trusting it.
update public.products
set data = jsonb_set(data, '{availability,status}', '"confirmation_required"'::jsonb)
where data->'availability'->>'status' = 'available'
  and coalesce(data->'availability'->>'lastCheckedAt', '') = '';

-- ── 4. Fan-type products gain 3XL as an option ────────────────────────────
-- Targeted: only products whose size list is exactly the legacy adult set
-- and whose type resolves to fan. 3XL is offered as an option and defaulted
-- to confirmation_required at size level — it is NOT claimed as in stock.
-- 4XL is deliberately not added: it stays opt-in per product in the admin.
update public.products
set data = jsonb_set(
      data || jsonb_build_object(
        'sizeAvailability',
        coalesce(data->'sizeAvailability', '{}'::jsonb)
          || jsonb_build_object('*:3XL', jsonb_build_object('status', 'confirmation_required'))
      ),
      '{sizes}',
      '["S","M","L","XL","2XL","3XL"]'::jsonb
    )
where category_slug in ('current-season', 'national-teams', 'fan-version')
  and data->'sizes' = '["S","M","L","XL","2XL"]'::jsonb;

-- ── 5. Fulfillment status vocabulary ──────────────────────────────────────
-- orders.fulfillment_status is a plain text column in 0001_schema.sql with a
-- default but no CHECK constraint, so 'awaiting_supplier_confirmation' and
-- 'supplier_unavailable' already store cleanly. This guard only fires if a
-- deployment added a CHECK later: it widens that constraint rather than
-- dropping validation, and never disables it.
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.orders'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%fulfillment_status%'
  limit 1;

  if con_name is not null then
    execute format('alter table public.orders drop constraint %I', con_name);
    alter table public.orders
      add constraint orders_fulfillment_status_check
      check (fulfillment_status in (
        'order_received', 'awaiting_supplier_confirmation', 'supplier_unavailable',
        'awaiting_payment', 'payment_confirmed', 'sent_to_supplier',
        'production_started', 'supplier_processing', 'quality_inspection',
        'supplier_dispatched', 'in_transit', 'arrived_locally',
        'ready_for_pickup', 'out_for_delivery', 'delivered',
        'issue_reported', 'cancelled', 'refunded'
      ));
  end if;
end $$;

-- ── 6. Reporting index for the new hold state ─────────────────────────────
create index if not exists orders_awaiting_supplier_idx
  on public.orders (created_at)
  where fulfillment_status = 'awaiting_supplier_confirmation';

commit;
