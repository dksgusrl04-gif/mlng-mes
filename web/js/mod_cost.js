/* 3.0 ③ — 돈으로 보는 공장 (품질 손실 · 위험 · 낭비 · 기회)
 * ───────────────────────────────────────────────────────────────
 * PPM · Cpk · VB 는 현장 언어, 경영은 원(₩)으로 판단한다. 모든 알림과 사건을 같은 단위(원)로 바꿔 «무엇부터» 를 정한다.
 *   품질 손실(COPQ) — 불량 폐기 · 클레임 · 에너지 낭비 (날짜별, 매출 대비)
 *   지금 걸린 돈   — 열린 알림 하나하나의 실손 · 위험 · 묶임 · 낭비 (계산식 공개)
 *   기회 손실      — 라인 목표 대비 못 만드는 수량 × 공헌이익
 * 계수는 config.js COST (예시값). 화면 아래 표에 지금 쓰는 계수를 모두 보여 준다.
 */
(function () {
  'use strict';
  const M = window.MLNG, DX = M.dx, { esc, f, pct } = M;
  const PARTS = [['press', '프레스 불량', 's1'], ['weld', '용접 불량', 's2'], ['heat', '열처리 불량', 's3'], ['claim', '클레임', 's4'], ['energy', '에너지 낭비', 's5']];
  function stacked(days) {
    const W = 640, Hh = 190, L = 52, R = 10, T = 10, B = 24, hi = Math.max(1, ...days.map(d => d.total)) * 1.12, bw = (W - L - R) / Math.max(1, days.length), Y = v => T + (Hh - T - B) * (1 - v / hi);
    const ticks = [0, 1, 2, 3].map(i => hi * i / 3), every = Math.ceil(days.length / 8);
    return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img">${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 7}" y="${Y(t) + 4}" text-anchor="end">${DX.wonShort(t)}</text>`).join('')}
      ${days.map((d, i) => { let acc = 0; return PARTS.map(([k, , c]) => { const v = d[k] || 0; if (!v) return ''; const y0 = Y(acc), y1 = Y(acc + v); acc += v; return `<rect class="cb ${c}" x="${(L + i * bw + bw * 0.16).toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" y="${y1.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}"><title>${esc(d.d)} ${esc(PARTS.find(p => p[0] === k)[1])} ${DX.won(v)}</title></rect>`; }).join(''); }).join('')}
      ${days.map((d, i) => i % every ? '' : `<text class="ax" x="${(L + i * bw + bw / 2).toFixed(1)}" y="${Hh - 7}" text-anchor="middle">${esc(d.d.slice(5))}</text>`).join('')}</svg>`;
  }
  let sort = 'won';
  const V = {};
  V.cost = () => {
    const c = DX.C(), q = DX.copq(30), al = M.alerts().map(a => ({ a, m: DX.money(a) })).filter(x => x.m && x.m.won), opp = DX.lineOpp();
    const waste = DX.heaterWaste().reduce((s, x) => s + x.won, 0), now = al.reduce((s, x) => s + x.m.won - (x.m.waste || 0), 0);
    const rows = al.slice().sort((x, y) => sort === 'won' ? y.m.won - x.m.won : (x.a.level === 'danger' ? 0 : 1) - (y.a.level === 'danger' ? 0 : 1));
    const by = PARTS.map(([k, t, cl]) => ({ k, t, cl, v: q.by[k] })).filter(x => x.v), mx = Math.max(1, ...by.map(x => x.v));
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">품질 손실 (COPQ) · 30일</div><div class="val">${DX.wonShort(q.total)}<small>원</small></div><div class="foot">매출 ${DX.won(q.revenue)} 대비 ${pct(q.rate, 2)}</div></div>
      <div class="kpi click" data-go="cases"><div class="lab">지금 걸린 돈</div><div class="val" style="color:var(--danger-ink)">${DX.wonShort(now)}<small>원</small></div><div class="foot">열린 알림 ${al.length}건의 실손 · 위험 · 묶임</div></div>
      <div class="kpi click" data-go="heat_equip"><div class="lab">매일 새는 돈</div><div class="val" style="color:var(--warn-ink)">${DX.wonShort(waste)}<small>원/일</small></div><div class="foot">1년이면 ${DX.won(waste * 300)} · 히터 출력 증가 전력</div></div>
      ${opp ? `<div class="kpi click" data-go="line"><div class="lab">기회 손실 · 하루</div><div class="val">${DX.wonShort(opp.won)}<small>원</small></div><div class="foot">목표보다 ${f(opp.gap, 0)}개 적게 · 공헌이익 ${f(c.MARGIN, 0)}원/개 (팔 수 있을 때)</div></div>` : ''}
    </div>
    <div class="card"><h2>알림을 돈으로 <span class="h2sub">같은 단위(원)로 바꾸면 무엇부터 할지가 보입니다 — 금액에 마우스를 올리면 계산식</span>
      <span class="more">${M.seg('csort', sort, [['won', '금액순'], ['lv', '긴급순']])}</span></h2>
      ${M.table([['알림 · 계산 근거', x => `<b>${esc(x.a.title)}</b><div class="muted" style="font-size:12px;margin-top:2px" title="${esc(x.m.basis.join('\n'))}">${esc(x.m.basis[0] || '')}${x.m.basis.length > 1 ? ` <span style="cursor:help;color:var(--brand)">외 ${x.m.basis.length - 1}줄</span>` : ''}</div>`], ['공정', x => M.procTag(x.a.proc)], ['구분', x => `<span class="tag k-${x.m.kind}">${esc(DX.KIND[x.m.kind][0])}</span>`],
        ['금액', x => `<b>${DX.won(x.m.won)}</b>${x.m.kind === 'waste' ? '<small>/일</small>' : ''}`, 'n']],
        rows, { wrap: false, click: x => x.a.go || 'alerts', hl: x => x.a.level === 'danger', empty: '금액으로 바꿀 알림이 없습니다' })}
      <p class="note">실손 = 이미 버린 돈 · 위험 = 그대로 두면 날 수 있는 돈(가정 포함) · 묶임 = 판정 전이라 출하 못 하는 돈 · 낭비 = 매일 새는 돈. 막는 데 드는 돈(점검 · 검사)과 비교해 결정합니다.</p></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>날짜별 품질 손실 <span class="h2sub">최근 30일 · 생산이 있던 날</span></h2>${q.days.length ? stacked(q.days) : '<div class="empty">값이 없습니다</div>'}
        ${M.legend(PARTS.filter(([k]) => q.by[k]).map(([, t, c2]) => ['cb ' + c2, t]))}</div>
      <div class="card"><h2>어디서 새나 <span class="h2sub">30일 합</span></h2>
        <div class="hbars">${by.sort((a, b) => b.v - a.v).map(x => `<div class="hb"><span>${esc(x.t)}</span><i style="--w:${(x.v / mx * 100).toFixed(1)}%"></i><b>${DX.wonShort(x.v)}</b></div>`).join('') || '<div class="empty">손실이 없습니다</div>'}</div>
        <p class="note">불량률(PPM)이 낮아도 클레임 1건 · 에너지 낭비가 더 클 수 있습니다. 같은 단위로 봐야 우선순위가 맞습니다.</p></div></div>
    <div class="card" style="margin-top:16px"><h2>지금 쓰는 계수 <span class="h2sub">모두 예시값 — config.js COST 에 회사 원가표 · 전기요금 · 배출권 가격을 넣으면 화면 전체가 바뀝니다</span></h2>
      ${M.dl([['판매 단가', f(c.PRICE, 0) + '원/개'], ['공헌이익', f(c.MARGIN, 0) + '원/개'], ['불량 1개 손실', Object.entries(c.SCRAP).map(([k, v]) => `${M.PROC[k] || k} ${f(v, 0)}`).join(' · ') + '원'], ['가공 부품 단가', f(c.MACH_PART_PRICE, 0) + '원'],
        ['인서트', f(c.INSERT, 0) + '원/개'], ['전기 요금', f(c.KWH, 0) + '원/kWh'], ['전수 측정', f(c.INSP_PART, 0) + '원/개'], ['클레임', `${DX.won(c.CLAIM_FIXED)} + ${c.CLAIM_PER_PART}원/개`],
        ['마모 초과 가공 불량률 (가정)', pct(c.OVERWEAR_DEFECT, 0)], ['진동 방치 → 고장 확률 (가정)', `${pct(c.STOP_P, 0)} · 정지 ${c.STOP_H}h`], ['설비 점검', DX.won(c.MAINT)], ['탄소 비용', c.CO2_WON + '원/kgCO2e']], 'kvl')}</div>`;
  };

  M.mod({
    id: 'cost', group: '판단 (3.0)', order: 3.5,
    menu: [['cost', '돈으로 보는 공장', 'won']],
    views: V,
    bind(root) { root.querySelectorAll('[data-csort]').forEach(b => b.onclick = () => { sort = b.dataset.csort; M.render(); }); },
  });
})();
