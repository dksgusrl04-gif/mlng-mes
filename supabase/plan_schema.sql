-- ═══════════════════════════════════════════════════════════════
-- MLNG MES — 생산 계획 (plan_ 접두어)   ※ mlng_core.sql 다음에 실행
-- ═══════════════════════════════════════════════════════════════
-- ⚠ 지금은 실행하지 않는다.
-- 작업지시는 공용 mlng_work_orders (화면의 «작업지시 만들기» = status 'draft' 로 넣기, 관리자 권한)
-- ═══════════════════════════════════════════════════════════════

create table if not exists plan_daily (            -- 품목별 일 수주·생산·재고
  item_code   text not null references mlng_items(code),
  work_date   text not null,
  order_qty   integer, need_qty integer, prod_qty integer,
  inv_open    integer, inv_close integer, inv_min integer,
  runs        integer,
  primary key (item_code, work_date)
);

create table if not exists plan_events (           -- 시각별 생산·재고 기록
  id          bigint generated always as identity primary key,
  item_code   text not null references mlng_items(code),
  at          text not null,
  need_qty integer, inv integer, prod_qty integer, order_qty integer
);
create index if not exists plan_events_at_idx on plan_events (at desc);

create table if not exists plan_settings (         -- 품목별 계획 기준 (1회 생산량·안전재고)
  item_code   text primary key references mlng_items(code),
  lot_size    integer not null,
  safety_ratio double precision default 0.5,
  avg_days    integer default 7
);

do $$
declare t text;
begin
  foreach t in array array['plan_daily','plan_events','plan_settings'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'plan_read') then
      execute format('create policy plan_read on %I for select to authenticated using (true)', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where tablename = 'plan_settings' and policyname = 'plan_settings_write') then
    create policy plan_settings_write on plan_settings for all to authenticated using (mes_role() = 'manager') with check (mes_role() = 'manager');
  end if;
end $$;
