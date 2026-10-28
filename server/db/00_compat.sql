-- ═══════════════════════════════════════════════════════════════
-- 일반 PostgreSQL 에서 Supabase 용 SQL(supabase/new_project_setup.sql)을 그대로 돌리기 위한 준비
--   Supabase 에는 미리 있는 역할(anon · authenticated)과 auth.uid() 를 만들어 둔다.
--   → 같은 스키마 · 같은 권한(GRANT) · 같은 행 보안(RLS)을 자체 서버에서도 그대로 쓴다.
-- 이 폴더의 파일은 DB 를 처음 만들 때 한 번만 이름 순서대로 실행된다 (postgres 이미지 규칙).
-- ═══════════════════════════════════════════════════════════════
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
-- 로그인을 붙이기 전까지는 사용자 없음 (Supabase 의 auth.uid() 자리)
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
