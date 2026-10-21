/* 구매·발주 모듈 — 알림에서 바로 발주 → 3단계 전자결재 → 발주서 출력 → 입고
 * ───────────────────────────────────────────────────────────────
 * 발주 추천: 각 공정 알림과 사용량에서 필요한 소모품·예비품을 찾는다 (품목·단가는 config.js BUY)
 *   MCT  — 최근 7일 공구 교체 횟수 × 인서트 수 × N주 − 재고 − 이미 발주한 수량
 *   그 외 — 품목의 `on` 화면을 가리키는 알림이 뜨면 예비품 1건 (점용접 전극 팁 · 금형 펀치 · 히터 · 센서)
 * 결재: 담당 → 검토 → 승인 순서. 누가 언제 서명했는지, 결재를 물린 것까지 활동 기록(mlng_audit)에 남는다
 * 발주서: 결재가 끝난 건만 출력. 기본은 결재란을 뺀 거래처 발송본, 「결재란 포함」을 켜면 사내 보관본
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f } = M;
  const BC = () => Object.assign({ COMPANY: 'MLNG', ADDRESS: '', STEPS: ['담당', '검토', '승인'], MACH_STOCK: 0, MACH_WEEKS: 2, ITEMS: [] }, M.CFG.BUY || {});
  const STEPS = () => BC().STEPS;
  const ITEM = code => BC().ITEMS.find(i => i.code === code) || { code, name: code, unit: '개', price: 0, vendor: '' };
  const won = v => f(v, 0) + '원';
  const ymd = d => d.toLocaleString('sv-SE').slice(0, 10);
  const stamp = () => { const d = M.now(), t = new Date(); return `${ymd(d)} ${t.toTimeString().slice(0, 5)}`; };
  const SIGNERS = () => [M.D.user().name, '생산 팀장', '공장장'].concat((M.S.masters.workers || []).map(w => w.name));

  // ── 저장소 (데모: 처음 열 때 지난 발주 3건을 넣어 둔다)
  function P() {
    if (!M.S.purchase) M.S.purchase = M.D.LIVE ? { orders: [], audit: [] } : seed();
    return M.S.purchase;
  }
  function seed() {
    const d = n => ymd(M.daysAgo(n)), S = STEPS();
    const sg = (n, k) => Object.fromEntries(S.slice(0, k).map((s, i) => [s, { by: ['품질 담당', '생산 팀장', '공장장'][i] || '공장장', at: `${d(n)} ${['09:10', '10:25', '13:40'][i] || '14:00'}` }]));
    const line = (code, qty, reason) => { const it = ITEM(code); return { code, name: it.name, spec: it.spec || '', unit: it.unit, qty, price: it.price, reason }; };
    const orders = [
      { id: `PO-${d(8).slice(2).replace(/-/g, '')}-01`, created_at: `${d(8)} 08:50`, by: '품질 담당', vendor: ITEM('MC-INS-01').vendor, lines: [line('MC-INS-01', 24, '공구 교체 소모분 보충')], signs: sg(8, 3), status: 'received', received_at: `${d(5)} 15:00`, note: '' },
      { id: `PO-${d(4).slice(2).replace(/-/g, '')}-01`, created_at: `${d(4)} 08:40`, by: '품질 담당', vendor: ITEM('SP-TIP-01').vendor, lines: [line('SP-TIP-01', 40, '전극 팁 정기 교체분')], signs: sg(4, 3), status: 'approved', note: '' },
      { id: `PO-${d(1).slice(2).replace(/-/g, '')}-01`, created_at: `${d(1)} 16:20`, by: '품질 담당', vendor: ITEM('PR-PUN-01').vendor, lines: [line('PR-PUN-01', 1, '금형 점검 예비품')], signs: sg(1, 1), status: 'pending', note: '' },
    ];
    const audit = [];
    orders.slice().reverse().forEach(o => {
      audit.push({ at: o.created_at, kind: 'po', ref: o.id, action: '발주 등록', by: o.by });
      S.forEach(s => o.signs[s] && audit.push({ at: o.signs[s].at, kind: 'po', ref: o.id, action: `${s} 결재`, by: o.signs[s].by }));
      if (o.received_at) audit.push({ at: o.received_at, kind: 'po', ref: o.id, action: '입고 처리', by: '품질 담당' });
    });
    audit.sort((a, b) => b.at.localeCompare(a.at));
    return { orders, audit };
  }
  const total = o => (o.lines || []).reduce((s, l) => s + l.qty * (l.price || 0), 0);
  const signedN = o => STEPS().filter(s => o.signs && o.signs[s]).length;
  const nextStep = o => STEPS().find(s => !(o.signs && o.signs[s]));
  const stTag = o => o.status === 'received' ? '<span class="tag j-ok">입고 완료</span>' : o.status === 'approved' ? '<span class="chip c-ext">결재 완료 · 미입고</span>' : '<span class="tag j-warn">결재 대기</span>';
  const signDots = o => `<span class="sdots">${STEPS().map(s => `<i class="${o.signs && o.signs[s] ? 'on' : ''}" title="${esc(s)}${o.signs && o.signs[s] ? ' · ' + esc(o.signs[s].by) : ''}"></i>`).join('')}</span>`;
  const onOrder = code => P().orders.filter(o => o.status !== 'received').reduce((s, o) => s + (o.lines || []).filter(l => l.code === code).reduce((t, l) => t + l.qty, 0), 0);
  const log = async (ref, action) => { const rec = { at: stamp(), kind: 'po', ref, action, by: M.D.user().name }; P().audit.unshift(rec); await M.D.addAudit(rec); };

  // ── 발주 추천
  function recs() {
    const out = [], A = M.alerts();
    BC().ITEMS.forEach(it => {
      if (it.proc === 'mach' && M.S.mach) {
        const md = M.S.mach, since = M.sinceDay(M.CFG.RECENT_DAYS || 7).getTime();
        const n7 = md.tools.filter(t => M.toDate(t.date).getTime() >= since).length, curT = md.tools[md.tools.length - 1] || {};
        const lim = (M.CFG.MACH || {}).VB_LIMIT || 0.5, per = it.per_change || 1, ord = onOrder(it.code);
        let need = n7 * per * BC().MACH_WEEKS - BC().MACH_STOCK - ord;
        need = Math.max(0, Math.ceil(need / per) * per);
        const urgent = curT.vb_last != null && curT.vb_last >= lim;
        if (need > 0) out.push({ it, qty: need, level: urgent ? 'danger' : 'warn', go: 'mach_home',
          reason: `${urgent ? `${curT.id} 교체 필요(VB ${f(curT.vb_last, 2)}) · ` : ''}최근 7일 공구 교체 ${n7}회 × 인서트 ${per}개 × ${BC().MACH_WEEKS}주 − 재고 ${BC().MACH_STOCK}${ord ? ` − 발주 중 ${ord}` : ''}` });
        return;
      }
      if (!it.on) return;
      const a = A.find(x => x.go === it.on || String(x.go || '').startsWith(it.on));
      if (!a) return;
      const ord = onOrder(it.code);
      out.push({ it, qty: it.qty || 1, level: a.level, go: a.go, reason: a.title, busy: ord > 0 ? ord : 0 });
    });
    return out;
  }

  // ── 상태
  const sel = {};                 // 추천 선택: code → qty
  const extra = [];               // 직접 추가한 품목
  let msg = '', of = 'all';

  async function createPOs() {
    const lines = [];
    recs().forEach(r => { if (sel[r.it.code] != null) lines.push({ it: r.it, qty: Number(sel[r.it.code]) || 0, reason: r.reason }); });
    extra.forEach(x => lines.push({ it: ITEM(x.code), qty: Number(x.qty) || 0, reason: x.reason || '직접 추가' }));
    const merged = [];
    lines.filter(l => l.qty > 0).forEach(l => { const m = merged.find(x => x.it.code === l.it.code); if (m) { m.qty += l.qty; if (l.reason && !m.reason.includes(l.reason)) m.reason += ' / ' + l.reason; } else merged.push(Object.assign({}, l)); });
    const ok = merged;
    if (!ok.length) { msg = '발주할 품목을 하나 이상 고르세요'; M.render(); return; }
    const byV = {}; ok.forEach(l => (byV[l.it.vendor] = byV[l.it.vendor] || []).push(l));
    const day = ymd(M.now()).slice(2).replace(/-/g, '');
    let seq = P().orders.filter(o => o.id.startsWith(`PO-${day}-`)).length;
    const made = [];
    try {
      for (const [vendor, ls] of Object.entries(byV)) {
        seq += 1;
        const po = { id: `PO-${day}-${String(seq).padStart(2, '0')}`, created_at: stamp(), by: M.D.user().name, vendor,
          lines: ls.map(l => ({ code: l.it.code, name: l.it.name, spec: l.it.spec || '', unit: l.it.unit, qty: l.qty, price: l.it.price, reason: l.reason })), signs: {}, status: 'pending', note: '' };
        const r = await M.D.savePO(po, true);
        P().orders.unshift(r); made.push(r.id); await log(r.id, '발주 등록');
      }
      Object.keys(sel).forEach(k => delete sel[k]); extra.length = 0;
      msg = `발주 ${made.length}건을 등록했습니다 (${made.join(', ')}) — 발주·결재 화면에서 결재하세요`;
    } catch (e) { msg = '발주 등록 실패 — ' + e.message; }
    M.render();
  }

  async function sign(id, step, by) {
    const o = P().orders.find(x => x.id === id); if (!o || nextStep(o) !== step) return;
    o.signs = Object.assign({}, o.signs, { [step]: { by, at: stamp() } });
    if (!nextStep(o)) o.status = 'approved';
    await M.D.savePO(o, false); await log(id, `${step} 결재 (${by})`);
    refresh(id);
  }
  async function revoke(id) {
    const o = P().orders.find(x => x.id === id); if (!o || o.status === 'received') return;
    const last = STEPS().filter(s => o.signs && o.signs[s]).pop(); if (!last) return;
    const s2 = Object.assign({}, o.signs); delete s2[last]; o.signs = s2; o.status = 'pending';
    await M.D.savePO(o, false); await log(id, `${last} 결재 물림`);
    refresh(id);
  }
  async function receive(id) {
    const o = P().orders.find(x => x.id === id); if (!o || o.status !== 'approved') return;
    o.status = 'received'; o.received_at = stamp();
    await M.D.savePO(o, false); await log(id, '입고 처리');
    refresh(id);
  }
  function refresh(id) { openPO(id); if (M.cur.startsWith('buy_')) M.render(); }

  // ── 발주서 (새 창 · 인쇄/PDF)
  function printPO(id) {
    const o = P().orders.find(x => x.id === id); if (!o) return;
    const C = BC(), sum = total(o), due = ymd(new Date(M.toDate(o.created_at).getTime() + 7 * 86400000));
    const w = window.open('', '_blank'); if (!w) { msg = '팝업이 막혀 있습니다 — 이 사이트의 팝업을 허용해 주세요'; M.render(); return; }
    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>발주서 ${esc(o.id)}</title><style>
      body{font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;color:#111;margin:0;padding:24px;background:#f3f4f6}
      .bar{display:flex;gap:12px;align-items:center;background:#111827;color:#fff;padding:10px 16px;margin:-24px -24px 22px;font-size:13px}
      .bar button{background:#4F46E5;color:#fff;border:0;border-radius:6px;padding:7px 14px;font-weight:700;cursor:pointer}
      .bar span{opacity:.75}
      .paper{background:#fff;max-width:760px;margin:0 auto;padding:40px 44px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
      .head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
      h1{font-size:28px;letter-spacing:12px;margin:8px 0 26px}
      .sign{display:none;border-collapse:collapse;font-size:11px;text-align:center}
      .keep-sign .sign{display:table}
      .sign td,.sign th{border:1px solid #333;width:64px;padding:3px}.sign th{background:#f3f4f6}
      .sign td{height:44px;vertical-align:middle}.sign .st{color:#B91C1C;border:2px solid #B91C1C;border-radius:50%;padding:6px 4px;font-weight:800;display:inline-block;transform:rotate(-8deg)}
      .sign small{display:block;color:#555;font-size:9px;margin-top:2px}
      table.meta,table.lines{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px}
      table.meta th,table.meta td,table.lines th,table.lines td{border:1px solid #9CA3AF;padding:7px 9px}
      table.meta th,table.lines th{background:#F3F4F6;font-weight:700;text-align:left;width:16%}
      table.lines th{text-align:center;width:auto}.n{text-align:right;font-variant-numeric:tabular-nums}
      .sum td{font-weight:800;background:#FAFAFA}.foot{font-size:12px;color:#374151;line-height:1.7;margin-top:18px}
      @media print{body{background:#fff;padding:0}.bar{display:none}.paper{box-shadow:none;max-width:none;padding:0}}
    </style></head><body>
    <div class="bar"><button onclick="window.print()">인쇄 / PDF 저장</button>
      <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" onchange="document.body.classList.toggle('keep-sign',this.checked)">결재란 포함 (사내 보관본)</label>
      <span>기본은 결재란을 뺀 거래처 발송본입니다</span></div>
    <div class="paper">
      <div class="head"><h1>발 주 서</h1>
        <table class="sign"><tr>${STEPS().map(s => `<th>${esc(s)}</th>`).join('')}</tr><tr>${STEPS().map(s => { const g = o.signs[s]; return `<td>${g ? `<span class="st">${esc(g.by)}</span><small>${esc(g.at.slice(5))}</small>` : ''}</td>`; }).join('')}</tr></table></div>
      <table class="meta">
        <tr><th>발주 번호</th><td>${esc(o.id)}</td><th>발주일</th><td>${esc(o.created_at.slice(0, 10))}</td></tr>
        <tr><th>수신 (거래처)</th><td>${esc(o.vendor)} 귀하</td><th>납기 요청</th><td>${esc(due)}</td></tr>
        <tr><th>발주처</th><td>${esc(C.COMPANY)}</td><th>담당</th><td>${esc(o.by)}</td></tr>
        <tr><th>주소</th><td colspan="3">${esc(C.ADDRESS)}</td></tr>
      </table>
      <table class="lines"><tr><th>No</th><th>품목 코드</th><th>품명 · 규격</th><th>수량</th><th>단가</th><th>금액</th></tr>
        ${o.lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td>${esc(l.code)}</td><td>${esc(l.name)}${l.spec ? ` <span style="color:#6B7280">· ${esc(l.spec)}</span>` : ''}</td><td class="n">${f(l.qty, 0)} ${esc(l.unit)}</td><td class="n">${f(l.price, 0)}</td><td class="n">${f(l.qty * l.price, 0)}</td></tr>`).join('')}
        <tr class="sum"><td colspan="5">합계 (부가세 별도)</td><td class="n">${f(sum, 0)}원</td></tr></table>
      <div class="foot">· 위와 같이 발주하오니 납기 내 납품하여 주시기 바랍니다.<br>· 납품 시 거래명세서를 함께 보내 주십시오.<br>· 본 발주서는 ${esc(C.COMPANY)} MES 에서 결재(${STEPS().join(' → ')})를 마친 뒤 출력되었습니다.</div>
    </div></body></html>`);
    w.document.close();
    log(id, '발주서 출력');
  }

  // ── 상세 서랍
  function openPO(id) {
    const o = P().orders.find(x => x.id === id); if (!o) return;
    const nx = nextStep(o), lastSigned = STEPS().filter(s => o.signs && o.signs[s]).pop();
    const hist = P().audit.filter(a => a.ref === id);
    M.drawer(`${o.vendor} · ${o.created_at}`, o.id, `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">${stTag(o)}<span class="muted">작성 ${esc(o.by)}</span></div>
      ${M.table([['품목', l => `<b>${esc(l.name)}</b><div class="muted" style="font-size:12px">${esc(l.code)}${l.spec ? ' · ' + esc(l.spec) : ''}</div>`], ['수량', l => `${f(l.qty, 0)} ${esc(l.unit)}`, 'n'], ['금액', l => f(l.qty * l.price, 0), 'n']],
        o.lines)}
      <div style="text-align:right;font-weight:750;margin:6px 2px 14px">합계 ${won(total(o))} <span class="muted" style="font-weight:400">(부가세 별도)</span></div>
      <h3 class="dh">전자결재</h3>
      <div class="signs">${STEPS().map(s => { const g = o.signs && o.signs[s];
        return `<div class="sbox ${g ? 'on' : s === nx ? 'next' : ''}"><div class="sl">${esc(s)}</div>${g ? `<div class="sv">${esc(g.by)}</div><div class="sa">${esc(g.at)}</div>`
          : s === nx && o.status !== 'received' ? `<select class="in" id="signer">${SIGNERS().map(n => `<option>${esc(n)}</option>`).join('')}</select><button class="btn pri sm" data-sign="${esc(o.id)}|${esc(s)}">서명</button>` : '<div class="sa">앞 단계 결재 후</div>'}</div>`; }).join('')}</div>
      <div class="pacts">
        ${o.status === 'approved' || o.status === 'received' ? `<button class="btn pri" data-print="${esc(o.id)}">발주서 출력</button>` : '<span class="muted" style="font-size:12.5px">결재가 끝나면 발주서를 출력할 수 있습니다</span>'}
        ${o.status === 'approved' ? `<button class="btn" data-recv="${esc(o.id)}">입고 처리</button>` : ''}
        ${lastSigned && o.status !== 'received' ? `<button class="btn" data-revoke="${esc(o.id)}">${esc(lastSigned)} 결재 물리기</button>` : ''}
      </div>
      ${o.lines.some(l => l.reason) ? `<h3 class="dh">발주 사유</h3><ul class="plain">${o.lines.map(l => `<li><b>${esc(l.name)}</b> — ${esc(l.reason || '')}</li>`).join('')}</ul>` : ''}
      <h3 class="dh">활동 기록</h3>
      ${hist.length ? `<ul class="plain alog">${hist.map(a => `<li><span class="muted">${esc(a.at)}</span> ${esc(a.action)} <span class="muted">· ${esc(a.by)}</span></li>`).join('')}</ul>` : '<div class="muted">기록 없음</div>'}
      <p class="note">${M.D.LIVE ? '결재·입고는 mlng_purchase_orders, 기록은 mlng_audit 에 저장됩니다.' : '데모: 결재·기록은 이 화면에서만 유지되고 새로고침하면 처음 상태로 돌아갑니다.'}</p>`);
  }

  function alerts() {
    const os = P().orders, pend = os.filter(o => o.status === 'pending'), out = [];
    if (pend.length) out.push({ proc: 'buy', level: 'info', title: `결재 대기 발주 ${pend.length}건 — 다음 단계 ${pend.map(o => `${o.id} ${nextStep(o)}`).join(' · ')}`,
      body: pend.map(o => `${o.vendor} ${won(total(o))}`).join(' · '), by: '구매', at: pend[0].created_at, go: 'buy_orders' });
    const late = os.filter(o => o.status === 'approved' && (M.now() - M.toDate(o.created_at)) / 86400000 > 7);
    if (late.length) out.push({ proc: 'buy', level: 'warn', title: `납기 지난 미입고 발주 ${late.length}건`, body: late.map(o => `${o.id} ${o.vendor}`).join(' · '), by: '구매', at: late[0].created_at, go: 'buy_orders' });
    return out;
  }

  const V = {};
  V.buy_home = () => {
    const rs = recs(), os = P().orders, month = ymd(M.now()).slice(0, 7);
    const pend = os.filter(o => o.status === 'pending'), notIn = os.filter(o => o.status === 'approved');
    const selSum = rs.filter(r => sel[r.it.code] != null).reduce((s, r) => s + (Number(sel[r.it.code]) || 0) * r.it.price, 0) + extra.reduce((s, x) => s + (Number(x.qty) || 0) * ITEM(x.code).price, 0);
    return `<div class="grid g4">
      <div class="card kpi"><div class="lab">발주 추천</div><div class="val" style="color:${rs.some(r => r.level === 'danger') ? 'var(--danger-ink)' : 'inherit'}">${rs.length}<small>건</small></div><div class="foot">공정 알림 · 사용량 기준</div></div>
      <div class="card kpi click" data-of="pending"><div class="lab">결재 대기</div><div class="val" style="color:${pend.length ? 'var(--warn-ink)' : 'inherit'}">${pend.length}<small>건</small></div><div class="foot">${STEPS().join(' → ')}</div></div>
      <div class="card kpi click" data-of="approved"><div class="lab">결재 완료 · 미입고</div><div class="val">${notIn.length}<small>건</small></div><div class="foot">발주서 출력 · 입고 대기</div></div>
      <div class="card kpi"><div class="lab">이번 달 발주 금액</div><div class="val">${f(os.filter(o => o.created_at.startsWith(month)).reduce((s, o) => s + total(o), 0) / 10000, 0)}<small>만원</small></div><div class="foot">부가세 별도 · 예시 단가</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>발주 추천 <span class="h2sub">알림과 사용량에서 찾은 소모품·예비품 — 고른 뒤 한 번에 발주 (거래처별로 나뉩니다)</span></h2>
      ${rs.length ? M.table([
        ['', r => `<input type="checkbox" data-pick="${esc(r.it.code)}" ${sel[r.it.code] != null ? 'checked' : ''}>`],
        ['품목', r => `<b>${esc(r.it.name)}</b><div class="muted" style="font-size:12px">${esc(r.it.code)} · ${esc(r.it.spec || '')}</div>`],
        ['공정', r => M.procTag(r.it.proc)],
        ['추천 사유', r => `<span class="tag j-${r.level === 'danger' ? 'danger' : r.level === 'warn' ? 'warn' : 'ok'}" style="margin-right:6px">${r.level === 'danger' ? '긴급' : r.level === 'warn' ? '권장' : '참고'}</span>${esc(r.reason)}${r.busy ? ` <span class="chip c-ext">발주 중 ${r.busy}</span>` : ''}`],
        ['수량', r => `<input class="in qin" type="number" min="0" data-qty="${esc(r.it.code)}" value="${esc(sel[r.it.code] ?? r.qty)}"> ${esc(r.it.unit)}`, 'n'],
        ['단가', r => f(r.it.price, 0), 'n'], ['거래처', r => esc(r.it.vendor)], ['', r => `<a href="#" data-go="${esc(r.go)}">근거 보기</a>`]], rs, { wrap: false, hl: r => sel[r.it.code] != null }) : '<div class="empty">지금 발주가 필요한 품목이 없습니다</div>'}
      <div class="addrow"><select class="in" id="bx-code">${BC().ITEMS.map(i => `<option value="${esc(i.code)}">${esc(i.name)} (${esc(i.code)})</option>`).join('')}</select>
        <input class="in qin" type="number" min="1" id="bx-qty" value="1"><input class="in" id="bx-why" placeholder="사유 (선택)" style="flex:1;min-width:140px"><button class="btn sm" id="bx-add">품목 직접 추가</button></div>
      ${extra.length ? `<div class="xlist">${extra.map((x, i) => `<span class="chip c-ext">${esc(ITEM(x.code).name)} × ${esc(x.qty)} <a href="#" data-xdel="${i}">✕</a></span>`).join(' ')}</div>` : ''}
      <div class="pacts" style="justify-content:flex-end"><span class="muted">선택 금액 ${won(selSum)}</span><button class="btn pri" id="bx-go">선택 항목 발주</button></div>
      ${msg ? `<p class="note">${esc(msg)}</p>` : ''}</div>`;
  };
  V.buy_orders = () => {
    const os = P().orders.filter(o => of === 'all' || o.status === of).slice().sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    return `<div class="card"><div class="tools">${M.seg('of', of, [['all', '전체'], ['pending', '결재 대기'], ['approved', '결재 완료 · 미입고'], ['received', '입고 완료']])}<span class="tsum">${os.length}건 · 행을 누르면 결재·발주서</span></div>
      ${M.table([['발주 번호', o => `<b>${esc(o.id)}</b>`], ['거래처', 'vendor'], ['품목', o => esc(o.lines.map(l => `${l.name} ×${l.qty}`).join(', '))], ['금액', o => f(total(o), 0), 'n'],
        ['결재', o => `${signDots(o)} <span class="muted">${signedN(o)}/${STEPS().length}</span>`], ['상태', stTag], ['작성', o => esc(o.created_at)]], os, { click: o => 'po:' + o.id, hl: o => o.status === 'pending', empty: '발주가 없습니다' })}</div>
    <div class="card" style="margin-top:16px"><h2>활동 기록 <span class="h2sub">발주 등록 · 결재 · 결재 물림 · 발주서 출력 · 입고</span></h2>
      ${M.table([['시각', 'at'], ['발주', a => `<a href="#" data-row="po:${esc(a.ref)}">${esc(a.ref)}</a>`], ['내용', 'action'], ['처리자', 'by']], P().audit.slice(0, 30), { wrap: false, empty: '기록이 없습니다' })}</div>`;
  };

  M.PROC.buy = '구매';
  M.buyApi = { orders: () => P().orders, audit: () => P().audit, recs, total, nextStep };   // 질의응답에서 읽는다
  M.mod({
    id: 'buy', proc: 'buy', group: '구매', order: 6,
    menu: [['buy_home', '발주 요청', 'cart'], ['buy_orders', '발주 · 결재', 'sign']],
    views: V, alerts, drawers: { 'po:': openPO },
    bind(root) {
      root.querySelectorAll('[data-of]').forEach(b => b.onclick = () => { of = b.dataset.of; if (M.cur !== 'buy_orders') M.go('buy_orders'); else M.render(); });
      root.querySelectorAll('[data-pick]').forEach(c => c.onchange = () => { const k = c.dataset.pick, r = recs().find(x => x.it.code === k);
        if (c.checked) sel[k] = r ? r.qty : 1; else delete sel[k]; msg = ''; M.render(); });
      root.querySelectorAll('[data-qty]').forEach(i => i.onchange = () => { sel[i.dataset.qty] = Math.max(0, parseInt(i.value, 10) || 0); M.render(); });
      const add = root.querySelector('#bx-add');
      if (add) add.onclick = () => { const q = parseInt(M.$('#bx-qty').value, 10) || 0; if (q > 0) extra.push({ code: M.$('#bx-code').value, qty: q, reason: M.$('#bx-why').value.trim() }); msg = ''; M.render(); };
      root.querySelectorAll('[data-xdel]').forEach(a => a.onclick = e => { e.preventDefault(); extra.splice(+a.dataset.xdel, 1); M.render(); });
      const go = root.querySelector('#bx-go'); if (go) go.onclick = createPOs;
      root.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => { const [id, s] = b.dataset.sign.split('|'); sign(id, s, M.$('#signer').value); });
      root.querySelectorAll('[data-revoke]').forEach(b => b.onclick = () => revoke(b.dataset.revoke));
      root.querySelectorAll('[data-recv]').forEach(b => b.onclick = () => receive(b.dataset.recv));
      root.querySelectorAll('[data-print]').forEach(b => b.onclick = () => printPO(b.dataset.print));
    },
  });
})();
