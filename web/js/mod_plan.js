/* 계획 모듈 — 생산 계획(수주·생산·재고) · 작업지시
 * 생산 계획: 염욕 열처리로 SB-01 의 기어 2품목 (공급망 데이터)
 * 작업지시: 모든 공정의 작업지시 + 계획 화면에서 만든 작업지시 초안
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f, pct } = M;
  const PL = () => M.S.plan || { items: [], days: [], events: [] };
  const PCF = () => Object.assign({ AVG_DAYS: 7, SAFETY_DAYS: 0.5, LOT_SIZE: { 'GR-021': 150, 'GR-042': 200 } }, M.CFG.PLAN || {});
  const itemName = c => (M.S.masters.items.find(i => i.code === c) || {}).name || c;
  const daysOf = it => PL().days.filter(d => d.item === it).sort((a, b) => a.date.localeCompare(b.date));
  // 품목별 계획 지표: 최근 N작업일 평균 수주 = 내일 예상 수주
  function stat(it) {
    const ds = daysOf(it), last = ds[ds.length - 1] || {}, rec = ds.slice(-PCF().AVG_DAYS);
    const avg = rec.reduce((s, d) => s + d.order, 0) / Math.max(1, rec.length), std = rec.reduce((s, d) => s + d.prod, 0) / Math.max(1, rec.length);
    const target = avg * (1 + PCF().SAFETY_DAYS), need = Math.max(0, Math.ceil((target - (last.inv_close || 0)) / 10) * 10), lot = PCF().LOT_SIZE[it] || 100;
    return { it, last, avg, std, cover: avg ? (last.inv_close || 0) / avg : null, need, lot, runs: Math.ceil(need / lot), short: (last.inv_close || 0) < avg };
  }
  let woErr = '';
  const drafts = () => (M.S.work_orders || []).filter(w => w.status === 'draft');

  function alerts() {
    return PL().items.map(i => stat(i.code)).filter(s => s.short).map(s => ({ key: 'plan.short', data: { item: s.it, inv: s.last.inv_close, demand: s.avg, gap: Math.max(0, s.avg - s.last.inv_close) }, proc: 'plan', level: 'warn',
      title: `${s.it} ${itemName(s.it)} 마감 재고 ${f(s.last.inv_close, 0)} < 내일 예상 수주 ${f(s.avg, 0)}`,
      body: `재고 일수 ${f(s.cover, 1)}일 · 아침 출하 전 생산이 없으면 부족 — 첫 생산 ${f(s.runs, 0)}회(${f(s.need, 0)}개) 앞당기기 검토`, by: '생산 계획', at: s.last.date + ' 20:00', go: 'plan_home' }));
  }

  let pit = null;
  const V = {};
  V.plan_home = () => {
    const items = PL().items; if (!items.length) return '<div class="empty">계획 데이터가 없습니다</div>';
    if (!pit) pit = items[0].code;
    const s = stat(pit), ds = daysOf(pit).slice(-45), rec = daysOf(pit).slice(-PCF().AVG_DAYS);
    const xl = [0, Math.floor(ds.length / 2), ds.length - 1].map(i => [i, ds[i].date.slice(5)]);
    const all = items.map(i => stat(i.code));
    const last = daysOf(pit).slice(-14).reverse();
    const nextOrder = d => { const a = daysOf(d.item), i = a.findIndex(x => x.date === d.date); return a[i + 1] ? a[i + 1].order : null; };
    return `<div class="tools">${M.seg('pit', pit, items.map(i => [i.code, `${i.code} ${i.name}`]))}<span class="tsum">SB-01 염욕 열처리로 · 기준 ${esc(s.last.date || '')}</span></div>
    <div class="kstrip">
      <div class="kpi click" data-row="k:pl:order"><div class="lab">수주 · 최근 ${rec.length}작업일</div><div class="val">${f(rec.reduce((t, d) => t + d.order, 0), 0)}<small>개</small></div><div class="foot">하루 평균 ${f(s.avg, 0)}개</div></div>
      <div class="kpi click" data-row="k:pl:prod"><div class="lab">생산 · 최근 ${rec.length}작업일</div><div class="val">${f(rec.reduce((t, d) => t + d.prod, 0), 0)}<small>개</small></div><div class="foot">하루 ${f(s.std, 0)}개 · ${f(s.std / s.lot, 0)}회 × ${s.lot}</div></div>
      <div class="kpi click" data-row="k:pl:inv"><div class="lab">마감 재고</div><div class="val" style="color:${s.short ? 'var(--warn-ink)' : 'inherit'}">${f(s.last.inv_close, 0)}<small>개</small></div><div class="foot">재고 일수 ${f(s.cover, 1)}일</div></div>
      <div class="kpi click" data-row="k:pl:need"><div class="lab">내일 필요 생산</div><div class="val">${f(s.need, 0)}<small>개</small></div><div class="foot">예상 수주 ${f(s.avg, 0)} + 안전재고 ${pct(PCF().SAFETY_DAYS, 0)} − 재고</div></div>
    </div>
    <div class="grid g21" style="margin-top:16px">
      <div class="card"><h2>수주 · 생산 · 재고 <span class="h2sub">${esc(pit)} · 최근 45작업일</span></h2>
        ${M.lineChart([{ v: ds.map(d => d.order), cls: 's3' }, { v: ds.map(d => d.prod), cls: 's2' }, { v: ds.map(d => d.inv_close), cls: 's1' }], null, { h: 230, d: 0, xlab: xl })}
        ${M.legend([['l-s3', '수주'], ['l-s2', '생산'], ['l-s1', '마감 재고']])}</div>
      <div class="card"><h2>내일 생산 제안 <span class="h2sub">품목별</span></h2>
        ${all.map(x => { const has = drafts().some(w => w.item_code === x.it);
          return `<div class="sug"><div class="sh"><b>${esc(x.it)}</b> ${esc(itemName(x.it))} ${x.short ? '<span class="tag j-warn">부족 위험</span>' : '<span class="tag j-ok">충분</span>'}</div>
          <dl class="stat"><dt>예상 수주</dt><dd>${f(x.avg, 0)}</dd><dt>마감 재고</dt><dd>${f(x.last.inv_close, 0)}</dd><dt>필요 생산</dt><dd>${f(x.need, 0)} (${x.runs}회 × ${x.lot})</dd></dl>
          ${x.need ? (has ? '<div class="note">작업지시 초안이 있습니다 → 작업지시 화면</div>' : `<button class="btn pri sm" data-mkwo="${esc(x.it)}|${x.need}">작업지시 만들기</button>`) : ''}</div>`; }).join('')}
        ${woErr ? `<p class="note" style="color:var(--danger-ink)">${esc(woErr)}</p>` : ''}<p class="note">안전재고 = 예상 수주의 ${pct(PCF().SAFETY_DAYS, 0)}. 기준값은 config.js 의 PLAN 에서 바꿉니다.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>일별 계획 대비 실적 <span class="h2sub">${esc(pit)} · 최근 14작업일</span></h2>
      ${M.table([['날짜', 'date'], ['수주', r => f(r.order, 0), 'n'], ['생산', r => f(r.prod, 0), 'n'], ['생산 횟수', r => r.runs, 'n'], ['시작 재고', r => f(r.inv_open, 0), 'n'],
        ['마감 재고', r => f(r.inv_close, 0), 'n'], ['다음날 수주', r => { const n = nextOrder(r); return n == null ? '—' : f(n, 0); }, 'n'],
        ['상태', r => { const n = nextOrder(r); return n == null ? '<span class="muted">—</span>' : r.inv_close < n ? '<span class="tag j-warn">다음날 부족</span>' : '<span class="tag j-ok">충족</span>'; }]],
        last, { wrap: false, hl: r => { const n = nextOrder(r); return n != null && r.inv_close < n; } })}
      <p class="note">«다음날 부족» = 마감 재고가 다음 날 수주보다 적어, 그날 첫 생산 전에 출하분이 모자랐던 날.</p></div>`;
  };

  let wf = 'all', wq = '';
  const woProc = w => { const l = (M.S.lots || []).find(x => x.wo_id === w.id); return l ? l.proc : (String(w.item_code).startsWith('GR') ? 'heat' : ''); };
  V.plan_wo = () => {
    const all = (M.S.work_orders || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || (a.status === 'draft' ? -1 : 1));
    let rows = all.filter(w => wf === 'all' || (wf === 'draft' ? w.status === 'draft' : woProc(w) === wf));
    if (wq) rows = rows.filter(w => [w.id, w.item_code].some(x => String(x).toLowerCase().includes(wq.toLowerCase())));
    const since = M.sinceDay(M.CFG.RECENT_DAYS || 7).getTime(), rec = all.filter(w => M.toDate(w.created_at).getTime() >= since);
    const lotOf = w => (M.S.lots || []).find(x => x.wo_id === w.id);
    const procs = [...new Set(all.map(woProc).filter(Boolean))];
    return `<div class="kstrip">
      <div class="kpi click" data-row="k:pl:wo-recent"><div class="lab">작업지시 · 최근 ${M.CFG.RECENT_DAYS || 7}일</div><div class="val">${rec.length}<small>건</small></div><div class="foot">${procs.map(p => `${esc(M.PROC[p])} ${rec.filter(w => woProc(w) === p).length}`).join(' · ')}</div></div>
      <div class="kpi click" data-row="k:pl:wo-done"><div class="lab">완료</div><div class="val">${rec.filter(w => w.status === 'done').length}<small>건</small></div><div class="foot">실적 LOT 이 연결된 작업지시</div></div>
      <div class="kpi click" data-wf="draft"><div class="lab">초안 (발행 전)</div><div class="val" style="color:${drafts().length ? 'var(--warn-ink)' : 'inherit'}">${drafts().length}<small>건</small></div><div class="foot">생산 계획에서 만든 것</div></div>
      <div class="kpi click" data-wf="all"><div class="lab">전체</div><div class="val">${f(all.length, 0)}<small>건</small></div><div class="foot">품목 ${new Set(all.map(w => w.item_code)).size}개</div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="tools">${M.seg('wf', wf, [['all', '전체'], ['draft', '초안']].concat(procs.map(p => [p, M.PROC[p]])))}
      <input class="in" id="wq" placeholder="작업지시 · 품목" value="${esc(wq)}" style="width:200px"><span class="tsum">${f(rows.length, 0)}건</span></div>
      ${M.table([['작업지시', w => `<b>${esc(w.id)}</b>`], ['품목', w => `${esc(w.item_code)} <span class="muted">${esc(itemName(w.item_code))}</span>`], ['공정', w => woProc(w) ? M.procTag(woProc(w)) : '—'],
        ['계획', w => f(w.qty_plan, 0), 'n'], ['실적', w => { const l = lotOf(w); return l ? f(l.qty, 0) : (w.status === 'done' ? f(w.qty_plan, 0) : '—'); }, 'n'],
        ['불량', w => { const l = lotOf(w); return l && l.bad != null ? f(l.bad, 0) : '—'; }, 'n'],
        ['상태', w => w.status === 'draft' ? '<span class="tag j-warn">초안</span>' : w.status === 'done' ? '<span class="tag j-ok">완료</span>' : `<span class="chip c-ext">${esc(w.status)}</span>`],
        ['생성', w => esc(String(w.created_at).slice(0, 16))], ['LOT', w => { const l = lotOf(w); return l ? `<a href="#" data-trace="${esc(l.id)}">${esc(l.id)}</a>` : '—'; }]],
        rows.slice(0, 300), { hl: w => w.status === 'draft' })}
      <p class="note">최근 순 300건까지. 초안은 관리자가 확인한 뒤 발행합니다${M.D.LIVE ? '' : ' (데모: 새로고침하면 사라짐)'}.</p></div>`;
  };

  async function makeWo(it, qty) {
    const now = M.now(), d = new Date(now.getTime() + 86400000), ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
    const wo = { id: `WO-${ymd}-${it.slice(-3)}-D${drafts().length + 1}`, item_code: it, qty_plan: Number(qty), status: 'draft', due: d.toISOString().slice(0, 10),
      created_at: new Date().toLocaleString('sv-SE').slice(0, 16) };
    try { const r = await M.D.addWorkOrder(wo); woErr = ''; M.S.work_orders = [r].concat(M.S.work_orders || []); M.render(); }
    catch (e) { woErr = '작업지시를 만들지 못했습니다 — ' + e.message; M.render(); }
  }

  // ── 요약 띠 상세
  function kd(k) {
    if (k.startsWith('wo-')) {
      const since = M.sinceDay(M.CFG.RECENT_DAYS || 7).getTime(), all = (M.S.work_orders || []).filter(w => M.toDate(w.created_at).getTime() >= since);
      const rows = (k === 'wo-done' ? all.filter(w => w.status === 'done') : all).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const lotOf = w => (M.S.lots || []).find(x => x.wo_id === w.id);
      return M.kdrawer(`작업지시 · 최근 ${M.CFG.RECENT_DAYS || 7}일`, `${k === 'wo-done' ? '완료' : '전체'} ${rows.length}건`, [
        { html: M.table([['작업지시', w => `<b>${esc(w.id)}</b>`], ['공정', w => woProc(w) ? M.procTag(woProc(w)) : '—'], ['계획', w => f(w.qty_plan, 0), 'n'], ['실적', w => { const l = lotOf(w); return l ? f(l.qty, 0) : '—'; }, 'n'],
          ['상태', w => w.status === 'done' ? '<span class="tag j-ok">완료</span>' : w.status === 'draft' ? '<span class="tag j-warn">초안</span>' : esc(w.status)]], rows, { wrap: false, click: w => { const l = lotOf(w); return l ? 'trace:' + l.id : 'plan_wo'; } }) }]);
    }
    const s = stat(pit), ds = daysOf(pit).slice(-14).reverse(), lab = { order: '수주', prod: '생산', inv: '마감 재고', need: '내일 필요 생산' }[k];
    return M.kdrawer(`생산 계획 · ${pit} ${itemName(pit)}`, `${lab} — 최근 14작업일`, [
      k === 'need' ? { html: M.dl([['내일 예상 수주 (최근 ' + PCF().AVG_DAYS + '작업일 평균)', f(s.avg, 0) + '개'], ['안전재고', `${pct(PCF().SAFETY_DAYS, 0)} → ${f(s.avg * PCF().SAFETY_DAYS, 0)}개`], ['마감 재고', f(s.last.inv_close, 0) + '개'], ['필요 생산', `<b>${f(s.need, 0)}개</b> (${s.runs}회 × ${s.lot})`]]) } : null,
      { html: M.table([['날짜', d => `<b>${esc(d.date)}</b>`], ['수주', d => k === 'order' ? `<b>${f(d.order, 0)}</b>` : f(d.order, 0), 'n'], ['생산', d => k === 'prod' ? `<b>${f(d.prod, 0)}</b>` : f(d.prod, 0), 'n'], ['생산 횟수', 'runs', 'n'],
        ['마감 재고', d => k === 'inv' ? `<b>${f(d.inv_close, 0)}</b>` : f(d.inv_close, 0), 'n'], ['재고 일수', d => s.avg ? f(d.inv_close / s.avg, 1) : '—', 'n']], ds, { wrap: false }) }]);
  }

  M.planApi = { stat, items: () => PL().items.map(i => i.code), makeWo };
  M.mod({
    id: 'plan', proc: 'plan', group: '계획', order: 5,
    menu: [['plan_home', '생산 계획', 'range'], ['plan_wo', '작업지시', 'book', '생산']],
    views: V, alerts, drawers: { 'k:pl:': kd },
    bind(root) {
      root.querySelectorAll('[data-pit]').forEach(b => b.onclick = () => { pit = b.dataset.pit; M.render(); });
      root.querySelectorAll('[data-wf]').forEach(b => b.onclick = () => { wf = b.dataset.wf; if (M.cur !== 'plan_wo') M.go('plan_wo'); else M.render(); });
      root.querySelectorAll('[data-mkwo]').forEach(b => b.onclick = () => { const [it, q] = b.dataset.mkwo.split('|'); makeWo(it, q); });
      const q = root.querySelector('#wq');
      if (q) q.oninput = () => { wq = q.value.trim(); const pos = q.selectionStart; M.render(); const n = M.$('#wq'); n.focus(); n.setSelectionRange(pos, pos); };
    },
  });
})();
