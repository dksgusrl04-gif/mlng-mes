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
