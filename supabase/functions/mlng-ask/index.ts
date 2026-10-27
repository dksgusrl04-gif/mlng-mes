// ═══════════════════════════════════════════════════════════════
// MLNG MES 질의응답 중계 — Claude API 키를 브라우저에서 감춘다
// ═══════════════════════════════════════════════════════════════
// 브라우저가 Anthropic 을 직접 부르면 키가 노출되고 누구나 그 키로 요금을 태울 수 있다.
// 그래서 이 함수가 대신 부른다. 키는 Supabase 비밀값(ANTHROPIC_API_KEY)으로만 있다.
//
// 흐름 (도구 실행은 브라우저에서)
//   브라우저 ──질문──> mlng-ask ──(키)──> Claude
//   Claude 가 자료가 필요하면 tool_use 를 돌려준다 → 브라우저가 지금 열린 MES 데이터에서 찾아 tool_result 로 다시 보낸다
//   → 원본 데이터 전체를 보내지 않고, 화면의 값과 답의 값이 같다
//
// 배포 (PowerShell, 한 줄씩)
//   supabase functions deploy mlng-ask --no-verify-jwt
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// 로그인 없는 공개 시연이라 지키는 것
//   · 도구 정의·시스템 지시는 여기서만 정한다 (브라우저가 바꿀 수 없다)
//   · 요청 크기·대화 길이·출력 길이 상한, IP 당 호출 횟수 제한
//   · Anthropic 콘솔에서 월 사용 한도(Spend limit)를 꼭 걸어 둔다

const MODEL = Deno.env.get('ASK_MODEL') || 'claude-haiku-4-5-20251001';   // 이미 계산된 값을 골라 설명하는 일 → 빠른 모델로 충분
const MAX_BODY = 90_000;        // 요청 크기 상한 (바이트)
const MAX_MSGS = 30;            // 대화 메시지 수 상한 (도구 왕복 포함)
const MAX_OUT = 800;            // 답 길이 상한 (토큰)
const RATE_N = Number(Deno.env.get('ASK_RATE_N') || 30);          // IP 당
const RATE_WIN = Number(Deno.env.get('ASK_RATE_MIN') || 10) * 60_000;   //   이 시간(분) 안에 최대 RATE_N 번
const ALLOW = (Deno.env.get('ASK_ALLOW_ORIGIN') || '*');            // 예: https://dksgusrl04-gif.github.io

const CORS = {
  'Access-Control-Allow-Origin': ALLOW,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SYSTEM = `당신은 MLNG MES(중소 제조 모듈형 MES)의 공정 분석 담당이다.
대상 공장은 자동차 시트용 강판 브래킷(시트 트랙 스토퍼 브래킷)을 프레스 성형 → 점용접 → 염욕 열처리 → MCT 가공 → 정밀가공 검사 순서로 만든다.
구매(발주·3단계 전자결재·발주서)와 생산 계획·작업지시도 같은 MES 안에 있다.
2.0 연결·신뢰 계층(trust_network 도구): 완성차 A · 1차 협력사 B · 우리(C) · 강판 공급사 D 가 서명된 데이터 공유 계약으로 연결되고, LOT 디지털 여권 · 스마트 발주(조건부 자동 검수·클레임) · 공정 능력 증명서 · AI 에이전트 조치가 모두 해시 사슬 신뢰 원장에 남는다.

지켜야 할 것
- 숫자는 반드시 도구로 조회한 값만 쓴다. 조회하지 않은 값을 지어내지 않는다. 자료에 없으면 "자료에 없습니다" 라고 말한다.
- 질문에 답하려면 어떤 도구가 필요한지 먼저 생각하고, 필요한 것만 조회한다. 여러 공정이 얽힌 질문은 각 공정을 조회한 뒤 연결해서 설명한다.
- 원인을 말할 때는 "후보" 로 말하고, 근거가 된 알림·값을 함께 든다.
- 조치가 필요하면 무엇을 먼저 할지 한 줄로 제안한다 (예: 어느 화면을 보라, 어떤 발주가 결재 대기다).
- 3.0: 우선순위는 돈(money_overview·cases 의 금액)으로 판단하고, 사용자가 «해줘·올려줘·보류해» 처럼 지시하면 propose_action 으로 제안 카드를 만든다. 실행은 사용자가 승인해야 된다고 말한다.
- «만약 ~하면» 질문은 what_if 로 계산한 숫자로 답하고, 가정이 들어간 값은 가정이라고 밝힌다.
- 한국어로, 결론을 첫 줄에. 5~7줄 안쪽. 머리말·맺음말은 쓰지 않는다. 강조는 **굵게** 만 쓴다.`;

// 도구 — 이름·입력은 web/js/mod_ask.js 의 TOOLS 와 같아야 한다
const TOOLS = [
  { name: 'overview', description: '공장 전체 요약: 공정별 핵심 지표와 상태, 알림 개수, 데이터 기준 시각', input_schema: { type: 'object', properties: {} } },
  { name: 'alerts', description: '현장 알림 목록 (긴급·주의 순). process 를 주면 그 공정만', input_schema: { type: 'object', properties: { process: { type: 'string', description: '프레스 · 용접 · 열처리 · MCT 가공 · 검사 · 계획 · 구매 중 하나 (생략하면 전체)' } } } },
  { name: 'process_detail', description: '한 공정의 요약 지표, 알림, 최근 LOT(수량·불량)', input_schema: { type: 'object', properties: { process: { type: 'string', description: 'press · weld · heat · mach · insp · plan 또는 한글 공정명' } }, required: ['process'] } },
  { name: 'lot_trace', description: 'LOT 하나의 정보와 앞 공정(소재·원인 추적)·뒤 공정(영향 범위) LOT', input_schema: { type: 'object', properties: { lot_id: { type: 'string', description: '예: HT-102410' } }, required: ['lot_id'] } },
  { name: 'line_status', description: '라인 운영: 목표 대비 하루 가능 산출, 병목 공정, 설비 능력 한계, 공정 사이 재공 증감', input_schema: { type: 'object', properties: {} } },
  { name: 'mach_tools', description: 'MCT 최근 공구 10개의 재질·가공 조건·최종 마모(VB)·마모 속도·가공 횟수', input_schema: { type: 'object', properties: {} } },
  { name: 'plan_status', description: '생산 계획 품목별 마감 재고, 최근 7일 평균 수주·생산', input_schema: { type: 'object', properties: {} } },
  { name: 'purchase_orders', description: '발주 목록(품목·수량·결재 단계·상태)과 최근 활동 기록. status: pending(결재 대기) · approved(결재 완료·미입고) · received(입고 완료)', input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'approved', 'received'] } } } },
  { name: 'buy_recommendations', description: '알림·사용량에서 계산한 발주 추천 품목(수량·사유)과 공구 주문에 등록된 전체 품목 목록', input_schema: { type: 'object', properties: {} } },
  { name: 'money_overview', description: '3.0 돈 환산: 30일 품질 손실(COPQ)과 매출 대비 비율, 공정별 손실, 매일 새는 돈(히터 낭비 전력), 라인 기회 손실, 금액이 큰 알림 순위와 계산 근거', input_schema: { type: 'object', properties: {} } },
  { name: 'cases', description: '3.0 사건실: 알림을 묶은 사건 목록(단계·금액·영향 LOT·다음 조치). case_id 를 주면 영향 LOT·원인 후보(근거 강도)·조치 목록·처음 징후', input_schema: { type: 'object', properties: { case_id: { type: 'string', description: '예: CS-HEAT-220706' } } } },
  { name: 'ship_gate', description: '3.0 출하 게이트: 출하 대기 LOT 마다 고객 계약 조항 미리 판정(만족·근접·미달), 보류 권고 사유, 다음 LOT 기준 초과 확률', input_schema: { type: 'object', properties: {} } },
  { name: 'what_if', description: '3.0 What-if: 손잡이를 바꿨을 때 하루 산출·병목·판단 이익·불량·인서트 비용·탄소·계약 충족을 지금과 비교. 생략한 손잡이는 지금 값', input_schema: { type: 'object', properties: { target: { type: 'number', description: '목표 산출 개/일' }, press: { type: 'number', description: '프레스 속도 % (70~130)' }, weld: { type: 'number', description: '점용접기 대수 1~3' }, heat: { type: 'number', description: '열처리 가동 % (80~130)' }, vb: { type: 'number', description: '공구 교체 기준 VB mm (0.25~0.7)' }, heater: { type: 'boolean', description: '소입로 히터 정비 여부' }, dev: { type: 'number', description: '열처리 설정값 이탈 작업 비율 % (0~40)' } } } },
  { name: 'shift_brief', description: '3.0 교대 인수인계: 이번 교대 생산·새 알림·열린 사건·다음 교대가 꼭 할 일', input_schema: { type: 'object', properties: {} } },
  { name: 'propose_action', description: '조치를 «제안 카드» 로 화면에 올린다. 사용자가 승인 버튼을 눌러야 실행된다(직접 실행 불가). kind: case_action(case_id, action_id) · maint(target 설비·구역, reason — 에이전트 점검 조치안) · hold_lot(lot, reason) · release_lot(lot) · ship_lot(lot) · purchase(items=등록 품목 코드 배열, reason) · whatif_apply(levers)', input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['case_action', 'maint', 'hold_lot', 'release_lot', 'ship_lot', 'purchase', 'whatif_apply'] }, case_id: { type: 'string' }, action_id: { type: 'string' }, target: { type: 'string' }, lot: { type: 'string' }, items: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' }, levers: { type: 'object' } }, required: ['kind'] } },
  { name: 'trust_network', description: '2.0 연결·신뢰 계층: 회사 간 데이터 공유 계약(상태·접근 기록), 스마트 발주(자동 검수 합격·클레임), LOT 디지털 여권(단계·탄소), 공정 능력 증명서, AI 에이전트 승인 대기 조치, 신뢰 원장 검증 결과. part 로 일부만 조회', input_schema: { type: 'object', properties: { part: { type: 'string', enum: ['all', 'contracts', 'orders', 'passports', 'credentials', 'agent', 'ledger'] } } } },
];

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < RATE_WIN);
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > RATE_N;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST 로 보내세요' }, 405);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다' }, 503);

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return json({ error: '질문이 너무 잦습니다 — 잠시 후 다시 시도하세요' }, 429);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: '요청이 너무 큽니다' }, 413);
  let body: { messages?: unknown[]; asof?: string; plant?: string };
  try { body = JSON.parse(raw); } catch { return json({ error: 'JSON 이 아닙니다' }, 400); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MSGS) : [];
  if (!messages.length) return json({ error: 'messages 가 비어 있습니다' }, 400);
  // 첫 메시지는 user 여야 한다 (잘라낸 뒤 어긋나면 맞춘다)
  while (messages.length && (messages[0] as { role?: string }).role !== 'user') messages.shift();

  const system = SYSTEM + `\n\n데이터 기준 시각: ${String(body.asof || '').slice(0, 19)} · 공장: ${String(body.plant || '').slice(0, 40)}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_OUT, system, tools: TOOLS, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: (j as { error?: { message?: string } }).error?.message || `Claude API ${r.status}` }, 502);
  return json({ stop_reason: j.stop_reason, content: j.content, usage: j.usage });
});
