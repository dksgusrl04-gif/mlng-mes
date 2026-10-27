/* 3.0 ⑥ — 교대 인수인계 (서명으로 넘기고 받는다)
 * ───────────────────────────────────────────────────────────────
 * 교대 사이에 정보가 가장 많이 샌다. MES 가 이번 교대 동안 바뀐 것만 골라 브리핑을 만들고,
 * 다음 교대가 «꼭 할 일» 을 사건 · 계획 · 공구 · 출하 · 결재에서 자동으로 뽑는다.
 *   넘기는 사람이 확인·메모 후 서명 → 받는 사람이 항목을 확인하고 서명 → 둘 다 신뢰 원장에 남는다 (책임 이전이 분명해짐).
 */
(function () {
  'use strict';
  const M = window.MLNG, T = window.MLNGTrust, DX = M.dx, { esc, f } = M;
  const SC = () => Object.assign({ DAY_START: 8, HOURS: 12 }, M.CFG.SHIFT || {});
  const HIST = [];   // { key, from, to, items, note, out:{by,at,sig}, in:{by,at,sig} }
  let off = 0, note = '', checks = {}, msg = '';
  const fmt = d => d.toLocaleString('sv-SE').slice(0, 16);
  function shift(o = 0) {
    const c = SC(), now = M.now(), s = new Date(now); s.setMinutes(0, 0, 0);
    const h = now.getHours(), dayShift = h >= c.DAY_START && h < c.DAY_START + c.HOURS;
    s.setHours(dayShift ? c.DAY_START : c.DAY_START + c.HOURS); if (!dayShift && h < c.DAY_START) s.setDate(s.getDate() - 1);
    const st = new Date(s.getTime() + o * c.HOURS * 3600000), en = new Date(st.getTime() + c.HOURS * 3600000);
    const isDay = st.getHours() === c.DAY_START;
    return { st, en, s: fmt(st), e: fmt(en), name: `${st.toLocaleString('sv-SE').slice(5, 10)} ${isDay ? '주간' : '야간'}`, key: `${fmt(st).slice(0, 10)}-${isDay ? 'D' : 'N'}` };
  }
  const inW = (t, w) => { const x = String(t || '').slice(0, 16); return x >= w.s && x < w.e; };
  function brief(o = 0) {
    const w = shift(o), S = M.S, al = M.alerts();
    const lots = S.lots.filter(l => l.kind === 'process' && inW(l.proc === 'press' ? l.start_at : l.end_at, w));
    const prod = ['press', 'weld', 'heat', 'mach', 'insp'].map(p => { const ls = lots.filter(l => l.proc === p); return { p, n: ls.length, q: ls.reduce((s, l) => s + (l.qty || 0), 0), b: ls.some(l => l.bad != null) ? ls.reduce((s, l) => s + (l.bad || 0), 0) : null }; }).filter(r => r.n);
    const newAl = al.filter(a => a.level !== 'info' && inW(a.at, w)), openAl = al.filter(a => a.level !== 'info');
    const cases = M.caseApi ? M.caseApi.open() : [];
    const todo = [];
    cases.forEach(c => { const n = M.caseApi.next(c); todo.push({ id: 'case:' + c.id, t: `${c.name} — ${n ? n.label : '단계 진행'}`, go: 'case:' + c.id, src: '사건', won: c.money.won }); });
    if (M.planApi && !cases.some(c => c.tpl === 'plan')) M.planApi.items().forEach(it => { const s = M.planApi.stat(it); if (s.short) todo.push({ id: 'plan:' + it, t: `${it} 아침 출하 전 생산 ${f(s.need, 0)}개 — 마감 재고 ${f(s.last.inv_close, 0)} < 예상 수주 ${f(s.avg, 0)}`, go: 'plan_home', src: '계획' }); });
    const md = S.mach || { tools: [] }, lt = md.tools[md.tools.length - 1], vw = (M.CFG.MACH || {}).VB_WARN || 0.35;
    if (lt && lt.vb_last >= vw) todo.push({ id: 'tool:' + lt.id, t: `MCT ${lt.id} 인서트 상태 확인 — 마지막 VB ${f(lt.vb_last, 2)} mm`, go: 'mach:' + lt.id, src: '공구' });
    if (M.gate && T.ready) { const rh = M.gate.candidates().map(l => M.gate.predict(l.id)).filter(r => r.rec === 'hold' && !r.held); if (rh.length) todo.push({ id: 'gate', t: `출하 보류 권고 ${rh.length} LOT 판단 — ${rh.slice(0, 3).map(r => r.lot).join(', ')}`, go: 'gate', src: '출하' }); }
    if (M.buyApi) { const pend = M.buyApi.orders().filter(o => o.status === 'pending'); if (pend.length) todo.push({ id: 'po', t: `결재 대기 발주 ${pend.length}건 — ${pend.map(o => `${o.id}(${M.buyApi.nextStep(o)})`).join(', ')}`, go: 'buy_orders', src: '구매' }); }
    if (T.agent) { const ap = T.agent.items.filter(x => x.status === 'pending'); if (ap.length) todo.push({ id: 'agent', t: `에이전트 조치안 승인 ${ap.length}건`, go: 'agent', src: '에이전트' }); }
    const L = M.lineSummary ? M.lineSummary() : null;
    const ledger = (T.ledger || []).filter(e => inW(e.at, w)).length;
    return { w, prod, newAl, openAl, cases, todo, L, ledger, holds: M.gate ? Object.keys(M.gate.holds).length : 0 };
  }
  M.shiftApi = {
    brief: (o = 0) => { const b = brief(o); return { shift: b.w.name, from: b.w.s, to: b.w.e, production: b.prod.map(r => ({ process: M.PROC[r.p], lots: r.n, qty: r.q, bad: r.b })), new_alerts: b.newAl.map(a => a.title), open_alerts: b.openAl.length, open_cases: b.cases.map(c => `${c.id} ${c.name} (${M.caseApi.STAGES[c.st.stage]})`), next_shift_must_do: b.todo.map(t => t.t), line: b.L, handovers: HIST.filter(h => h.key === b.w.key).map(h => ({ out: h.out && h.out.by, in: h.in && h.in.by })) }; },
  };
  const body = h => ({ key: h.key, from: h.from, to: h.to, items: h.items, note: h.note, out_by: h.out && h.out.by });

  const V = {};
  V.shift = () => {
    if (!T.ready) return '<div class="empty">신뢰 계층을 준비하는 중…</div>';
    const b = brief(off), w = b.w, h = HIST.find(x => x.key === w.key), workers = (M.S.masters.workers || []).map(x => x.name);
    const done = b.todo.filter(t => checks[w.key + t.id]).length;
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">교대</div><div class="val" style="font-size:18px">${esc(w.name)}</div><div class="foot">${esc(w.s.slice(11))} ~ ${esc(w.e.slice(11))} · ${off === 0 ? '지금 교대' : off < 0 ? `${-off}교대 전` : ''}</div></div>
      <div class="kpi"><div class="lab">이번 교대 생산</div><div class="val">${f(b.prod.reduce((s, r) => s + (r.p === 'heat' ? r.q : 0), 0), 0)}<small>개</small></div><div class="foot">${b.prod.map(r => `${esc(M.PROC[r.p])} ${r.n}`).join(' · ') || '완료 작업 없음'}</div></div>
      <div class="kpi"><div class="lab">새로 생긴 알림</div><div class="val" style="color:${b.newAl.some(a => a.level === 'danger') ? 'var(--danger-ink)' : 'inherit'}">${b.newAl.length}<small>건</small></div><div class="foot">넘겨받을 열린 알림 ${b.openAl.length}</div></div>
      <div class="kpi"><div class="lab">인수인계</div><div class="val" style="font-size:17px;color:${h && h.in ? 'var(--ok)' : h ? 'var(--warn-ink)' : 'inherit'}">${h && h.in ? '완료' : h ? '받는 서명 대기' : '작성 중'}</div><div class="foot">${h ? `넘김 ${esc(h.out.by)}${h.in ? ' → 받음 ' + esc(h.in.by) : ''}` : '넘기는 사람 서명 전'}</div></div>
    </div>
    <div class="card"><h2>교대 브리핑 <span class="h2sub">이번 교대 동안 바뀐 것만</span><span class="more" style="display:flex;gap:6px"><button class="btn sm" data-sh="-1">◀ 이전 교대</button><button class="btn sm" data-sh="1" ${off >= 0 ? 'disabled' : ''}>다음 교대 ▶</button><button class="btn sm" id="sh-print">출력</button></span></h2>
      <div class="grid g2" style="align-items:start">
        <div><h3 class="dh" style="margin-top:0">생산</h3>${M.table([['공정', r => M.procTag(r.p)], ['완료 작업', 'n', 'n'], ['수량', r => f(r.q, 0), 'n'], ['불량', r => r.b == null ? '—' : f(r.b, 0), 'n']], b.prod, { wrap: false, empty: '이번 교대에 완료한 작업이 없습니다' })}
          ${b.L ? `<p class="note">라인: 지금 계획 하루 ${f(b.L.possible_per_day, 0)}개 (목표 ${f(b.L.target_per_day, 0)}) · 병목 ${esc(b.L.bottleneck)}</p>` : ''}
          <h3 class="dh">이번 교대에 생긴 알림</h3>${b.newAl.length ? `<div class="alist">${b.newAl.map(a => `<div class="al ${esc(a.level)} ${a.go ? 'click' : ''}" ${a.go ? `data-row="${esc(a.go)}"` : ''}><div class="lv"></div><div style="min-width:0"><div class="tt">${esc(a.title)} ${DX.chip(DX.money(a))}</div><div class="mt">${M.procTag(a.proc)}<span>${esc(a.at || '')}</span></div></div></div>`).join('')}</div>` : '<div class="empty">새 알림 없음</div>'}</div>
        <div><h3 class="dh" style="margin-top:0">다음 교대가 꼭 할 일 <span class="h2sub">${done}/${b.todo.length} 확인</span></h3>
          <div class="shtodo">${b.todo.map(t => `<label class="${checks[w.key + t.id] ? 'ok' : ''}"><input type="checkbox" data-shck="${esc(w.key + t.id)}" ${checks[w.key + t.id] ? 'checked' : ''}><span class="chip c-ext">${esc(t.src)}</span><div>${esc(t.t)}${t.won ? ` ${DX.chip({ won: t.won, kind: 'risk', basis: [] })}` : ''}</div><a href="#" data-go="${esc(t.go)}">보기</a></label>`).join('') || '<div class="empty">넘길 할 일이 없습니다</div>'}</div>
          <h3 class="dh">넘기는 말</h3><textarea class="in" id="sh-note" rows="3" style="width:100%" placeholder="예: 소입로 2존 출력 계속 관찰 · HT-148069 보류 판단은 품질팀과 협의 중" ${h ? 'disabled' : ''}>${esc(h ? h.note : note)}</textarea>
          <div class="pacts">${!h ? `<select class="in" id="sh-from">${workers.map(x => `<option>${esc(x)}</option>`).join('')}</select><button class="btn pri" id="sh-out">넘김 서명</button>`
            : !h.in ? `<select class="in" id="sh-to">${workers.map(x => `<option>${esc(x)}</option>`).join('')}</select><button class="btn pri" id="sh-in" ${done < b.todo.length ? 'title="모든 항목을 확인해야 받을 수 있습니다"' : ''}>받음 서명 (${done}/${b.todo.length} 확인)</button>`
            : `<span class="tag j-ok">✓ ${esc(h.out.by)} → ${esc(h.in.by)} · ${esc(h.in.at.slice(5, 16))}</span>`}</div>
          ${msg ? `<p class="note">${esc(msg)}</p>` : ''}</div></div></div>
    <div class="card" style="margin-top:16px"><h2>인수인계 기록 <a class="more" href="#" data-go="net_ledger">신뢰 원장 →</a></h2>
      ${M.table([['교대', 'key'], ['넘김', h2 => h2.out ? `${esc(h2.out.by)} <span class="muted">${esc(h2.out.at.slice(5, 16))}</span>` : '—'], ['받음', h2 => h2.in ? `${esc(h2.in.by)} <span class="muted">${esc(h2.in.at.slice(5, 16))}</span>` : '<span class="tag j-warn">대기</span>'], ['할 일', h2 => f(h2.items.length, 0), 'n'], ['넘기는 말', h2 => `<span class="muted" style="font-size:12px">${esc(h2.note.slice(0, 60))}</span>`], ['서명', h2 => `<span class="mono" style="font-size:11px">${esc(T.short(h2.out.sig.hash))}</span>`]], HIST, { wrap: false, empty: '아직 서명한 인수인계가 없습니다' })}</div>`;
  };
  function printOut() {
    const b = brief(off), w2 = window.open('', '_blank'); if (!w2) return;
    w2.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>교대 인수인계 ${esc(b.w.name)}</title><style>body{font-family:"Malgun Gothic",sans-serif;margin:26px;font-size:13px}h1{font-size:18px}h2{font-size:14px;border-bottom:1px solid #333;margin-top:16px}li{margin:3px 0}</style></head><body>
      <h1>교대 인수인계 — ${esc(b.w.name)} (${esc(b.w.s)} ~ ${esc(b.w.e.slice(11))})</h1>
      <h2>생산</h2><ul>${b.prod.map(r => `<li>${esc(M.PROC[r.p])} ${r.n}작업 · ${f(r.q, 0)}개${r.b != null ? ` · 불량 ${f(r.b, 0)}` : ''}</li>`).join('') || '<li>없음</li>'}</ul>
      <h2>새 알림</h2><ul>${b.newAl.map(a => `<li>${esc(a.title)}</li>`).join('') || '<li>없음</li>'}</ul>
      <h2>다음 교대가 꼭 할 일</h2><ul>${b.todo.map(t => `<li>☐ [${esc(t.src)}] ${esc(t.t)}</li>`).join('')}</ul>
      <h2>넘기는 말</h2><p>${esc(note)}</p><p>넘김 ____________ 받음 ____________</p></body></html>`); w2.document.close();
  }

  M.mod({
    id: 'shift', group: '판단 (3.0)', order: 7,
    menu: [['shift', '교대 인수인계', 'shift']],
    views: V,
    bind(root) {
      root.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { off = Math.min(0, off + +b.dataset.sh); msg = ''; M.render(); });
      root.querySelectorAll('[data-shck]').forEach(c => c.onchange = () => { checks[c.dataset.shck] = c.checked; M.render(); });
      const nt = root.querySelector('#sh-note'); if (nt) nt.oninput = () => { note = nt.value; };
      const p = root.querySelector('#sh-print'); if (p) p.onclick = printOut;
      const o = root.querySelector('#sh-out'); if (o) o.onclick = async () => { const b = brief(off);
        const h = { key: b.w.key, from: b.w.s, to: b.w.e, items: b.todo.map(t => t.t), note: note.trim() };
        h.out = Object.assign({ by: M.$('#sh-from').value, at: T.stamp() }, await T.sign('MLNG', body(h)));
        await T.append('MLNG', 'shift', h.key, `교대 넘김 서명 — ${b.w.name} · ${h.out.by} · 할 일 ${h.items.length}건`, body(h)); HIST.unshift(h); note = ''; msg = '넘김 서명 완료 — 받는 사람이 항목을 확인하고 서명하면 끝납니다'; M.render(); };
      const i = root.querySelector('#sh-in'); if (i) i.onclick = async () => { const b = brief(off), h = HIST.find(x => x.key === b.w.key), n = b.todo.filter(t => checks[b.w.key + t.id]).length;
        if (n < b.todo.length) { msg = `확인하지 않은 할 일이 ${b.todo.length - n}건 있습니다 — 모두 확인해야 받을 수 있습니다`; M.render(); return; }
        h.in = Object.assign({ by: M.$('#sh-to').value, at: T.stamp() }, await T.sign('MLNG', Object.assign(body(h), { in_by: M.$('#sh-to').value })));
        await T.append('MLNG', 'shift', h.key, `교대 받음 서명 — ${h.in.by} (할 일 ${h.items.length}건 확인)`, { key: h.key, in_by: h.in.by }); msg = '인수인계 완료 — 책임이 넘어갔습니다'; M.render(); };
    },
  });
})();
