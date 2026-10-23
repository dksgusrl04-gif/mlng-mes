/* 열처리 모듈 — 염욕 소입 라인 (세정 → 소입로 4존 → 솔트조 → 컨베이어 → 건조로)
 * 화면: 열처리 현황 · 작업 실적 · 공정 조건 · 설비 상태   /  상세: 작업(LOT) 서랍
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f, pct } = M;
  const HC = () => Object.assign({ DEVIATION_RATE: 0.05, HEATER_DRIFT_PP: 5, HEATER_BASE_JOBS: 20 }, (M.CFG.HEAT || {}));
  const H = () => M.S.heat || { lots: [], recipe: [], heaters: [], profiles: {}, rel: [] };
  const target = () => HC().TARGET_PPM || H().target_ppm || 450;
  const RD = () => M.CFG.RECENT_DAYS || 7;
  const lim = r => r.sp != null ? [r.sp - r.tol, r.sp + r.tol] : r.lo != null ? [r.lo, r.hi] : null;
  const limTxt = r => r.sp != null ? `${f(r.sp, r.d)} ± ${f(r.tol, r.d)}` : r.lo != null ? `${f(r.lo, r.d)} ~ ${f(r.hi, r.d)}` : '감시만';
  const R = k => H().recipe.find(r => r.key === k) || { label: k, d: 1 };
  const ppmTxt = v => v == null ? '—' : f(v, 0);
  const sumPpm = ls => { const q = ls.reduce((t, l) => t + (l.qty || 0), 0); return q ? ls.reduce((t, l) => t + (l.bad || 0), 0) / q * 1e6 : null; };
  const recent = (days = RD()) => { const t = M.sinceDay(days).getTime(); return H().lots.filter(l => M.toDate(l.end).getTime() >= t); };
  const devs = l => H().recipe.filter(r => lim(r) && (l.stats[r.key] || {}).out >= HC().DEVIATION_RATE).map(r => ({ key: r.key, label: r.label, out: l.stats[r.key].out }));
  const judge = l => l.ppm == null ? ['', '—'] : l.ppm >= 2 * target() ? ['danger', '기준 2배 초과'] : l.ppm >= target() ? ['warn', '기준 초과'] : ['ok', '기준 안'];
  const jTag = l => { const [c, t] = judge(l); return c ? `<span class="tag j-${c}">${t}</span>` : '—'; };
  const codeName = c => (M.S.masters.defect_codes.find(x => x.code === c) || {}).name || c;
  const topDefect = l => { const e = Object.entries(l.defects || {}).sort((a, b) => b[1] - a[1])[0]; return e ? `${codeName(e[0])} ${f(e[1], 0)}` : '—'; };
  const hm = s => String(s || '').slice(5, 16);

  // 히터 출력: 처음 N개 작업의 중앙값을 기준으로, 최근 N개 작업과 비교 (같은 온도를 유지하는 데 드는 출력)
  function heaterDrift() {
    const L = H().lots, N = Math.min(HC().HEATER_BASE_JOBS, Math.floor(L.length / 2));
    return H().heaters.map(h => {
      const v = L.map(l => (l.heater || {})[h.key]);
      const base = M.median(v.slice(0, N)), now = M.median(v.slice(-N));
      return Object.assign({}, h, { base, now, diff: base == null || now == null ? null : now - base });
    });
  }

  // ── 현장 알림
  function alerts() {
    const out = [], t = target(), rl = recent(), at = M.S.asof;
    rl.filter(l => l.ppm >= 2 * t).slice(-3).forEach(l => out.push({ proc: 'heat', level: 'danger', title: `${l.id} 불량률 ${ppmTxt(l.ppm)} PPM — 관리 기준 2배 초과`,
      body: `${l.wo} · ${l.date} · 주요 불량 ${topDefect(l)}`, by: '열처리', at: l.end, go: 'heat:' + l.id }));
    const over = rl.filter(l => l.ppm >= t && l.ppm < 2 * t);
    if (over.length) out.push({ proc: 'heat', level: 'warn', title: `최근 ${RD()}일 불량률 관리 기준(${f(t, 0)} PPM) 초과 ${over.length}건`,
      body: over.map(l => `${l.id} ${ppmTxt(l.ppm)} PPM`).join(' · '), by: '열처리', at: over[over.length - 1].end, go: over.length === 1 ? 'heat:' + over[0].id : 'heat_lots' });
    const dv = {};
    recent(RD() * 2).forEach(l => devs(l).forEach(d => (dv[d.key] = dv[d.key] || []).push([l, d.out])));
    Object.entries(dv).forEach(([k, a]) => out.push({ proc: 'heat', level: 'warn', title: `${R(k).label} 조건 이탈 — 작업 ${a.length}건`,
      body: a.slice(-3).map(([l, o]) => `${l.id} ${pct(o, 0)} 시간 이탈`).join(' · ') + ` (허용 ${limTxt(R(k))} ${R(k).unit})`, by: '열처리', at: a[a.length - 1][0].end, go: 'heat_recipe' }));
    heaterDrift().filter(h => h.diff != null && h.diff >= HC().HEATER_DRIFT_PP).forEach(h => out.push({ proc: 'heat', level: 'warn',
      title: `${h.label} 히터 출력 +${f(h.diff, 1)}%p — 설비 점검`, body: `초기 ${HC().HEATER_BASE_JOBS}작업 ${f(h.base, 1)}% → 최근 ${f(h.now, 1)}%. 같은 온도를 유지하는 데 출력이 더 들고 있습니다 (히터·단열재·열전대 점검)`,
      by: '열처리 설비', at, go: 'heat_equip' }));
    return out;
  }

  // ── 공장 현황 카드
  function summary() {
    const rl = recent(), p = sumPpm(rl);
    return { kpi: p == null ? '—' : `${ppmTxt(p)} PPM`, sub: `최근 ${RD()}일 · ${rl.length}작업 · ${f(rl.reduce((t, l) => t + l.qty, 0), 0)}개`,
      st: p == null ? 'ok' : p >= 2 * target() ? 'danger' : p >= target() ? 'warn' : 'ok', go: 'heat_home' };
  }

  // ── 라인 흐름도 (마지막 작업의 구역별 평균)
  const SHORT = { wash: '세정 온도', hz1: '1존 장입부', hz2: '2존', hz3: '3존', hz4: '4존', cp: '탄소 포텐셜', sb1: '1존', sb2: '2존', cv1: '1존', cv2: '2존', dr1: '1존', dr2: '2존' };
  const STATIONS = [['세정', ['wash']], ['소입로', ['hz1', 'hz2', 'hz3', 'hz4', 'cp']], ['솔트조', ['sb1', 'sb2']], ['컨베이어', ['cv1', 'cv2']], ['건조로', ['dr1', 'dr2']]];
  function lineFlow(l) {
    if (!l) return '<div class="empty">작업 기록이 없습니다</div>';
    return `<div class="flow">${STATIONS.map(([name, keys], i) => {
      const rows = keys.map(k => { const r = R(k), s = l.stats[k] || {}, b = lim(r), o = s.out || 0;
        const st = !b ? '' : o >= HC().DEVIATION_RATE ? 'warn' : 'ok';
        return { r, s, st, o }; });
      const st = rows.some(x => x.st === 'warn') ? 'warn' : 'ok';
      return `${i ? '<div class="arrow" aria-hidden="true"></div>' : ''}<div class="stn s-${st}"><div class="sn"><span class="dot ${st}"></span>${name}</div>
        ${rows.map(x => `<div class="sv"><span>${esc(SHORT[x.r.key] || x.r.label)}</span><b>${f(x.s.mean, x.r.d)}</b><em>${esc(x.r.unit || '')}</em></div>`).join('')}</div>`;
    }).join('')}</div>`;
  }

  const V = {};
  V.heat_home = () => {
    const L = H().lots, rl = recent(), t = target(), p = sumPpm(rl), last = L[L.length - 1];
    const over = rl.filter(l => l.ppm >= t).length, dev = rl.filter(l => devs(l).length).length;
    // 일별 불량률 (최근 45일)
    const by = {}; recent(45).forEach(l => { const d = by[l.date] = by[l.date] || { q: 0, b: 0 }; d.q += l.qty; d.b += l.bad; });
    const days = Object.keys(by).sort().map(d => ({ x: d.slice(5), v: by[d].b / by[d].q * 1e6, cls: by[d].b / by[d].q * 1e6 >= t ? 'over' : '', t: `${d} · ${f(by[d].q, 0)}개 · ${ppmTxt(by[d].b / by[d].q * 1e6)} PPM` }));
    // 불량 유형 (최근 30일)
    const dc = {}; recent(30).forEach(l => Object.entries(l.defects || {}).forEach(([c, n]) => dc[c] = (dc[c] || 0) + n));
    const dcs = Object.entries(dc).sort((a, b) => b[1] - a[1]), dmax = Math.max(1, ...dcs.map(x => x[1])), dsum = dcs.reduce((s, x) => s + x[1], 0);
    return `
    <div class="kstrip">
      <div class="kpi"><div class="lab">처리 수량 · 최근 ${RD()}일</div><div class="val">${f(rl.reduce((s, l) => s + l.qty, 0), 0)}<small>개</small></div><div class="foot">${rl.length}작업 · 평균 ${f(M.median(rl.map(l => l.dur_h)), 1)}시간</div></div>
      <div class="kpi"><div class="lab">불량률 · 최근 ${RD()}일</div><div class="val" style="color:${p >= t ? 'var(--warn-ink)' : 'inherit'}">${ppmTxt(p)}<small>PPM</small></div><div class="foot">관리 기준 ${f(t, 0)} PPM</div></div>
      <div class="kpi click" data-go="heat_lots"><div class="lab">기준 초과 작업</div><div class="val" style="color:${over ? 'var(--warn-ink)' : 'inherit'}">${over}<small>/ ${rl.length}</small></div><div class="foot">불량률 ${f(t, 0)} PPM 이상</div></div>
      <div class="kpi click" data-go="heat_recipe"><div class="lab">조건 이탈 작업</div><div class="val">${dev}<small>/ ${rl.length}</small></div><div class="foot">허용 범위 밖 시간 ${pct(HC().DEVIATION_RATE, 0)} 이상</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>라인 상태 <span class="h2sub">${last ? `마지막 작업 ${esc(last.id)} · ${esc(hm(last.start))} ~ ${esc(String(last.end).slice(11))} · ${esc(last.worker)}` : ''}</span>
      ${last ? `<a class="more" href="#" data-row="heat:${esc(last.id)}">작업 상세 →</a>` : ''}</h2>${lineFlow(last)}
      <p class="note">값 = 작업 중 평균. 주황 = 허용 범위를 벗어난 시간이 ${pct(HC().DEVIATION_RATE, 0)} 이상인 구역.</p></div>
    <div class="grid g21" style="margin-top:16px">
      <div class="card"><h2>일별 불량률 <span class="h2sub">최근 45일 · 막대에 마우스를 올리면 수량</span></h2>${days.length ? M.barChart(days, { ref: t, refLabel: `관리 기준 ${f(t, 0)}` }) : '<div class="empty">기록 없음</div>'}
        ${M.legend([['l-barok', '기준 안'], ['l-barover', '기준 초과'], ['l-lim', '관리 기준']])}</div>
      <div class="card"><h2>불량 유형 <span class="h2sub">최근 30일 · ${f(dsum, 0)}개</span></h2>
        ${dcs.length ? `<div class="hbars">${dcs.map(([c, n]) => `<div class="hb"><span>${esc(codeName(c))}</span><div><i style="width:${n / dmax * 100}%"></i></div><b>${f(n, 0)}</b><em>${pct(n / dsum, 0)}</em></div>`).join('')}</div>
          <p class="note">치수(내폭·외폭) 불량은 담금질 변형과 관련이 큽니다 — 공정 조건 화면에서 구역별 변동을 함께 보세요.</p>` : '<div class="empty">불량 없음</div>'}</div>
    </div>
    <div class="card" style="margin-top:16px"><h2>최근 작업 <a class="more" href="#" data-go="heat_lots">작업 실적 →</a></h2>${lotTable(L.slice(-6).reverse(), true)}</div>`;
  };

  function lotTable(rows, compact) {
    const done = new Set(M.inspections().map(i => i.lot_id));
    const head = [['작업', r => `<b>${esc(r.id)}</b>`], ['작업지시', 'wo'], ['시작', r => esc(hm(r.start))], ['소요', r => f(r.dur_h, 1) + 'h', 'n'],
      ['소재 LOT', 'mat_lot'], ['작업자', 'worker'], ['수량', r => f(r.qty, 0), 'n'], ['불량', r => f(r.bad, 0), 'n'], ['불량률', r => ppmTxt(r.ppm), 'n'],
      ['주요 불량', r => esc(topDefect(r))], ['조건', r => { const d = devs(r); return d.length ? `<span class="tag j-warn" title="${esc(d.map(x => `${x.label} ${pct(x.out, 0)}`).join(', '))}">이탈 ${d.length}</span>` : '<span class="muted">정상</span>'; }],
      ['판정', jTag]];
    if (!compact) head.push(['검사', r => done.has(r.id) ? '<span class="tag t-안정">기록됨</span>' : `<button class="btn sm" data-insp="heat|${esc(r.id)}">기록</button>`]);
    return M.table(head.filter(h => compact ? !['소재 LOT', '소요'].includes(h[0]) : h[0] !== '소요'), rows, { click: r => 'heat:' + r.id, hl: r => r.ppm >= 2 * target() });
  }

  let lf = 'all', lm = 'all', lq = '';
  V.heat_lots = () => {
    const t = target(), months = [...new Set(H().lots.map(l => l.date.slice(0, 7)))].sort().reverse();
    let rows = H().lots.slice().reverse();
    if (lm !== 'all') rows = rows.filter(l => l.date.startsWith(lm));
    if (lf === 'over') rows = rows.filter(l => l.ppm >= t); else if (lf === 'dev') rows = rows.filter(l => devs(l).length);
    if (lq) { const q = lq.toLowerCase(); rows = rows.filter(l => [l.id, l.wo, l.mat_lot, l.worker].some(x => String(x).toLowerCase().includes(q))); }
    const p = sumPpm(rows);
    return `<div class="card"><div class="tools">
        ${M.seg('hlf', lf, [['all', '전체'], ['over', '기준 초과'], ['dev', '조건 이탈']])}
        <select class="in" id="hlm" style="width:130px"><option value="all">전체 기간</option>${months.map(m => `<option value="${m}" ${m === lm ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <input class="in" id="hlq" placeholder="작업 · 작업지시 · 소재 LOT · 작업자" value="${esc(lq)}" style="width:240px">
        <span class="tsum">${rows.length}작업 · ${f(rows.reduce((s, l) => s + l.qty, 0), 0)}개 · 불량률 <b>${ppmTxt(p)}</b> PPM</span></div>
      ${lotTable(rows.slice(0, 300))}
      <p class="note">행을 누르면 작업 상세(공정값 그래프·조건 요약)가 열립니다.</p></div>`;
  };

  V.heat_recipe = () => {
    const L = H().lots, dur = L.reduce((s, l) => s + (l.dur_h || 0), 0) || 1;
    const rows = H().recipe.map(r => {
      const outT = L.reduce((s, l) => s + ((l.stats[r.key] || {}).out || 0) * (l.dur_h || 0), 0) / dur;
      return Object.assign({}, r, { mean: L.reduce((s, l) => s + ((l.stats[r.key] || {}).mean || 0) * (l.dur_h || 0), 0) / dur,
        outT: lim(r) ? outT : null, nDev: lim(r) ? L.filter(l => ((l.stats[r.key] || {}).out || 0) >= HC().DEVIATION_RATE).length : null });
    });
    const fl = k => { const [key, kind] = k.split('_'); return `${R(key).label} ${kind === 'std' ? '변동 (표준편차)' : '이탈 시간'}`; };
    const top = H().rel[0];
    let split = '';
    if (top) {
      const [key, kind] = top.feat.split('_'), val = l => kind === 'std' ? (l.stats[key] || {}).std : (l.stats[key] || {}).out;
      const md = M.median(L.map(val)), hiG = L.filter(l => val(l) > md), loG = L.filter(l => val(l) <= md);
      split = `<div class="cmp"><div><span>${esc(fl(top.feat))} 큰 절반</span><b>${ppmTxt(M.median(hiG.map(l => l.ppm)))}</b><em>PPM (중앙값)</em></div>
        <div><span>작은 절반</span><b>${ppmTxt(M.median(loG.map(l => l.ppm)))}</b><em>PPM (중앙값)</em></div></div>`;
    }
    return `<div class="card"><h2>공정 조건 <span class="h2sub">CH-001 시트 트랙 스토퍼 브래킷 · SB-01 염욕 열처리로</span></h2>
      ${M.table([['구역', 'grp'], ['항목', r => `<b>${esc(r.label)}</b>`], ['설정·허용', r => lim(r) ? `${limTxt(r)} <span class="muted">${esc(r.unit || '')}</span>` : '<span class="muted">감시만</span>'],
        ['전체 평균', r => f(r.mean, r.d), 'n'], ['이탈 시간', r => r.outT == null ? '—' : pct(r.outT, 1), 'n'],
        ['이탈 작업', r => r.nDev == null ? '—' : r.nDev ? `<b style="color:var(--warn-ink)">${r.nDev}</b> / ${L.length}` : `0 / ${L.length}`, 'n']], rows, { wrap: false })}
      <p class="note">장입부(1존)는 차가운 부품이 들어올 때 온도가 내려가므로 허용 폭을 넓게 둡니다. 컨베이어 온도는 감시만 합니다. 설정·허용 값은 관리자가 바꿉니다.</p></div>
    ${H().rel.length ? `<div class="card" style="margin-top:16px"><h2>불량률과 함께 움직인 조건 <span class="h2sub">작업 ${L.length}건 순위상관</span></h2>
      <div class="grid g21" style="align-items:center">
        <div class="hbars">${H().rel.map(r => `<div class="hb"><span>${esc(fl(r.feat))}</span><div><i style="width:${Math.abs(r.rho) / 0.5 * 100}%"></i></div><b>${r.rho > 0 ? '+' : ''}${f(r.rho, 2)}</b></div>`).join('')}</div>
        ${split}</div>
      <p class="note">0.3 안팎은 약한 관계입니다. 원인을 단정하지 말고 점검 순서를 정하는 데 참고하세요.</p></div>` : ''}`;
  };

  let hz = null;
  V.heat_equip = () => {
    const dr = heaterDrift(), L = H().lots;
    if (!hz) hz = (dr.slice().sort((a, b) => (b.diff || 0) - (a.diff || 0))[0] || {}).key;
    const sel = dr.find(h => h.key === hz) || dr[0];
    const v = L.map(l => (l.heater || {})[sel.key]);
    const roll = v.map((_, i) => M.median(v.slice(Math.max(0, i - 5), i + 6)));
    const xl = [0, .25, .5, .75, 1].map(t => Math.round(t * (L.length - 1))).map(i => [i, L[i].date.slice(5)]);
    const st = h => h.diff == null ? '' : h.diff >= HC().HEATER_DRIFT_PP ? M.dot('warn', '점검') : M.dot('ok', '정상');
    return `<div class="grid g21">
      <div class="card"><h2>히터 출력 추이 <span class="h2sub">${esc(sel.label)} · 작업별 평균</span>
          <div style="margin-left:auto">${M.seg('hz', sel.key, dr.map(h => [h.key, h.label.replace('소입로 ', '소입 ').replace('건조로 ', '건조 ')]))}</div></h2>
        ${M.lineChart([{ v: roll, cls: 's1' }], null, { h: 230, d: 0, xlab: xl, dots: v.map((y, i) => y == null ? null : { i, y, cls: 'soft', r: 2, t: `${L[i].id} ${f(y, 1)}%` }).filter(Boolean) })}
        ${M.legend([['l-dot', '작업별 평균'], ['l-ma', '이동 중앙값 (11작업)']])}</div>
      <div class="card"><h2>구역별 변화</h2>
        ${M.table([['구역', r => `<b>${esc(r.label)}</b>`], ['초기', r => f(r.base, 1) + '%', 'n'], ['최근', r => f(r.now, 1) + '%', 'n'],
          ['변화', r => r.diff == null ? '—' : `<b style="color:${r.diff >= HC().HEATER_DRIFT_PP ? 'var(--warn-ink)' : 'inherit'}">${r.diff > 0 ? '+' : ''}${f(r.diff, 1)}%p</b>`, 'n'], ['상태', st]],
          dr, { wrap: false })}
        <p class="note">초기 = 처음 ${HC().HEATER_BASE_JOBS}작업, 최근 = 마지막 ${HC().HEATER_BASE_JOBS}작업의 중앙값. 같은 설정 온도에서 출력이 늘었다면(한 번에 뛰었든 서서히 올랐든) 히터 열화·단열재 손상·열전대 편차를 점검합니다.</p></div>
    </div>`;
  };

  // ── 작업 상세
  async function lotDrawer(id) {
    const l = H().lots.find(x => x.id === id); if (!l) return;
    let pf = H().profiles[id];
    M.drawer(`열처리 · ${l.equip} · ${l.date}`, `작업 ${l.id}`, '<div class="empty">불러오는 중…</div>');
    if (!pf && M.D.LIVE) { try { pf = await M.D.profile(id); } catch (e) { pf = null; } }
    const ins = M.inspections().filter(i => i.lot_id === id);
    const xl = pf ? (() => { const n = Math.max(...Object.values(pf.s).map(a => a.length)), t0 = M.toDate(pf.t0).getTime();
      return [0, .5, 1].map(t => Math.round(t * (n - 1))).map(i => [i, new Date(t0 + i * pf.step * 60000).toTimeString().slice(0, 5)]); })() : [];
    const chart = (title, keys, bandKey, d) => {
      if (!pf) return '';
      const b = lim(R(bandKey));
      return `<div class="pch"><div class="pt2">${title} <span class="muted">허용 ${limTxt(R(bandKey))} ${esc(R(bandKey).unit)}</span></div>
        ${M.lineChart(keys.map((k, i) => ({ v: pf.s[k] || [], cls: 's' + (i + 1) })), b ? { lo: b[0], hi: b[1] } : null, { h: 160, w: 460, d, xlab: xl })}
        ${keys.length > 1 ? M.legend(keys.map((k, i) => ['l-s' + (i + 1), R(k).label.replace('소입로 ', '').replace('솔트조 ', '')])) : ''}</div>`;
    };
    const def = Object.entries(l.defects || {}).sort((a, b) => b[1] - a[1]);
    M.drawer(`열처리 · ${l.equip} · ${l.date}`, `작업 ${l.id}`, `
      <div class="blk"><h4>판정</h4><dl class="stat">
        <dt>불량률</dt><dd>${ppmTxt(l.ppm)} PPM ${jTag(l)}</dd><dt>수량</dt><dd>${f(l.qty, 0)} · 양품 ${f(l.good, 0)} · 불량 ${f(l.bad, 0)}</dd>
        <dt>불량 내역</dt><dd>${def.length ? def.map(([c, n]) => `${esc(codeName(c))} ${f(n, 0)}`).join(' · ') : '없음'}</dd>
        <dt>조건 이탈</dt><dd>${devs(l).map(d => `${esc(d.label)} ${pct(d.out, 0)}`).join(' · ') || '없음'}</dd></dl></div>
      <div class="blk"><h4>작업 정보</h4><dl class="stat">
        <dt>작업지시</dt><dd>${esc(l.wo)}</dd><dt>소재 LOT</dt><dd><a href="#" data-trace="${esc(l.mat_lot)}">${esc(l.mat_lot)}</a></dd>
        <dt>작업 시간</dt><dd>${esc(l.start)} ~ ${esc(String(l.end).slice(11))} (${f(l.dur_h, 1)}h)</dd><dt>작업자</dt><dd>${esc(l.worker)}</dd></dl></div>
      <div class="blk"><h4>공정값 (2분 평균)</h4>${pf ? chart('소입로 온도 <span class="muted">(2~4존 기준)</span>', ['hz1', 'hz2', 'hz3', 'hz4'], 'hz2', 0) + chart('탄소 포텐셜', ['cp'], 'cp', 2) + chart('솔트조 온도', ['sb1', 'sb2'], 'sb1', 0)
        : '<div class="empty">공정값 기록이 없습니다</div>'}</div>
      <div class="blk"><h4>조건 요약</h4>${M.table([['항목', r => esc(r.label)], ['평균', r => f((l.stats[r.key] || {}).mean, r.d), 'n'],
        ['범위', r => `${f((l.stats[r.key] || {}).min, r.d)} ~ ${f((l.stats[r.key] || {}).max, r.d)}`, 'n'], ['이탈', r => lim(r) ? pct((l.stats[r.key] || {}).out || 0, 0) : '—', 'n']],
        H().recipe, { wrap: false })}</div>
      <div class="blk"><h4>검사</h4>${ins.length ? M.table([['시각', 'at'], ['결과', 'result'], ['코드', r => esc(r.defect_code ? codeName(r.defect_code) : '—')], ['수량', 'qty', 'n'], ['기록', 'by']], ins, { wrap: false }) : ''}
        <button class="btn pri" data-insp="heat|${esc(l.id)}" style="margin-top:8px">검사 결과 기록</button></div>`);
  }

  M.mod({
    id: 'heat', proc: 'heat', group: '열처리', order: 30,
    menu: [['heat_home', '열처리 현황', 'flame'], ['heat_lots', '작업 실적', 'list'], ['heat_recipe', '공정 조건', 'range'], ['heat_equip', '설비 상태', 'gauge']],
    views: V, alerts, summary, drawers: { 'heat:': lotDrawer },
    bind(root) {
      root.querySelectorAll('[data-hlf]').forEach(b => b.onclick = () => { lf = b.dataset.hlf; M.render(); });
      root.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => { hz = b.dataset.hz; M.render(); });
      const m = root.querySelector('#hlm'); if (m) m.onchange = () => { lm = m.value; M.render(); };
      const q = root.querySelector('#hlq');
      if (q) q.oninput = () => { lq = q.value.trim(); const pos = q.selectionStart; M.render(); const n = M.$('#hlq'); n.focus(); n.setSelectionRange(pos, pos); };
    },
  });
})();
