/* MLNG MES 공용 화면 틀
 * ───────────────────────────────────────────────────────────────
 * 공정 모듈은 MLNG.mod({...}) 로 자기를 등록만 한다. 메뉴·알림·검사 기록·테마·상세 서랍은 여기서 같이 쓴다.
 *
 *   MLNG.mod({
 *     id: 'heat', proc: 'heat', group: '열처리', order: 30,
 *     menu: [['heat_home', '열처리 현황', 'flame'], ...],
 *     views: { heat_home: () => html, ... },
 *     alerts: S => [{ level, title, body, proc, at, go }],   // 현장 알림
 *     summary: S => ({ kpi, note, st }),                     // 공장 현황의 공정 카드
 *     drawers: { 'heat:': id => ... },                       // data-row="heat:HT-1" → 상세 서랍
 *   })
 */
(function () {
  'use strict';
  const CFG = window.MLNG_CONFIG || {};
  const D = window.MLNGData;
  const M = window.MLNG = { S: null, cur: 'overview', mods: [], CFG, D };
  const $ = M.$ = s => document.querySelector(s);

  // ── 형식
  M.esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NF = {};   // 숫자 형식기는 자릿수별로 한 번만 만든다 (toLocaleString 은 호출마다 새로 만들어 느림)
  M.f = (v, d = 1) => (v == null || v === '' || isNaN(v)) ? '—' : (NF[d] || (NF[d] = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }))).format(Number(v));
  M.pct = (v, d = 1) => (v == null || isNaN(v)) ? '—' : (Number(v) * 100).toFixed(d) + '%';
  M.median = a => { const b = a.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  M.toDate = s => new Date(String(s || '').replace(' ', 'T'));
  // 데모는 «데이터의 마지막 시각» 을 지금으로 본다 (스냅샷). 실시간은 실제 지금.
  M.now = () => (D.LIVE || !M.S || !M.S.asof) ? new Date() : M.toDate(M.S.asof);
  M.daysAgo = n => new Date(M.now().getTime() - n * 86400000);
  M.sinceDay = n => { const t = M.daysAgo(n); t.setHours(0, 0, 0, 0); return t; };   // «최근 N일» = N일 전 0시부터 (모든 화면 공통)
  const { esc, f } = M;

  // ── 공정 표시
  M.PROC = { press: '프레스', weld: '용접', heat: '열처리', mach: 'MCT 가공', insp: '검사', data: '데이터', mct: 'MCT', plan: '계획', buy: '구매', net: '연결', deal: '스마트 발주', agent: '에이전트', gate: '출하 게이트', case: '사건' };
  M.procTag = p => `<span class="proc p-${esc(p)}">${esc(M.PROC[p] || p)}</span>`;
  M.tag = (t, cls) => `<span class="tag ${cls || 't-' + esc(t)}">${esc(t)}</span>`;
  M.dot = (st, t) => `<span class="dot ${st}"></span>${esc(t)}`;

  const IC = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    trace: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h4a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3M7 18h4a3 3 0 0 0 3-3v0a3 3 0 0 1 3-3"/>',
    book: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M4 17a3 3 0 0 1 3-3h11"/>', check: '<path d="M4 12l5 5L20 6"/>',
    press: '<path d="M5 3h14v4H5zM12 7v6M7 13h10l-1 4H8zM4 21h16"/>',
    wave: '<path d="M2 12c3-6 5-6 8 0s5 6 8 0 3-4 4-2"/>',
    spark: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5 1-1 1-3 0-8z"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    range: '<path d="M3 12h18M7 8v8M17 8v8"/>', gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>', out: '<path d="M14 3h7v7M21 3l-9 9M10 5H5v14h14v-5"/>',
    cart: '<path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
    sign: '<path d="M4 20h16"/><path d="M14.5 4.5l5 5L9 20H4v-5z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    chain: '<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/><path d="M6.5 10v4h11v0"/><path d="M17.5 14v-2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    passport: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/>',
    badge: '<circle cx="12" cy="9" r="5"/><path d="M9 13.5L8 21l4-2 4 2-1-7.5"/>',
    leaf: '<path d="M5 19c8 0 14-6 14-14-8 0-14 5-14 13z"/><path d="M5 19c3-5 6-8 10-10"/>',
    deal: '<path d="M3 12l4-4 5 3 5-3 4 4"/><path d="M7 8v8l5 3 5-3V8"/>',
    agent: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 15h6"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14-5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14 5l2-2"/><path d="M20 20v-4h-4"/>',
    fed: '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><path d="M6 7l4 3M18 7l-4 3M6 17l4-3M18 17l-4-3"/>',
    case: '<path d="M4 7h16v12H4z"/><path d="M9 7V5h6v2"/><path d="M4 12h16"/><path d="M11 12v2h2v-2"/>',
    won: '<path d="M4 6l3 12 5-10 5 10 3-12"/><path d="M3 10h18M3 14h18"/>',
    gate: '<path d="M3 21V8l9-5 9 5v13"/><path d="M8 21v-8h8v8"/><path d="M8 17h8"/>',
    whatif: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    shift: '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-4 3-6 6-6s6 2 6 6"/><path d="M14 15c2.5-.8 7 0 7 4"/>',
  };
  M.ic = k => `<svg class="ic" viewBox="0 0 24 24">${IC[k] || ''}</svg>`;

  // ── 모듈 등록
  M.mod = m => { M.mods.push(m); M.mods.sort((a, b) => (a.order || 0) - (b.order || 0)); };
  M.views = () => Object.assign({}, ...M.mods.map(m => m.views || {}));
  // LOT 이력: mlng_trace 를 따라 위(조상)·아래(자손)로
  M.lineage = id => {
    const T = M.S.trace || [], up = [], down = [], seen = new Set([id]);
    const walk = (cur, dir, acc) => T.filter(t => (dir === 'up' ? t.child_lot : t.parent_lot) === cur).forEach(t => {
      const nx = dir === 'up' ? t.parent_lot : t.child_lot; if (seen.has(nx)) return; seen.add(nx); acc.push(nx); walk(nx, dir, acc); });
    walk(id, 'up', up); walk(id, 'down', down);
    const L = id2 => (M.S.lots || []).find(l => l.id === id2);
    return { up: up.map(L).filter(Boolean), down: down.map(L).filter(Boolean) };
  };
  M.inspections = () => D.LIVE ? (M.S.inspections || []) : D.demoInspections();

  // 알림 = 저장된 알림(mlng_alerts) + 각 모듈이 데이터에서 찾은 현장 알림
  let alertCache = null;   // 한 번 그리는 동안 여러 곳에서 부르므로 같은 작업 안에서는 한 번만 계산
  let computing = false;   // 알림 계산 중에 다른 모듈이 다시 알림을 부르면(사건·출하 게이트) 빈 목록 — 무한 반복 방지
  M.alerts = () => {
    if (alertCache) return alertCache.slice();
    if (computing) return [];
    computing = true; try { alertCache = computeAlerts(); } finally { computing = false; } queueMicrotask(() => { alertCache = null; });
    return alertCache.slice();
  };
  // 3.0 공장 되감기: 데이터를 그 시점까지로 자른 S 로 알림을 다시 계산 (화면의 M.S 는 잠시 바꿨다가 되돌린다)
  M.withS = (S2, fn) => { const keep = M.S; M.S = S2; try { return fn(); } finally { M.S = keep; } };
  M.alertsFor = S2 => M.withS(S2, () => computeAlerts());
  const computeAlerts = () => {
    const rank = { danger: 0, warn: 1, info: 2 };
    const stored = (M.S.alerts || []).map(a => Object.assign({ proc: a.proc || 'data' }, a));
    const found = [].concat(...M.mods.map(m => { try { return m.alerts ? m.alerts(M.S) : []; } catch (e) { console.warn(e); return []; } }));
    return stored.concat(found).sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3) || String(b.at || '').localeCompare(String(a.at || '')));
  };

  // ── 표
  M.table = (head, rows, opt = {}) => {
    if (!rows.length) return `<div class="empty">${opt.empty || '표시할 자료가 없습니다'}</div>`;
    return `<div class="${opt.wrap === false ? 'tbx' : 'tbwrap'}"><table class="tb"><thead><tr>${head.map(h => `<th class="${h[2] || ''}">${h[0]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${opt.hl && opt.hl(r) ? 'hl' : ''} ${opt.click ? 'click' : ''}" ${opt.click ? `data-row="${esc(opt.click(r))}"` : ''}>${head.map(h => `<td class="${h[2] || ''}">${typeof h[1] === 'function' ? h[1](r) : esc(r[h[1]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  };
  M.legend = items => `<div class="legend">${items.map(([c, t]) => `<span><i class="${c}"></i>${t}</span>`).join('')}</div>`;
  M.seg = (attr, cur, opts) => `<div class="seg sm">${opts.map(([k, t]) => `<button data-${attr}="${esc(k)}" class="${String(k) === String(cur) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;

  // ── 그림: 시계열 선 (여러 줄 + 허용 띠)
  //   series: [{ v:[..], cls:'s1', label }], band:{lo,hi}, opt:{ h, d, xlab:[[i,'text']], yfix:[lo,hi] }
  M.lineChart = (series, band, opt = {}) => {
    const W = opt.w || 640, H = opt.h || 200, L = 52, R = 10, T = 10, B = opt.xlab ? 24 : 10;
    const all = [].concat(...series.map(s => s.v)).filter(v => v != null && !isNaN(v));
    if (!all.length) return '<div class="empty">값이 없습니다</div>';
    let lo = Math.min(...all), hi = Math.max(...all);
    if (band) { lo = Math.min(lo, band.lo); hi = Math.max(hi, band.hi); }
    (opt.refs || []).forEach(r => { lo = Math.min(lo, r.y); hi = Math.max(hi, r.y); });
    if (opt.yfix) { lo = opt.yfix[0]; hi = opt.yfix[1]; }
    const pad = (hi - lo) * 0.08 || 1; const nonneg = lo >= 0; lo -= pad; hi += pad; if (nonneg && lo < 0) lo = 0;
    const n = Math.max(...series.map(s => s.v.length));
    const X = i => L + (W - L - R) * i / Math.max(1, n - 1), Y = y => T + (H - T - B) * (1 - (Math.min(hi, Math.max(lo, y)) - lo) / (hi - lo));
    const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * i / 3);
    const path = v => { let d = '', pen = false; v.forEach((y, i) => { if (y == null || isNaN(y)) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(y).toFixed(1); pen = true; }); return d; };
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
      ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 7}" y="${Y(t) + 4}" text-anchor="end">${f(t, opt.d ?? 1)}</text>`).join('')}
      ${band ? `<rect class="band" x="${L}" width="${W - L - R}" y="${Y(band.hi)}" height="${Math.max(1, Y(band.lo) - Y(band.hi))}"/>
        <line class="lim" x1="${L}" x2="${W - R}" y1="${Y(band.hi)}" y2="${Y(band.hi)}"/><line class="lim" x1="${L}" x2="${W - R}" y1="${Y(band.lo)}" y2="${Y(band.lo)}"/>` : ''}
      ${series.map(s => `<path class="ln ${s.cls || ''}" d="${path(s.v)}"/>`).join('')}
      ${(opt.refs || []).map(r => `<line class="lim ${r.cls || ''}" x1="${L}" x2="${W - R}" y1="${Y(r.y)}" y2="${Y(r.y)}"/>${r.label ? `<text class="ax ref" x="${W - R}" y="${Y(r.y) - 5}" text-anchor="end">${esc(r.label)}</text>` : ''}`).join('')}
      ${(opt.dots || []).map(p => `<circle class="pt ${p.cls || ''}" cx="${X(p.i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.r || 2.4}"><title>${esc(p.t || '')}</title></circle>`).join('')}
      ${(opt.xlab || []).map(([i, t], k, a) => `<text class="ax" x="${X(i)}" y="${H - 7}" text-anchor="${k === 0 ? 'start' : k === a.length - 1 ? 'end' : 'middle'}">${esc(t)}</text>`).join('')}
    </svg>`;
  };
  // ── 그림: 막대 (값 + 기준선)
  M.barChart = (rows, opt = {}) => {
    const W = opt.w || 640, H = opt.h || 190, L = 52, R = 10, T = 12, B = 24;
    const vals = rows.map(r => r.v || 0), hi = Math.max(opt.ref || 0, ...vals) * 1.12 || 1;
    const bw = (W - L - R) / Math.max(1, rows.length), Y = y => T + (H - T - B) * (1 - y / hi);
    const ticks = [0, 1, 2, 3].map(i => hi * i / 3), every = Math.ceil(rows.length / 8);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
      ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 7}" y="${Y(t) + 4}" text-anchor="end">${f(t, 0)}</text>`).join('')}
      ${rows.map((r, i) => `<rect class="bar ${r.cls || ''}" x="${(L + i * bw + bw * 0.18).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" y="${Y(r.v || 0).toFixed(1)}" height="${Math.max(0, Y(0) - Y(r.v || 0)).toFixed(1)}"><title>${esc(r.t || '')}</title></rect>`).join('')}
      ${opt.ref ? `<line class="lim" x1="${L}" x2="${W - R}" y1="${Y(opt.ref)}" y2="${Y(opt.ref)}"/><text class="ax ref" x="${W - R}" y="${Y(opt.ref) - 5}" text-anchor="end">${esc(opt.refLabel || '')}</text>` : ''}
      ${rows.map((r, i) => i % every ? '' : `<text class="ax" x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(r.x)}</text>`).join('')}
    </svg>`;
  };

  // ── 왼쪽 기둥
  function pill() {   // 통합 알림의 긴급 개수만 갱신
    const b = $('#nav button[data-k="alerts"]'); if (!b) return;
    const n = M.alerts().filter(a => a.level === 'danger').length; let el = b.querySelector('.pill-n');
    if (!n) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('span'); el.className = 'pill-n'; b.appendChild(el); }
    if (el.textContent !== String(n)) el.textContent = n;
  }
  function rail() {
    const n = M.alerts().filter(a => a.level === 'danger').length;
    const groups = [];
    M.mods.forEach(m => (m.menu || []).forEach(([k, t, i, g]) => {
      const name = g || m.group; let grp = groups.find(x => x.name === name);
      if (!grp) groups.push(grp = { name, items: [] });
      grp.items.push([k, t, i]);
    }));
    $('#plant').textContent = `${M.S.factory.name}${M.S.factory.line ? ' · ' + M.S.factory.line : ''}`;
    $('#nav').innerHTML = groups.map(g => `<div class="ngrp">${esc(g.name)}</div>` + g.items.map(([k, t, i]) =>
      `<button data-k="${k}" class="${k === M.cur ? 'on' : ''}" title="${esc(t)}">${M.ic(i)}<span>${esc(t)}</span>${k === 'alerts' && n ? `<span class="pill-n">${n}</span>` : ''}</button>`).join('')).join('')
      + Object.entries(CFG.LINKS || {}).filter(([, u]) => u).map(([p, u]) => `<a class="ext" href="${esc(u)}" target="_blank" rel="noopener">${M.ic('out')}<span>${esc(M.PROC[p] || p)} 열기</span></a>`).join('');
    $('#nav').querySelectorAll('button').forEach(b => b.onclick = () => M.go(b.dataset.k));
    const u = D.user();
    $('#who').textContent = u ? `${u.name} · ${u.role === 'manager' ? '관리자' : '작업자'}` : '';
  }
  // 메뉴는 다시 그리지 않고 선택 표시만 옮긴다 (메뉴 40여 개를 매번 새로 그리면 글자 배치에 시간이 든다)
  M.go = k => { M.cur = k; const nav = $('#nav'); if (nav && nav.firstChild) nav.querySelectorAll('button[data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === k)); else rail(); M.render(); $('#view').scrollTop = 0; };

  M.render = () => {
    let title = M.cur, grp = '';
    M.mods.forEach(m => (m.menu || []).forEach(([k, t, , g]) => { if (k === M.cur) { title = t; grp = g || m.group; } }));
    $('#ttl').textContent = title; $('#crumb').textContent = grp;
    updBar(); pill();
    const v = M.views()[M.cur];
    $('#view').innerHTML = v ? v() : '';
    sideLayout($('#view'));
    bind($('#view'));
  };
  // 요약 띠가 있는 화면은 «본문 + 오른쪽 요약 목록» 으로 배치한다 (항목을 누르면 지금처럼 상세 서랍)
  function sideLayout(v) {
    const ks = v.querySelector(':scope > .kstrip:not(.nside)');
    v.classList.toggle('hasside', !!ks);
    if (!ks) return;
    const main = document.createElement('div'), side = document.createElement('aside');
    main.className = 'vmain'; side.className = 'vside';
    ks.classList.add('kside'); side.innerHTML = '<div class="vsh">요약</div>'; side.appendChild(ks);
    while (v.firstChild) main.appendChild(v.firstChild);
    v.append(main, side);
  }
  // 화면 안의 공통 동작: data-go(화면 이동) · data-row(상세) · data-insp(검사 기록) · data-set(모듈 상태 바꾸고 다시 그리기)
  function bind(root) {
    root.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); M.nav(a.dataset.go); });
    root.querySelectorAll('[data-row]').forEach(r => r.onclick = e => { if (e.target.closest('button,a,input,select')) return; M.nav(r.dataset.row); });
    root.querySelectorAll('[data-insp]').forEach(b => b.onclick = e => { e.stopPropagation(); M.openInsp(...b.dataset.insp.split('|')); });
    M.mods.forEach(m => m.bind && m.bind(root));
  }
  M.bind = bind;
  M.nav = k => {
    if (k.startsWith('link:')) { const u = (CFG.LINKS || {})[k.slice(5)]; if (u) window.open(u, '_blank', 'noopener'); return; }
    for (const m of M.mods) for (const [pre, fn] of Object.entries(m.drawers || {})) if (k.startsWith(pre)) return fn(k.slice(pre.length));
    if (M.views()[k]) M.go(k);
  };

  // ── 상세 서랍
  M.drawer = (sub, title, html) => {
    $('#dsub').textContent = sub; $('#dttl').textContent = title; $('#dbody').innerHTML = html;
    $('#drawer').classList.add('on'); $('#shade').classList.add('on'); $('#dbody').scrollTop = 0;
    bind($('#dbody'));
  };
  // 요약 띠 항목 상세 — 제목·부제 + 블록 [{ h, html }]
  M.kdrawer = (sub, title, blocks) => M.drawer(sub, title, blocks.filter(Boolean).map(b => `${b.h ? `<h3 class="dh">${esc(b.h)}</h3>` : ''}${b.html}`).join(''));
  M.dl = (pairs, cls) => `<dl class="stat ${cls || ''}">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  M.closeDrawer = () => { $('#drawer').classList.remove('on'); $('#shade').classList.remove('on'); };

  // ── 검사 기록 창 (모든 공정 공용 → mlng_inspections)
  M.openInsp = (proc, lot, target) => {
    const procs = [...new Set(M.S.masters.equipment.map(e => e.proc))];
    $('#d-proc').innerHTML = procs.map(p => `<option value="${p}">${esc(M.PROC[p] || p)}</option>`).join('');
    $('#d-proc').value = proc || procs[0];
    const codes = () => { const p = $('#d-proc').value; $('#d-code').innerHTML = '<option value="">—</option>' + M.S.masters.defect_codes.filter(c => c.proc === p).map(c => `<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`).join(''); };
    $('#d-proc').onchange = codes; codes();
    $('#d-lot').value = lot || ''; $('#d-target').value = target || ''; $('#d-res').value = '불량'; $('#d-qty').value = 1; $('#d-note').value = ''; $('#d-msg').textContent = '';
    $('#dlg').style.display = 'flex';
  };
  async function saveInsp() {
    const rec = { proc: $('#d-proc').value, lot_id: $('#d-lot').value.trim() || null, target: $('#d-target').value.trim() || null, result: $('#d-res').value, defect_code: $('#d-code').value || null,
      qty: Math.max(1, parseInt($('#d-qty').value, 10) || 1), note: $('#d-note').value.trim() || null };
    if (!rec.lot_id) { $('#d-msg').textContent = 'LOT 을 적어 주세요'; return; }
    try { const r = await D.addInspection(rec); if (D.LIVE) M.S.inspections = [r].concat(M.S.inspections || []); $('#dlg').style.display = 'none'; M.closeDrawer(); rail(); M.render(); }
    catch (e) { $('#d-msg').textContent = '저장 실패: ' + e.message; }
  }

  // ── 테마: 시스템 → 라이트 → 다크
  const THEME_IC = { system: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24"><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/></svg>' };
  const THEME_TXT = { system: '시스템', light: '라이트', dark: '다크' };
  const getTheme = () => { try { const t = localStorage.getItem('mlng_theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch (e) { return 'system'; } };
  function setTheme(t) {
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    try { t === 'system' ? localStorage.removeItem('mlng_theme') : localStorage.setItem('mlng_theme', t); } catch (e) { /* 저장 못 해도 화면은 바뀐다 */ }
    $('#themebtn').innerHTML = THEME_IC[t] + THEME_TXT[t];
  }

  // ── 실시간 반영: 켜면 서버에서 주기적으로 다시 읽어 화면 수치를 바꾸고, 끄면 지금 화면을 멈춘 채로 둔다
  const LIVE_SEC = () => Math.max(10, CFG.LIVE_SEC || 30);
  let liveOn = (() => { try { return localStorage.getItem('mlng_live') !== 'off'; } catch (e) { return true; } })();
  let liveTimer = null, lastPull = null, pulling = false;
  function updBar() {
    const S = M.S || {}, t = lastPull ? lastPull.toTimeString().slice(0, 8) : '';
    $('#upd').innerHTML = D.LIVE ? (liveOn ? `<span class="dot ok pulse"></span>실시간 · 갱신 ${esc(t || String(S.built || '').slice(11, 19))}` : `<span class="dot warn"></span>멈춤 · ${esc(t || String(S.built || '').slice(11, 19))} 기준`)
      : `<span class="dot ok"></span>데이터 기준 ${esc(S.asof || '')}`;
    const b = $('#livebtn'); if (!b) return;
    b.disabled = !D.CONNECTED;
    b.classList.toggle('on', D.CONNECTED && liveOn);
    b.innerHTML = !D.CONNECTED ? '실시간 · 서버 미연결' : liveOn ? '<i></i>실시간 반영 중' : '<i></i>멈춤 (누르면 실시간)';
    b.title = !D.CONNECTED ? 'config.js 에 Supabase 주소·키를 넣으면 실시간 반영을 쓸 수 있습니다'
      : liveOn ? `${LIVE_SEC()}초마다 서버에서 다시 읽습니다 — 누르면 지금 화면을 멈춥니다` : '지금 화면을 멈춰 두었습니다 — 누르면 실시간으로 다시 읽습니다';
  }
  async function pull() {
    if (pulling || !liveOn || !D.CONNECTED || document.hidden) return;
    const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $('#view').contains(a)) return;   // 입력 중이면 이번 차례는 건너뜀
    pulling = true;
    try {
      if (!D.LIVE && !(await D.probe())) return;          // 표가 아직 비어 있으면 데모 그대로
      const S = await D.load();
      if (S && D.LIVE) { const keep = M.S && M.S.purchase && !S.purchase.orders.length ? M.S.purchase : null; M.S = S; if (keep) M.S.purchase = keep; lastPull = new Date(); rail(); M.render(); }
    } catch (e) { console.warn('[mlng] 실시간 갱신 실패', e.message); }
    finally { pulling = false; updBar(); }
  }
  function setLive(on) {
    liveOn = on; try { localStorage.setItem('mlng_live', on ? 'on' : 'off'); } catch (e) { /* 무시 */ }
    clearInterval(liveTimer); liveTimer = null;
    if (on && D.CONNECTED) { liveTimer = setInterval(pull, LIVE_SEC() * 1000); pull(); }
    updBar();
  }
  M.live = { on: () => liveOn, set: setLive };

  M.start = async () => {
    if (D.needLogin()) { $('#login').style.display = 'flex'; return; }
    $('#login').style.display = 'none';
    try { M.S = await D.load(); } catch (e) { $('#view').innerHTML = `<div class="empty">데이터를 불러오지 못했습니다 — ${esc(e.message)}</div>`; return; }
    lastPull = D.LIVE ? new Date() : null; rail(); M.render(); setLive(liveOn);
    // 2.0 신뢰 계층(키 생성·서명)은 첫 화면을 그린 뒤 이어서 준비 — 끝나면 다시 그린다
    if (window.MLNGTrust) window.MLNGTrust.init().then(() => { rail(); M.render(); }).catch(e => console.warn('[trust]', e));
  };
  M.init = () => {
    $('#l-go').onclick = async () => { $('#l-err').textContent = ''; try { await D.login($('#l-id').value.trim(), $('#l-pw').value); M.start(); } catch (e) { $('#l-err').textContent = e.message; } };
    $('#l-pw').onkeydown = e => { if (e.key === 'Enter') $('#l-go').click(); };
    $('#logout').style.display = 'none';
    $('#d-cancel').onclick = () => { $('#dlg').style.display = 'none'; };
    $('#d-save').onclick = saveInsp;
    setTheme(getTheme());
    $('#themebtn').onclick = () => setTheme({ system: 'light', light: 'dark', dark: 'system' }[getTheme()]);
    if (!$('#livebtn')) { const lb = document.createElement('button'); lb.id = 'livebtn'; lb.className = 'livebtn'; $('#themebtn').before(lb); }
    $('#livebtn').onclick = () => setLive(!liveOn);
    $('#dclose').onclick = M.closeDrawer; $('#shade').onclick = M.closeDrawer;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { M.closeDrawer(); $('#dlg').style.display = 'none'; } });
    M.start();
  };
})();
