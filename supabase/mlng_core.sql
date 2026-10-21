-- ═══════════════════════════════════════════════════════════════
-- MLNG MES — 공통 기반 스키마 (mlng_ 접두어)
-- ═══════════════════════════════════════════════════════════════
-- ⚠ 지금은 실행하지 않는다. MCT MES 발표 시연이 끝난 뒤 실행한다.
--
-- 구조
--   mlng_*   모든 공정이 같이 쓰는 표 (기준 정보 · 작업지시 · LOT · 이력 · 알림 · 검사)
--   heat_*   열처리 모듈        (supabase/heat_schema.sql)
--   weld_*   용접 모듈          (weldweb/supabase/weld_schema.sql — 이미 설계됨)
--   mes_*    MCT MES (기존)     — 이 파일은 읽지도 고치지도 않는다
--   press_* / mach_* / insp_*  다음 모듈이 같은 규칙으로 붙는다
--
-- 규칙 (MCT MES·용접 웹과 같다)
--   · 시각은 'YYYY-MM-DD HH:MM:SS' 문자열
--   · 로그인은 같은 Supabase Auth 사용자, 권한은 mes_role() ('manager' / 'operator')
--   · 알림 표는 mes_alerts 와 같은 열 + proc  → 한 화면에서 합친다
--   · 공정 모듈은 자기 표에 lot_id 만 남기면 mlng_lots·mlng_trace 로 앞뒤 공정과 이어진다
-- ═══════════════════════════════════════════════════════════════

-- ── 기준 정보 ──────────────────────────────────────────────────
create table if not exists mlng_items (            -- 품목
  code        text primary key,                    -- 'CH-001'
  name        text not null,                       -- '채널 브래킷'
  spec        text,
  unit        text default 'EA',
  active      boolean default true
);

create table if not exists mlng_equipment (        -- 설비
  id          text primary key,                    -- 'SB-01'
  name        text not null,                       -- '염욕 열처리로 #1'
  proc        text not null,                       -- press / weld / heat / mach / insp
  line        text,
  meta        jsonb default '{}'::jsonb,           -- 존 수, 정격 등
  active      boolean default true
);

create table if not exists mlng_routings (         -- 품목별 공정 순서
  item_code   text not null references mlng_items(code),
  seq         integer not null,                    -- 10, 20, 30 …
  proc        text not null,
  step_name   text not null,                       -- '프레스 성형'
  equipment_id text references mlng_equipment(id),
  primary key (item_code, seq)
);

create table if not exists mlng_defect_codes (     -- 불량 코드 (공정별)
  code        text primary key,                    -- 'HT-IW'
  proc        text not null,
  name        text not null,                       -- '내폭 치수'
  grp         text                                 -- 치수 / 외관 / 재질 …
);

create table if not exists mlng_workers (          -- 현장 작업자 (로그인 계정이 없는 사람 포함)
  id          text primary key,                    -- 'W01'
  name        text not null,
  proc        text,
  shift       text,
  active      boolean default true
);

-- ── 생산 ───────────────────────────────────────────────────────
create table if not exists mlng_work_orders (      -- 작업지시
  id          text primary key,                    -- 'WO-220103-0078'
  item_code   text references mlng_items(code),
  qty_plan    integer,
  due         text,
  status      text default 'released',             -- released / running / done / closed
  created_at  text not null
);

create table if not exists mlng_lots (             -- LOT — 소재 LOT 과 공정 LOT 모두
  id          text primary key,                    -- 'M22-001' (소재) · 'HT-102410' (열처리)
  kind        text not null,                       -- material / process
  item_code   text references mlng_items(code),
  wo_id       text references mlng_work_orders(id),
  proc        text,                                -- 공정 LOT 이면 공정
  equipment_id text references mlng_equipment(id),
  worker_id   text references mlng_workers(id),
  qty         integer, good integer, bad integer,
  start_at    text, end_at text,
  status      text default 'done',
  meta        jsonb default '{}'::jsonb
);
create index if not exists mlng_lots_wo_idx on mlng_lots (wo_id);

create table if not exists mlng_trace (            -- 이력 연결: 앞 LOT → 뒤 LOT
  id          bigint generated always as identity primary key,
  parent_lot  text not null references mlng_lots(id),
  child_lot   text not null references mlng_lots(id),
  qty         integer,
  at          text
);
create index if not exists mlng_trace_parent_idx on mlng_trace (parent_lot);
create index if not exists mlng_trace_child_idx  on mlng_trace (child_lot);

-- ── 알림 · 검사 (모든 공정 공용) ─────────────────────────────────
create table if not exists mlng_alerts (           -- mes_alerts 와 같은 열 + proc
  id       text primary key,
  kind     text default 'manual',
  level    text default 'info',                    -- danger / warn / info
  title    text not null,
  body     text,
  tool     integer,
  "to"     text default 'all',
  by       text,
  by_id    text,
  at       text not null,
  read_by  jsonb default '[]'::jsonb,
  proc     text,                                   -- heat / press / …
  lot_id   text
);
create index if not exists mlng_alerts_at_idx on mlng_alerts (at desc);

create table if not exists mlng_inspections (      -- 검사 결과 — 하류 검사가 상류 공정의 라벨이 된다
  id          text primary key,
  proc        text not null,                       -- 결과가 귀속되는 공정
  lot_id      text references mlng_lots(id),
  target      text,                                -- 부품 번호 등 LOT 보다 작은 단위
  result      text not null,                       -- 양호 / 불량
  defect_code text references mlng_defect_codes(code),
  qty         integer default 1,
  note        text,
  by          text,
  by_id       text,
  at          text not null
);
create index if not exists mlng_insp_lot_idx on mlng_inspections (lot_id);

-- ═══════════════════════════════════════════════════════════════
-- 접근 제어 — 읽기: 로그인한 사람 · 기준 정보 쓰기: 관리자 · 검사: 자기 이름으로
-- ═══════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['mlng_items','mlng_equipment','mlng_routings','mlng_defect_codes','mlng_workers',
                           'mlng_work_orders','mlng_lots','mlng_trace','mlng_alerts','mlng_inspections'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'mlng_read') then
      execute format('create policy mlng_read on %I for select to authenticated using (true)', t);
    end if;
  end loop;
  foreach t in array array['mlng_items','mlng_equipment','mlng_routings','mlng_defect_codes','mlng_workers','mlng_work_orders'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'mlng_master_write') then
      execute format('create policy mlng_master_write on %I for all to authenticated using (mes_role() = ''manager'') with check (mes_role() = ''manager'')', t);
    end if;
  end loop;
end $$;

drop policy if exists mlng_insp_insert on mlng_inspections;
create policy mlng_insp_insert on mlng_inspections
  for insert to authenticated with check (by_id = auth.uid()::text);
drop policy if exists mlng_insp_delete on mlng_inspections;
create policy mlng_insp_delete on mlng_inspections
  for delete to authenticated using (mes_role() = 'manager');

-- 2단계 (선택): 모든 알림을 한 번에 읽는 뷰. 실행 전 mes_alerts 열 구성을 다시 확인한다.
-- create or replace view plant_alerts as
--   select id, kind, level, title, body, tool, "to", by, at, read_by, 'mct'  as proc from mes_alerts
--   union all select id, kind, level, title, body, tool, "to", by, at, read_by, 'weld' as proc from weld_alerts
--   union all select id, kind, level, title, body, tool, "to", by, at, read_by, proc from mlng_alerts;
