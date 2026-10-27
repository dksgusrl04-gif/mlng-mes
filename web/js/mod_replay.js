/* 3.0 ⑤ — 공장 되감기 (그때 MES 는 무엇을 알았나)
 * ───────────────────────────────────────────────────────────────
 * 날짜를 고르면 모든 데이터를 «그날 밤까지» 로 잘라 공정 요약 · 알림을 그 시점 기준으로 다시 계산한다.
 *   → 「그날 왜 불량이 났나」 를 그날의 화면으로 설명하고, 사건의 «처음 징후» 가 며칠 전에 보였는지(조기 경보 시간)를 잰다.
 * 재생을 누르면 하루씩 넘어가며 공장이 어떻게 변했는지 보여 준다.
 */
(function () {
  'use strict';
  const M = window.MLNG, DX = M.dx, { esc, f } = M;
  const SKIP = new Set(['deal', 'agent', 'net', 'gate', 'case']);   // 지금 상태로만 계산되는 2.0·3.0 알림은 되감지 않는다
  const d10 = s => String(s || '').slice(0, 10);
  let days = null, idx = null, timer = null;
  const cache = new Map();

  function allDays() {
    if (days && days.src === M.S) return days.list;
    const s = new Set(); (M.S.lots || []).forEach(l => { if (l.kind === 'process') s.add(d10(l.proc === 'press' ? l.start_at : l.end_at)); });
    const list = [...s].filter(Boolean).sort(), last = d10(M.S.asof), from = new Date(M.toDate(last).getTime() - 45 * 86400000).toLocaleString('sv-SE').slice(0, 10);
    days = { src: M.S, list: list.filter(d => d >= from && d <= last) }; cache.clear(); return days.list;
  }
  // 그날 밤까지로 자른 데이터
  function cut(day) {
    const S = M.S, c = day + ' 23:59', le = v => String(v || '') <= c, ld = v => d10(v) <= day;
    const o = (x, fn) => x ? Object.assign({}, x, fn(x)) : x;
    return Object.assign({}, S, {
      asof: c, lots: S.lots.filter(l => le(l.start_at || l.first)), trace: S.trace.filter(t => le(t.at)), work_orders: S.work_orders.filter(w => ld(w.created_at)), alerts: (S.alerts || []).filter(a => le(a.at)),
      heat: o(S.heat, h => ({ lots: h.lots.filter(l => le(l.end)) })),
      press: o(S.press, p => ({ lots: p.lots.filter(l => ld(l.date)), vib: Object.assign({}, p.vib, { events: (p.vib.events || []).filter(e => le(e.end)) }) })),
      weld: o(S.weld, w => ({ lots: w.lots.filter(l => ld(l.date)) })),
      mach: o(S.mach, m => ({ tools: m.tools.filter(t => ld(t.date)), runs: m.runs.filter(r => le(r.t)) })),
      insp: o(S.insp, i => { const recs = i.records.filter(r => le(r.t)); return { records: recs, lots: i.lots.filter(l => ld(l.date)), checks: Object.assign({}, i.checks, { conflict: new Set(recs.filter(r => r.conflict).map(r => r.sn)).size }) }; }),
      plan: o(S.plan, p => ({ days: p.days.filter(d => ld(d.date)), events: p.events.filter(e => le(e.t)) })),
      purchase: o(S.purchase, p => ({ orders: p.orders.filter(x => le(x.created_at)), audit: p.audit.filter(x => le(x.at)) })),
    });
  }
  function at(day) {
    if (cache.has(day)) return cache.get(day);
    const S2 = cut(day);
    let al = []; try { al = M.alertsFor(S2).filter(a => !SKIP.has(a.proc)); } catch (e) { console.warn('[replay]', e); }
    const sums = {}; M.mods.filter(m => m.proc && m.summary && ['press', 'weld', 'heat', 'mach', 'insp'].includes(m.proc)).forEach(m => { try { sums[m.proc] = M.withS(S2, () => m.summary(S2)); } catch (e) { /* 그날 데이터 없음 */ } });
    let line = null; try { line = M.lineSummary ? M.withS(S2, () => M.lineSummary()) : null; } catch (e) { /* 라인 계산 불가 */ }
    const hs = new Set(S2.heat ? S2.heat.lots.map(l => l.id) : []), dl = [].concat(...((window.MLNGTrust || {}).orders || []).map(o => o.deliveries)).filter(d => hs.has(d.lot));
    const r = { day, al, sums, line, deliv: { n: dl.length, claim: dl.filter(d => d.claim).length, qty: dl.reduce((t, d) => t + d.qty, 0) } };
    cache.set(day, r); return r;
  }
  function happened(day) {
    const S = M.S, ev = [];
    S.lots.filter(l => l.kind === 'process' && d10(l.proc === 'press' ? l.start_at : l.end_at) === day).forEach(l => ev.push({ t: l.proc === 'press' ? l.start_at : l.end_at, proc: l.proc, text: `${l.id} 완료 — ${f(l.qty, 0)}개${l.bad != null ? ` · 불량 ${f(l.bad, 0)}` : ''}`, go: 'trace:' + l.id }));
    ((S.press || {}).vib || { events: [] }).events.filter(e => d10(e.end) === day).forEach(e => ev.push({ t: e.start, proc: 'press', text: `${e.equip} 진동 이상 ${e.secs}초 — 정상의 ${f(e.ratio, 1)}배`, hot: true, go: 'press_equip' }));
    const lim = (M.CFG.MACH || {}).VB_LIMIT || 0.5, seen = new Set();
    ((S.mach || {}).runs || []).filter(r => d10(r.t) === day && r.vb_now > lim).forEach(r => { if (seen.has(r.tool)) return; seen.add(r.tool); ev.push({ t: r.t, proc: 'mach', text: `${r.tool} 마모 VB ${f(r.vb_now, 2)} — 교체 기준 넘어 가공 계속`, hot: true, go: 'mach:' + r.tool }); });
    ((S.heat || {}).lots || []).filter(l => d10(l.end) === day && M.heatDev && M.heatDev(l) >= 0.05).forEach(l => ev.push({ t: l.end, proc: 'heat', text: `${l.id} 조건 이탈 ${f(M.heatDev(l) * 100, 0)}% 시간`, hot: true, go: 'heat:' + l.id }));
    ((S.purchase || {}).audit || []).filter(a => d10(a.at) === day).forEach(a => ev.push({ t: a.at, proc: 'buy', text: `${a.ref} ${a.action} (${a.by})`, go: 'po:' + a.ref }));
    return ev.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  }
  // 사건의 처음 징후: 마지막 날부터 거슬러 올라가며 같은 종류 알림이 이어진 첫날
  M.replayApi = {
    at, cut,
    firstSeen(match) {
      const ds = allDays(); let first = null;
      for (let i = ds.length - 1; i >= 0; i--) { const a = at(ds[i]).al.filter(match); if (!a.length) break; first = { day: ds[i], title: a[a.length - 1].title }; }
      if (!first) return null;
      return Object.assign(first, { lead: Math.round((M.toDate(d10(M.S.asof)).getTime() - M.toDate(first.day).getTime()) / 86400000), capped: first.day === ds[0] });
    },
  };

  const play = on => { clearInterval(timer); timer = null; if (!on) return; timer = setInterval(() => { const ds = allDays(); if (idx >= ds.length - 1) { play(false); if (M.cur === 'replay') M.render(); return; } idx++; if (M.cur === 'replay') M.render(); else play(false); }, 1300); };
  const V = {};
  V.replay = () => {
    const ds = allDays(); if (!ds.length) return '<div class="empty">되감을 날짜가 없습니다</div>';
    if (idx == null || idx >= ds.length) idx = ds.length - 1;
    const day = ds[idx], r = at(day), prev = idx ? at(ds[idx - 1]) : null, key = a => a.key ? a.key + ':' + ((a.data || {}).tool || (a.data || {}).zone || (a.data || {}).param || (a.data || {}).item || (a.data || {}).equip || '') : a.proc + String(a.title).replace(/[\d.,+%]+/g, '#'), pt = new Set(prev ? prev.al.map(key) : []);
    const nw = r.al.filter(a => !pt.has(key(a))), gone = prev ? prev.al.filter(a => !r.al.some(b => key(b) === key(a))) : [];
    const ev = happened(day), q = DX.copq(60).days.find(x => x.d === day);
    const prodHeat = (M.S.heat.lots || []).filter(l => d10(l.end) === day).reduce((s, l) => s + l.qty, 0);
    const steps = [['press', '프레스'], ['weld', '점용접'], ['heat', '열처리'], ['mach', 'MCT'], ['insp', '검사']];
    return `<div class="kstrip nside">
      <div class="kpi"><div class="lab">그날 열처리 완료</div><div class="val">${f(prodHeat, 0)}<small>개</small></div><div class="foot">${esc(day)}</div></div>
      <div class="kpi"><div class="lab">그날 품질 손실</div><div class="val">${q ? DX.wonShort(q.total) : '0'}<small>원</small></div><div class="foot">불량 폐기 · 클레임 · 낭비</div></div>
      <div class="kpi"><div class="lab">그때 알림</div><div class="val" style="color:${r.al.some(a => a.level === 'danger') ? 'var(--danger-ink)' : 'inherit'}">${r.al.filter(a => a.level !== 'info').length}<small>건</small></div><div class="foot">새로 ${nw.length} · 사라짐 ${gone.length}</div></div>
      <div class="kpi"><div class="lab">그날 일어난 일</div><div class="val">${ev.length}<small>건</small></div><div class="foot">이상 ${ev.filter(e => e.hot).length}건</div></div>
    </div>
    <div class="card"><h2>공장 되감기 <span class="h2sub">데이터를 그날 밤까지로 잘라 «그때 MES 가 무엇을 알았는지» 다시 계산합니다</span></h2>
      <div class="rpbar"><button class="btn sm" data-rp="-1" ${idx ? '' : 'disabled'}>◀</button><input type="range" id="rp-day" min="0" max="${ds.length - 1}" value="${idx}"><button class="btn sm" data-rp="1" ${idx < ds.length - 1 ? '' : 'disabled'}>▶</button>
        <b id="rp-lab">${esc(day)}</b><button class="btn ${timer ? '' : 'pri'} sm" id="rp-play">${timer ? '⏸ 멈춤' : '▶ 재생'}</button><button class="btn sm" id="rp-now">오늘로</button></div>
      <div class="route compact" style="margin-top:12px">${steps.map(([p, t], i) => { const s = r.sums[p]; return `${i ? '<div class="arrow" aria-hidden="true"></div>' : ''}<div class="step"><div class="nm"><span class="dot ${s ? (['warn', 'danger'].includes(s.st) ? s.st : 'ok') : 'off'}"></span>${esc(t)}</div>${s ? `<div class="kv ${esc(s.st)}">${esc(s.kpi)}</div><div class="sb" style="font-size:11px">${esc(s.sub || '')}</div>` : '<div class="sb">데이터 없음</div>'}</div>`; }).join('')}</div></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>그때 라인 · 재공 <span class="h2sub">그날까지의 실적으로 다시 계산</span></h2>${r.line ? `${M.dl([['하루 가능 산출', f(r.line.possible_per_day, 0) + '개'], ['목표', f(r.line.target_per_day, 0) + '개'], ['병목', esc(r.line.bottleneck)], ['설비 능력 한계', `${f(r.line.capacity_limit_per_day, 0)}개 (${esc(r.line.capacity_bottleneck)})`]], 'kvl')}
        <h3 class="dh">공정 사이 재공 (하루 증감)</h3>${M.table([['구간', 'between'], ['증감', g => `<b style="color:${g.gap < 0 ? 'var(--danger-ink)' : g.gap > 0 ? 'var(--warn-ink)' : 'inherit'}">${g.gap > 0 ? '+' : ''}${f(g.gap, 0)}</b>`, 'n']], r.line.wip_gaps_per_day, { wrap: false })}` : '<div class="empty">라인 계산 불가</div>'}</div>
      <div class="card"><h2>그때 계약 · 납품 <span class="h2sub">그날까지 만든 LOT 기준</span></h2>${M.dl([['스마트 발주 납품', `${r.deliv.n} LOT · ${f(r.deliv.qty, 0)}개`], ['클레임', r.deliv.claim + '건'], ['데이터 공유 계약', `${((window.MLNGTrust || {}).contracts || []).filter(c => window.MLNGTrust.contractState(c) === 'active').length}건 유효 (데모 계약은 지금 기준)`]], 'kvl')}
        <p class="note">되감은 날짜에 이미 만들어진 열처리 LOT 의 납품 · 클레임만 셉니다.</p></div></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>그때 알림 <span class="h2sub">그날까지의 데이터로 다시 계산</span></h2>
        ${r.al.length ? `<div class="alist">${r.al.map(a => `<div class="al ${esc(a.level)}"><div class="lv"></div><div style="min-width:0"><div class="tt">${!pt.has(key(a)) && prev ? '<span class="chip c-ext">새로</span> ' : ''}${esc(a.title)}</div><div class="bd">${esc(a.body || '')}</div><div class="mt">${M.procTag(a.proc)}<span>${esc(a.at || '')}</span></div></div></div>`).join('')}</div>` : '<div class="empty">그때는 알림이 없었습니다</div>'}
        ${gone.length ? `<p class="note">전날 있다가 사라진 알림: ${gone.map(a => esc(a.title)).join(' · ')}</p>` : ''}</div>
      <div class="card"><h2>그날 일어난 일</h2>
        ${ev.length ? `<div class="rptl">${ev.map(e => `<div class="${e.hot ? 'hot' : ''} ${e.go ? 'click' : ''}" ${e.go ? `data-row="${esc(e.go)}"` : ''}><span>${esc(String(e.t).slice(11, 16))}</span>${M.procTag(e.proc)}<div>${esc(e.text)}</div></div>`).join('')}</div>` : '<div class="empty">기록된 작업이 없습니다</div>'}</div></div>`;
  };

  M.mod({
    id: 'replay', group: '판단 (3.0)', order: 6,
    menu: [['replay', '공장 되감기', 'replay']],
    views: V,
    drawers: { 'replay:': d => { const i = allDays().indexOf(d); if (i >= 0) idx = i; M.closeDrawer(); M.go('replay'); } },
    bind(root) {
      const rg = root.querySelector('#rp-day'); if (!rg) return;
      rg.oninput = () => { M.$('#rp-lab').textContent = allDays()[+rg.value]; }; rg.onchange = () => { idx = +rg.value; M.render(); };
      root.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => { idx = Math.max(0, Math.min(allDays().length - 1, idx + +b.dataset.rp)); M.render(); });
      root.querySelector('#rp-play').onclick = () => { if (timer) play(false); else { if (idx >= allDays().length - 1) idx = Math.max(0, allDays().length - 15); play(true); } M.render(); };
      root.querySelector('#rp-now').onclick = () => { play(false); idx = allDays().length - 1; M.render(); };
    },
  });
})();
