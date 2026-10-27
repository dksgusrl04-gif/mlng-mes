/* 3.0 ④ — What-if 샌드박스 (바꿔 보고 결정한다)
 * ───────────────────────────────────────────────────────────────
 * 라인 운영 모델(공정별 능력·수율) + 프레스 속도-불량 관계 + 공구 마모 속도 + 히터 전력 + 탄소 + 고객 품질 협정 기준을 한 번에 엮는다.
 * 손잡이를 움직이면 하루 산출 · 병목 · 돈(공헌이익 − 손실 − 비용) · 탄소 · 계약 충족이 같이 바뀐다.
 *   프레스 속도 → 하루 타발 수 → 불량률 (데이터 회귀, 상관계수 표시)
 *   교체 기준 VB → 공구 1세트 가공 부품 수(마모 속도 데이터) → 인서트 비용  vs  마모 구간 가공 부품의 불량 위험
 *   히터 정비 → 출력 증가분 전력 · 탄소 절감 vs 점검비
 * 「최적 찾기」 는 품질 협정 기준을 지키는 조합 중 하루 판단 이익이 가장 큰 것을 찾는다 (격자 탐색 840가지).
 */
(function () {
  'use strict';
  const M = window.MLNG, DX = M.dx, { esc, f, pct } = M;
  const QL = 0.5, WARN = () => (M.CFG.MACH || {}).VB_WARN || 0.35;
  const XC = () => Object.assign({ WELD_UNIT_DAY: 180000, OT_HOUR: 60000, DEV_CTRL: 15000 }, M.CFG.COST || {});
  // 열처리 조건(설정값) 관리: 조건 이탈 작업과 정상 작업의 불량률 차이(데이터) → 이탈 비율을 줄이면 불량률이 얼마나 내려가나
  const DEVR = () => (M.CFG.HEAT || {}).DEVIATION_RATE || 0.05;
  function heatFit() { const all = (M.S.heat || {}).lots || [], dv = l => M.heatDev ? M.heatDev(l) >= DEVR() : false, A = all.filter(dv), B = all.filter(l => !dv(l)), mean = x => x.length ? x.reduce((t, l) => t + l.ppm, 0) / x.length : 0;
    const rec = all.slice(-30); return { ppmD: mean(A), ppmN: mean(B), share: rec.length ? rec.filter(dv).length / rec.length : 0, nD: A.length, nN: B.length }; }
  let S = null, saved = [], best = null, msg = '';
  const defaults = () => { const m = M.lineApi.model(); return { target: Math.round(m.target / 100) * 100, press: 100, weld: 1, heat: 100, vb: (M.CFG.MACH || {}).VB_LIMIT || 0.5, heater: false, dev: Math.round(heatFit().share * 100) }; };

  // 프레스: 하루 타발 수 → 불량률 (최소제곱)
  function pressFit() {
    const ls = ((M.S.press || {}).lots || []).filter(l => l.strokes), n = ls.length; if (n < 3) return null;
    const mx = ls.reduce((s, l) => s + l.strokes, 0) / n, my = ls.reduce((s, l) => s + l.ppm, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; ls.forEach(l => { sxy += (l.strokes - mx) * (l.ppm - my); sxx += (l.strokes - mx) ** 2; syy += (l.ppm - my) ** 2; });
    const b = sxx ? sxy / sxx : 0; return { a: my - b * mx, b, mx, my, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0, n };
  }
  // 공구: 교체 기준 VB 까지 1세트(6날)로 가공하는 부품 수 · 마모 구간 비율
  function toolFit(vb) {
    const md = M.S.mach || { tools: [] }, ppr = md.parts_per_run || 25;
    const per = md.tools.filter(t => t.rate && t.runs).map(t => { const mpr = t.minutes / t.runs, life = vb / t.rate; return life / mpr * ppr; }).filter(x => isFinite(x) && x > 0);
    const parts = M.median(per) || 100, w = WARN();
    const shWarn = vb <= w ? 0 : (Math.min(vb, QL) - w) / vb, shOver = vb <= QL ? 0 : (vb - QL) / vb;   // 선형 마모 가정
    return { parts, shWarn, shOver };
  }
  const heatHrs = () => { const ls = ((M.S.heat || {}).lots || []).filter(l => M.toDate(l.end).getTime() >= M.sinceDay(7).getTime()); const d = new Set(ls.map(l => String(l.end).slice(0, 10))).size || 1; return ls.reduce((s, l) => s + (l.dur_h || 0), 0) / d; };
  function basePcf() { const T = window.MLNGTrust; if (!T || !T.pcf) return null; const v = ((M.S.heat || {}).lots || []).slice(-10).map(l => T.pcf(l.id)).filter(Boolean); return v.length ? { g: v.reduce((s, x) => s + x.total, 0) / v.length * 1000, heatG: v.reduce((s, x) => s + x.part['열처리'], 0) / v.length * 1000 } : null; }

  function compute(s) {
    const c = DX.C(), x = XC(), m = M.lineApi.model(), b = m.b, fac = m.fac;
    const mult = { press: s.press / 100, weld: s.weld, heat: s.heat / 100 };
    const caps = ['press', 'weld', 'heat'].map(p => ({ p, t: b[p].cap && fac[p] ? b[p].cap * mult[p] / fac[p] : Infinity }));
    const lim = caps.reduce((a, y) => y.t < a.t ? y : a), out = Math.max(0, Math.min(s.target, lim.t));
    const pf = pressFit(), strokes = pf ? pf.mx * s.press / 100 : 0, ppmP = pf ? Math.max(0, pf.a + pf.b * strokes) : 0;
    const hl = ((M.S.heat || {}).lots || []).slice(-30), ppm30 = hl.length ? hl.reduce((t, l) => t + l.ppm, 0) / hl.length : 0, hf = heatFit(), d0 = Math.round(hf.share * 100);
    const ppmH = Math.max(0, ppm30 + (hf.ppmD - hf.ppmN) * ((s.dev ?? d0) - d0) / 100), devCost = Math.max(0, d0 - (s.dev ?? d0)) * x.DEV_CTRL;
    const scrap = out * fac.press * ppmP / 1e6 * c.SCRAP.press + out * fac.heat * ppmH / 1e6 * c.SCRAP.heat;
    const machParts = out * (fac.mach || 0), tf = toolFit(s.vb), inserts = machParts / tf.parts * 6, toolCost = inserts * c.INSERT;
    const wearRisk = machParts * (tf.shWarn * c.OVERWEAR_DEFECT * 0.25 + tf.shOver * c.OVERWEAR_DEFECT) * c.SCRAP.mach;
    const weldCost = (s.weld - 1) * x.WELD_UNIT_DAY, hrs = heatHrs(), ot = Math.max(0, s.heat / 100 - 1) * hrs * x.OT_HOUR;
    const hw = DX.heaterWaste(), wasteKwh = hw.reduce((t, y) => t + y.kwh, 0) * (s.heat / 100), energy = s.heater ? 0 : wasteKwh * c.KWH, maint = s.heater ? c.MAINT / 30 : 0;
    const bp = basePcf(), heatParts = out * fac.heat || 1, pcfG = bp ? bp.g - (s.heater && bp ? wasteKwh * ((M.CFG.PCF || {}).EF_KWH || 0.4594) * 1000 / heatParts : 0) : null;
    // 클레임 기대 비용: 최근 30 LOT 불량률을 시나리오 비율만큼 옮겼을 때 계약 기준을 넘는 LOT 비율 × 하루 출하 LOT 수 × 클레임 1건 비용
    const so0 = DX.activeSO(), th = so0 && (so0.clauses.find(y => y.k === 'heat_ppm') || {}).v, sc = ppm30 ? ppmH / ppm30 : 1;
    const lotsDay = hl.length ? hl.length / Math.max(1, new Set(hl.map(l => String(l.end).slice(0, 10))).size) : 0, avgQ = hl.length ? hl.reduce((t, l) => t + l.qty, 0) / hl.length : 0;
    const pOver = th && hl.length ? hl.filter(l => l.ppm * sc > th).length / hl.length : 0, claimExp = pOver * lotsDay * DX.claimCost(avgQ) * (out / (M.lineApi.model().target || out || 1));
    const contrib = out * c.MARGIN, profit = contrib - scrap - toolCost - wearRisk - weldCost - ot - energy - maint - devCost - claimExp;
    const so = DX.activeSO(), checks = [];
    if (so) so.clauses.forEach(cl => {
      if (cl.k === 'heat_ppm') checks.push({ t: '열처리 불량률', v: f(ppmH, 0) + ' PPM', th: `${cl.op} ${cl.v}`, ok: ppmH <= cl.v });
      if (cl.k === 'press_cpk') { const ls = ((M.S.press || {}).lots || []).slice(-5), v = Math.min(...ls.map(l => Math.min(...Object.values(l.stats || {}).map(y => y.cpk).filter(y => y != null)))); checks.push({ t: '프레스 Cpk (최근 5일 최저)', v: f(v, 2), th: `${cl.op} ${cl.v}`, ok: v >= cl.v }); }
      if (cl.k === 'pcf' && pcfG != null) checks.push({ t: '부품 1개당 탄소', v: f(pcfG, 0) + ' g', th: `${cl.op} ${cl.v}`, ok: pcfG <= cl.v });
    });
    return { pOver, claimExp, hf, devCost, s, out, lim, caps, ppmP, ppmH, pf, strokes, scrap, machParts, tf, inserts, toolCost, wearRisk, weldCost, ot, energy, maint, wasteKwh, pcfG, contrib, profit, checks, ok: checks.every(y => y.ok), revenue: out * c.PRICE };
  }
  // 손잡이로 바뀌지 않는 조항(지금도 위반)은 제약에서 빼고, «새로 위반» 이 생기지 않는 조합만 고른다
  const feasible = (r, B) => r.checks.every(c => c.ok || (B.checks.find(x => x.t === c.t) || { ok: true }).ok === false);
  function optimize() {
    const base = S || defaults(), B0 = compute(defaults()); let top = null;
    [80, 90, 100, 110, 120].forEach(press => [1, 2, 3].forEach(weld => [90, 100, 110, 120].forEach(heat => [0.3, 0.35, 0.4, 0.45, 0.5].forEach(vb => [false, true].forEach(heater => [0, 5, 10, 20, null].forEach(dev => {   // 품질 기준 VB 0.5 초과는 탐색하지 않는다 (품질은 거래 대상이 아님)
      const d0 = defaults(), r = compute(Object.assign({}, base, { press, weld, heat, vb, heater, dev: dev == null ? d0.dev : Math.min(dev, d0.dev) }));
      r.score = r.profit - ['press', 'weld', 'heat', 'vb', 'heater', 'dev'].filter(k => r.s[k] !== d0[k]).length * 1000;   // 같은 이익이면 덜 바꾸는 쪽
      if (feasible(r, B0) && (!top || r.score > top.score)) top = r; }))))));
    return top;
  }
  M.whatifApi = { compute: p => compute(Object.assign(defaults(), p || {})), preset: p => { S = Object.assign(S || defaults(), p || {}); best = null; msg = ''; }, optimize, defaults };

  const NAMES = { target: '목표 산출 (개/일)', press: '프레스 속도', weld: '점용접기 대수', heat: '열처리 가동', vb: '공구 교체 기준 VB', heater: '소입로 히터 정비', dev: '열처리 조건 이탈 비율' };
  const fmtS = (k, v) => k === 'press' || k === 'heat' ? v + '%' : k === 'weld' ? v + '대' : k === 'vb' ? f(v, 2) + ' mm' : k === 'heater' ? (v ? '함' : '안 함') : k === 'dev' ? v + '%' : f(v, 0);
  const dv = (a, b, d = 0, good = 1) => { const x = a - b; if (Math.abs(x) < Math.pow(10, -d) / 2) return '<span class="muted">—</span>'; const up = x > 0; return `<span style="color:${(up ? good : -good) > 0 ? 'var(--ok)' : 'var(--danger-ink)'}">${up ? '+' : ''}${d === 'won' ? DX.wonShort(x) : f(x, d)}</span>`; };
  const V = {};
  V.whatif = () => {
    if (!M.lineApi) return '<div class="empty">라인 운영 모듈이 없습니다</div>';
    S = S || defaults();
    const B = compute(defaults()), R = compute(S), nm = p => M.PROC[p] || p;
    // 4.0 몬테카를로: 공정별 하루 실적의 흔들림을 2,000번 뽑아 «하루 산출이 어디쯤 나올지» 와 목표 달성 확률
    const mcOf = s => M.ml ? M.ml.lineMC({ press: s.press / 100, weld: s.weld, heat: s.heat / 100 }, s.target) : null, MB = mcOf(defaults()), MR = mcOf(S);
    const row = (t, a, b, d, good, unit = '') => `<tr><td>${t}</td><td class="n">${d === 'won' ? DX.won(a) : f(a, d) + unit}</td><td class="n"><b>${d === 'won' ? DX.won(b) : f(b, d) + unit}</b></td><td class="n">${dv(b, a, d, good)}</td></tr>`;
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">하루 산출</div><div class="val">${f(R.out, 0)}<small>개</small></div><div class="foot">${dv(R.out, B.out, 0)} · 병목 ${esc(nm(R.lim.p))} (능력 기준)${MR ? ` · 실적 흔들림 반영 P10~P90 ${f(MR.p10, 0)}~${f(MR.p90, 0)} · 목표 달성 확률 ${pct(MR.pMeet, 0)}` : ''}</div></div>
      <div class="kpi"><div class="lab">하루 판단 이익</div><div class="val" style="color:${R.profit >= B.profit ? 'var(--ok)' : 'var(--danger-ink)'}">${DX.wonShort(R.profit)}<small>원</small></div><div class="foot">지금 대비 ${dv(R.profit, B.profit, 'won')}원</div></div>
      <div class="kpi"><div class="lab">고객 발주</div><div class="val" style="color:${R.ok ? 'var(--ok)' : feasible(R, B) ? 'var(--warn-ink)' : 'var(--danger-ink)'};font-size:${R.ok ? '' : '17px'}">${R.ok ? '충족' : feasible(R, B) ? '지금도 위반' : '새로 위반'}</div><div class="foot">${R.checks.map(c => `${c.ok ? '✓' : '✕'} ${c.t} ${c.v}`).join(' · ') || '활성 계약 없음'}${!R.ok && feasible(R, B) ? ' — 손잡이로 바뀌지 않는 조항은 출하 승인이 LOT 단위로 거릅니다' : ''}</div></div>
      <div class="kpi"><div class="lab">부품 1개당 탄소${M.asmTag ? M.asmTag('pcf') : ''}</div><div class="val">${R.pcfG != null ? f(R.pcfG, 0) : '—'}<small>g</small></div><div class="foot">지금 ${B.pcfG != null ? f(B.pcfG, 0) : '—'} g</div></div>
    </div>
    <div class="card"><h2>조정 변수 <span class="h2sub">값을 바꾸면 아래가 바로 다시 계산됩니다 — 실제 라인은 「계획으로 적용」 전까지 그대로</span>
      <span class="more" style="display:flex;gap:6px"><button class="btn sm" id="wi-reset">지금 값으로</button><button class="btn sm" id="wi-save" ${saved.length >= 3 ? 'disabled' : ''}>시나리오 저장</button><button class="btn sm" id="wi-opt">최적 찾기</button><button class="btn pri sm" id="wi-apply">계획으로 적용</button></span></h2>
      <div class="wigrid">
        ${lever('target', '목표 산출', 'number', { min: 10000, max: 200000, step: 1000 })}
        ${lever('press', '프레스 속도', 'range', { min: 70, max: 130, step: 5 })}
        ${lever('weld', '점용접기 대수', 'range', { min: 1, max: 3, step: 1 })}
        ${lever('heat', '열처리 가동', 'range', { min: 80, max: 130, step: 5 })}
        ${lever('vb', '공구 교체 기준 VB', 'range', { min: 0.25, max: 0.7, step: 0.05 })}
        ${lever('dev', '열처리 설정값 이탈 작업 비율', 'range', { min: 0, max: 40, step: 1 })}
        <label class="wil"><span>소입로 히터 정비</span><label class="ck"><input type="checkbox" data-wi="heater" ${S.heater ? 'checked' : ''}> 정비함 (점검비 ${DX.won(DX.C().MAINT)})</label></label>
      </div>
      ${S.vb > QL + 1e-6 ? `<p class="note" style="color:var(--danger-ink)">교체 기준 VB ${f(S.vb, 2)} 는 품질 기준 ${QL} mm 를 넘습니다 — 비용 비교용 시뮬레이션만 가능하고, 최적 찾기 · 계획 적용에서는 제외됩니다.</p>` : ''}
      ${msg ? `<p class="note msg">${msg}</p>` : ''}
      ${best ? `<div class="cnext"><b>최적 조합</b> 프레스 ${best.s.press}% · 용접기 ${best.s.weld}대 · 열처리 ${best.s.heat}% · VB ${f(best.s.vb, 2)} · 히터 ${best.s.heater ? '정비' : '그대로'} · 열처리 이탈 ${best.s.dev}% → 산출 ${f(best.out, 0)}개 · 이익 ${DX.won(best.profit)}/일 (지금 대비 ${dv(best.profit, B.profit, 'won')}원) <button class="btn pri sm" id="wi-usebest">이 조합 넣기</button></div>` : ''}</div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>현재 대비 변경안 ${M.asmTag ? M.asmTag('loss', 'opp') : ''}<span class="h2sub">하루 기준</span></h2>
        <table class="tb"><thead><tr><th></th><th class="n">지금</th><th class="n">바꾸면</th><th class="n">차이</th></tr></thead><tbody>
          ${row('하루 산출 (개, 능력 기준)', B.out, R.out, 0, 1)}
          ${MB && MR ? row('하루 산출 중앙값 (몬테카를로)', MB.p50, MR.p50, 0, 1) + row('목표 달성 확률 (%)', MB.pMeet * 100, MR.pMeet * 100, 0, 1) : ''}
          ${row('공헌이익', B.contrib, R.contrib, 'won', 1)}
          ${row('불량 손실 (프레스·열처리)', B.scrap, R.scrap, 'won', -1)}
          ${row('인서트 비용', B.toolCost, R.toolCost, 'won', -1)}
          ${row('마모 구간 가공 불량 위험', B.wearRisk, R.wearRisk, 'won', -1)}
          ${row('설비 · 잔업 · 관리 비용', B.weldCost + B.ot + B.maint + B.devCost, R.weldCost + R.ot + R.maint + R.devCost, 'won', -1)}
          ${row('클레임 기대 비용', B.claimExp, R.claimExp, 'won', -1)}
          ${row('열처리 불량률 (PPM)', B.ppmH, R.ppmH, 0, -1)}
          ${row('히터 낭비 전력', B.energy, R.energy, 'won', -1)}
          <tr class="hl"><td><b>판단 이익</b></td><td class="n">${DX.won(B.profit)}</td><td class="n"><b>${DX.won(R.profit)}</b></td><td class="n">${dv(R.profit, B.profit, 'won')}</td></tr>
          ${row('프레스 불량률 (PPM)', B.ppmP, R.ppmP, 0, -1)}
          ${row('인서트 사용 (개/일)', B.inserts, R.inserts, 1, -1)}
        </tbody></table>
        <p class="note">판단 이익 = 공헌이익 − 불량 손실 − 인서트 − 마모 위험 − 설비·잔업·관리 − 낭비 전력 − 클레임 기대 비용 (계약 기준 넘는 LOT 비율 × 하루 출하 LOT × 클레임 1건) (회계 이익이 아니라 «무엇이 나은지» 를 비교하는 값). 계수는 config.js COST.</p></div>
      <div class="card"><h2>원인 분석 <span class="h2sub">계산에 쓴 관계</span></h2>
        <h3 class="dh" style="margin-top:0">병목 — 능력 기준 하루 최대</h3>
        <div class="hbars">${R.caps.map(c => `<div class="hb"><span>${esc(nm(c.p))}</span><i style="--w:${Math.min(100, R.out / c.t * 100).toFixed(1)}%"></i><b>${f(c.t, 0)}</b></div>`).join('')}</div>
        <h3 class="dh">프레스 속도 → 불량률</h3><p class="note" style="margin-top:0">${R.pf ? `하루 타발 수와 불량률 회귀 (${R.pf.n}일): 타발 1,000회당 ${R.pf.b >= 0 ? '+' : ''}${f(R.pf.b * 1000, 1)} PPM · 상관계수 r = ${f(R.pf.r, 2)} — ${Math.abs(R.pf.r) < 0.3 ? '관계가 약해 숫자보다 방향으로 읽어야 합니다' : '관계가 뚜렷합니다'}` : '프레스 데이터 부족'}</p>
        <h3 class="dh">열처리 설정값 관리 → 불량률</h3><p class="note" style="margin-top:0">조건 이탈 작업 평균 ${f(R.hf.ppmD, 0)} PPM (${R.hf.nD}작업) vs 정상 ${f(R.hf.ppmN, 0)} PPM (${R.hf.nN}작업) · 최근 30작업 이탈 비율 ${pct(R.hf.share, 0)}. 이탈 비율 1%p 낮추는 관리비 ${DX.won(XC().DEV_CTRL)}/일 (가정).</p>
        <h3 class="dh">교체 기준 VB → 공구 비용 vs 불량 위험</h3>${wearChart()}
        <p class="note">공구 1세트(6날)로 가공하는 부품 수는 공구별 마모 속도(µm/분)와 가공 1회 시간에서 계산 (중앙값). VB ${WARN()}~${QL} 구간은 불량 위험을 1/4, ${QL} 초과는 ${pct(DX.C().OVERWEAR_DEFECT, 0)}로 가정.</p></div></div>
    ${saved.length ? `<div class="card" style="margin-top:16px"><h2>저장한 시나리오</h2>
      <table class="tb"><thead><tr><th></th>${saved.map((x, i) => `<th class="n">${String.fromCharCode(65 + i)} <button class="btn sm" data-wiload="${i}">불러오기</button> <button class="btn sm" data-widel="${i}">✕</button></th>`).join('')}</tr></thead><tbody>
        ${Object.keys(NAMES).map(k => `<tr><td>${esc(NAMES[k])}</td>${saved.map(x => `<td class="n">${esc(fmtS(k, x.s[k]))}</td>`).join('')}</tr>`).join('')}
        <tr><td>하루 산출</td>${saved.map(x => `<td class="n">${f(x.out, 0)}</td>`).join('')}</tr><tr class="hl"><td><b>판단 이익</b></td>${saved.map(x => `<td class="n"><b>${DX.won(x.profit)}</b></td>`).join('')}</tr>
        <tr><td>계약</td>${saved.map(x => `<td class="n">${x.ok ? '충족' : '<span class="ng">위반</span>'}</td>`).join('')}</tr></tbody></table></div>` : ''}`;
  };
  function lever(k, t, type, o) {
    const v = S[k];
    return `<label class="wil"><span>${esc(t)} <b id="wv-${k}">${esc(fmtS(k, v))}</b></span>${type === 'number' ? `<input class="in" type="number" data-wi="${k}" value="${v}" min="${o.min}" max="${o.max}" step="${o.step}">` : `<input type="range" data-wi="${k}" value="${v}" min="${o.min}" max="${o.max}" step="${o.step}">`}</label>`;
  }
  function wearChart() {
    const xs = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7], rs = xs.map(vb => compute(Object.assign({}, S, { vb })));
    return M.lineChart([{ v: rs.map(r => r.toolCost), cls: 's1' }, { v: rs.map(r => r.wearRisk), cls: 's2' }, { v: rs.map(r => r.toolCost + r.wearRisk), cls: 's3' }], null,
      { h: 170, d: 0, xlab: xs.map((x, i) => [i, f(x, 2)]), dots: [{ i: xs.findIndex(x => Math.abs(x - S.vb) < 1e-6), y: compute(S).toolCost + compute(S).wearRisk, cls: 'hot', r: 4, t: '지금 설정' }].filter(p => p.i >= 0) })
      + M.legend([['l-s1', '인서트 비용/일'], ['l-s2', '마모 구간 불량 위험/일'], ['l-s3', '합계 — 낮은 곳이 균형점']]);
  }

  M.mod({
    id: 'whatif', group: '판단 (3.0)', order: 5,
    menu: [['whatif', 'What-if 샌드박스', 'whatif']],
    views: V,
    bind(root) {
      root.querySelectorAll('[data-wi]').forEach(i => {
        const k = i.dataset.wi;
        if (i.type === 'checkbox') i.onchange = () => { S[k] = i.checked; best = null; M.render(); };
        else { i.oninput = () => { const e = M.$('#wv-' + k); if (e) e.textContent = fmtS(k, +i.value); }; i.onchange = () => { S[k] = +i.value; best = null; M.render(); }; }
      });
      const on = (s, fn) => { const e = root.querySelector(s); if (e) e.onclick = fn; };
      on('#wi-reset', () => { S = defaults(); best = null; msg = ''; M.render(); });
      on('#wi-save', () => { saved.push(compute(Object.assign({}, S))); M.render(); });
      on('#wi-opt', () => { best = optimize(); msg = best ? '' : '품질 협정 기준을 지키는 조합이 없습니다'; M.render(); });
      on('#wi-usebest', () => { S = Object.assign({}, best.s); best = null; M.render(); });
      root.querySelectorAll('[data-wiload]').forEach(b => b.onclick = () => { S = Object.assign({}, saved[+b.dataset.wiload].s); M.render(); });
      root.querySelectorAll('[data-widel]').forEach(b => b.onclick = () => { saved.splice(+b.dataset.widel, 1); M.render(); });
      on('#wi-apply', async () => {
        const T = window.MLNGTrust, R = compute(S), done = [];
        M.lineApi.setTarget(Math.round(R.out)); const ft = M.lineApi.fit('cap'); done.push(`라인 목표 ${f(ft.target, 0)}개/일 · 공정 속도 조정`);
        const cur = (M.CFG.MACH || {}).VB_LIMIT; if (S.vb > QL + 1e-6) done.push(`교체 기준 VB ${f(S.vb, 2)} 는 품질 기준 ${QL} 을 넘어 적용하지 않음 (시뮬레이션만)`); else if (Math.abs(S.vb - cur) > 1e-6) { M.CFG.MACH = Object.assign({}, M.CFG.MACH, { VB_LIMIT: S.vb }); done.push(`공구 교체 기준 VB ${f(cur, 2)} → ${f(S.vb, 2)}`); }
        if (S.weld > 1) done.push(`점용접기 ${S.weld - 1}대 증설 검토 요청`);
        if (S.dev < defaults().dev) done.push(`열처리 조건 관리 목표 — 이탈 작업 ${S.dev}% 이하`);
        if (S.heater) done.push('소입로 히터 정비 지시');
        if (M.prove) { const inp = Object.assign({}, S), red = i => { const r = compute(i); return { out: Math.round(r.out), profit: Math.round(r.profit), ok: r.ok }; };
          await M.prove.record({ kind: 'whatif', ref: 'WI', title: `계획 적용 판단 — 산출 ${f(R.out, 0)}개/일`, model: M.ml ? M.ml.VERSION.line : 'line', inputs: inp, output: red(inp), redo: red }); }
        if (T && T.ready) await T.append('MLNG', 'whatif', 'WI-' + String(Date.now()).slice(-6), `What-if 계획 적용 — ${done.join(' · ')}`.slice(0, 160), { s: S, out: Math.round(R.out), profit: Math.round(R.profit) });
        msg = '적용: ' + done.map(esc).join(' · ') + ' — <a href="#" data-go="line">라인 운영에서 확인 →</a>'; M.render();
      });
    },
  });
})();
