/* 3.0 ⑧ — 어디서든 찾고 바로 이동 (Ctrl+K)
 * ───────────────────────────────────────────────────────────────
 * 메뉴를 몰라도 된다. LOT · 발주 · 사건 · 계약 · 공구 · 화면 · 날짜를 한 칸에서 찾고, 못 찾으면 그대로 질문으로 보낸다.
 *   Ctrl+K (맥 ⌘K) 또는 / 로 열기 · ↑↓ 고르기 · Enter 이동 · Esc 닫기
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f } = M;
  let box = null, items = [], sel = 0, list = [];
  function index() {
    const T = window.MLNGTrust || {}, out = [];
    const vs = M.views(), seen = new Set();
    M.mods.forEach(m => (m.menu || []).forEach(([k]) => { if (!vs[k] || seen.has(k)) return; seen.add(k); const w = M.where(k);
      const t = w ? (w.sub ? `${w.tab[1]} ${w.sub[1]}` : w.tab[1]) : k; out.push({ k: '화면', t, s: w ? (w.item ? w.item.t : '더보기 · ' + w.more) : '', go: k }); }));
    (M.S.lots || []).forEach(l => out.push({ k: 'LOT', t: l.id, s: `${M.PROC[l.proc] || (l.kind === 'material' ? '소재' : '')} · ${f(l.qty, 0)}개 · ${String(l.end_at || l.start_at || l.first || '').slice(0, 10)}`, go: 'trace:' + l.id }));
    if (M.buyApi) M.buyApi.orders().forEach(o => out.push({ k: '발주', t: o.id, s: `${o.status} · ${o.lines.map(l => l.name).join(', ')}`, go: 'po:' + o.id }));
    if (M.caseApi && T.ready) M.caseApi.list().forEach(c => out.push({ k: '사건', t: `${c.id} ${c.name}`, s: `${M.caseApi.STAGES[c.st.stage]} · ${M.dx.won(c.money.won)}`, go: 'case:' + c.id }));
    (T.contracts || []).forEach(c => out.push({ k: '계약', t: c.id, s: `${T.co(c.provider).short} → ${T.co(c.consumer).short} · ${c.scopes.join(', ')}`, go: 'ctr:' + c.id }));
    (T.orders || []).forEach(o => out.push({ k: '스마트 발주', t: o.id, s: `${T.co(o.buyer).name} · ${f(o.qty, 0)}개`, go: 'deal_home' }));
    ((M.S.mach || {}).tools || []).forEach(t => out.push({ k: '공구', t: t.id, s: `${t.material} · VB ${f(t.vb_last, 2)} · ${t.date}`, go: 'mach:' + t.id }));
    (M.S.masters.equipment || []).forEach(e => out.push({ k: '설비', t: `${e.id} ${e.name}`, s: M.PROC[e.proc] || e.proc, go: { press: 'press_equip', heat: 'heat_equip', weld: 'weld_home', mach: 'mach_home', insp: 'insp_home' }[e.proc] || 'masters' }));
    [['주문 진행 보기', 'orders'], ['품질 문제 처리', 'cases'], ['출하해도 되나?', 'gate'], ['교대 넘기기', 'shift'], ['계획 바꿔 보기', 'whatif'], ['손실 비용', 'cost']].forEach(([t, go]) => out.push({ k: '바로가기', t, s: '', go }));
    return out;
  }
  function search(q) {
    q = q.trim().toLowerCase(); const r = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(q) || /^\d{2}-\d{2}$/.test(q)) { const d = q.length === 5 ? String(M.S.asof).slice(0, 5) + q : q; r.push({ sc: 9, k: '되감기', t: `${d} 로 되감기`, s: '그날 MES 가 본 공장', go: 'replay:' + d }); }
    if (q) items.forEach(it => { const t = it.t.toLowerCase(), s = (it.s || '').toLowerCase(), i = t.indexOf(q); const sc = i === 0 ? 3 : i > 0 ? 2 : s.includes(q) ? 1 : 0; if (sc) r.push(Object.assign({ sc }, it)); });
    else r.push(...items.filter(it => it.k === '바로가기' || it.k === '사건'));
    r.sort((a, b) => (b.sc || 0) - (a.sc || 0));
    const top = r.slice(0, 11);
    if (q.length > 1) top.push({ k: '질문', t: `「${q}」 물어보기`, s: '질의응답으로 보냅니다', ask: q });
    return top;
  }
  function draw() {
    const ul = box.querySelector('ul'); sel = Math.min(sel, Math.max(0, list.length - 1));
    ul.innerHTML = list.map((it, i) => `<li class="${i === sel ? 'on' : ''}" data-i="${i}"><span class="chip ${it.k === '질문' ? 'c-ok' : 'c-ext'}">${esc(it.k)}</span><b>${esc(it.t)}</b><em>${esc(it.s || '')}</em></li>`).join('') || '<li class="muted">찾는 것이 없습니다</li>';
    ul.querySelectorAll('li[data-i]').forEach(li => { li.onmouseenter = () => { sel = +li.dataset.i; ul.querySelectorAll('li').forEach((x, j) => x.classList.toggle('on', j === sel)); }; li.onclick = () => pick(+li.dataset.i); });
  }
  function pick(i) { const it = list[i]; if (!it) return; close(); if (it.ask) { if (M.askApi) M.askApi.ask(it.ask); return; } M.nav(it.go); }
  function open() {
    if (!M.S) return;
    if (!box) { box = document.createElement('div'); box.id = 'pal'; box.innerHTML = '<div class="palw"><input class="in" placeholder="LOT · 발주 · 사건 · 계약 · 공구 · 화면 · 날짜(07-13)를 찾거나, 그대로 질문하세요" autocomplete="off"><ul></ul><div class="palh">↑↓ 고르기 · Enter 이동 · Esc 닫기</div></div>'; document.body.appendChild(box);
      box.onclick = e => { if (e.target === box) close(); };
      const inp = box.querySelector('input');
      inp.oninput = () => { list = search(inp.value); sel = 0; draw(); };
      inp.onkeydown = e => { if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') { pick(sel); e.preventDefault(); } else if (e.key === 'Escape') close(); }; }
    items = index(); const inp = box.querySelector('input'); inp.value = ''; list = search(''); sel = 0; draw();
    box.classList.add('on'); setTimeout(() => inp.focus(), 0);
  }
  function close() { if (box) box.classList.remove('on'); }
  M.palette = { open, close };
  document.addEventListener('keydown', e => {
    const tg = e.target, typing = tg && /INPUT|TEXTAREA|SELECT/.test(tg.tagName);
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); box && box.classList.contains('on') ? close() : open(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); open(); }
  });
  const addBtn = () => { const th = document.getElementById('themebtn'); if (!th || document.getElementById('palbtn')) return; const b = document.createElement('button'); b.id = 'palbtn'; b.className = 'palbtn'; b.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>LOT · 주문 찾기 <kbd>Ctrl K</kbd>'; b.onclick = open; th.before(b);
    if (M.views().ask && !document.getElementById('askbtn')) { const a = document.createElement('button'); a.id = 'askbtn'; a.className = 'palbtn'; a.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>AI에게 묻기'; a.onclick = () => M.go('ask'); b.after(a); } };
  // 좁은 화면: 왼쪽 메뉴를 서랍으로 (☰ 단추로 열고, 메뉴를 고르면 닫힘)
  const addNav = () => { const top = document.getElementById('top'); if (!top || document.getElementById('navbtn')) return;
    const b = document.createElement('button'); b.id = 'navbtn'; b.setAttribute('aria-label', '메뉴'); b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'; top.insertBefore(b, top.firstChild);
    b.onclick = () => document.body.classList.toggle('navon');
    document.getElementById('nav').addEventListener('click', e => { if (e.target.closest('button')) document.body.classList.remove('navon'); });
    const sh = document.createElement('div'); sh.id = 'navshade'; sh.onclick = () => document.body.classList.remove('navon'); document.body.appendChild(sh); };
  const boot = () => { addBtn(); addNav(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
