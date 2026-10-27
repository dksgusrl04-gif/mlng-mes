/* 2.0 연결 모듈 ③ — 전자 발주 (조건부 자동 수입검사 · 정산)
 * ───────────────────────────────────────────────────────────────
 * 고객사(1차 협력사 B)가 발주서에 품질 조건을 «품질 협정 기준» 으로 넣는다 (열처리 불량률 · 조건 이탈 · 프레스 Cpk · 공구 마모 · 검사 불합격 · 탄소).
 * 우리가 LOT 을 납품하면 → B 의 MES 가 데이터 계약으로 그 LOT 의 디지털 여권을 받아 → 서명·사슬을 검증하고 → 조항을 하나씩 판정한다.
 *   모두 만족 → 자동 수입검사 합격 + 정산 승인 (B 서명)   /   하나라도 미달 → 근거가 붙은 클레임 자동 생성 (B 서명)
 */
(function () {
  'use strict';
  const M = window.MLNG, T = window.MLNGTrust, { esc, f, pct } = M;
  const today = () => M.now().toLocaleString('sv-SE').slice(0, 10);
  const addDays = (d, n) => new Date(M.toDate(d).getTime() + n * 86400000).toLocaleString('sv-SE').slice(0, 10);

  // 품질 협정 기준 (여권 데이터로 판정)
  const CL = {
    passport: { label: 'LOT 여권 진본 (서명·사슬 검증)', unit: '', fixed: true },
    heat_ppm: { label: '열처리 불량률', op: '≤', def: 450, unit: 'PPM', get: p => st(p, 'heat', s => s.data.ppm) },
    heat_dev: { label: '열처리 조건 이탈률', op: '≤', def: 0.05, unit: '', fmt: v => pct(v, 1), get: p => st(p, 'heat', s => s.data.deviation_max) },
    press_cpk: { label: '프레스 공정능력 Cpk', op: '≥', def: 1.33, unit: '', fmt: v => f(v, 2), get: p => st(p, 'press', s => s.data.cpk_min) },
    tool_vb: { label: 'MCT 공구 마모 VB', op: '≤', def: 0.5, unit: 'mm', fmt: v => f(v, 2), get: p => st(p, 'mach', s => s.data.vb_mm) },
    insp_fail: { label: '정밀가공 검사 불합격률', op: '≤', def: 0.10, unit: '', fmt: v => pct(v, 1), get: p => st(p, 'insp', s => s.data.parts ? s.data.fail / s.data.parts : null) },
    pcf: { label: '부품 1개당 탄소', op: '≤', def: 900, unit: 'g', fmt: v => f(v, 0), get: p => p.pcf ? p.pcf.total * 1000 : null },
  };
  function st(p, proc, fn) { const s = p.steps.find(x => x.proc === proc); return s ? fn(s) : undefined; }
  const fmtV = (k, v) => v === undefined ? '해당 없음' : v == null ? '—' : CL[k].fmt ? CL[k].fmt(v) : f(v, 0) + (CL[k].unit ? ' ' + CL[k].unit : '');

  const SO = T.orders = [];
  const soBody = o => ({ id: o.id, buyer: o.buyer, seller: o.seller, item: o.item, qty: o.qty, price: o.price, due: o.due, clauses: o.clauses });
  const delBody = d => ({ so: d.so, lot: d.lot, qty: d.qty, passport_root: d.root, checks: d.checks.map(c => [c.k, c.ok]), result: d.result, at: d.at });

  async function evaluate(o, lot) {
    const p = await T.issuePassport(lot), v = await T.verifyPassport(p), acc = await T.access(o.buyer, o.seller, 'lot_passport', lot);
    const checks = [{ k: 'passport', ok: acc.ok && v.ok, actual: !acc.ok ? '계약 없음 — 여권 조회 불가' : v.ok ? '진본' : '위변조 의심', th: '진본' }];
    o.clauses.filter(c => c.k !== 'passport').forEach(c => { const a = CL[c.k].get(p); const na = a === undefined;
      const ok = na ? true : a == null ? false : c.op === '≤' ? a <= c.v : a >= c.v; checks.push({ k: c.k, ok, na, actual: fmtV(c.k, a), th: `${c.op} ${fmtV(c.k, c.v)}` }); });
    const fail = checks.filter(c => !c.ok);
    const d = { so: o.id, lot, qty: p.qty, root: p.root, checks, result: fail.length ? 'claim' : 'accepted', at: T.stamp() };
    d.sig = await T.sign(o.buyer, delBody(d));
    if (fail.length) {
      d.claim = { id: `CL-${o.id.slice(3)}-${String(o.deliveries.filter(x => x.claim).length + 1).padStart(2, '0')}`, status: 'open',
        text: `${lot} 납품분 ${f(p.qty, 0)}개 중 품질 협정 기준 미달 ${fail.length}건 — ${fail.map(c => `${CL[c.k].label} ${c.actual} (기준 ${c.th})`).join(', ')}. 근거: LOT 디지털 여권 ${p.id} (사슬 끝 ${T.short(p.root)}).` };
      await T.append(o.buyer, 'claim', d.claim.id, `클레임 자동 생성 — ${lot} · ${fail.map(c => CL[c.k].label).join(', ')}`, delBody(d));
    } else await T.append(o.buyer, 'inspect', o.id, `자동 수입검사 합격 · 정산 승인 — ${lot} ${f(p.qty, 0)}개`, delBody(d));
    o.deliveries.unshift(d);
    return d;
  }
  T.dealEvaluate = evaluate;
  T.dealCL = CL; T.dealFmt = fmtV;

  async function newOrder(o, sellerSign) {
    const so = Object.assign({ id: `SO-${today().slice(2, 7).replace('-', '')}-${String(SO.length + 1).padStart(2, '0')}`, buyer: 'T1-B', seller: 'MLNG', deliveries: [], signs: {}, created: T.stamp() }, o);
    so.signs.buyer = Object.assign({ at: T.stamp() }, await T.sign(so.buyer, soBody(so)));
    await T.append(so.buyer, 'deal', so.id, `전자 발주 — ${T.co(so.buyer).name} → ${T.co(so.seller).name} · ${f(so.qty, 0)}개 · 조항 ${so.clauses.length}개`, soBody(so));
    if (sellerSign) { so.signs.seller = Object.assign({ at: T.stamp() }, await T.sign(so.seller, soBody(so))); await T.append(so.seller, 'deal', so.id, `전자 발주 수락 서명 — ${T.co(so.seller).name}`, soBody(so)); }
    SO.unshift(so); return so;
  }
  T.onInit(async () => {
    if (SO.length) return;
    const item = M.S.masters.items[0] || {};
    const o = await newOrder({ item: `${item.code} ${item.name}`, qty: 600000, price: 420, due: addDays(today(), 30),
      clauses: [{ k: 'passport' }, { k: 'heat_ppm', op: '≤', v: 350 }, { k: 'heat_dev', op: '≤', v: 0.05 }, { k: 'press_cpk', op: '≥', v: 0.9 }, { k: 'pcf', op: '≤', v: 900 }] }, true);
    // 데모 납품 이력: 최근 LOT 들(오늘 끝난 2 LOT 은 출하 대기로 남김) + 그 앞 2주 안에서 품질 협정 기준을 모두 통과한 LOT
    const all = (M.S.heat || { lots: [] }).lots, hl = all.slice(-8, -2), t0 = M.sinceDay(14).getTime(), pick = new Set(hl.map(l => l.id));
    const pass = id => { try { const p = T.passportPreview(id); return o.clauses.filter(c => c.k !== 'passport').every(c => { const a = CL[c.k].get(p); return a === undefined || (a != null && (c.op === '≤' ? a <= c.v : a >= c.v)); }); } catch (e) { return false; } };
    all.slice(0, -8).filter(l => M.toDate(l.end).getTime() >= t0 && T.passportPreview && pass(l.id)).forEach(l => pick.add(l.id));
    for (const l of all.filter(x => pick.has(x.id))) await evaluate(o, l.id);
  });

  // ── 화면
  let cur = null, msg = '';
  const delivered = () => new Set([].concat(...SO.map(o => o.deliveries.map(d => d.lot))));
  const amt = o => o.deliveries.filter(d => d.result === 'accepted').reduce((s, d) => s + d.qty * o.price, 0);
  const V = {};
  V.deal_home = () => {
    if (!T.ready) return '<div class="empty">신뢰 계층을 준비하는 중…</div>';
    const o = SO.find(x => x.id === cur) || SO[0]; if (!o) return '<div class="empty">전자 발주가 없습니다</div>'; cur = o.id;
    const ds = o.deliveries, acc = ds.filter(d => d.result === 'accepted'), cl = ds.filter(d => d.claim), open = cl.filter(d => d.claim.status === 'open');
    const left = (M.S.heat || { lots: [] }).lots.slice(-30).filter(l => !delivered().has(l.id)).reverse();
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">자동 수입검사 합격</div><div class="val" style="color:var(--ok)">${acc.length}<small>/ ${ds.length} LOT</small></div><div class="foot">${f(acc.reduce((s, d) => s + d.qty, 0), 0)}개 · 사람 검수 없이</div></div>
      <div class="kpi"><div class="lab">정산 승인</div><div class="val">${f(amt(o) / 1e6, 1)}<small>백만원</small></div><div class="foot">합격 수량 × 단가 ${f(o.price, 0)}원 (예시)</div></div>
      <div class="kpi click" data-row="${open[0] ? 'dl:' + o.id + '|' + open[0].lot : ''}"><div class="lab">미결 클레임</div><div class="val" style="color:${open.length ? 'var(--danger-ink)' : 'inherit'}">${open.length}<small>건</small></div><div class="foot">근거 데이터 자동 첨부</div></div>
      <div class="kpi"><div class="lab">납품 진척률</div><div class="val">${pct(ds.reduce((s, d) => s + d.qty, 0) / o.qty, 0)}</div><div class="foot">${f(ds.reduce((s, d) => s + d.qty, 0), 0)} / ${f(o.qty, 0)}개 · 납기 ${esc(o.due)}</div></div>
    </div>
    <div class="card"><h2>${esc(o.id)} <span class="h2sub">${esc(T.co(o.buyer).name)} → ${esc(T.co(o.seller).name)} · ${esc(o.item)} · ${f(o.qty, 0)}개</span>
      <span class="more" style="display:flex;gap:6px">${SO.length > 1 ? `<select class="in" id="so-pick" style="padding:3px 6px">${SO.map(x => `<option ${x.id === o.id ? 'selected' : ''}>${esc(x.id)}</option>`).join('')}</select>` : ''}<button class="btn sm" id="so-new">새 전자 발주 (B사)</button></span></h2>
      <div class="grid g2" style="align-items:start"><div><h3 class="dh" style="margin-top:0">품질 협정 기준 — 납품 LOT 마다 자동 판정</h3>
        ${M.table([['조항', c => esc(CL[c.k].label)], ['기준', c => c.k === 'passport' ? '진본' : `${c.op} ${fmtV(c.k, c.v)}`]], o.clauses, { wrap: false })}</div>
        <div><h3 class="dh" style="margin-top:0">서명</h3>${M.dl([['발주 (B사)', o.signs.buyer ? `✓ ${esc(o.signs.buyer.at)} · 키 ${esc(o.signs.buyer.kid)}` : '—'], ['수락 (우리)', o.signs.seller ? `✓ ${esc(o.signs.seller.at)}` : `<button class="btn pri sm" data-sosign="${esc(o.id)}">우리 이름으로 수락 서명</button>`], ['계약 해시', `<span class="mono">${esc(T.short(o.signs.buyer && o.signs.buyer.hash))}</span>`]], 'kvl')}
          <h3 class="dh">납품하기</h3><div class="pacts" style="margin-top:0"><select class="in" id="so-lot">${left.map(l => `<option value="${esc(l.id)}">${esc(l.id)} · ${esc(l.date)} · ${f(l.qty, 0)}개</option>`).join('')}</select><button class="btn pri" id="so-deliver" ${o.signs.seller && left.length ? '' : 'disabled'}>납품 → 자동 수입검사</button></div>
          ${msg ? `<p class="note">${esc(msg)}</p>` : ''}</div></div></div>
    <div class="card" style="margin-top:16px"><h2>납품 · 자동 수입검사 결과 <span class="h2sub">행을 누르면 판정 근거와 클레임</span></h2>
      ${M.table([['납품 LOT', d => `<b>${esc(d.lot)}</b>`], ['수량', d => f(d.qty, 0), 'n']].concat(o.clauses.map(c => [esc(CL[c.k].label.replace(/ \(.+\)/, '')), d => { const x = d.checks.find(y => y.k === c.k); return !x ? '' : x.na ? '<span class="muted">—</span>' : x.ok ? '<span class="ok">✓</span>' : `<span class="ng">✕ ${esc(x.actual)}</span>`; }]))
        .concat([['판정', d => d.result === 'accepted' ? '<span class="tag j-ok">합격 · 정산</span>' : `<span class="tag j-danger">클레임 ${d.claim.status === 'open' ? '' : '· ' + esc(d.claim.status)}</span>`], ['시각', d => `<span class="muted">${esc(d.at.slice(5, 16))}</span>`]]),
        ds, { wrap: false, click: d => `dl:${o.id}|${d.lot}`, hl: d => d.result === 'claim' })}</div>`;
  };
  function openDel(key) {
    const [sid, lot] = key.split('|'), o = SO.find(x => x.id === sid), d = o && o.deliveries.find(x => x.lot === lot); if (!d) return;
    M.drawer(`${o.id} · ${T.co(o.buyer).name} 자동 수입검사`, `${lot} ${d.result === 'accepted' ? '합격' : '클레임'}`, `
      ${M.table([['조항', c => esc(CL[c.k].label)], ['실제', 'actual', 'n'], ['기준', 'th'], ['판정', c => c.na ? '<span class="muted">해당 없음</span>' : c.ok ? '<span class="tag j-ok">만족</span>' : '<span class="tag j-danger">미달</span>']], d.checks, { wrap: false })}
      ${d.claim ? `<h3 class="dh">클레임 ${esc(d.claim.id)} <span class="tag ${d.claim.status === 'open' ? 'j-danger' : 'j-ok'}">${esc({ open: '열림', recheck: '재검사 요청', accepted: '수용 · 종결' }[d.claim.status])}</span></h3><div class="note" style="margin-top:0">${esc(d.claim.text)}</div>
        ${d.claim.status === 'open' ? `<div class="pacts"><button class="btn" data-clrecheck="${esc(key)}">재검사 요청 (우리)</button><button class="btn" data-claccept="${esc(key)}">클레임 수용 (우리)</button></div>` : ''}` : `<div class="note" style="color:var(--ok)">모든 조항 만족 — ${esc(T.co(o.buyer).name)} 서명으로 검수 합격·정산 ${f(d.qty * o.price, 0)}원 승인</div>`}
      <h3 class="dh">판정 근거</h3>${M.dl([['LOT 디지털 여권', `<a href="#" data-go="pp:${esc(lot)}">PP-${esc(lot)} 보기 →</a>`], ['여권 사슬 끝 해시', `<span class="mono">${esc(T.short(d.root))}</span>`], ['판정 서명 (B사)', `<span class="mono">${esc(d.sig.kid)} · ${esc(T.short(d.sig.hash))}</span>`]])}
      <div class="pacts"><button class="btn" data-dlver="${esc(key)}">판정 서명 검증</button></div><div id="dlres"></div>`);
  }
  function openNew() {
    M.drawer('1차 협력사 B 가 발주', '새 전자 발주', `<div class="frm">
      <label>수량</label><input class="in" id="sn-qty" type="number" value="300000"><label>단가 (원, 예시)</label><input class="in" id="sn-price" type="number" value="420">
      <label>납기 (일 뒤)</label><input class="in" id="sn-due" type="number" value="21"><label>품질 조항</label>
      <div class="ckl">${Object.entries(CL).filter(([k]) => k !== 'passport').map(([k, c]) => `<label class="ck"><input type="checkbox" data-snk="${k}" checked> ${esc(c.label)} ${esc(c.op)} <input class="in qin" data-snv="${k}" value="${c.def}" style="width:80px"> ${esc(c.unit)}</label>`).join('')}</div></div>
      <div class="pacts" style="justify-content:flex-end"><button class="btn pri" id="sn-go">B사 서명으로 발주</button></div><p class="note">LOT 여권 진본 확인은 모든 전자 발주에 기본으로 들어갑니다. 우리 회사가 수락 서명을 해야 납품을 받을 수 있습니다.</p>`);
    M.$('#sn-go').onclick = async () => {
      const cls = [{ k: 'passport' }].concat([...document.querySelectorAll('#dbody [data-snk]:checked')].map(i => { const k = i.dataset.snk; return { k, op: CL[k].op, v: +document.querySelector(`#dbody [data-snv="${k}"]`).value }; }));
      const item = M.S.masters.items[0] || {}, o = await newOrder({ item: `${item.code} ${item.name}`, qty: +M.$('#sn-qty').value || 1, price: +M.$('#sn-price').value || 0, due: addDays(today(), +M.$('#sn-due').value || 21), clauses: cls }, false);
      cur = o.id; msg = `${o.id} — B사 발주 서명 완료. 우리 수락 서명 후 납품할 수 있습니다`; M.closeDrawer(); M.render();
    };
  }

  M.mod({
    id: 'deal', group: '연결 · 신뢰 (2.0)', order: 52,
    menu: [['deal_home', '전자 발주', 'deal']],
    views: V,
    alerts: () => { if (!T.ready) return []; const out = [];
      SO.forEach(o => { const op = o.deliveries.filter(d => d.claim && d.claim.status === 'open');
        if (op.length) out.push({ key: 'deal.claim', data: { so: o.id, lots: op.map(d => d.lot) }, proc: 'deal', level: 'warn', title: `전자 발주 클레임 ${op.length}건 — ${op.map(d => d.lot).join(', ')}`, body: op[0].claim.text, by: T.co(o.buyer).name, at: op[0].at, go: `dl:${o.id}|${op[0].lot}` });
        if (!o.signs.seller) out.push({ proc: 'deal', level: 'info', title: `${o.id} 수락 서명 대기 — ${T.co(o.buyer).name} ${f(o.qty, 0)}개`, body: '수락해야 납품을 받을 수 있습니다', by: '전자 발주', at: o.created, go: 'deal_home' }); });
      return out; },
    drawers: { 'dl:': openDel },
    bind(root) {
      const on = (s, fn) => { const e = root.querySelector(s); if (e) e.onclick = fn; };
      on('#so-new', openNew);
      const pk = root.querySelector('#so-pick'); if (pk) pk.onchange = () => { cur = pk.value; msg = ''; M.render(); };
      on('#so-deliver', async () => { const o = SO.find(x => x.id === cur), lot = M.$('#so-lot').value; const d = await evaluate(o, lot);
        msg = d.result === 'accepted' ? `${lot} 자동 수입검사 합격 — 정산 ${f(d.qty * o.price, 0)}원 승인` : `${lot} 클레임 자동 생성 — ${d.checks.filter(c => !c.ok).map(c => CL[c.k].label).join(', ')}`; M.render(); });
      root.querySelectorAll('[data-sosign]').forEach(b => b.onclick = async () => { const o = SO.find(x => x.id === b.dataset.sosign); o.signs.seller = Object.assign({ at: T.stamp() }, await T.sign(o.seller, soBody(o))); await T.append(o.seller, 'deal', o.id, `전자 발주 수락 서명 — ${T.co(o.seller).name}`, soBody(o)); msg = `${o.id} 수락 — 이제 납품할 수 있습니다`; M.render(); });
      const cl = async (key, stt, title) => { const [sid, lot] = key.split('|'), o = SO.find(x => x.id === sid), d = o.deliveries.find(x => x.lot === lot); d.claim.status = stt; await T.append('MLNG', 'claim', d.claim.id, title, { id: d.claim.id, status: stt }); openDel(key); M.render(); };
      root.querySelectorAll('[data-clrecheck]').forEach(b => b.onclick = () => cl(b.dataset.clrecheck, 'recheck', '클레임 재검사 요청 — MLNG'));
      root.querySelectorAll('[data-claccept]').forEach(b => b.onclick = () => cl(b.dataset.claccept, 'accepted', '클레임 수용 · 종결 — MLNG'));
      root.querySelectorAll('[data-dlver]').forEach(b => b.onclick = async () => { const [sid, lot] = b.dataset.dlver.split('|'), o = SO.find(x => x.id === sid), d = o.deliveries.find(x => x.lot === lot), v = await T.verify(o.buyer, delBody(d), d.sig);
        M.$('#dlres').innerHTML = `<div class="note">${v.ok ? '✓ B사 서명 일치 — 판정 결과가 바뀌지 않았습니다' : '✕ ' + esc(v.why)}</div>`; });
    },
  });
  M.PROC.deal = '전자 발주';
})();
