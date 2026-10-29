#!/usr/bin/env bash
# 카드 · 클라우드 계정 없이 띄우기 — Linux · Mac · GitHub Codespaces 공통 (Windows 는 local.ps1)
#   bash server/scripts/up.sh            →  http://localhost:8080
#   bash server/scripts/up.sh --public   →  + 인터넷 공개 주소 https://xxxx.trycloudflare.com (무료 · 계정 불필요)
#   bash server/scripts/up.sh --stop     →  멈추기 (데이터는 남음)
# Codespaces 에서는 .devcontainer 가 시작할 때마다 자동으로 실행한다.
set -euo pipefail
cd "$(dirname "$0")/.."
getenv() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
setenv() { if grep -qE "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; else echo "$1=$2" >> .env; fi; }
rand() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

if [ "${1:-}" = "--stop" ]; then docker compose --profile public down; echo "멈췄습니다"; exit 0; fi

# Docker 가 켜질 때까지 (Codespaces 는 시작 직후 잠깐 걸린다)
for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; [ "$i" = 60 ] && { echo "Docker 가 실행 중이 아닙니다"; exit 1; }; sleep 2; done

if [ ! -f .env ]; then
  cp .env.example .env
  setenv POSTGRES_PASSWORD "$(rand 24)"; setenv API_DB_PASSWORD "$(rand 24)"
  setenv PUBLIC_API_KEY "mlng_pub_$(rand 12)"; setenv WEB_PORT "${WEB_PORT:-8080}"
  chmod 600 .env; echo "[.env] 만들었습니다 (비밀번호 무작위)"
fi
PORT="$(getenv WEB_PORT)"; PORT="${PORT:-80}"; BASE="http://localhost:$PORT"; [ "$PORT" = 80 ] && BASE="http://localhost"

echo "[실행] docker compose up --build (처음은 3~5분)"
docker compose up -d --build --wait --wait-timeout 600
docker compose up -d --no-deps --force-recreate --wait web >/dev/null 2>&1 || true
bash scripts/smoke.sh "$BASE"

URL="$BASE"
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  # 포트를 공개로 (로그인 없이 다른 사람도 접속) — 안 되면 «포트» 탭에서 우클릭 → 포트 표시 유형 → Public
  gh codespace ports visibility "$PORT:public" -c "$CODESPACE_NAME" >/dev/null 2>&1 && echo "[공개] 포트 $PORT 공개로 설정" || true
fi
if [ "${1:-}" = "--public" ]; then
  docker compose --profile public up -d tunnel >/dev/null
  for i in $(seq 1 30); do T=$(docker compose logs tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '//api\.' | tail -1 || true); [ -n "$T" ] && break; sleep 2; done
  [ -n "${T:-}" ] && { URL="$T"; echo "[공개] $T  (켤 때마다 바뀜)"; } || echo "[공개] 주소를 아직 못 받음 — docker compose logs tunnel"
fi
echo
echo "완료 → $URL"
echo "  확인: 더보기 › 시스템 › 데이터 상태 = «연결됨» · $URL/health · $URL/api/docs"
