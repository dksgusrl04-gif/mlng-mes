/* 3.0 판단 계층 — 모든 신호를 «돈» 과 «근거» 로 바꾼다
 * ───────────────────────────────────────────────────────────────
 * 1.0 은 공정 데이터를 보여 주고, 2.0 은 회사 사이를 서명으로 잇는다. 3.0 은 «무엇부터 할지» 를 정한다.
 *   money(알람)  → 실손(이미 버린 돈) · 위험(그대로 두면 날 수 있는 돈) · 묶임(출하 못 하는 돈) · 낭비(일 에너지 손실) + 계산 근거
 *   copq(일수)   → 날짜별 품질 손실 (불량 폐기 · 클레임 · 에너지 낭비) — Cost of Poor Quality
 *   lineOpp()    → 목표 대비 못 만드는 수량의 기회 손실
 *   compare()    → 두 묶음의 평균 비교 (추정 원인의 «근거 강도» 를 정하는 공통 계산)
 * 금액 계수는 config.js COST (모두 예시값 — 회사 원가표로 바꿔 쓴다). 가정이 들어간 값은 근거에 «가정» 이라고 적는다.
 */
(function () {
  'use strict';
  const M = window.MLNG, { f } = M;
  const DX = M.dx = {};
  const C = DX.C = () => Object.assign({ PRICE: 420, MARGIN: 120, SCRAP: { press: 160, weld: 185, heat: 230, mach: 1800, insp: 1800 }, MACH_PART_PRICE: 2600, INSERT: 12000, KWH: 140,
    INSP_PART: 350, OVERWEAR_DEFECT: 0.08, CLAIM_FIXED: 500000, CLAIM_PER_PART: 12, STOP_H: 4, STOP_P: 0.3, MAINT: 250000, PLAN_PRICE: 3000, CO2_WON: 10 }, M.CFG.COST || {});
  const PCF = () => Object.assign({ EF_KWH: 0.4594, HEAT_ZONE_KW: { op1: 60, op2: 60, op3: 60, op4: 60, opd1: 20, opd2: 20 } }, M.CFG.PCF || {});
  const won = v => v == null ? '—' : Math.abs(v) >= 1e8 ? f(v / 1e8, 1) + '억' : Math.abs(v) >= 1e4 ? f(v / 1e4, 0) + '만' : f(v, 0);
  DX.won = v => v == null ? '—' : won(v) + '원';
  DX.wonShort = won;
  const day = s => String(s || '').slice(0, 10);
  const since = n => M.sinceDay(n).getTime();
  const inDays = (s, n) => M.toDate(s).getTime() >= since(n);
  const H = () => M.S.heat || { lots: [], heaters: [], recipe: [] };
  const P = () => M.S.press || { lots: [], vib: { events: [] } };
  const MC = () => M.S.mach || { tools: [], runs: [], parts_per_run: 25 };
  const VBL = () => (M.CFG.MACH || {}).VB_LIMIT || 0.5;
  const ids = s => [...new Set(String(s || '').match(/\b(?:HT|PR|WD|MC|IN|M22)-\d{3,}\b/g) || [])];
  DX.ids = ids;

  // 평균 비교 — a/b 묶음의 평균과 배수, 표본 수로 근거 강도를 매긴다
  DX.compare = (a, b) => {
    const mean = x => x.length ? x.reduce((s, v) => s + v, 0) / x.length : null;
    const ma = mean(a), mb = mean(b), ratio = ma != null && mb ? ma / mb : null, n = Math.min(a.length, b.length);
    // 원인 쪽(A)이 더 나쁠 때만 근거로 본다 — 반대 방향이면 «반대» (이 후보는 원인이 아닐 가능성)
    // 4.0: 순열 검정(우연일 확률 p) + 부트스트랩 90% 구간으로 강도를 정한다 (씨앗 고정 → 같은 데이터면 같은 결과)
    const ST = M.st; let p = null, lo = null, hi = null;
    if (ST && n >= 2) { p = ST.permTest(a, b, { n: 1000, seed: 17 }).p; const br = ST.bootRatio(a, b, { n: 800, seed: 19 }); lo = br.lo; hi = br.hi; }
    const strength = ratio == null || n < 2 ? 'none' : p == null ? (ratio >= 2 && n >= 3 ? 'strong' : ratio >= 1.3 ? 'some' : ratio <= 0.77 ? 'inverse' : 'weak')
      : p < 0.01 && lo > 1.2 ? 'strong' : p < 0.1 && ratio > 1 ? 'some' : ratio < 1 && p > 0.9 ? 'inverse' : 'weak';
    return { ma, mb, ratio, na: a.length, nb: b.length, strength, p, lo, hi };
  };
  DX.STRENGTH = { strong: ['j-danger', '높음'], some: ['j-warn', '보통'], weak: ['t-off', '낮음'], inverse: ['t-off', '역상관'], none: ['t-off', '판단 불가'] };
  DX.RANK = { strong: 0, some: 1, weak: 2, inverse: 3, none: 4 };

  // 열처리 가동 시간 (하루 평균, 최근 7일)
  const heatHoursPerDay = () => { const ls = H().lots.filter(l => inDays(l.end, 7)); const days = new Set(ls.map(l => day(l.end))).size || 1; return ls.reduce((s, l) => s + (l.dur_h || 0), 0) / days; };
  // 히터 출력 증가 → 하루 낭비 전력
  DX.heaterWaste = () => {
    const dr = M.heatApi ? M.heatApi.heaterDrift() : [], kw = PCF().HEAT_ZONE_KW, hrs = heatHoursPerDay(), c = C();
    return dr.filter(h => h.diff != null && h.diff > 0 && h.diff >= ((M.CFG.HEAT || {}).HEATER_DRIFT_PP || 5)).map(h => {
      const kwh = (kw[h.key] || 0) * h.diff / 100 * hrs;
      const co2 = kwh * PCF().EF_KWH; return { key: h.key, label: h.label, diff: h.diff, hrs, kwh, ewon: kwh * c.KWH, cwon: co2 * c.CO2_WON, won: kwh * c.KWH + co2 * c.CO2_WON, co2 };
    });
  };
  // 공구: 교체 기준을 넘긴 가공 횟수
  DX.overRuns = (tid, days) => MC().runs.filter(r => (!tid || r.tool === tid) && r.vb_now != null && r.vb_now > VBL() && (!days || inDays(r.t, days)));
  // 활성 전자 발주 (우리가 수락 서명한 첫 발주)
  DX.activeSO = () => ((window.MLNGTrust || {}).orders || []).find(o => o.signs && o.signs.seller) || null;
  const claimCost = qty => C().CLAIM_FIXED + (qty || 0) * C().CLAIM_PER_PART;
  DX.claimCost = claimCost;

  // ── 알람 하나 → 돈
  DX.money = a => {
    if (!a || !M.S) return null;
    const c = C(), out = { loss: 0, risk: 0, tied: 0, waste: 0, basis: [] }, t = a.title || '', b = a.body || '';
    const lot = id => (M.S.lots || []).find(l => l.id === id);
    // 알람의 구조화된 key·data 로 계산한다 (문구가 바뀌어도 금액이 사라지지 않게). key 가 없는 알람은 환산하지 않는다
    const k = a.key || '', d = a.data || {}, hl = id => H().lots.find(l => l.id === id);
    if (k === 'mach.tool_over') {
      const id = d.tool, over = DX.overRuns(id).length, parts = over * (MC().parts_per_run || 25);
      out.risk = parts * c.OVERWEAR_DEFECT * c.SCRAP.mach; out.loss = 6 * c.INSERT;
      out.basis.push(`교체 기준 VB ${VBL()} 를 넘긴 가공 ${over}회 × ${MC().parts_per_run}개 = 부품 ${f(parts, 0)}개`, `그중 불량 ${Math.round(c.OVERWEAR_DEFECT * 100)}% (가정) × 부품 손실 ${f(c.SCRAP.mach, 0)}원 = 위험 ${DX.won(out.risk)}`, `인서트 6날 교체 ${DX.won(out.loss)}`);
    } else if (k === 'mach.late') {
      const parts = DX.overRuns(null, M.CFG.RECENT_DAYS || 7).length * (MC().parts_per_run || 25);
      out.risk = parts * c.OVERWEAR_DEFECT * c.SCRAP.mach;
      out.basis.push(`최근 ${M.CFG.RECENT_DAYS || 7}일 교체 기준을 넘긴 가공 부품 ${f(parts, 0)}개 (${(d.tools || []).join(', ')})`, `불량 ${Math.round(c.OVERWEAR_DEFECT * 100)}% (가정) × ${f(c.SCRAP.mach, 0)}원 = 위험 ${DX.won(out.risk)}`, `막는 비용: 전수 측정 ${f(parts, 0)}개 × ${f(c.INSP_PART, 0)}원 = ${DX.won(parts * c.INSP_PART)}`);
    } else if (k === 'mach.sensor') {
      out.risk = (MC().parts_per_run || 25) * c.INSP_PART * Math.max(1, (d.tools || []).length); out.basis.push(`해당 가공 부품 재측정 ${MC().parts_per_run}개 × ${f(c.INSP_PART, 0)}원`);
    } else if (k === 'press.vib') {
      const L = M.lineSummary ? M.lineSummary() : { possible_per_day: 0 }, perH = L.possible_per_day / 24;
      out.risk = c.STOP_P * c.STOP_H * perH * c.MARGIN + c.STOP_P * c.MAINT;
      out.basis.push(`방치하면 고장 확률 ${Math.round(c.STOP_P * 100)}% (가정) × 정지 ${c.STOP_H}시간 × 시간당 ${f(perH, 0)}개 × 공헌이익 ${f(c.MARGIN, 0)}원`, `+ 고장 수리 ${DX.won(c.MAINT)} × ${Math.round(c.STOP_P * 100)}%`, `지금 점검 비용 ${DX.won(c.MAINT)} 과 비교해 판단 (진동 정상의 ${f(d.ratio, 1)}배)`);
    } else if (k === 'press.ppm_over' || k === 'press.ppm_trend') {
      const ls = P().lots.filter(l => inDays(l.date, M.CFG.RECENT_DAYS || 7)), bad = ls.reduce((s, l) => s + (l.bad || 0), 0);
      out.loss = bad * c.SCRAP.press; out.basis.push(`최근 ${M.CFG.RECENT_DAYS || 7}일 프레스 불량 ${f(bad, 0)}개 × ${f(c.SCRAP.press, 0)}원 = 발생 손실 ${DX.won(out.loss)}`);
    } else if (k === 'heat.heater') {
      const w = DX.heaterWaste().find(x => x.key === d.zone) || DX.heaterWaste()[0];
      if (w) { out.waste = w.won; out.basis.push(`${w.label} 정격 ${PCF().HEAT_ZONE_KW[w.key]}kW × 출력 증가 ${f(w.diff, 1)}%p × 하루 가동 ${f(w.hrs, 1)}h = ${f(w.kwh, 0)} kWh/일`, `× 전기 ${f(c.KWH, 0)}원 = ${DX.won(w.ewon)} + 탄소 ${f(w.co2, 0)} kgCO2e × ${c.CO2_WON}원 = ${DX.won(w.cwon)}`, `하루 ${DX.won(w.won)} (1년 300일이면 ${DX.won(w.won * 300)})`); }
    } else if (k === 'heat.dev') {
      const so = DX.activeSO(), hasCl = so && so.clauses.some(x => x.k === 'heat_dev'), ls = (d.lots || []).map(lot).filter(Boolean);
      out.risk = hasCl ? ls.reduce((s, l) => s + claimCost(l.qty), 0) : 0;
      out.basis.push(`조건 이탈 작업 ${ls.length}건 · ${f(ls.reduce((s, l) => s + (l.qty || 0), 0), 0)}개`, hasCl ? `고객 계약에 «열처리 조건 이탈률» 조항 → 출하하면 클레임 1건당 ${DX.won(c.CLAIM_FIXED)} + 개당 ${c.CLAIM_PER_PART}원` : '조건 이탈 조항이 있는 활성 계약 없음');
    } else if (k === 'heat.lot_ppm' || k === 'heat.ppm_over') {
      const ls = (d.lots || []).map(hl).filter(Boolean), bad = ls.reduce((s, l) => s + l.bad, 0);
      const so = DX.activeSO(), cl = so && so.clauses.find(x => x.k === 'heat_ppm'), exp = cl ? ls.filter(l => l.ppm > cl.v) : [];
      out.loss = bad * c.SCRAP.heat; out.risk = exp.reduce((s, l) => s + claimCost(l.qty), 0);
      out.basis.push(`불량 ${f(bad, 0)}개 × ${f(c.SCRAP.heat, 0)}원 = 발생 손실 ${DX.won(out.loss)}`);
      if (exp.length) out.basis.push(`${exp.map(l => l.id).join(', ')} 는 계약 기준(${cl.v} PPM)을 넘음 → 출하하면 클레임 위험 ${DX.won(out.risk)}`);
    } else if (k === 'weld.pred') {
      out.risk = (d.expected || 0) * c.SCRAP.heat;
      out.basis.push(`예상 불량 ${f(d.expected, 1)}개 — 검사 없이 열처리까지 가면 개당 ${f(c.SCRAP.heat, 0)}원`);
    } else if (k === 'weld.pressure') {
      const s = (M.S.weld || {}).summary || {}, n = d.n || 0; out.risk = n * (s.base_rate || 0) * c.SCRAP.heat;
      out.basis.push(`가압 이상 타점 ${f(n, 0)}개 × 평소 불량률 ${f((s.base_rate || 0) * 100, 2)}% × ${f(c.SCRAP.heat, 0)}원`);
    } else if (k === 'insp.conflict') {
      const n = d.n || 0; out.tied = n * c.MACH_PART_PRICE;
      out.basis.push(`판정 확정 전 출하 보류 ${f(n, 0)}개 × 단가 ${f(c.MACH_PART_PRICE, 0)}원 = 보류 재고 금액 ${DX.won(out.tied)}`);
    } else if (k === 'plan.short') {
      const gap = Math.round(d.gap || 0); out.risk = gap * c.PLAN_PRICE; out.basis.push(`부족 ${f(gap, 0)}개 × 결품 손실 ${f(c.PLAN_PRICE, 0)}원`);
    } else if (k === 'deal.claim') {
      const ls = (d.lots || []).map(lot).filter(Boolean); out.loss = ls.reduce((s, l) => s + claimCost(l.qty), 0);
      out.basis.push(`클레임 ${ls.length}건 × (대응 ${DX.won(c.CLAIM_FIXED)} + ${ls.map(l => f(l.qty, 0)).join('·')}개 × 선별 ${c.CLAIM_PER_PART}원)`);
    } else return null;
    out.won = out.loss + out.risk + out.tied + out.waste;
    out.kind = out.waste ? 'waste' : out.loss >= out.risk && out.loss >= out.tied ? 'loss' : out.tied > out.risk ? 'tied' : 'risk';
    return out;
  };
  DX.KIND = { loss: ['발생 손실', '이미 발생한 폐기 · 클레임 비용'], risk: ['잠재 손실', '조치하지 않으면 발생할 수 있는 비용'], tied: ['보류 재고', '판정 대기로 출하하지 못한 재고 금액'], waste: ['에너지 손실/일', '설비 이상으로 매일 추가되는 전력 비용'] };
  DX.chip = m => m && m.won ? `<span class="won k-${m.kind}" title="${M.esc(m.basis.join('\n'))}">${won(m.won)}<small>원${m.kind === 'waste' ? '/일' : ''}</small></span>` : '';

  // ── 날짜별 품질 손실 (COPQ)
  DX.copq = (n = 30) => {
    const c = C(), m = {}, row = d => m[d] = m[d] || { d, press: 0, weld: 0, heat: 0, claim: 0, energy: 0, out: 0 };
    P().lots.filter(l => inDays(l.date, n)).forEach(l => { row(l.date).press += (l.bad || 0) * c.SCRAP.press; });
    ((M.S.weld || {}).lots || []).filter(l => inDays(l.date, n) && l.bad != null).forEach(l => { row(l.date).weld += l.bad * c.SCRAP.weld; });
    H().lots.filter(l => inDays(l.end, n)).forEach(l => { const r = row(day(l.end)); r.heat += l.bad * c.SCRAP.heat; r.out += l.qty; });
    ((window.MLNGTrust || {}).orders || []).forEach(o => o.deliveries.filter(d => d.claim && d.claim.status !== 'recheck').forEach(d => { const hl = H().lots.find(l => l.id === d.lot); if (hl && inDays(hl.end, n)) row(day(hl.end)).claim += claimCost(d.qty); }));
    const w = DX.heaterWaste().reduce((s, x) => s + x.won, 0);
    Object.values(m).forEach(r => { if (r.out) r.energy = w; r.total = r.press + r.weld + r.heat + r.claim + r.energy; });
    const days = Object.values(m).sort((a, b) => a.d.localeCompare(b.d)), sum = k => days.reduce((s, r) => s + r[k], 0);
    const total = sum('total'), revenue = sum('out') * c.PRICE;
    return { days, total, revenue, rate: revenue ? total / revenue : null, by: { press: sum('press'), weld: sum('weld'), heat: sum('heat'), claim: sum('claim'), energy: sum('energy') }, n };
  };
  // ── 라인 기회 손실 (목표만큼 팔 수 있을 때)
  DX.lineOpp = () => { const L = M.lineSummary ? M.lineSummary() : null; if (!L) return null; const gap = Math.max(0, L.target_per_day - L.possible_per_day); return { gap, won: gap * C().MARGIN, L }; };
})();
