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
