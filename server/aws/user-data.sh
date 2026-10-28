#!/bin/bash
# EC2 «사용자 데이터» 에 이 내용을 그대로 붙여 넣는다 (인스턴스 시작 → 고급 세부 정보 → 사용자 데이터)
# 첫 부팅 때 root 로 한 번 실행: 저장소 받기 → server/aws/bootstrap.sh (설치 · 실행 · 자동 업데이트)
# 진행 상황: EC2 Instance Connect 로 접속 후  tail -f /var/log/mlng-setup.log
# HTTPS(선택): 아래 두 줄에 DuckDNS 값을 넣으면 https://<이름>.duckdns.org 로 자동 발급
DUCKDNS_SUBDOMAIN=""
DUCKDNS_TOKEN=""
REPO="https://github.com/dksgusrl04-gif/mlng-mes.git"

exec > >(tee -a /var/log/mlng-setup.log) 2>&1
apt-get update -y && apt-get install -y git
sudo -u ubuntu git clone "$REPO" /home/ubuntu/mlng-mes || sudo -u ubuntu git -C /home/ubuntu/mlng-mes pull --ff-only
DUCKDNS_SUBDOMAIN="$DUCKDNS_SUBDOMAIN" DUCKDNS_TOKEN="$DUCKDNS_TOKEN" bash /home/ubuntu/mlng-mes/server/aws/bootstrap.sh
