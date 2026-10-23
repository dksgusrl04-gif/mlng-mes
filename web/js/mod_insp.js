/* 정밀가공·검사 모듈 — 부품 번호별 가공 신호 + 합격 판정 (IN-01)
 * 화면: 검사 현황 · 부품 이력 · 가공 신호   /  상세: 부품 서랍
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f, pct } = M;
  const I = () => M.S.insp || { records: [], lots: [], signals: [], compare: [], checks: {} };
  const RD = () => M.CFG.RECENT_DAYS || 7;
  const recentRecs = () => { const t = M.sinceDay(RD()).getTime(); return I().records.filter(r => M.toDate(r.t).getTime() >= t); };
  // 부품 단위로 묶기: 불합격 기록이 하나라도 있으면 불합격, 같은 번호·시각에 합격·불합격이 함께 있으면 «확정 필요»
  function parts(recs) {
    const m = new Map();
    recs.forEach(r => { const p = m.get(r.sn) || { sn: r.sn, t: r.t, lot: r.lot, recs: [], ok: true, conflict: false }; p.recs.push(r); p.ok = p.ok && r.ok; p.conflict = p.conflict || r.conflict; m.set(r.sn, p); });
    return [...m.values()];
  }
  const state = p => p.conflict ? ['warn', '확정 필요'] : p.ok ? ['ok', '합격'] : ['danger', '불합격'];
  const sTag = p => { const [c, t] = state(p); return `<span class="tag j-${c}">${t}</span>`; };
  const S_ = k => I().signals.find(s => s.key === k) || { label: k, d: 1, unit: '' };

  function alerts() {
    const out = [], c = I().checks || {}, at = (I().lots.slice(-1)[0] || {}).end || M.S.asof;
    if (c.conflict) out.push({ proc: 'insp', level: 'warn', title: `판정 확정 필요 — 같은 부품 번호에 합격·불합격이 함께 기록된 부품 ${c.conflict}개`,
      body: '같은 시각에 두 판정이 있습니다. 재검 결과인지 중복 입력인지 확인해 하나로 확정하세요 (확정 전 출하 보류)', by: '검사', at, go: 'insp_parts:conflict' });
    if ((c.stuck || []).length) out.push({ proc: 'insp', level: 'warn', title: `${c.stuck.join('·')}축 신호가 변하지 않음 — 모든 부품에서 ${f(c.const_value, 1)}`,
      body: `전류·부하 ${c.stuck_cols}개 항목이 고정값입니다. 센서 배선·수집 설정을 확인하세요 (이 축은 판정 근거로 쓸 수 없음)`, by: '데이터 점검', at, go: 'insp_signal' });
    // 시간대별 불합격률이 관리 상한을 넘으면 (p 관리도)
    const hrs = hourly(recentRecs()), pbar = hrs.reduce((s, h) => s + h.f, 0) / Math.max(1, hrs.reduce((s, h) => s + h.n, 0));
    hrs.filter(h => h.n >= 10 && h.f / h.n > pbar + 3 * Math.sqrt(pbar * (1 - pbar) / h.n)).forEach(h => out.push({ proc: 'insp', level: 'warn',
      title: `${h.h.slice(5)}시 불합격률 ${pct(h.f / h.n, 0)} — 관리 상한 초과`, body: `${h.f}/${h.n}개 · 평균 ${pct(pbar, 1)}`, by: '검사', at: h.h + ':59', go: 'insp_home' }));
    return out;
  }
  function hourly(recs) {
    const m = {}; recs.forEach(r => { const h = r.t.slice(0, 13); const x = m[h] = m[h] || { h, n: 0, f: 0 }; x.n++; if (!r.ok) x.f++; });
    return Object.values(m).sort((a, b) => a.h.localeCompare(b.h));
  }
  function summary() {
    const ps = parts(recentRecs()), bad = ps.filter(p => !p.ok || p.conflict).length;
    return { kpi: ps.length ? `불합격 ${pct(bad / ps.length, 1)}` : '—', sub: `최근 ${RD()}일 · 부품 ${f(ps.length, 0)}개 · 확정 필요 ${ps.filter(p => p.conflict).length}`,
      st: ps.some(p => p.conflict) ? 'warn' : 'ok', go: 'insp_home' };
  }

  const V = {};
  V.insp_home = () => {
    const recs = recentRecs(), ps = parts(recs), nBad = ps.filter(p => !p.ok).length, nCon = ps.filter(p => p.conflict).length;
    const hrs = hourly(recs), N = hrs.reduce((s, h) => s + h.n, 0), pbar = hrs.reduce((s, h) => s + h.f, 0) / Math.max(1, N);
    const rate = hrs.map(h => h.f / h.n * 100), ucl = hrs.map(h => Math.min(100, (pbar + 3 * Math.sqrt(pbar * (1 - pbar) / h.n)) * 100));
    const xl = [0, Math.floor(hrs.length / 2), hrs.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => [i, hrs[i].h.slice(5).replace(' ', ' ') + '시']);
    const cyc = M.median(I().lots.map(l => l.cycle_s));
    return `
    <div class="kstrip">
      <div class="kpi"><div class="lab">검사 부품 · 최근 ${RD()}일</div><div class="val">${f(ps.length, 0)}<small>개</small></div><div class="foot">검사 기록 ${f(recs.length, 0)}건</div></div>
      <div class="kpi click" data-go="insp_parts:ng"><div class="lab">불합격 기록이 있는 부품</div><div class="val" style="color:${nBad ? 'var(--danger-ink)' : 'inherit'}">${nBad}<small>개</small></div><div class="foot">부품 기준 ${pct(ps.length ? nBad / ps.length : null, 1)} · 그중 확정 필요 ${ps.filter(p => !p.ok && p.conflict).length}</div></div>
      <div class="kpi click" data-go="insp_parts:conflict"><div class="lab">판정 확정 필요</div><div class="val" style="color:${nCon ? 'var(--warn-ink)' : 'inherit'}">${nCon}<small>개</small></div><div class="foot">합격·불합격이 함께 기록된 부품</div></div>
      <div class="kpi"><div class="lab">사이클 타임</div><div class="val">${f(cyc, 0)}<small>초</small></div><div class="foot">부품 한 개 검사 간격 (중앙값)</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>시간대별 불합격률 <span class="h2sub">p 관리도 · 평균 ${pct(pbar, 1)} · 관리 상한은 검사 수에 따라 달라짐</span></h2>
      ${hrs.length ? M.lineChart([{ v: rate, cls: 's1' }, { v: ucl, cls: 's4' }], null, { h: 250, w: 1000, d: 0, xlab: xl, refs: [{ y: pbar * 100, label: '평균' }],
        dots: rate.map((y, i) => ({ i, y, r: 3, cls: y > ucl[i] ? 'bad' : '', t: `${hrs[i].h}시 · ${hrs[i].f}/${hrs[i].n}개` })) }) : '<div class="empty">기록 없음</div>'}
      ${M.legend([['l-s1', '불합격률 (%)'], ['l-s4', '관리 상한'], ['l-lim', '평균']])}</div>
    <div class="card" style="margin-top:16px"><h2>검사 LOT <span class="h2sub">하루 검사분 = LOT 1개</span></h2>
      ${M.table([['LOT', r => `<b>${esc(r.id)}</b>`], ['검사 시간', r => `${esc(r.start.slice(5))} ~ ${esc(r.end.slice(5))}`], ['부품', r => f(r.parts, 0), 'n'], ['불합격', r => f(r.fail, 0), 'n'],
        ['불합격률', r => pct(r.fail / r.parts, 1), 'n'], ['확정 필요', r => r.conflict ? `<b style="color:var(--warn-ink)">${r.conflict}</b>` : '0', 'n'], ['사이클', r => f(r.cycle_s, 0) + '초', 'n'],
        ['앞 공정 (열처리)', r => r.parents.map(p => `<a href="#" data-row="heat:${esc(p)}">${esc(p)}</a>`).join(' · ') || '—'],
        ['이력', r => `<a href="#" data-trace="${esc(r.id)}">보기</a>`]], I().lots.slice().reverse(), { wrap: false })}
      <p class="note">앞 공정과의 사이에 MCT 가공(별도 시스템)이 있습니다. 가공 사양 부품만 이 셀을 거칩니다.</p></div>`;
  };

  let pf = 'all', pq = '';
  V.insp_parts = () => {
    let ps = parts(I().records).sort((a, b) => b.t.localeCompare(a.t));
    if (pf === 'ng') ps = ps.filter(p => !p.ok && !p.conflict); else if (pf === 'conflict') ps = ps.filter(p => p.conflict); else if (pf === 'bad') ps = ps.filter(p => !p.ok || p.conflict);
    if (pq) ps = ps.filter(p => p.sn.toLowerCase().includes(pq.toLowerCase()));
    const sg = ['spd_max', 'sload_max', 'x_cur', 'z1_cur'];
    return `<div class="card"><div class="tools">${M.seg('ipf', pf, [['all', '전체'], ['bad', '불합격·확정 필요'], ['conflict', '확정 필요'], ['ng', '불합격만']])}
      <input class="in" id="ipq" placeholder="부품 번호" value="${esc(pq)}" style="width:200px"><span class="tsum">${f(ps.length, 0)}개</span></div>
      ${M.table([['부품 번호', p => `<b>${esc(p.sn)}</b>`], ['검사 시각', p => esc(p.t.slice(5, 16))], ['LOT', 'lot'], ['판정', sTag], ['기록', p => p.recs.length, 'n']]
        .concat(sg.map(k => [esc(S_(k).label), p => f(p.recs[0].s[k], S_(k).d), 'n'])), ps.slice(0, 300), { click: p => 'insp:' + p.sn, hl: p => !p.ok && !p.conflict })}
      <p class="note">최근 순 300개까지. 신호 값은 첫 기록 기준 — 행을 누르면 기록별로 비교합니다.</p></div>`;
  };

  // 합격 부품 분포(5~95%) 위에 이 부품 값을 찍는 막대
  const band = (k, v) => {
    const c = I().compare.find(x => x.key === k); if (!c) return '';
    const lo = Math.min(c.pass_q[0], c.fail_q[0], v), hi = Math.max(c.pass_q[4], c.fail_q[4], v), sc = x => ((x - lo) / ((hi - lo) || 1) * 100);
    const inB = v >= c.pass_q[0] && v <= c.pass_q[4];
    return `<div class="gauge"><div class="band" style="left:${sc(c.pass_q[0])}%;width:${Math.max(1, sc(c.pass_q[4]) - sc(c.pass_q[0]))}%"></div><div class="pin" style="left:calc(${sc(v)}% - 1px);background:${inB ? 'var(--ink-2)' : 'var(--warn)'}"></div></div>`;
  };
  V.insp_signal = () => {
    const C = I().compare, ck = I().checks || {}, mx = Math.max(...C.map(c => Math.abs(c.effect)), 0.01);
    const boxRow = (q, cls, lo, hi) => { const sc = x => ((x - lo) / ((hi - lo) || 1) * 100);
      return `<div class="bx"><i class="wh" style="left:${sc(q[0])}%;width:${sc(q[4]) - sc(q[0])}%"></i><i class="bo ${cls}" style="left:${sc(q[1])}%;width:${Math.max(.8, sc(q[3]) - sc(q[1]))}%"></i><i class="md" style="left:${sc(q[2])}%"></i></div>`; };
    const top = C.slice().sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 4);
    return `<div class="card"><h2>불합격 기록에서 달랐던 가공 신호 <span class="h2sub">합격 대비 차이 (표준편차 단위)</span></h2>
      ${M.table([['신호', c => `<b>${esc(c.label)}</b>`], ['합격 중앙값', c => f(c.pass_med, c.d), 'n'], ['불합격 중앙값', c => f(c.fail_med, c.d), 'n'],
        ['차이', c => `<span class="eff"><i class="${c.effect < 0 ? 'neg' : 'pos'}" style="width:${Math.abs(c.effect) / mx * 100}%"></i></span> <b>${c.effect > 0 ? '+' : ''}${f(c.effect, 2)}</b>`],
        ['같은 번호 짝 차이', c => `${c.pair_diff > 0 ? '+' : ''}${f(c.pair_diff, c.d)}`, 'n']], C, { wrap: false })}
      <p class="note">«같은 번호 짝 차이» = 합격·불합격이 함께 기록된 ${ck.conflict || 0}개 부품에서 불합격 기록 − 합격 기록의 중앙값. 판정이 확정되기 전이라 원인 단정이 아니라 점검 순서 참고용입니다.
        ${(ck.stuck || []).length ? `${ck.stuck.join('·')}축은 값이 고정되어 비교에서 뺐습니다.` : ''}</p></div>
    <div class="card" style="margin-top:16px"><h2>분포 비교 <span class="h2sub">차이가 큰 4개 · 상자 = 25~75%, 선 = 5~95%, 세로선 = 중앙값</span></h2>
      <div class="boxes">${top.map(c => { const lo = Math.min(c.pass_q[0], c.fail_q[0]), hi = Math.max(c.pass_q[4], c.fail_q[4]);
        return `<div class="bxg"><div class="bl">${esc(c.label)} <span class="muted">${f(lo, c.d)} ~ ${f(hi, c.d)} ${esc(c.unit)}</span></div>
          <div class="bxr"><span>합격</span>${boxRow(c.pass_q, 'ok', lo, hi)}</div><div class="bxr"><span>불합격</span>${boxRow(c.fail_q, 'ng', lo, hi)}</div></div>`; }).join('')}</div></div>`;
  };

  function partDrawer(sn) {
    if (sn.startsWith('IN-')) return M.go('insp_home');
    const p = parts(I().records.filter(r => r.sn === sn))[0]; if (!p) return;
    const lot = I().lots.find(l => l.id === p.lot) || { parents: [] };
    M.drawer(`정밀가공 검사 · IN-01 · ${p.t.slice(0, 10)}`, `부품 ${p.sn}`, `
      <div class="blk"><h4>판정</h4><dl class="stat"><dt>판정</dt><dd>${sTag(p)}</dd><dt>검사 시각</dt><dd>${esc(p.t)}</dd><dt>기록</dt><dd>${p.recs.map(r => r.ok ? '합격' : '불합격').join(' · ')}</dd></dl>
        ${p.conflict ? '<p class="note" style="color:var(--warn-ink)">같은 시각에 합격·불합격이 함께 있습니다. 재검 결과로 하나를 확정하세요.</p>' : ''}</div>
      <div class="blk"><h4>이력</h4><dl class="stat"><dt>검사 LOT</dt><dd><a href="#" data-trace="${esc(p.lot)}">${esc(p.lot)}</a></dd>
        <dt>앞 공정 (열처리)</dt><dd>${lot.parents.map(x => `<a href="#" data-row="heat:${esc(x)}">${esc(x)}</a>`).join(' · ') || '—'}</dd></dl></div>
      <div class="blk"><h4>가공 신호 — 초록 띠 = 합격 부품 5~95%</h4>
        ${I().signals.map(s => `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(s.label)}</span>
          <span>${p.recs.map(r => `<b style="color:${r.ok ? 'inherit' : 'var(--danger-ink)'}">${f(r.s[s.key], s.d)}</b>`).join(' / ')}</span></div>
          ${band(s.key, p.recs[p.recs.length - 1].s[s.key])}</div>`).join('')}
        ${p.recs.length > 1 ? '<p class="note">값이 두 개면 «합격 / 불합격» 기록 순서입니다. 막대의 점은 불합격 기록 값.</p>' : ''}</div>
      <div class="blk"><button class="btn pri" data-insp="insp|${esc(p.lot)}">검사 결과 기록</button></div>`);
  }

  M.mod({
    id: 'insp', proc: 'insp', group: '정밀가공 검사', order: 50,
    menu: [['insp_home', '검사 현황', 'check'], ['insp_parts', '부품 이력', 'list'], ['insp_signal', '가공 신호', 'wave']],
    views: V, alerts, summary,
    drawers: { 'insp:': partDrawer, 'insp_parts:': k => { pf = k === 'ng' ? 'ng' : k === 'conflict' ? 'conflict' : 'all'; M.go('insp_parts'); } },
    bind(root) {
      root.querySelectorAll('[data-ipf]').forEach(b => b.onclick = () => { pf = b.dataset.ipf; M.render(); });
      const q = root.querySelector('#ipq');
      if (q) q.oninput = () => { pq = q.value.trim(); const pos = q.selectionStart; M.render(); const n = M.$('#ipq'); n.focus(); n.setSelectionRange(pos, pos); };
    },
  });
})();
