/* 프레스 모듈 — 순차 이송 금형 타발 (PR-01)
 * 화면: 프레스 현황 · 타발 실적 · 공정 조건 · 설비 진단   /  상세: 작업일(LOT) 서랍
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f, pct } = M;
  const PC = () => Object.assign({ TARGET_PPM: 150, TREND_DAYS: 3, TREND_RATIO: 2, OUT_RATE: 0.01, CPK_OK: 1.33, CPK_MIN: 1.0 }, (M.CFG.PRESS || {}));
  const P = () => M.S.press || { lots: [], recipe: [], series: {}, vib: { events: [], base: {}, normal: {}, event: {} }, recipe_hist: [] };
  const RD = () => M.CFG.RECENT_DAYS || 7;
  const R = k => P().recipe.find(r => r.key === k) || { label: k, d: 1, unit: '' };
  const codeName = c => (M.S.masters.defect_codes.find(x => x.code === c) || {}).name || c;
  const recent = (days = RD()) => P().lots.filter(l => M.toDate(l.date).getTime() >= M.sinceDay(days).getTime());
  const sumPpm = ls => { const q = ls.reduce((s, l) => s + l.qty, 0); return q ? ls.reduce((s, l) => s + l.bad, 0) / q * 1e6 : null; };
  const ppmTxt = v => v == null ? '—' : f(v, 0);
  const outN = l => Object.values(l.stats).reduce((s, x) => Math.max(s, x.out || 0), 0);
  const judge = l => l.ppm >= 2 * PC().TARGET_PPM ? ['danger', '기준 2배 초과'] : l.ppm >= PC().TARGET_PPM ? ['warn', '기준 초과'] : ['ok', '기준 안'];
  const jTag = l => { const [c, t] = judge(l); return `<span class="tag j-${c}">${t}</span>`; };
  const cpkTag = v => v == null ? '—' : `<b style="color:${v >= PC().CPK_OK ? 'var(--ok)' : v >= PC().CPK_MIN ? 'var(--warn-ink)' : 'var(--danger-ink)'}">${f(v, 2)}</b>`;
  const topDefect = l => { const e = Object.entries(l.defects || {}).sort((a, b) => b[1] - a[1])[0]; return e ? `${codeName(e[0])} ${e[1]}` : '—'; };
  // 최근 N작업일 공정능력: 일별 평균·표준편차를 타발 수로 합쳐 다시 계산
  function cpk(ls, k) {
    const n = ls.reduce((s, l) => s + l.strokes, 0); if (!n) return null;
    // 설정값이 바뀐 기간이 섞여도 되도록 «설정값과의 차이» 로 합친다
    const dev = l => l.stats[k].mean - l.stats[k].sp;
    const mu = ls.reduce((s, l) => s + dev(l) * l.strokes, 0) / n;
    const v = ls.reduce((s, l) => s + (l.stats[k].std ** 2 + (dev(l) - mu) ** 2) * l.strokes, 0) / n, sd = Math.sqrt(v), tol = R(k).tol;
    return sd ? Math.min(tol - mu, mu + tol) / (3 * sd) : null;
  }

  // ── 현장 알람
  function alerts() {
    const out = [], L = P().lots, t = PC().TARGET_PPM, rl = recent();
    const over = rl.filter(l => l.ppm >= t);
    if (over.length) out.push({ key: 'press.ppm_over', data: { lots: over.map(l => l.id) }, proc: 'press', level: over.some(l => l.ppm >= 2 * t) ? 'danger' : 'warn', title: `최근 ${RD()}일 프레스 불량률 기준(${f(t, 0)} PPM) 초과 ${over.length}일`,
      body: over.map(l => `${l.id} ${ppmTxt(l.ppm)} PPM (${topDefect(l)})`).join(' · '), by: '프레스', at: over[over.length - 1].date, go: over.length === 1 ? 'press:' + over[0].id : 'press_lots' });
    const n = PC().TREND_DAYS;
    if (L.length > n + 3) {
      const a = L.slice(-n), b = L.slice(0, -n), ra = sumPpm(a), rb = sumPpm(b);
      if (rb && ra / rb >= PC().TREND_RATIO) {
        const dc = {}; a.forEach(l => Object.entries(l.defects).forEach(([c, k]) => dc[c] = (dc[c] || 0) + k));
        out.push({ key: 'press.ppm_trend', data: { lots: a.map(l => l.id), ratio: ra / rb }, proc: 'press', level: 'warn', title: `프레스 불량 증가 — 최근 ${n}작업일 ${f(ra / rb, 1)}배`, body: `${ppmTxt(rb)} → ${ppmTxt(ra)} PPM · ${Object.entries(dc).sort((x, y) => y[1] - x[1]).map(([c, k]) => `${codeName(c)} ${k}`).join(' · ')} — 금형 마모·윤활 점검`,
          by: '프레스', at: a[a.length - 1].date, go: 'press_home' });
      }
    }
    rl.filter(l => outN(l) / l.strokes >= PC().OUT_RATE).forEach(l => out.push({ key: 'press.out_range', data: { lots: [l.id] }, proc: 'press', level: 'warn', title: `${l.id} 허용 범위 밖 타발 ${f(outN(l), 0)}회`,
      body: l.changeover ? '설정 변경일 — 변경 전 타발이 새 기준 밖으로 잡혔습니다' : '타발 시간·압력 확인', by: '프레스', at: l.date, go: 'press:' + l.id }));
    const since = M.sinceDay(RD()).getTime();
    P().vib.events.filter(e => M.toDate(e.end).getTime() >= since).forEach(e => out.push({ key: 'press.vib', data: { equip: e.equip, ratio: e.ratio, start: e.start, end: e.end }, proc: 'press', level: 'danger', title: `${e.equip} 진동 이상 — 정상 기준의 ${f(e.ratio, 1)}배`,
      body: `${e.start.slice(5, 16)} ~ ${e.end.slice(11, 16)} · ${e.secs}초 동안 기준(상위 1%) 초과 · 최대 전류 ${f(e.c_max, 0)} — 금형·크랭크·클러치 점검`, by: '프레스 설비', at: e.end, go: 'press_equip' }));
    return out;
  }
  function summary() {
    const rl = recent(), p = sumPpm(rl);
    return { kpi: `${ppmTxt(p)} PPM`, sub: `최근 ${RD()}일 · ${rl.length}작업일 · ${f(rl.reduce((s, l) => s + l.qty, 0), 0)}개`,
      st: p == null ? 'ok' : p >= 2 * PC().TARGET_PPM ? 'danger' : p >= PC().TARGET_PPM ? 'warn' : 'ok', go: 'press_home' };
  }

  function lotTable(rows, compact) {
    const done = new Set(M.inspections().map(i => i.lot_id));
    const head = [['작업', r => `<b>${esc(r.id)}</b>`], ['작업일', 'date'], ['타발', r => f(r.strokes, 0), 'n'], ['불량', r => f(r.bad, 0), 'n'],
      ['불량률', r => ppmTxt(r.ppm), 'n'], ['주요 불량', r => esc(topDefect(r))], ['범위 밖 타발', r => outN(r) ? `<b style="color:var(--warn-ink)">${f(outN(r), 0)}</b>` : '0', 'n'],
      ['다음 공정', r => `<a href="#" data-trace="${esc(r.id)}">열처리 ${esc(r.feeds.slice(5))}</a>`], ['판정', jTag]];
    if (!compact) head.push(['검사', r => done.has(r.id) ? '<span class="tag t-안정">기록됨</span>' : `<button class="btn sm" data-insp="press|${esc(r.id)}">기록</button>`]);
    return M.table(compact ? head.filter(h => !['다음 공정', '범위 밖 타발'].includes(h[0])) : head, rows, { click: r => 'press:' + r.id, hl: r => r.ppm >= 2 * PC().TARGET_PPM });
  }

  const V = {};
  V.press_home = () => {
    const L = P().lots, rl = recent(), p = sumPpm(rl), t = PC().TARGET_PPM, ev = P().vib.events.filter(e => M.toDate(e.end).getTime() >= M.sinceDay(RD()).getTime());
    const days = L.map(l => ({ x: l.date.slice(5), v: l.ppm, cls: l.ppm >= t ? 'over' : '', t: `${l.id} · 타발 ${f(l.strokes, 0)} · 불량 ${l.bad} · ${ppmTxt(l.ppm)} PPM` }));
    const dc = {}; recent(30).forEach(l => Object.entries(l.defects).forEach(([c, k]) => dc[c] = (dc[c] || 0) + k));
    const dcs = Object.entries(dc).sort((a, b) => b[1] - a[1]), dmax = Math.max(1, ...dcs.map(x => x[1])), dsum = dcs.reduce((s, x) => s + x[1], 0);
    return `
    <div class="kstrip">
      <div class="kpi click" data-row="k:pr:days"><div class="lab">타발 · 최근 ${RD()}일</div><div class="val">${f(rl.reduce((s, l) => s + l.strokes, 0), 0)}<small>회</small></div><div class="foot">${rl.length}작업일 · 하루 평균 ${f(rl.length ? rl.reduce((s, l) => s + l.strokes, 0) / rl.length : 0, 0)}회</div></div>
      <div class="kpi click" data-row="k:pr:days"><div class="lab">생산 · 최근 ${RD()}일</div><div class="val">${f(rl.reduce((s, l) => s + l.qty, 0), 0)}<small>개</small></div><div class="foot">취수 ${P().cav} (타발 1회당 부품 수)</div></div>
      <div class="kpi click" data-go="press_lots"><div class="lab">불량률 · 최근 ${RD()}일</div><div class="val" style="color:${p >= t ? 'var(--warn-ink)' : 'inherit'}">${ppmTxt(p)}<small>PPM</small></div><div class="foot">불량 ${rl.reduce((s, l) => s + l.bad, 0)}개 · 기준 ${f(t, 0)} PPM</div></div>
      <div class="kpi click" data-go="press_equip"><div class="lab">설비 진단 · 최근 ${RD()}일</div><div class="val" style="color:${ev.length ? 'var(--danger-ink)' : 'var(--ok)'}">${ev.length ? `이상 ${ev.length}` : '정상'}</div><div class="foot">${ev.length ? `${esc(ev[0].start.slice(5, 16))} 진동 ${f(ev[0].ratio, 1)}배` : '진동·전류 기준 안'}</div></div>
    </div>
    <div class="grid g21" style="margin-top:16px">
      <div class="card"><h2>작업일별 불량률 <span class="h2sub">막대에 마우스를 올리면 타발 수</span></h2>${M.barChart(days, { ref: t, refLabel: `기준 ${f(t, 0)}` })}
        ${M.legend([['l-barok', '기준 안'], ['l-barover', '기준 초과'], ['l-lim', '관리 기준']])}</div>
      <div class="card"><h2>불량 유형 <span class="h2sub">최근 30일 · ${dsum}개</span></h2>
        ${dcs.length ? `<div class="hbars">${dcs.map(([c, n]) => `<div class="hb"><span>${esc(codeName(c))}</span><div><i style="width:${n / dmax * 100}%"></i></div><b>${n}</b><em>${pct(n / dsum, 0)}</em></div>`).join('')}</div>` : '<div class="empty">불량 없음</div>'}
        <p class="note">주름 = 블랭크 홀딩 부족, 터짐 = 과성형·윤활 부족, 버 = 펀치·다이 마모 쪽을 먼저 봅니다.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>공정 능력 <span class="h2sub">최근 ${RD()}일 · Cpk (1.33 이상 양호)</span> <a class="more" href="#" data-go="press_recipe">공정 조건 →</a></h2>
      <div class="mstrip eq">${P().recipe.map(r => `<div><span>${esc(r.label)}</span><b>${cpkTag(cpk(rl, r.key))}</b><em>${esc(r.unit || '')}</em></div>`).join('')}<div><span>범위 밖 타발</span><b>${f(rl.reduce((s, l) => s + outN(l), 0), 0)}</b><em>회</em></div></div></div>
    <div class="card" style="margin-top:16px"><h2>최근 작업일 <a class="more" href="#" data-go="press_lots">타발 실적 →</a></h2>${lotTable(L.slice(-5).reverse(), true)}</div>`;
  };

  V.press_lots = () => {
    const rows = P().lots.slice().reverse(), p = sumPpm(rows);
    return `<div class="card"><div class="tools"><span class="tsum" style="margin-left:0">${rows.length}작업일 · 타발 ${f(rows.reduce((s, l) => s + l.strokes, 0), 0)}회 · 생산 ${f(rows.reduce((s, l) => s + l.qty, 0), 0)}개 · 불량률 <b>${ppmTxt(p)}</b> PPM</span></div>
      ${lotTable(rows)}<p class="note">행을 누르면 작업일 상세(20타발 평균 추이·공정 능력)가 열립니다. «다음 공정» 은 이 LOT 이 투입된 열처리 작업입니다.</p></div>`;
  };

  V.press_recipe = () => {
    const L = P().lots, rl = recent(), hist = P().recipe_hist;
    const daily = L.map(l => l.stats.p2.mean), spl = L.map(l => l.stats.p2.sp), xl = [0, Math.floor(L.length / 2), L.length - 1].map(i => [i, L[i].date.slice(5)]);
    return `<div class="card"><h2>공정 조건 <span class="h2sub">CH-001 시트 트랙 스토퍼 브래킷 · PR-01</span></h2>
      ${M.table([['항목', r => `<b>${esc(r.label)}</b>`], ['설정', r => f(r.sp, r.d) + ` <span class="muted">${esc(r.unit || '')}</span>`], ['허용', r => '± ' + f(r.tol, r.d)],
        ['최근 평균', r => f(rl.reduce((s, l) => s + l.stats[r.key].mean * l.strokes, 0) / Math.max(1, rl.reduce((s, l) => s + l.strokes, 0)), 2), 'n'],
        ['Cpk 최근', r => cpkTag(cpk(rl, r.key)), 'n'], ['Cpk 전체', r => cpkTag(cpk(L.filter(l => !l.changeover && l !== L[0]), r.key)), 'n'],
        ['범위 밖 타발', r => f(L.reduce((s, l) => s + l.stats[r.key].out, 0), 0), 'n']], P().recipe, { wrap: false })}
      <p class="note">허용 폭은 데모 설정입니다 — 고객사 도면·작업표준의 공차로 바꿉니다. 압력 단위는 원 데이터에 없어 표기하지 않았습니다. Cpk 전체는 첫 작업일과 설정 변경일을 뺀 값입니다.</p></div>
    <div class="grid g21" style="margin-top:16px">
      <div class="card"><h2>압력 2 일별 평균 <span class="h2sub">계단 = 설정값</span></h2>
        ${M.lineChart([{ v: daily, cls: 's1' }, { v: spl, cls: 's4' }], null, { h: 210, d: 1, xlab: xl, dots: daily.map((y, i) => ({ i, y, r: 3, cls: L[i].changeover ? 'bad' : '', t: `${L[i].id} ${f(y, 2)}` })) })}
        ${M.legend([['l-s1', '일 평균'], ['l-s4', '설정값'], ['l-bad', '설정 변경일']])}</div>
      <div class="card"><h2>설정 변경 이력</h2>${M.table([['적용일', 'from'], ['항목', r => esc(R(r.key).label)], ['설정', r => f(r.sp, 0), 'n'], ['비고', r => esc(r.note || '최초')]], hist, { wrap: false })}
        <p class="note">데이터에서 일 평균이 계단처럼 바뀐 날을 찾아 변경으로 기록했습니다. 실제 운영에서는 설정을 바꿀 때 관리자가 이력을 남깁니다.</p></div>
    </div>`;
  };

  V.press_equip = () => {
    const vb = P().vib, b = vb.base, ev = vb.events[0];
    const nx = vb.normal.v0.length, nxl = [0, Math.floor(nx / 2), nx - 1].map(i => [i, new Date(M.toDate(vb.normal.t0).getTime() + i * vb.normal.step * 1000).toTimeString().slice(0, 5)]);
    const ex = vb.event.v0.length, exl = [0, Math.floor(ex / 2), ex - 1].map(i => [i, vb.event.t[i].slice(0, 5)]);
    return `<div class="kstrip">
      <div class="kpi click" data-row="k:pr:vib"><div class="lab">진동 1 정상 기준 (상위 1%)</div><div class="val">${f(b.v0.p99, 3)}</div><div class="foot">중앙값 ${f(b.v0.p50, 3)} · 1초 RMS</div></div>
      <div class="kpi click" data-row="k:pr:vib"><div class="lab">진동 2 정상 기준 (상위 1%)</div><div class="val">${f(b.v1.p99, 3)}</div><div class="foot">중앙값 ${f(b.v1.p50, 3)}</div></div>
      <div class="kpi click" data-row="k:pr:vib"><div class="lab">전류 정상 기준 (상위 1%)</div><div class="val">${f(b.c.p99, 0)}</div><div class="foot">중앙값 ${f(b.c.p50, 0)}</div></div>
      <div class="kpi click" data-row="k:pr:vib"><div class="lab">이상 구간</div><div class="val" style="color:${ev ? 'var(--danger-ink)' : 'var(--ok)'}">${vb.events.length}<small>건</small></div><div class="foot">${ev ? `최대 진동 기준의 ${f(ev.ratio, 1)}배` : '없음'}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>정상 운전 기준 <span class="h2sub">PR-01 · ${esc(vb.normal.t0.slice(0, 16))} · 10초 평균 RMS</span></h2>
        ${M.lineChart([{ v: vb.normal.v0, cls: 's1' }, { v: vb.normal.v1, cls: 's2' }], null, { h: 210, d: 2, xlab: nxl, refs: [{ y: b.v0.p99, label: '진동 1 기준' }] })}
        ${M.legend([['l-s1', '진동 1'], ['l-s2', '진동 2'], ['l-lim', '기준 (상위 1%)']])}</div>
      <div class="card"><h2>이상 구간 <span class="h2sub">${ev ? esc(ev.start.slice(0, 16)) : ''} · 1초 RMS</span></h2>
        ${ex ? M.lineChart([{ v: vb.event.v0, cls: 's1' }, { v: vb.event.v1, cls: 's2' }], null, { h: 210, d: 2, xlab: exl, refs: [{ y: b.v0.p99, label: '진동 1 기준' }] }) : '<div class="empty">없음</div>'}
        ${M.legend([['l-s1', '진동 1'], ['l-s2', '진동 2'], ['l-lim', '기준 (상위 1%)']])}</div>
    </div>
    <div class="card" style="margin-top:16px"><h2>진단 기록</h2>${M.table([['설비', 'equip'], ['시작', 'start'], ['종료', r => esc(r.end.slice(11))], ['기준 초과', r => r.secs + '초', 'n'],
      ['최대 진동 1', r => f(r.v0_max, 3), 'n'], ['최대 진동 2', r => f(r.v1_max, 3), 'n'], ['최대 전류', r => f(r.c_max, 0), 'n'], ['배수', r => `<b style="color:var(--danger-ink)">${f(r.ratio, 1)}×</b>`, 'n']], vb.events, { wrap: false })}
      <p class="note">정상 기준 = 정상 운전 기록의 1초 RMS 상위 1%. 기준을 넘는 구간이 이어지면 이상으로 기록합니다. 진동 급증과 전류 피크가 함께 나오면 금형 간섭·크랭크 베어링·클러치를 먼저 확인합니다.</p></div>`;
  };

  function lotDrawer(id) {
    const l = P().lots.find(x => x.id === id); if (!l) return;
    const s = P().series[id] || {}, ins = M.inspections().filter(i => i.lot_id === id);
    const heats = (M.lineage(id).down || []).filter(x => x.proc === 'heat');
    const n = Math.max(0, ...Object.values(s).map(a => a.length)), xl = n ? [[0, '1'], [n - 1, f(l.strokes, 0)]] : [];
    const ch = k => { const r = R(k), st = l.stats[k]; return `<div class="pch"><div class="pt2">${esc(r.label)} <span class="muted">설정 ${f(st.sp, 1)} ± ${f(r.tol, 1)} · Cpk ${st.cpk == null ? '—' : f(st.cpk, 2)}</span></div>
      ${M.lineChart([{ v: s[k] || [], cls: 's1' }], { lo: st.sp - r.tol, hi: st.sp + r.tol }, { h: 130, w: 460, d: 1, xlab: xl })}</div>`; };
    const def = Object.entries(l.defects).sort((a, b) => b[1] - a[1]);
    M.drawer(`프레스 · PR-01 · ${l.date}`, `작업 ${l.id}`, `
      <div class="blk"><h4>판정</h4><dl class="stat"><dt>불량률</dt><dd>${ppmTxt(l.ppm)} PPM ${jTag(l)}</dd>
        <dt>타발 · 생산</dt><dd>${f(l.strokes, 0)}회 · ${f(l.qty, 0)}개</dd><dt>불량 내역</dt><dd>${def.length ? def.map(([c, k]) => `${esc(codeName(c))} ${k}`).join(' · ') : '없음'}</dd>
        <dt>범위 밖 타발</dt><dd>${f(outN(l), 0)}회${l.changeover ? ' (설정 변경일)' : ''}</dd></dl></div>
      <div class="blk"><h4>이력</h4><dl class="stat"><dt>소재 LOT</dt><dd>${M.lineage(id).up.filter(x => x.kind === 'material').map(m => `<a href="#" data-trace="${esc(m.id)}">${esc(m.id)}</a>`).join(' · ') || '—'}</dd>
        <dt>다음 공정 (열처리)</dt><dd>${heats.map(h => `<a href="#" data-row="heat:${esc(h.id)}">${esc(h.id)}</a>`).join(' · ') || '—'}</dd></dl></div>
      <div class="blk"><h4>타발 추이 (20타발 평균)</h4>${n ? P().recipe.map(r => ch(r.key)).join('') : '<div class="empty">기록 없음</div>'}</div>
      <div class="blk"><h4>검사</h4>${ins.length ? M.table([['시각', 'at'], ['결과', 'result'], ['코드', r => esc(r.defect_code ? codeName(r.defect_code) : '—')], ['수량', 'qty', 'n'], ['기록', 'by']], ins, { wrap: false }) : ''}
        <button class="btn pri" data-insp="press|${esc(l.id)}" style="margin-top:8px">검사 결과 기록</button></div>`);
  }

  // ── 요약 띠 상세
  function kd(k) {
    if (k === 'days') {
      const rl = recent().slice().sort((a, b) => b.date.localeCompare(a.date));
      return M.kdrawer(`프레스 · 최근 ${RD()}일`, `작업일 ${rl.length}일 — 타발 ${f(rl.reduce((s, l) => s + l.strokes, 0), 0)}회 · 생산 ${f(rl.reduce((s, l) => s + l.qty, 0), 0)}개`, [
        { html: M.table([['작업일', l => `<b>${esc(l.date)}</b>`], ['타발', l => f(l.strokes, 0), 'n'], ['생산', l => f(l.qty, 0), 'n'], ['불량', l => f(l.bad, 0), 'n'], ['PPM', l => ppmTxt(l.ppm), 'n'], ['판정', jTag]], rl, { click: l => 'press:' + l.id, wrap: false }) },
        { html: `<p class="note">생산 = 타발 × 취수 ${P().cav}. 행을 누르면 그날 작업 상세가 열립니다.</p>` }]);
    }
    if (k === 'vib') {
      const vb = P().vib, b = vb.base;
      return M.kdrawer('프레스 · 설비 진단', `정상 기준과 이상 구간 ${vb.events.length}건`, [
        { h: '정상 기준 (1초 RMS)', html: M.table([['신호', r => r[0]], ['중앙값', r => r[1], 'n'], ['정상 상위 1%', r => `<b>${r[2]}</b>`, 'n']],
          [['진동 1', f(b.v0.p50, 3), f(b.v0.p99, 3)], ['진동 2', f(b.v1.p50, 3), f(b.v1.p99, 3)], ['전류', f(b.c.p50, 0), f(b.c.p99, 0)]], { wrap: false }) },
        { h: '이상 구간', html: M.table([['시작', e => esc(e.start.slice(5, 19))], ['지속', e => `${e.secs}초`, 'n'], ['진동 1 최대', e => f(e.v0_max, 3), 'n'], ['진동 2 최대', e => f(e.v1_max, 3), 'n'], ['전류 최대', e => f(e.c_max, 0), 'n'],
          ['기준 대비', e => `<b style="color:var(--danger-ink)">${f(e.ratio, 1)}배</b>`, 'n']], vb.events, { wrap: false, empty: '이상 구간이 없습니다' }) },
        { html: '<p class="note">정상 운전 구간의 1초 RMS 분포에서 상위 1% 값을 기준으로 삼고, 이를 넘는 구간이 이어지면 이상 구간으로 기록합니다. 데이터가 쌓일수록 기준이 갱신됩니다.</p>' }]);
    }
  }

  M.mod({
    id: 'press', proc: 'press', group: '프레스', order: 10,
    menu: [['press_home', '프레스 현황', 'press'], ['press_lots', '타발 실적', 'list'], ['press_recipe', '공정 조건', 'range'], ['press_equip', '설비 진단', 'gauge']],
    views: V, alerts, summary, drawers: { 'press:': lotDrawer, 'k:pr:': kd },
  });
})();
