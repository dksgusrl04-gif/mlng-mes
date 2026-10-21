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
