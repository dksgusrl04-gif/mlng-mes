/* 질의응답 모듈 — "물어보면 답하는 MES"
 * ───────────────────────────────────────────────────────────────
 * 두 엔진
 *   Claude  — Supabase Edge Function(mlng-ask) 이 Claude API 를 중계한다. API 키는 함수 비밀값에만 있고 브라우저로 오지 않는다.
 *             Claude 가 필요한 자료를 «도구» 로 요청하면, 이 화면이 지금 열린 데이터에서 찾아 돌려준다 (도구 실행은 브라우저에서).
 *             → 화면에 보이는 값과 답의 값이 언제나 같다. 원본 데이터 전체를 보내지 않는다.
 *   규칙    — 중계 함수가 없거나 연결이 안 되면, 자주 묻는 질문은 규칙으로 바로 답한다 (네트워크 없이도 동작).
 * 도구 이름·설명은 supabase/functions/mlng-ask/index.ts 의 TOOLS 와 같아야 한다.
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f } = M;
  const MAX_TURNS = 6, MAX_LOOP = 5, MAX_RESULT = 7000;
  const chat = [];                 // { role:'user'|'bot', text, engine, tools, links }
  let busy = false, draft = '';

  // ── 도구: 지금 열린 데이터에서 찾아 돌려준다
  const sums = () => M.mods.filter(m => m.summary).map(m => { try { const s = m.summary(M.S) || {}; return { proc: M.PROC[m.proc] || m.proc, kpi: s.kpi, detail: s.sub || s.note || '', state: s.st }; } catch (e) { return null; } }).filter(Boolean);
  const alertRows = (proc, n = 15) => M.alerts().filter(a => !proc || a.proc === proc || M.PROC[a.proc] === proc).slice(0, n)
    .map(a => ({ level: a.level, process: M.PROC[a.proc] || a.proc, title: a.title, detail: a.body, at: a.at }));
  const procKey = p => { const k = String(p || '').toLowerCase(); return Object.keys(M.PROC).find(x => x === k || M.PROC[x] === p || (M.PROC[x] || '').includes(p)) || k; };
  // ── 말로 지시: 조치는 «제안 카드» 로만 만들고, 사람이 승인 버튼을 눌러야 실행한다
  let pending = [];
  const ACTS = {};
  let actSeq = 0;
  function proposal(i) {
    const k = i.kind, lot = String(i.lot || '').toUpperCase(), why = i.reason || '질의응답 지시';
    const mk = (label, run) => ({ id: 'A' + (++actSeq), label, run });
    if (k === 'case_action') { const c = M.caseApi && M.caseApi.get(i.case_id), a = c && c.actions.find(x => x.id === i.action_id) || (c && M.caseApi.next(c));
      if (!a) return { error: '사건 또는 조치를 찾지 못했습니다 (cases 도구로 id 확인)' }; return mk(`${c.id} · ${a.label}`, () => M.caseApi.run(c.id, a.id)); }
    if (k === 'hold_lot') { if (!lot) return { error: 'lot 필요' }; return mk(`${lot} 출하 보류`, async () => { await M.gate.hold(lot, why); return `${lot} 출하 보류 — 원장 기록`; }); }
    if (k === 'release_lot') return mk(`${lot} 보류 해제`, async () => { await M.gate.release(lot); return `${lot} 보류 해제`; });
    if (k === 'ship_lot') return mk(`${lot} 출하 → 고객 자동 검수`, async () => { const d = await M.gate.ship(lot); return d.result === 'accepted' ? `${lot} 자동 검수 합격` : `${lot} 클레임 생성`; });
    if (k === 'purchase') { const codes = (i.items || []).map(String).filter(c => M.buyApi && M.buyApi.catalog().some(x => x.code === c)); if (!codes.length) return { error: '등록 품목 코드가 필요합니다 (buy_recommendations 도구의 registered_items)' };
      return mk(`발주 초안 — ${codes.join(', ')}`, async () => { const po = await M.buyApi.createPO(codes.map(code => ({ code })), why, '질의응답'); return `${po.id} 발주 등록 (결재 대기)`; }); }
    if (k === 'maint') { const tg = String(i.target || '설비').trim(); return mk(`에이전트 조치안 — ${tg} 점검 지시`, async () => { const T = window.MLNGTrust;
      const it = await T.agentAdd('maint', `${tg} 점검 지시`, ['질의응답 지시', i.reason || '현장 판단', '보전 담당에게 점검 지시'], async () => `보전 담당에게 ${tg} 점검 지시`, { title: `질의응답 — ${tg} 점검`, go: 'agent' });
      return it.status === 'done' ? it.result : await T.agentRun(it.id); }); }
    if (k === 'whatif_apply') return mk('What-if 화면에 조건 넣기', async () => { M.whatifApi.preset(i.levers || {}); M.go('whatif'); return 'What-if 에 조건을 넣었습니다'; });
    return { error: `모르는 조치 ${k}` };
  }
  const TOOLS = {
    overview: () => ({ asof: M.S.asof, factory: M.S.factory, processes: sums(), alert_counts: { danger: M.alerts().filter(a => a.level === 'danger').length, warn: M.alerts().filter(a => a.level === 'warn').length } }),
    alerts: i => ({ alerts: alertRows(i && i.process ? procKey(i.process) : null, 20) }),
    process_detail: i => {
      const p = procKey(i && i.process), mod = M.mods.find(m => m.proc === p);
      const s = mod && mod.summary ? mod.summary(M.S) : null;
      const lots = (M.S.lots || []).filter(l => l.proc === p).sort((a, b) => String(b.start || b.start_at || b.date || '').localeCompare(String(a.start || a.start_at || a.date || ''))).slice(0, 8)
        .map(l => ({ lot: l.id, date: String(l.start || l.start_at || l.date || '').slice(0, 16), qty: l.qty, bad: l.bad, wo: l.wo_id }));
      return { process: M.PROC[p] || p, summary: s && { kpi: s.kpi, detail: s.sub || s.note }, alerts: alertRows(p, 10), recent_lots: lots };
    },
    lot_trace: i => {
      const id = String(i && i.lot_id || '').trim().toUpperCase(), l = (M.S.lots || []).find(x => x.id.toUpperCase() === id);
      if (!l) return { error: `LOT ${id} 을 찾지 못했습니다` };
      const g = M.lineage(l.id), s = x => ({ lot: x.id, process: x.proc ? (M.PROC[x.proc] || x.proc) : (x.kind === 'material' ? '소재' : x.kind || ''), qty: x.qty, bad: x.bad, date: String(x.start || x.start_at || x.date || '').slice(0, 16) });
      return { lot: s(l), work_order: l.wo_id, upstream: g.up.map(s), downstream: g.down.map(s) };
    },
    line_status: () => M.lineSummary ? M.lineSummary() : { error: '라인 운영 모듈이 없습니다' },
    mach_tools: () => { const md = M.S.mach; if (!md) return { error: 'MCT 데이터 없음' };
      return { vb_limit_mm: (M.CFG.MACH || {}).VB_LIMIT, parts_per_run: md.parts_per_run, tools: md.tools.slice(-10).map(t => ({ tool: t.id, date: t.date, material: t.material, depth_mm: t.DOC, feed: t.feed, vb_last_mm: t.vb_last, wear_um_per_min: t.rate ? +(t.rate * 1000).toFixed(1) : null, runs: t.runs })) }; },
    plan_status: () => { const pl = M.S.plan; if (!pl) return { error: '계획 데이터 없음' };
      return { items: pl.items.map(it => { const ds = pl.days.filter(d => d.item === it.code).sort((a, b) => a.date.localeCompare(b.date)), rec = ds.slice(-7), last = ds[ds.length - 1] || {};
        return { item: it.code, name: it.name, last_date: last.date, closing_inventory: last.inv_close, avg_order_7d: Math.round(rec.reduce((s, d) => s + d.order, 0) / Math.max(1, rec.length)), avg_prod_7d: Math.round(rec.reduce((s, d) => s + d.prod, 0) / Math.max(1, rec.length)) }; }) }; },
    purchase_orders: i => { if (!M.buyApi) return { error: '구매 모듈 없음' };
      const st = i && i.status, B = M.buyApi;
      return { orders: B.orders().filter(o => !st || o.status === st).slice(0, 20).map(o => ({ id: o.id, vendor: o.vendor, status: o.status, next_step: B.nextStep(o) || null, total_qty: B.total(o), created_at: o.created_at, items: o.lines.map(l => `${l.name} ×${l.qty}`), signed: Object.fromEntries(Object.entries(o.signs || {}).map(([k, v]) => [k, `${v.by} ${v.at}`])) })),
        recent_activity: B.audit().slice(0, 10) }; },
    buy_recommendations: () => M.buyApi ? { recommendations: M.buyApi.recs().map(r => ({ item: r.it.name, code: r.it.code, process: M.PROC[r.it.proc] || r.it.proc, class: r.it.cls, qty: r.qty, unit: r.it.unit, level: r.level, reason: r.reason })),
      registered_items: M.buyApi.catalog().map(i => `${i.code} ${i.name} (${M.PROC[i.proc] || i.proc}·${i.cls})`) } : { error: '구매 모듈 없음' },
    // ── 3.0 판단 계층
    money_overview: () => { const DX = M.dx; if (!DX) return { error: '판단 계층 없음' }; const q = DX.copq(30), opp = DX.lineOpp();
      return { copq_30d_won: Math.round(q.total), revenue_30d_won: Math.round(q.revenue), copq_rate: q.rate, copq_by: Object.fromEntries(Object.entries(q.by).map(([k, v]) => [k, Math.round(v)])),
        waste_per_day_won: Math.round(DX.heaterWaste().reduce((t, x) => t + x.won, 0)), line_opportunity_per_day_won: opp ? Math.round(opp.won) : null,
        top_alerts_by_money: M.alerts().map(a => ({ a, m: DX.money(a) })).filter(x => x.m && x.m.won).sort((x, y) => y.m.won - x.m.won).slice(0, 8).map(x => ({ title: x.a.title, kind: DX.KIND[x.m.kind][0], won: Math.round(x.m.won), basis: x.m.basis })),
        note: '계수는 config.js COST 예시값. 위험은 가정 포함' }; },
    cases: i => { const C = M.caseApi; if (!C || !(window.MLNGTrust || {}).ready) return { error: '사건실 준비 전' };
      const one = c => ({ id: c.id, name: c.name, stage: C.STAGES[c.st.stage], level: c.level, money_won: Math.round(c.money.won), money_basis: c.money.basis, opened: c.opened,
        affected_lots: c.lots.map(l => `${l.id}(${M.PROC[l.proc] || l.proc} ${l.qty}개 · ${l.ship.t} · ${l.why})`), cause_candidates: c.causes.map(x => `${x.t} [근거 ${M.dx.STRENGTH[x.strength][1]}] ${x.d}`),
        actions: c.actions.map(a => ({ id: a.id, stage: a.stage, label: a.label, done: c.st.done[a.id] ? c.st.done[a.id].result : null })), alerts: c.alerts.map(a => a.title), first_sign: c.st.first || null });
      if (i && i.case_id) { const c = C.get(i.case_id); return c ? one(c) : { error: `사건 ${i.case_id} 없음` }; }
      return { cases: C.list().map(c => ({ id: c.id, name: c.name, stage: C.STAGES[c.st.stage], level: c.level, money_won: Math.round(c.money.won), lots: c.lots.length, inside_lots: c.lots.filter(l => l.ship.k === 'inside').length, next_action: (C.next(c) || {}).label || null })) }; },
    ship_gate: () => { const G = M.gate; if (!G || !(window.MLNGTrust || {}).ready) return { error: '출하 게이트 준비 전' };
      return { rules: G.rules, forecast: G.forecast(), lots: G.candidates().map(l => G.predict(l.id)).map(r => ({ lot: r.lot, qty: r.qty, status: r.status, recommendation: r.held ? 'held' : r.rec, why: r.why, checks: r.checks.map(c => `${c.label} ${c.actual} (${c.th}) ${c.ok ? (c.near ? '근접' : '만족') : '미달'}`) })) }; },
    what_if: i => { if (!M.whatifApi) return { error: 'What-if 없음' }; const p = {}; ['target', 'press', 'weld', 'heat', 'vb', 'dev'].forEach(k => { if (i && i[k] != null && !isNaN(+i[k])) p[k] = +i[k]; }); if (i && i.heater != null) p.heater = !!i.heater;
      const pick = r => ({ output_per_day: Math.round(r.out), bottleneck: M.PROC[r.lim.p] || r.lim.p, profit_per_day_won: Math.round(r.profit), contribution: Math.round(r.contrib), scrap: Math.round(r.scrap), insert_cost: Math.round(r.toolCost), wear_risk: Math.round(r.wearRisk), equipment_overtime: Math.round(r.weldCost + r.ot + r.maint), heater_waste: Math.round(r.energy), press_ppm: Math.round(r.ppmP), heat_ppm: Math.round(r.ppmH), claim_expected: Math.round(r.claimExp), carbon_g_per_part: r.pcfG != null ? Math.round(r.pcfG) : null, contract: r.checks.map(c => `${c.t} ${c.v} (${c.th}) ${c.ok ? '충족' : '위반'}`) });
      const base = M.whatifApi.compute({}), sc = M.whatifApi.compute(p); return { levers: Object.assign(M.whatifApi.defaults(), p), now: pick(base), scenario: pick(sc), press_regression_r: sc.pf ? +sc.pf.r.toFixed(2) : null, note: '판단 이익 = 공헌이익 − 불량 − 인서트 − 마모 위험 − 설비·잔업 − 낭비 전력 (비교용)' }; },
    shift_brief: () => M.shiftApi ? M.shiftApi.brief() : { error: '교대 모듈 없음' },
    propose_action: i => { const a = proposal(i || {}); if (a.error) return a; pending.push(a); return { status: 'proposed', label: a.label, note: '화면에 승인 버튼으로 표시했습니다. 사용자가 누르기 전에는 실행되지 않습니다.' }; },
    trust_network: async i => { const T = window.MLNGTrust; if (!T || !T.ready) return { error: '신뢰 계층 준비 전' };
      const part = (i && i.part) || 'all', o = {}, co = id => (T.co(id) || {}).name || id;
      if (part === 'all' || part === 'contracts') o.contracts = (T.contracts || []).map(c => ({ id: c.id, provider: co(c.provider), consumer: co(c.consumer), scopes: c.scopes.map(k => (T.SCOPES[k] || {}).name || k), state: T.contractState(c), end: c.end, recent_access: (c.access || []).slice(0, 3).map(a => `${a.at} ${a.ok ? '허용' : '거부'} ${a.resource || ''}`) }));
      if (part === 'all' || part === 'orders') o.smart_orders = (T.orders || []).map(x => ({ id: x.id, buyer: co(x.buyer), item: x.item, qty: x.qty, clauses: x.clauses.map(c => `${c.k} ${c.op || ''} ${c.v ?? ''}`), deliveries: x.deliveries.length, accepted: x.deliveries.filter(d => d.result === 'accepted').length,
        claims: x.deliveries.filter(d => d.claim).map(d => ({ id: d.claim.id, lot: d.lot, status: d.claim.status, text: d.claim.text })) }));
      if (part === 'all' || part === 'passports') o.passports = Object.values(T.passports || {}).slice(-8).map(p => ({ id: p.id, lot: p.lot, steps: p.steps.length, root: T.short(p.root), pcf_kg_per_part: p.pcf ? +p.pcf.total.toFixed(3) : null }));
      if (part === 'all' || part === 'credentials') o.credentials = (T.credentials || []).map(c => ({ id: c.id, claim: c.claim, audience: co(c.audience), issued: c.issued, expires: c.expires, revoked: !!c.revoked }));
      if (part === 'all' || part === 'agent') o.agent = { pending: ((T.agent || {}).items || []).filter(x => x.status === 'pending' || x.status === 'suggested').slice(0, 8).map(x => ({ id: x.id, kind: x.kind, action: x.act, why: x.why, status: x.status })), recent_log: ((T.agent || {}).log || []).slice(0, 5) };
      if (part === 'all' || part === 'ledger') { const v = await T.verifyLedger(); o.ledger = { entries: T.ledger.length, valid: v.ok, broken_at: v.ok ? null : v.broken[0].seq, last: T.ledger.slice(-5).map(e => `${e.seq} ${e.company} ${e.kind} ${e.title}`) }; }
      return o; },
  };
  async function runTool(name, input) {
    try { const fn = TOOLS[name]; const out = fn ? await fn(input || {}) : { error: `모르는 도구 ${name}` }; const s = JSON.stringify(out); return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + '…(생략)' : s; }
    catch (e) { return JSON.stringify({ error: e.message }); }
  }

  // ── Claude (Edge Function 중계) — 도구 요청이 오면 실행해서 다시 보낸다
  async function askClaude(q) {
    pending = [];
    const hist = chat.slice(0, -1).filter(c => c.text && !c.err).slice(-MAX_TURNS * 2).map(c => ({ role: c.role === 'user' ? 'user' : 'assistant', content: c.text }));
    const msgs = hist.concat([{ role: 'user', content: q }]);
    const used = [];
    for (let i = 0; i < MAX_LOOP; i++) {
      const r = await M.D.ask({ messages: msgs, asof: M.S.asof, plant: M.S.factory && M.S.factory.name });
      const content = r.content || [];
      msgs.push({ role: 'assistant', content });
      const calls = content.filter(b => b.type === 'tool_use');
      if (r.stop_reason !== 'tool_use' || !calls.length) return { text: content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || '(빈 답변)', tools: used, acts: pending };
      const results = [];
      for (const c of calls) { used.push(c.name); results.push({ type: 'tool_result', tool_use_id: c.id, content: await runTool(c.name, c.input) }); }
      msgs.push({ role: 'user', content: results });
    }
    return { text: '자료를 여러 번 찾았지만 답을 마무리하지 못했습니다. 질문을 조금 좁혀 주세요.', tools: used };
  }

  // ── 규칙 기반 — 정해진 질문은 실제 값으로 바로 답한다
  function askRule(q) {
    const has = (...w) => w.some(x => q.includes(x)), links = [];
    const lotM = q.toUpperCase().match(/\b([A-Z]{2}-[0-9A-Z-]{3,})\b/);
    const T = window.MLNGTrust || {}, DX = M.dx, ready = T.ready;
    // 지시 (조치 제안 카드 — 승인해야 실행)
    if (ready && lotM && /보류/.test(q) && !/해제/.test(q)) { const a = proposal({ kind: 'hold_lot', lot: lotM[1], reason: '질의응답 지시' }); return { text: `${lotM[1]} 출하 보류를 제안합니다. 아래 버튼을 눌러야 실행됩니다.`, acts: [a], links: [['gate', '출하 게이트']] }; }
    if (ready && lotM && /해제/.test(q)) { const a = proposal({ kind: 'release_lot', lot: lotM[1] }); return { text: `${lotM[1]} 보류 해제를 제안합니다.`, acts: [a] }; }
    // 복합 지시: 「열처리 2존 점검 지시하고 히터 발주 올려줘」 → 점검 조치안 + 해당 품목 발주 카드 두 장
    const wantMaint = ready && /점검/.test(q) && /(지시|해|시켜)/.test(q), wantBuy = ready && /(발주|주문)/.test(q) && /(해|올려|넣어|진행)/.test(q) && M.buyApi;
    const words = (q.match(/[가-힣A-Za-z0-9.]{2,}/g) || []).filter(w => !/^(발주|주문|점검|지시|올려|해줘|하고|그리고|해주세요|진행|넣어|시켜)/.test(w));
    const named = M.buyApi ? M.buyApi.catalog().filter(it => words.some(w => it.name.includes(w.replace(/(을|를|도|만)$/, '')) || it.code === w.toUpperCase())).map(it => it.code) : [];
    if (wantMaint || (wantBuy && named.length)) {
      const acts = [], tg = wantMaint ? (q.split(/점검/)[0].replace(/^(지금|바로|그럼)\s*/, '').trim() || '설비') : '';
      if (wantMaint) acts.push(proposal({ kind: 'maint', target: tg, reason: '질의응답 지시' }));
      if (wantBuy) { const codes = named.length ? named : M.buyApi.recs().map(r => r.it.code); if (codes.length) acts.push(proposal({ kind: 'purchase', items: codes, reason: '질의응답 지시' })); }
      return { text: `조치 ${acts.length}건을 만들었습니다. 승인 버튼을 눌러야 실행됩니다.${wantMaint ? `\n· ${tg} 점검 — 에이전트 조치안으로 등록 후 실행 (원장 기록)` : ''}${wantBuy ? `\n· 발주 초안 — ${(named.length ? named : M.buyApi.recs().map(r => r.it.code)).map(c => (M.buyApi.catalog().find(x => x.code === c) || {}).name || c).join(', ')} (결재는 사람이)` : ''}`, acts, links: [['agent', 'AI 에이전트'], ['buy_orders', '발주 · 결재']] };
    }
    if (ready && /(발주|주문)\s*(해|올려|넣어|진행)/.test(q) && M.buyApi) { const rs = M.buyApi.recs(); if (!rs.length) return { text: '지금 발주 추천 품목이 없습니다', links: [['buy_home', '공구 주문']] };
      const a = proposal({ kind: 'purchase', items: rs.map(r => r.it.code), reason: '질의응답 지시 — 추천 품목' }); return { text: `추천 품목 ${rs.length}종 발주 초안을 제안합니다 — ${rs.map(r => `${r.it.name} ${r.qty}${r.it.unit}`).join(', ')}`, acts: [a], links: [['buy_home', '공구 주문']] }; }
    if (ready && /(실행|처리|진행)\s*(해|시켜)/.test(q) && M.caseApi) { const c = M.caseApi.open()[0], nx = c && M.caseApi.next(c); if (!nx) return { text: '실행할 사건 조치가 없습니다' };
      return { text: `가장 급한 사건 ${c.id} (${c.name}) 의 다음 조치를 제안합니다.`, acts: [proposal({ kind: 'case_action', case_id: c.id, action_id: nx.id })], links: [['case:' + c.id, '사건 열기']] }; }
    // 3.0 판단
    if (ready && DX && /(얼마|손실|돈|비용|원가|낭비)/.test(q)) { const r = TOOLS.money_overview();
      return { text: `30일 품질 손실 ${DX.won(r.copq_30d_won)} (매출 대비 ${M.pct(r.copq_rate, 2)}) · 매일 새는 돈 ${DX.won(r.waste_per_day_won)}${r.line_opportunity_per_day_won ? ` · 기회 손실 하루 ${DX.won(r.line_opportunity_per_day_won)}` : ''}\n금액 큰 순서:\n${r.top_alerts_by_money.slice(0, 4).map((x, i) => `${i + 1}. ${x.title} — ${x.kind} ${DX.won(x.won)}`).join('\n')}`, links: [['cost', '돈으로 보는 공장']] }; }
    if (ready && /사건/.test(q) && M.caseApi) { const cs = M.caseApi.open();
      return { text: cs.length ? `열린 사건 ${cs.length}건\n${cs.map((c, i) => `${i + 1}. ${c.name} (${M.caseApi.STAGES[c.st.stage]}) — ${DX.won(c.money.won)} · 다음: ${(M.caseApi.next(c) || {}).label || '—'}`).join('\n')}` : '열린 사건이 없습니다', links: [['cases', '사건실']] }; }
    if (ready && /출하/.test(q) && M.gate && !/아침 출하/.test(q)) { const rs = M.gate.candidates().map(l => M.gate.predict(l.id)), fc = M.gate.forecast();
      return { text: `출하 대기 ${rs.length} LOT — 출하 가능 ${rs.filter(r => r.rec === 'ship' && !r.held).length} · 보류 권고 ${rs.filter(r => r.rec === 'hold' && !r.held).length} · 보류 중 ${rs.filter(r => r.held).length}\n${rs.filter(r => r.rec === 'hold').slice(0, 4).map(r => `· ${r.lot}: ${r.why.join(' · ')}`).join('\n')}${fc ? `\n다음 LOT 이 열처리 PPM 기준(${fc.th})을 넘을 확률 ${M.pct(fc.p, 0)} (최근 ${fc.n} LOT 중 ${fc.over})` : ''}`, links: [['gate', '출하 게이트']] }; }
    if (ready && /(인수인계|교대)/.test(q) && M.shiftApi) { const b = M.shiftApi.brief();
      return { text: `${b.shift} — 새 알림 ${b.new_alerts.length}건 · 열린 사건 ${b.open_cases.length}건\n다음 교대가 꼭 할 일:\n${b.next_shift_must_do.map(t => '· ' + t).join('\n') || '· 없음'}`, links: [['shift', '교대 인수인계']] }; }
    const wm = { press: q.match(/프레스[^\d]{0,12}(\d{2,3})\s*%/), weld: q.match(/용접기?[^\d]{0,8}(\d)\s*대/), heat: q.match(/열처리[^\d]{0,10}(\d{2,3})\s*%/), vb: q.match(/VB[^\d]{0,6}(0?\.\d+)/i), dev: q.match(/이탈[^\d]{0,8}(\d{1,2})\s*%/) };
    if (M.whatifApi && (Object.values(wm).some(Boolean) || /what.?if|만약|하면 어떻게/i.test(q))) { const p = {}; Object.entries(wm).forEach(([k, m]) => { if (m) p[k] = +m[1]; }); if (/히터/.test(q)) p.heater = true;
      const r = TOOLS.what_if(p), a = r.now, b = r.scenario, d = (x, y) => `${y - x >= 0 ? '+' : ''}${f(y - x, 0)}`;
      return { text: `조건 ${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(', ') || '(지금 그대로)'}\n· 하루 산출 ${f(a.output_per_day, 0)} → **${f(b.output_per_day, 0)}개** (병목 ${b.bottleneck})\n· 판단 이익 ${DX.won(a.profit_per_day_won)} → **${DX.won(b.profit_per_day_won)}** (${d(a.profit_per_day_won, b.profit_per_day_won)}원/일)\n· 프레스 불량 ${a.press_ppm} → ${b.press_ppm} PPM (회귀 r=${r.press_regression_r}) · 인서트 ${DX.won(a.insert_cost)} → ${DX.won(b.insert_cost)}\n· 계약: ${b.contract.join(' / ') || '활성 계약 없음'}`,
        acts: [proposal({ kind: 'whatif_apply', levers: p })], links: [['whatif', 'What-if 샌드박스']] }; }
    if (lotM && !/^PO-/.test(lotM[1])) {
      const r = TOOLS.lot_trace({ lot_id: lotM[1] }); if (r.error) return { text: r.error };
      return { text: `${r.lot.lot} (${r.lot.process}) — ${f(r.lot.qty, 0)}개${r.lot.bad != null ? ` · 불량 ${f(r.lot.bad, 0)}` : ''} · ${r.lot.date}\n앞 공정: ${r.upstream.map(x => `${x.lot}(${x.process})`).join(', ') || '없음'}\n뒤 공정: ${r.downstream.map(x => `${x.lot}(${x.process})`).join(', ') || '없음'}`,
        links: [['trace', 'LOT 이력 보기']] };
    }
    if (has('계약', '여권', '클레임', '검수', '원장', '위변조', '에이전트', '증명서', '탄소', '공급망')) {
      const T = window.MLNGTrust; if (!T || !T.ready) return { text: '신뢰 계층을 준비하는 중입니다' };
      if (has('계약')) { const cs = T.contracts || [], by = k => cs.filter(c => T.contractState(c) === k);
        return { text: `데이터 공유 계약 ${cs.length}건 — 유효 ${by('active').length} · 서명 대기 ${by('proposed').length}${by('proposed').length ? ' (' + by('proposed').map(c => c.id).join(', ') + ')' : ''} · 만료·철회 ${by('expired').length + by('revoked').length}`, links: [['net_contracts', '데이터 공유 계약']] }; }
      if (has('클레임', '검수', '발주')) { const os = T.orders || [], ds = [].concat(...os.map(o => o.deliveries)), cl = ds.filter(d => d.claim);
        return { text: `스마트 발주 ${os.length}건 · 납품 ${ds.length}건 중 자동 합격 ${ds.filter(d => d.result === 'accepted').length}건, 클레임 ${cl.length}건${cl.length ? '\n' + cl.slice(0, 3).map(d => `· ${d.claim.id} ${d.lot} (${d.claim.status === 'open' ? '처리 중' : '종결'})`).join('\n') : ''}`, links: [['deal_home', '스마트 발주']] }; }
      if (has('에이전트')) { const it = ((T.agent || {}).items || []).filter(x => x.status === 'pending' || x.status === 'suggested');
        return { text: it.length ? `승인 대기 조치 ${it.length}건\n${it.slice(0, 5).map(x => `· ${x.act}`).join('\n')}` : '승인 대기 중인 에이전트 조치가 없습니다', links: [['agent', 'AI 에이전트']] }; }
      if (has('여권', '탄소')) { const ps = Object.values(T.passports || {});
        return { text: `발행된 LOT 디지털 여권 ${ps.length}건${ps.length ? '\n' + ps.slice(-3).map(p => `· ${p.id} ${p.steps.length}단계${p.pcf ? ` · 탄소 ${f(p.pcf.total * 1000, 0)} g/개` : ''}`).join('\n') : ''}`, links: [['pass_home', 'LOT 디지털 여권'], ['pass_pcf', '탄소 발자국']] }; }
      if (has('증명서')) { const cr = T.credentials || [];
        return { text: `공정 능력 증명서 ${cr.length}건${cr.length ? '\n' + cr.map(c => `· ${c.claim} → ${(T.co(c.audience) || {}).name || c.audience}`).join('\n') : ''}`, links: [['pass_cred', '공정 능력 증명서']] }; }
      if (has('공급망')) return { text: '공급망 동기 계획 화면에서 완성차 계획을 바꿔 보면 B·우리·D 단계 필요량과 병목이 다시 계산됩니다', links: [['sync', '공급망 동기 계획']] };
      return T.verifyLedger().then(v => ({ text: `신뢰 원장 ${T.ledger.length}건 — ${v.ok ? '전체 사슬 정상 (위변조 없음)' : `${v.broken[0].seq}번 기록부터 이상 — ${v.broken[0].why}`}`, links: [['net_ledger', '신뢰 원장']] }));
    }
    if (has('발주', '결재', '구매', '입고', '발주서')) {
      const B = M.buyApi; if (!B) return { text: '구매 모듈이 없습니다' };
      const os = B.orders(), pend = os.filter(o => o.status === 'pending'), notIn = os.filter(o => o.status === 'approved'), rs = B.recs();
      if (has('누가', '최근')) { const a = B.audit()[0]; return { text: a ? `가장 최근 활동: ${a.at} ${a.ref} ${a.action} (${a.by})` : '활동 기록이 없습니다', links: [['buy_orders', '발주 · 결재']] }; }
      return { text: `결재 대기 ${pend.length}건${pend.length ? ' — ' + pend.map(o => `${o.id}(다음: ${B.nextStep(o)})`).join(', ') : ''}\n결재 완료·미입고 ${notIn.length}건${notIn.length ? ' — ' + notIn.map(o => o.id).join(', ') : ''}\n발주 추천 ${rs.length}건${rs.length ? ' — ' + rs.map(r => `${r.it.name} ${r.qty}${r.it.unit}`).join(', ') : ''}`,
        links: [['buy_orders', '발주 · 결재'], ['buy_home', '발주 요청']] };
    }
    if (has('병목', '라인', '속도', '목표', '재공')) {
      const L = M.lineSummary && M.lineSummary(); if (!L) return { text: '라인 운영 데이터가 없습니다' };
      return { text: `지금 계획으로 하루 ${f(L.possible_per_day, 0)}개 (목표 ${f(L.target_per_day, 0)}개) — 병목 ${L.bottleneck}\n설비 능력 한계 하루 ${f(L.capacity_limit_per_day, 0)}개 (${L.capacity_bottleneck})\n재공 변화: ${L.wip_gaps_per_day.map(g => `${g.between} ${g.gap > 0 ? '+' : ''}${f(g.gap, 0)}`).join(' · ')}`, links: [['line', '라인 운영']] };
    }
    const procMap = [['mach', ['mct', 'MCT', '공구', '인서트', '마모', '가공']], ['press', ['프레스', '타발', '금형']], ['weld', ['용접', '타점']], ['heat', ['열처리', '소입', '히터']], ['insp', ['검사', '불합격', '판정']], ['plan', ['계획', '재고', '수주', '작업지시']]];
    const hit = procMap.find(([, ws]) => ws.some(w => q.includes(w)));
    if (hit) {
      const r = TOOLS.process_detail({ process: hit[0] });
      return { text: `${r.process}${r.summary ? ` — ${r.summary.kpi}${r.summary.detail ? ' · ' + r.summary.detail : ''}` : ''}\n${r.alerts.length ? r.alerts.slice(0, 4).map(a => `· ${a.level === 'danger' ? '[긴급] ' : ''}${a.title}`).join('\n') : '· 알림 없음'}`,
        links: [[{ mach: 'mach_home', press: 'press_home', weld: 'weld_home', heat: 'heat_home', insp: 'insp_home', plan: 'plan_home' }[hit[0]], `${r.process} 화면`]] };
    }
    if (has('급', '먼저', '알림', '문제', '위험', '점검', '조치')) {
      const a = alertRows(null, 5); M.alerts().slice(0, 3).forEach(x => x.go && links.push([x.go, x.title.slice(0, 18) + '…']));
      return { text: a.length ? `먼저 볼 것 ${a.length}건\n${a.map((x, i) => `${i + 1}. [${x.process}] ${x.title}`).join('\n')}` : '지금 조치가 필요한 알림이 없습니다', links: links.concat([['alerts', '통합 알림']]) };
    }
    if (has('현황', '요약', '오늘', '상태', '어때')) {
      return { text: sums().map(s => `· ${s.proc}: ${s.kpi}${s.detail ? ' — ' + s.detail : ''}`).join('\n') || '요약할 자료가 없습니다', links: [['overview', '공장 현황']] };
    }
    return { text: '이 질문은 규칙 기반으로는 답하기 어렵습니다. 아래처럼 물어보세요.\n· 지금 가장 먼저 조치할 것은?\n· 병목 공정은 어디야?\n· MCT 공구 상태 어때?\n· 결재 대기 발주 있어?\n· 클레임 걸린 납품 있어?\n· 오늘 손실은 얼마야? · 열린 사건 알려줘\n· 프레스 속도 110%면? · HT-… 보류해 줘\n· HT-… LOT 이력 알려줘' };
  }

  async function send(q) {
    q = String(q || '').trim(); if (!q || busy) return;
    chat.push({ role: 'user', text: q }); busy = true; draft = ''; M.render();
    let ans;
    if (M.D.askUrl()) {
      try { const r = await askClaude(q); ans = { text: r.text, engine: 'Claude', tools: r.tools, acts: r.acts }; }
      catch (e) { const r = await askRule(q); ans = Object.assign(r, { engine: '규칙 기반', note: `Claude 연결 실패(${e.message}) — 규칙 기반으로 답했습니다` }); }
    } else ans = Object.assign(await askRule(q), { engine: '규칙 기반' });
    if (ans.acts && ans.acts.length) { ans.actions = ans.acts.map(a => { ACTS[a.id] = a; return { id: a.id, label: a.label, status: 'proposed' }; }); delete ans.acts; }
    chat.push(Object.assign({ role: 'bot' }, ans)); busy = false;
    if (M.cur === 'ask') { M.render(); const b = M.$('#chatbox'); if (b) b.scrollTop = b.scrollHeight; }
  }

  const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const SUG = ['지금 가장 먼저 조치할 것은?', '병목 공정은 어디고 하루 몇 개까지 가능해?', 'MCT 공구 상태 어때?', '결재 대기 발주 있어?', '열처리 불량 원인 후보는?', '공장 현황 요약해 줘', '오늘 손실은 얼마야?', '열린 사건 알려줘', '지금 출하해도 돼?', '프레스 속도 110%면 어떻게 돼?', '교대 인수인계 정리해 줘', '발주 올려줘'];
  const V = {};
  V.ask = () => {
    const live = !!M.D.askUrl();
    return `<div class="card askc">
      <div class="askhd"><h2>질의응답 <span class="h2sub">공정 데이터를 근거로 답합니다</span></h2>
        <span class="chip ${live ? 'c-ext' : 'c-off'}">${live ? 'Claude API 연결' : '규칙 기반 (Claude 미연결)'}</span></div>
      <div class="chips">${SUG.map(s => `<button class="btn sm" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div id="chatbox" class="chatbox">${chat.length ? chat.map(c => c.role === 'user' ? `<div class="msg u"><div class="bub">${esc(c.text)}</div></div>`
        : `<div class="msg b"><div class="bub">${md(c.text)}${c.links && c.links.length ? `<div class="alinks">${c.links.map(([g, t]) => `<a href="#" data-go="${esc(g)}">${esc(t)} →</a>`).join('')}</div>` : ''}${c.actions && c.actions.length ? `<div class="aacts">${c.actions.map(a => `<div class="aact ${esc(a.status)}"><span>${a.status === 'done' ? '✓' : a.status === 'failed' ? '✕' : '제안'}</span><b>${esc(a.label)}</b>${a.status === 'proposed' ? `<button class="btn pri sm" data-aok="${esc(a.id)}">승인 · 실행</button><button class="btn sm" data-ano="${esc(a.id)}">취소</button>` : `<em>${esc(a.result || (a.status === 'cancel' ? '취소함' : ''))}</em>`}</div>`).join('')}</div>` : ''}</div>
          <div class="meta">${esc(c.engine || '')}${c.tools && c.tools.length ? ` · 조회: ${esc([...new Set(c.tools)].join(', '))}` : ''}${c.note ? ` · ${esc(c.note)}` : ''}</div></div>`).join('')
        : '<div class="empty">위 예시를 누르거나 아래에 질문을 적어 보세요</div>'}${busy ? '<div class="msg b"><div class="bub muted">자료를 찾는 중…</div></div>' : ''}</div>
      <div class="askin"><textarea class="in" id="askq" rows="2" placeholder="예: 프레스 진동 이상이 열처리 불량과 관계 있어? (Ctrl+Enter 로 보내기)">${esc(draft)}</textarea>
        <button class="btn pri" id="askgo" ${busy ? 'disabled' : ''}>질문</button></div>
      <p class="note">${live ? 'Claude 가 답하기 전에 필요한 자료(알림·공정 상세·LOT 이력·라인 상태·발주 등)를 이 화면의 데이터에서 직접 조회합니다. API 키는 서버 함수에만 있습니다.'
        : '중계 함수(supabase/functions/mlng-ask)를 배포하면 Claude 가 자유 질문에 답합니다. 지금은 자주 묻는 질문을 규칙으로 답합니다.'}</p></div>`;
  };

  M.PROC.ask = '질의';
  M.askApi = { ask: q => { M.closeDrawer(); M.go('ask'); send(q); }, tool: runTool };
  M.mod({
    id: 'ask', group: '현황', order: 1,
    menu: [['ask', '질의응답', 'chat']],
    views: V,
    bind(root) {
      root.querySelectorAll('[data-ask]').forEach(b => b.onclick = () => send(b.dataset.ask));
      const t = root.querySelector('#askq'), g = root.querySelector('#askgo');
      if (t) { t.oninput = () => { draft = t.value; }; t.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(t.value); } }; }
      if (g) g.onclick = () => send(t.value);
      const find = id => { for (const c of chat) for (const a of (c.actions || [])) if (a.id === id) return a; return null; };
      root.querySelectorAll('[data-aok]').forEach(b2 => b2.onclick = async () => { const a = find(b2.dataset.aok), x = ACTS[b2.dataset.aok]; if (!a || !x) return; b2.disabled = true;
        try { a.result = await x.run(); a.status = 'done'; } catch (e) { a.result = e.message; a.status = 'failed'; }
        if (window.MLNGTrust && MLNGTrust.ready) await MLNGTrust.append('MLNG', 'ask', a.id, `질의응답 지시 실행 — ${a.label}`.slice(0, 160), { label: a.label, result: a.result, by: M.D.user().name });
        if (M.cur === 'ask') M.render(); });
      root.querySelectorAll('[data-ano]').forEach(b2 => b2.onclick = () => { const a = find(b2.dataset.ano); if (a) a.status = 'cancel'; M.render(); });
      const b = root.querySelector('#chatbox'); if (b) b.scrollTop = b.scrollHeight;
    },
  });
})();
