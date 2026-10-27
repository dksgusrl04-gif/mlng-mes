/* 2.0 ⑥ — 함께 배우는 AI (연합 학습 시뮬레이션)
 * ───────────────────────────────────────────────────────────────
 * 같은 공정을 쓰는 여러 공장이 원본 데이터는 각자 두고, «학습에 필요한 요약 통계» 만 모아 공구 마모 속도 모델을 함께 만든다.
 *   모델: log(마모 속도) = b0 + b1·스테인리스 + b2·절삭깊이 + b3·이송  (선형 회귀)
 *   각 공장이 보내는 것: XᵀX (4×4) 와 Xᵀy (4) 뿐 — 공구별 원본 행은 나가지 않는다. 모으면 모든 데이터로 학습한 것과 같은 모델이 된다.
 *   평가: 각 공장 공구를 하나씩 빼고 (1) 자기 데이터만으로 학습 (2) 함께 학습 — 빠진 공구 마모 속도를 얼마나 맞히나.
 * 데이터: NASA 밀링 공구 15개를 재질·조건이 치우치게 가상의 4개 공장으로 나눈 시뮬레이션이다.
 */
(function () {
  'use strict';
  const M = window.MLNG, T = window.MLNGTrust, { esc, f, pct } = M;
  const SITES = [
    { id: 'S1', name: '우리 공장 (C)', tools: ['T13', 'T14', 'T15', 'T16'] },
    { id: 'S2', name: '참여 공장 2', tools: ['T01', 'T02', 'T03', 'T04'] },
    { id: 'S3', name: '참여 공장 3', tools: ['T05', 'T07', 'T08'] },
    { id: 'S4', name: '참여 공장 4', tools: ['T09', 'T10', 'T11', 'T12'] },
  ];
  const LAM = 0.05;
  const rows = () => ((M.S.mach || {}).tools || []).filter(t => t.rate).map(t => ({ id: t.id, x: [1, t.material === '스테인리스강' ? 1 : 0, t.DOC, t.feed], y: Math.log(t.rate * 1000), rate: t.rate * 1000, material: t.material, DOC: t.DOC, feed: t.feed }));
  const stats = rs => { const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), b = [0, 0, 0, 0]; rs.forEach(r => { for (let i = 0; i < 4; i++) { b[i] += r.x[i] * r.y; for (let j = 0; j < 4; j++) A[i][j] += r.x[i] * r.x[j]; } }); return { A, b, n: rs.length }; };
  const add = (s, t) => ({ A: s.A.map((r, i) => r.map((v, j) => v + t.A[i][j])), b: s.b.map((v, i) => v + t.b[i]), n: s.n + t.n });
  function solve(s) {   // (XᵀX + λI') w = Xᵀy  (절편은 벌점 없음)
    const n = 4, A = s.A.map((r, i) => r.map((v, j) => v + (i === j && i > 0 ? LAM : 0)).concat([s.b[i]]));
    for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; if (Math.abs(A[c][c]) < 1e-12) A[c][c] = 1e-12;
      for (let r = 0; r < n; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let j = c; j <= n; j++) A[r][j] -= k * A[c][j]; } }
    return A.map((r, i) => r[n] / r[i]);
  }
  // 개인화: 함께 만든 모델을 출발점으로 자기 데이터로 살짝 보정 (μ 가 클수록 공통 모델에 가깝게)
  const MU = 0.5;
  function solveP(st, w0) { const n = 4, A = st.A.map((r, i) => r.map((v, j) => v + (i === j ? MU : 0)).concat([st.b[i] + MU * w0[i]]));
    for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let j = c; j <= n; j++) A[r][j] -= k * A[c][j]; } }
    return A.map((r, i) => r[n] / r[i]); }
  const pred = (w, x) => Math.exp(w.reduce((s, v, i) => s + v * x[i], 0));
  const Z = { A: [0, 1, 2, 3].map(() => [0, 0, 0, 0]), b: [0, 0, 0, 0], n: 0 };

  let res = null, round = 0;
  function evaluate() {
    const R = rows(), by = SITES.map(s => Object.assign({}, s, { rs: R.filter(r => s.tools.includes(r.id)) }));
    const per = by.map(s => {
      const errs = s.rs.map(h => {
        const own = s.rs.filter(r => r !== h), others = by.filter(o => o !== s).reduce((a, o) => add(a, stats(o.rs)), Z);
        const wl = solve(stats(own)), wf = solve(add(others, stats(own)));
        const wo = solve(others); return { id: h.id, real: h.rate, local: pred(wl, h.x), fed: pred(wf, h.x), per: pred(solveP(stats(own), wo), h.x) };
      });
      const mae = k => errs.reduce((a, e) => a + Math.abs(e[k] - e.real) / e.real, 0) / Math.max(1, errs.length);
      return Object.assign(s, { errs, local: mae('local'), fed: mae('fed'), per: mae('per'), st: stats(s.rs) });
    });
    const all = per.reduce((a, s) => add(a, s.st), Z), w = solve(all);
    return { per, w, n: all.n, payload: per[0].st };
  }
  async function train() {
    res = evaluate(); round += 1;
    await T.append('MLNG', 'fed', `FED-${String(round).padStart(3, '0')}`, `공동 학습 라운드 ${round} — ${SITES.length}개 공장 요약 통계 합산 · 원본 공유 0건`, { w: res.w.map(v => +v.toFixed(5)), n: res.n });
  }
  T.onInit(async () => { if ((M.S.mach || {}).tools) await train(); });

  const V = {};
  V.fed = () => {
    if (!res) return '<div class="empty">MCT 공구 데이터가 없어 공동 학습을 할 수 없습니다</div>';
    const me = res.per[0], avg = k => res.per.reduce((s, p) => s + p[k], 0) / res.per.length, avgL = avg('local'), avgF = avg('fed'), avgP = avg('per'), w = res.w;
    const better = res.per.filter(p => Math.min(p.fed, p.per) < p.local).map(p => p.name), worse = res.per.filter(p => Math.min(p.fed, p.per) >= p.local).map(p => p.name);
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">참여 공장 평균 오차</div><div class="val" style="color:var(--ok)">${pct(Math.min(avgF, avgP), 0)}</div><div class="foot">혼자 학습 평균 ${pct(avgL, 0)} → 함께 ${pct(avgF, 0)} · 함께+보정 ${pct(avgP, 0)}</div></div>
      <div class="kpi"><div class="lab">당사 예측 오차</div><div class="val">${pct(Math.min(me.fed, me.per), 0)}</div><div class="foot">혼자 학습하면 ${pct(me.local, 0)}</div></div>
      <div class="kpi"><div class="lab">외부 반출 원본</div><div class="val" style="color:var(--ok)">0<small>행</small></div><div class="foot">공장당 숫자 20개(요약 통계)만 전송</div></div>
      <div class="kpi click" data-go="net_ledger"><div class="lab">학습 라운드</div><div class="val">${round}<small>회</small></div><div class="foot">원장에 기록</div></div>
    </div>
    <div class="card"><h2>공장별 결과 <span class="h2sub">공구를 하나씩 빼고 그 공구의 마모 속도를 맞혀 본 평균 오차 (낮을수록 좋음)</span><button class="btn pri sm" id="fd-run" style="margin-left:auto">학습 라운드 실행</button></h2>
      ${M.table([['공장', s => `<b>${esc(s.name)}</b>`], ['보유 공구', s => `${s.rs.length}개 · ${esc([...new Set(s.rs.map(r => r.material))].join('/'))}`], ['혼자 학습', s => pct(s.local, 0), 'n'], ['함께 (공통 모델)', s => `<span style="color:${s.fed < s.local ? 'var(--ok)' : 'var(--danger-ink)'}">${pct(s.fed, 0)}</span>`, 'n'],
        ['함께 + 자기 보정', s => `<b style="color:${s.per < s.local ? 'var(--ok)' : 'var(--danger-ink)'}">${pct(s.per, 0)}</b>`, 'n']], res.per, { wrap: false })}
      <p class="note">${better.length ? `${esc(better.join(', '))}는 함께 학습했을 때 오차가 줄었습니다 — 자기 데이터에 없는 재질·조건을 다른 공장의 요약 통계에서 배웠기 때문입니다.` : ''}
        ${worse.length ? ` ${esc(worse.join(', '))}는 자기 조건 데이터만으로도 충분히 맞혀 이득이 없었습니다 — 그래서 공통 모델을 그대로 쓸지, 자기 데이터로 보정해 쓸지를 공장마다 고릅니다.` : ''} 공구 수가 공장당 3~4개인 작은 표본이라 숫자보다 방향으로 읽어야 합니다.</p></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>당사 제공 데이터 <span class="h2sub">원본 공구 기록 대신 이 숫자들만</span></h2>
        <table class="tb mono" style="font-size:12px"><tbody>${me.st.A.map((r, i) => `<tr>${r.map(v => `<td class="n">${f(v, 3)}</td>`).join('')}<td class="n" style="border-left:2px solid var(--line)">${f(me.st.b[i], 3)}</td></tr>`).join('')}</tbody></table>
        <p class="note">왼쪽 4×4 = XᵀX, 오른쪽 = Xᵀy. 공구 번호·날짜·측정값 원본은 포함되지 않습니다. 운영에서는 여러 공장의 값을 더한 결과만 보이게 하는 보안 합산을 씁니다.</p></div>
      <div class="card"><h2>공동 학습 모델 <span class="h2sub">log(마모 속도 µm/분)</span></h2>
        ${M.dl([['기본값', f(w[0], 3)], ['스테인리스강이면', `${w[1] >= 0 ? '+' : ''}${f(w[1], 3)} (약 ${f(Math.exp(w[1]), 1)}배 빠름)`], ['절삭깊이 1mm당', `${w[2] >= 0 ? '+' : ''}${f(w[2], 3)}`], ['이송 1mm/rev당', `${w[3] >= 0 ? '+' : ''}${f(w[3], 3)}`], ['학습 공구', `${res.n}개 (4개 공장 합)`]])}
        <h3 class="dh">당사 공구 수명 예측</h3>${M.table([['공구', 'id'], ['실제', e => f(e.real, 1), 'n'], ['혼자', e => f(e.local, 1), 'n'], ['함께', e => f(e.fed, 1), 'n'], ['함께+보정', e => f(e.per, 1), 'n']], me.errs, { wrap: false })}
        <p class="note">NASA 밀링 공구 15개를 가상의 4개 공장으로 나눈 시뮬레이션입니다.</p></div></div>`;
  };

  M.mod({
    id: 'fed', group: '연결 · 신뢰 (2.0)', order: 54,
    menu: [['fed', '함께 배우는 AI', 'fed']],
    views: V,
    bind(root) { const b = root.querySelector('#fd-run'); if (b) b.onclick = async () => { await train(); M.render(); }; },
  });
})();
