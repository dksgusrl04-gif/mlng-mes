/* 5.3 — 가정값 관리
 * ───────────────────────────────────────────────────────────────
 * 손실 금액 · 출하 판정 · 탄소 · 발주 추천은 단가 · 비율 같은 «가정값» 위에서 계산된다.
 * 한 화면에서 보고 고치고, 실측으로 확인했는지 표시한다. 확인 안 된 값을 쓰는 수치에는 「가정 포함」 이 붙는다.
 *   저장: 이 브라우저(localStorage) + 신뢰 원장에 변경 기록 (누가 · 언제 · 무엇을 · 얼마에서 얼마로)
 *   값은 window.MLNG_CONFIG 를 그 자리에서 바꾼다 → 모든 화면이 다음 그리기부터 새 값으로 계산
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f } = M, CFG = M.CFG;
  const KEY = 'mlng_assume';
  // [경로, 이름, 단위, 종류(cost·ratio·energy·rule·stock), 쓰는 곳 태그들, 설명]
  const DEF = [
    ['원가 · 단가', [
      ['COST.PRICE', '판매 단가', '원/개', 'cost', ['opp'], '브래킷 1개 판매가'],
      ['COST.MARGIN', '공헌이익', '원/개', 'cost', ['opp'], '단가 − 재료비 − 변동 가공비 (기회 손실 계산)'],
      ['COST.SCRAP.press', '불량 원가 · 프레스', '원/개', 'cost', ['loss'], '그 공정까지 들어간 재료 · 가공비'],
      ['COST.SCRAP.weld', '불량 원가 · 점용접', '원/개', 'cost', ['loss'], ''],
      ['COST.SCRAP.heat', '불량 원가 · 열처리', '원/개', 'cost', ['loss'], ''],
      ['COST.SCRAP.mach', '불량 원가 · MCT 가공', '원/개', 'cost', ['loss'], ''],
      ['COST.MACH_PART_PRICE', '가공 부품 단가', '원/개', 'cost', ['loss'], '검사 보류 재고 금액'],
      ['COST.INSERT', '인서트 단가', '원/개', 'cost', ['loss'], '페이스커터 인서트'],
      ['COST.INSP_PART', '전수 측정 비용', '원/개', 'cost', ['loss'], ''],
      ['COST.MAINT', '설비 점검 1회', '원', 'cost', ['loss'], ''],
      ['COST.PLAN_PRICE', '결품 손실 (계획 품목)', '원/개', 'cost', ['loss'], ''],
    ]],
    ['클레임 · 출하 보류', [
      ['COST.CLAIM_FIXED', '클레임 대응 고정비', '원/건', 'cost', ['loss', 'gate'], '고객 대응 · 보고서 · 회의'],
      ['COST.CLAIM_PER_PART', '클레임 선별 · 재검사', '원/개', 'cost', ['loss', 'gate'], ''],
      ['COST.HOLD_FIXED', '출하 보류 고정비', '원/건', 'cost', ['gate'], '재검사 · 일정 조정'],
      ['COST.HOLD_PER_PART', '출하 보류 개당 비용', '원/개', 'cost', ['gate'], '보관 · 선별'],
    ]],
    ['위험 가정', [
      ['COST.OVERWEAR_DEFECT', '마모 초과 가공 불량률', '%', 'ratio', ['loss'], '교체 기준을 넘긴 공구로 가공한 부품 중 불량 비율'],
      ['COST.STOP_P', '진동 방치 → 고장 확률', '%', 'ratio', ['loss'], ''],
      ['COST.STOP_H', '고장 시 정지 시간', 'h', 'ratio', ['loss'], ''],
    ]],
    ['에너지 · 탄소', [
      ['COST.KWH', '산업용 전기 요금', '원/kWh', 'energy', ['loss', 'pcf'], ''],
      ['COST.CO2_WON', '탄소 비용', '원/kgCO2e', 'energy', ['loss'], '배출권 가격'],
      ['PCF.EF_KWH', '전력 배출계수', 'kgCO2e/kWh', 'energy', ['pcf'], '국가 고시값으로 교체'],
      ['PCF.STEEL_KG', '브래킷 1개 강판 중량', 'kg', 'energy', ['pcf'], ''],
      ['PCF.STEEL_EF', '강판 배출계수', 'kgCO2e/kg', 'energy', ['pcf'], '공급사 제공값으로 교체'],
    ]],
    ['재고 · 계획', [
      ['BUY.MACH_STOCK', '인서트 현재 재고', '개', 'stock', ['buy'], '재고 시스템 연동 전 수기값'],
      ['BUY.MACH_WEEKS', '인서트 확보 기간', '주', 'stock', ['buy'], ''],
      ['PLAN.SAFETY_DAYS', '안전재고 비율', '%', 'stock', ['buy'], '예상 수주 대비'],
    ]],
    ['설비 · OEE', [
      ['OEE.PLANNED.PR-01', '계획 가동 · 프레스', '분/일', 'ratio', ['oee'], '1교대 8h − 휴식'],
      ['OEE.PLANNED.SP-01', '계획 가동 · 점용접', '분/일', 'ratio', ['oee'], ''],
      ['OEE.PLANNED.SB-01', '계획 가동 · 열처리 (최대)', '분/일', 'ratio', ['oee'], '실제 작업 시각 기준, 이 값으로 상한'],
      ['OEE.PLANNED.MC-01', '계획 가동 · MCT', '분/일', 'ratio', ['oee'], ''],
      ['OEE.PLANNED.IN-01', '계획 가동 · 검사', '분/일', 'ratio', ['oee'], ''],
      ['OEE.TARGET', 'OEE 목표', '%', 'rule', ['rule'], '세계 수준 85%'],
      ['SIGNAL.OEE_GREEN', '신호등 초록 기준', '%', 'rule', ['rule'], ''],
      ['SIGNAL.OEE_YELLOW', '신호등 노랑 기준', '%', 'rule', ['rule'], ''],
    ]],
    ['관리 기준', [
      ['PRESS.TARGET_PPM', '프레스 불량률 관리 기준', 'PPM', 'rule', ['rule'], ''],
      ['HEAT.DEVIATION_RATE', '열처리 조건 이탈 판정', '%', 'rule', ['rule', 'gate'], '작업 시간 중 허용 범위 밖 비율'],
      ['HEAT.HEATER_DRIFT_PP', '히터 출력 증가 경보', '%p', 'rule', ['rule'], ''],
      ['MACH.VB_LIMIT', '공구 교체 기준 VB', 'mm', 'rule', ['rule', 'buy'], ''],
      ['MACH.VB_WARN', '공구 주의 기준 VB', 'mm', 'rule', ['rule'], ''],
    ]],
  ];
  const ITEMS = [].concat(...DEF.map(([g, xs]) => xs.map(([p, n, u, k, tags, d]) => ({ g, p, n, u, k, tags, d }))));
  const TAGN = { oee: 'OEE', loss: '손실 금액', gate: '출하 판정', opp: '기회 손실', pcf: '탄소 배출량', buy: '발주 추천', rule: '알람 기준' };
  const TAGGO = { oee: 'oee', loss: 'cost', gate: 'gate', opp: 'cost', pcf: 'pass_pcf', buy: 'buy_home', rule: 'alerts' };
  const pct = it => it.u === '%';

  // 경로 읽기 · 쓰기 (config 객체를 그 자리에서)
  const get = p => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), CFG);
  const set = (p, v) => { const ks = p.split('.'), last = ks.pop(); let o = CFG; ks.forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[last] = v; };
  const BASE = {}; ITEMS.forEach(it => { BASE[it.p] = get(it.p); });   // config.js 기본값

  // 저장된 값 · 확인 상태 적용
  let ST = {}; try { ST = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { ST = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) { /* 저장 못 해도 이번 화면에는 반영 */ } };
  ITEMS.forEach(it => { const s = ST[it.p]; if (s && s.v != null && isFinite(s.v)) set(it.p, s.v); });
  const LOG = [];   // 이번 세션 변경 이력 (원장에도 남는다)

  const verified = it => !!(ST[it.p] && ST[it.p].ok);
  const isAssume = it => it.k !== 'rule' && !verified(it);
  // 「가정 포함」 표시: 태그를 쓰는 값 중 실측 확인 안 된 것이 있으면
  M.asmTag = (...tags) => {
    const xs = ITEMS.filter(it => it.tags.some(t => tags.includes(t)) && isAssume(it)); if (!xs.length) return '';
    const tip = `가정값 ${xs.length}개 포함 — ${xs.slice(0, 4).map(it => `${it.n} ${fmt(it)}`).join(', ')}${xs.length > 4 ? ' 외' : ''} · 더보기 › 가정값 관리에서 수정`;
    return `<span class="asm" data-go="assume" title="${esc(tip)}">가정 포함</span>`;
  };
  M.asmCount = () => ITEMS.filter(isAssume).length;
  const fmt = it => { const v = get(it.p); return v == null ? '—' : pct(it) ? `${f(v * 100, v * 100 < 10 ? 1 : 0)}%` : `${f(v, v < 10 && v % 1 ? (v < 1 ? 4 : 2) : 0)}${it.u.startsWith('%') ? it.u : ''}`; };

  async function commit(changes, verifyMap) {
    const T = window.MLNGTrust, by = M.D.user().name, at = new Date().toLocaleString('sv-SE').slice(0, 16);
    for (const [p, v] of changes) {
      const it = ITEMS.find(x => x.p === p), old = get(p); set(p, v);
      ST[p] = Object.assign({}, ST[p], { v, at, by });
      LOG.unshift({ at, by, n: it.n, from: old, to: v, it });
      if (T && T.ready) await T.append('MLNG', 'config', p, `가정값 변경 — ${it.n} ${old} → ${v}`.slice(0, 160), { path: p, from: old, to: v, by });
    }
    Object.entries(verifyMap).forEach(([p, ok]) => { ST[p] = Object.assign({}, ST[p], { ok, okAt: at, okBy: by }); });
    save();
  }

  let msg = '';
  const V = {};
  V.assume = () => {
    const nA = ITEMS.filter(isAssume).length, nOk = ITEMS.filter(it => it.k !== 'rule' && verified(it)).length, nCh = ITEMS.filter(it => get(it.p) !== BASE[it.p]).length;
    const used = [...new Set([].concat(...ITEMS.filter(isAssume).map(it => it.tags)))];
    const row = it => { const v = get(it.p), ch = v !== BASE[it.p], s = ST[it.p] || {};
      return `<tr class="${ch ? 'chg' : ''}"><td><b>${esc(it.n)}</b>${it.d ? `<div class="muted sm1">${esc(it.d)}</div>` : ''}</td>
        <td class="n"><input class="in num" type="number" step="any" data-ap="${esc(it.p)}" value="${v == null ? '' : pct(it) ? +(v * 100).toFixed(4) : v}"></td>
        <td class="muted">${esc(it.u)}</td><td class="n muted">${BASE[it.p] == null ? '—' : pct(it) ? f(BASE[it.p] * 100, 1) : f(BASE[it.p], BASE[it.p] % 1 ? 4 : 0)}</td>
        <td>${it.k === 'rule' ? '<span class="ast rule">관리 기준</span>' : `<label class="ack"><input type="checkbox" data-ok="${esc(it.p)}" ${verified(it) ? 'checked' : ''}> <span class="ast ${verified(it) ? 'ok' : 'as'}">${verified(it) ? '실측 확인' : '가정'}</span></label>`}</td>
        <td>${it.tags.map(t => `<a href="#" class="atag" data-go="${TAGGO[t]}">${TAGN[t]}</a>`).join('')}</td>
        <td class="muted sm1">${s.at ? `${esc(s.at.slice(5))} · ${esc(s.by || '')}` : '—'}</td></tr>`; };
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">가정값</div><div class="val" style="color:${nA ? 'var(--warn-ink)' : 'var(--ok)'}">${nA}<small>개</small></div><div class="foot">실측 확인 전 · 「가정 포함」 표시 대상</div></div>
      <div class="kpi"><div class="lab">실측 확인</div><div class="val">${nOk}<small>개</small></div><div class="foot">원가표 · 고지서 등으로 확인한 값</div></div>
      <div class="kpi"><div class="lab">기본값에서 변경</div><div class="val">${nCh}<small>개</small></div><div class="foot">변경 내용은 신뢰 원장에 기록</div></div>
      <div class="kpi"><div class="lab">가정 포함 수치</div><div class="val">${used.length}<small>종</small></div><div class="foot">${used.map(t => TAGN[t]).join(' · ') || '없음'}</div></div>
    </div>
    <div class="card"><h2>가정값 목록 <span class="h2sub">값을 고치고 저장하면 모든 화면이 새 값으로 다시 계산됩니다. 실측으로 확인한 값은 체크하면 「가정 포함」 표시에서 빠집니다.</span>
      <span class="more" style="display:flex;gap:6px"><button class="btn sm" id="as-reset">기본값으로</button><button class="btn pri sm" id="as-save">저장</button></span></h2>
      <div class="tbx"><table class="tb atab"><colgroup><col class="c-an"><col class="c-av"><col class="c-au"><col class="c-ab"><col class="c-as"><col class="c-at"><col class="c-ad"></colgroup>
        <thead><tr><th>항목</th><th class="n">현재값</th><th>단위</th><th class="n">기본값</th><th>상태</th><th>쓰는 곳</th><th>최근 변경</th></tr></thead>
        <tbody>${DEF.map(([g]) => `<tr class="agrp"><td colspan="7">${esc(g)}</td></tr>` + ITEMS.filter(it => it.g === g).map(row).join('')).join('')}</tbody></table></div>
      ${msg ? `<p class="note msg">${esc(msg)}</p>` : ''}</div>
    ${LOG.length ? `<div class="card"><h2>변경 이력 <span class="h2sub">이번 접속</span><a class="more" href="#" data-go="net_ledger">신뢰 원장 →</a></h2>
      ${M.table([['시각', 'at'], ['항목', x => `<b>${esc(x.n)}</b>`], ['변경 전', x => esc(String(x.from)), 'n'], ['변경 후', x => `<b>${esc(String(x.to))}</b>`, 'n'], ['변경자', 'by']], LOG, { wrap: false })}</div>` : ''}`;
  };

  M.mod({
    id: 'assume', group: '시스템', order: 98,
    menu: [['assume', '가정값 관리', 'book']],
    views: V,
    bind(root) {
      const sv = root.querySelector('#as-save'), rs = root.querySelector('#as-reset'); if (!sv) return;
      sv.onclick = async () => {
        const ch = [], ok = {};
        root.querySelectorAll('[data-ap]').forEach(i => { const it = ITEMS.find(x => x.p === i.dataset.ap), raw = i.value.trim(); if (raw === '') return;
          let v = Number(raw); if (!isFinite(v)) return; if (pct(it)) v = +(v / 100).toFixed(6); if (v !== get(it.p)) ch.push([it.p, v]); });
        root.querySelectorAll('[data-ok]').forEach(c => { if (c.checked !== verified(ITEMS.find(x => x.p === c.dataset.ok))) ok[c.dataset.ok] = c.checked; });
        if (!ch.length && !Object.keys(ok).length) { msg = '바뀐 값이 없습니다'; M.render(); return; }
        sv.disabled = true; await commit(ch, ok);
        msg = `저장 완료 — 값 ${ch.length}개 변경${Object.keys(ok).length ? ` · 확인 상태 ${Object.keys(ok).length}개` : ''}. 손실 금액 · 출하 판정 등이 새 값으로 다시 계산됩니다.`; M.render();
      };
      rs.onclick = async () => { const ch = ITEMS.filter(it => get(it.p) !== BASE[it.p]).map(it => [it.p, BASE[it.p]]); await commit(ch, {}); msg = `기본값으로 되돌림 — ${ch.length}개`; M.render(); };
    },
  });
})();
