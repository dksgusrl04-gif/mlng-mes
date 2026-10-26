/* 2.0 연결 모듈 ① — 데이터 공유 계약 · 신뢰 원장 · 보안 구조
 * ───────────────────────────────────────────────────────────────
 * 데이터 공유 계약: «무엇을 · 누구에게 · 어떤 목적으로 · 언제까지 · 재공유 금지» 를 두 회사가 서명해 맺는다.
 *   계약이 유효한 동안 그 범위의 데이터만 상대에게 열리고(T.access), 모든 조회는 접근 기록과 신뢰 원장에 남는다.
 *   기간이 끝나거나 철회되면 즉시 닫힌다.
 * 신뢰 원장: 계약·서명·여권 발행·검수·에이전트 조치가 해시 사슬로 쌓인다. 「전체 검증」으로 위변조를 찾는다.
 */
(function () {
  'use strict';
  const M = window.MLNG, T = window.MLNGTrust, { esc, f } = M;

  // 공유할 수 있는 데이터 범위
  const SCOPES = {
    lot_passport: { name: 'LOT 디지털 여권', desc: 'LOT 공정 이력 · 검사 결과 · 서명', sens: '보통' },
    quality_kpi: { name: '품질 지표 요약', desc: '공정별 PPM · Cpk · 이상 건수 (원본 없이 요약만)', sens: '보통' },
    capacity: { name: '생산 능력 · 계획', desc: '하루 가능 산출 · 병목 · 재고', sens: '높음' },
    pcf: { name: '탄소 발자국', desc: 'LOT별 에너지 · 배출 추정', sens: '낮음' },
    forecast: { name: '수요 예측 · 발주 계획', desc: '향후 생산 계획 · 예상 발주량', sens: '높음' },
    mill_cert: { name: '소재 성적서', desc: '코일 로트별 화학성분 · 인장강도 성적', sens: '보통' },
    raw_sensor: { name: '설비 원시 신호', desc: '전류 · 진동 · 온도 원본 (노하우 포함)', sens: '매우 높음' },
  };
  const C = T.contracts = [];
  T.SCOPES = SCOPES;

  const day = n => M.daysAgo(-n).toLocaleString('sv-SE').slice(0, 10);
  const today = () => M.now().toLocaleString('sv-SE').slice(0, 10);
  const body = c => ({ id: c.id, provider: c.provider, consumer: c.consumer, scopes: c.scopes, purpose: c.purpose, start: c.start, end: c.end, reshare: c.reshare, retention_days: c.retention_days });
  const stOf = c => c.revoked ? 'revoked' : c.end < today() ? 'expired' : (c.signs.provider && c.signs.consumer) ? 'active' : 'proposed';
  const ST = { active: ['ok', '유효'], proposed: ['warn', '서명 대기'], expired: ['', '만료'], revoked: ['danger', '철회'] };
  const stTag = c => { const [k, t] = ST[stOf(c)]; return `<span class="tag ${k ? 'j-' + k : 't-off'}">${t}</span>`; };
  const coTag = id => { const c = T.co(id); return `<span class="cotag" style="--cc:${c.color}"><b>${esc(c.short)}</b>${esc(c.name)}</span>`; };

  // ── 계약 서명 (당사자 회사의 키로 계약 본문에 서명)
  async function signC(c, side) {
    const cid = side === 'provider' ? c.provider : c.consumer;
    c.signs[side] = Object.assign({ by: T.co(cid).name, at: T.stamp() }, await T.sign(cid, body(c)));
    await T.append(cid, 'contract', c.id, `데이터 계약 ${side === 'provider' ? '제공자' : '이용자'} 서명 — ${T.co(cid).name}`, body(c));
  }
  async function newContract(o, signProvider = true, signConsumer = false) {
    const c = Object.assign({ id: `DC-${today().slice(2, 4)}${String(C.length + 1).padStart(3, '0')}`, reshare: false, retention_days: 30, signs: {}, access: [], created: T.stamp() }, o);
    C.push(c);
    await T.append(c.provider, 'contract', c.id, `데이터 계약 제안 — ${T.co(c.provider).name} → ${T.co(c.consumer).name}`, body(c));
    if (signProvider) await signC(c, 'provider');
    if (signConsumer) await signC(c, 'consumer');
    return c;
  }

  // ── 접근 통제: 이용자가 범위 데이터를 요청 → 유효한 계약이 있을 때만 열린다 (모두 기록)
  T.access = async (consumer, provider, scope, resource) => {
    const c = C.find(x => x.provider === provider && x.consumer === consumer && stOf(x) === 'active' && x.scopes.includes(scope));
    const rec = { at: T.stamp(), who: consumer, scope, resource: resource || SCOPES[scope].name, ok: !!c, contract: c ? c.id : null };
    (c || C.find(x => x.provider === provider && x.consumer === consumer) || { access: T.deniedLog = T.deniedLog || [] }).access.unshift(rec);
    await T.append(provider, c ? 'access' : 'access-denied', c ? c.id : '-', `${c ? '데이터 제공' : '접근 거부'} — ${T.co(consumer).name} · ${SCOPES[scope].name}${resource ? ' · ' + resource : ''}`, rec);
    return { ok: !!c, contract: c, why: c ? '' : '유효한 데이터 계약이 없습니다' };
  };
  T.contractFor = (provider, consumer, scope) => C.find(x => x.provider === provider && x.consumer === consumer && stOf(x) === 'active' && x.scopes.includes(scope));
  T.contractState = stOf;

  // ── 초기 계약 (데모 공급망)
  T.onInit(async () => {
    if (C.length) return;
    await newContract({ provider: 'MLNG', consumer: 'T1-B', scopes: ['lot_passport', 'quality_kpi', 'pcf'], purpose: '납품 LOT 품질 확인 · 자동 검수', start: day(-60), end: day(305), retention_days: 365 }, true, true);
    await newContract({ provider: 'T1-B', consumer: 'MLNG', scopes: ['forecast'], purpose: '시트 생산 계획 공유 → 브래킷 생산 동기화', start: day(-30), end: day(150), retention_days: 30 }, true, true);
    await newContract({ provider: 'MAT-D', consumer: 'MLNG', scopes: ['mill_cert'], purpose: '입고 코일 성적서 확인', start: day(-90), end: day(275), retention_days: 730 }, true, true);
    await newContract({ provider: 'MLNG', consumer: 'T1-B', scopes: ['capacity'], purpose: '공급망 동기 계획 (가능 산출 공유)', start: day(-10), end: day(80), retention_days: 14 }, true, true);
    await newContract({ provider: 'MLNG', consumer: 'OEM-A', scopes: ['pcf', 'lot_passport'], purpose: '완성차 디지털 제품 여권 · 탄소 보고', start: day(0), end: day(365), retention_days: 3650 }, false, true);
  });

  // ── 화면 상태
  let sel = null, msg = '', vf = 'all', form = null, lv = null;
  const mine = c => c.provider === T.me || c.consumer === T.me;

  const V = {};
  V.net_contracts = () => {
    if (!T.ready) return '<div class="empty">신뢰 계층을 준비하는 중…</div>';
    const list = C.filter(mine).filter(c => vf === 'all' || stOf(c) === vf);
    const act = C.filter(mine).filter(c => stOf(c) === 'active'), wait = C.filter(mine).filter(c => stOf(c) === 'proposed'), acc = C.filter(mine).reduce((s, c) => s + c.access.length, 0);
    return `<div class="kstrip">
      <div class="kpi click" data-nf="active"><div class="lab">유효한 계약</div><div class="val">${act.length}<small>건</small></div><div class="foot">${esc([...new Set(act.map(c => T.co(c.provider === T.me ? c.consumer : c.provider).short))].join(' · '))}사와 연결</div></div>
      <div class="kpi click" data-nf="proposed"><div class="lab">서명 대기</div><div class="val" style="color:${wait.length ? 'var(--warn-ink)' : 'inherit'}">${wait.length}<small>건</small></div><div class="foot">상대 또는 우리 서명 필요</div></div>
      <div class="kpi click" data-row="netlog:all"><div class="lab">데이터 접근 기록</div><div class="val">${acc}<small>건</small></div><div class="foot">거부 ${C.filter(mine).reduce((s, c) => s + c.access.filter(a => !a.ok).length, 0) + (T.deniedLog || []).length}건 포함</div></div>
      <div class="kpi click" data-go="net_ledger"><div class="lab">신뢰 원장</div><div class="val">${T.ledger.length}<small>건</small></div><div class="foot">해시 사슬 · 회사 서명</div></div>
    </div>
    ${meBar()}
    <div class="card"><h2>데이터 공유 계약 <span class="h2sub">무엇을 · 누구에게 · 어떤 목적으로 · 언제까지 — 두 회사가 서명하면 그 범위만 열립니다</span>
      <button class="btn pri sm" id="nc-new" style="margin-left:auto">새 계약 제안</button></h2>
      <div class="tools">${M.seg('nf', vf, [['all', '전체'], ['active', '유효'], ['proposed', '서명 대기'], ['expired', '만료'], ['revoked', '철회']])}</div>
      ${M.table([['계약', c => `<b>${esc(c.id)}</b>`], ['제공 → 이용', c => `${coTag(c.provider)} → ${coTag(c.consumer)}`], ['공유 범위', c => c.scopes.map(s => `<span class="chip c-ext">${esc(SCOPES[s].name)}</span>`).join(' ')],
        ['목적', c => `<span style="font-size:12.5px">${esc(c.purpose)}</span>`], ['기간', c => `<span class="muted" style="font-size:12px">${esc(c.start)} ~ ${esc(c.end)}</span>`], ['서명', c => `${c.signs.provider ? '●' : '○'}${c.signs.consumer ? '●' : '○'}`], ['상태', stTag]],
        list, { click: c => 'ctr:' + c.id, hl: c => stOf(c) === 'proposed', empty: '계약이 없습니다' })}
      ${msg ? `<p class="note">${esc(msg)}</p>` : ''}</div>
    <div class="card" style="margin-top:16px"><h2>공유 범위 정의 <span class="h2sub">민감도가 «매우 높음» 인 항목은 기본적으로 공유하지 않는 것을 권장합니다</span></h2>
      ${M.table([['범위', k => `<b>${esc(SCOPES[k].name)}</b>`], ['포함 내용', k => esc(SCOPES[k].desc)], ['민감도', k => `<span class="tag ${SCOPES[k].sens === '매우 높음' ? 'j-danger' : SCOPES[k].sens === '높음' ? 'j-warn' : 'j-ok'}">${esc(SCOPES[k].sens)}</span>`],
        ['우리가 제공 중', k => C.filter(c => c.provider === T.me && stOf(c) === 'active' && c.scopes.includes(k)).map(c => T.co(c.consumer).short).join(', ') || '—']], Object.keys(SCOPES), { wrap: false })}</div>`;
  };
  // 보는 회사 바꾸기 (상대 시점 체험)
  function meBar() {
    return `<div class="mebar">지금 보는 회사 ${T.COMPANIES.map(c => `<button class="mebtn ${c.id === T.me ? 'on' : ''}" data-me="${c.id}" style="--cc:${c.color}"><b>${esc(c.short)}</b>${esc(c.name)}</button>`).join('')}
      <span class="muted">— 회사를 바꾸면 그 회사가 볼 수 있는 계약·데이터만 보입니다</span></div>`;
  }
  T.meBar = meBar;

  // 계약 상세
  function openC(id) {
    const c = C.find(x => x.id === id); if (!c) return;
    const st = stOf(c), side = c.provider === T.me ? 'provider' : c.consumer === T.me ? 'consumer' : null;
    const canSign = side && !c.signs[side] && st === 'proposed';
    M.drawer(`${T.co(c.provider).name} → ${T.co(c.consumer).name}`, c.id, `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">${stTag(c)}<span class="muted">${esc(c.purpose)}</span></div>
      ${M.dl([['제공자', coTag(c.provider)], ['이용자', coTag(c.consumer)], ['공유 범위', c.scopes.map(s => esc(SCOPES[s].name)).join(', ')], ['기간', `${esc(c.start)} ~ ${esc(c.end)}`],
        ['재공유', c.reshare ? '허용' : '<b>금지</b> — 이용자가 제3자에게 넘길 수 없음'], ['보관 기간', `받은 날부터 ${c.retention_days}일 후 이용자 측 삭제`]])}
      <h3 class="dh">서명</h3>
      <div class="signs" style="grid-template-columns:1fr 1fr">${['provider', 'consumer'].map(sd => { const g = c.signs[sd], cid = sd === 'provider' ? c.provider : c.consumer;
        return `<div class="sbox ${g ? 'on' : ''}"><div class="sl">${sd === 'provider' ? '제공자' : '이용자'} · ${esc(T.co(cid).name)}</div>${g ? `<div class="sv">서명됨</div><div class="sa">${esc(g.at)} · 키 ${esc(g.kid)}</div><div class="sa mono">${esc(T.short(g.hash))}</div>` : '<div class="sa">서명 전</div>'}</div>`; }).join('')}</div>
      <div class="pacts">${canSign ? `<button class="btn pri" data-csign="${esc(c.id)}">${esc(T.co(T.me).name)} 이름으로 서명</button>` : ''}
        ${st === 'active' && side ? `<button class="btn" data-crevoke="${esc(c.id)}">계약 철회</button>` : ''}
        <button class="btn" data-cverify="${esc(c.id)}">서명 검증</button>
        ${st === 'active' && c.consumer !== 'MLNG' ? `<button class="btn" data-ctry="${esc(c.id)}">${esc(T.co(c.consumer).short)}사로서 조회해 보기</button>` : ''}</div>
      <div id="cres"></div>
      <h3 class="dh">접근 기록 <span class="muted" style="font-weight:400">${c.access.length}건</span></h3>
      ${M.table([['시각', 'at'], ['요청', a => esc(T.co(a.who).short + ' · ' + a.resource)], ['결과', a => a.ok ? '<span class="tag j-ok">제공</span>' : '<span class="tag j-danger">거부</span>']], c.access.slice(0, 20), { wrap: false, empty: '아직 조회가 없습니다' })}
      <p class="note">계약 본문 해시 ${esc(T.short(c.signs.provider ? c.signs.provider.hash : ''))} — 두 회사의 서명이 같은 본문에 붙어 있어야 유효합니다.</p>`);
  }
  // 새 계약 제안 서랍
  function openNew() {
    const others = T.COMPANIES.filter(c => c.id !== T.me);
    M.drawer(`${T.co(T.me).name} 이 제안`, '새 데이터 공유 계약', `
      <div class="frm"><label>방향</label><select class="in" id="nc-dir"><option value="out">우리가 제공 → 상대가 이용</option><option value="in">상대가 제공 → 우리가 이용</option></select>
      <label>상대 회사</label><select class="in" id="nc-co">${others.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.role)})</option>`).join('')}</select>
      <label>공유 범위</label><div class="ckl">${Object.keys(SCOPES).map(k => `<label class="ck"><input type="checkbox" value="${k}" ${k === 'quality_kpi' ? 'checked' : ''}> ${esc(SCOPES[k].name)} <span class="muted">· ${esc(SCOPES[k].sens)}</span></label>`).join('')}</div>
      <label>목적</label><input class="in" id="nc-pur" value="품질 정보 공유">
      <label>기간 (일)</label><input class="in" id="nc-days" type="number" min="1" value="90">
      <label class="ck"><input type="checkbox" id="nc-re"> 재공유 허용 (권장하지 않음)</label></div>
      <div class="pacts" style="justify-content:flex-end"><button class="btn" id="nc-cancel">취소</button><button class="btn pri" id="nc-go">제안하고 우리 서명</button></div>
      <p class="note">제안하면 우리 서명이 먼저 붙고, 상대 회사가 서명하는 순간 유효해집니다. 데모에서는 위 「지금 보는 회사」를 상대로 바꿔 서명해 볼 수 있습니다.</p>`);
    M.$('#nc-cancel').onclick = M.closeDrawer;
    M.$('#nc-go').onclick = async () => {
      const scopes = [...document.querySelectorAll('#dbody .ckl input:checked')].map(i => i.value); if (!scopes.length) return;
      const other = M.$('#nc-co').value, out = M.$('#nc-dir').value === 'out';
      const c = await newContract({ provider: out ? T.me : other, consumer: out ? other : T.me, scopes, purpose: M.$('#nc-pur').value.trim() || '데이터 공유', start: today(), end: day(Math.max(1, +M.$('#nc-days').value || 90)), reshare: M.$('#nc-re').checked }, false, false);
      await signC(c, out ? 'provider' : 'consumer');
      msg = `${c.id} 계약을 제안했습니다 — 상대 서명을 기다립니다`; M.closeDrawer(); M.render(); openC(c.id);
    };
  }
  // 접근 기록 전체
  function openLog() {
    const all = [].concat(...C.filter(mine).map(c => c.access.map(a => Object.assign({ c: c.id }, a))), (T.deniedLog || []).map(a => Object.assign({ c: '—' }, a))).sort((a, b) => b.at.localeCompare(a.at));
    M.kdrawer('데이터 공유 계약', `접근 기록 ${all.length}건`, [{ html: M.table([['시각', 'at'], ['계약', 'c'], ['요청', a => esc(T.co(a.who).name + ' · ' + a.resource)], ['결과', a => a.ok ? '<span class="tag j-ok">제공</span>' : '<span class="tag j-danger">거부</span>']], all, { wrap: false, empty: '기록이 없습니다' }) },
      { html: '<p class="note">계약 범위 밖 요청은 자동으로 거부되고, 거부도 기록과 원장에 남습니다.</p>' }]);
  }

  // ── 신뢰 원장
  V.net_ledger = () => {
    if (!T.ready) return '<div class="empty">신뢰 계층을 준비하는 중…</div>';
    const L = T.ledger.slice().reverse(), kinds = {};
    T.ledger.forEach(e => kinds[e.kind] = (kinds[e.kind] || 0) + 1);
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">원장 기록</div><div class="val">${T.ledger.length}<small>건</small></div><div class="foot">${esc(Object.entries(kinds).map(([k, n]) => `${KIND[k] || k} ${n}`).join(' · '))}</div></div>
      <div class="kpi click" id="lg-verify2"><div class="lab">마지막 검증</div><div class="val" style="color:${lv ? (lv.ok ? 'var(--ok)' : 'var(--danger-ink)') : 'inherit'}">${lv ? (lv.ok ? '이상 없음' : `위변조 ${lv.broken.length}`) : '—'}</div><div class="foot">${lv ? `${lv.n}건 검증 · ${esc(lv.at)}` : '「전체 검증」을 누르세요'}</div></div>
      <div class="kpi"><div class="lab">최신 해시</div><div class="val mono" style="font-size:14px">${esc(T.short((T.ledger[T.ledger.length - 1] || {}).hash))}</div><div class="foot">외부 공증에 고정할 값</div></div>
      <div class="kpi"><div class="lab">참여 회사</div><div class="val">${new Set(T.ledger.map(e => e.company)).size}<small>곳</small></div><div class="foot">회사별 서명키로 서명</div></div>
    </div>
    <div class="card"><h2>신뢰 원장 <span class="h2sub">기록마다 앞 기록의 해시를 품고 회사 서명이 붙습니다 — 하나만 고쳐도 검증에서 드러납니다</span>
      <span class="more" style="display:flex;gap:6px"><button class="btn pri sm" id="lg-verify">전체 검증</button>${T.tampered ? '<button class="btn sm" id="lg-restore">원래대로</button>' : `<button class="btn sm" id="lg-tamper">위변조 시험</button>`}</span></h2>
      ${lv && !lv.ok ? `<div class="note" style="color:var(--danger-ink)">위변조 탐지 — ${lv.broken.map(b => `#${b.seq} ${esc(b.why)}`).join(' · ')}</div>` : lv ? `<div class="note" style="color:var(--ok)">${lv.n}건 모두 사슬과 서명이 맞습니다.</div>` : ''}
      ${M.table([['#', 'seq', 'n'], ['시각', e => `<span class="muted">${esc(e.at)}</span>`], ['회사', e => coTag(e.company)], ['종류', e => esc(KIND[e.kind] || e.kind)], ['내용', e => `${lv && lv.broken.some(b => b.seq === e.seq) ? '<b style="color:var(--danger-ink)">⚠ </b>' : ''}${esc(e.title)}`],
        ['해시', e => `<span class="mono">${esc(T.short(e.hash))}</span>`], ['앞 해시', e => `<span class="mono muted">${esc(T.short(e.prev))}</span>`]], L.slice(0, 200), { wrap: false, hl: e => lv && lv.broken.some(b => b.seq === e.seq) })}</div>`;
  };
  const KIND = { contract: '계약', access: '데이터 제공', 'access-denied': '접근 거부', passport: 'LOT 여권', credential: '능력 증명서', deal: '스마트 발주', inspect: '자동 검수', claim: '클레임', agent: '에이전트', sync: '공급망 동기화', fed: '공동 학습', test: '시험' };
  T.KIND = KIND;

  // ── 보안 구조
  V.net_security = () => {
    if (!T.ready) return '<div class="empty">신뢰 계층을 준비하는 중…</div>';
    return `<div class="card"><h2>회사별 서명키 <span class="h2sub">비밀키는 각 회사 안에만 있고, 공개키 지문으로 서명을 확인합니다</span></h2>
      ${M.table([['회사', c => coTag(c.id)], ['역할', 'role'], ['공급망 위치', c => ['완성차', '1차', '2차 (우리)', '소재'][c.tier]], ['서명 방식', () => T.cryptoOk ? 'ECDSA P-256 · SHA-256' : '데모 서명 (보안 연결 필요)'], ['공개키 지문', c => `<span class="mono">${esc((T.keys[c.id] || {}).fp || '')}</span>`]], T.COMPANIES, { wrap: false })}</div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>지키는 것</h2><ul class="plain">
        <li><b>데이터는 각 회사에</b> — 중앙에 모으지 않고, 계약된 범위만 요청할 때 내보냅니다</li>
        <li><b>계약 = 접근 권한</b> — 기간 · 목적 · 재공유 금지 · 보관 기간이 조항으로 붙고, 만료·철회 즉시 닫힙니다</li>
        <li><b>모든 기록에 회사 서명</b> — LOT 여권 · 능력 증명서 · 검수 결과를 받은 쪽이 직접 진위를 확인합니다</li>
        <li><b>해시 사슬 원장</b> — 누가 언제 무엇을 했는지 고쳐지지 않게 남고, 마지막 해시를 외부 공증에 고정할 수 있습니다</li>
        <li><b>원본 없이 증명</b> — 능력 증명서·공동 학습은 원본 데이터를 넘기지 않습니다</li></ul></div>
      <div class="card"><h2>운영 전환 시</h2><ul class="plain">
        <li>회사 계정 로그인 · 역할별 권한 · DB 행 단위 권한(RLS) 필수</li>
        <li>비밀키는 회사 서버(HSM·키 관리 서비스)에 두고 브라우저로 내리지 않음</li>
        <li>회사 간 전송은 상호 인증(mTLS) · 요청마다 계약 ID 확인</li>
        <li>전자계약 법적 효력은 공인 전자서명 연동 · 법무 검토 후 적용</li>
        <li>원장 해시를 일 1회 외부 타임스탬프 서비스에 고정</li></ul>
        <p class="note">데모에서는 4개 회사의 키를 이 브라우저에서 만들어 서명·검증 구조를 보여 줍니다.</p></div></div>`;
  };

  M.mod({
    id: 'net', group: '연결 · 신뢰 (2.0)', order: 50,
    menu: [['net_contracts', '데이터 공유 계약', 'link'], ['net_ledger', '신뢰 원장', 'chain'], ['net_security', '보안 구조', 'shield']],
    views: V,
    alerts: () => { if (!T.ready) return []; const w = C.filter(c => c.consumer === 'MLNG' || c.provider === 'MLNG').filter(c => stOf(c) === 'proposed' && !c.signs[c.provider === 'MLNG' ? 'provider' : 'consumer']);
      return w.length ? [{ proc: 'net', level: 'info', title: `서명 대기 데이터 계약 ${w.length}건 — ${w.map(c => `${c.id} (${T.co(c.provider === 'MLNG' ? c.consumer : c.provider).short}사)`).join(', ')}`, body: w.map(c => c.purpose).join(' · '), by: '데이터 계약', at: w[0].created, go: 'ctr:' + w[0].id }] : []; },
    drawers: { 'ctr:': openC, 'netlog:': openLog },
    bind(root) {
      root.querySelectorAll('[data-nf]').forEach(b => b.onclick = () => { vf = b.dataset.nf; if (M.cur !== 'net_contracts') M.go('net_contracts'); else M.render(); });
      root.querySelectorAll('[data-me]').forEach(b => b.onclick = () => { T.me = b.dataset.me; msg = ''; M.closeDrawer(); M.render(); });
      const on = (s, fn) => { const e = root.querySelector(s); if (e) e.onclick = fn; };
      on('#nc-new', openNew);
      const ver = async () => { lv = Object.assign(await T.verifyLedger(), { at: T.stamp() }); M.render(); };
      on('#lg-verify', ver); on('#lg-verify2', ver);
      on('#lg-tamper', async () => { const e = T.ledger[Math.floor(T.ledger.length / 2)]; T.tamper(e.seq); lv = Object.assign(await T.verifyLedger(), { at: T.stamp() }); M.render(); });
      on('#lg-restore', async () => { T.restore(); lv = Object.assign(await T.verifyLedger(), { at: T.stamp() }); M.render(); });
      root.querySelectorAll('[data-csign]').forEach(b => b.onclick = async () => { const c = C.find(x => x.id === b.dataset.csign); await signC(c, c.provider === T.me ? 'provider' : 'consumer'); openC(c.id); M.render(); });
      root.querySelectorAll('[data-crevoke]').forEach(b => b.onclick = async () => { const c = C.find(x => x.id === b.dataset.crevoke); c.revoked = T.stamp(); await T.append(T.me, 'contract', c.id, `데이터 계약 철회 — ${T.co(T.me).name}`, { id: c.id, revoked: c.revoked }); openC(c.id); M.render(); });
      root.querySelectorAll('[data-cverify]').forEach(b => b.onclick = async () => { const c = C.find(x => x.id === b.dataset.cverify), out = [];
        for (const sd of ['provider', 'consumer']) { const cid = sd === 'provider' ? c.provider : c.consumer, v = await T.verify(cid, body(c), c.signs[sd]); out.push(`${T.co(cid).name}: ${v.ok ? '✓ 서명 일치' : '✕ ' + v.why}`); }
        M.$('#cres').innerHTML = `<div class="note">${out.map(esc).join('<br>')}</div>`; });
      root.querySelectorAll('[data-ctry]').forEach(b => b.onclick = async () => { const c = C.find(x => x.id === b.dataset.ctry), lines = [];
        for (const s of c.scopes.concat(['raw_sensor'])) { const r = await T.access(c.consumer, c.provider, s); lines.push(`${SCOPES[s].name}: ${r.ok ? '✓ 제공 (' + r.contract.id + ')' : '✕ 거부 — ' + r.why}`); }
        openC(c.id); M.$('#cres').innerHTML = `<div class="note">${lines.map(esc).join('<br>')}</div>`; M.render(); });
    },
  });
  M.PROC.net = '연결';
})();
