-- ═══════════════════════════════════════════════════════════════
-- 구매·발주 (mlng_purchase_orders) · 활동 기록 (mlng_audit)
--   발주 1건 = 거래처 1곳. 품목은 lines(jsonb), 결재는 signs(jsonb: {"담당":{"by","at"}, ...})
--   상태: pending(결재 대기) → approved(결재 완료·미입고) → received(입고 완료)
-- ═══════════════════════════════════════════════════════════════
create table if not exists mlng_purchase_orders (
  id          text primary key,            -- PO-220719-01
  created_at  text not null,
  by          text,
  vendor      text not null,
  lines       jsonb not null default '[]', -- [{code,name,spec,unit,qty,price,reason}]
  signs       jsonb not null default '{}',
  status      text not null default 'pending' check (status in ('pending','approved','received')),
  note        text,
  received_at text
);
create index if not exists mlng_po_status_idx on mlng_purchase_orders (status);

create table if not exists mlng_audit (
  id     bigserial primary key,
  at     text not null,
  kind   text not null default 'po',       -- po · …
  ref    text,                             -- 발주 번호 등
  action text not null,                    -- 발주 등록 · 담당 결재 (이름) · 결재 물림 · 발주서 출력 · 입고 처리
  by     text,
  detail jsonb
);
create index if not exists mlng_audit_ref_idx on mlng_audit (ref);

alter table mlng_purchase_orders enable row level security;
alter table mlng_audit enable row level security;
