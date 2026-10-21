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
      return { orders: B.orders().filter(o => !st || o.status === st).slice(0, 20).map(o => ({ id: o.id, vendor: o.vendor, status: o.status, next_step: B.nextStep(o) || null, amount_krw: B.total(o), created_at: o.created_at, items: o.lines.map(l => `${l.name} ×${l.qty}`), signed: Object.fromEntries(Object.entries(o.signs || {}).map(([k, v]) => [k, `${v.by} ${v.at}`])) })),
        recent_activity: B.audit().slice(0, 10) }; },
    buy_recommendations: () => M.buyApi ? { recommendations: M.buyApi.recs().map(r => ({ item: r.it.name, code: r.it.code, qty: r.qty, unit: r.it.unit, level: r.level, reason: r.reason, vendor: r.it.vendor })) } : { error: '구매 모듈 없음' },
  };
  async function runTool(name, input) {
    try { const fn = TOOLS[name]; const out = fn ? fn(input || {}) : { error: `모르는 도구 ${name}` }; const s = JSON.stringify(out); return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + '…(생략)' : s; }
    catch (e) { return JSON.stringify({ error: e.message }); }
  }

  // ── Claude (Edge Function 중계) — 도구 요청이 오면 실행해서 다시 보낸다
  async function askClaude(q) {
    const hist = chat.slice(0, -1).filter(c => c.text && !c.err).slice(-MAX_TURNS * 2).map(c => ({ role: c.role === 'user' ? 'user' : 'assistant', content: c.text }));
    const msgs = hist.concat([{ role: 'user', content: q }]);
    const used = [];
    for (let i = 0; i < MAX_LOOP; i++) {
      const r = await M.D.ask({ messages: msgs, asof: M.S.asof, plant: M.S.factory && M.S.factory.name });
      const content = r.content || [];
      msgs.push({ role: 'assistant', content });
      const calls = content.filter(b => b.type === 'tool_use');
      if (r.stop_reason !== 'tool_use' || !calls.length) return { text: content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || '(빈 답변)', tools: used };
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
    if (lotM && !/^PO-/.test(lotM[1])) {
      const r = TOOLS.lot_trace({ lot_id: lotM[1] }); if (r.error) return { text: r.error };
      return { text: `${r.lot.lot} (${r.lot.process}) — ${f(r.lot.qty, 0)}개${r.lot.bad != null ? ` · 불량 ${f(r.lot.bad, 0)}` : ''} · ${r.lot.date}\n앞 공정: ${r.upstream.map(x => `${x.lot}(${x.process})`).join(', ') || '없음'}\n뒤 공정: ${r.downstream.map(x => `${x.lot}(${x.process})`).join(', ') || '없음'}`,
        links: [['trace', 'LOT 이력 보기']] };
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
    return { text: '이 질문은 규칙 기반으로는 답하기 어렵습니다. 아래처럼 물어보세요.\n· 지금 가장 먼저 조치할 것은?\n· 병목 공정은 어디야?\n· MCT 공구 상태 어때?\n· 결재 대기 발주 있어?\n· HT-… LOT 이력 알려줘' };
  }

  async function send(q) {
    q = String(q || '').trim(); if (!q || busy) return;
    chat.push({ role: 'user', text: q }); busy = true; draft = ''; M.render();
    let ans;
    if (M.D.askUrl()) {
      try { const r = await askClaude(q); ans = { text: r.text, engine: 'Claude', tools: r.tools }; }
      catch (e) { const r = askRule(q); ans = Object.assign(r, { engine: '규칙 기반', note: `Claude 연결 실패(${e.message}) — 규칙 기반으로 답했습니다` }); }
    } else ans = Object.assign(askRule(q), { engine: '규칙 기반' });
    chat.push(Object.assign({ role: 'bot' }, ans)); busy = false;
    if (M.cur === 'ask') { M.render(); const b = M.$('#chatbox'); if (b) b.scrollTop = b.scrollHeight; }
  }

  const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const SUG = ['지금 가장 먼저 조치할 것은?', '병목 공정은 어디고 하루 몇 개까지 가능해?', 'MCT 공구 상태 어때?', '결재 대기 발주 있어?', '열처리 불량 원인 후보는?', '공장 현황 요약해 줘'];
  const V = {};
  V.ask = () => {
    const live = !!M.D.askUrl();
    return `<div class="card askc">
      <div class="askhd"><h2>질의응답 <span class="h2sub">공정 데이터를 근거로 답합니다</span></h2>
        <span class="chip ${live ? 'c-ext' : 'c-off'}">${live ? 'Claude API 연결' : '규칙 기반 (Claude 미연결)'}</span></div>
      <div class="chips">${SUG.map(s => `<button class="btn sm" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div id="chatbox" class="chatbox">${chat.length ? chat.map(c => c.role === 'user' ? `<div class="msg u"><div class="bub">${esc(c.text)}</div></div>`
        : `<div class="msg b"><div class="bub">${md(c.text)}${c.links && c.links.length ? `<div class="alinks">${c.links.map(([g, t]) => `<a href="#" data-go="${esc(g)}">${esc(t)} →</a>`).join('')}</div>` : ''}</div>
          <div class="meta">${esc(c.engine || '')}${c.tools && c.tools.length ? ` · 조회: ${esc([...new Set(c.tools)].join(', '))}` : ''}${c.note ? ` · ${esc(c.note)}` : ''}</div></div>`).join('')
        : '<div class="empty">위 예시를 누르거나 아래에 질문을 적어 보세요</div>'}${busy ? '<div class="msg b"><div class="bub muted">자료를 찾는 중…</div></div>' : ''}</div>
      <div class="askin"><textarea class="in" id="askq" rows="2" placeholder="예: 프레스 진동 이상이 열처리 불량과 관계 있어? (Ctrl+Enter 로 보내기)">${esc(draft)}</textarea>
        <button class="btn pri" id="askgo" ${busy ? 'disabled' : ''}>질문</button></div>
      <p class="note">${live ? 'Claude 가 답하기 전에 필요한 자료(알림·공정 상세·LOT 이력·라인 상태·발주 등)를 이 화면의 데이터에서 직접 조회합니다. API 키는 서버 함수에만 있습니다.'
        : '중계 함수(supabase/functions/mlng-ask)를 배포하면 Claude 가 자유 질문에 답합니다. 지금은 자주 묻는 질문을 규칙으로 답합니다.'}</p></div>`;
  };

  M.PROC.ask = '질의';
  M.mod({
    id: 'ask', group: '현황', order: 1,
    menu: [['ask', '질의응답', 'chat']],
    views: V,
    bind(root) {
      root.querySelectorAll('[data-ask]').forEach(b => b.onclick = () => send(b.dataset.ask));
      const t = root.querySelector('#askq'), g = root.querySelector('#askgo');
      if (t) { t.oninput = () => { draft = t.value; }; t.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(t.value); } }; }
      if (g) g.onclick = () => send(t.value);
      const b = root.querySelector('#chatbox'); if (b) b.scrollTop = b.scrollHeight;
    },
  });
})();
