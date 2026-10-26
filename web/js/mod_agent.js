/* 2.0 ④ — 에이전트 MES (감지 → 원인 → 조치안 → 승인 → 실행)
 * ───────────────────────────────────────────────────────────────
 * 1.0 은 «알려 주고 답하는» MES. 2.0 에이전트는 알림·클레임·계획 부족을 스스로 점검해 조치안을 만들고,
 * 회사가 정한 정책(자동 실행 / 승인 후 실행 / 제안만)에 따라 실행한다. 모든 실행은 신뢰 원장에 우리 서명으로 남는다.
 *   조치 종류: 공구·소모품 발주 · 검사 강화 지시 · 설비 점검 지시 · 라인 속도 맞춤 · 작업지시 초안 · 협력사 통보 · 클레임 대응안
 */
(function () {
  'use strict';
  const M = window.MLNG, T = window.MLNGTrust, { esc, f } = M;
  const KINDS = {
    buy: { name: '공구·소모품 발주', def: 'approve', note: '발주는 만들고, 결재는 사람이 합니다' },
    insp: { name: '검사 강화 지시', def: 'auto', note: '검사 셀에 대상 LOT·기준 전달' },
    maint: { name: '설비 점검 지시', def: 'auto', note: '보전 담당에게 점검 지시' },
    line: { name: '라인 속도 맞춤', def: 'approve', note: '라인 운영 속도를 목표에 맞춤' },
    wo: { name: '작업지시 초안', def: 'approve', note: '부족 예상 품목 생산 작업지시' },
    notify: { name: '협력사 통보', def: 'approve', note: '데이터 계약 범위 안에서만' },
    claim: { name: '클레임 대응안', def: 'suggest', note: '대응 방향만 제안' },
  };
  const MODE = { auto: '자동 실행', approve: '승인 후 실행', suggest: '제안만' };
  const pol = {}; Object.keys(KINDS).forEach(k => pol[k] = KINDS[k].def);
  const Q = T.agent = { items: [], log: [], lastScan: null, autoOn: true };
  let seq = 0;

  // ── 점검: 지금 데이터에서 조치안 만들기
  function plans() {
    const out = [], A = M.alerts(), buy = M.buyApi;
    const add = (key, kind, trig, why, act, exec) => { if (Q.items.some(x => x.key === key && x.status !== 'rejected')) return; out.push({ key, kind, trig, why, act, exec }); };
    A.forEach(a => {
      const codes = buy ? buy.itemsFor(a) : [];
      if (a.proc === 'mach' && a.level === 'danger') {
        add('buy:' + a.title, 'buy', a, ['공구 마모가 교체 기준을 넘음', '같은 재질·조건에서 마모 속도가 빠름 (스테인리스강)', `인서트 확보 — ${codes.join(', ')}`], `공구 발주 초안 (${codes.join(', ')})`, async () => { const po = await buy.createPO(codes.map(code => ({ code })), '에이전트 제안 — ' + a.title, 'AI 에이전트'); return `${po.id} 발주 등록 (결재 대기)`; });
      }
      if (a.proc === 'mach' && /넘겨 가공/.test(a.title)) add('insp:' + a.title, 'insp', a, ['교체 기준을 넘긴 공구로 가공한 부품이 있음', '마모된 공구는 치수·버 불량 위험', '해당 부품 검사 강화'], '검사 셀에 검사 강화 지시 (해당 가공 부품 전수)', async () => '검사 셀에 강화 지시 전달 — 대상 부품 전수 측정');
      if (a.proc === 'press' && a.level === 'danger') {
        add('maint:' + a.title, 'maint', a, ['진동이 정상 기준(상위 1%)을 크게 넘음', '금형·크랭크·클러치 이상 후보', '다음 증속 전 설비 점검'], 'PR-01 설비 점검 지시', async () => '보전 담당에게 PR-01 점검 지시 — 금형·크랭크·클러치');
        if (codes.length) add('buy:' + a.title, 'buy', a, ['설비 이상이 금형 손상으로 이어질 수 있음', '예비품이 없으면 정지 시간이 길어짐', `예비품 확보 — ${codes.join(', ')}`], `예비품 발주 초안 (${codes.join(', ')})`, async () => { const po = await buy.createPO(codes.map(code => ({ code })), '에이전트 제안 — ' + a.title, 'AI 에이전트'); return `${po.id} 발주 등록 (결재 대기)`; });
      }
      if (a.proc === 'heat' && /히터/.test(a.title)) add('maint:' + a.title, 'maint', a, ['같은 온도 유지에 드는 히터 출력이 늘어남', '히터 열화·단열재 손상 후보', '점검 + 히터 예비품'], '소입로 히터·단열재 점검 지시', async () => '보전 담당에게 소입로 2존 히터·단열재 점검 지시');
      if (a.proc === 'insp' && /변하지 않음/.test(a.title)) add('maint:' + a.title, 'maint', a, ['측정값이 모든 부품에서 같음', '센서 고착·배선 문제 후보', '센서 점검 · 해당 축 판정 보류'], '검사 셀 센서 점검 지시', async () => '검사 셀 센서 점검 지시 — 해당 축 판정 보류');
    });
    // 생산 계획 부족 → 작업지시 초안
    if (M.planApi) M.planApi.items().forEach(it => { const s = M.planApi.stat(it); if (s.short && s.need) add('wo:' + it + s.last.date, 'wo', { title: `${it} 마감 재고 ${f(s.last.inv_close, 0)} < 예상 수주 ${f(s.avg, 0)}`, level: 'warn', go: 'plan_home' },
      ['내일 예상 수주보다 재고가 적음', '아침 출하 전 생산이 없으면 결품', `${f(s.need, 0)}개 (${s.runs}회) 생산`], `${it} 작업지시 초안 ${f(s.need, 0)}개`, async () => { await M.planApi.makeWo(it, s.need); return `${it} 작업지시 초안 ${f(s.need, 0)}개 생성`; }); });
    // 라인 병목 → 속도 맞춤
    const L = M.lineSummary && M.lineSummary();
    if (L && L.possible_per_day < L.target_per_day * 0.95 && M.lineApi) add('line:' + L.bottleneck + Math.round(L.target_per_day), 'line', { title: `지금 계획 가능 산출 ${f(L.possible_per_day, 0)} < 목표 ${f(L.target_per_day, 0)}`, level: 'warn', go: 'line' },
      [`병목 ${L.bottleneck} 공정`, '앞뒤 공정 처리량이 맞지 않아 재공이 줄어듦', '공정별 속도를 목표에 맞춤 (능력 한계 안)'], '라인 속도를 능력 한계 안에서 목표에 맞춤', async () => { const r = M.lineApi.fit('cap'); return `공정별 속도 조정 — 목표 ${f(r.target, 0)}개/일 기준`; });
    // 스마트 발주 클레임 → 대응안 + 협력사 통보
    (T.orders || []).forEach(o => o.deliveries.filter(d => d.claim && d.claim.status === 'open').forEach(d => {
      const bad = d.checks.filter(c => !c.ok).map(c => c.k);
      add('claim:' + d.claim.id, 'claim', { title: `${d.claim.id} ${d.lot} 클레임`, level: 'warn', go: `dl:${o.id}|${d.lot}` }, ['계약 조항 미달 납품', bad.includes('heat_ppm') ? '해당 열처리 작업의 조건·히터 출력 확인 필요' : '미달 조항의 공정 데이터 확인 필요', '재검사 요청 또는 수용 판단'],
        `대응안: ${bad.includes('heat_ppm') ? '열처리 작업 프로파일 확인 → 이탈 없으면 재검사 요청, 이탈 있으면 수용' : '근거 확인 후 재검사 요청'}`, async () => '대응안을 품질 담당에게 전달');
      if (T.contractFor('MLNG', o.buyer, 'quality_kpi')) add('notify:' + d.claim.id, 'notify', { title: `${d.claim.id} 협력사 통보`, level: 'info', go: `dl:${o.id}|${d.lot}` }, ['클레임이 열림', `${T.co(o.buyer).name}와 품질 지표 공유 계약 유효`, '원인 조사 착수·예상 회신일 통보'],
        `${T.co(o.buyer).name}에 원인 조사 착수 통보`, async () => { await T.access(o.buyer, 'MLNG', 'quality_kpi', d.claim.id + ' 조사 착수 통보'); return `${T.co(o.buyer).name}에 통보 (계약 범위 안)`; });
    }));
    return out;
  }
  async function run(it) {
    try { it.result = await it.exec(); it.status = 'done'; it.done = T.stamp(); }
    catch (e) { it.result = '실패 — ' + e.message; it.status = 'failed'; }
    await T.append('MLNG', 'agent', it.id, `에이전트 ${it.status === 'done' ? '실행' : '실패'} — ${KINDS[it.kind].name}: ${it.result}`, { id: it.id, kind: it.kind, act: it.act, result: it.result });
    Q.log.unshift({ at: T.stamp(), id: it.id, kind: it.kind, text: it.result, by: it.approvedBy || '자동' });
  }
  async function scan() {
    const ps = plans();
    for (const p of ps) {
      const it = Object.assign({ id: `AG-${String(++seq).padStart(3, '0')}`, at: T.stamp(), mode: pol[p.kind], status: pol[p.kind] === 'suggest' ? 'suggested' : 'pending' }, p);
      Q.items.unshift(it);
      if (it.mode === 'auto') await run(it);
    }
    Q.lastScan = { at: T.stamp(), n: ps.length };
    return ps.length;
  }
  T.agentScan = scan;
  T.onInit(async () => { await scan(); });
  // 실시간 반영이 켜져 있으면 1분마다 다시 점검
  setInterval(() => { if (T.ready && Q.autoOn && M.live && M.live.on() && M.D.LIVE) scan().then(n => { if (n && M.cur === 'agent') M.render(); }); }, 60000);

  // ── 화면
  let fq = 'open';
  const V = {};
  V.agent = () => {
    if (!T.ready) return '<div class="empty">에이전트를 준비하는 중…</div>';
    const its = Q.items.filter(x => fq === 'all' || (fq === 'open' ? ['pending', 'suggested'].includes(x.status) : x.status === fq));
    const pend = Q.items.filter(x => x.status === 'pending');
    return `<div class="kstrip">
      <div class="kpi click" data-aq="open"><div class="lab">처리 대기</div><div class="val" style="color:${pend.length ? 'var(--warn-ink)' : 'inherit'}">${pend.length}<small>건</small></div><div class="foot">승인하면 실행</div></div>
      <div class="kpi click" data-aq="done"><div class="lab">실행 완료</div><div class="val">${Q.items.filter(x => x.status === 'done').length}<small>건</small></div><div class="foot">자동 ${Q.items.filter(x => x.status === 'done' && x.mode === 'auto').length} · 승인 ${Q.items.filter(x => x.status === 'done' && x.mode === 'approve').length}</div></div>
      <div class="kpi click" data-aq="suggested"><div class="lab">제안</div><div class="val">${Q.items.filter(x => x.status === 'suggested').length}<small>건</small></div><div class="foot">사람이 판단</div></div>
      <div class="kpi"><div class="lab">마지막 점검</div><div class="val" style="font-size:15px">${esc(Q.lastScan ? Q.lastScan.at.slice(11, 16) : '—')}</div><div class="foot">${Q.lastScan ? `조치안 ${Q.lastScan.n}건 새로 찾음` : ''}</div></div>
    </div>
    <div class="card"><h2>조치안 <span class="h2sub">감지 → 원인 후보 → 조치 — 정책에 따라 자동 실행하거나 승인을 기다립니다</span>
      <span class="more" style="display:flex;gap:6px;align-items:center"><label class="ck" style="font-size:12.5px"><input type="checkbox" id="ag-auto" ${Q.autoOn ? 'checked' : ''}> 실시간 반영 중 1분마다 자동 점검</label><button class="btn pri sm" id="ag-scan">지금 점검</button></span></h2>
      <div class="tools">${M.seg('aq', fq, [['open', '처리 대기·제안'], ['done', '실행 완료'], ['rejected', '반려'], ['all', '전체']])}</div>
      ${its.length ? `<div class="aglist">${its.map(it => `<div class="ag ${esc(it.status)}">
        <div class="agh"><span class="tag ${it.status === 'done' ? 'j-ok' : it.status === 'rejected' ? 't-off' : it.status === 'suggested' ? 'j-ok' : 'j-warn'}">${esc({ pending: '승인 대기', done: '실행됨', rejected: '반려', suggested: '제안', failed: '실패' }[it.status])}</span>
          <b>${esc(it.act)}</b><span class="chip c-ext">${esc(KINDS[it.kind].name)} · ${esc(MODE[it.mode])}</span><span class="muted" style="margin-left:auto;font-size:12px">${esc(it.id)} · ${esc(it.at.slice(5, 16))}</span></div>
        <div class="agw">${it.why.map((w, i) => `<span><i>${['감지', '원인 후보', '조치'][i]}</i>${esc(w)}</span>`).join('<b>→</b>')}</div>
        <div class="agf"><a href="#" data-go="${esc(it.trig.go || 'alerts')}">근거: ${esc(it.trig.title)}</a>
          ${it.status === 'pending' ? `<button class="btn pri sm" data-agok="${esc(it.id)}">승인 · 실행</button><button class="btn sm" data-agno="${esc(it.id)}">반려</button>` : ''}
          <button class="btn sm" data-askq="${esc(`${it.trig.title} — 에이전트가 「${it.act}」를 제안했어. 근거와 다른 선택지를 알려줘`)}">Claude에게 묻기</button>
          ${it.result ? `<span class="muted" style="font-size:12.5px">결과: ${esc(it.result)}</span>` : ''}</div></div>`).join('')}</div>` : '<div class="empty">해당하는 조치안이 없습니다</div>'}</div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>실행 정책 <span class="h2sub">조치 종류마다 회사가 정합니다</span></h2>
        ${M.table([['조치', k => `<b>${esc(KINDS[k].name)}</b><div class="muted" style="font-size:12px">${esc(KINDS[k].note)}</div>`], ['정책', k => `<div class="seg sm">${Object.keys(MODE).map(m => `<button data-pol="${k}|${m}" class="${pol[k] === m ? 'on' : ''}">${esc(MODE[m])}</button>`).join('')}</div>`]], Object.keys(KINDS), { wrap: false })}</div>
      <div class="card"><h2>실행 기록 <a class="more" href="#" data-go="net_ledger">신뢰 원장 →</a></h2>
        ${M.table([['시각', l => `<span class="muted">${esc(l.at.slice(5, 16))}</span>`], ['조치', l => esc(KINDS[l.kind].name)], ['결과', 'text'], ['승인', 'by']], Q.log.slice(0, 15), { wrap: false, empty: '아직 실행한 조치가 없습니다' })}</div></div>`;
  };

  M.mod({
    id: 'agent', group: '현황', order: 2,
    menu: [['agent', 'AI 에이전트', 'agent']],
    views: V,
    alerts: () => { const p = Q.items.filter(x => x.status === 'pending'); return p.length ? [{ proc: 'agent', level: 'info', title: `에이전트 조치안 승인 대기 ${p.length}건`, body: p.slice(0, 3).map(x => x.act).join(' · '), by: 'AI 에이전트', at: p[0].at, go: 'agent' }] : []; },
    bind(root) {
      const on = (s, fn) => { const e = root.querySelector(s); if (e) e.onclick = fn; };
      on('#ag-scan', async () => { await scan(); M.render(); });
      const au = root.querySelector('#ag-auto'); if (au) au.onchange = () => { Q.autoOn = au.checked; };
      root.querySelectorAll('[data-aq]').forEach(b => b.onclick = () => { fq = b.dataset.aq; M.render(); });
      root.querySelectorAll('[data-pol]').forEach(b => b.onclick = () => { const [k, m] = b.dataset.pol.split('|'); pol[k] = m; Q.items.filter(x => x.kind === k && ['pending', 'suggested'].includes(x.status)).forEach(x => { x.mode = m; x.status = m === 'suggest' ? 'suggested' : 'pending'; }); M.render(); });
      root.querySelectorAll('[data-agok]').forEach(b => b.onclick = async () => { const it = Q.items.find(x => x.id === b.dataset.agok); it.approvedBy = M.D.user().name; await run(it); M.render(); });
      root.querySelectorAll('[data-agno]').forEach(b => b.onclick = async () => { const it = Q.items.find(x => x.id === b.dataset.agno); it.status = 'rejected'; await T.append('MLNG', 'agent', it.id, `에이전트 조치안 반려 — ${it.act}`, { id: it.id }); M.render(); });
      root.querySelectorAll('[data-askq]').forEach(b => b.onclick = e => { e.stopPropagation(); if (M.askApi) M.askApi.ask(b.dataset.askq); });
    },
  });
  M.PROC.agent = '에이전트';
})();
