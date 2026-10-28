#!/bin/bash
# 끌어오기 배포 (pull-based) — systemd 타이머가 5분마다 실행 (server/aws/bootstrap.sh 가 등록)
#   origin/main 에 새 커밋이 있고 → GitHub Actions 시험이 모두 통과했으면 → 그 커밋으로 다시 빌드 · 실행 → 요청 시험
#   요청 시험이 실패하면 이전 커밋으로 되돌린다 (자동 롤백)
# GitHub 에 SSH 키 · 비밀값을 줄 필요가 없다 (서버가 공개 저장소를 읽기만 한다)
set -uo pipefail
SRV="$(cd "$(dirname "$0")/.." && pwd)"; DIR="$(dirname "$SRV")"; U=$(stat -c %U "$DIR")
G() { sudo -u "$U" git -C "$DIR" "$@"; }
log() { echo "[mlng-update] $*"; }
cd "$SRV"
getenv() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
setenv() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }

# DuckDNS IP 갱신 (IP 가 바뀌어도 도메인이 따라오게)
SUB="$(getenv DUCKDNS_SUBDOMAIN)"; DTOK="$(getenv DUCKDNS_TOKEN)"
[ -n "$SUB" ] && [ -n "$DTOK" ] && curl -s -o /dev/null "https://www.duckdns.org/update?domains=$SUB&token=$DTOK&ip="

G fetch -q origin main || { log "fetch 실패"; exit 0; }
NEW=$(G rev-parse origin/main); CUR=$(G rev-parse HEAD)
[ "$NEW" = "$CUR" ] && exit 0
[ "$(cat .last-skip 2>/dev/null)" = "$NEW" ] && exit 0

SLUG=$(G remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
ST=$(curl -s "https://api.github.com/repos/$SLUG/commits/$NEW/check-runs?per_page=100" | python3 -c '
import json,sys
try: rs=json.load(sys.stdin).get("check_runs",[])
except Exception: print("unknown"); sys.exit()
if not rs: print("none")
elif any(r["status"]!="completed" for r in rs): print("pending")
elif all(r["conclusion"] in ("success","skipped","neutral") for r in rs): print("success")
else: print("failure")')
case "$ST" in
  pending|unknown) log "${NEW:0:7} 시험 진행 중 — 다음에 다시"; exit 0;;
  failure) log "${NEW:0:7} 시험 실패 — 배포 안 함"; echo "$NEW" > .last-skip; exit 0;;
  none) [ "$(getenv DEPLOY_UNCHECKED)" = "true" ] || { log "${NEW:0:7} 시험 기록 없음 — 배포 안 함"; echo "$NEW" > .last-skip; exit 0; };;
esac

log "${CUR:0:7} → ${NEW:0:7} 배포"
deploy() { G checkout -q "$1" && setenv APP_VERSION "${1:0:12}" && docker compose up -d --build --wait --wait-timeout 600 && docker compose up -d --no-deps --force-recreate --wait web && bash scripts/smoke.sh http://localhost; }   # Nginx 설정은 파일 연결이라 다시 만들어야 반영
if deploy "$NEW"; then
  docker image prune -f >/dev/null; log "완료 ${NEW:0:7}"
else
  log "요청 시험 실패 → ${CUR:0:7} 로 되돌림"; echo "$NEW" > .last-skip; deploy "$CUR" || log "되돌리기도 실패 — 확인 필요"
fi
