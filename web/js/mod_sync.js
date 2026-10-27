/* 2.0 ⑤ — 공급망 동기 계획 (완성차 → 1차 → 우리 → 소재)
 * ───────────────────────────────────────────────────────────────
 * 완성차 생산 계획이 바뀌면, 데이터 계약으로 받은 계획을 따라 각 단계의 필요량 · 능력 · 병목이 바로 다시 계산된다.
 * 우리 공장 몫은 라인 운영 모델(공정별 수율 · 능력)로 판단하고, 「변경 전파」를 누르면
 *   우리 라인 목표 · 작업지시 초안 · 협력사 통보(계약 범위 안)가 한 번에 만들어지고 신뢰 원장에 남는다.
 */
(function () {
  'use strict';
  const M = window.MLNG, T = window.MLNGTrust, { esc, f, pct } = M;
  const SC = () => Object.assign({ SEATS_PER_VEHICLE: 2, BRACKETS_PER_SEAT: 2, B_SEAT_CAP: 26000, STEEL_KG: 0.35, STEEL_YIELD: 0.72, D_STEEL_TPD: 22 }, M.CFG.SYNC || {});
  const st = { pct: 0, base: null, msg: '', log: [] };
  T.syncLog = st.log;

  function calc() {
    const c = SC(), L = M.lineSummary ? M.lineSummary() : { possible_per_day: 0, capacity_limit_per_day: 0, bottleneck: '' };
    const per = c.SEATS_PER_VEHICLE * c.BRACKETS_PER_SEAT;
    if (st.base == null) st.base = Math.round(L.possible_per_day / per / 100) * 100;
    const veh = Math.round(st.base * (1 + st.pct / 100)), seats = veh * c.SEATS_PER_VEHICLE, br = seats * c.BRACKETS_PER_SEAT, steel = br * c.STEEL_KG / c.STEEL_YIELD / 1000;
    const tiers = [
      { co: 'OEM-A', what: '차량 조립', need: veh, unit: '대/일', cap: null },
      { co: 'T1-B', what: '시트 어셈블리', need: seats, unit: '세트/일', cap: c.B_SEAT_CAP },
      { co: 'MLNG', what: '스토퍼 브래킷', need: br, unit: '개/일', cap: L.capacity_limit_per_day, now: L.possible_per_day, note: `지금 계획 ${f(L.possible_per_day, 0)} · 병목 ${L.bottleneck}` },
      { co: 'MAT-D', what: '냉연 강판', need: steel, unit: 't/일', cap: c.D_STEEL_TPD, d: 1 },
    ];
    tiers.forEach(t => { t.use = t.cap ? t.need / t.cap : null; t.state = t.use == null ? 'ok' : t.use > 1 ? 'danger' : t.use > 0.9 ? 'warn' : 'ok'; });
    const links = [
      { from: 'OEM-A', to: 'T1-B', scope: 'forecast', label: '차량 계획 → B', c: T.contractFor('OEM-A', 'T1-B', 'forecast'), assumed: true },
      { from: 'T1-B', to: 'MLNG', scope: 'forecast', label: '시트 계획 → 우리', c: T.contractFor('T1-B', 'MLNG', 'forecast') },
      { from: 'MLNG', to: 'MAT-D', scope: 'forecast', label: '소재 계획 → D', c: T.contractFor('MLNG', 'MAT-D', 'forecast') },
    ];
    return { c, L, veh, seats, br, steel, tiers, links, worst: tiers.filter(t => t.use != null).sort((a, b) => b.use - a.use)[0] };
  }

  async function propagate() {
    const r = calc(), me = r.tiers.find(t => t.co === 'MLNG'), out = [];
    if (!T.contractFor('T1-B', 'MLNG', 'forecast')) { st.msg = 'B사 시트 계획 공유 계약이 없어 변경을 받을 수 없습니다 — 데이터 공유 계약에서 «수요 예측» 범위를 계약하세요'; return; }
    await T.access('MLNG', 'T1-B', 'forecast', `시트 계획 ${f(r.seats, 0)}세트/일`);
    if (M.lineApi) { M.lineApi.setTarget(Math.round(me.need)); const x = M.lineApi.fit('cap'); out.push(`우리 라인 목표 ${f(me.need, 0)}개/일 → 공정 속도 조정 (능력 한계 안에서 ${f(x.target, 0)}개/일)`); }
    const gap = Math.max(0, me.need - me.cap);
    if (M.planApi && st.pct > 0) { const add = Math.round((me.need - (r.L.possible_per_day || 0)) / 10) * 10; if (add > 0) { await M.planApi.makeWo((M.S.masters.items[0] || {}).code, add); out.push(`추가 생산 작업지시 초안 ${f(add, 0)}개`); } }
    if (T.contractFor('MLNG', 'T1-B', 'capacity')) { await T.access('T1-B', 'MLNG', 'capacity', `가능 산출 회신 ${f(Math.min(me.need, me.cap), 0)}개/일`); out.push(`B사에 가능 산출 회신 ${f(Math.min(me.need, me.cap), 0)}개/일${gap ? ` (부족 ${f(gap, 0)}개 — 납기 조정 요청)` : ''}`); }
    if (T.contractFor('MLNG', 'MAT-D', 'forecast')) out.push(`D사에 강판 소요 ${f(r.steel, 1)} t/일 공유`); else out.push('D사 소재 계획 공유 계약 없음 — 강판 소요는 공유하지 않음');
    await T.append('MLNG', 'sync', 'SYNC-' + String(st.log.length + 1).padStart(3, '0'), `공급망 계획 변경 전파 — 차량 ${f(r.veh, 0)}대/일 (${st.pct > 0 ? '+' : ''}${st.pct}%) → 브래킷 ${f(r.br, 0)}개/일`, { veh: r.veh, br: r.br, out });
    st.log.unshift({ at: T.stamp(), pct: st.pct, veh: r.veh, br: r.br, out }); st.msg = '';
  }

  const V = {};
  V.sync = () => {
    if (!T.ready) return '<div class="empty">신뢰 계층을 준비하는 중…</div>';
    const r = calc(), me = r.tiers.find(t => t.co === 'MLNG');
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">완성차 계획</div><div class="val">${f(r.veh, 0)}<small>대/일</small></div><div class="foot">기준 대비 ${st.pct > 0 ? '+' : ''}${st.pct}%</div></div>
      <div class="kpi click" data-go="line"><div class="lab">당사 소요량</div><div class="val" style="color:${me.state === 'danger' ? 'var(--danger-ink)' : me.state === 'warn' ? 'var(--warn-ink)' : 'inherit'}">${f(me.need, 0)}<small>개/일</small></div><div class="foot">능력 한계 대비 ${pct(me.use, 0)}</div></div>
      <div class="kpi"><div class="lab">공급망 병목</div><div class="val" style="font-size:16px">${esc(T.co(r.worst.co).name)}</div><div class="foot">사용률 ${pct(r.worst.use, 0)}</div></div>
      <div class="kpi"><div class="lab">계획 공유 계약</div><div class="val">${r.links.filter(l => l.c || l.assumed).length}<small>/ ${r.links.length}</small></div><div class="foot">계약 있는 구간만 자동 전파</div></div>
    </div>
    <div class="card"><h2>완성차 계획 변경 <span class="h2sub">값을 바꾸면 공급망 전 단계가 다시 계산됩니다</span></h2>
      <div class="syc"><input type="range" min="-30" max="50" step="5" value="${st.pct}" id="sy-pct"><b id="sy-pv">${st.pct > 0 ? '+' : ''}${st.pct}%</b>
        <span class="muted">기준 ${f(st.base, 0)}대/일 (우리 지금 계획 가능 산출 ÷ 차량당 브래킷 ${r.c.SEATS_PER_VEHICLE * r.c.BRACKETS_PER_SEAT}개)</span>
        <button class="btn pri sm" id="sy-go" style="margin-left:auto">변경 전파</button></div>
      <div class="sychain">${r.tiers.map((t, i) => `${i ? (() => { const l = r.links[i - 1]; return `<div class="sylink ${l.c || l.assumed ? 'ok' : 'no'}"><div class="syl">${esc(l.label)}</div><div class="sya"></div><div class="syc2">${l.c ? '계약 ' + esc(l.c.id) : l.assumed ? 'A↔B 계약 (가정)' : '계약 없음'}</div></div>`; })() : ''}
        <div class="sytier ${t.state} ${t.co === 'MLNG' ? 'me' : ''}"><div class="syco" style="--cc:${T.co(t.co).color}"><b>${esc(T.co(t.co).short)}</b>${esc(T.co(t.co).name)}</div><div class="muted" style="font-size:12px">${esc(t.what)}</div>
          <div class="synd">${f(t.need, t.d || 0)}<small> ${esc(t.unit)}</small></div>
          ${t.cap ? `<div class="sybar"><i style="--w:${Math.min(100, t.use * 100)}%"></i></div><div class="muted" style="font-size:12px">능력 ${f(t.cap, t.d || 0)} · 사용률 <b style="color:${t.state === 'danger' ? 'var(--danger-ink)' : t.state === 'warn' ? 'var(--warn-ink)' : 'inherit'}">${pct(t.use, 0)}</b></div>` : '<div class="muted" style="font-size:12px">계획 출발점</div>'}
          ${t.note ? `<div class="muted" style="font-size:11.5px;margin-top:3px">${esc(t.note)}</div>` : ''}</div>`).join('')}</div>
      ${st.msg ? `<p class="note msg" style="color:var(--danger-ink)">${esc(st.msg)}</p>` : ''}
      <p class="note">차량 1대 = 시트 ${r.c.SEATS_PER_VEHICLE}세트 = 브래킷 ${r.c.SEATS_PER_VEHICLE * r.c.BRACKETS_PER_SEAT}개 · 브래킷 1개 강판 ${r.c.STEEL_KG} kg (수율 ${pct(r.c.STEEL_YIELD, 0)}). B·D 능력은 예시값 (config.js SYNC). 우리 능력은 라인 운영의 관측 최대 기준입니다.</p></div>
    <div class="card" style="margin-top:16px"><h2>전파 기록 <a class="more" href="#" data-go="net_ledger">신뢰 원장 →</a></h2>
      ${st.log.length ? st.log.map(l => `<div class="sylog"><div><b>${esc(l.at.slice(5, 16))}</b> 차량 ${f(l.veh, 0)}대/일 (${l.pct > 0 ? '+' : ''}${l.pct}%) → 브래킷 ${f(l.br, 0)}개/일</div><ul class="plain">${l.out.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>`).join('') : '<div class="empty">아직 전파한 변경이 없습니다 — 계획을 바꾸고 「변경 전파」를 누르세요</div>'}</div>`;
  };

  M.mod({
    id: 'sync', group: '연결 · 신뢰 (2.0)', order: 53,
    menu: [['sync', '공급망 동기 계획', 'sync']],
    views: V,
    bind(root) {
      const r = root.querySelector('#sy-pct');
      if (r) { r.oninput = () => { M.$('#sy-pv').textContent = (r.value > 0 ? '+' : '') + r.value + '%'; }; r.onchange = () => { st.pct = +r.value; M.render(); }; }
      const g = root.querySelector('#sy-go'); if (g) g.onclick = async () => { await propagate(); M.render(); };
    },
  });
})();
