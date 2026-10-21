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
