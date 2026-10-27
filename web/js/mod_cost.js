/* 3.0 ③ — 품질 비용(COPQ) (품질 손실 · 위험 · 낭비 · 기회)
 * ───────────────────────────────────────────────────────────────
 * PPM · Cpk · VB 는 현장 언어, 경영은 원(₩)으로 판단한다. 모든 알람과 이슈를 같은 단위(원)로 바꿔 «무엇부터» 를 정한다.
 *   품질 손실(COPQ) — 불량 폐기 · 클레임 · 에너지 낭비 (날짜별, 매출 대비)
 *   예상 손실 합계   — 열린 알람 하나하나의 발생 손실 · 잠재 손실 · 보류 재고 · 에너지 손실 (계산식 공개)
 *   기회 손실      — 라인 목표 대비 못 만드는 수량 × 공헌이익
 * 계수는 config.js COST (예시값). 화면 아래 표에 지금 쓰는 계수를 모두 보여 준다.
 */
(function () {
  'use strict';
  const M = window.MLNG, DX = M.dx, { esc, f, pct } = M;
  const PARTS = [['press', '프레스 불량', 's1'], ['weld', '용접 불량', 's2'], ['heat', '열처리 불량', 's3'], ['claim', '클레임', 's4'], ['energy', '에너지 손실', 's5']];
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
    const c = DX.C(), q = DX.copq(30), al = M.alerts().map(a => ({ a, m: DX.money(a) })).filter(x => x.m && x.m.won), opp = DX.lineOpp(), A = M.asmTag || (() => '');
    const waste = DX.heaterWaste().reduce((s, x) => s + x.won, 0), now = al.reduce((s, x) => s + x.m.won - (x.m.waste || 0), 0);
    const rows = al.slice().sort((x, y) => sort === 'won' ? y.m.won - x.m.won : (x.a.level === 'danger' ? 0 : 1) - (y.a.level === 'danger' ? 0 : 1));
    const by = PARTS.map(([k, t, cl]) => ({ k, t, cl, v: q.by[k] })).filter(x => x.v), mx = Math.max(1, ...by.map(x => x.v));
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">품질 비용 (30일)${A('loss')}</div><div class="val">${DX.wonShort(q.total)}<small>원</small></div><div class="foot">매출 대비 ${pct(q.rate, 2)}</div></div>
      <div class="kpi click" data-go="cases"><div class="lab">예상 손실 합계${A('loss')}</div><div class="val" style="color:var(--danger-ink)">${DX.wonShort(now)}<small>원</small></div><div class="foot">미결 알람 ${al.length}건</div></div>
      <div class="kpi click" data-go="heat_equip"><div class="lab">에너지 손실${A('loss')}</div><div class="val" style="color:var(--warn-ink)">${DX.wonShort(waste)}<small>원/일</small></div><div class="foot">연 ${DX.won(waste * 300)} 환산</div></div>
      ${opp ? `<div class="kpi click" data-go="line"><div class="lab">기회 손실${A('opp')}</div><div class="val">${DX.wonShort(opp.won)}<small>원/일</small></div><div class="foot">목표 대비 ${f(opp.gap, 0)}개 미달</div></div>` : ''}
    </div>
    <div class="card"><h2>알람별 손실 금액 ${A('loss')}<span class="more" style="display:flex;gap:8px;align-items:center">${M.seg('csort', sort, [['won', '금액순'], ['lv', '긴급순']])}<a href="#" data-go="assume">가정값 관리 →</a></span></h2>
      <div class="tbx"><table class="tb ctab"><colgroup><col><col class="c-cp"><col class="c-ck"><col class="c-cw"></colgroup>
        <thead><tr><th>알람</th><th>공정</th><th>구분</th><th class="n">금액</th></tr></thead>
        <tbody>${rows.map(x => `<tr class="click ${x.a.level === 'danger' ? 'hl' : ''}" data-row="${esc(x.a.go || 'alerts')}" title="${esc(x.m.basis.join('\n'))}"><td><div class="it1">${esc(x.a.title)}</div><div class="it2">${esc(x.m.basis[0] || '')}</div></td>
          <td>${M.procTag(x.a.proc)}</td><td><span class="tag k-${x.m.kind}">${esc(DX.KIND[x.m.kind][0])}</span></td><td class="n"><b>${DX.won(x.m.won)}</b>${x.m.kind === 'waste' ? '<small>/일</small>' : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">금액으로 환산할 알람이 없습니다</td></tr>'}</tbody></table></div>
      ${M.legend(Object.entries(DX.KIND).map(([k, [t, d]]) => ['tag k-' + k, `${t} — ${d}`]))}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>일별 품질 비용 <span class="h2sub">30일</span></h2>${q.days.length ? stacked(q.days) : '<div class="empty">값이 없습니다</div>'}
        ${M.legend(PARTS.filter(([k]) => q.by[k]).map(([, t, c2]) => ['cb ' + c2, t]))}</div>
      <div class="card"><h2>항목별 품질 비용 <span class="h2sub">30일 합계</span></h2>
        <div class="hbars">${by.sort((a, b) => b.v - a.v).map(x => `<div class="hb"><span>${esc(x.t)}</span><i style="--w:${(x.v / mx * 100).toFixed(1)}%"></i><b>${DX.wonShort(x.v)}</b></div>`).join('') || '<div class="empty">손실이 없습니다</div>'}</div></div></div>`;
  };

  M.mod({
    id: 'cost', group: '판단 (3.0)', order: 3.5,
    menu: [['cost', '품질 비용(COPQ)', 'won']],
    views: V,
    bind(root) { root.querySelectorAll('[data-csort]').forEach(b => b.onclick = () => { sort = b.dataset.csort; M.render(); }); },
  });
})();
