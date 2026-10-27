/* 공통 화면 — 공장 현황 · 이상 알람 · 작업지시·LOT 이력 · 기준 정보 · 데이터 상태
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
  // 공장 현황 공통 계산 (화면과 상세 서랍이 같이 쓴다)
  function ov() {
    const S = M.S, since = M.sinceDay(RD()).getTime();
    const lots = S.lots.filter(l => l.kind === 'process' && M.toDate(l.end_at).getTime() >= since);
    const rout = S.masters.routings.filter(r => r.item_code === (S.masters.items[0] || {}).code);
    const liveProcs = rout.filter(r => (eq(r.equipment_id).status) === 'live').map(r => r.proc);
    const lastProc = M.CFG.OUTPUT_PROC || liveProcs[liveProcs.length - 1];   // 생산 수량을 세는 공정 하나 (공정마다 더하면 중복)
    const byProc = p => lots.filter(l => l.proc === p);
    return { S, lots, rout, liveProcs, lastProc, byProc, qty: byProc(lastProc).reduce((s, l) => s + (l.qty || 0), 0), bad: lots.reduce((s, l) => s + (l.bad || 0), 0) };
  }
  const HOME = { press: 'press_home', weld: 'weld_home', heat: 'heat_home', mach: 'mach_home', insp: 'insp_home' };

  // ── 요약 띠 상세
  function kd(k) {
    const o = ov(), rows = o.liveProcs.map(p => { const ls = o.byProc(p), q = ls.reduce((s, l) => s + (l.qty || 0), 0), b = ls.reduce((s, l) => s + (l.bad || 0), 0), hasB = ls.some(l => l.bad != null);
      return { p, n: ls.length, q, b: hasB ? b : null, ppm: hasB && q ? b / q * 1e6 : null }; });
    const pcols = [['공정', r => `${M.procTag(r.p)}`], ['작업', r => f(r.n, 0), 'n'], ['수량', r => f(r.q, 0), 'n'], ['불량', r => r.b == null ? '—' : f(r.b, 0), 'n'], ['PPM', r => r.ppm == null ? '—' : f(r.ppm, 0), 'n']];
    const lcols = [['LOT', l => `<b>${esc(l.id)}</b>`], ['공정', l => M.procTag(l.proc)], ['종료', l => esc(String(l.end_at || '').slice(5, 16))], ['수량', l => f(l.qty, 0), 'n'], ['불량', l => l.bad == null ? '—' : f(l.bad, 0), 'n']];
    if (k === 'done') return M.kdrawer(`공장 현황 · 최근 ${RD()}일`, `완료 작업 ${o.lots.length}건`, [
      { h: '공정별', html: M.table(pcols, rows, { wrap: false, click: r => HOME[r.p] || 'overview' }) },
      { h: '최근 작업', html: M.table(lcols, o.lots.slice().sort((a, b) => String(b.end_at).localeCompare(String(a.end_at))).slice(0, 12), { wrap: false, click: l => 'trace:' + l.id }) }]);
    if (k === 'qty') { const by = {}; o.byProc(o.lastProc).forEach(l => { const d = String(l.end_at).slice(0, 10), x = by[d] = by[d] || { d, q: 0, n: 0 }; x.q += l.qty || 0; x.n++; });
      const days = Object.values(by).sort((a, b) => a.d.localeCompare(b.d));
      return M.kdrawer(`공장 현황 · 최근 ${RD()}일`, `생산 수량 ${f(o.qty, 0)}개 (${M.PROC[o.lastProc]} 완료 기준)`, [
        { html: M.barChart(days.map(d => ({ x: d.d.slice(5), v: d.q, t: `${d.d} · ${f(d.q, 0)}개` })), { h: 160 }) },
        { html: M.table([['날짜', d => `<b>${esc(d.d)}</b>`], ['작업', 'n', 'n'], ['수량', d => f(d.q, 0), 'n']], days.slice().reverse(), { wrap: false }) },
        { html: '<p class="note">생산 수량은 마지막 완료 공정 하나로만 셉니다 (공정마다 더하면 같은 부품이 여러 번 세어집니다).</p>' }]); }
    if (k === 'bad') return M.kdrawer(`공장 현황 · 최근 ${RD()}일`, `공정 불량 ${f(o.bad, 0)}개`, [
      { h: '공정별', html: M.table(pcols, rows.filter(r => r.b != null), { wrap: false, click: r => HOME[r.p] || 'overview' }) },
      { h: '불량 많은 작업', html: M.table(lcols, o.lots.filter(l => l.bad).sort((a, b) => b.bad - a.bad).slice(0, 10), { wrap: false, click: l => 'trace:' + l.id }) }]);
  }

  let af = 'all', ag = 'AB';
  V.alerts = () => {
    const all = M.alerts(), procs = [...new Set(all.map(a => a.proc))], cnt = g => all.filter(a => a.grade === g).length;
    const al = all.filter(a => (af === 'all' || a.proc === af) && ag.includes(a.grade));
    return `<div class="kstrip">
      <div class="kpi click" data-ag="A"><div class="lab">A 즉시 조치</div><div class="val" style="color:var(--danger-ink)">${cnt('A')}<small>건</small></div><div class="foot">라인 정지 · 고객 출하 영향</div></div>
      <div class="kpi click" data-ag="B"><div class="lab">B 당일 조치</div><div class="val" style="color:var(--warn-ink)">${cnt('B')}<small>건</small></div><div class="foot">품질 · 설비 이상</div></div>
      <div class="kpi click" data-ag="C"><div class="lab">C 관찰</div><div class="val">${cnt('C')}<small>건</small></div><div class="foot">추세 · 데이터 점검 · 승인 대기</div></div>
      <div class="kpi"><div class="lab">A 비율</div><div class="val">${all.length ? Math.round(cnt('A') / all.length * 100) : 0}<small>%</small></div><div class="foot">권장 5% 내외 (ISA-18.2)</div></div></div>
    <div class="card"><div class="tools">${M.seg('ag', ag, [['AB', 'A·B 조치 필요'], ['ABC', '전체'], ['A', 'A'], ['B', 'B'], ['C', 'C']])}${M.seg('af', af, [['all', '전체 공정']].concat(procs.map(p => [p, M.PROC[p] || p])))}<span class="tsum">${al.length}건</span></div>
      <div class="tbx"><table class="tb altab"><colgroup><col class="c-g"><col class="c-p"><col><col class="c-t"></colgroup>
        <thead><tr><th>등급</th><th>공정</th><th>알람</th><th>발생</th></tr></thead>
        <tbody>${al.map(a => `<tr class="${a.go ? 'click' : ''}" ${a.go ? `data-row="${esc(a.go)}"` : ''}><td>${M.gradeTag(a.grade, true)}</td><td>${M.procTag(a.proc)}</td>
          <td><div class="it1">${esc(a.title)}</div>${a.body ? `<div class="it2">${esc(a.body)}</div>` : ''}</td><td class="muted sm1">${esc(String(a.at || '').slice(5, 16))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">해당 알람이 없습니다</td></tr>'}</tbody></table></div></div>`;
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
        { k: '연결', v: M.D.LIVE ? '실시간 (Supabase)' : '데모 스냅샷' }, { k: 'Supabase', v: M.D.dbState() }, { k: 'Claude 질의', v: M.D.askUrl() ? '연결 — Edge Function mlng-ask' : '규칙 기반 (중계 함수 미연결)' }, { k: '데이터 기준 시각', v: S.asof || '—' }, ...(S.demo_shift ? [{ k: '데모 시연 보정', v: `원본 기준 ${String(S.demo_from).slice(0, 16)} → ${S.demo_shift}일 이동(오늘 기준) · LOT·작업지시 번호의 날짜도 함께 이동 · 프레스 취수 12 → 24 (프레스 일 생산 < 열처리 투입 역전 보정)` }] : []),
        { k: '공정 모듈', v: M.mods.filter(m => m.proc && !['data'].includes(m.proc)).map(m => m.group).join(' · ') },
        { k: '샘플 데이터 출처 (열처리)', v: H.source || '—' }, ...(S.press ? [{ k: '샘플 데이터 출처 (프레스)', v: S.press.source }] : []),
        ...(S.insp ? [{ k: '샘플 데이터 출처 (검사)', v: S.insp.source }] : []), ...(S.weld ? [{ k: '샘플 데이터 출처 (점용접)', v: S.weld.source }] : []),
        ...(S.plan ? [{ k: '샘플 데이터 출처 (생산 계획)', v: S.plan.source }] : []),
        ...(S.mach ? [{ k: '샘플 데이터 출처 (MCT 가공)', v: S.mach.source }] : []),
        { k: '데모 공장 구성', v: '서로 다른 공개 데이터를 한 공장 흐름으로 묶었습니다 — 프레스 작업일은 열처리 작업 전날로, 점용접 9작업일은 프레스 마지막 9작업일에, MCT 공구 16개는 열처리 마지막 16작업일에(공구 1개 = 하루, 가공 1회 = 부품 25개), 검사 3일은 열처리 마지막 날에 끝나게 옮기고, 소재 → 프레스 → 점용접 → 열처리 → MCT 가공 → 검사 LOT 을 날짜로 연결 (취수 12, 점용접은 보강판 부착 사양만, 검사 셀은 가공 사양 부품만)' }], { wrap: false })}</div>`;
  };

  M.mod({
    id: 'common', group: '현황', order: 0,
    menu: [['alerts', '전체 알람', 'bell'], ['trace', 'LOT 추적', 'trace']],
    views: V, alerts: dataAlerts,
    drawers: { 'trace:': id => { tq = id; M.go('trace'); }, 'k:ov:': kd },
    bind(root) {
            root.querySelectorAll('[data-buy]').forEach(b => b.onclick = e => { e.stopPropagation(); if (M.buyApi) M.buyApi.preselect(b.dataset.buy.split(',')); });
      root.querySelectorAll('[data-askq]').forEach(b => b.onclick = e => { e.stopPropagation(); if (M.askApi) M.askApi.ask(b.dataset.askq); });
      root.querySelectorAll('[data-af]').forEach(b => b.onclick = () => { af = b.dataset.af; M.render(); });
      root.querySelectorAll('[data-ag]').forEach(b => b.onclick = () => { ag = b.dataset.ag; M.render(); });
      root.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { mt = b.dataset.mt; M.render(); });
      root.querySelectorAll('[data-trace]').forEach(a => a.onclick = e => { e.preventDefault(); tq = a.dataset.trace; M.closeDrawer(); M.go('trace'); });
      const q = root.querySelector('#tq'), g = root.querySelector('#tgo');
      if (q) { const run = () => { tq = q.value.trim(); M.render(); }; q.onkeydown = e => { if (e.key === 'Enter') run(); }; if (g) g.onclick = run; }
    },
  });
  M.mod({ id: 'system', group: '시스템', order: 99, menu: [['masters', '기준 정보', 'book'], ['data', '데이터 상태', 'check']], views: { masters: V.masters, data: V.data } });
})();
