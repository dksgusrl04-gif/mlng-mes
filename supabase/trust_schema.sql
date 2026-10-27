-- ═══════════════════════════════════════════════════════════════
-- MLNG MES 2.0 — 신뢰 원장 (mlng_ledger) · 회사 공개키 (mlng_keys)
--   원장: 기록마다 앞 기록의 해시(prev)와 자기 해시(hash), 회사 서명(sig)을 담는다.
--   공개키: 서명 검증용 공개키만 저장 (비밀키는 절대 저장하지 않는다).
--   원장은 «추가만» 가능하고 수정·삭제 권한을 주지 않는다 → 고치려는 시도는 권한에서 막히고, DB 관리자가 고쳐도 해시 사슬에서 드러난다.
-- ═══════════════════════════════════════════════════════════════
create table if not exists mlng_ledger (
  seq     integer primary key,
  at      text not null,
  company text not null,
  kind    text not null,
  ref     text,
  title   text,
  payload text not null,     -- 기록 본문의 해시 (본문 자체는 각 회사에)
  prev    text not null,
  hash    text not null unique,
  sig     jsonb not null      -- { alg, kid, hash, sig }
);
create table if not exists mlng_keys (
  kid     text primary key,   -- 공개키 지문
  company text not null,
  jwk     jsonb not null,     -- 공개키 (kty·crv·x·y)
  at      text
);
alter table mlng_ledger enable row level security;
-- 4.0 — 원장 기록 형식 검사: 해시는 64자리 16진수, 서명이 있어야 한다 (로그인 없는 추가 전용 표에 엉터리 기록이 들어오는 것을 DB 에서 막음)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mlng_ledger_hash_fmt') then
    alter table mlng_ledger add constraint mlng_ledger_hash_fmt check (hash ~ '^[0-9a-f]{64}$' and prev ~ '^[0-9a-f]{64}$' and sig is not null and length(title) <= 300);
  end if;
end $$;

alter table mlng_keys enable row level security;
