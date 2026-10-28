#!/usr/bin/env bash
# HTTPS 켜기 — 도메인이 이 서버 IP 를 가리킨 뒤 실행 (DNS A 레코드 또는 DuckDNS)
#   bash scripts/enable-https.sh
# Let's Encrypt 인증서(90일, 무료)를 받고 .env 에 NGINX_MODE=https → Nginx 를 HTTPS 구성으로 다시 띄운다.
# 추적 파일은 고치지 않는다 (자동 업데이트의 git checkout 과 부딪히지 않게). 갱신은 cron 에 등록.
set -euo pipefail
cd "$(dirname "$0")/.."
getenv() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
setenv() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
DOMAIN="$(getenv DOMAIN)"; EMAIL="$(getenv LETSENCRYPT_EMAIL)"
[ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ] || { echo ".env 의 DOMAIN 을 채우세요"; exit 1; }
MAIL=(--register-unsafely-without-email); [ -n "$EMAIL" ] && MAIL=(--email "$EMAIL" --no-eff-email)

echo "[1/3] 인증서 발급 ($DOMAIN) — HTTP 로 소유 확인"
setenv NGINX_MODE http; docker compose up -d web
docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" "${MAIL[@]}" --agree-tos --non-interactive --keep-until-expiring

echo "[2/3] Nginx HTTPS 구성 (HTTP 는 HTTPS 로 넘김)"
setenv NGINX_MODE https
docker compose up -d --force-recreate web

echo "[3/3] 자동 갱신 — 매일 03:17"
LINE="17 3 * * * cd $(pwd) && docker compose run --rm certbot renew --quiet && docker compose exec -T web nginx -s reload"
( crontab -l 2>/dev/null | grep -v 'certbot renew' ; echo "$LINE" ) | crontab -
echo "완료 → https://$DOMAIN"
