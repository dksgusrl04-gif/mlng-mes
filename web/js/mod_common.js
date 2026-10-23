/* 공통 화면 — 공장 현황 · 통합 알림 · 작업지시·LOT 이력 · 기준 정보 · 데이터 상태
 * 공정 모듈이 늘어나도 이 화면들은 그대로다 (모듈의 summary·alerts·LOT 만 읽는다).
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f } = M;
  const RD = () => M.CFG.RECENT_DAYS || 7;
  const modOf = p => M.mods.find(m => m.proc === p);
  const eq = id => M.S.masters.equipment.find(e => e.id === id) || {};
  const item = c => (M.S.masters.items.find(i => i.code === c) || {}).name || c;
  const STATUS = { live: ['ok', '연결됨'], external: ['ext', '별도 시스템'], planned: ['off', '준비 중'] };

  // 데이터 문제 중 현장에서 손을 써야 하는 것만
  function dataAlerts() {
    const out = [], S = M.S;
    if (M.D.LIVE && S.asof) {
      const h = (Date.now() - M.toDate(S.asof).getTime()) / 3600000;
      if (h >= (M.CFG.STALE_HOURS || 24)) out.push({ proc: 'data', level: 'warn', title: `설비 데이터 ${f(h, 0)}시간째 새 작업 없음`, body: `마지막 작업 종료 ${S.asof} — 설비 수집기 연결을 확인하세요`, by: '데이터 점검', at: S.asof, go: 'data' });
    }
    const steps = S.masters.routings.filter(r => (eq(r.equipment_id).status || 'planned') === 'planned');
    if (steps.length) out.push({ proc: 'data', level: 'info', title: `공정 ${steps.length}곳의 이력이 아직 연결되지 않았습니다`, body: `${steps.map(s => s.step_name).join(' · ')} — 연결 전에는 LOT 이력이 해당 공정에서 끊깁니다`, by: '데이터 점검', at: S.asof, go: 'trace' });
    return out;
  }

  const V = {};
  V.overview = () => {
    const S = M.S, al = M.alerts(), act = al.filter(a => a.level !== 'info');
    const since = M.sinceDay(RD()).getTime();
    const lots = S.lots.filter(l => l.kind === 'process' && M.toDate(l.end_at).getTime() >= since);
    const rout = S.masters.routings.filter(r => r.item_code === (S.masters.items[0] || {}).code);
    const liveProcs = rout.filter(r => (eq(r.equipment_id).status) === 'live').map(r => r.proc);
    const lastProc = M.CFG.OUTPUT_PROC || liveProcs[liveProcs.length - 1];   // 생산 수량을 세는 공정 하나 (공정마다 더하면 중복)
    const qty = lots.filter(l => l.proc === lastProc).reduce((s, l) => s + (l.qty || 0), 0), bad = lots.reduce((s, l) => s + (l.bad || 0), 0);
    const byProc = p => lots.filter(l => l.proc === p);
    return `
    <div class="kstrip">
      <div class="kpi"><div class="lab">완료 작업 · 최근 ${RD()}일</div><div class="val">${lots.length}<small>건</small></div><div class="foot">${liveProcs.map(p => `${esc(M.PROC[p])} ${byProc(p).length}`).join(' · ')}</div></div>
      <div class="kpi"><div class="lab">생산 수량 · 최근 ${RD()}일</div><div class="val">${f(qty, 0)}<small>개</small></div><div class="foot">${esc(M.PROC[lastProc] || '')} 완료 기준 · ${esc(item((S.masters.items[0] || {}).code))}</div></div>
      <div class="kpi"><div class="lab">공정 불량 · 최근 ${RD()}일</div><div class="val">${f(bad, 0)}<small>개</small></div><div class="foot">${liveProcs.filter(p => byProc(p).some(l => l.bad != null)).map(p => `${esc(M.PROC[p])} ${f(byProc(p).reduce((s, l) => s + (l.bad || 0), 0), 0)}`).join(' · ')}</div></div>
      <div class="kpi click" data-go="alerts"><div class="lab">조치 필요 알림</div><div class="val" style="color:${al.some(a => a.level === 'danger') ? 'var(--danger-ink)' : 'inherit'}">${act.length}<small>건</small></div><div class="foot">긴급 ${al.filter(a => a.level === 'danger').length} · 주의 ${al.filter(a => a.level === 'warn').length}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>공정 흐름 <span class="h2sub">${esc(item((S.masters.items[0] || {}).code))} · ${esc(S.factory.line || '')}</span></h2>
      <div class="route">${rout.map((r, i) => {
        const e = eq(r.equipment_id), st = e.status || 'planned', [cls, txt] = STATUS[st], m = modOf(r.proc), sm = st === 'live' && m && m.summary ? m.summary(S) : null;
        const go = sm ? sm.go : st === 'external' && (M.CFG.LINKS || {})[r.proc] ? 'link:' + r.proc : '';
        return `${i ? '<div class="arrow" aria-hidden="true"></div>' : ''}<div class="step st-${cls} ${go ? 'click' : ''}" ${go ? `data-go="${esc(go)}"` : ''}>
          <div class="sq">${r.seq}</div><div class="nm">${esc(r.step_name)}</div><div class="eq">${esc(e.name || r.equipment_id)}</div>
          ${sm ? `<div class="kv ${sm.st}">${esc(sm.kpi)}</div><div class="sb">${esc(sm.sub)}</div>` : `<div class="sb">${st === 'external' ? (go ? '새 탭에서 열기 →' : '별도 시스템에서 관리') : '모듈 준비 중'}</div>`}
          <span class="chip c-${cls}">${txt}</span></div>`;
      }).join('')}</div></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>조치 필요 <a class="more" href="#" data-go="alerts">전체 알림 →</a></h2>
        <div class="lst">${act.slice(0, 5).map(a => `<div class="it ${a.go ? 'click' : ''}" ${a.go ? `data-row="${esc(a.go)}"` : ''}><span class="dot ${esc(a.level)}"></span><div class="m"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.body || '')}</div></div>${M.procTag(a.proc)}</div>`).join('') || '<div class="empty">조치할 항목이 없습니다</div>'}</div></div>
      <div class="card"><h2>최근 작업지시 <a class="more" href="#" data-go="trace">LOT 이력 →</a></h2>
        ${M.table([['작업지시', r => `<b>${esc(r.wo_id)}</b>`], ['수량', r => f(r.qty, 0), 'n'],
          ['공정 진행', r => { const done = new Set([r.proc].concat(M.lineage(r.id).up.map(l => l.proc)));
            return `<span class="prog">${rout.map(x => `<i class="${done.has(x.proc) ? 'done' : (eq(x.equipment_id).status === 'live' ? '' : 'na')}" title="${esc(x.step_name)}"></i>`).join('')}</span>`; }],
          ['종료', r => esc(String(r.end_at || '').slice(5, 16))]], S.lots.filter(l => l.kind === 'process' && l.proc === lastProc).slice(-6).reverse(), { wrap: false, click: r => 'trace:' + r.id })}</div>
    </div>`;
  };

  let af = 'all';
  V.alerts = () => {
    const all = M.alerts(), procs = [...new Set(all.map(a => a.proc))];
    const al = all.filter(a => af === 'all' || a.proc === af);
    return `<div class="tools">${M.seg('af', af, [['all', '전체']].concat(procs.map(p => [p, M.PROC[p] || p])))}<span class="tsum">${al.length}건</span></div>
      <div class="card">${al.length ? `<div class="alist">${al.map(a => `<div class="al ${esc(a.level)} ${a.go ? 'click' : ''}" ${a.go ? `data-row="${esc(a.go)}"` : ''}><div class="lv"></div><div style="min-width:0">
        <div class="tt">${esc(a.title)}</div>${a.body ? `<div class="bd">${esc(a.body)}</div>` : ''}
        <div class="mt">${M.procTag(a.proc)}<span>${esc(a.by || '')}</span><span>${esc(a.at || '')}</span></div></div></div>`).join('')}</div>` : '<div class="empty">알림이 없습니다</div>'}</div>`;
  };

  // ── LOT 이력: 작업지시 · 공정 LOT · 소재 LOT 어느 것으로 찾아도 앞뒤 공정을 보여 준다
  let tq = '';
  function findTrace(q) {
    const S = M.S, L = S.lots, k = q.trim().toUpperCase();
    if (!k) return null;
    const mat = L.find(l => l.kind === 'material' && l.id.toUpperCase() === k);
    if (mat) return { mat, mats: [mat], line: M.lineage(mat.id).down, procs: M.lineage(mat.id).down };
    const p = L.find(l => l.kind === 'process' && (l.id.toUpperCase() === k || String(l.wo_id).toUpperCase() === k)) || L.find(l => l.kind === 'process' && (l.id + l.wo_id).toUpperCase().includes(k));
    if (!p) return { none: true };
    const lg = M.lineage(p.id), mats = lg.up.filter(l => l.kind === 'material');
    const scope = []; mats.forEach(m => M.lineage(m.id).down.forEach(l => { if (!scope.some(x => x.id === l.id)) scope.push(l); }));
    return { mat: mats[0], mats, focus: p, line: [p].concat(lg.up, lg.down), procs: scope.length ? scope.sort((a, b) => String(a.end_at).localeCompare(String(b.end_at))) : [p] };
  }
  V.trace = () => {
    const S = M.S, lastP = S.lots.filter(l => l.kind === 'process').slice(-1)[0];
    if (!tq && lastP) tq = lastP.id;
    const r = findTrace(tq), rout = S.masters.routings.filter(x => x.item_code === (S.masters.items[0] || {}).code);
    let body = '<div class="empty">작업지시 · 공정 LOT · 소재 LOT 번호를 입력하세요</div>';
    if (r && r.none) body = `<div class="empty">«${esc(tq)}» 를 찾지 못했습니다</div>`;
    else if (r) {
      const p = r.focus;
      const node = (cls, a, b, c, go) => `<div class="tnode t-${cls} ${go ? 'click' : ''}" ${go ? `data-row="${esc(go)}"` : ''}><div class="a">${a}</div><div class="b">${b}</div><div class="c">${c}</div></div>`;
      const chain = [node('mat', '소재 LOT', r.mats.length ? esc(r.mats[0].id) + (r.mats.length > 1 ? ` 외 ${r.mats.length - 1}` : '') : '—', r.mat ? `${esc(r.mat.first)} ~ ${esc(String(r.mat.last).slice(5))} 투입` : '기록 없음')]
        .concat(rout.map(x => {
          const ls = r.line.filter(l => l.proc === x.proc), lot = ls.find(l => p && l.id === p.id) || ls[0], st = eq(x.equipment_id).status || 'planned';
          if (lot) return node(p && lot.id === p.id ? 'done sel' : 'done', esc(x.step_name), esc(lot.id) + (ls.length > 1 ? ` <span class="muted">외 ${ls.length - 1}</span>` : ''),
            `${f(lot.qty, 0)}개 · 불량 ${f(lot.bad, 0)} · ${esc(String(lot.end_at).slice(5, 16))}`, `${lot.proc}:${lot.id}`);
          if (st === 'live') return node('off', esc(x.step_name), '—', '이 기간 기록 없음');
          return node(st === 'external' ? 'ext' : 'off', esc(x.step_name), '—', st === 'external' ? '별도 시스템 (연결 예정)' : '모듈 연결 전');
        }));
      const ins = M.inspections().filter(i => r.procs.some(l => l.id === i.lot_id));
      body = `<div class="tchain">${chain.join('<div class="arrow" aria-hidden="true"></div>')}</div>
        ${r.mat ? `<h3 class="sub3">소재 LOT ${r.mats.map(m => esc(m.id)).join(' · ')} 로 만든 작업 전체 <span class="muted">— 소재 문제일 때 함께 확인할 범위</span></h3>
          ${M.table([['공정 LOT', l => `<b>${esc(l.id)}</b>${p && l.id === p.id ? ' <span class="tag t-안정">선택</span>' : ''}`], ['공정', l => M.procTag(l.proc)], ['작업지시', 'wo_id'], ['설비', l => esc(eq(l.equipment_id).name || l.equipment_id)],
            ['작업자', l => esc(l.worker || '—')], ['종료', l => esc(String(l.end_at).slice(5, 16))], ['수량', l => f(l.qty, 0), 'n'], ['불량', l => f(l.bad, 0), 'n'], ['불량률', l => !l.qty || l.bad == null ? '—' : l.bad / l.qty >= 0.01 ? M.pct(l.bad / l.qty, 1) : `${f(l.bad / l.qty * 1e6, 0)} PPM`, 'n']],
            r.procs, { wrap: false, click: l => `${l.proc}:${l.id}` })}
          <p class="note">${[...new Set(r.procs.map(l => l.proc))].map(pp => { const g = r.procs.filter(l => l.proc === pp); return `${esc(M.PROC[pp])} ${g.length}작업 · ${f(g.reduce((s, l) => s + l.qty, 0), 0)}개 · 불량 ${f(g.reduce((s, l) => s + l.bad, 0), 0)}`; }).join('  /  ')}</p>` : ''}
        ${ins.length ? `<h3 class="sub3">검사 기록</h3>${M.table([['시각', 'at'], ['LOT', 'lot_id'], ['결과', 'result'], ['코드', 'defect_code'], ['수량', 'qty', 'n'], ['기록', 'by']], ins, { wrap: false })}` : ''}`;
    }
    return `<div class="card"><div class="tools"><input class="in" id="tq" placeholder="작업지시 · 공정 LOT · 소재 LOT (예: HT-102410, M22-005)" value="${esc(tq)}" style="width:380px">
      <button class="btn pri sm" id="tgo">찾기</button><span class="tsum">최근: ${S.lots.filter(l => l.kind === 'process').slice(-3).reverse().map(l => `<a href="#" data-trace="${esc(l.id)}">${esc(l.id)}</a>`).join(' · ')}</span></div>${body}</div>`;
  };

  let mt = 'route';
  V.masters = () => {
    const S = M.S.masters;
    const T = {
      route: () => M.table([['품목', r => `<b>${esc(r.item_code)}</b> ${esc(item(r.item_code))}`], ['순서', 'seq', 'n'], ['공정', r => M.procTag(r.proc)], ['공정명', 'step_name'], ['설비', r => esc(eq(r.equipment_id).name || '')],
        ['연결', r => { const [c, t] = STATUS[eq(r.equipment_id).status || 'planned']; return `<span class="chip c-${c}">${t}</span>`; }]], S.routings, { wrap: false }),
      equip: () => M.table([['설비', r => `<b>${esc(r.id)}</b>`], ['이름', 'name'], ['공정', r => M.procTag(r.proc)], ['라인', 'line'], ['구성', r => esc((r.meta || {}).zones || '')],
        ['연결', r => { const [c, t] = STATUS[r.status || 'planned']; return `<span class="chip c-${c}">${t}</span>`; }]], S.equipment, { wrap: false }),
      codes: () => M.table([['코드', r => `<b>${esc(r.code)}</b>`], ['공정', r => M.procTag(r.proc)], ['불량명', 'name']], S.defect_codes, { wrap: false }),
      workers: () => M.table([['ID', 'id'], ['이름', 'name']], S.workers, { wrap: false }),
    };
    return `<div class="card"><div class="tools">${M.seg('mt', mt, [['route', '품목 · 공정 순서'], ['equip', '설비'], ['codes', '불량 코드'], ['workers', '작업자']])}</div>${T[mt]()}
      <p class="note">기준 정보는 모든 공정 모듈이 같이 씁니다 (mlng_ 표). 바꾸기는 관리자만 합니다.</p></div>`;
  };

  V.data = () => {
    const S = M.S, H = S.heat || {}, ins = M.inspections();
    const prof = Object.values(H.profiles || {}).reduce((s, p) => s + Math.max(0, ...Object.values(p.s).map(a => a.length)), 0);
    const st = (c, t) => M.dot(c, t);
    const rows = [
      { src: '열처리 공정값 (SB-01)', upd: S.asof || '—', amt: `${f((H.lots || []).length, 0)}작업 · 2분 구간 ${f(prof, 0)}개`, s: (H.lots || []).length ? st('ok', '정상') : st('danger', '없음') },
      { src: '열처리 품질 (작업별 양품·불량)', upd: S.asof || '—', amt: `불량 코드 ${S.masters.defect_codes.filter(c => c.proc === 'heat').length}종 · 작업 단위 수량`, s: st('warn', '부품 번호 없음') },
      ...(S.press ? [{ src: '프레스 타발값 (PR-01)', upd: S.press.lots.slice(-1)[0].date, amt: `${S.press.lots.length}작업일 · 타발 ${f(S.press.lots.reduce((s, l) => s + l.strokes, 0), 0)}회 · 20타발 평균`, s: st('ok', '정상') },
        { src: '프레스 품질 (일별 불량 유형)', upd: S.press.lots.slice(-1)[0].date, amt: `불량 코드 ${S.press.defect_codes.length}종 · 작업일 단위 수량`, s: st('warn', '부품 번호 없음') },
        { src: '프레스 진동·전류 (PR-01)', upd: (S.press.vib.events[0] || {}).end || S.press.vib.normal.t0, amt: `정상 기준 ${f(S.press.vib.normal.v0.length * 10 / 60, 0)}분 · 이상 구간 ${S.press.vib.events.length}건`, s: st('ok', '수집') }] : []),
      ...(S.weld ? [{ src: '점용접 타점 공정값 (SP-01)', upd: S.weld.lots.slice(-1)[0].date, amt: `${f(S.weld.preds.length, 0)}타점 (마지막 작업일) · 작업일 ${S.weld.lots.length}개`, s: st('ok', '정상') },
        { src: '점용접 불량 기록', upd: S.weld.lots.filter(l => l.bad != null).slice(-1)[0].date, amt: '작업일별 불량 수 (타점 번호 없음)', s: st('warn', '타점 번호 없음') }] : []),
      ...(S.plan ? [{ src: '수주·생산·재고 (기어 2품목)', upd: S.plan.days.slice(-1)[0].date, amt: `${S.plan.days.length / S.plan.items.length}작업일 · 시각별 ${f(S.plan.events.length, 0)}건`, s: st('ok', '정상') }] : []),
      ...(S.mach ? [{ src: 'MCT 가공 센서 (MC-01)', upd: S.mach.runs.slice(-1)[0].t, amt: `공구 ${S.mach.tools.length}개 · 가공 ${S.mach.runs.length}회 · 센서 6종 RMS`, s: S.mach.n_bad ? st('warn', `센서 이상 ${S.mach.n_bad}회`) : st('ok', '정상') },
        { src: 'MCT 공구 마모 (VB)', upd: S.mach.runs.slice(-1)[0].t, amt: `측정 ${S.mach.runs.filter(r => r.vb != null).length}회 · 나머지는 신호로 추정`, s: st('ok', '정상') }] : []),
      ...(S.insp ? [{ src: '정밀가공 검사 (IN-01)', upd: S.insp.lots.slice(-1)[0].end, amt: `부품 ${f(new Set(S.insp.records.map(r => r.sn)).size, 0)}개 · 기록 ${f(S.insp.records.length, 0)}건 · 신호 ${S.insp.signals.length}종`, s: st('warn', `판정 충돌 ${S.insp.checks.conflict}`) },
        { src: '정밀가공 축 신호 (Z2)', upd: '—', amt: `${S.insp.checks.stuck_cols}개 항목 값 고정 (${f(S.insp.checks.const_value, 1)})`, s: (S.insp.checks.stuck || []).length ? st('warn', '센서 확인') : st('ok', '정상') }] : []),
      { src: '기준 정보', upd: '—', amt: `품목 ${S.masters.items.length} · 설비 ${S.masters.equipment.length} · 공정 ${S.masters.routings.length}`, s: st('ok', '정상') },
      { src: '작업지시 · LOT 이력', upd: '—', amt: `작업지시 ${f(S.work_orders.length, 0)} · LOT ${f(S.lots.length, 0)} · 연결 ${f(S.trace.length, 0)}`, s: st('ok', '정상') },
      { src: '현장 검사 기록', upd: ins.length ? ins[0].at : '—', amt: `${ins.length}건`, s: ins.length ? st('ok', '기록 중') : st('warn', '없음') },
    ];
    return `<div class="card"><h2>데이터 원천</h2>${M.table([['원천', r => `<b>${esc(r.src)}</b>`], ['최근', 'upd'], ['양', 'amt'], ['상태', r => r.s]], rows, { wrap: false })}</div>
      <div class="card" style="margin-top:16px"><h2>연결</h2>${M.table([['항목', 'k'], ['값', 'v']], [
        { k: '연결', v: M.D.LIVE ? '실시간 (Supabase)' : '데모 스냅샷' }, { k: 'Supabase', v: M.D.dbState() }, { k: 'Claude 질의', v: M.D.askUrl() ? '연결 — Edge Function mlng-ask' : '규칙 기반 (중계 함수 미연결)' }, { k: '데이터 기준 시각', v: S.asof || '—' },
        { k: '공정 모듈', v: M.mods.filter(m => m.proc && !['data'].includes(m.proc)).map(m => m.group).join(' · ') },
        { k: '샘플 데이터 출처 (열처리)', v: H.source || '—' }, ...(S.press ? [{ k: '샘플 데이터 출처 (프레스)', v: S.press.source }] : []),
        ...(S.insp ? [{ k: '샘플 데이터 출처 (검사)', v: S.insp.source }] : []), ...(S.weld ? [{ k: '샘플 데이터 출처 (점용접)', v: S.weld.source }] : []),
        ...(S.plan ? [{ k: '샘플 데이터 출처 (생산 계획)', v: S.plan.source }] : []),
        ...(S.mach ? [{ k: '샘플 데이터 출처 (MCT 가공)', v: S.mach.source }] : []),
        { k: '데모 공장 구성', v: '서로 다른 공개 데이터를 한 공장 흐름으로 묶었습니다 — 프레스 작업일은 열처리 작업 전날로, 점용접 9작업일은 프레스 마지막 9작업일에, MCT 공구 16개는 열처리 마지막 16작업일에(공구 1개 = 하루, 가공 1회 = 부품 25개), 검사 3일은 열처리 마지막 날에 끝나게 옮기고, 소재 → 프레스 → 점용접 → 열처리 → MCT 가공 → 검사 LOT 을 날짜로 연결 (취수 12, 점용접은 보강판 부착 사양만, 검사 셀은 가공 사양 부품만)' }], { wrap: false })}</div>`;
  };

  M.mod({
    id: 'common', group: '현황', order: 0,
    menu: [['overview', '공장 현황', 'home'], ['alerts', '통합 알림', 'bell'], ['trace', '작업지시 · LOT 이력', 'trace', '생산']],
    views: V, alerts: dataAlerts,
    drawers: { 'trace:': id => { tq = id; M.go('trace'); } },
    bind(root) {
      root.querySelectorAll('[data-af]').forEach(b => b.onclick = () => { af = b.dataset.af; M.render(); });
      root.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { mt = b.dataset.mt; M.render(); });
      root.querySelectorAll('[data-trace]').forEach(a => a.onclick = e => { e.preventDefault(); tq = a.dataset.trace; M.closeDrawer(); M.go('trace'); });
      const q = root.querySelector('#tq'), g = root.querySelector('#tgo');
      if (q) { const run = () => { tq = q.value.trim(); M.render(); }; q.onkeydown = e => { if (e.key === 'Enter') run(); }; if (g) g.onclick = run; }
    },
  });
  M.mod({ id: 'system', group: '시스템', order: 99, menu: [['masters', '기준 정보', 'book'], ['data', '데이터 상태', 'check']], views: { masters: V.masters, data: V.data } });
})();
