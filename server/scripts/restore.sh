#!/usr/bin/env bash
# 백업에서 되살리기 — bash scripts/restore.sh backups/mlng_20261028_0300.sql.gz
# ⚠ 지금 DB 내용을 지우고 백업 시점으로 되돌린다
set -euo pipefail
cd "$(dirname "$0")/.."
F="${1:?백업 파일을 주세요 (backups/ 안)}"
read -r -p "지금 DB 를 $F 시점으로 되돌립니다. 계속할까요? (yes) " a; [ "$a" = "yes" ] || exit 1
docker compose stop api
docker compose exec -T db psql -U postgres -c "drop database if exists mlng with (force)" -c "create database mlng"
gunzip -c "$F" | docker compose exec -T db psql -U postgres -d mlng -v ON_ERROR_STOP=1 >/dev/null
docker compose exec -T db psql -U postgres -c "grant connect on database mlng to mlng_api"
docker compose start api
echo "복원 완료"
