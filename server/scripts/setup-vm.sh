#!/usr/bin/env bash
# 새 Ubuntu 22.04/24.04 VM 에서 한 번 실행 — Docker 설치 · 방화벽 · 저장소 받기 · .env 준비
#   curl -fsSL https://raw.githubusercontent.com/dksgusrl04-gif/mlng-mes/main/server/scripts/setup-vm.sh | bash -s -- https://github.com/dksgusrl04-gif/mlng-mes.git
set -euo pipefail
REPO="${1:?저장소 주소를 주세요 (예: https://github.com/dksgusrl04-gif/mlng-mes.git)}"
DIR="$HOME/mlng-mes"

echo "[1/5] 패키지 업데이트 · 기본 도구"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git ufw openssl

echo "[+] 메모리가 2GB 보다 작으면 스왑 2GB 추가 (무료 t3.micro 1GB 에서도 빌드가 멈추지 않게)"
if [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 1900000 ] && ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "[2/5] Docker 설치 (공식 스크립트)"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; fi
sudo usermod -aG docker "$USER"

echo "[3/5] 방화벽 — SSH(22) · HTTP(80) · HTTPS(443) 만 연다 (DB 5432 · API 8000 은 닫힌 채)"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo "[4/5] 저장소 받기"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi

echo "[5/5] .env 만들기 (비밀번호 · 공개 키는 무작위로)"
cd "$DIR/server"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
  sed -i "s/^API_DB_PASSWORD=.*/API_DB_PASSWORD=$(openssl rand -hex 24)/" .env
  sed -i "s/^PUBLIC_API_KEY=.*/PUBLIC_API_KEY=mlng_pub_$(openssl rand -hex 12)/" .env
  chmod 600 .env
fi
echo
echo "완료. 다음:"
echo "  1) 로그아웃 후 다시 접속 (docker 그룹 적용)"
echo "  2) nano $DIR/server/.env   # ANTHROPIC_API_KEY · DOMAIN 채우기 (선택)"
echo "  3) cd $DIR/server && docker compose up -d --build"
echo "  4) bash scripts/smoke.sh   # 동작 확인"
