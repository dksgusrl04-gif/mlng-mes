/* 구매 모듈 — 공구 주문 · 3단계 전자결재 · 공구 발주서 (MCT MES 공구 주문과 같은 설계)
 * ───────────────────────────────────────────────────────────────
 * 공구 주문: 등록 품목(js/catalog.js) 전체를 표에 올려 두고, 공정 알람·사용량에서 «추천» 을 표시한다.
 *            추천이 없는 품목도 체크해서 함께 발주할 수 있다. 여러 개를 골라 수량을 정하면 발주 1건으로 등록
 *   추천 — MCT 인서트: 최근 7일 공구 교체 횟수 × 날 수 × N주 − 재고 − 발주 중
 *          그 외: 품목의 `on` 화면을 가리키는 알람이 뜨면 (프레스 진동 → 블랭킹 펀치, 점용접 가압 이상 → 전극 팁 …)
 * 결재: 담당 → 검토 → 승인. 서명·결재 물림·출력·입고가 모두 활동 기록(mlng_audit)에 남는다
 * 발주서: 결재가 끝난 건만 출력. 기본은 결재란을 뺀 발송본, 「결재란 포함」 을 켜면 도장이 찍힌 사내 보관본
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f } = M;
  const BC = () => Object.assign({ COMPANY: 'MLNG', LINE: '', DEPT: '생산기술팀', STEPS: ['담당', '검토', '승인'], MACH_STOCK: 0, MACH_WEEKS: 2 }, M.CFG.BUY || {});
  const CAT = () => window.MLNG_CATALOG || [];
  const STEPS = () => BC().STEPS;
  const ITEM = code => CAT().find(i => i.code === code) || { code, name: code, unit: '개', qty: 1, proc: '', cls: '' };
  const PROCS = [['press', '프레스'], ['weld', '점용접'], ['heat', '열처리'], ['mach', 'MCT'], ['insp', '검사']];
  const ymd = d => d.toLocaleString('sv-SE').slice(0, 10);
  const stamp = () => { const d = M.now(), t = new Date(); return `${ymd(d)} ${t.toTimeString().slice(0, 5)}`; };
  const SIGNERS = () => [M.D.user().name, '생산 팀장', '공장장'].concat((M.S.masters.workers || []).map(w => w.name));

  // ── 저장소 (데모: 처음 열 때 지난 발주 3건)
  function P() {
    if (!M.S.purchase) M.S.purchase = M.D.LIVE ? { orders: [], audit: [] } : seed();
    return M.S.purchase;
  }
  const line = (code, qty, reason) => { const it = ITEM(code); return { code, name: it.name, spec: it.spec || '', cls: it.cls || '', proc: it.proc || '', unit: it.unit, qty, vendor: it.vendor || '', reason }; };
  function seed() {
    const d = n => ymd(M.daysAgo(n)), S = STEPS(), id = n => `PO-${d(n).slice(2).replace(/-/g, '')}-01`;
    const sg = (n, k) => Object.fromEntries(S.slice(0, k).map((s, i) => [s, { by: ['품질 담당', '생산 팀장', '공장장'][i] || '공장장', at: `${d(n)} ${['09:10', '10:25', '13:40'][i] || '14:00'}` }]));
    const orders = [
      { id: id(8), created_at: `${d(8)} 08:50`, by: '품질 담당', vendor: '구매팀', lines: [line('MC-INS', 24, '공구 교체 소모분 보충'), line('MC-TPM08', 3, '탭 파손 예비')], signs: sg(8, 3), status: 'received', received_at: `${d(5)} 15:00`, note: '' },
      { id: id(4), created_at: `${d(4)} 08:40`, by: '품질 담당', vendor: '구매팀', lines: [line('SP-TIP', 40, '전극 팁 정기 교체분'), line('SP-DRC', 1, '드레서 커터 마모')], signs: sg(4, 3), status: 'approved', note: '' },
      { id: id(1), created_at: `${d(1)} 16:20`, by: '품질 담당', vendor: '구매팀', lines: [line('PR-PUNB', 1, '금형 점검 예비품')], signs: sg(1, 1), status: 'pending', note: '' },
    ];
    const audit = [];
    orders.slice().reverse().forEach(o => {
      audit.push({ at: o.created_at, kind: 'po', ref: o.id, action: '발주 등록', by: o.by });
      S.forEach(s => o.signs[s] && audit.push({ at: o.signs[s].at, kind: 'po', ref: o.id, action: `${s} 결재 (${o.signs[s].by})`, by: o.signs[s].by }));
      if (o.received_at) audit.push({ at: o.received_at, kind: 'po', ref: o.id, action: '입고 처리', by: '품질 담당' });
    });
    audit.sort((a, b) => b.at.localeCompare(a.at));
    return { orders, audit };
  }
  const total = o => (o.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const signedN = o => STEPS().filter(s => o.signs && o.signs[s]).length;
  const nextStep = o => STEPS().find(s => !(o.signs && o.signs[s]));
  const stTag = o => o.status === 'received' ? '<span class="tag j-ok">입고 완료</span>' : o.status === 'approved' ? '<span class="chip c-ext">결재 완료 · 미입고</span>' : '<span class="tag j-warn">승인 대기</span>';
  const signDots = o => `<span class="sdots">${STEPS().map(s => `<i class="${o.signs && o.signs[s] ? 'on' : ''}" title="${esc(s)}${o.signs && o.signs[s] ? ' · ' + esc(o.signs[s].by) : ''}"></i>`).join('')}</span>`;
  const onOrder = code => P().orders.filter(o => o.status !== 'received').reduce((s, o) => s + (o.lines || []).filter(l => l.code === code).reduce((t, l) => t + (Number(l.qty) || 0), 0), 0);
  const log = async (ref, action) => { const rec = { at: stamp(), kind: 'po', ref, action, by: M.D.user().name }; P().audit.unshift(rec); await M.D.addAudit(rec); };

  // ── 추천: code → { qty, level, reason, go }
  function recMap() {
    const out = {}, A = M.alerts();
    CAT().forEach(it => {
      if (it.mach === 'insert' && M.S.mach) {
        const md = M.S.mach, since = M.sinceDay(M.CFG.RECENT_DAYS || 7).getTime();
        const n7 = md.tools.filter(t => M.toDate(t.date).getTime() >= since).length, cur = md.tools[md.tools.length - 1] || {};
        const lim = (M.CFG.MACH || {}).VB_LIMIT || 0.5, per = it.per_change || 1, ord = onOrder(it.code);
        let need = n7 * per * BC().MACH_WEEKS - BC().MACH_STOCK - ord;
        need = Math.max(0, Math.ceil(need / per) * per);
        const urgent = cur.vb_last != null && cur.vb_last >= lim;
        if (need > 0) out[it.code] = { qty: need, level: urgent ? 'danger' : 'warn', go: 'mach_home',
          reason: `${urgent ? `${cur.id} 교체 필요(VB ${f(cur.vb_last, 2)} mm) · ` : ''}최근 7일 공구 교체 ${n7}회 × ${per}날 × ${BC().MACH_WEEKS}주 − 재고 ${BC().MACH_STOCK}${ord ? ` − 발주 중 ${ord}` : ''}` };
        return;
      }
      if (!it.on) return;
      const a = A.find(x => x.go === it.on || String(x.go || '').startsWith(it.on + ':'));
      if (a && !onOrder(it.code)) out[it.code] = { qty: it.qty || 1, level: a.level, go: a.go, reason: a.title };
    });
    return out;
  }
  const recs = () => { const r = recMap(); return CAT().filter(it => r[it.code]).map(it => Object.assign({ it }, r[it.code])); };

  // ── 화면 상태
  const sel = new Set();
  let cf = 'all', cq = '', of = 'all', msg = '';

  function catRows() {
    const r = recMap(), rank = { danger: 0, warn: 1, info: 2 }, po = Object.fromEntries(PROCS.map(([k], i) => [k, i]));
    let rows = CAT().map(it => ({ it, rec: r[it.code], busy: onOrder(it.code) }));
    if (cf === 'rec') rows = rows.filter(x => x.rec); else if (cf === 'sel') rows = rows.filter(x => sel.has(x.it.code)); else if (cf !== 'all') rows = rows.filter(x => x.it.proc === cf);
    if (cq) { const q = cq.toLowerCase(); rows = rows.filter(x => [x.it.code, x.it.name, x.it.spec, x.it.cls].some(v => String(v || '').toLowerCase().includes(q))); }
    return rows.sort((a, b) => (a.rec ? rank[a.rec.level] ?? 3 : 9) - (b.rec ? rank[b.rec.level] ?? 3 : 9) || (po[a.it.proc] ?? 9) - (po[b.it.proc] ?? 9));
  }
  const clsTag = c => `<span class="tag ${c === '파손형' ? 'j-danger' : c === '마모형' ? 'j-warn' : 'j-ok'}" style="font-weight:600">${esc(c || '-')}</span>`;

  // ── 발주 창 (선택한 품목의 수량 정하기)
  function openOrder() {
    if (!sel.size) { msg = '발주할 품목을 하나 이상 고르세요'; M.render(); return; }
    const r = recMap(), items = [...sel].map(ITEM);
    M.drawer(`선택 ${items.length}종 · 수량을 정하세요`, `공구 발주 — ${items.length}종`, `
      <div class="qlist">${items.map(it => `<div class="qrow" data-code="${esc(it.code)}">
        <div class="nm"><b>${esc(it.name)}</b> ${M.procTag(it.proc)}<div class="muted" style="font-size:12px">${esc(it.code)} · ${esc(it.spec || '')}${r[it.code] ? ` · <span style="color:var(--warn-ink)">추천: ${esc(r[it.code].reason)}</span>` : ''}</div></div>
        <input class="in qin oqty" type="number" min="1" max="999" value="${r[it.code] ? r[it.code].qty : it.qty || 1}"><span class="muted">${esc(it.unit)}</span>
        <button class="btn sm" data-odel="${esc(it.code)}" title="목록에서 빼기">✕</button></div>`).join('')}</div>
      <input class="in" id="onote" placeholder="비고 (선택) — 발주서에 함께 적힙니다" style="width:100%;margin-top:10px">
      <div class="pacts" style="justify-content:flex-end"><span class="muted">합계 <b id="oqtot">0</b>개</span><button class="btn" id="ocancel">취소</button><button class="btn pri" id="osubmit">발주 등록</button></div>
      <p class="note">발주 1건으로 등록되고, 발주·결재 화면에서 ${esc(STEPS().join(' → '))} 결재를 받습니다.</p>`);
    const sum = () => { const n = [...document.querySelectorAll('#dbody .oqty')].reduce((s, i) => s + Math.max(1, parseInt(i.value, 10) || 1), 0); const e = M.$('#oqtot'); if (e) e.textContent = n; };
    document.querySelectorAll('#dbody .oqty').forEach(i => i.oninput = sum); sum();
    document.querySelectorAll('#dbody [data-odel]').forEach(b => b.onclick = () => { sel.delete(b.dataset.odel); if (sel.size) openOrder(); else { M.closeDrawer(); } M.render(); });
    M.$('#ocancel').onclick = M.closeDrawer;
    M.$('#osubmit').onclick = submitOrder;
  }
  async function submitOrder() {
    const r = recMap(), note = (M.$('#onote').value || '').trim();
    const lines = [...document.querySelectorAll('#dbody .qrow')].map(row => { const code = row.dataset.code, q = Math.max(1, parseInt(row.querySelector('.oqty').value, 10) || 1);
      return line(code, q, r[code] ? r[code].reason : (note || '현장 요청')); });
    if (!lines.length) return;
    const day = ymd(M.now()).slice(2).replace(/-/g, ''), seq = P().orders.filter(o => o.id.startsWith(`PO-${day}-`)).length + 1;
    const po = { id: `PO-${day}-${String(seq).padStart(2, '0')}`, created_at: stamp(), by: M.D.user().name, vendor: '구매팀', lines, signs: {}, status: 'pending', note };
    try {
      const saved = await M.D.savePO(po, true);
      P().orders.unshift(saved); await log(saved.id, '발주 등록');
      sel.clear(); msg = `${saved.id} 발주를 등록했습니다 (${lines.length}종 · ${total(saved)}개) — 발주·결재에서 결재하세요`;
      M.closeDrawer(); M.render();
    } catch (e) { const el = M.$('#dbody .note'); if (el) el.textContent = '발주 등록 실패 — ' + e.message; }
  }

  async function sign(id, step, by) {
    const o = P().orders.find(x => x.id === id); if (!o || nextStep(o) !== step) return;
    o.signs = Object.assign({}, o.signs, { [step]: { by, at: stamp() } });
    if (!nextStep(o)) o.status = 'approved';
    await M.D.savePO(o, false); await log(id, `${step} 결재 (${by})`); refresh(id);
  }
  async function revoke(id) {
    const o = P().orders.find(x => x.id === id); if (!o || o.status === 'received') return;
    const last = STEPS().filter(s => o.signs && o.signs[s]).pop(); if (!last) return;
    const s2 = Object.assign({}, o.signs); delete s2[last]; o.signs = s2; o.status = 'pending';
    await M.D.savePO(o, false); await log(id, `${last} 결재 물림`); refresh(id);
  }
  async function receive(id) {
    const o = P().orders.find(x => x.id === id); if (!o || o.status !== 'approved') return;
    o.status = 'received'; o.received_at = stamp();
    await M.D.savePO(o, false); await log(id, '입고 처리'); refresh(id);
  }
  function refresh(id) { openPO(id); if (M.cur.startsWith('buy_')) M.render(); }

  // ── 공구 발주서 (MCT MES 발주서 양식) — 새 창 · 인쇄/PDF
  const seal = name => {   // 이름 도장 (SVG) — 3자 이하는 세로, 그 이상은 두 줄
    const s = String(name || '').replace(/\s/g, ''), ch = [...s];
    const rows = ch.length <= 3 ? ch : [ch.slice(0, Math.ceil(ch.length / 2)).join(''), ch.slice(Math.ceil(ch.length / 2)).join('')];
    const fs = ch.length <= 3 ? 25 : ch.length <= 4 ? 27 : 20, y0 = 50 - (rows.length - 1) * fs * 0.52;
    return `<svg viewBox="0 0 100 100" width="44" height="44"><circle cx="50" cy="50" r="45" fill="none" stroke="#C0392B" stroke-width="5"/>${rows.map((t, i) =>
      `<text x="50" y="${(y0 + i * fs * 1.04 + fs * 0.36).toFixed(1)}" font-family="Batang,serif" font-size="${fs}" font-weight="700" fill="#C0392B" text-anchor="middle">${esc(t)}</text>`).join('')}</svg>`;
  };
  function docPO(o) {
    const C = BC(), now = stamp(), n = total(o);
    return `<section class="doc">
      <div class="sign">${STEPS().map(s => { const g = o.signs && o.signs[s]; return `<div><div class="t">${esc(s)}</div><div class="b">${g ? `${seal(g.by)}<span class="who">${esc(g.by)} · ${esc(g.at.slice(5))}</span>` : '<span class="ph">미결재</span>'}</div></div>`; }).join('')}</div>
      <h1>공 구 발 주 서</h1><div class="sub">${esc(C.COMPANY)}${C.LINE ? ' · ' + esc(C.LINE) : ''}</div>
      <div class="two"><div><table class="head">
          <tr><td class="k">발주번호</td><td class="v">${esc(o.id)}</td></tr>
          <tr><td class="k">발주일자</td><td class="v">${esc(o.created_at.slice(0, 10))}</td></tr>
          <tr><td class="k">요청부서</td><td class="v">${esc(C.DEPT)}</td></tr></table></div>
        <div><table class="head">
          <tr><td class="k">요 청 자</td><td class="v">${esc(o.by)}</td></tr>
          <tr><td class="k">발행시각</td><td class="v">${esc(now)}</td></tr>
          <tr><td class="k">품목 / 수량</td><td class="v">${o.lines.length} 종 · 총 ${f(n, 0)} 개</td></tr></table></div></div>
      <table><thead><tr><th style="width:34px">No</th><th style="width:84px">코드</th><th>품명 / 규격</th><th style="width:66px">부류</th><th style="width:72px">공정</th><th style="width:60px">수량</th><th style="width:96px">거래처</th><th>발주 사유</th></tr></thead>
        <tbody>${o.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td class="c nw">${esc(l.code)}</td><td>${esc(l.name)}${l.spec ? `<div class="sp">${esc(l.spec)}</div>` : ''}</td>
          <td class="c nw"><span class="tag">${esc(l.cls || '-')}</span></td><td class="c nw">${esc(M.PROC[l.proc] || l.proc || '')}</td><td class="n">${f(l.qty, 0)} ${esc(l.unit || '')}</td><td class="c">${esc(l.vendor || '')}</td><td>${esc(l.reason || '')}</td></tr>`).join('')}
        <tr class="tot"><td class="c" colspan="5">합 계</td><td class="n">${f(n, 0)}</td><td colspan="2"></td></tr></tbody></table>
      <div class="note"><b>발주 기준</b> — 추천 품목은 공정 알람(설비 진단·조건 이탈·센서 이상)과 사용량(MCT 공구 교체 횟수 × 날 수)에서 계산한 수량이며, 추천이 없는 품목은 등록 품목에서 현장이 직접 고른 것입니다.<br>
        ${o.note ? `비고: ${esc(o.note)}<br>` : ''}결재 ${esc(STEPS().join(' → '))} · ${o.status === 'received' ? `입고 ${esc(o.received_at || '')}` : '미입고'} · 발행 ${esc(M.D.user().name)}</div></section>`;
  }
  function printDocs(list, title) {
    const w = window.open('', '_blank'); if (!w) { msg = '팝업이 막혀 있습니다 — 이 사이트의 팝업을 허용해 주세요'; M.render(); return; }
    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:"맑은 고딕","Malgun Gothic","Noto Sans KR",sans-serif;color:#111;font-size:11pt;padding:24px;background:#fff}
      .bar{position:sticky;top:0;background:#1b365d;color:#fff;padding:10px 16px;margin:-24px -24px 22px;display:flex;gap:14px;align-items:center;font-size:10pt;z-index:2}
      .bar button{background:#fff;color:#1b365d;border:0;padding:6px 14px;border-radius:5px;font-weight:700;cursor:pointer}
      .bar span{opacity:.8}
      .doc{max-width:780px;margin:0 auto 40px}.doc + .doc{page-break-before:always;border-top:2px dashed #ccc;padding-top:30px}
      h1{font-size:21pt;text-align:center;letter-spacing:9px;margin-bottom:4px;font-weight:700}
      .sub{text-align:center;color:#666;font-size:9.5pt;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th,td{border:1px solid #333;padding:6px 8px;font-size:10pt;vertical-align:middle}
      th{background:#eef1f5;font-weight:600;text-align:center}
      td.n{text-align:right;white-space:nowrap}td.c{text-align:center}.sp{font-size:8.5pt;color:#666}.nw{white-space:nowrap}
      .head td{border:none;padding:2px 0;font-size:10pt}.head td.k{width:88px;color:#555}.head td.v{font-weight:600;border-bottom:1px solid #999;padding-left:6px}
      .two{display:flex;gap:30px;margin-bottom:18px}.two > div{flex:1}
      .sign{display:none;justify-content:flex-end;margin-bottom:10px}
      body.keep-sign .sign{display:flex}
      .sign > div{border:1px solid #333;width:92px;text-align:center;font-size:9pt}.sign > div + div{border-left:0}
      .sign .t{background:#eef1f5;padding:3px;border-bottom:1px solid #333;font-weight:600}
      .sign .b{height:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
      .sign .who{font-size:7pt;color:#555;line-height:1.1}.sign .ph{font-size:7.5pt;color:#bbb}
      .note{margin-top:16px;font-size:9pt;color:#555;line-height:1.7;border-top:1px solid #ddd;padding-top:10px}
      .tot{background:#f7f9fb;font-weight:700}
      .tag{display:inline-block;padding:1px 6px;border:1px solid #999;border-radius:3px;font-size:8.5pt}
      @media print{.bar{display:none}body{padding:0}.doc + .doc{border-top:0;padding-top:0}}
    </style></head><body>
    <div class="bar"><button onclick="window.print()">인쇄 / PDF 저장</button>
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" onchange="document.body.classList.toggle('keep-sign',this.checked)">결재란 포함 (사내 보관본)</label>
      <span>기본은 결재란을 빼고 나갑니다 — 구매·거래처 발송본</span></div>
    ${list.map(docPO).join('')}</body></html>`);
    w.document.close();
    list.forEach(o => log(o.id, '발주서 출력'));
  }

  // ── 발주 상세 서랍
  function openPO(id) {
    const o = P().orders.find(x => x.id === id); if (!o) return;
    const nx = nextStep(o), lastSigned = STEPS().filter(s => o.signs && o.signs[s]).pop(), hist = P().audit.filter(a => a.ref === id);
    M.drawer(`${o.created_at} · 요청 ${o.by}`, o.id, `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">${stTag(o)}<span class="muted">${o.lines.length}종 · 총 ${f(total(o), 0)}개</span></div>
      ${M.table([['품목', l => `<b>${esc(l.name)}</b><div class="muted" style="font-size:12px">${esc(l.code)}${l.spec ? ' · ' + esc(l.spec) : ''}</div>`], ['공정', l => l.proc ? M.procTag(l.proc) : ''], ['수량', l => `${f(l.qty, 0)} ${esc(l.unit || '')}`, 'n']], o.lines)}
      <h3 class="dh">전자결재</h3>
      <div class="signs">${STEPS().map(s => { const g = o.signs && o.signs[s];
        return `<div class="sbox ${g ? 'on' : s === nx ? 'next' : ''}"><div class="sl">${esc(s)}</div>${g ? `<div class="sv">${esc(g.by)}</div><div class="sa">${esc(g.at)}</div>`
          : s === nx && o.status !== 'received' ? `<select class="in" id="signer">${SIGNERS().map(n => `<option>${esc(n)}</option>`).join('')}</select><button class="btn pri sm" data-sign="${esc(o.id)}|${esc(s)}">서명</button>` : '<div class="sa">앞 단계 결재 후</div>'}</div>`; }).join('')}</div>
      <div class="pacts">
        ${o.status !== 'pending' ? `<button class="btn pri" data-print="${esc(o.id)}">발주서 출력</button>` : '<span class="muted" style="font-size:12.5px">결재가 끝나면 발주서를 출력할 수 있습니다</span>'}
        ${o.status === 'approved' ? `<button class="btn" data-recv="${esc(o.id)}">입고 처리</button>` : ''}
        ${lastSigned && o.status !== 'received' ? `<button class="btn" data-revoke="${esc(o.id)}">${esc(lastSigned)} 결재 물리기</button>` : ''}</div>
      <h3 class="dh">발주 사유</h3><ul class="plain">${o.lines.map(l => `<li><b>${esc(l.name)}</b> — ${esc(l.reason || '')}</li>`).join('')}</ul>
      ${o.note ? `<p class="note">비고: ${esc(o.note)}</p>` : ''}
      <h3 class="dh">활동 기록</h3>
      ${hist.length ? `<ul class="plain alog">${hist.map(a => `<li><span class="muted">${esc(a.at)}</span> ${esc(a.action)} <span class="muted">· ${esc(a.by)}</span></li>`).join('')}</ul>` : '<div class="muted">기록 없음</div>'}
      <p class="note">${M.D.LIVE ? '결재·입고는 mlng_purchase_orders, 기록은 mlng_audit 에 저장됩니다.' : '데모: 결재·기록은 이 화면에서만 유지되고 새로고침하면 처음 상태로 돌아갑니다.'}</p>`);
  }

  function alerts() {
    const os = P().orders, pend = os.filter(o => o.status === 'pending'), out = [];
    if (pend.length) out.push({ proc: 'buy', level: 'info', title: `승인 대기 발주 ${pend.length}건 — ${pend.map(o => `${o.id} ${nextStep(o)}`).join(' · ')}`,
      body: pend.map(o => `${o.lines.map(l => l.name).join(', ')}`).join(' · '), by: '구매', at: pend[0].created_at, go: 'buy_orders' });
    const late = os.filter(o => o.status === 'approved' && (M.now() - M.toDate(o.created_at)) / 86400000 > 7);
    if (late.length) out.push({ proc: 'buy', level: 'warn', title: `발주 후 7일 넘은 미입고 ${late.length}건`, body: late.map(o => o.id).join(' · '), by: '구매', at: late[0].created_at, go: 'buy_orders' });
    return out;
  }

  const V = {};
  V.buy_home = () => {
    const r = recMap(), rc = Object.keys(r).length, os = P().orders, rows = catRows();
    const pend = os.filter(o => o.status === 'pending'), notIn = os.filter(o => o.status === 'approved');
    const cnt = k => CAT().filter(it => it.proc === k).length;
    return `<div class="kstrip">
      <div class="kpi click" data-cf="rec"><div class="lab">발주 필요 품목${M.asmTag ? M.asmTag('buy') : ''}</div><div class="val" style="color:${Object.values(r).some(x => x.level === 'danger') ? 'var(--danger-ink)' : rc ? 'var(--warn-ink)' : 'inherit'}">${rc}<small>종</small></div><div class="foot">공정 알람 · 사용량 기준</div></div>
      <div class="kpi click" data-of="pending"><div class="lab">승인 대기</div><div class="val" style="color:${pend.length ? 'var(--warn-ink)' : 'inherit'}">${pend.length}<small>건</small></div><div class="foot">${esc(STEPS().join(' → '))}</div></div>
      <div class="kpi click" data-of="approved"><div class="lab">승인 완료 · 미입고</div><div class="val">${notIn.length}<small>건</small></div><div class="foot">발주서 출력 · 입고 대기</div></div>
      <div class="kpi click" data-cf="all"><div class="lab">등록 품목</div><div class="val">${CAT().length}<small>종</small></div><div class="foot">${PROCS.map(([k, t]) => `${t} ${cnt(k)}`).join(' · ')}</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="tools">${M.seg('cf', cf, [['all', `전체 ${CAT().length}`], ['rec', `추천 ${rc}`], ['sel', `선택 ${sel.size}`]].concat(PROCS.map(([k, t]) => [k, t])))}
        <input class="in" id="cq" placeholder="코드 · 품명 · 규격" value="${esc(cq)}" style="width:180px"></div>
      <div class="pacts" style="margin:0 0 10px">
        <button class="btn pri" id="bx-go">선택 항목 발주 (<span id="selcnt">${sel.size}</span>)</button>
        <button class="btn" id="bx-rec" ${rc ? '' : 'disabled'}>추천 모두 선택</button>
        <button class="btn" id="bx-clr">선택 해제</button>
        <button class="btn" id="bx-open" ${notIn.length ? '' : 'disabled'}>미입고 발주서 출력</button>
        <span class="muted" style="font-size:12px">추천이 없는 품목도 체크해서 함께 발주할 수 있습니다</span></div>
      ${msg ? `<p class="note" style="margin:0 0 10px">${esc(msg)}</p>` : ''}
      ${M.table([
        ['<input type="checkbox" id="allchk" title="보이는 품목 모두">', x => `<input type="checkbox" data-pick="${esc(x.it.code)}" ${sel.has(x.it.code) ? 'checked' : ''}>`],
        ['코드', x => `<b>${esc(x.it.code)}</b>`],
        ['품명 · 규격', x => `${esc(x.it.name)}<div class="muted" style="font-size:12px">${esc(x.it.spec || '')}</div>`],
        ['공정', x => M.procTag(x.it.proc)], ['부류', x => clsTag(x.it.cls)],
        ['추천', x => x.rec ? `<span class="tag j-${x.rec.level === 'danger' ? 'danger' : 'warn'}" style="margin-right:6px">${x.rec.level === 'danger' ? '긴급' : '추천'} ${f(x.rec.qty, 0)}${esc(x.it.unit)}</span><span style="font-size:12.5px">${esc(x.rec.reason)}</span> <a href="#" data-go="${esc(x.rec.go)}" style="font-size:12px">근거</a>` : '<span class="muted">—</span>'],
        ['발주 중', x => x.busy ? `<span class="chip c-ext">${f(x.busy, 0)}${esc(x.it.unit)}</span>` : '<span class="muted">—</span>', 'n'],
        ['기본 수량', x => `${f(x.it.qty || 1, 0)} ${esc(x.it.unit)}`, 'n'], ['거래처', x => `<span class="muted">${esc(x.it.vendor || '')}</span>`]],
        rows, { wrap: false, hl: x => !!x.rec, empty: '조건에 맞는 품목이 없습니다' })}
      <p class="note">품목을 더하거나 빼려면 js/catalog.js 를 고칩니다. MCT 공구는 MCT MES 공구 목록에서 이 제품 가공에 쓰는 것만 가져왔습니다.</p></div>`;
  };
  V.buy_orders = () => {
    const os = P().orders.filter(o => of === 'all' || o.status === of).slice().sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    return `<div class="card"><div class="tools">${M.seg('of', of, [['all', '전체'], ['pending', '승인 대기'], ['approved', '결재 완료 · 미입고'], ['received', '입고 완료']])}<span class="tsum">${os.length}건 · 행을 누르면 결재·발주서</span></div>
      ${M.table([['발주 번호', o => `<b>${esc(o.id)}</b>`], ['품목', o => esc(o.lines.map(l => `${l.name} ×${l.qty}`).join(', '))], ['수량', o => f(total(o), 0), 'n'],
        ['결재', o => `${signDots(o)} <span class="muted">${signedN(o)}/${STEPS().length}</span>`], ['상태', stTag], ['요청', o => `${esc(o.by)} <span class="muted">${esc(o.created_at)}</span>`]], os,
        { click: o => 'po:' + o.id, hl: o => o.status === 'pending', empty: '발주가 없습니다' })}</div>
    <div class="card" style="margin-top:16px"><h2>활동 기록 <span class="h2sub">발주 등록 · 결재 · 결재 물림 · 발주서 출력 · 입고</span></h2>
      ${M.table([['시각', 'at'], ['발주', a => `<a href="#" data-row="po:${esc(a.ref)}">${esc(a.ref)}</a>`], ['내용', 'action'], ['처리자', 'by']], P().audit.slice(0, 30), { wrap: false, empty: '기록이 없습니다' })}</div>`;
  };

  M.PROC.buy = '구매';
  // 알람 하나에 맞는 품목 (홈 「지금 조치할 것」의 발주 단추)
  const itemsFor = a => CAT().filter(it => (it.on && (a.go === it.on || String(a.go || '').startsWith(it.on + ':'))) || (it.mach === 'insert' && a.proc === 'mach' && /^mach(:|_tools)/.test(String(a.go || '')))).map(it => it.code);
  const preselect = codes => { codes.forEach(c => sel.add(c)); cf = 'sel'; msg = ''; M.closeDrawer(); M.go('buy_home'); };
  // 다른 모듈(에이전트)이 발주를 바로 만든다 — 결재는 똑같이 사람이 한다
  async function createPO(items, note, by) {
    const r = recMap(), lines = items.map(x => line(x.code, Math.max(1, x.qty || (r[x.code] || {}).qty || ITEM(x.code).qty || 1), x.reason || (r[x.code] || {}).reason || note || '자동 제안'));
    const day = ymd(M.now()).slice(2).replace(/-/g, ''), seq = P().orders.filter(o => o.id.startsWith(`PO-${day}-`)).length + 1;
    const po = { id: `PO-${day}-${String(seq).padStart(2, '0')}`, created_at: stamp(), by: by || M.D.user().name, vendor: '구매팀', lines, signs: {}, status: 'pending', note: note || '' };
    const saved = await M.D.savePO(po, true); P().orders.unshift(saved); await log(saved.id, '발주 등록' + (by ? ` (${by})` : '')); return saved;
  }
  M.buyApi = { orders: () => P().orders, audit: () => P().audit, recs, total, nextStep, catalog: CAT, itemsFor, preselect, createPO };   // 질의응답에서 읽는다
  M.mod({
    id: 'buy', proc: 'buy', group: '구매', order: 6,
    menu: [['buy_home', '공구 주문', 'cart'], ['buy_orders', '발주 · 결재', 'sign']],
    views: V, alerts, drawers: { 'po:': openPO },
    bind(root) {
      root.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { cf = b.dataset.cf; if (M.cur !== 'buy_home') M.go('buy_home'); else M.render(); });
      root.querySelectorAll('[data-of]').forEach(b => b.onclick = () => { of = b.dataset.of; if (M.cur !== 'buy_orders') M.go('buy_orders'); else M.render(); });
      // 체크는 화면을 다시 그리지 않는다 — 줄 색과 개수만 바꾼다
      const count = () => { const e = M.$('#selcnt'); if (e) e.textContent = sel.size; };
      root.querySelectorAll('[data-pick]').forEach(c => c.onchange = () => { const k = c.dataset.pick; c.checked ? sel.add(k) : sel.delete(k); c.closest('tr').classList.toggle('sel', c.checked); count(); });
      root.querySelectorAll('[data-pick]').forEach(c => c.closest('tr').classList.toggle('sel', c.checked));
      const all = root.querySelector('#allchk');
      if (all) all.onchange = () => { root.querySelectorAll('[data-pick]').forEach(c => { c.checked = all.checked; all.checked ? sel.add(c.dataset.pick) : sel.delete(c.dataset.pick); c.closest('tr').classList.toggle('sel', c.checked); }); count(); };
      const q = root.querySelector('#cq');
      if (q) q.oninput = () => { cq = q.value.trim(); const pos = q.selectionStart; M.render(); const n = M.$('#cq'); n.focus(); n.setSelectionRange(pos, pos); };
      const on = (s, fn) => { const e = root.querySelector(s); if (e) e.onclick = fn; };
      on('#bx-go', () => { msg = ''; openOrder(); });
      on('#bx-rec', () => { Object.keys(recMap()).forEach(k => sel.add(k)); msg = ''; M.render(); });
      on('#bx-clr', () => { sel.clear(); msg = ''; M.render(); });
      on('#bx-open', () => { const l = P().orders.filter(o => o.status === 'approved'); if (l.length) printDocs(l, '미입고 공구 발주서'); });
      root.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => { const [id, s] = b.dataset.sign.split('|'); sign(id, s, M.$('#signer').value); });
      root.querySelectorAll('[data-revoke]').forEach(b => b.onclick = () => revoke(b.dataset.revoke));
      root.querySelectorAll('[data-recv]').forEach(b => b.onclick = () => receive(b.dataset.recv));
      root.querySelectorAll('[data-print]').forEach(b => b.onclick = () => { const o = P().orders.find(x => x.id === b.dataset.print); if (o) printDocs([o], `공구 발주서 ${o.id}`); });
    },
  });
})();
