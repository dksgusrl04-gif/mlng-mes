"""질의응답 중계 — supabase/functions/mlng-ask/index.ts 를 그대로 옮긴 것.

Claude API 키는 서버 환경변수(ANTHROPIC_API_KEY)에만 있다. 브라우저는 질문과 도구 결과만 보낸다.
시스템 지시 · 도구 정의는 ask_spec.json (index.ts 에서 자동 추출 — server/scripts/export_ask_spec.mjs) → 브라우저가 바꿀 수 없다.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx

from . import settings as S

SPEC = json.loads((Path(__file__).parent / 'ask_spec.json').read_text(encoding='utf-8'))
_client: httpx.AsyncClient | None = None


async def close():
    if _client:
        await _client.aclose()


async def handle(raw: bytes) -> tuple[int, dict]:
    global _client
    if not S.ANTHROPIC_API_KEY:
        return 503, {'error': 'ANTHROPIC_API_KEY 가 설정되지 않았습니다'}
    if len(raw) > S.ASK_MAX_BODY:
        return 413, {'error': '요청이 너무 큽니다'}
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        return 400, {'error': 'JSON 이 아닙니다'}
    msgs = body.get('messages') if isinstance(body, dict) else None
    msgs = list(msgs[-S.ASK_MAX_MSGS:]) if isinstance(msgs, list) else []
    while msgs and not (isinstance(msgs[0], dict) and msgs[0].get('role') == 'user'):   # 첫 메시지는 user
        msgs.pop(0)
    if not msgs:
        return 400, {'error': 'messages 가 비어 있습니다'}
    system = SPEC['system'] + f"\n\n데이터 기준 시각: {str(body.get('asof') or '')[:19]} · 공장: {str(body.get('plant') or '')[:40]}"
    _client = _client or httpx.AsyncClient(timeout=60)
    try:
        r = await _client.post('https://api.anthropic.com/v1/messages',
                               headers={'x-api-key': S.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
                               json={'model': S.ASK_MODEL or SPEC['model'], 'max_tokens': S.ASK_MAX_OUT, 'system': system, 'tools': SPEC['tools'], 'messages': msgs})
    except httpx.HTTPError as e:
        return 502, {'error': f'Claude API 연결 실패: {e.__class__.__name__}'}
    j = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
    if r.status_code >= 400:
        return 502, {'error': (j.get('error') or {}).get('message') or f'Claude API {r.status_code}'}
    return 200, {'stop_reason': j.get('stop_reason'), 'content': j.get('content'), 'usage': j.get('usage')}
