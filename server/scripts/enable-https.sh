#!/usr/bin/env bash
# HTTPS 켜기 — 도메인이 이 서버 IP 를 가리킨 뒤 실행 (DNS A 레코드)
#   bash scripts/enable-https.sh
# Let's Encrypt 인증서(90일)를 받고, Nginx 를 HTTPS 로 바꾼다. 갱신은 cron 에 등록한다.
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"; EMAIL="$(grep -E '^LETSENCRYPT_EMAIL=' .env | cut -d= -f2-)"
[ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ] || { echo ".env 의 DOMAIN 을 채우세요"; exit 1; }
[ -n "$EMAIL" ] || { echo ".env 의 LETSENCRYPT_EMAIL 을 채우세요"; exit 1; }

echo "[1/3] 인증서 발급 ($DOMAIN) — HTTP 로 소유 확인"
docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email

echo "[2/3] Nginx 를 HTTPS 구성으로 교체 (HTTP 는 HTTPS 로 넘김)"
cp nginx/templates/default.conf.template nginx/templates/default.conf.template.http-only.bak
cp nginx/optional/default.conf.template nginx/templates/default.conf.template
cp nginx/optional/https.conf.template nginx/templates/https.conf.template
docker compose up -d --force-recreate web

echo "[3/3] 자동 갱신 — 매일 03:17 갱신 시도 후 Nginx 다시 읽기"
LINE="17 3 * * * cd $(pwd) && docker compose run --rm certbot renew --quiet && docker compose exec -T web nginx -s reload"
( crontab -l 2>/dev/null | grep -v 'certbot renew' ; echo "$LINE" ) | crontab -
echo "완료 → https://$DOMAIN"
