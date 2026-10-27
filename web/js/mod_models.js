/* 4.0 ② — 모델 상태 (스스로 의심하는 AI)
 * ───────────────────────────────────────────────────────────────
 * 모델마다 «검증 성적(구간이 실제를 얼마나 맞히나)» 과 «입력 분포 변화» 로 신뢰도를 계산해 보여 주고,
 * 신뢰가 떨어진 모델에 기대는 에이전트 조치는 자동 실행 권한을 스스로 내려놓는다.
 * 여기서 공구 잔여 수명(첫날 예측 → 좁아지는 구간), LOT 클레임 발생 확률 모델, 히터 변화점, 수요 예측, 라인 산출 분포를 함께 본다.
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f, pct } = M;
  let sel = 'heat', tool = null;
  const chip = x => `<span class="trust ${x.level}">${esc(M.ml.LEVEL[x.level][1])} ${f(x.trust * 100, 0)}</span>`;
  const V = {};
  V.models = () => {
    const ML = M.ml; if (!ML) return '<div class="empty">모델 계층이 없습니다</div>';
    const all = ML.all(), n = l => all.filter(x => x.level === l).length, cg = ML.changeFor('heat'), psi = ML.psi().rows;
    const KN = { buy: '공구·소모품 발주', insp: '검사 강화 지시', wo: '작업지시 초안' };
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">모델 신뢰</div><div class="val">${n('ok')}<small>/ ${all.length}</small></div><div class="foot">주의 ${n('warn')} · 신뢰 불가 ${n('bad')}</div></div>
      <div class="kpi click" data-go="agent"><div class="lab">자동 실행을 내려놓은 조치</div><div class="val" style="color:${Object.keys(ML.KIND_MODEL).some(k => ML.trustOf(ML.KIND_MODEL[k]).level !== 'ok') ? 'var(--warn-ink)' : 'inherit'}">${Object.keys(ML.KIND_MODEL).filter(k => ML.trustOf(ML.KIND_MODEL[k]).level !== 'ok').length}<small>종</small></div><div class="foot">근거 모델이 «신뢰» 가 아니면 승인 대기로</div></div>
      <div class="kpi click" data-go="${cg && cg.day ? 'replay:' + esc(cg.day) : 'models'}"><div class="lab">통계적 변화 시작</div><div class="val" style="font-size:17px">${cg ? esc(cg.day.slice(5)) : '—'}</div><div class="foot">${cg ? esc(cg.what) : '뚜렷한 변화 없음'}</div></div>
      <div class="kpi"><div class="lab">입력 분포 변화</div><div class="val">${psi.filter(x => x.level !== 'ok').length}<small>/ ${psi.length}</small></div><div class="foot">PSI 0.1 이상 = 주의 · 0.25 이상 = 큰 변화</div></div>
    </div>
    <div class="card"><h2>모델 <span class="h2sub">예측마다 구간을 함께 내고, 그 구간이 실제를 얼마나 맞히는지로 스스로 신뢰도를 매깁니다</span></h2>
      <div class="mgrid">${all.map(x => `<div class="mcard ${x.k === sel ? 'on' : ''}" data-msel="${esc(x.k)}"><h4>${esc(x.name)} ${chip(x)}</h4><div class="mt mono">${esc(x.v)}</div><div class="mt" style="margin-top:4px">${esc(summary(x))}</div></div>`).join('')}</div></div>
    <div class="card" style="margin-top:16px">${detail(sel)}</div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>AI 신뢰도 기준 (자기 의심 정책) <span class="h2sub">조치 종류 → 근거 모델 → 실제 실행 방식</span></h2>
        ${M.table([['조치', k => esc(KN[k] || k)], ['근거 모델', k => { const t = ML.trustOf(ML.KIND_MODEL[k]); return `${esc(t.name || '')} ${t.level ? chip(t) : ''}`; }], ['실행', k => ML.trustOf(ML.KIND_MODEL[k]).level === 'ok' ? '<span class="tag j-ok">정책대로</span>' : '<span class="tag j-warn">승인 대기로 내림</span>']], Object.keys(ML.KIND_MODEL), { wrap: false })}
        <p class="note">신뢰도 = 검증 구간 적중률이 목표(90% · 80%)에 얼마나 가까운지 − 입력 분포 변화 벌점. 센서 고착처럼 근거 자체가 무너지면 바로 «신뢰 불가».</p></div>
      <div class="card"><h2>입력 분포 변화 (PSI) <span class="h2sub">학습 구간 앞 60% vs 최근 25%</span></h2>
        ${M.table([['입력', 'name'], ['쓰는 모델', x => esc(x.model)], ['PSI', x => isFinite(x.psi) ? f(x.psi, 3) : '—', 'n'], ['판정', x => `<span class="trust ${x.level}">${x.level === 'bad' ? '큰 변화' : x.level === 'warn' ? '주의' : '안정'}</span>`]], psi, { wrap: false })}</div></div>`;
  };
  function summary(x) { const m = x.m;
    if (x.k === 'heat') return `검증 LOT ${m.ntest}개 중 90% 상한 안 ${pct(m.cover, 0)} (목표 90%) · 과산포 φ ${f(m.g.phi, 1)}`;
    if (x.k === 'tool') return `공구 ${m.ev.length}개 «처음 3회 측정만으로» 80% 구간 적중 ${pct(m.cover, 0)}`;
    if (x.k === 'vb') return `±${f(m.q, 3)} mm 구간 · 검증 적중 ${pct(m.cover, 0)} · 최근 공구 ${pct(m.recCover, 0)}`;
    if (x.k === 'insp') return m.stuck.length ? `${m.stuck.join('·')}축 센서 고착 · 이중 기록 ${m.conf}개` : `이중 기록 ${m.conf}개`;
    if (x.k === 'heater') { const z = m.zones.filter(y => y.cp && y.cp.p < 0.1).length; return `변화점 유의 ${z}개 존 / ${m.zones.length}`; }
    if (x.k === 'demand') return `${m.items.length}개 품목 · 95% 서비스 수준 안전재고`;
    return ''; }
  function detail(k) {
    const ML = M.ml;
    if (k === 'heat') { const m = ML.heat(), so = M.dx.activeSO(), cl = so && so.clauses.find(c => c.k === 'heat_ppm'), cand = M.gate ? M.gate.candidates().slice(0, 8) : [];
      return `<h2>열처리 LOT 불량 · 클레임 발생 확률 <span class="h2sub">${esc(m.v)} · 포아송 회귀(노출 = 수량) + 과산포 → 사후 감마</span></h2>
        <div class="grid g2" style="align-items:start"><div><h3 class="dh" style="margin-top:0">조건별 불량률 배수 (90% 구간)</h3>
          ${M.table([['조건', 'name'], ['배수', e => `<b>${f(e.rr, 2)}</b>`, 'n'], ['90% 구간', e => `${f(e.lo, 2)} ~ ${f(e.hi, 2)}`, 'n'], ['판단', e => e.lo > 1 ? '<span class="tag j-danger">불량 ↑ 뚜렷</span>' : e.hi < 1 ? '<span class="tag j-ok">불량 ↓ 뚜렷</span>' : '<span class="tag t-off">불확실</span>']], m.effects, { wrap: false })}
          <p class="note">검증: 앞 70% LOT 로 학습 → 뒤 ${m.ntest}개 LOT 의 실제 불량이 예측 90% 상한 안에 든 비율 ${pct(m.cover, 0)}. 구간이 1 을 걸치면 «데이터로는 효과를 단정할 수 없음» 이라고 그대로 말합니다.</p></div>
          <div><h3 class="dh" style="margin-top:0">출하 대기 LOT 의 클레임 발생 확률 ${cl ? `(기준 ${cl.v} PPM)` : ''}</h3>
          ${cl ? M.table([['LOT', l => `<b>${esc(l.id)}</b>`], ['실제', l => f(l.ppm, 0) + ' PPM', 'n'], ['조건 기대', l => f(ML.claimP(l.id, cl.v).ppmPrior, 0), 'n'], ['사후', l => f(ML.claimP(l.id, cl.v).ppmPost, 0), 'n'], ['확률', l => { const p = ML.claimP(l.id, cl.v).p; return `<div class="pbar"><i style="--w:${(p * 100).toFixed(1)}%"></i><b>${pct(p, 0)}</b></div>`; }]], cand, { wrap: false, click: l => 'gate:' + l.id }) : '<div class="empty">활성 계약 없음</div>'}
          <p class="note">같은 실제 PPM 이라도 조건(이탈 · 히터 · 장입량)이 나쁘면 «참 불량률» 이 기준을 넘을 확률이 높게 나옵니다. 출하 승인은 이 확률 × 클레임 비용과 보류 비용을 비교합니다.</p></div></div>`; }
    if (k === 'tool') { const m = ML.tool(), ts = (M.S.mach || { tools: [] }).tools.filter(t => t.rate), cur = tool || (m.ev.length ? m.ev[m.ev.length - 1].id : (ts[ts.length - 1] || {}).id), cs = cur ? ML.coldStart(cur) : [], last = ts[ts.length - 1], rl = last ? ML.rul(last.id) : null;
      const mx = Math.max(...cs.map(r => r.t90 || 0), ...cs.map(r => r.cross || 0), 1) * 1.05, pos = v => Math.max(0, Math.min(100, v / mx * 100)).toFixed(1);
      return `<h2>공구 잔여 수명 <span class="h2sub">${esc(m.v)} · VB = a·t^b · 재질별 계층 베이즈 사전 + 공구 관측 · 몬테카를로 600회</span></h2>
        ${rl ? `<div class="cnext"><b>지금 공구 ${esc(last.id)}</b> 기준 VB 0.5 까지 ${rl.r10 > 0 || rl.r90 > 0 ? `잔여 <b>${f(rl.r10, 0)} ~ ${f(rl.r90, 0)}회</b> (중앙 ${f(rl.r50, 0)}회)` : '이미 도달'} · 다음 4회 가공 안에 도달할 확률 <b>${pct(rl.pNext(4), 0)}</b></div>` : ''}
        <div class="grid g2" style="align-items:start;margin-top:10px"><div><h3 class="dh" style="margin-top:0">첫날 예측 → 측정이 쌓일수록 좁아지는 구간 <select class="in" id="ml-tool" style="padding:2px 6px;margin-left:6px">${ts.map(t => `<option ${t.id === cur ? 'selected' : ''}>${esc(t.id)}</option>`).join('')}</select></h3>
          ${cs.map(r => `<div style="display:grid;grid-template-columns:96px 1fr 132px;gap:8px;align-items:center;font-size:12.5px"><span>${r.kk === 0 ? '측정 0 (사전만)' : `측정 ${r.k}회`}</span><div class="ival"><i style="left:${pos(r.t10)}%;width:${(pos(r.t90) - pos(r.t10)).toFixed(1)}%"></i><b style="left:${pos(r.t50)}%"></b>${r.cross ? `<em style="left:${pos(r.cross)}%" title="실제 도달"></em>` : ''}</div><span class="mono" style="font-size:11.5px;white-space:nowrap">${f(r.t10, 0)}~${f(r.t90, 0)}분 · 자기 ${pct(r.wOwn, 0)}</span></div>`).join('')}
          <p class="note">막대 = 80% 구간, 진한 선 = 중앙값, 빨간 선 = 실제로 VB 0.5 에 닿은 시간. 측정 0회는 «같은 재질 다른 공구(다른 공장 요약도 가능)» 만으로 낸 첫날 예측입니다 — 2.0 연합학습의 요약 통계와 같은 구조.</p></div>
          <div><h3 class="dh" style="margin-top:0">검증 — 공구 하나씩 빼고 처음 3회 측정만으로</h3>
          ${M.table([['공구', e => `<b>${esc(e.id)}</b>`], ['80% 구간 (분)', e => `${f(e.r.t10, 0)} ~ ${f(e.r.t90, 0)}`, 'n'], ['실제 도달', e => f(e.r.cross, 0), 'n'], ['적중', e => e.hit ? '<span class="ok">✓</span>' : '<span class="ng">✕</span>']], m.ev, { wrap: false })}
          <p class="note">적중률 ${pct(m.cover, 0)} (목표 80%). 표본이 공구 ${m.ev.length}개라 구간이 넓습니다 — 넓게 말하는 것이 정직한 답입니다.</p></div></div>`; }
    if (k === 'vb') { const m = ML.vb();
      return `<h2>VB 센서 추정 <span class="h2sub">${esc(m.v)} · 분할 컨포멀 예측</span></h2>
        ${M.dl([['90% 보장 구간', `추정값 ± ${f(m.q, 3)} mm`], ['보정용 측정', `${m.ncal}개 (짝수 번째 공구)`], ['검증 적중', `${pct(m.cover, 0)} (${m.ntest}개, 목표 90%)`], ['최근 공구 적중', `${pct(m.recCover, 0)} (${m.recent.join(', ')})`]], 'kvl')}
        <p class="note">분포 가정 없이 «새 데이터의 90% 가 이 폭 안» 을 보장하는 방법입니다. 최근 공구의 적중률이 떨어지면(센서 · 조건 변화) 신뢰도를 깎고, 이 추정에 기대는 조치는 승인으로 내려갑니다.</p>`; }
    if (k === 'insp') { const m = ML.insp();
      return `<h2>정밀가공 검사 판정 <span class="h2sub">${esc(m.v)}</span></h2>${M.dl([['고착 센서', m.stuck.length ? m.stuck.join(', ') + '축' : '없음'], ['이중 기록 부품', m.conf + '개'], ['신뢰도', f(m.trust * 100, 0)]], 'kvl')}
        <p class="note">근거 센서가 고착되면 그 판정에 기대는 «검사 강화 지시» 같은 자동 조치를 멈춥니다 — 사람이 승인해야 실행됩니다 (에이전트 화면에 «자기 의심» 표시).</p>`; }
    if (k === 'heater') { const m = ML.heater();
      return `<h2>히터 출력 변화점 <span class="h2sub">${esc(m.v)} · 평균 변화점(순열 p) + CUSUM</span></h2>
        ${M.table([['존', 'label'], ['변화 시작', z => z.cpLot ? `<a href="#" data-go="replay:${esc(String(z.cpLot.end).slice(0, 10))}">${esc(String(z.cpLot.end).slice(0, 10))} →</a>` : '—'], ['전 → 후', z => z.cp ? `${f(z.cp.before, 1)} → <b>${f(z.cp.after, 1)}</b>%` : '—', 'n'], ['우연일 확률 p', z => z.cp ? `<span style="color:${z.cp.p < 0.05 ? 'var(--danger-ink)' : 'inherit'}">${f(z.cp.p, 3)}</span>` : '—', 'n'], ['CUSUM 경보', z => z.cuLot ? esc(String(z.cuLot.end).slice(0, 10)) : '—']], m.zones, { wrap: false })}
        <p class="note">규칙 알람은 «처음 20작업 대비 최근 20작업» 이 5%p 넘을 때 울립니다. 변화점은 «언제부터 달라졌나» 를 찍어 시점 조회로 바로 그날을 볼 수 있게 합니다. 품질 이슈의 「처음 징후」 가 이 날짜와 규칙 알람 날짜의 차이(조기 경보 시간)를 보여 줍니다.</p>`; }
    if (k === 'demand') { const m = ML.demand(), mc = ML.lineMC();
      return `<h2>수요 예측 · 안전재고 <span class="h2sub">${esc(m.v)} · Holt 이중 지수평활 · 95% 서비스 수준</span></h2>
        ${M.table([['품목', i => `<b>${esc(i.code)}</b> ${esc(i.name)}`], ['내일 예측', i => f(i.next, 0), 'n'], ['예측 오차 σ', i => f(i.sigma, 0), 'n'], ['안전재고 (95%)', i => f(i.ss, 0), 'n'], ['지금 규칙 (0.5일)', i => f(i.oldSS, 0), 'n'], ['마감 재고', i => f(i.inv, 0), 'n'], ['결품 확률', i => i.pShort == null ? '—' : `<b style="color:${i.pShort > 0.3 ? 'var(--danger-ink)' : 'inherit'}">${pct(i.pShort, 0)}</b>`, 'n']], m.items, { wrap: false })}
        ${mc ? `<h3 class="dh">라인 하루 산출 분포 (${esc(mc.v)} · 공정별 하루 실적 부트스트랩 2,000회)</h3>${M.dl([['P10 / P50 / P90', `${f(mc.p10, 0)} / <b>${f(mc.p50, 0)}</b> / ${f(mc.p90, 0)}개`], ['목표 달성 확률', `${pct(mc.pMeet, 0)} (목표 ${f(mc.target, 0)}개)`]], 'kvl')}` : ''}
        <p class="note">안전재고를 «0.5일치» 같은 고정 규칙이 아니라 수요가 얼마나 흔들리는지(σ)로 정합니다. 결품 확률은 내일 수요가 지금 재고를 넘을 확률입니다.</p>`; }
    return '';
  }

  M.mod({
    id: 'models', group: '증명하는 AI (4.0)', order: 8,
    menu: [['models', '모델 상태', 'shield']],
    views: V,
    bind(root) {
      root.querySelectorAll('[data-msel]').forEach(b => b.onclick = () => { sel = b.dataset.msel; M.render(); });
      const t = root.querySelector('#ml-tool'); if (t) t.onchange = () => { tool = t.value; M.render(); };
    },
  });
})();
