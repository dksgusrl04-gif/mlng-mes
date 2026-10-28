#!/bin/bash
# MLNG MES — EC2(Ubuntu) 한 번에 설치 · 실행. root 로 실행 (user-data 가 부르거나:  sudo bash server/aws/bootstrap.sh)
# 여러 번 실행해도 된다 (이미 된 단계는 건너뜀). IP 가 바뀌었거나 DuckDNS 를 나중에 넣을 때도 다시 실행.
#   1 스왑(메모리 2GB 미만) · 2 Docker · 3 .env(무작위 비밀번호) · 4 docker compose 실행 · 5 요청 시험
#   6 (DuckDNS 값이 있으면) 도메인 연결 + HTTPS · 7 자동 업데이트(5분마다: CI 통과한 새 커밋만 배포, 실패하면 되돌림)
set -euo pipefail
DIR=/home/ubuntu/mlng-mes; SRV=$DIR/server; U=ubuntu
log() { echo "[$(date '+%F %T')] $*"; }
cd "$SRV"

log "1/7 스왑"
if [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 1900000 ] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "2/7 Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
usermod -aG docker $U
systemctl enable --now docker 2>/dev/null || true

log "3/7 .env"
getenv() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
setenv() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
if [ ! -f .env ]; then
  cp .env.example .env
  setenv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  setenv API_DB_PASSWORD "$(openssl rand -hex 24)"
  setenv PUBLIC_API_KEY "mlng_pub_$(openssl rand -hex 12)"
  chown $U:$U .env; chmod 600 .env
fi
[ -n "${DUCKDNS_SUBDOMAIN:-}" ] && setenv DUCKDNS_SUBDOMAIN "$DUCKDNS_SUBDOMAIN"
[ -n "${DUCKDNS_TOKEN:-}" ] && setenv DUCKDNS_TOKEN "$DUCKDNS_TOKEN"
setenv APP_VERSION "$(sudo -u $U git -C "$DIR" rev-parse --short=12 HEAD)"

log "4/7 docker compose 실행 (처음 5~10분)"
docker compose up -d --build --wait --wait-timeout 600

log "5/7 요청 시험"
bash scripts/smoke.sh http://localhost

# 공개 IP (IMDSv2)
TOK=$(curl -s --max-time 3 --noproxy '*' -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)
IP=$(curl -s --max-time 3 --noproxy '*' -H "X-aws-ec2-metadata-token: $TOK" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || IP=$(curl -s --max-time 5 https://checkip.amazonaws.com | tr -d '[:space:]' || true)
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || IP="<이 서버 공인 IP>"

log "6/7 도메인 · HTTPS"
SUB="$(getenv DUCKDNS_SUBDOMAIN)"; DTOK="$(getenv DUCKDNS_TOKEN)"; URL="http://$IP"
if [ -n "$SUB" ] && [ -n "$DTOK" ]; then
  r=$(curl -s "https://www.duckdns.org/update?domains=$SUB&token=$DTOK&ip=$IP")
  if [ "$r" = "OK" ]; then
    setenv DOMAIN "$SUB.duckdns.org"; sleep 30   # DNS 반영 대기
    if bash scripts/enable-https.sh; then URL="https://$SUB.duckdns.org"; else log "HTTPS 실패 — HTTP 로 계속 (나중에 bash scripts/enable-https.sh)"; fi
  else log "DuckDNS 갱신 실패 ($r) — 이름 · 토큰 확인"; fi
else log "DuckDNS 값 없음 — HTTP 로 실행 (HTTPS 는 README 의 DuckDNS 단계)"; fi

log "7/7 자동 업데이트 (5분마다)"
cat > /etc/systemd/system/mlng-update.service <<UNIT
[Unit]
Description=MLNG MES 자동 업데이트 (CI 통과한 새 커밋만)
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=/bin/bash $SRV/scripts/autoupdate.sh
UNIT
cat > /etc/systemd/system/mlng-update.timer <<UNIT
[Unit]
Description=MLNG MES 자동 업데이트 5분마다
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload && systemctl enable --now mlng-update.timer || log "systemd 타이머 등록 실패 — 수동: bash scripts/autoupdate.sh"

cat > /home/$U/MLNG_접속정보.txt <<INFO
MLNG MES 자체 서버  ($(date '+%F %T'))
  화면:        $URL
  상태:        $URL/health
  API 문서:    $URL/api/docs
  설정 파일:   $SRV/.env   (Claude 질의: ANTHROPIC_API_KEY 채운 뒤  cd $SRV && docker compose up -d)
  설치 기록:   /var/log/mlng-setup.log
  업데이트 기록: journalctl -u mlng-update -n 50
INFO
chown $U:$U /home/$U/MLNG_접속정보.txt
log "완료 → $URL"
cat /home/$U/MLNG_접속정보.txt
