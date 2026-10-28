# MLNG MES 자체 서버

Supabase(관리형 서비스)가 해 주던 일을 **내 서버에서 직접** 한다. 화면 코드(`web/`)는 그대로 두고, 서버만 갈아 끼운다.

```
                       ┌──────────────────────── VM (Ubuntu) · docker compose ─────────────────────────┐
 브라우저 ── HTTPS ──▶ │ Nginx :443 ──┬── /            → web/ 정적 파일 (화면)                         │
                       │              ├── /js/runtime.js → "이 서버를 써라" (주소 · 공개 키)             │
                       │              └── /rest /functions /health ──▶ FastAPI :8000 ──▶ PostgreSQL :5432 │
                       │                                                     │                           │
                       │                                                     └──▶ Claude API (키는 .env) │
                       │  backup: 매일 pg_dump → backups/ (14일)    certbot: 인증서 발급 · 갱신           │
                       └───────────────────────────────────────────────────────────────────────────────┘
 GitHub ── push ──▶ Actions: 시험(화면 70 · API 13 · 컨테이너 12) ──통과──▶ SSH 로 VM 에 배포 ──▶ 확인
```

| Supabase 일 때 | 자체 서버 | 파일 |
|---|---|---|
| GitHub Pages (화면) | Nginx 정적 파일 + 캐시 · 압축 · 보안 헤더 | `nginx/templates/` |
| Supabase REST API | FastAPI — 같은 PostgREST 문법 (`?col=eq.값&order=…`) | `api/app/rest.py` |
| Supabase PostgreSQL · RLS | PostgreSQL 16 — **같은 SQL 파일**로 같은 표 · 권한 · 행 보안 | `db/` + `../supabase/new_project_setup.sql` |
| Edge Function (mlng-ask) | FastAPI 경로 — 같은 지시 · 도구 (자동 추출) | `api/app/ask.py` |
| Supabase Secrets | `server/.env` (깃에 안 올림) | `.env.example` |
| 자동 배포 | GitHub Actions → SSH → `docker compose up` | `../.github/workflows/deploy.yml` |
| 백업 · 인증서 | `backup` 컨테이너 · certbot | `docker-compose.yml`, `scripts/` |

## 1. 띄우기 (VM 한 대, 약 15분)

1. **VM 만들기** — Ubuntu 24.04, 2 vCPU · 2GB RAM 이상 (AWS Lightsail · 네이버 클라우드 · Oracle 무료 등급 등). 공개 IP 확인.
2. **접속 후 설치 스크립트**
   ```bash
   ssh ubuntu@<VM_IP>
   curl -fsSL https://raw.githubusercontent.com/dksgusrl04-gif/mlng-mes/main/server/scripts/setup-vm.sh | bash -s -- https://github.com/dksgusrl04-gif/mlng-mes.git
   exit            # docker 그룹 적용을 위해 다시 접속
   ssh ubuntu@<VM_IP>
   ```
   Docker 설치 · 방화벽(22/80/443만) · 저장소 받기 · `.env`(무작위 비밀번호) 를 한 번에 한다.
3. **실행**
   ```bash
   cd ~/mlng-mes/server
   nano .env                         # (선택) ANTHROPIC_API_KEY · DOMAIN
   docker compose up -d --build
   bash scripts/smoke.sh             # ✓ 12개
   ```
4. 브라우저에서 `http://<VM_IP>` → 더보기 › 시스템 › 데이터 상태 화면에 `연결됨` 이 보이면 자체 서버에 붙은 것.
   (표가 비어 있는 동안은 Supabase 때와 똑같이 데모 스냅샷을 보여 준다)

## 2. HTTPS (도메인이 있을 때)

1. 도메인 DNS 에 A 레코드 → VM IP
2. `.env` 에 `DOMAIN=mes.example.com`, `LETSENCRYPT_EMAIL=…`
3. `bash scripts/enable-https.sh` — 인증서 발급, Nginx 를 HTTPS 로 교체(HTTP 는 HTTPS 로 넘김), 매일 자동 갱신 등록

## 3. 자동 배포 (push → 시험 → 배포)

1. 내 PC 에서 배포용 키 만들기: `ssh-keygen -t ed25519 -f mlng_deploy -N ""`
2. VM 의 `~/.ssh/authorized_keys` 에 `mlng_deploy.pub` 내용 추가
3. GitHub 저장소 → Settings → Secrets and variables → Actions
   - Secrets: `SSH_HOST`=VM IP · `SSH_USER`=ubuntu · `SSH_KEY`=`mlng_deploy` 파일 내용 전체
   - Variables: `DEPLOY_ENABLED`=`true`
4. 이제 `git push` → «MLNG MES 시험» 통과 → «MLNG MES 서버 배포» 가 VM 에서 새 코드로 다시 띄우고 smoke 확인

## 4. 운영

| 할 일 | 명령 (server/ 에서) |
|---|---|
| 상태 | `docker compose ps` · `curl localhost/health` |
| 로그 | `docker compose logs -f api` (web · db 도 같음) |
| 다시 시작 | `docker compose restart api` |
| 업데이트 (수동) | `git pull && docker compose up -d --build` |
| 백업 목록 | `ls backups/` (매일 자동, 14일 보관) |
| 복원 | `bash scripts/restore.sh backups/mlng_YYYYMMDD_HHMM.sql.gz` |
| DB 직접 보기 | `docker compose exec db psql -U postgres -d mlng` |
| API 문서 | `http://<주소>/api/docs` |

## 5. 보안 설계 (질문 받으면 이렇게)

- **밖에 열린 포트는 80 · 443 뿐.** DB(5432) · API(8000) 는 컨테이너 내부망에만 있다.
- **API 는 DB 관리자 계정을 쓰지 않는다.** `mlng_api` 계정은 표 권한이 없고, 요청마다 `SET LOCAL ROLE anon` 으로 바꿔
  Supabase 와 똑같은 GRANT · RLS 를 DB 가 직접 강제한다 → API 코드에 실수가 있어도 LOT 표 쓰기 · 삭제는 DB 가 막는다.
- **SQL 인젝션 차단:** 표 · 열 이름은 DB 목록에 있는 것만, 값은 전부 바인딩 변수.
- **조건 없는 수정 거부 · 삭제 경로 없음 · 행 수 상한 · 요청 크기 상한 · IP 당 횟수 제한(Nginx + API).**
- **비밀값은 `.env` 에만** (권한 600, 깃 제외). Claude API 키는 브라우저에 절대 내려가지 않는다.
- 컨테이너는 root 가 아닌 사용자로 실행, Nginx 버전 숨김, HSTS · nosniff · frame 제한 헤더.

## 6. 공장 안 서버(온프레미스)로 옮길 때

같은 `docker compose` 를 공장 PC · 미니 서버에 그대로 올리면 된다. 인터넷이 끊겨도 화면 · DB 는 계속 동작하고(질의응답만 멈춤),
설비 데이터가 공장 밖으로 나가지 않는다. 다음 단계: 로그인(JWT · 작업자/관리자 권한) → 설비 신호 수집기(OPC UA · Modbus) 컨테이너 추가.

## 시험

```bash
cd server/api && python -m pytest -q            # PostgREST 해석 · SQL 만들기 13개 (DB 없이)
node server/scripts/export_ask_spec.mjs --check # Edge Function 과 지시 · 도구가 같은지
bash server/scripts/smoke.sh http://localhost   # 실제 서버에 12개 요청
```
