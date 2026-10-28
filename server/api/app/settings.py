"""환경변수 → 설정. 값은 server/.env 에서 docker compose 가 넣어 준다 (키를 코드·깃에 두지 않는다)."""
import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://mlng_api:mlng_api@db:5432/mlng')
# 브라우저가 apikey 헤더로 보내는 공개 키 (Supabase anon 키와 같은 역할 — 공개돼도 되는 값).
# 비워 두면 검사하지 않는다 (로컬 개발용).
PUBLIC_API_KEY = os.environ.get('PUBLIC_API_KEY', '')
# DB 안에서 요청을 실행할 역할 — RLS · 권한을 Supabase 의 anon 과 똑같이 적용받는다
DB_REQUEST_ROLE = os.environ.get('DB_REQUEST_ROLE', 'anon')
ALLOW_ORIGINS = [o.strip() for o in os.environ.get('ALLOW_ORIGINS', '*').split(',') if o.strip()]
MAX_ROWS = _int('MAX_ROWS', 5000)
MAX_BODY = _int('MAX_BODY', 200_000)
WRITE_RATE_N = _int('WRITE_RATE_N', 300)          # IP 당 쓰기 요청
WRITE_RATE_MIN = _int('WRITE_RATE_MIN', 10)       #   이 시간(분) 안에

# 질의응답 (Claude API 중계)
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
ASK_MODEL = os.environ.get('ASK_MODEL', '')
ASK_RATE_N = _int('ASK_RATE_N', 30)
ASK_RATE_MIN = _int('ASK_RATE_MIN', 10)
ASK_MAX_BODY = 90_000
ASK_MAX_MSGS = 30
ASK_MAX_OUT = 800

VERSION = os.environ.get('APP_VERSION', 'dev')
