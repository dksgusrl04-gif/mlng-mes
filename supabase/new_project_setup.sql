-- ═══════════════════════════════════════════════════════════════
-- MLNG MES — 새 Supabase 프로젝트 한 번에 설정 (로그인 없는 공개 시연용)
-- Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
-- 여러 번 실행해도 된다 (if not exists / drop policy if exists)
-- MCT MES 프로젝트에는 실행하지 않는다.
-- ═══════════════════════════════════════════════════════════════

-- 권한 함수: 로그인 없는 시연이라 모두 관리자 취급. 로그인을 붙일 때 mes_profiles 를 읽도록 바꾼다.
create or replace function mes_role() returns text language sql stable as $$ select 'manager'::text $$;


-- ─────────────── mlng_core.sql ───────────────
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

-- ─────────────── heat_schema.sql ───────────────
-- ═══════════════════════════════════════════════════════════════
-- MLNG MES — 열처리 모듈 (heat_ 접두어)   ※ mlng_core.sql 다음에 실행
-- ═══════════════════════════════════════════════════════════════
-- ⚠ 지금은 실행하지 않는다.
--
-- 열처리 작업 1건(배정) = mlng_lots 의 공정 LOT 1개 (kind='process', proc='heat')
-- 여기에는 열처리에만 있는 것만 둔다: 공정값 요약, 2분 프로파일, 레시피
-- ═══════════════════════════════════════════════════════════════

create table if not exists heat_recipes (          -- 품목별 공정 조건 (설정값·허용 폭)
  item_code   text not null references mlng_items(code),
  key         text not null,                       -- hz1 / cp / sb1 …
  label       text not null,                       -- '소입로 1존 (장입부)'
  grp         text,                                -- 세정 / 소입로 / 솔트조 / 컨베이어 / 건조로
  unit        text,
  sp          double precision,                    -- 설정값
  tol         double precision,                    -- ± 허용 폭
  lo          double precision, hi double precision, -- 설정값 없이 범위로만 관리할 때
  primary key (item_code, key)
);

create table if not exists heat_jobs (             -- 열처리 작업 (배정) 요약
  id          text primary key references mlng_lots(id),   -- 'HT-102410'
  job_no      integer,                             -- 설비 쪽 배정번호
  wo_id       text references mlng_work_orders(id),
  equipment_id text references mlng_equipment(id),
  mat_lot     text references mlng_lots(id),       -- 투입 소재 LOT
  start_at    text, end_at text,
  dur_h       double precision,
  qty         integer, good integer, bad integer,
  defects     jsonb default '{}'::jsonb,           -- {"HT-IW": 12, "HT-OW": 1}
  stats       jsonb default '{}'::jsonb,           -- 변수별 평균·표준편차·최소·최대·이탈 비율
  heater      jsonb default '{}'::jsonb            -- 존별 평균 히터 출력(%)
);
create index if not exists heat_jobs_start_idx on heat_jobs (start_at desc);

create table if not exists heat_profiles (         -- 작업 중 공정값 (2분 평균)
  job_id      text primary key references heat_jobs(id) on delete cascade,
  t0          text not null,
  step_min    integer default 2,
  series      jsonb not null                       -- {"hz1":[...], "cp":[...]}
);

do $$
declare t text;
begin
  foreach t in array array['heat_recipes','heat_jobs','heat_profiles'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'heat_read') then
      execute format('create policy heat_read on %I for select to authenticated using (true)', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where tablename = 'heat_recipes' and policyname = 'heat_recipe_write') then
    create policy heat_recipe_write on heat_recipes for all to authenticated
      using (mes_role() = 'manager') with check (mes_role() = 'manager');
  end if;
end $$;
-- heat_jobs·heat_profiles 쓰기는 설비 수집기(service_role)만 — 화면에서는 읽기만 한다

-- ─────────────── press_schema.sql ───────────────
-- ═══════════════════════════════════════════════════════════════
-- MLNG MES — 프레스 모듈 (press_ 접두어)   ※ mlng_core.sql 다음에 실행
-- ═══════════════════════════════════════════════════════════════
-- ⚠ 지금은 실행하지 않는다.
--
-- 프레스 작업 1건(작업일·금형 교체 단위) = mlng_lots 의 공정 LOT 1개 (kind='process', proc='press')
-- 다음 공정(열처리) LOT 과의 연결은 mlng_trace 에 남긴다.
-- ═══════════════════════════════════════════════════════════════

create table if not exists press_recipes (         -- 품목별 타발 조건 (설정값·허용 폭) — 바꿀 때마다 새 행 (이력)
  id          bigint generated always as identity primary key,
  item_code   text not null references mlng_items(code),
  key         text not null,                       -- ptime / p1 / p2 / p5
  label       text not null,
  unit        text,
  sp          double precision not null,
  tol         double precision not null,
  valid_from  text not null,                       -- 이 날부터 적용
  note        text,
  by          text
);
create index if not exists press_recipes_item_idx on press_recipes (item_code, key, valid_from desc);

create table if not exists press_jobs (            -- 프레스 작업 요약
  id          text primary key references mlng_lots(id),   -- 'PR-220718'
  work_date   text not null,
  equipment_id text references mlng_equipment(id),
  cavity      integer default 1,                   -- 취수 (타발 1회당 부품 수)
  strokes     integer, qty integer, bad integer,
  defects     jsonb default '{}'::jsonb,           -- {"PR-WR": 3, "PR-SP": 5}
  stats       jsonb default '{}'::jsonb,           -- 변수별 평균·표준편차·범위·범위 밖 타발·Cpk
  changeover  boolean default false
);

create table if not exists press_series (          -- 타발 추이 (N타발 평균)
  job_id      text primary key references press_jobs(id) on delete cascade,
  bin         integer default 20,
  series      jsonb not null                       -- {"ptime":[...], "p1":[...]}
);

create table if not exists press_vibration_events ( -- 진동·전류 이상 구간
  id          bigint generated always as identity primary key,
  equipment_id text references mlng_equipment(id),
  start_at    text not null, end_at text not null,
  secs        integer,
  v0_max double precision, v1_max double precision, c_max double precision,
  ratio       double precision,                    -- 정상 기준(1초 RMS 상위 1%) 대비 배수
  series      jsonb                                -- 1초 RMS
);

create table if not exists press_vibration_base (  -- 설비별 정상 기준
  equipment_id text primary key references mlng_equipment(id),
  base        jsonb not null,                      -- {"v0":{"p50":..,"p99":..}, ...}
  updated_at  text
);

do $$
declare t text;
begin
  foreach t in array array['press_recipes','press_jobs','press_series','press_vibration_events','press_vibration_base'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'press_read') then
      execute format('create policy press_read on %I for select to authenticated using (true)', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where tablename = 'press_recipes' and policyname = 'press_recipe_write') then
    create policy press_recipe_write on press_recipes for insert to authenticated with check (mes_role() = 'manager');
  end if;
end $$;
-- press_jobs·press_series·진동 표 쓰기는 설비 수집기(service_role)만

-- ─────────────── weld_schema.sql ───────────────
-- ※ MLNG MES 에서는 점용접 표(weld_runs·weld_spot_predictions·weld_windows·weld_alerts·weld_inspections)만 씁니다.
--   아크(weld_arc_beads)는 상업 데모에서 제외. 검사 기록은 공용 mlng_inspections 로 옮겨 쓰는 것을 권장.

-- ═══════════════════════════════════════════════════════════════
-- 용접 품질 웹 — Supabase 스키마 (weld_ 접두어)
-- ═══════════════════════════════════════════════════════════════
-- ⚠ 지금은 실행하지 않는다. MCT MES 발표 시연이 끝난 뒤 실행한다.
--    실행해도 mes_ 테이블은 건드리지 않지만, 시연 중인 프로젝트에
--    변경을 만들지 않기 위해서다.
--
-- 실행할 때: MCT MES 가 쓰는 Supabase 프로젝트 → SQL Editor 에 전체 붙여넣고 Run.
--            create ... if not exists 라 여러 번 실행해도 안전하다.
--
-- MES 와 맞춘 규칙
--   · 시각은 'YYYY-MM-DD HH:MM:SS' 문자열 (mes_ 테이블과 같다)
--   · 로그인은 MES 와 같은 Supabase Auth 사용자, 권한은 MES 의 mes_role() 함수
--   · weld_alerts 는 mes_alerts 와 열 구성이 같다 → 통합 알림 화면에서 그대로 합친다
--   · 읽기는 로그인한 사람 모두, 쓰기는 업로더(service_role) — 검사 기록만 예외
-- ═══════════════════════════════════════════════════════════════

-- ── 실행 기록 (모델을 돌린 한 번) ─────────────────────────────────
create table if not exists weld_runs (
  id          text primary key,            -- 'spot-20261021-0932'
  process     text not null,               -- spot / arc
  model       text,                        -- ExtraTreesLLP / ArcCNN
  params      jsonb default '{}'::jsonb,
  summary     jsonb default '{}'::jsonb,   -- 예상 불량 수·95% 구간·등급 분포 등
  created_at  text not null
);

-- ── 점용접 타점별 예측 ───────────────────────────────────────────
create table if not exists weld_spot_predictions (
  id              text primary key,        -- run|date|idx
  run_id          text references weld_runs(id) on delete cascade,
  date            text not null,
  idx             integer not null,
  force           double precision,
  current         double precision,
  voltage         double precision,
  weld_time       double precision,
  defect_prob     double precision,
  risk_ratio      double precision,
  uncertainty_sd  double precision,
  risk_tier       text,                    -- 안정 / 주의 / 경보
  out_of_control  integer default 0,
  pred_defect     integer default 0,
  inspection_rank integer
);
create index if not exists weld_spot_pred_run_idx  on weld_spot_predictions (run_id, inspection_rank);

-- ── 아크용접 비드별 예측 (사이클 20만 개를 그대로 올리지 않고 비드로 묶는다) ──
create table if not exists weld_arc_beads (
  id              text primary key,        -- run|exp_id|welding_run_id
  run_id          text references weld_runs(id) on delete cascade,
  exp_id          integer not null,
  welding_run_id  integer not null,
  cycles          integer,
  mean_prob       double precision,
  pred_rate       double precision,        -- 불량 판정 사이클 비율
  tier            text
);

-- ── 안정 공정조건 / 안정 운전창 ──────────────────────────────────
create table if not exists weld_windows (
  id            text primary key,
  run_id        text references weld_runs(id) on delete cascade,
  process       text not null,
  variable      text not null,
  median        double precision,
  stable_lo     double precision,
  stable_hi     double precision,
  caution_lo    double precision,
  caution_hi    double precision,
  stable_share  double precision,
  caution_share double precision,
  ratio         double precision,
  judgment      text
);

-- ── 모델 검증 결과 ───────────────────────────────────────────────
create table if not exists weld_model_eval (
  id       text primary key,
  run_id   text references weld_runs(id) on delete cascade,
  process  text not null,
  scope    text not null,                  -- 과제 LODO / 외부 A / A_같은조건 …
  model    text not null,
  metrics  jsonb default '{}'::jsonb
);

-- ── 알림 — mes_alerts 와 열 구성이 같다 ──────────────────────────
create table if not exists weld_alerts (
  id       text primary key,
  kind     text default 'manual',
  level    text default 'info',            -- danger / warn / info
  title    text not null,
  body     text,
  tool     integer,
  "to"     text default 'all',
  by       text,
  by_id    text,
  at       text not null,
  read_by  jsonb default '[]'::jsonb
);
create index if not exists weld_alerts_at_idx on weld_alerts (at desc);

-- ── 검사 기록 — 현장에서 적는 표. 쌓이면 타점 라벨이 된다 ──────────
create table if not exists weld_inspections (
  id          text primary key,
  process     text not null,               -- spot / arc
  target      text not null,               -- 점용접 '2020-03-27#1421' · 아크 '조건1-비드2'
  result      text not null,               -- 양호 / 불량
  defect_type text,                        -- 파임 / 용접부족 / 크랙 / 기공 …
  note        text,
  by          text,
  by_id       text,
  at          text not null
);
create index if not exists weld_insp_target_idx on weld_inspections (process, target);
create index if not exists weld_insp_at_idx     on weld_inspections (at desc);

-- ═══════════════════════════════════════════════════════════════
-- 접근 제어 (RLS)
-- ═══════════════════════════════════════════════════════════════
alter table weld_runs             enable row level security;
alter table weld_spot_predictions enable row level security;
alter table weld_arc_beads        enable row level security;
alter table weld_windows          enable row level security;
alter table weld_model_eval       enable row level security;
alter table weld_alerts           enable row level security;
alter table weld_inspections      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['weld_runs','weld_spot_predictions','weld_arc_beads','weld_windows',
                           'weld_model_eval','weld_alerts','weld_inspections'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'weld_read') then
      execute format('create policy weld_read on %I for select to authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- 검사 기록: 로그인한 사람은 «자기 이름으로» 적을 수 있다. 지우기는 관리자만(MES 의 mes_role()).
drop policy if exists weld_insp_insert on weld_inspections;
drop policy if exists weld_insp_delete on weld_inspections;
create policy weld_insp_insert on weld_inspections
  for insert to authenticated with check (by_id = auth.uid()::text);
create policy weld_insp_delete on weld_inspections
  for delete to authenticated using (mes_role() = 'manager');

-- ═══════════════════════════════════════════════════════════════
-- 2단계 (선택) — MES 쪽 알림 탭에서도 용접 알림을 보려면 아래 뷰를 만든다.
-- MES 화면 코드를 고쳐야 쓰이므로 발표 후 MES 를 손볼 때 같이 한다.
-- ═══════════════════════════════════════════════════════════════
-- create or replace view plant_alerts with (security_invoker = true) as
--   select 'mct'  as process, id, kind, level, title, body, tool, "to", by, at from mes_alerts
--   union all
--   select 'weld' as process, id, kind, level, title, body, tool, "to", by, at from weld_alerts;

-- 확인
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'weld_%' order by table_name;

-- ─────────────── insp_schema.sql ───────────────
-- ═══════════════════════════════════════════════════════════════
-- MLNG MES — 정밀가공·검사 모듈 (insp_ 접두어)   ※ mlng_core.sql 다음에 실행
-- ═══════════════════════════════════════════════════════════════
-- ⚠ 지금은 실행하지 않는다.
--
-- 하루(또는 교대) 검사분 = mlng_lots 의 공정 LOT 1개 (kind='process', proc='insp')
-- 부품 한 개의 검사 = insp_parts 한 행. 판정이 둘 이상이면 행이 여러 개 → 화면에서 «확정 필요»
-- 현장에서 확정한 판정은 mlng_inspections 에 남긴다 (공용 검사 기록)
-- ═══════════════════════════════════════════════════════════════

create table if not exists insp_parts (
  id          bigint generated always as identity primary key,
  serial_no   text not null,                       -- 부품 번호
  lot_id      text references mlng_lots(id),       -- 검사 LOT
  inspected_at text not null,
  result      text not null,                       -- 합격 / 불합격
  signals     jsonb default '{}'::jsonb,           -- 가공 신호 요약 {"spd_max":2226, "x_cur":151.7, ...}
  source      text                                 -- 설비 / 수기
);
create index if not exists insp_parts_serial_idx on insp_parts (serial_no);
create index if not exists insp_parts_lot_idx    on insp_parts (lot_id);

-- 같은 번호·같은 시각에 판정이 갈린 부품 (화면의 «판정 확정 필요»)
create or replace view insp_conflicts as
  select serial_no, inspected_at, count(distinct result) as n_result, min(lot_id) as lot_id
  from insp_parts group by serial_no, inspected_at having count(distinct result) > 1;

alter table insp_parts enable row level security;
drop policy if exists insp_read on insp_parts;
create policy insp_read on insp_parts for select to authenticated using (true);
-- insp_parts 쓰기는 검사 셀 수집기(service_role)만

-- ─────────────── plan_schema.sql ───────────────
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


-- ═══════════════════════════════════════════════════════════════
-- 로그인 없는 접근 — anon 키로 읽기 · 검사 기록/작업지시 초안은 추가만
-- ═══════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
           and (tablename like 'mlng\_%' or tablename like 'heat\_%' or tablename like 'press\_%'
             or tablename like 'weld\_%' or tablename like 'insp\_%' or tablename like 'plan\_%') loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select on %I to anon', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'anon_read') then
      execute format('create policy anon_read on %I for select to anon using (true)', t);
    end if;
  end loop;
end $$;

grant insert on mlng_inspections, mlng_work_orders to anon;
drop policy if exists anon_insp_insert on mlng_inspections;
create policy anon_insp_insert on mlng_inspections for insert to anon with check (true);
drop policy if exists anon_wo_insert on mlng_work_orders;
create policy anon_wo_insert on mlng_work_orders for insert to anon with check (true);

-- 확인: 만들어진 표
select tablename from pg_tables where schemaname = 'public' order by tablename;
