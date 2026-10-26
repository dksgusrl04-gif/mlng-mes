/* 라인 운영 — 공정 사이 흐름을 한 화면에서 맞춘다
 * 각 공정의 «현재 속도»(최근 작업일 평균 처리량), «관측 최대 능력», 수율, 경로 비율을 데이터에서 계산하고
 * 공정별 속도·계획 수량을 바꾸면 → 앞뒤 공정 수급 차이(재공 증감), 병목, 최종 산출, 조정 제안이 바로 다시 계산된다.
 *
 * 흐름 (부품 기준, 하루)
 *   프레스 ─┬─ (보강 브래킷 사양 일부) 점용접 ─┐
 *           └──────────────────────────────────┴→ 열처리 ─→ (가공 사양 일부) MCT 가공 → 정밀가공 검사
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f, pct } = M;
  const STEPS = [
    { proc: 'press', name: '프레스 성형', eq: 'PR-01', go: 'press_home' },
    { proc: 'weld', name: '점용접', eq: 'SP-01', go: 'weld_home', side: true },
    { proc: 'heat', name: '염욕 소입 열처리', eq: 'SB-01', go: 'heat_home' },
    { proc: 'mach', name: 'MCT 가공', eq: 'MC-01', go: 'mach_home', side: true },
    { proc: 'insp', name: '정밀가공 검사', eq: 'IN-01', go: 'insp_home', side: true },
  ];
  const st = { speed: {}, wip: {}, target: null, sel: 'heat', mach_cap: null };

  // ── 데이터에서 기준값 만들기
  function base() {
    const S = M.S, since = M.sinceDay(M.CFG.RECENT_DAYS || 7).getTime();
    const lots = (S.lots || []).filter(l => l.kind === 'process');
    const daily = p => { const m = {}; lots.filter(l => l.proc === p).forEach(l => { const d = String(l.proc === 'press' ? l.start_at : l.end_at).slice(0, 10), x = m[d] = m[d] || { q: 0, b: 0, nb: 0 }; x.q += l.qty || 0; if (l.bad != null) { x.b += l.bad; x.nb += l.qty || 0; } }); return m; };
    const out = {};
    STEPS.forEach(s => {
      if (s.external) return;
      const m = daily(s.proc), days = Object.keys(m).sort(), rec = days.filter(d => M.toDate(d).getTime() >= since);
      const use = rec.length ? rec : days.slice(-5);
      const all = days.map(d => m[d]), b = all.reduce((t, x) => t + x.b, 0), nb = all.reduce((t, x) => t + x.nb, 0);
      out[s.proc] = { rate: use.reduce((t, d) => t + m[d].q, 0) / Math.max(1, use.length), cap: Math.max(0, ...all.map(x => x.q)), days: use.length,
        yield: nb ? 1 - b / nb : 1, series: days.slice(-20).map(d => ({ d, q: m[d].q })) };
    });
    // 검사 수율은 부품 기준 (불합격 기록이 있는 부품 = 불합격)
    if (S.insp) { const ps = new Map(); S.insp.records.forEach(r => ps.set(r.sn, (ps.get(r.sn) ?? true) && r.ok)); const n = ps.size, ok = [...ps.values()].filter(Boolean).length; if (out.insp && n) out.insp.yield = ok / n; }
    // 경로 비율: 점용접 = 프레스 처리량 대비, 가공·검사 = 열처리 처리량 대비
    // MCT 데이터가 없으면 검사 처리량을 MCT 몫으로 쓰고 능력은 직접 입력받는다
    if (!out.mach || !out.mach.rate) out.mach = { rate: out.insp ? out.insp.rate : 0, cap: st.mach_cap, yield: 1, series: [], external: true };
    const sh = { weld: out.weld && out.press ? out.weld.rate / out.press.rate : 0, side: out.mach && out.heat ? out.mach.rate / out.heat.rate : 0 };
    return { b: out, sh };
  }

  // ── 계산: 계획 수량 → 양품 산출, 앞뒤 수급, 병목, 최종 산출
  function model() {
    const { b, sh } = base(), sp = p => (st.speed[p] ?? 100) / 100;
    const plan = {}; STEPS.forEach(s => plan[s.proc] = b[s.proc].rate * sp(s.proc));
    const y = p => b[p].yield;
    // 최종(열처리 양품) 1개를 만들 때 각 공정이 처리해야 하는 양
    const fac = { heat: 1 / y('heat') };
    fac.weld = sh.weld * fac.heat / y('weld');
    fac.press = (fac.heat * (1 - sh.weld) + fac.weld) / y('press');
    fac.mach = sh.side; fac.insp = sh.side * y('mach');
    const target = st.target ?? b.heat.rate * y('heat');
    const need = {}; Object.keys(fac).forEach(p => need[p] = fac[p] * target);
    // 지금 계획으로 만들 수 있는 최종 수량 (주 흐름: 프레스·점용접·열처리)
    const main = ['press', 'weld', 'heat'].map(p => ({ p, t: fac[p] ? plan[p] / fac[p] : Infinity }));
    const lim = main.reduce((a, x) => x.t < a.t ? x : a);
    const capT = ['press', 'weld', 'heat'].map(p => ({ p, t: b[p].cap && fac[p] ? b[p].cap / fac[p] : Infinity })).reduce((a, x) => x.t < a.t ? x : a);
    // 앞뒤 공정 사이 수급 차이 (하루, +면 재공이 쌓이고 −면 줄어든다)
    const gaps = {
      press: { label: '프레스 → 점용접·열처리', sup: plan.press * y('press'), dem: plan.heat * (1 - sh.weld) + plan.weld },
      weld: { label: '점용접 → 열처리', sup: plan.weld * y('weld'), dem: plan.heat * sh.weld },
      heat: { label: '열처리 → MCT 가공', sup: plan.heat * y('heat') * sh.side, dem: plan.mach },
      mach: { label: 'MCT 가공 → 검사', sup: plan.mach * y('mach'), dem: plan.insp },
    };
    Object.values(gaps).forEach(g => g.d = g.sup - g.dem);
    const rty = ['press', 'heat'].reduce((t, p) => t * y(p), 1) * (1 - sh.weld + sh.weld * y('weld'));
    return { b, sh, plan, fac, need, target, lim, capT, gaps, rty, y, final: Math.min(lim.t, Infinity) * 1, insp_good: plan.insp * y('insp') };
  }

  // ── 조정 제안
  // 질의응답에서 쓰는 요약 (지금 화면의 속도·목표 기준)
  M.lineSummary = () => { const m = model(); return { target_per_day: Math.round(m.target), possible_per_day: Math.round(m.lim.t), bottleneck: M.PROC[m.lim.p] || m.lim.p,
    capacity_limit_per_day: Math.round(m.capT.t), capacity_bottleneck: M.PROC[m.capT.p] || m.capT.p,
    wip_gaps_per_day: Object.values(m.gaps).map(g => ({ between: g.label, gap: Math.round(g.d) })) }; };
  function advice(m) {
    const out = [], name = p => (STEPS.find(s => s.proc === p) || {}).name || p, al = M.alerts();
    const hot = p => al.filter(a => a.proc === p && a.level === 'danger');
    // 1) 목표를 못 맞추는 공정
    ['press', 'weld', 'heat', 'mach', 'insp'].forEach(p => {
      const short = m.need[p] - m.plan[p], cap = m.b[p].cap;
      if (short > m.need[p] * 0.01) {
        const sp = m.need[p] / m.b[p].rate * 100, over = cap && m.need[p] > cap;
        out.push({ lv: over ? 'danger' : 'warn', p, t: `${name(p)} ${f(short, 0)}개/일 부족 → 속도 ${f(sp, 0)}% 필요`,
          s: over ? `관측 최대 능력 ${f(cap, 0)}개/일을 넘습니다 — 가동 시간 연장(교대 추가)이나 목표 조정이 필요합니다${hot(p).length ? ' · 이 설비에 긴급 알림이 있어 증속 전 점검 권장' : ''}` : `능력 사용률 ${pct(m.need[p] / cap, 0)}${hot(p).length ? ' · 이 설비에 긴급 알림이 있어 증속 전 점검 권장' : ''}`, fix: { [p]: sp } });
      }
    });
    // 2) 너무 많이 만드는 공정 (재공만 쌓임)
    ['press', 'weld'].forEach(p => { const g = m.gaps[p]; if (g.d > g.dem * 0.05) out.push({ lv: 'info', p, t: `${name(p)} 하루 ${f(g.d, 0)}개 남음 → 속도 ${f(m.plan[p] / m.b[p].rate * 100 * (g.dem / g.sup), 0)}%로 낮추면 재공이 늘지 않음`, s: '뒤 공정이 받는 양보다 많이 만들고 있습니다', fix: { [p]: m.plan[p] / m.b[p].rate * 100 * (g.dem / g.sup) } }); });
    // 3) 뒤 공정이 앞 공정을 다 쓰는 경우 (재공 감소)
    Object.entries(m.gaps).forEach(([p, g]) => { if (g.d < -Math.max(1, g.dem * 0.02)) { const w = st.wip[p]; out.push({ lv: 'warn', p, t: `${g.label}: 하루 ${f(-g.d, 0)}개씩 재공 감소`, s: w ? `현재 재공 ${f(w, 0)}개 → 약 ${f(w / -g.d, 1)}일 뒤 뒤 공정이 멈춥니다` : '현재 재공을 입력하면 뒤 공정이 멈추는 시점을 계산합니다' }); } });
    // 4) 계획이 관측 최대 능력을 넘는 공정
    ['press', 'weld', 'heat', 'mach', 'insp'].forEach(p => { const cap = m.b[p].cap; if (cap && m.plan[p] > cap * 1.001) out.push({ lv: 'danger', p, t: `${name(p)} 계획이 관측 최대 능력의 ${pct(m.plan[p] / cap, 0)}`,
      s: `가장 많이 만든 날보다 하루 ${f(m.plan[p] - cap, 0)}개 더 — 가동 시간을 ${pct(m.plan[p] / cap - 1, 0)} 늘리거나(교대 추가) 목표를 줄여야 합니다. 적용 = 관측 최대로 맞춤`, fix: { [p]: cap / m.b[p].rate * 100 } }); });
    if (!out.length) out.push({ lv: 'ok', t: '공정 사이 수급이 맞습니다', s: '모든 공정이 목표에 필요한 양을 만들고, 재공이 크게 늘거나 줄지 않습니다' });
    return out;
  }

  const spark = s => s.length > 1 ? M.lineChart([{ v: s.map(x => x.q), cls: 's1' }], null, { h: 56, w: 220, d: 0 }).replace('class="chart"', 'class="chart spk"') : '';
  const V = {};
  V.line = () => {
    const m = model(), adv = advice(m), sel = STEPS.find(s => s.proc === st.sel) || STEPS[2];
    const bott = m.lim.p, name = p => (STEPS.find(s => s.proc === p) || {}).name || p;
    const node = s => {
      const b = m.b[s.proc], plan = m.plan[s.proc], need = m.need[s.proc], cap = b.cap, use = cap ? plan / cap : null;
      const spd = st.speed[s.proc] ?? 100, isB = bott === s.proc && m.lim.t < m.target * 0.995;
      return `<div class="lnode ${st.sel === s.proc ? 'sel' : ''} ${isB ? 'bott' : ''} ${s.side ? 'side' : ''}" data-lsel="${s.proc}">
        <div class="lh"><span class="sq">${M.procTag(s.proc)}</span>${isB ? '<span class="tag j-danger">병목</span>' : ''}${s.side ? '<span class="chip c-off">일부 경로</span>' : ''}</div>
        <div class="ln">${esc(s.name)}</div><div class="le">${esc(s.eq)}${b.external ? ' · 데이터 연동 전' : ''}</div>
        <div class="lk"><span>계획 (개/일)</span><input class="in lq" type="number" min="0" step="10" data-lq="${s.proc}" value="${Math.round(plan)}"></div>
        <div class="lsl"><input type="range" min="30" max="200" step="1" value="${Math.round(spd)}" data-lsp="${s.proc}" aria-label="${esc(s.name)} 속도"><b>${f(spd, 0)}%</b></div>
        <dl class="lst2"><dt>목표에 필요</dt><dd style="color:${plan < need * 0.99 ? 'var(--danger-ink)' : 'inherit'}">${f(need, 0)}</dd>
          <dt>현재 속도</dt><dd>${f(b.rate, 0)}</dd><dt>수율</dt><dd>${pct(b.yield, b.yield > 0.999 ? 3 : 1)}</dd></dl>
        ${cap ? `<div class="use"><i style="width:${Math.min(100, use * 100)}%" class="${use > 1 ? 'over' : use > 0.9 ? 'hi' : ''}"></i></div><div class="uset">능력 사용률 <b>${pct(use, 0)}</b> <span class="muted">/ 관측 최대 ${f(cap, 0)}</span></div>`
          : `<div class="uset muted">능력: 데이터 연동 전 <input class="in lcap" type="number" min="0" step="10" placeholder="입력" data-lcap="1" value="${st.mach_cap ?? ''}"></div>`}
        ${spark(b.series || [])}
      </div>`;
    };
    const gap = p => { const g = m.gaps[p]; if (!g) return '<div class="lgap"></div>'; const c = Math.abs(g.d) < Math.max(1, g.dem * 0.02) ? 'ok' : g.d > 0 ? 'up' : 'down';
      return `<div class="lgap g-${c}" title="${esc(g.label)}"><div class="ga"></div><div class="gv">${Math.round(g.d) > 0 ? '+' : ''}${f(Math.round(g.d) || 0, 0)}</div><div class="gl">재공/일</div>
        <input class="in lw" type="number" min="0" step="100" placeholder="현재 재공" data-lw="${p}" value="${st.wip[p] ?? ''}"></div>`; };
    const inspLimit = Math.min(m.plan.mach * m.y('mach'), m.plan.insp);
    return `
    <div class="kstrip nside">
      <div class="kpi click" data-row="k:line:target"><div class="lab">목표 산출 (열처리 양품)</div><div class="val"><input class="in tgt" type="number" min="0" step="100" data-ltgt="1" value="${Math.round(m.target)}"><small>개/일</small></div>
        <div class="foot">기본값 = 최근 열처리 속도 × 수율</div></div>
      <div class="kpi click" data-row="k:line:lim"><div class="lab">지금 계획으로 가능한 산출</div><div class="val" style="color:${m.lim.t < m.target * 0.995 ? 'var(--danger-ink)' : 'var(--ok)'}">${f(m.lim.t, 0)}<small>개/일</small></div>
        <div class="foot">목표 대비 ${pct(m.lim.t / m.target, 0)} · 제약 ${esc(name(m.lim.p))}</div></div>
      <div class="kpi click" data-row="k:line:cap"><div class="lab">설비 능력 한계 (관측 최대 기준)</div><div class="val">${f(m.capT.t, 0)}<small>개/일</small></div><div class="foot">병목 ${esc(name(m.capT.p))} — 이 이상은 가동 시간 연장 필요</div></div>
      <div class="kpi click" data-row="k:line:rty"><div class="lab">누적 수율 (주 흐름)</div><div class="val">${pct(m.rty, 2)}</div><div class="foot">검사 셀 양품 ${f(m.insp_good, 0)}개/일 · 검사 수율 ${pct(m.y('insp'), 1)}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>공정 흐름 조정 <span class="h2sub">속도를 움직이거나 계획 수량을 입력하면 앞뒤 공정 수급이 바로 다시 계산됩니다</span>
      <div style="margin-left:auto;display:flex;gap:6px"><button class="btn sm" data-lauto="target">목표에 맞춤</button><button class="btn sm" data-lauto="cap">능력 한계에 맞춤</button><button class="btn sm" data-lauto="reset">현재로</button></div></h2>
      <div class="lflow">${STEPS.map((s, i) => (i ? gap(STEPS[i - 1].proc) : '') + node(s)).join('')}</div>
      <p class="note">현재 속도 = 최근 ${M.CFG.RECENT_DAYS || 7}일 작업일 평균 처리량(100%), 관측 최대 = 데이터에서 가장 많이 처리한 날. 점용접은 프레스 물량의 ${pct(m.sh.weld, 1)}, MCT 가공·검사는 열처리 물량의 ${pct(m.sh.side, 2)}가 거치는 일부 경로(가공 사양 부품)입니다.
        사이 숫자 = 앞 공정 양품 − 뒤 공정 투입 (하루). 현재 재공을 넣으면 소진·적체 시점을 계산합니다.</p></div>
    <div class="grid g21" style="margin-top:16px">
      <div class="card"><h2>조정 제안</h2>
        <div class="lst">${adv.map(a => `<div class="it"><span class="dot ${a.lv === 'ok' ? 'ok' : a.lv}"></span><div class="m"><div class="t">${esc(a.t)}</div><div class="s">${esc(a.s)}</div></div>${a.p ? M.procTag(a.p) : ''}${a.fix ? `<button class="btn sm" data-lfix='${esc(JSON.stringify(a.fix))}'>적용</button>` : ''}</div>`).join('')}</div></div>
      <div class="card"><h2>${M.procTag(sel.proc)} ${esc(sel.name)} <span class="h2sub">앞뒤 공정</span>${sel.go ? `<a class="more" href="#" data-go="${sel.go}">공정 화면 →</a>` : ''}</h2>
        ${(() => { const i = STEPS.indexOf(sel), up = STEPS[i - 1], dn = STEPS[i + 1], al = M.alerts();
          const row = (lbl, s) => s ? `<div class="adj"><span class="muted">${lbl}</span> ${M.procTag(s.proc)} <b>${esc(s.name)}</b> · 계획 ${f(m.plan[s.proc], 0)}/일 · 수율 ${pct(m.b[s.proc].yield, 1)}
            ${al.filter(a => a.proc === s.proc && a.level !== 'info').slice(0, 2).map(a => `<div class="adja ${a.level}">${esc(a.title)}</div>`).join('')}</div>` : '';
          const mine = al.filter(a => a.proc === sel.proc && a.level !== 'info');
          return `${row('앞 공정', up)}${row('뒤 공정', dn)}
            <div class="adj"><span class="muted">이 공정 알림</span>${mine.length ? mine.slice(0, 3).map(a => `<div class="adja ${a.level}">${esc(a.title)}</div>`).join('') : ' <span class="muted">없음</span>'}</div>
            ${sel.proc === 'insp' ? `<p class="note">검사 셀이 받을 수 있는 양 ${f(inspLimit, 0)}개/일 · 하루 ${f(m.plan.insp, 0)}개 계획 시 사이클 ${f(86400 / Math.max(1, m.plan.insp), 0)}초 필요 (현재 74초)</p>` : ''}`; })()}
      </div>
    </div>`;
  };

  // 다른 모듈(에이전트·공급망 동기화)이 쓰는 조정
  M.lineApi = {
    fit: (k = 'target', T) => { const m = model(); if (T != null) st.target = T; const tgt = k === 'cap' ? Math.min(st.target ?? m.target, m.capT.t) : (st.target ?? m.target);
      const before = Object.assign({}, st.speed); STEPS.forEach(s => { const r = m.b[s.proc].rate; if (r) st.speed[s.proc] = m.fac[s.proc] * tgt / r * 100; }); return { before, after: Object.assign({}, st.speed), target: tgt }; },
    setTarget: v => { st.target = v; }, reset: () => { st.speed = {}; st.target = null; }, model,
  };
  // ── 요약 띠 상세
  function kd(k) {
    const m = model(), nm = p => (STEPS.find(s => s.proc === p) || {}).name || p, main = ['press', 'weld', 'heat'];
    const row = p => ({ p, plan: m.plan[p], fac: m.fac[p], need: m.need[p], cap: m.b[p].cap, y: m.y(p), t: m.fac[p] ? m.plan[p] / m.fac[p] : null });
    if (k === 'target') return M.kdrawer('라인 운영 · 목표 기준', `목표 ${f(m.target, 0)}개/일 — 공정별 필요량`, [
      { html: M.table([['공정', r => `${M.procTag(r.p)} ${esc(nm(r.p))}`], ['1개당 처리', r => f(r.fac, 3), 'n'], ['목표 필요량', r => f(r.need, 0), 'n'], ['현재 계획', r => f(r.plan, 0), 'n'],
        ['차이', r => { const d = r.plan - r.need; return `<b style="color:${d < -1 ? 'var(--danger-ink)' : 'var(--ok)'}">${d > 0 ? '+' : ''}${f(d, 0)}</b>`; }, 'n']], STEPS.map(s => row(s.proc)), { wrap: false }) },
      { html: `<p class="note">1개당 처리 = 최종 양품 1개를 만들 때 그 공정이 처리해야 하는 양 (뒤 공정 필요량 ÷ 수율, 경로 비율 반영). 목표 칸에 숫자를 넣으면 이 표가 다시 계산됩니다.</p>` }]);
    if (k === 'lim') return M.kdrawer('라인 운영 · 지금 계획', `가능 산출 ${f(m.lim.t, 0)}개/일 — 제약 ${nm(m.lim.p)}`, [
      { html: M.table([['공정', r => `${M.procTag(r.p)} ${esc(nm(r.p))}${r.p === m.lim.p ? ' <span class="tag j-danger">제약</span>' : ''}`], ['계획 처리량', r => f(r.plan, 0), 'n'], ['1개당 처리', r => f(r.fac, 3), 'n'], ['이 공정 기준 가능 산출', r => `<b>${f(r.t, 0)}</b>`, 'n']], main.map(row), { wrap: false, hl: r => r.p === m.lim.p }) },
      { h: '공정 사이 재공 (하루)', html: M.table([['구간', g => esc(g.label)], ['공급', g => f(g.sup, 0), 'n'], ['소비', g => f(g.dem, 0), 'n'], ['증감', g => `<b style="color:${Math.abs(g.d) < 1 ? 'inherit' : g.d > 0 ? 'var(--warn-ink)' : 'var(--danger-ink)'}">${g.d > 0 ? '+' : ''}${f(g.d, 0)}</b>`, 'n']], Object.values(m.gaps), { wrap: false }) }]);
    if (k === 'cap') return M.kdrawer('라인 운영 · 설비 능력', `능력 한계 ${f(m.capT.t, 0)}개/일 — 병목 ${nm(m.capT.p)}`, [
      { html: M.table([['공정', r => `${M.procTag(r.p)} ${esc(nm(r.p))}${r.p === m.capT.p ? ' <span class="tag j-warn">병목</span>' : ''}`], ['관측 최대', r => f(r.cap, 0), 'n'], ['목표 필요량', r => f(r.need, 0), 'n'],
        ['능력 사용률', r => r.cap ? `<b style="color:${r.need > r.cap ? 'var(--danger-ink)' : 'inherit'}">${pct(r.need / r.cap, 0)}</b>` : '—', 'n'], ['이 공정 기준 한계', r => r.cap && r.fac ? f(r.cap / r.fac, 0) : '—', 'n']], main.map(row), { wrap: false, hl: r => r.p === m.capT.p }) },
      { html: '<p class="note">관측 최대 = 데이터에서 그 공정이 하루에 가장 많이 처리한 양. 이보다 많이 필요하면 가동 시간 연장이나 목표 조정이 필요합니다.</p>' }]);
    if (k === 'rty') return M.kdrawer('라인 운영 · 수율', `누적 수율 ${pct(m.rty, 2)}`, [
      { html: M.table([['공정', r => `${M.procTag(r.p)} ${esc(nm(r.p))}`], ['수율', r => pct(r.y, 3), 'n'], ['불량 비율', r => pct(1 - r.y, 3), 'n']], STEPS.map(s => row(s.proc)), { wrap: false }) },
      { html: `<p class="note">주 흐름 누적 수율 = 프레스 × 열처리 × (점용접 경로 비율만큼 점용접 수율). 검사 셀 양품은 하루 ${f(m.insp_good, 0)}개입니다.</p>` }]);
  }

  M.mod({
    id: 'line', proc: 'line', group: '현황', order: 1,
    menu: [['line', '라인 운영', 'trace', '현황']],
    views: { line: V.line }, drawers: { 'k:line:': kd },
    bind(root) {
      const rer = (focusSel) => { M.render(); if (focusSel) { const n = M.$(focusSel); if (n) n.focus(); } };
      root.querySelectorAll('[data-lsel]').forEach(n => n.onclick = e => { if (e.target.closest('input,button')) return; st.sel = n.dataset.lsel; M.render(); });
      root.querySelectorAll('[data-lsp]').forEach(r => { r.oninput = () => { r.nextElementSibling.textContent = r.value + '%'; }; r.onchange = () => { st.speed[r.dataset.lsp] = +r.value; rer(`[data-lsp="${r.dataset.lsp}"]`); }; });
      root.querySelectorAll('[data-lq]').forEach(i => i.onchange = () => { const b = base().b[i.dataset.lq]; if (b && b.rate) st.speed[i.dataset.lq] = Math.max(1, +i.value / b.rate * 100); M.render(); });
      root.querySelectorAll('[data-lw]').forEach(i => i.onchange = () => { st.wip[i.dataset.lw] = i.value === '' ? undefined : +i.value; M.render(); });
      root.querySelectorAll('[data-lcap]').forEach(i => i.onchange = () => { st.mach_cap = i.value === '' ? null : +i.value; M.render(); });
      root.querySelectorAll('[data-ltgt]').forEach(i => i.onchange = () => { st.target = Math.max(1, +i.value || 0); M.render(); });
      root.querySelectorAll('[data-lfix]').forEach(bn => bn.onclick = () => { Object.assign(st.speed, JSON.parse(bn.dataset.lfix)); M.render(); });
      root.querySelectorAll('[data-lauto]').forEach(bn => bn.onclick = () => {
        const k = bn.dataset.lauto; if (k === 'reset') { st.speed = {}; st.target = null; return M.render(); }
        const m = model(), T = k === 'cap' ? Math.min(m.target, m.capT.t) : m.target;
        STEPS.forEach(s => { const r = m.b[s.proc].rate; if (r) st.speed[s.proc] = m.fac[s.proc] * T / r * 100; });
        M.render();
      });
    },
  });
})();
