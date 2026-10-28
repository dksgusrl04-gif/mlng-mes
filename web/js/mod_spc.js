/* 5.6 — 품질 데이터 분석: SPC 관리도 · 공정능력 · 불량 층별 분석(4M) · 예측 모델 검증 · 이슈 분석 보고서
 * ───────────────────────────────────────────────────────────────
 * SPC 관리도 (기준 기간 = 앞 60% 로 한계를 정하고, 뒤 40% 를 감시 — Phase I / II)
 *   열처리 불량률  Laney p′ 관리도 — LOT 수량이 커서 일반 p 관리도는 과산포로 거의 모든 점이 이상이 된다.
 *                 z = (p − p̄)/σp,  σz = MR̄(z)/1.128,  한계 = p̄ ± 3·σp·σz
 *   프레스 압력    X̄-R (부분군 5 = 연속 20타 평균 5개, LOT 안에서만 묶음 · 설정값 변경분 보정)
 *   용접 전류      X̄-R (부분군 10 타점, A2 .308 · D3 .223 · D4 1.777)
 *   열처리 온도    I-MR (LOT 평균, σ = MR̄/1.128)
 *   판정 규칙      Western Electric — ① 3σ 밖 ② 3점 중 2점 2σ 밖 ③ 5점 중 4점 1σ 밖 ④ 8점 연속 한쪽 ⑤ 6점 연속 상승·하락
 * 공정능력
 *   Cp · Cpk = 군내 σ (LOT 안 합동 표준편차 — LOT 을 부분군으로), Pp · Ppk = 전체 σ (LOT 간 변동 포함)
 *   신뢰구간 95%: Cpk·Ppk — Bissell, Cp — 카이제곱(Wilson–Hilferty). 연속 측정의 자기상관은 유효 표본 n·(1−r₁)/(1+r₁) 로 반영
 * 불량 층별 분석 (4M)
 *   LOT 단위 PPM 을 층(교대 · 작업자 · 히터 출력 · 조건 이탈 · 원자재 LOT · 장입량 · 요일)으로 나눠 비교
 *   차이 검정 = 순열 검정 (층 사이 제곱합, 999회) + BH 보정 q.  PPM 95% 구간 = Garwood(포아송)
 * 예측 모델 검증 — 학습에 쓰지 않은 데이터로 «예측 대 실제»
 *   열처리 불량: 앞 70% 학습 → 뒤 30% (MAE · 기준선 대비 개선 · 90% 상한 적중률 · 350 PPM 초과 확률의 Brier · AUC)
 *   공구 수명: 공구 하나씩 빼고 80% 구간 적중률 · VB 추정: 컨포멀 90% 적중률 · MAE · RMSE · 수요: 1일 앞 롤링 예측 MAPE
 *   히터 변화점 · 검사 판정 점검 · 라인 시뮬레이션 — 정답 기록이 없어 «미검증» 으로 표시
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f, pct } = M;
  const ST = () => M.st;
  const H = () => M.S.heat || { lots: [], recipe: [], profiles: {}, heaters: [] };
  const sum = a => a.reduce((s, v) => s + v, 0), mean = a => a.length ? sum(a) / a.length : NaN;
  const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(sum(a.map(v => (v - m) ** 2)) / (a.length - 1)) : NaN; };
  const at = (a, i) => Array.isArray(a) ? a[i] : a;
  const DEVR = () => (M.CFG.HEAT || {}).DEVIATION_RATE || 0.05;
  const CLAIM = () => (M.CFG.HEAT || {}).CLAIM_PPM || 350;
  const CODE = { 'HT-IW': '내폭 치수', 'HT-OW': '외폭 치수', 'HT-DF': '변형(폭)', 'HT-SH': '형상 파손' };
  const st = { spc: 'heat', pv: 'p5', wv: 'current', zk: 'hz2', win: 'recent', capa: 'press|p5', strat: 'shift', per: 'all', mv: 'heat', dm: '' };

  // ── 통계 보조
  const chi2q = (p, v) => { const z = ST().zOf(p), a = 2 / (9 * v); return Math.max(0, v * Math.pow(1 - a + z * Math.sqrt(a), 3)); };
  const garwood = (k, n) => ({ lo: k ? chi2q(0.025, 2 * k) / 2 / n : 0, hi: chi2q(0.975, 2 * k + 2) / 2 / n });
  const ac1 = x => { const m = mean(x); let a = 0, b = 0; for (let i = 0; i < x.length; i++) { b += (x[i] - m) ** 2; if (i) a += (x[i] - m) * (x[i - 1] - m); } return b ? a / b : 0; };
  const phi = z => ST().phi(z);
  const pdf = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
  const sorted = () => M.memo('spc.lots', '', () => H().lots.filter(l => l.qty > 0).slice().sort((a, b) => String(a.start).localeCompare(String(b.start))));
  const asofT = () => M.toDate(M.S.asof).getTime();

  // ── 판정 규칙 (Western Electric)
  const RULES = [[1, '3σ 밖', '관리 한계 밖 1점'], [2, '2σ 밖 2/3', '연속 3점 중 2점이 같은 쪽 2σ 밖'], [3, '1σ 밖 4/5', '연속 5점 중 4점이 같은 쪽 1σ 밖'],
    [4, '8점 한쪽', '중심선 한쪽에 연속 8점'], [5, '6점 추세', '연속 6점 상승 또는 하락']];
  function judge(x, cl, s) {
    const z = x.map((v, i) => (v - at(cl, i)) / at(s, i)), out = new Map(), add = (i, r) => { const a = out.get(i) || []; if (!a.includes(r)) a.push(r); out.set(i, a); };
    const side = v => v > 0 ? 1 : v < 0 ? -1 : 0;
    for (let i = 0; i < z.length; i++) {
      if (!isFinite(z[i])) continue;
      if (Math.abs(z[i]) > 3) add(i, 1);
      const sg = side(z[i]);
      if (i >= 2 && Math.abs(z[i]) > 2 && z.slice(i - 2, i + 1).filter(v => side(v) === sg && Math.abs(v) > 2).length >= 2) add(i, 2);
      if (i >= 4 && Math.abs(z[i]) > 1 && z.slice(i - 4, i + 1).filter(v => side(v) === sg && Math.abs(v) > 1).length >= 4) add(i, 3);
      if (i >= 7 && sg && z.slice(i - 7, i + 1).every(v => side(v) === sg)) add(i, 4);
      if (i >= 5) { const w = z.slice(i - 5, i + 1); let up = true, dn = true; for (let k = 1; k < 6; k++) { if (!(w[k] > w[k - 1])) up = false; if (!(w[k] < w[k - 1])) dn = false; } if (up || dn) add(i, 5); }
    }
    return out;
  }
  // 같은 규칙이 이어진 점들을 «한 번의 이상» 으로 묶는다
  function episodes(viol) {
    const by = {}; [...viol.entries()].sort((a, b) => a[0] - b[0]).forEach(([i, rs]) => rs.forEach(r => (by[r] = by[r] || []).push(i)));
    const eps = []; Object.entries(by).forEach(([r, is]) => { let a = is[0], b = is[0], c = 1; for (let k = 1; k <= is.length; k++) { if (k < is.length && is[k] - b <= 2) { b = is[k]; c++; continue; } eps.push({ r: +r, a, b, c }); if (k < is.length) { a = b = is[k]; c = 1; } } });
    return eps.sort((x, y) => y.b - x.b || x.r - y.r);
  }

  // ── 관리 한계
  function imr(x, base) {
    const b = x.slice(0, base), mr = b.slice(1).map((v, i) => Math.abs(v - b[i])), mrb = mean(mr), s = mrb / 1.128, cl = mean(b);
    return { cl, s, ucl: cl + 3 * s, lcl: cl - 3 * s, how: 'MR̄/1.128', sub: { title: '이동범위 (MR)', x: x.map((v, i) => i ? Math.abs(v - x[i - 1]) : null), cl: mrb, ucl: 3.267 * mrb, lcl: 0, s: (3.267 * mrb - mrb) / 3 } };
  }
  const XR = { 5: [0.577, 0, 2.114, 2.326], 10: [0.308, 0.223, 1.777, 3.078] };
  function xbarR(groups, base, n) {
    const xb = groups.map(mean), R = groups.map(g => Math.max(...g) - Math.min(...g)), [A2, D3, D4] = XR[n];
    const cl = mean(xb.slice(0, base)), rb = mean(R.slice(0, base)), s = A2 * rb / 3;
    return { x: xb, cl, s, ucl: cl + A2 * rb, lcl: cl - A2 * rb, how: `R̄/d₂ (n=${n})`, sub: { title: `범위 R (n=${n})`, x: R, cl: rb, ucl: D4 * rb, lcl: D3 * rb, s: (D4 * rb - rb) / 3 } };
  }

  // ── 관리도 데이터
  const spcData = (k, o = {}) => M.memo('spc.' + k, JSON.stringify(o), () => {
    if (k === 'heat') {
      const L = sorted(), n = L.length, base = Math.max(20, Math.floor(n * 0.6)), B = L.slice(0, base);
      const pb = sum(B.map(l => l.bad)) / sum(B.map(l => l.qty)), sp = L.map(l => Math.sqrt(pb * (1 - pb) / l.qty));
      const zb = B.map((l, i) => (l.bad / l.qty - pb) / sp[i]), sz = mean(zb.slice(1).map((v, i) => Math.abs(v - zb[i]))) / 1.128;
      const x = L.map(l => l.bad / l.qty * 1e6), cl = pb * 1e6, s = sp.map(v => v * sz * 1e6);
      const plain = judge(x, cl, sp.map(v => v * 1e6)), np = [...plain.values()].filter(r => r.includes(1)).length;
      return { k, title: '열처리 불량률', chart: 'Laney p′', unit: 'PPM', d: 0, x, cl, s, ucl: s.map(v => cl + 3 * v), lcl: s.map(v => Math.max(0, cl - 3 * v)), floor: 0, base, n,
        how: `σz = ${f(sz, 2)}`, extra: { sz, plainOut: np }, lab: i => L[i].id, when: i => String(L[i].start).slice(5, 16), day: i => String(L[i].start).slice(0, 10), go: i => 'trace:' + L[i].id };
    }
    if (k === 'zone') {
      const L = sorted().filter(l => l.stats && l.stats[o.key]), x = L.map(l => l.stats[o.key].mean), n = x.length, base = Math.max(20, Math.floor(n * 0.6)), r = H().recipe.find(y => y.key === o.key) || {};
      return Object.assign(imr(x, base), { k, title: r.label || o.key, chart: 'I-MR', unit: r.unit || '', d: r.d ?? 1, x, base, n, lab: i => L[i].id, when: i => String(L[i].start).slice(5, 16), day: i => String(L[i].start).slice(0, 10), go: i => 'trace:' + L[i].id });
    }
    if (k === 'press') {
      const P = M.S.press || { lots: [], series: {}, recipe: [] }, r = P.recipe.find(y => y.key === o.key) || {}, groups = [], tag = [];
      P.lots.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(l => { const s = (P.series[l.id] || {})[o.key]; if (!s) return; const adj = r.sp != null && l.stats && l.stats[o.key] && l.stats[o.key].sp != null ? r.sp - l.stats[o.key].sp : 0;
        for (let i = 0; i + 5 <= s.length; i += 5) { groups.push(s.slice(i, i + 5).map(v => v + adj)); tag.push([l.id, l.date, i]); } });
      const n = groups.length, base = Math.max(20, Math.floor(n * 0.6)), c = xbarR(groups, base, 5);
      return Object.assign(c, { k, title: `프레스 ${r.label || o.key}`, chart: 'X̄-R', unit: r.unit || '', d: r.d ?? 1, base, n, lab: i => `${tag[i][0]} #${tag[i][2] / 5 + 1}`, when: i => String(tag[i][1]).slice(5), day: i => String(tag[i][1]), go: i => 'press_lots' });
    }
    if (k === 'weld') {
      const W = M.S.weld || { preds: [] }, ps = (W.preds || []).slice().sort((a, b) => a.idx - b.idx), groups = [], tag = [];
      for (let i = 0; i + 10 <= ps.length; i += 10) { groups.push(ps.slice(i, i + 10).map(p => p[o.key])); tag.push(ps[i].idx); }
      const n = groups.length, base = Math.max(20, Math.floor(n * 0.6)), c = xbarR(groups, base, 10), U = { current: ['용접 전류', 'kA', 2], force: ['가압력', 'bar', 2], voltage: ['전압', 'V', 3] }[o.key];
      return Object.assign(c, { k, title: U[0], chart: 'X̄-R', unit: U[1], d: U[2], base, n, lab: i => `타점 ${tag[i]}~${tag[i] + 9}`, when: i => `#${i + 1}`, day: () => null, go: () => 'weld_queue' });
    }
    return null;
  });
  const curSpc = () => spcData(st.spc, st.spc === 'press' ? { key: st.pv } : st.spc === 'weld' ? { key: st.wv } : st.spc === 'zone' ? { key: st.zk } : {});

  // ── 그림: 관리도
  function cchart(D, o = {}) {
    const from = o.from || 0, x = D.x.slice(from), n = x.length, W = 760, Hh = o.h || 220, L = 56, R = 70, T = 10, B = o.xlab ? 22 : 8;
    const g = (a, i) => at(a, i + from), viol = o.viol || new Map();
    const vs = x.filter(v => v != null && isFinite(v)); for (let i = 0; i < n; i++) { vs.push(g(D.ucl, i)); if (isFinite(g(D.lcl, i))) vs.push(g(D.lcl, i)); }
    let lo = Math.min(...vs), hi = Math.max(...vs); const pd = (hi - lo) * 0.06 || 1; lo = D.floor != null ? Math.max(D.floor, lo - pd) : lo - pd; hi += pd;
    const X = i => L + (W - L - R) * (n < 2 ? 0.5 : i / (n - 1)), Y = v => T + (Hh - T - B) * (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo));
    const step = fn => { let d = ''; for (let i = 0; i < n; i++) { const a = i ? (X(i - 1) + X(i)) / 2 : L, b = i < n - 1 ? (X(i) + X(i + 1)) / 2 : W - R; d += `${i ? 'L' : 'M'}${a.toFixed(1)} ${Y(fn(i)).toFixed(1)}H${b.toFixed(1)}`; } return d; };
    const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * i / 3), d = D.d ?? 1, bi = D.base - from;
    let line = '', pen = false; x.forEach((v, i) => { if (v == null || !isFinite(v)) { pen = false; return; } line += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; });
    const last = n - 1;
    return `<svg class="chart cc" viewBox="0 0 ${W} ${Hh}" role="img">
      ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 7}" y="${Y(t) + 4}" text-anchor="end">${f(t, d)}</text>`).join('')}
      ${D.s != null && !Array.isArray(D.s) ? [1, 2, -1, -2].map(m => `<path class="zl" d="${step(i => g(D.cl, i) + m * g(D.s, i))}"/>`).join('') : ''}
      ${bi > 0 && bi < n ? `<line class="phase" x1="${X(bi - 0.5)}" x2="${X(bi - 0.5)}" y1="${T}" y2="${Hh - B}"/><text class="ax" x="${X(bi - 0.5) + 4}" y="${T + 10}">감시 →</text>` : ''}
      <path class="ucl ${Array.isArray(D.ucl) ? 'var' : ''}" d="${step(i => g(D.ucl, i))}"/>${isFinite(g(D.lcl, last)) && g(D.lcl, last) > lo ? `<path class="ucl ${Array.isArray(D.lcl) ? 'var' : ''}" d="${step(i => g(D.lcl, i))}"/>` : ''}<path class="clc" d="${step(i => g(D.cl, i))}"/>
      <path class="ln s1 thin" d="${line}"/>
      ${n <= 260 ? x.map((v, i) => v == null || !isFinite(v) || viol.has(i + from) ? '' : `<circle class="pt soft" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="1.8"/>`).join('') : ''}
      ${[...viol.keys()].filter(i => i >= from).map(i => `<circle class="pt bad" cx="${X(i - from).toFixed(1)}" cy="${Y(D.x[i]).toFixed(1)}" r="3.4"><title>${esc((o.lab ? o.lab(i) : '') + ' ' + f(D.x[i], d) + ' — ' + viol.get(i).map(r => RULES[r - 1][1]).join(', '))}</title></circle>`).join('')}
      <text class="lbl dg" x="${W - R + 5}" y="${Y(g(D.ucl, last)) + 4}">UCL ${f(g(D.ucl, last), d)}</text>
      <text class="lbl" x="${W - R + 5}" y="${Y(g(D.cl, last)) + 4}">CL ${f(g(D.cl, last), d)}</text>
      ${isFinite(g(D.lcl, last)) && g(D.lcl, last) > lo ? `<text class="lbl dg" x="${W - R + 5}" y="${Y(g(D.lcl, last)) + 4}">LCL ${f(g(D.lcl, last), d)}</text>` : ''}
      ${(o.xlab || []).map(([i, t], k, a) => `<text class="ax" x="${X(i)}" y="${Hh - 6}" text-anchor="${k === 0 ? 'start' : k === a.length - 1 ? 'end' : 'middle'}">${esc(t)}</text>`).join('')}
    </svg>`;
  }
  const xlabOf = (D, from) => { const n = D.n - from, a = [0, Math.floor(n / 3), Math.floor(2 * n / 3), n - 1]; return a.map(i => [i, D.when(i + from)]); };

  // ── 그림: 히스토그램 + 규격선 + 정규 곡선
  function hist(c, o = {}) {
    const v = c.vals, W = 760, Hh = o.h || 230, L = 44, R = 12, T = 16, B = 22, sp = c.spec;
    let lo = Math.min(sp.lsl, ST().q(v, 0.001)), hi = Math.max(sp.usl, ST().q(v, 0.999)); const pd = (hi - lo) * 0.08; lo -= pd; hi += pd;
    const nb = 34, bw = (hi - lo) / nb, cnt = new Array(nb).fill(0); v.forEach(x => { const i = Math.floor((x - lo) / bw); if (i >= 0 && i < nb) cnt[i]++; });
    const yMax = Math.max(...cnt, v.length * bw * pdf(c.mean, c.mean, c.sw)) * 1.1 || 1;
    const X = x => L + (W - L - R) * (x - lo) / (hi - lo), Y = y => T + (Hh - T - B) * (1 - y / yMax), d = o.d ?? 1;
    const curve = s => Array.from({ length: 81 }, (_, i) => { const x = lo + (hi - lo) * i / 80; return `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(v.length * bw * pdf(x, c.mean, s)).toFixed(1)}`; }).join('');
    const vl = (x, cls, t, anc) => `<line class="${cls}" x1="${X(x)}" x2="${X(x)}" y1="${T}" y2="${Hh - B}"/><text class="lbl ${cls === 'ucl' ? 'dg' : ''}" x="${X(x) + (anc === 'end' ? -4 : 4)}" y="${T + 2}" text-anchor="${anc || 'start'}">${esc(t)}</text>`;
    const ticks = [0, 1, 2, 3, 4].map(i => lo + (hi - lo) * i / 4);
    return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img">
      <line class="grid" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>
      ${cnt.map((k, i) => { const x0 = lo + i * bw, out = x0 + bw <= sp.lsl || x0 >= sp.usl; return k ? `<rect class="bar ${out ? 'over' : ''}" x="${(X(x0) + 0.6).toFixed(1)}" width="${Math.max(0.5, X(x0 + bw) - X(x0) - 1.2).toFixed(1)}" y="${Y(k).toFixed(1)}" height="${(Y(0) - Y(k)).toFixed(1)}"><title>${f(x0, d)}~${f(x0 + bw, d)} : ${k}</title></rect>` : ''; }).join('')}
      <path class="ln s1" d="${curve(c.so)}"/><path class="ln s2 dash" d="${curve(c.sw)}"/>
      ${vl(sp.lsl, 'ucl', 'LSL ' + f(sp.lsl, d), 'end')}${vl(sp.usl, 'ucl', 'USL ' + f(sp.usl, d))}${vl(sp.t, 'clc', '')}
      ${ticks.map((t, i) => `<text class="ax" x="${X(t)}" y="${Hh - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${f(t, d)}</text>`).join('')}
    </svg>`;
  }
  // ── 그림: 파레토 (막대 + 누적 %)
  function pareto(rows, o = {}) {
    const W = o.w || 760, Hh = o.h || 210, L = 46, R = 40, T = 12, B = 34, tot = sum(rows.map(r => r.v)) || 1, hi = Math.max(1, ...rows.map(r => r.v)) * 1.1, n = rows.length;
    const bw = (W - L - R) / Math.max(1, n), Y = y => T + (Hh - T - B) * (1 - y / hi), Yp = p => T + (Hh - T - B) * (1 - p);
    let acc = 0; const cum = rows.map(r => (acc += r.v) / tot);
    return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img">
      ${[0, 1, 2, 3].map(i => hi * i / 3).map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 7}" y="${Y(t) + 4}" text-anchor="end">${f(t, 0)}</text>`).join('')}
      ${[0, 0.5, 1].map(p => `<text class="ax" x="${W - R + 6}" y="${Yp(p) + 4}">${p * 100}%</text>`).join('')}
      ${rows.map((r, i) => `<rect class="bar ${r.cls || ''}" x="${(L + i * bw + bw * 0.16).toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" y="${Y(r.v).toFixed(1)}" height="${Math.max(0, Y(0) - Y(r.v)).toFixed(1)}"><title>${esc(r.x)} ${f(r.v, 0)} (${pct(r.v / tot)})</title></rect>
        <text class="ax" x="${(L + i * bw + bw / 2).toFixed(1)}" y="${Hh - 18}" text-anchor="middle">${esc(String(r.x).length > 9 ? String(r.x).slice(0, 8) + '…' : r.x)}</text>`).join('')}
      <path class="pcum" d="${cum.map((p, i) => `${i ? 'L' : 'M'}${(L + i * bw + bw / 2).toFixed(1)} ${Yp(p).toFixed(1)}`).join('')}"/>
      ${cum.map((p, i) => `<circle class="pcum-d" cx="${(L + i * bw + bw / 2).toFixed(1)}" cy="${Yp(p).toFixed(1)}" r="2.6"/>`).join('')}
      <line class="lim" x1="${L}" x2="${W - R}" y1="${Yp(0.8)}" y2="${Yp(0.8)}"/>
    </svg>`;
  }
  // ── 그림: 산점도 (예측 대 실제, 대각선 · 허용 띠)
  function scatter(pts, o = {}) {
    const W = 380, Hh = 300, L = 50, R = 12, T = 12, B = 30, all = [].concat(...pts.map(p => [p.x, p.y])).filter(isFinite);
    let lo = o.lo ?? Math.min(...all), hi = Math.max(...all); const pd = (hi - lo) * 0.06 || 1; lo = Math.max(o.lo ?? -Infinity, lo - pd); hi += pd;
    const X = v => L + (W - L - R) * (v - lo) / (hi - lo), Y = v => T + (Hh - T - B) * (1 - (v - lo) / (hi - lo)), d = o.d ?? 0;
    const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * i / 3);
    return `<svg class="chart sq" viewBox="0 0 ${W} ${Hh}" role="img">
      ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${f(t, d)}</text><text class="ax" x="${X(t)}" y="${Hh - 14}" text-anchor="middle">${f(t, d)}</text>`).join('')}
      ${o.band ? `<path class="lobe" d="M${X(lo)} ${Y(lo + o.band)}L${X(hi - o.band)} ${Y(hi)}L${X(hi)} ${Y(hi)}L${X(hi)} ${Y(hi - o.band)}L${X(lo + o.band)} ${Y(lo)}L${X(lo)} ${Y(lo)}Z"/>` : ''}
      <line class="clc" x1="${X(lo)}" y1="${Y(lo)}" x2="${X(hi)}" y2="${Y(hi)}"/>
      ${o.ref != null ? `<line class="lim" x1="${L}" x2="${W - R}" y1="${Y(o.ref)}" y2="${Y(o.ref)}"/><line class="lim" x1="${X(o.ref)}" x2="${X(o.ref)}" y1="${T}" y2="${Hh - B}"/>` : ''}
      ${pts.map(p => `<circle class="pt ${p.cls || 'soft'}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3"><title>${esc(p.t || '')}</title></circle>`).join('')}
      <text class="ax" x="${W - R}" y="${Hh - 2}" text-anchor="end">${esc(o.xl || '예측')} →</text><text class="ax" x="${L + 4}" y="${T + 10}">↑ ${esc(o.yl || '실제')}</text>
    </svg>`;
  }

  // ═══ 1. SPC 관리도
  const V = {};
  const spcKpis = (D, eps, viol, sub) => {
    const mon = [...viol.keys()].filter(i => i >= D.base).sort((a, b) => a - b), first = mon[0];
    const ok = !mon.length;
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">관리 상태</div><div class="val" style="color:${ok ? 'var(--ok-ink)' : 'var(--danger-ink)'}">${ok ? '안정' : '이상'}</div><div class="foot">감시 구간 ${D.n - D.base}점</div></div>
      <div class="kpi"><div class="lab">이상 점</div><div class="val">${mon.length}<small>점</small></div><div class="foot">${sub ? `산포 관리도 ${[...sub.keys()].filter(i => i >= D.base).length}점` : `일반 p 관리도라면 ${D.extra.plainOut}점`}</div></div>
      <div class="kpi"><div class="lab">첫 이상</div><div class="val sm">${first != null ? esc(D.when(first)) : '—'}</div><div class="foot">${first != null ? esc(D.lab(first)) : '감시 구간 이상 없음'}</div></div>
      <div class="kpi"><div class="lab">중심선 (CL)</div><div class="val">${f(at(D.cl, D.n - 1), D.d)}<small>${esc(D.unit)}</small></div><div class="foot">기준 ${D.base}점</div></div>
      <div class="kpi"><div class="lab">σ 추정</div><div class="val sm">${esc(D.how)}</div><div class="foot">${esc(D.chart)} 관리도</div></div>
    </div>`;
  };
  V.spc = () => {
    const D = curSpc(); if (!D || D.n < 25) return '<div class="card"><div class="empty">관리도를 그릴 데이터가 부족합니다</div></div>';
    const viol = judge(D.x, D.cl, D.s), eps = episodes(viol).filter(e => e.b >= D.base);
    const sub = D.sub ? judge(D.sub.x.map(v => v ?? NaN), D.sub.cl, D.sub.s) : null;
    const from = st.win === 'recent' && D.n > 160 ? D.n - 150 : 0, xl = xlabOf(D, from);
    const varSeg = st.spc === 'press' ? M.seg('sx', 'pv|' + st.pv, (M.S.press.recipe || []).map(r => ['pv|' + r.key, r.label]))
      : st.spc === 'weld' ? M.seg('sx', 'wv|' + st.wv, [['wv|current', '전류'], ['wv|force', '가압력']])
      : st.spc === 'zone' ? M.seg('sx', 'zk|' + st.zk, H().recipe.filter(r => ['hz1', 'hz2', 'hz3', 'hz4', 'cp', 'sb1'].includes(r.key)).map(r => ['zk|' + r.key, r.label.replace(/ \(.*\)/, '').replace('소입로 ', '')])) : '';
    const cnt = r => [...viol.entries()].filter(([i, rs]) => i >= D.base && rs.includes(r)).length;
    return `${spcKpis(D, eps, viol, sub)}
      <div class="card" style="margin-top:16px"><h2>${esc(D.title)} <span class="h2sub">${esc(D.chart)}</span><span class="more spc-ctl">${M.seg('sx', 'spc|' + st.spc, [['spc|heat', '열처리 불량률'], ['spc|press', '프레스 압력'], ['spc|weld', '용접 전류'], ['spc|zone', '열처리 온도']])}</span></h2>
        ${varSeg || D.n > 160 ? `<div class="spc-sub">${varSeg}${D.n > 160 ? M.seg('sx', 'win|' + st.win, [['win|recent', '최근 150'], ['win|all', `전체 ${D.n}`]]) : ''}</div>` : ''}
        ${cchart(D, { viol, from, xlab: xl, lab: D.lab, h: 240 })}
        ${D.sub ? `<h3 class="dh">${esc(D.sub.title)}</h3>${cchart(Object.assign({}, D.sub, { d: D.d, base: D.base, n: D.n, floor: 0, x: D.sub.x.map(v => v ?? NaN) }), { viol: sub, from, h: 120, lab: D.lab })}` : ''}
        ${M.legend([['sw-ucl', '관리 한계 (UCL · LCL)'], ['sw-cl', '중심선'], ['sw-zl', '1σ · 2σ'], ['sw-bad', '이상 판정']])}</div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h2>이상 판정 내역 <span class="h2sub">감시 구간</span></h2>
          <div class="tbx"><table class="tb stab"><colgroup><col class="c-r"><col><col><col class="c-n"></colgroup><thead><tr><th>규칙</th><th>시작</th><th>끝</th><th class="n">점 수</th></tr></thead>
          <tbody>${eps.slice(0, 12).map(e => `<tr class="click" data-row="${esc(D.go(e.a))}"><td><span class="tag j-${e.r === 1 ? 'danger' : 'warn'}">${'①②③④⑤'[e.r - 1]} ${esc(RULES[e.r - 1][1])}</span></td><td>${esc(D.when(e.a))}<div class="it2">${esc(D.lab(e.a))}</div></td><td>${esc(D.when(e.b))}<div class="it2">${esc(D.lab(e.b))}</div></td><td class="n">${e.c}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">감시 구간에 이상 판정이 없습니다</td></tr>'}</tbody></table></div></div>
        <div class="card"><h2>판정 규칙 <span class="h2sub">Western Electric</span></h2>
          <div class="tbx"><table class="tb stab"><colgroup><col class="c-r"><col><col class="c-n"></colgroup><thead><tr><th>규칙</th><th>내용</th><th class="n">감시 구간</th></tr></thead>
          <tbody>${RULES.map(([r, t, dsc]) => `<tr><td><b>${'①②③④⑤'[r - 1]}</b> ${esc(t)}</td><td class="muted">${esc(dsc)}</td><td class="n">${cnt(r) ? `<b class="ng">${cnt(r)}</b>` : '0'}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  };

  // ═══ 2. 공정능력
  const capaItems = () => M.memo('capa.items', '', () => {
    const out = [], P = M.S.press || { lots: [], series: {}, recipe: [] };
    (P.recipe || []).forEach(r => { if (r.sp == null || r.tol == null) return;
      const groups = P.lots.map(l => { const s = (P.series[l.id] || {})[r.key]; if (!s) return null; const adj = l.stats && l.stats[r.key] && l.stats[r.key].sp != null ? r.sp - l.stats[r.key].sp : 0; return s.map(v => v + adj); }).filter(Boolean);
      out.push(capa('press', r, groups, '20타 평균')); });
    const prof = H().profiles || {};
    H().recipe.forEach(r => { const spc = r.lo != null ? { lsl: r.lo, usl: r.hi, t: (r.lo + r.hi) / 2 } : r.sp != null && r.tol != null ? null : 'x'; if (spc === 'x') return;
      const groups = H().lots.map(l => ((prof[l.id] || {}).s || {})[r.key]).filter(g => g && g.length);
      if (groups.length) out.push(capa('heat', r, groups, '2분 간격', spc)); });
    return out.filter(Boolean);
  });
  function capa(proc, r, groups, how, spec) {
    const sp = spec || { lsl: r.sp - r.tol, usl: r.sp + r.tol, t: r.sp }, vals = [].concat(...groups), n = vals.length; if (n < 30) return null;
    const m = mean(vals), so = sd(vals), dfw = sum(groups.map(g => g.length - 1)), sw = Math.sqrt(sum(groups.map(g => g.length > 1 ? sd(g) ** 2 * (g.length - 1) : 0)) / Math.max(1, dfw)) || so;
    const r1 = Math.max(0, Math.min(0.98, mean(groups.filter(g => g.length > 3).map(ac1)))), ne = Math.max(groups.length, Math.round(n * (1 - r1) / (1 + r1)));
    const cp = (sp.usl - sp.lsl) / (6 * sw), cpk = Math.min(sp.usl - m, m - sp.lsl) / (3 * sw), pp = (sp.usl - sp.lsl) / (6 * so), ppk = Math.min(sp.usl - m, m - sp.lsl) / (3 * so);
    const z = ST().zOf(0.975), bis = c => z * Math.sqrt(1 / (9 * ne) + c * c / (2 * (ne - 1)));
    const cpCI = [cp * Math.sqrt(chi2q(0.025, ne - 1) / (ne - 1)), cp * Math.sqrt(chi2q(0.975, ne - 1) / (ne - 1))];
    const exp = (phi(-(sp.usl - m) / so) + phi(-(m - sp.lsl) / so)) * 1e6, obs = vals.filter(v => v < sp.lsl || v > sp.usl).length / n * 1e6;
    const sk = mean(vals.map(v => ((v - m) / so) ** 3)), ku = mean(vals.map(v => ((v - m) / so) ** 4)) - 3, normal = Math.abs(sk) < 1 && Math.abs(ku) < 3;
    // 비정규면 백분위 방식(ISO 22514-2): 0.135% · 50% · 99.865% 분위로 Ppk 를 다시 계산하고, 판정은 둘 중 낮은 값
    const q0 = ST().q(vals, 0.00135), q5 = ST().q(vals, 0.5), q9 = ST().q(vals, 0.99865), ppq = Math.min((sp.usl - q5) / Math.max(1e-9, q9 - q5), (q5 - sp.lsl) / Math.max(1e-9, q5 - q0));
    const idx = normal ? cpk : Math.min(cpk, ppq);
    return { id: proc + '|' + r.key, proc, key: r.key, label: r.label, unit: r.unit || '', d: r.d ?? 1, how, spec: sp, vals, n, ne, lots: groups.length, r1, mean: m, so, sw, cp, cpk, pp, ppk,
      cpCI, cpkCI: [cpk - bis(cpk), cpk + bis(cpk)], ppkCI: [ppk - bis(ppk), ppk + bis(ppk)], exp, obs, sk, ku, normal, ppq, idx };
  }
  const grade = c => c >= 1.33 ? ['j-ok', '충분'] : c >= 1 ? ['j-warn', '보통'] : ['j-danger', '부족'];
  const ci = (a, d = 2) => `<span class="ci">${f(a[0], d)}~${f(a[1], d)}</span>`;
  V.capa = () => {
    const xs = capaItems(); if (!xs.length) return '<div class="card"><div class="empty">공정능력을 계산할 데이터가 없습니다</div></div>';
    const c = xs.find(x => x.id === st.capa) || xs[0], g = grade(c.idx), low = xs.filter(x => x.idx < 1).length, ok = xs.filter(x => x.idx >= 1.33).length;
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">관리 항목</div><div class="val">${xs.length}<small>개</small></div><div class="foot">프레스 · 열처리 규격 보유 항목</div></div>
      <div class="kpi"><div class="lab">능력 충분 (≥ 1.33)</div><div class="val" style="color:var(--ok-ink)">${ok}<small>개</small></div><div class="foot">충분</div></div>
      <div class="kpi"><div class="lab">능력 부족 (&lt; 1.0)</div><div class="val" style="color:${low ? 'var(--danger-ink)' : 'inherit'}">${low}<small>개</small></div><div class="foot">개선 필요</div></div>
      <div class="kpi"><div class="lab">최저 능력 지수</div><div class="val">${f(Math.min(...xs.map(x => x.idx)), 2)}</div><div class="foot">${esc(xs.slice().sort((a, b) => a.idx - b.idx)[0].label)}</div></div>
    </div>
    <div class="grid capg" style="margin-top:16px">
      <div class="card"><h2>${esc(c.label)} <span class="h2sub">${esc(M.PROC[c.proc] || c.proc)} · ${esc(c.how)}</span><span class="more"><span class="tag ${g[0]}">${c.normal ? 'Cpk' : 'Ppk(백분위)'} ${f(c.idx, 2)} ${g[1]}</span></span></h2>
        ${hist(c, { d: c.d, h: 330 })}
        ${M.legend([['sw-bar', '측정값 분포'], ['sw-over', '규격 밖'], ['sw-s1', '정규 곡선 (전체 σ)'], ['sw-s2', '정규 곡선 (군내 σ)'], ['sw-ucl', '규격 한계']])}</div>
      <div class="card"><h2>능력 지수 <span class="h2sub">95% 신뢰구간</span></h2>
        <div class="tbx"><table class="tb ktab"><tbody>
          <tr><th>규격</th><td class="n">${f(c.spec.lsl, c.d)} ~ ${f(c.spec.usl, c.d)} <small>${esc(c.unit)}</small></td></tr>
          <tr><th>표본 n</th><td class="n">${f(c.n, 0)} <small>LOT ${c.lots} · 유효 ${f(c.ne, 0)}</small></td></tr>
          <tr><th>평균</th><td class="n">${f(c.mean, c.d + 1)}</td></tr>
          <tr><th>σ 군내 · 전체</th><td class="n">${f(c.sw, c.d + 2)} · ${f(c.so, c.d + 2)}</td></tr>
          <tr class="hl0"><th>Cp</th><td class="n"><b>${f(c.cp, 2)}</b> ${ci(c.cpCI)}</td></tr>
          <tr class="hl0"><th>Cpk</th><td class="n"><b>${f(c.cpk, 2)}</b> ${ci(c.cpkCI)}</td></tr>
          <tr><th>Pp</th><td class="n">${f(c.pp, 2)}</td></tr>
          <tr class="hl0"><th>Ppk</th><td class="n"><b>${f(c.ppk, 2)}</b> ${ci(c.ppkCI)}</td></tr>
          ${c.normal ? '' : `<tr class="hl0"><th>Ppk (백분위)</th><td class="n"><b>${f(c.ppq, 2)}</b> <small>비정규 → 판정 기준</small></td></tr>`}
          <tr><th>예상 · 실측 PPM</th><td class="n">${f(c.exp, 0)} · ${f(c.obs, 0)}</td></tr>
          <tr><th>정규성</th><td class="n">${c.normal ? '<span class="tag j-ok">근사 정규</span>' : '<span class="tag j-warn">비정규 — 해석 주의</span>'} <small>왜도 ${f(c.sk, 2)} · 첨도 ${f(c.ku, 2)}</small></td></tr>
        </tbody></table></div></div></div>
    <div class="card" style="margin-top:16px"><h2>항목별 공정능력 <span class="h2sub">행을 누르면 분포</span></h2>
      <div class="tbx"><table class="tb ptab2"><colgroup><col><col class="c-p"><col class="c-s"><col class="c-n"><col class="c-n"><col class="c-ci"><col class="c-n"><col class="c-ci"><col class="c-n"><col class="c-g"></colgroup>
        <thead><tr><th>항목</th><th>공정</th><th class="n">규격</th><th class="n">n</th><th class="n">Cp</th><th class="n">Cpk (95%)</th><th class="n">Pp</th><th class="n">Ppk (95%)</th><th class="n">예상 PPM</th><th>판정</th></tr></thead>
        <tbody>${xs.map(x => { const gg = grade(x.idx); return `<tr class="click ${x.id === c.id ? 'sel' : ''}" data-sx="capa|${esc(x.id)}"><td><b>${esc(x.label)}</b></td><td>${M.procTag(x.proc)}</td><td class="n">${f(x.spec.lsl, x.d)}~${f(x.spec.usl, x.d)}</td><td class="n">${f(x.n, 0)}</td><td class="n">${f(x.cp, 2)}</td><td class="n"><b>${f(x.cpk, 2)}</b> ${ci(x.cpkCI)}</td><td class="n">${f(x.pp, 2)}</td><td class="n"><b>${f(x.ppk, 2)}</b> ${ci(x.ppkCI)}</td><td class="n">${f(x.normal ? x.exp : x.obs, 0)}${x.normal ? '' : '<small class="muted"> 실측</small>'}</td><td><span class="tag ${gg[0]}">${gg[1]}</span>${x.normal ? '' : ' <span class="muted" title="비정규 — 백분위 Ppk 로 판정">*</span>'}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="note">Cp · Cpk = 군내 σ(LOT 안 산포) · Pp · Ppk = 전체 σ(LOT 간 차이 포함) — 둘의 차이가 크면 LOT 마다 중심이 흔들린다는 뜻. 판정 1.33 이상 충분 · 1.0 미만 부족 (* 비정규는 백분위 Ppk 와 Cpk 중 낮은 값). 프레스는 20타 평균값이라 개별 타발 산포보다 작게 나옵니다.</p></div>`;
  };

  // ═══ 3. 불량 층별 분석 (4M)
  const tercile = (L, fn, nm, unit, d) => { const v = L.map(fn).filter(x => x != null && isFinite(x)), a = ST().q(v, 1 / 3), b = ST().q(v, 2 / 3);
    return l => { const x = fn(l); return x == null || !isFinite(x) ? '미기록' : x <= a ? `① 낮음 (≤${f(a, d)}${unit})` : x <= b ? `② 중간` : `③ 높음 (>${f(b, d)}${unit})`; }; };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function dims(L) {
    const S0 = (M.CFG.SHIFT || {}).DAY_START ?? 8, SH = (M.CFG.SHIFT || {}).HOURS ?? 12, z = M.ml ? M.ml.heat().z : 'op2', hz = (H().heaters || []).find(h => h.key === z);
    return [
      ['shift', '교대', '사람', l => { const h = +String(l.start).slice(11, 13); return h >= S0 && h < S0 + SH ? '주간' : '야간'; }],
      ['worker', '작업자', '사람', l => l.worker || '미기록'],
      ['heater', `히터 출력 (${hz ? hz.label.replace('소입로 ', '') : z})`, '설비', tercile(L, l => (l.heater || {})[z], '', '%', 0)],
      ['dev', '조건 이탈', '설비', l => (M.heatDev ? M.heatDev(l) : 0) >= DEVR() ? '이탈 있음' : '정상'],
      ['mat', '원자재 LOT', '자재', l => l.mat_lot || '미기록'],
      ['load', '장입량', '방법', tercile(L, l => l.qty, '', '개', 0)],
      ['dow', '요일', '방법', l => DOW[M.toDate(l.start).getDay()] + '요일'],
    ];
  }
  const periodLots = per => { const L = sorted(); if (per === 'all') return L; const t = asofT() - (+per) * 86400000; return L.filter(l => M.toDate(l.end || l.start).getTime() >= t); };
  function groupBy(L, fn) {
    const g = {}; L.forEach(l => { const k = fn(l), x = g[k] = g[k] || { k, lots: 0, qty: 0, bad: 0, ppms: [], codes: {} }; x.lots++; x.qty += l.qty; x.bad += l.bad; x.ppms.push(l.bad / l.qty * 1e6); for (const c in l.defects || {}) x.codes[c] = (x.codes[c] || 0) + l.defects[c]; });
    return Object.values(g).map(x => Object.assign(x, { ppm: x.bad / x.qty * 1e6, ci: (c => ({ lo: c.lo * 1e6, hi: c.hi * 1e6 }))(garwood(x.bad, x.qty)) }));
  }
  // 층 사이 제곱합 순열 검정 (LOT PPM)
  function permF(L, fn, seed) {
    const y = L.map(l => l.bad / l.qty * 1e6), lab = L.map(fn), ks = [...new Set(lab)]; if (ks.length < 2) return NaN;
    const idx = lab.map(k => ks.indexOf(k)), m = mean(y), F = id => { const s = new Array(ks.length).fill(0), c = new Array(ks.length).fill(0); id.forEach((g, i) => { s[g] += y[i]; c[g]++; }); return s.reduce((a, v, g) => a + (c[g] ? c[g] * (v / c[g] - m) ** 2 : 0), 0); };
    const obs = F(idx), r = ST().rng(seed || 17), p = idx.slice(); let ge = 0; const N = 999;
    for (let k = 0; k < N; k++) { for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; } if (F(p) >= obs - 1e-9) ge++; }
    return (ge + 1) / (N + 1);
  }
  const strat = per => M.memo('strat', per, () => {
    const L = periodLots(per), D = dims(L), tot = { lots: L.length, qty: sum(L.map(l => l.qty)), bad: sum(L.map(l => l.bad)) }; tot.ppm = tot.qty ? tot.bad / tot.qty * 1e6 : 0;
    const rows = D.map(([k, t, m4, fn], i) => { const gs = groupBy(L, fn).sort((a, b) => b.bad - a.bad), big = gs.filter(g => g.lots >= 3), top = big.slice().sort((a, b) => b.ppm - a.ppm)[0], bot = big.slice().sort((a, b) => a.ppm - b.ppm)[0];
      return { k, t, m4, fn, gs, top, ratio: top && bot && bot.ppm > 0 ? top.ppm / bot.ppm : NaN, p: L.length > 10 ? permF(L, fn, 17 + i) : NaN }; });
    const ok = rows.filter(r => isFinite(r.p)); if (ok.length) ST().bh(ok.map(r => r.p)).forEach((q, i) => { ok[i].q = q; });
    const types = {}; L.forEach(l => { for (const c in l.defects || {}) types[c] = (types[c] || 0) + l.defects[c]; });
    const eq = {}; const t0 = per === 'all' ? 0 : asofT() - (+per) * 86400000;
    (M.S.lots || []).filter(l => l.kind === 'process' && l.bad != null && l.qty > 0 && M.toDate(l.end_at || l.start_at).getTime() >= t0).forEach(l => { const k = l.equipment_id || l.proc, x = eq[k] = eq[k] || { k, proc: l.proc, qty: 0, bad: 0 }; x.qty += l.qty; x.bad += l.bad; });
    return { L, tot, rows, types, eq: Object.values(eq).map(x => Object.assign(x, { ppm: x.bad / x.qty * 1e6 })).sort((a, b) => b.bad - a.bad) };
  });
  const sig = r => !isFinite(r.p) ? ['', '—'] : (r.q ?? r.p) < 0.05 ? ['j-danger', '차이 있음'] : r.p < 0.1 ? ['j-warn', '경향'] : ['j-ok', '차이 없음'];
  V.strat = () => {
    const R = strat(st.per); if (R.L.length < 10) return '<div class="card"><div class="empty">분석할 열처리 LOT 이 부족합니다</div></div>';
    const rs = R.rows.slice().sort((a, b) => (a.p || 1) - (b.p || 1)), best = rs[0], cur = R.rows.find(r => r.k === st.strat) || best, codes = Object.keys(R.types).sort((a, b) => R.types[b] - R.types[a]);
    const gs = cur.gs.length > 12 ? cur.gs.slice(0, 11).concat([(o => Object.assign(o, { ppm: o.bad / o.qty * 1e6, ci: (c => ({ lo: c.lo * 1e6, hi: c.hi * 1e6 }))(garwood(o.bad, o.qty)) }))(cur.gs.slice(11).reduce((o, g) => { o.lots += g.lots; o.qty += g.qty; o.bad += g.bad; for (const c in g.codes) o.codes[c] = (o.codes[c] || 0) + g.codes[c]; return o; }, { k: `기타 ${cur.gs.length - 11}개`, lots: 0, qty: 0, bad: 0, codes: {}, other: true }))]) : cur.gs;
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">분석 LOT</div><div class="val">${R.tot.lots}<small>LOT</small></div><div class="foot">열처리 · ${f(R.tot.qty, 0)}개</div></div>
      <div class="kpi"><div class="lab">불량</div><div class="val">${f(R.tot.bad, 0)}<small>개</small></div><div class="foot">평균 ${f(R.tot.ppm, 0)} PPM</div></div>
      <div class="kpi"><div class="lab">최다 유형</div><div class="val sm">${esc(CODE[codes[0]] || codes[0] || '—')}</div><div class="foot">${codes[0] ? pct(R.types[codes[0]] / (sum(Object.values(R.types)) || 1), 0) : ''}</div></div>
      <div class="kpi"><div class="lab">가장 유의한 층</div><div class="val sm" style="color:${sig(best)[0] === 'j-danger' ? 'var(--danger-ink)' : 'inherit'}">${esc(best.t)}</div><div class="foot">p = ${f(best.p, 3)}${best.q != null ? ` · q = ${f(best.q, 3)}` : ''}</div></div>
    </div>
    <div class="spc-sub" style="margin-top:12px">${M.seg('sx', 'per|' + st.per, [['per|all', '전체 기간'], ['per|90', '최근 90일'], ['per|30', '최근 30일']])}</div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h2>불량 유형 <span class="h2sub">열처리</span></h2>${pareto(codes.map(c => ({ x: CODE[c] || c, v: R.types[c] })), { w: 460, h: 200 })}</div>
      <div class="card"><h2>설비별 불량 <span class="h2sub">전 공정</span></h2>${pareto(R.eq.map(x => ({ x: x.k, v: x.bad })), { w: 460, h: 200 })}</div></div>
    <div class="card" style="margin-top:16px"><h2>층별 차이 검정 <span class="h2sub">행을 누르면 상세</span></h2>
      <div class="tbx"><table class="tb ptab2"><colgroup><col><col class="c-m4"><col class="c-n"><col><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-g"></colgroup>
        <thead><tr><th>층</th><th>4M</th><th class="n">수준</th><th>불량률 최고 수준</th><th class="n">최고 / 최저</th><th class="n">p</th><th class="n">q (BH)</th><th>판정</th></tr></thead>
        <tbody>${rs.map(r => { const s = sig(r); return `<tr class="click ${r.k === cur.k ? 'sel' : ''}" data-sx="strat|${r.k}"><td><b>${esc(r.t)}</b></td><td><span class="m4 m4-${esc(r.m4)}">${esc(r.m4)}</span></td><td class="n">${r.gs.length}</td><td>${r.top ? `${esc(r.top.k)} <small class="muted">${f(r.top.ppm, 0)} PPM</small>` : '—'}</td><td class="n">${isFinite(r.ratio) ? f(r.ratio, 2) + '배' : '—'}</td><td class="n">${f(r.p, 3)}</td><td class="n">${f(r.q, 3)}</td><td>${s[1] !== '—' ? `<span class="tag ${s[0]}">${s[1]}</span>` : '—'}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="note">LOT 별 불량률로 층 사이 차이를 순열 검정(999회). 여러 층을 동시에 보므로 q(BH 보정) &lt; 0.05 일 때만 «차이 있음».</p></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>${esc(cur.t)} — 불량 수 <span class="h2sub">파레토</span></h2>${pareto(gs.map(g => ({ x: g.k.replace(/ \(.*\)/, ''), v: g.bad, cls: g === cur.top ? 'over' : '' })), { w: 460, h: 240 })}</div>
      <div class="card"><h2>${esc(cur.t)} — 수준별 <span class="h2sub">PPM 95% 구간</span></h2>
        <div class="tbx"><table class="tb ptab2 lv"><colgroup><col><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-ci2"><col class="c-n"><col class="c-n"></colgroup>
          <thead><tr><th>수준</th><th class="n">LOT</th><th class="n">불량</th><th class="n">PPM</th><th class="n">95% 구간</th>${codes.slice(0, 2).map(c => `<th class="n">${esc(CODE[c] || c)}</th>`).join('')}</tr></thead>
          <tbody>${gs.map(g => `<tr class="${g === cur.top ? 'hl' : ''}"><td>${esc(g.k)}</td><td class="n">${g.lots}</td><td class="n">${f(g.bad, 0)}</td><td class="n"><b>${f(g.ppm, 0)}</b></td><td class="n"><span class="ci">${f(g.ci.lo, 0)}~${f(g.ci.hi, 0)}</span></td>${codes.slice(0, 2).map(c => `<td class="n">${f(g.codes[c] || 0, 0)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></div>`;
  };

  // ═══ 4. 예측 모델 검증
  const val = () => M.memo('mval', '', () => {
    const ML = M.ml, out = {};
    // 열처리 불량 — 앞 70% 학습, 뒤 30% 예측
    try {
      const m = ML.heat(), ls = H().lots.filter(l => l.qty > 0), cut = Math.floor(ls.length * 0.7), tr = ls.slice(0, cut), te = ls.slice(cut);
      const g = ST().poissonGLM(tr.map(m.xOf), tr.map(l => l.bad), tr.map(l => Math.log(l.qty))), th = CLAIM(), base = sum(tr.map(l => l.bad)) / sum(tr.map(l => l.qty)) * 1e6;
      const dev = (y, mu) => 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu));
      const rows = te.map(l => { const mu = g.predict(m.xOf(l), Math.log(l.qty)); let up = 0; while (ST().nbTail(mu, g.phi, up) > 0.1 && up < 1e5) up++;
        const T = Math.floor(th * l.qty / 1e6), pE = ST().nbTail(mu, g.phi, T); return { id: l.id, pred: mu / l.qty * 1e6, act: l.ppm, hit: l.bad <= up, pE, y: l.bad > T ? 1 : 0, dv: dev(l.bad, mu), dv0: dev(l.bad, base / 1e6 * l.qty) }; });
      const pE0 = tr.filter(l => l.bad > Math.floor(th * l.qty / 1e6)).length / tr.length;
      const mae = mean(rows.map(r => Math.abs(r.pred - r.act))), mae0 = mean(rows.map(r => Math.abs(base - r.act))), brier = mean(rows.map(r => (r.pE - r.y) ** 2)), brier0 = mean(rows.map(r => (pE0 - r.y) ** 2));
      const pos = rows.filter(r => r.y), neg = rows.filter(r => !r.y), auc = pos.length && neg.length ? sum(pos.map(p => sum(neg.map(q => p.pE > q.pE ? 1 : p.pE === q.pE ? 0.5 : 0)))) / (pos.length * neg.length) : NaN;
      out.heat = { rows, mae, mae0, skill: 1 - sum(rows.map(r => r.dv)) / sum(rows.map(r => r.dv0)), maeSkill: 1 - mae / mae0, cover: mean(rows.map(r => r.hit ? 1 : 0)), brier, brier0, auc, th, ntr: tr.length, nte: te.length, pos: pos.length };
    } catch (e) { console.warn('[mval heat]', e); }
    try { const t = ML.tool(); out.tool = { ev: t.ev, cover: t.cover, mae: mean(t.ev.map(e => Math.abs(e.r.t50 - e.r.cross))) }; } catch (e) { console.warn(e); }
    try { const MC = M.S.mach || { runs: [] }, rows = MC.runs.filter(r => r.vb != null && r.vb > 0 && r.vb_est != null), tools = [...new Set(rows.map(r => r.tool))], test = rows.filter(r => tools.indexOf(r.tool) % 2 === 1), v = ML.vb(), e = test.map(r => r.vb_est - r.vb);
      out.vb = { pts: test.map(r => ({ x: r.vb_est, y: r.vb, t: `${r.tool} ${r.t}`, cls: Math.abs(r.vb_est - r.vb) > v.q ? 'bad' : 'soft' })), q: v.q, cover: v.cover, mae: mean(e.map(Math.abs)), rmse: Math.sqrt(mean(e.map(x => x * x))), bias: mean(e), n: test.length }; } catch (e) { console.warn(e); }
    try { out.demand = ML.demandBT ? ML.demandBT() : null; } catch (e) { console.warn(e); }
    return out;
  });
  const VS = { ok: ['j-ok', '검증 통과'], warn: ['j-warn', '기준 미달'], none: ['j-none', '미검증'] };
  const mvRows = () => { const v = val(), d = v.demand;
    return [
      { k: 'heat', name: '열처리 LOT 불량 예측', how: '앞 70% 학습 → 뒤 30% 예측', n: v.heat ? `${v.heat.nte} LOT` : '—', metric: v.heat ? `90% 상한 적중 ${pct(v.heat.cover, 0)} · 이탈도 개선 ${v.heat.skill >= 0 ? '' : '−'}${pct(Math.abs(v.heat.skill), 0)}` : '—', goal: '적중 90% · 기준선보다 개선', st: v.heat ? (Math.abs(v.heat.cover - 0.9) <= 0.1 && v.heat.skill > 0 ? 'ok' : 'warn') : 'none' },
      { k: 'tool', name: '공구 잔여 수명', how: '공구 하나씩 빼고 예측 (처음 3회 측정)', n: v.tool ? `${v.tool.ev.length} 공구` : '—', metric: v.tool ? `80% 구간 적중 ${pct(v.tool.cover, 0)} · 중앙값 오차 ${f(v.tool.mae, 0)}분` : '—', goal: '적중 80%', st: v.tool ? (Math.abs(v.tool.cover - 0.8) <= 0.1 ? 'ok' : 'warn') : 'none' },
      { k: 'vb', name: 'VB 센서 추정', how: '공구 절반 보정 → 나머지 절반 시험', n: v.vb ? `${v.vb.n}회 측정` : '—', metric: v.vb ? `90% 구간 적중 ${pct(v.vb.cover, 0)} · MAE ${f(v.vb.mae, 3)}mm` : '—', goal: '적중 90% · 오차 폭 ≤ 0.10mm', st: v.vb ? (v.vb.cover >= 0.85 && v.vb.q <= 0.1 ? 'ok' : 'warn') : 'none' },
      { k: 'demand', name: '수요 예측', how: '1일 앞 롤링 예측 (과거만 사용)', n: d ? `${d.n}일 × ${d.items.length}품목` : '—', metric: d ? `MAPE ${pct(d.mape, 0)} · 90% 구간 적중 ${pct(d.cover, 0)}` : '—', goal: '적중 90% · 직전값보다 개선', st: d ? (Math.abs(d.cover - 0.9) <= 0.1 && d.skill > 0 ? 'ok' : 'warn') : 'none' },
      { k: 'heater', name: '히터 출력 변화점', how: '정답 기록 없음', n: '—', metric: '보전 이력(히터 교체 · 점검)과 대조 필요', goal: '검출 지연 · 오경보율', st: 'none' },
      { k: 'insp', name: '검사 판정 점검', how: '규칙 기반 (센서 고착 · 이중 기록)', n: '—', metric: '오판 라벨 없음 — 재검 결과 축적 필요', goal: '정밀도 · 재현율', st: 'none' },
      { k: 'line', name: '라인 산출 시뮬레이션', how: '몬테카를로 (가정 분포)', n: '—', metric: '실제 일 산출과 비교 기록 미축적', goal: '80% 구간 적중', st: 'none' },
    ]; };
  V.mval = () => {
    const v = val(), rows = mvRows(), cur = st.mv, n = s => rows.filter(r => r.st === s).length;
    let detail = '';
    if (cur === 'heat' && v.heat) { const h = v.heat;
      detail = `<div class="grid mvg"><div><h3 class="dh" style="margin-top:0">예측 대 실제 <span class="h2sub">시험 ${h.nte} LOT · PPM</span></h3>${scatter(h.rows.map(r => ({ x: r.pred, y: r.act, t: `${r.id} 예측 ${f(r.pred, 0)} · 실제 ${f(r.act, 0)}`, cls: r.hit ? 'soft' : 'bad' })), { lo: 0, ref: h.th, xl: '예측 PPM', yl: '실제 PPM' })}</div>
        <div><h3 class="dh" style="margin-top:0">오차 지표</h3><div class="tbx"><table class="tb ktab"><tbody>
          <tr><th>학습 · 시험</th><td class="n">${h.ntr} · ${h.nte} LOT</td></tr>
          <tr><th>MAE (PPM)</th><td class="n"><b>${f(h.mae, 0)}</b> <small>기준선 ${f(h.mae0, 0)}</small></td></tr>
          <tr><th>이탈도 개선</th><td class="n">${h.skill >= 0 ? '<b>' + pct(h.skill, 0) + '</b> <small>기준선 대비</small>' : '<span class="ng">−' + pct(-h.skill, 0) + '</span> <small>기준선보다 나쁨</small>'}</td></tr>
          <tr><th>90% 상한 적중</th><td class="n"><b>${pct(h.cover, 0)}</b> <small>목표 90%</small></td></tr>
          <tr><th>${h.th} PPM 초과 Brier</th><td class="n"><b>${f(h.brier, 3)}</b> <small>기준선 ${f(h.brier0, 3)}</small></td></tr>
          <tr><th>AUC</th><td class="n">${isFinite(h.auc) ? `<b>${f(h.auc, 2)}</b>` : '—'} <small>초과 ${h.pos} LOT</small></td></tr></tbody></table></div>
          <p class="note">기준선 = 학습 기간 평균 PPM 을 모든 LOT 에 그대로 쓴 예측. 이탈도 = 포아송 이탈도(불량 수 예측의 표준 오차 척도). 빨간 점 = 90% 상한을 넘은 LOT.</p></div></div>`; }
    if (cur === 'tool' && v.tool) { const ev = v.tool.ev, mx = Math.max(...ev.map(e => Math.max(e.r.t90, e.r.cross))) * 1.05 || 1;
      detail = `<h3 class="dh" style="margin-top:0">80% 예측 구간 대 실제 수명 <span class="h2sub">분</span></h3><div class="ivl">${ev.map(e => `<div class="iv"><span>${esc(e.id)}</span><div><i class="rg" style="left:${e.r.t10 / mx * 100}%;width:${Math.max(0.5, (e.r.t90 - e.r.t10) / mx * 100)}%"></i><i class="md" style="left:${e.r.t50 / mx * 100}%"></i><i class="ac ${e.hit ? '' : 'miss'}" style="left:${e.r.cross / mx * 100}%" title="실제 ${f(e.r.cross, 0)}분"></i></div><b class="${e.hit ? '' : 'ng'}">${f(e.r.cross, 0)}분</b></div>`).join('')}</div>
        ${M.legend([['sw-rg', '80% 구간'], ['sw-md', '예측 중앙값'], ['sw-ac', '실제 도달'], ['sw-bad', '구간 밖']])}`; }
    if (cur === 'vb' && v.vb) { const b = v.vb;
      detail = `<div class="grid mvg"><div><h3 class="dh" style="margin-top:0">추정 대 실측 <span class="h2sub">mm</span></h3>${scatter(b.pts, { lo: 0, band: b.q, d: 2, xl: '센서 추정 VB', yl: '실측 VB' })}</div>
        <div><h3 class="dh" style="margin-top:0">오차 지표</h3><div class="tbx"><table class="tb ktab"><tbody>
          <tr><th>시험 측정</th><td class="n">${b.n}회</td></tr><tr><th>MAE</th><td class="n"><b>${f(b.mae, 3)}</b> mm</td></tr><tr><th>RMSE</th><td class="n">${f(b.rmse, 3)} mm</td></tr>
          <tr><th>평균 편향</th><td class="n">${b.bias >= 0 ? '+' : ''}${f(b.bias, 3)} mm</td></tr><tr><th>90% 오차 폭</th><td class="n"><b>± ${f(b.q, 3)}</b> mm</td></tr><tr><th>적중</th><td class="n">${pct(b.cover, 0)} <small>목표 90%</small></td></tr></tbody></table></div></div></div>`; }
    if (cur === 'demand' && v.demand) { const d = v.demand, it = d.items.find(x => x.code === st.dm) || d.items[0];
      detail = `<div class="spc-sub">${M.seg('sx', 'dm|' + it.code, d.items.map(x => ['dm|' + x.code, x.name]))}</div>
        <div class="grid mvg"><div>${M.lineChart([{ v: it.act, cls: 's4' }, { v: it.pred, cls: 's1' }], null, { h: 230, d: 0, xlab: [[0, it.days[0].slice(5)], [it.days.length - 1, it.days[it.days.length - 1].slice(5)]] })}${M.legend([['sw-s4', '실제 수주'], ['sw-s1', '1일 앞 예측']])}</div>
        <div><div class="tbx"><table class="tb ktab"><tbody><tr><th>예측 일수</th><td class="n">${it.n}일</td></tr><tr><th>MAE</th><td class="n"><b>${f(it.mae, 1)}</b> <small>직전값 ${f(it.mae0, 1)}</small></td></tr><tr><th>MAPE</th><td class="n">${pct(it.mape, 0)}</td></tr><tr><th>90% 구간 적중</th><td class="n"><b>${pct(it.cover, 0)}</b></td></tr></tbody></table></div></div></div>`; }
    if (['heater', 'insp', 'line'].includes(cur)) { const r = rows.find(x => x.k === cur); detail = `<div class="unv"><span class="tag j-none">미검증</span><div><b>${esc(r.name)}</b><div class="muted">${esc(r.metric)}</div></div></div>`; }
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">모델</div><div class="val">${rows.length}<small>개</small></div><div class="foot">판단에 쓰는 예측</div></div>
      <div class="kpi"><div class="lab">검증 통과</div><div class="val" style="color:var(--ok-ink)">${n('ok')}<small>개</small></div><div class="foot">학습에 안 쓴 데이터 기준</div></div>
      <div class="kpi"><div class="lab">기준 미달</div><div class="val" style="color:${n('warn') ? 'var(--warn-ink)' : 'inherit'}">${n('warn')}<small>개</small></div><div class="foot">판단 화면에 주의 표시</div></div>
      <div class="kpi"><div class="lab">미검증</div><div class="val" style="color:${n('none') ? 'var(--muted)' : 'inherit'}">${n('none')}<small>개</small></div><div class="foot">참고용으로만 표시</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>모델별 검증 결과 <span class="h2sub">행을 누르면 상세</span><a class="more" href="#" data-go="models">AI 모델 상태 →</a></h2>
      <div class="tbx"><table class="tb ptab2 wr"><colgroup><col class="c-mn"><col class="c-how"><col class="c-s"><col><col class="c-goal"><col class="c-g"></colgroup>
        <thead><tr><th>모델</th><th>검증 방법</th><th class="n">시험 표본</th><th>결과</th><th>기준</th><th>상태</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="click ${r.k === cur ? 'sel' : ''} ${r.st === 'none' ? 'dim' : ''}" data-sx="mv|${r.k}"><td><b>${esc(r.name)}</b></td><td class="muted">${esc(r.how)}</td><td class="n">${esc(r.n)}</td><td>${esc(r.metric)}</td><td class="muted">${esc(r.goal)}</td><td><span class="tag ${VS[r.st][0]}">${VS[r.st][1]}</span></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h2>${esc((rows.find(r => r.k === cur) || rows[0]).name)} <span class="h2sub">예측 대 실제</span></h2>${detail || '<div class="empty">검증 데이터가 없습니다</div>'}</div>`;
  };

  // ═══ 5. 이슈 분석 보고서 (품질 이슈 상세에 끼움)
  function caseAnalysis(c) {
    if (c.tpl !== 'heat') return null;
    return M.memo('spc.case', c.id, () => {
      const D = spcData('heat'), viol = judge(D.x, D.cl, D.s), from = Math.max(0, D.n - 40), rec = [...viol.keys()].filter(i => i >= from).sort((a, b) => a - b);
      const first = rec[0], fd = first != null ? D.day(first) : null, od = String(c.opened || '').slice(0, 10), lead = fd && od ? Math.round((new Date(od) - new Date(fd)) / 86400000) : null;
      const L = sorted(), recent = L.slice(from), rq = sum(recent.map(l => l.qty)), rb = sum(recent.map(l => l.bad)), ppmNow = rq ? rb / rq * 1e6 : 0;
      const S = strat('all'), top = S.rows.slice().sort((a, b) => (a.p || 1) - (b.p || 1)), sigRow = top.find(r => (r.q ?? r.p) < 0.05);
      const causes = c.causes.slice(0, 3), eff = M.ml ? M.ml.heat().effects : [], effSig = eff.filter(e => e.lo > 1 || e.hi < 1);
      const mPer = rb / Math.max(1, recent.length), nEff = M.st.poissonN(mPer, mPer * 0.7);
      const lines = [
        rec.length ? `관리도: 최근 ${D.n - from} LOT 중 이상 ${rec.length}점 — 첫 이상 ${D.when(first)} (${D.lab(first)})${lead != null && lead > 0 ? `, 이슈 등록보다 ${lead}일 먼저` : ''}` : `관리도: 최근 ${D.n - from} LOT 모두 관리 한계 안 — 우연 변동 범위`,
        sigRow ? `층별: «${sigRow.t}» 수준 사이 차이 유의 (p = ${f(sigRow.p, 3)}, q = ${f(sigRow.q, 3)})` : `층별: 유의한 층 없음 (가장 낮은 p = ${f(top[0] && top[0].p, 3)} «${top[0] ? top[0].t : ''}») — 사람 · 자재 · 시간대로는 갈리지 않음`,
        causes[0] ? `원인 후보: «${causes[0].t}» 연관성 ${M.dx.STRENGTH[causes[0].strength][1]}${causes[0].cmp && causes[0].cmp.p != null ? ` (p = ${f(causes[0].cmp.p, 3)})` : ''} — 확정 전 확인 실험 필요` : '원인 후보 없음',
      ];
      return { D, viol, from, rec, first, lead, ppmNow, top: top.slice(0, 4), sigRow, causes, eff, effSig, nEff, lines };
    });
  }
  function caseReport(c) {
    const A = caseAnalysis(c); if (!A) return '';
    const T = (M.S.heat || {}).target_ppm || 450, step = (n, t, body) => `<div class="ar-s"><span class="ar-n">${n}</span><div class="ar-t">${t}</div><div class="ar-b">${body}</div></div>`;
    return `<div class="arpt"><h3 class="dh">분석 보고서 <span class="h2sub">관리도 → 층별 → 검정 → 결론</span><span class="more" style="display:flex;gap:10px"><a href="#" data-go="spc">SPC 관리도 →</a><a href="#" data-go="strat">층별 분석 →</a></span></h3>
      ${step(1, '문제 정의', `최근 ${A.D.n - A.from} LOT 불량률 <b>${f(A.ppmNow, 0)} PPM</b> <span class="muted">(목표 ${f(T, 0)} · 고객 기준 ${CLAIM()})</span> · 대상 LOT ${c.lots.length}개 · ${f(c.qty || 0, 0)}개`)}
      ${step(2, '관리도', `${cchart(A.D, { viol: A.viol, from: A.from, h: 150, lab: A.D.lab, xlab: xlabOf(A.D, A.from) })}<div class="ar-l">${esc(A.lines[0])}</div>`)}
      ${step(3, '층별 분석 (4M)', `<div class="tbx"><table class="tb ptab2 mini"><colgroup><col><col class="c-m4"><col><col class="c-n"><col class="c-g"></colgroup><thead><tr><th>층</th><th>4M</th><th>불량률 최고</th><th class="n">p</th><th>판정</th></tr></thead><tbody>${A.top.map(r => `<tr><td>${esc(r.t)}</td><td><span class="m4 m4-${esc(r.m4)}">${esc(r.m4)}</span></td><td>${r.top ? `${esc(r.top.k)} <small class="muted">${f(r.top.ppm, 0)}</small>` : '—'}</td><td class="n">${f(r.p, 3)}</td><td><span class="tag ${sig(r)[0]}">${sig(r)[1]}</span></td></tr>`).join('')}</tbody></table></div><div class="ar-l">${esc(A.lines[1])}</div>`)}
      ${step(4, '원인 검정', `<div class="tbx"><table class="tb ptab2 mini"><colgroup><col><col class="c-n"><col class="c-n"><col class="c-ci2"></colgroup><thead><tr><th>후보</th><th class="n">p</th><th class="n">q</th><th class="n">배수 90% 구간</th></tr></thead><tbody>
        ${A.causes.map(x => `<tr><td>${esc(x.t)}</td><td class="n">${x.cmp && x.cmp.p != null ? f(x.cmp.p, 3) : '—'}</td><td class="n">${x.q != null ? f(x.q, 3) : '—'}</td><td class="n">${x.cmp && x.cmp.lo != null ? `<span class="ci">${f(x.cmp.lo, 2)}~${f(x.cmp.hi, 2)}</span>` : '—'}</td></tr>`).join('')}
        ${A.eff.map(e => `<tr><td>모델 효과 · ${esc(e.name)}</td><td class="n">—</td><td class="n">—</td><td class="n"><span class="ci ${e.lo > 1 || e.hi < 1 ? 'sig' : ''}">${f(e.lo, 2)}~${f(e.hi, 2)}</span></td></tr>`).join('')}</tbody></table></div><div class="ar-l">${esc(A.lines[2])}</div>`)}
      ${step(5, '결론', `<ul class="plain ar-c">${A.lines.map(t => `<li>${esc(t)}</li>`).join('')}${A.effSig.length ? `<li>모델: ${A.effSig.map(e => `«${esc(e.name)}» 배수 ${f(e.rr, 2)}`).join(' · ')} — 구간이 1을 벗어남</li>` : '<li>모델: 구간이 1을 포함 — 단일 요인으로 설명되지 않음</li>'}</ul>`)}
      ${step(6, '조치 · 효과 검증', `${c.experiment && c.experiment.n ? `확인 실험 <b>A/B 각 ${c.experiment.n}작업</b> («${esc(c.experiment.cause)}», 유의수준 5% · 검출력 80%) · ` : ''}조치 후 <b>${isFinite(A.nEff) ? A.nEff : '—'} LOT</b> 동안 관리 한계 안 + 불량률 30% 감소를 검정 (같은 관리도로 추적)`)}
    </div>`;
  }
  const caseLines = c => { const A = caseAnalysis(c); return A ? A.lines : []; };

  M.spc = { judge, episodes, spcData, capaItems, strat, val, mvRows, caseReport, caseLines, caseAnalysis, RULES };
  M.mod({
    id: 'spc', group: '분석', order: 5.6,
    menu: [['spc', 'SPC 관리도', 'trend'], ['capa', '공정능력', 'gauge'], ['strat', '불량 층별 분석', 'list'], ['mval', '예측 모델 검증', 'check']],
    views: V,
    bind(root) { root.querySelectorAll('[data-sx]').forEach(b => b.onclick = e => { e.preventDefault(); const s = b.dataset.sx, i = s.indexOf('|'); st[s.slice(0, i)] = s.slice(i + 1); M.render(); }); },
  });
})();
