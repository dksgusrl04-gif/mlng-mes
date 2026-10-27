/* 3.0 ② — 출하 게이트 (출하 전 계약 시뮬레이션)
 * ───────────────────────────────────────────────────────────────
 * 2.0 스마트 발주는 «납품한 뒤» 고객 MES 가 판정해 클레임을 건다. 출하 게이트는 그 판정을 «출하 전에» 우리가 먼저 돌려 본다.
 *   출하 대기 LOT(아직 납품하지 않은 열처리 LOT)마다 여권 내용을 미리 계산 → 활성 스마트 발주의 계약 조항으로 판정
 *   → 미달 예상 · 기준 근접 · 열린 사건 LOT 이면 «보류 권고». 보류·해제·출하는 모두 신뢰 원장에 남는다.
 * 클레임을 «맞는» MES 에서 «막는» MES 로.
 */
(function () {
  'use strict';
  const M = window.MLNG, T = window.MLNGTrust, DX = M.dx, { esc, f, pct } = M;
  const G = M.gate = { holds: {}, rules: { clause: true, near: false, cases: true, dev: true }, log: [] };
  const RULES = { clause: '계약 조항 미달이 예상되면 보류 권고', near: '기준의 10% 안으로 근접하면 보류 권고', cases: '열린 사건에 걸린 LOT 이면 보류 권고', dev: '열처리 조건 이탈 5% 이상이면 보류 권고' };
  const H = () => M.S.heat || { lots: [] };
  const delivered = () => new Set([].concat(...(T.orders || []).map(o => o.deliveries.map(d => d.lot))));

  G.candidates = (days = 14) => { const dl = delivered(), t = M.sinceDay(days).getTime(); return H().lots.filter(l => M.toDate(l.end).getTime() >= t && !dl.has(l.id)).slice().reverse(); };
  G.predict = (lot, opt = {}) => {
    const hl = H().lots.find(l => l.id === lot), so = DX.activeSO(), out = { lot, qty: hl ? hl.qty : 0, end: hl ? hl.end : '', checks: [], cases: [], held: G.holds[lot] || null };
    if (!so || !T.passportPreview || !T.dealCL) { out.status = 'na'; out.rec = 'ship'; return out; }
    const p = T.passportPreview(lot), CL = T.dealCL; out.so = so.id; out.pp = p;
    so.clauses.filter(c => c.k !== 'passport').forEach(c => {
      const a = CL[c.k].get(p), na = a === undefined, ok = na ? true : a == null ? false : c.op === '≤' ? a <= c.v : a >= c.v;
      const near = !na && ok && a != null && (c.op === '≤' ? a > c.v * 0.9 : a < c.v * 1.1);
      out.checks.push({ k: c.k, label: CL[c.k].label, op: c.op, v: c.v, a, na, ok, near, actual: T.dealFmt(c.k, a), th: `${c.op} ${T.dealFmt(c.k, c.v)}` });
    });
    out.cases = M.caseApi && !opt.noCase ? M.caseApi.casesOfLot(lot) : [];
    const dev = hl && M.heatDev ? M.heatDev(hl) : 0; out.dev = dev;
    const why = [];
    if (G.rules.clause && out.checks.some(c => !c.ok)) why.push('계약 조항 미달 예상 — ' + out.checks.filter(c => !c.ok).map(c => `${c.label} ${c.actual} (${c.th})`).join(', '));
    if (G.rules.near && out.checks.some(c => c.near)) why.push('기준 근접 — ' + out.checks.filter(c => c.near).map(c => `${c.label} ${c.actual}`).join(', '));
    if (G.rules.cases && out.cases.length) why.push('열린 사건 ' + out.cases.map(c => c.id).join(', '));
    if (G.rules.dev && dev >= ((M.CFG.HEAT || {}).DEVIATION_RATE || 0.05)) why.push(`열처리 조건 이탈 ${pct(dev, 1)}`);
    out.why = why;
    out.status = out.checks.some(c => !c.ok) ? 'fail' : out.checks.some(c => c.near) ? 'near' : 'ok';
    out.rec = why.length ? 'hold' : 'ship';
    out.claimWon = out.checks.some(c => !c.ok) ? DX.claimCost(out.qty) : 0;
    return out;
  };
  G.isHeld = lot => !!G.holds[lot];
  G.hold = async (lot, reason, by) => { if (G.holds[lot]) return G.holds[lot]; if (delivered().has(lot)) throw new Error(`${lot} 은 이미 납품했습니다 — 보류 대신 사건실에서 고객 대응`); const h = G.holds[lot] = { lot, at: T.stamp(), by: by || M.D.user().name, reason: reason || '' };
    await T.append('MLNG', 'gate', lot, `출하 보류 — ${lot} · ${reason || ''}`.slice(0, 160), h); G.log.unshift({ at: h.at, lot, act: '보류', by: h.by, why: reason }); return h; };
  G.release = async (lot, by) => { const h = G.holds[lot]; if (!h) return; delete G.holds[lot]; await T.append('MLNG', 'gate', lot, `출하 보류 해제 — ${lot}`, { lot, by: by || M.D.user().name }); G.log.unshift({ at: T.stamp(), lot, act: '해제', by: by || M.D.user().name, why: '' }); };
  G.ship = async lot => { if (G.holds[lot]) throw new Error(`${lot} 은 출하 보류 중입니다`); const so = DX.activeSO(); if (!so) throw new Error('수락한 스마트 발주가 없습니다'); const d = await T.dealEvaluate(so, lot); G.log.unshift({ at: T.stamp(), lot, act: d.result === 'accepted' ? '출하 · 자동 검수 합격' : '출하 · 클레임', by: M.D.user().name, why: '' }); return d; };
  // 실시간 모드: 서버 원장(서명된 기록)에서 보류 상태를 다시 만든다 — 원장이 곧 상태의 근거
  G.restore = () => { (T.ledger || []).filter(e => e.kind === 'gate').forEach(e => {
    if (/^출하 보류 해제/.test(e.title)) delete G.holds[e.ref];
    else if (/^출하 보류/.test(e.title)) G.holds[e.ref] = { lot: e.ref, at: e.at, by: '원장 복원', reason: String(e.title).split(' · ').slice(1).join(' · ') }; }); return Object.keys(G.holds).length; };
  T.onInit(() => { if (M.D.LIVE) G.restore(); });
  // 계약 여유 예보: 최근 30 LOT 중 기준을 넘은 비율 = 다음 LOT 이 넘을 확률(경험적)
  G.forecast = () => {
    const so = DX.activeSO(); if (!so) return null; const cl = so.clauses.find(c => c.k === 'heat_ppm'); if (!cl) return null;
    const ls = H().lots.slice(-30), over = ls.filter(l => l.ppm > cl.v), mean = ls.reduce((s, l) => s + l.ppm, 0) / Math.max(1, ls.length);
    return { th: cl.v, n: ls.length, over: over.length, p: ls.length ? over.length / ls.length : 0, mean, margin: cl.v - mean };
  };

  const SHORT = { heat_ppm: '열처리', heat_dev: '조건 이탈', press_cpk: '프레스 Cpk', tool_vb: '공구 VB', insp_fail: '검사 불합격', pcf: '탄소(g)' };
  let msg = '', sel = 'all';
  const ST = { ok: ['j-ok', '출하 가능'], near: ['j-warn', '기준 근접'], fail: ['j-danger', '미달 예상'], na: ['t-off', '계약 없음'] };
  const V = {};
  V.gate = () => {
    if (!T.ready) return '<div class="empty">신뢰 계층을 준비하는 중…</div>';
    const so = DX.activeSO(), rows = G.candidates().map(l => G.predict(l.id)), fc = G.forecast();
    const shipOk = rows.filter(r => r.rec === 'ship' && !r.held), recHold = rows.filter(r => r.rec === 'hold' && !r.held), held = rows.filter(r => r.held);
    const avoid = rows.filter(r => r.rec === 'hold').reduce((s, r) => s + r.claimWon, 0);
    const show = rows.filter(r => sel === 'all' || (sel === 'hold' ? r.rec === 'hold' || r.held : sel === 'ship' ? r.rec === 'ship' && !r.held : true));
    const cls = so ? so.clauses.filter(c => c.k !== 'passport') : [];
    return `<div class="kstrip">
      <div class="kpi click" data-gsel="all"><div class="lab">출하 대기</div><div class="val">${rows.length}<small>LOT</small></div><div class="foot">${f(rows.reduce((s, r) => s + r.qty, 0), 0)}개 · 최근 14일 · 아직 납품 안 함</div></div>
      <div class="kpi click" data-gsel="ship"><div class="lab">출하 가능</div><div class="val" style="color:var(--ok)">${shipOk.length}<small>LOT</small></div><div class="foot">계약 조항 모두 만족 예상</div></div>
      <div class="kpi click" data-gsel="hold"><div class="lab">보류 권고 · 보류 중</div><div class="val" style="color:${recHold.length ? 'var(--danger-ink)' : 'inherit'}">${recHold.length}<small>/ ${held.length}</small></div><div class="foot">출하했다면 클레임 ${DX.won(avoid)} 예상</div></div>
      ${fc ? `<div class="kpi"><div class="lab">계약 여유 예보 · 열처리 PPM</div><div class="val">${pct(fc.p, 0)}</div><div class="foot">최근 ${fc.n} LOT 중 ${fc.over}개가 기준 ${fc.th} 초과 — 다음 LOT 이 넘을 확률</div></div>` : ''}
    </div>
    ${!so ? '<div class="card"><div class="empty">수락한 스마트 발주가 없어 판정할 계약 조항이 없습니다 — 스마트 발주에서 수락 서명을 하세요</div></div>' : `
    <div class="card"><h2>출하 전 판정 <span class="h2sub">${esc(so.id)} · ${esc(T.co(so.buyer).name)} 계약 조항으로 출하 전에 미리 판정합니다 — 고객이 받기 전에 우리가 먼저 거릅니다</span></h2>
      <div class="tools">${M.seg('gsel', sel, [['all', '전체'], ['ship', '출하 가능'], ['hold', '보류 권고·보류 중']])}
        <span style="margin-left:auto;display:flex;gap:6px"><button class="btn sm" id="gt-holdall" ${recHold.length ? '' : 'disabled'}>보류 권고 ${recHold.length}건 보류</button><button class="btn pri sm" id="gt-shipall" ${shipOk.length ? '' : 'disabled'}>출하 가능 ${shipOk.length}건 납품</button></span></div>
      <p class="note" style="margin-top:0">계약 조항: ${cls.map(c => `${esc(T.dealCL[c.k].label)} ${esc(c.op)} ${esc(T.dealFmt(c.k, c.v))}`).join(' · ')} — ✓ 만족 · △ 기준의 10% 안 · ✕ 미달</p>
      ${M.table([['LOT', r => `<b>${esc(r.lot)}</b><div class="muted" style="font-size:11.5px">${esc(String(r.end).slice(5, 16))}</div>`], ['수량', r => f(r.qty, 0), 'n']]
        .concat([['계약 조항 미리 판정', r => `<div class="gchk">${r.checks.map(x => `<span class="${x.na ? 'na' : !x.ok ? 'ng' : x.near ? 'nr' : 'ok'}" title="${esc(`${x.label} ${x.actual} (기준 ${x.th})`)}">${x.na ? '–' : !x.ok ? '✕' : x.near ? '△' : '✓'} ${esc(SHORT[x.k] || x.k)} <b>${esc(x.actual)}</b></span>`).join('')}</div>`]])
        .concat([['사건', r => r.cases.length ? r.cases.map(c => `<a href="#" data-go="case:${esc(c.id)}" class="chip c-ext">${esc(c.id)}</a>`).join(' ') : '<span class="muted">—</span>'],
          ['판정', r => r.held ? '<span class="tag j-danger">보류 중</span>' : r.rec === 'hold' ? `<span class="tag j-warn" title="${esc(r.why.join('\n'))}">보류 권고</span>` : `<span class="tag ${ST[r.status][0]}">${ST[r.status][1]}</span>`],
          ['', r => `<div style="display:flex;gap:4px;justify-content:flex-end">` + (r.held ? `<button class="btn sm" data-grel="${esc(r.lot)}">해제</button>` : `${r.rec === 'hold' ? `<button class="btn sm" data-ghold="${esc(r.lot)}">보류</button>` : ''}<button class="btn sm ${r.rec === 'ship' ? 'pri' : ''}" data-gship="${esc(r.lot)}">출하</button>`) + '</div>']]),
        show, { wrap: false, click: r => 'gate:' + r.lot, hl: r => r.rec === 'hold' || r.held, empty: '해당하는 출하 대기 LOT 이 없습니다' })}
      ${msg ? `<p class="note">${esc(msg)}</p>` : ''}
      <p class="note">판정은 2.0 LOT 여권과 같은 계산으로 미리 해 본 결과이고, 원장에는 보류·해제·출하만 남습니다. 「출하」 를 누르면 스마트 발주 납품 → 고객 MES 자동 검수까지 이어집니다.</p></div>`}
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>보류 규칙 <span class="h2sub">회사가 정합니다 — 바꾸면 위 판정이 바로 다시 계산됩니다</span></h2>
        <div class="ckl">${Object.entries(RULES).map(([k, t]) => `<label class="ck"><input type="checkbox" data-grule="${k}" ${G.rules[k] ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div></div>
      <div class="card"><h2>게이트 기록 <a class="more" href="#" data-go="net_ledger">신뢰 원장 →</a></h2>
        ${M.table([['시각', l => `<span class="muted">${esc(l.at.slice(5, 16))}</span>`], ['LOT', l => `<b>${esc(l.lot)}</b>`], ['처리', 'act'], ['사유', l => `<span class="muted" style="font-size:12px">${esc(String(l.why || '').slice(0, 60))}</span>`], ['담당', 'by']], G.log.slice(0, 12), { wrap: false, empty: '아직 보류·출하 기록이 없습니다' })}</div></div>`;
  };
  function openLot(lot) {
    const r = G.predict(lot), c = DX.C();
    M.drawer('출하 게이트 · 출하 전 판정', `${lot} ${r.held ? '보류 중' : r.rec === 'hold' ? '보류 권고' : '출하 가능'}`, `
      ${r.why && r.why.length ? `<div class="note" style="margin-top:0;color:var(--danger-ink)">${r.why.map(esc).join('<br>')}</div>` : '<div class="note" style="margin-top:0;color:var(--ok)">보류 사유가 없습니다</div>'}
      <h3 class="dh">계약 조항 미리 판정 (${esc(r.so || '')})</h3>
      ${M.table([['조항', 'label'], ['예상 값', 'actual', 'n'], ['기준', 'th'], ['판정', x => x.na ? '<span class="muted">해당 없음</span>' : !x.ok ? '<span class="tag j-danger">미달</span>' : x.near ? '<span class="tag j-warn">근접</span>' : '<span class="tag j-ok">만족</span>']], r.checks, { wrap: false })}
      <h3 class="dh">돈</h3>${M.dl([['출하 수량', f(r.qty, 0) + '개'], ['매출', DX.won(r.qty * c.PRICE)], ['미달 시 클레임', r.claimWon ? DX.won(r.claimWon) : '—'], ['열처리 조건 이탈', pct(r.dev || 0, 1)]])}
      <h3 class="dh">여권 단계 (미리 보기)</h3>${r.pp ? M.table([['단계', 'name'], ['LOT', s => `<b>${esc(s.lot)}</b>`], ['회사', s => esc(T.co(s.company).short)]], r.pp.steps, { wrap: false }) : ''}
      <div class="pacts">${r.held ? `<button class="btn" data-grel="${esc(lot)}">보류 해제</button>` : `<button class="btn" data-ghold="${esc(lot)}">출하 보류</button><button class="btn pri" data-gship="${esc(lot)}">출하 → 자동 검수</button>`}
        <a class="btn" href="#" data-go="trace:${esc(lot)}">LOT 이력</a></div>`);
  }

  M.mod({
    id: 'gate', group: '판단 (3.0)', order: 4,
    menu: [['gate', '출하 게이트', 'gate']],
    views: V,
    drawers: { 'gate:': openLot },
    alerts: () => { if (!T.ready || !DX.activeSO()) return []; const rs = G.candidates().map(l => G.predict(l.id, { noCase: true })).filter(r => r.rec === 'hold' && !r.held);
      return rs.length ? [{ proc: 'gate', level: 'warn', title: `출하 보류 권고 ${rs.length} LOT — ${rs.slice(0, 3).map(r => r.lot).join(', ')}`, body: rs[0].why.join(' · '), by: '출하 게이트', at: rs[0].end, go: 'gate' }] : []; },
    bind(root) {
      const act = async (fn, okMsg) => { try { msg = ''; await fn(); if (okMsg) msg = okMsg; } catch (e) { msg = e.message; } M.closeDrawer(); M.render(); };
      root.querySelectorAll('[data-gsel]').forEach(b => b.onclick = () => { sel = b.dataset.gsel; M.render(); });
      root.querySelectorAll('[data-grule]').forEach(b => b.onchange = () => { G.rules[b.dataset.grule] = b.checked; M.render(); });
      root.querySelectorAll('[data-ghold]').forEach(b => b.onclick = e => { e.stopPropagation(); const r = G.predict(b.dataset.ghold); act(() => G.hold(r.lot, r.why.join(' · ') || '담당자 판단'), `${r.lot} 출하 보류 — 원장 기록`); });
      root.querySelectorAll('[data-grel]').forEach(b => b.onclick = e => { e.stopPropagation(); act(() => G.release(b.dataset.grel), `${b.dataset.grel} 보류 해제`); });
      root.querySelectorAll('[data-gship]').forEach(b => b.onclick = e => { e.stopPropagation(); const lot = b.dataset.gship; act(async () => { const d = await G.ship(lot); msg = `${lot} 출하 → ${d.result === 'accepted' ? '고객 MES 자동 검수 합격 · 정산 승인' : '고객 MES 클레임 생성 — 스마트 발주에서 확인'}`; }); });
      const ha = root.querySelector('#gt-holdall'); if (ha) ha.onclick = () => act(async () => { for (const l of G.candidates()) { const r = G.predict(l.id); if (r.rec === 'hold' && !r.held) await G.hold(r.lot, r.why.join(' · ')); } }, '보류 권고 LOT 을 모두 보류했습니다');
      const sa = root.querySelector('#gt-shipall'); if (sa) sa.onclick = () => act(async () => { let n = 0, cl = 0; for (const l of G.candidates()) { const r = G.predict(l.id); if (r.rec === 'ship' && !r.held) { const d = await G.ship(r.lot); n++; if (d.result !== 'accepted') cl++; } } msg = `${n} LOT 출하 · 자동 검수 합격 ${n - cl} · 클레임 ${cl}`; }, '');
    },
  });
  M.PROC.gate = '출하 게이트';
})();
