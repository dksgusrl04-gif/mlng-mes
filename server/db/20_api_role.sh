#!/bin/sh
# API 서버가 접속하는 계정 — 비밀번호는 .env 의 API_DB_PASSWORD
#   mlng_api 는 표를 직접 만질 권한이 없다. 요청마다 SET LOCAL ROLE anon 으로 바꿔서 anon 의 GRANT · RLS 만 받는다.
#   (DB 관리자 계정 postgres 는 API 가 쓰지 않는다)
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pw="$API_DB_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
select format('create role mlng_api login password %L noinherit', :'pw')
 where not exists (select 1 from pg_roles where rolname = 'mlng_api') \gexec
alter role mlng_api password :'pw';
grant anon to mlng_api;
grant connect on database :"db" to mlng_api;
grant usage on schema public to mlng_api;
-- 표 목록(열 이름 · 타입)을 읽는 것만 허용 — 실제 데이터는 anon 으로 바꾼 뒤에만
grant select on pg_catalog.pg_attribute, pg_catalog.pg_class, pg_catalog.pg_namespace to mlng_api;
SQL
