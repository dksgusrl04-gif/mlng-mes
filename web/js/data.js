/* 데이터 층 — 데모(JSON) / 실시간(Supabase) 두 갈래를 같은 모양으로 돌려준다.
 *
 * 로그인 없이 anon 키로 읽는다 (Supabase RLS 가 anon 읽기를 허용 — supabase/new_project_setup.sql)
 *   SUPABASE_URL·ANON_KEY 가 비어 있으면  → 데모 스냅샷
 *   채워져 있고 mlng_lots 에 행이 있으면   → 실시간
 *   채워져 있지만 표가 비었거나 못 읽으면 → 데모 스냅샷 (연결 상태는 «데이터 상태» 화면에 표시)
 * 쓰는 것 (실시간일 때만): mlng_inspections · mlng_work_orders 추가 · mlng_purchase_orders 추가/결재 · mlng_audit 추가
 * 질의응답: Supabase Edge Function(mlng-ask) 이 Claude API 를 중계 — API 키는 브라우저에 없다
 */
(function () {
  'use strict';
  const CFG = window.MLNG_CONFIG || {};
  const BASE = (CFG.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = CFG.SUPABASE_ANON_KEY || '';
  const CONNECTED = !!(BASE && KEY);
  let MODE = 'demo';            // 'live' | 'demo'
  let DBSTATE = CONNECTED ? '확인 전' : '연결 안 함';

  // 예전 anon 키(JWT)만 Authorization 에 싣는다 — 새 publishable 키(sb_publishable_…)는 apikey 헤더만
  const hdr = () => Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + KEY } : {});
  async function db(method, path, body) {
    const r = await fetch(`${BASE}/rest/v1${path}`, { method, headers: Object.assign(hdr(), method === 'POST' || method === 'PATCH' ? { Prefer: 'return=representation' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const t = await r.text(); throw new Error(`${r.status} ${t.slice(0, 200)}`); }
    return r.status === 204 ? null : r.json();
  }
  const soft = p => p.catch(e => { console.warn('[mlng] 읽기 실패', e.message); return null; });

  // ── 데모 데이터 시연 보정 (데이터 상태 화면에 그대로 밝힌다)
  //   ① 날짜 이동: 공개 데이터셋(2022년)의 마지막 작업 시각이 «오늘(또는 어제) 같은 시각» 이 되도록 모든 날짜를 같은 일수만큼 옮긴다
  //      LOT · 작업지시 번호 속 날짜(PR-220718 · WO-220719-0064 · CH-220717-0001)도 같이 옮겨 서로 연결이 유지된다
  //   ② 프레스 취수 12 → 24: 프레스 일 생산이 열처리 투입보다 적던 물량 역전을 바로잡는다 (취수는 원래 데모 설정값)
  const pad = n => String(n).padStart(2, '0');
  const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  function calibrate(d) {
    if (d.press && d.press.cav === 12) {
      const k = 2; d.press.cav = 24;
      d.press.lots.forEach(l => { l.qty *= k; l.ppm = l.qty ? +(l.bad / l.qty * 1e6).toFixed(1) : null; });
      (d.lots || []).filter(l => l.proc === 'press').forEach(l => { l.qty *= k; l.good = l.qty - (l.bad || 0); });
      ((d.masters || {}).equipment || []).forEach(e => { if (e.meta && e.meta.zones) e.meta.zones = String(e.meta.zones).replace('취수 12', '취수 24'); });
    }
    const asof = new Date(String(d.asof).replace(' ', 'T')), now = new Date();
    let days = Math.round((new Date(ymd(now)) - new Date(ymd(asof))) / 86400000);
    if (now.getHours() * 60 + now.getMinutes() < asof.getHours() * 60 + asof.getMinutes()) days -= 1;   // 아직 그 시각 전이면 어제로
    if (days <= 0) return d;
    const sh = (y, m, dd) => { const t = new Date(+y, +m - 1, +dd); t.setDate(t.getDate() + days); return t; };
    const txt = JSON.stringify(d)
      .replace(/\b(202[0-3])-(\d\d)-(\d\d)/g, (x, y, m, dd) => ymd(sh(y, m, dd)))
      .replace(/\b(PR|WD|MC|IN|WO|CH)-(2[0-3])(\d\d)(\d\d)\b/g, (x, p, y, m, dd) => { if (+m < 1 || +m > 12 || +dd < 1 || +dd > 31) return x; const t = sh('20' + y, m, dd); return `${p}-${String(t.getFullYear()).slice(2)}${pad(t.getMonth() + 1)}${pad(t.getDate())}`; });
    const out = JSON.parse(txt); out.demo_shift = days; out.demo_from = d.asof; return out;
  }
  async function loadDemo() {
    if (window.MLNG_DEMO) return calibrate(JSON.parse(JSON.stringify(window.MLNG_DEMO)));
    const r = await fetch('data/demo.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('data/demo.json 을 읽지 못했습니다');
    return calibrate(await r.json());
  }

  // 실시간: 표 → 데모와 같은 모양으로
  async function loadLive() {
    const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const [items, equip, rout, codes, workers, wos, lots, trace, alerts, insp, recipe, jobs, pos, audit] = await Promise.all([
      '/mlng_items?select=*', '/mlng_equipment?select=*', '/mlng_routings?select=*&order=seq.asc', '/mlng_defect_codes?select=*', '/mlng_workers?select=*',
      `/mlng_work_orders?select=*&created_at=gte.${since}&order=created_at.desc&limit=1000`, `/mlng_lots?select=*&order=start_at.desc&limit=3000`,
      '/mlng_trace?select=*&order=at.desc&limit=3000', '/mlng_alerts?select=*&order=at.desc&limit=100', '/mlng_inspections?select=*&order=at.desc&limit=1000',
      '/heat_recipes?select=*', `/heat_jobs?select=*&start_at=gte.${since}&order=start_at.asc&limit=2000`,
      '/mlng_purchase_orders?select=*&order=created_at.desc&limit=300', '/mlng_audit?select=*&order=at.desc&limit=500',
    ].map(p => soft(db('GET', p))));
    if (!lots) { DBSTATE = '연결 실패 — 표를 읽지 못함 (SQL 실행·키 확인)'; return null; }
    if (!lots.length) { DBSTATE = '연결됨 — 표가 비어 있어 데모 스냅샷 표시'; return null; }
    DBSTATE = '연결됨 — 실시간';
    const W = Object.fromEntries((workers || []).map(w => [w.id, w.name]));
    const L = Object.fromEntries((lots || []).map(l => [l.id, l]));
    const hl = (jobs || []).map(j => ({ id: j.id, job: j.job_no, wo: j.wo_id, date: String(j.start_at || '').slice(0, 10), start: String(j.start_at || '').slice(0, 16),
      end: String(j.end_at || '').slice(0, 16), dur_h: j.dur_h, item: (L[j.id] || {}).item_code, mat_lot: j.mat_lot, worker: W[(L[j.id] || {}).worker_id] || '',
      equip: j.equipment_id, qty: j.qty, good: j.good, bad: j.bad, ppm: j.qty ? j.bad / j.qty * 1e6 : null, defects: j.defects || {}, stats: j.stats || {}, heater: j.heater || {} }));
    const asof = hl.length ? hl[hl.length - 1].end : null;
    return {
      built: new Date().toLocaleString('sv-SE').slice(0, 19), asof, live: true,
      factory: { name: CFG.PLANT_NAME || 'MLNG', line: '' },
      masters: { items: items || [], equipment: equip || [], routings: rout || [], defect_codes: codes || [], workers: workers || [] },
      work_orders: wos || [], lots: (lots || []).map(l => Object.assign({}, l, { worker: W[l.worker_id] || '' })), trace: trace || [],
      heat: { target_ppm: 450, recipe: (recipe || []).map(r => Object.assign({ d: r.unit === '%C' ? 3 : 1 }, r)), heaters: [
        { key: 'op1', label: '소입로 1존' }, { key: 'op2', label: '소입로 2존' }, { key: 'op3', label: '소입로 3존' }, { key: 'op4', label: '소입로 4존' },
        { key: 'opd1', label: '건조로 1존' }, { key: 'opd2', label: '건조로 2존' }], lots: hl, profiles: {}, rel: [], source: '설비 수집' },
      alerts: alerts || [], inspections: insp || [],
      purchase: { orders: pos || [], audit: audit || [] },
    };
  }
  async function profile(id) {           // 실시간 모드에서 LOT 상세를 열 때만 읽는다
    const r = await db('GET', `/heat_profiles?job_id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    return r && r[0] ? { t0: r[0].t0, step: r[0].step_min || 2, s: r[0].series || {} } : null;
  }

  async function load() {
    if (CONNECTED) {
      // 먼저 LOT 표에 한 줄이라도 있는지만 본다 (데모 파일은 같이 받아 둔다) — 비어 있으면 표 14개를 다 읽지 않는다
      const demoP = loadDemo().catch(() => null);
      const head = await db('GET', '/mlng_lots?select=id&limit=1').catch(e => { DBSTATE = '연결 실패 — ' + e.message; return null; });
      if (head && !head.length) DBSTATE = '연결됨 — 표가 비어 있어 데모 스냅샷 표시';
      if (head && head.length) {
        const live = await loadLive().catch(e => { DBSTATE = '연결 실패 — ' + e.message; return null; });
        if (live) { MODE = 'live'; return live; }
      }
      MODE = 'demo'; const d = await demoP; if (d) return d;
    }
    MODE = 'demo';
    return loadDemo();
  }

  const USER = { name: '품질 담당', role: 'manager' };
  const memInsp = [];
  window.MLNGData = {
    get LIVE() { return MODE === 'live'; },
    CONNECTED,
    dbState: () => DBSTATE,
    // 2.0 신뢰 원장 — 실시간일 때만 서버에 쌓는다 (공개키도 함께 남겨 나중에 검증)
    async v2Append(e) { if (MODE !== 'live') return; await db('POST', '/mlng_ledger', { seq: e.seq, at: e.at, company: e.company, kind: e.kind, ref: e.ref, title: e.title, payload: e.payload, prev: e.prev, hash: e.hash, sig: e.sig }); },
    async v2Key(k) { if (MODE !== 'live') return; await db('POST', '/mlng_keys', k).catch(() => {}); },
    async v2LoadLedger() { if (MODE !== 'live') return { ledger: [], keys: [] }; const [l, k] = await Promise.all([soft(db('GET', '/mlng_ledger?select=*&order=seq.asc&limit=5000')), soft(db('GET', '/mlng_keys?select=*'))]); return { ledger: l || [], keys: k || [] }; },
    // 데모로 떠 있는 동안 표에 데이터가 들어왔는지만 가볍게 확인 (실시간 반영 켜짐일 때)
    async probe() { if (!CONNECTED) return false; const r = await soft(db('GET', '/mlng_lots?select=id&limit=1')); return !!(r && r.length); },
    user: () => USER,
    needLogin: () => false,
    login: async () => USER, logout: () => {},
    load,
    profile,
    async addInspection(rec) {
      const row = Object.assign({ id: 'insp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        by: USER.name, by_id: 'web', at: new Date().toLocaleString('sv-SE').slice(0, 19) }, rec);
      if (MODE !== 'live') { memInsp.unshift(row); return row; }      // 데모: 새로고침하면 사라진다
      const r = await db('POST', '/mlng_inspections', row);
      return r && r[0] ? r[0] : row;
    },
    demoInspections: () => memInsp,
    // 구매·발주 — 데모면 화면 메모리에만 (새로고침하면 처음 상태)
    async savePO(po, isNew) {
      if (MODE !== 'live') return po;
      const r = isNew ? await db('POST', '/mlng_purchase_orders', po)
        : await db('PATCH', `/mlng_purchase_orders?id=eq.${encodeURIComponent(po.id)}`, { signs: po.signs, status: po.status, received_at: po.received_at || null });
      return r && r[0] ? r[0] : po;
    },
    async addAudit(rec) { if (MODE === 'live') await db('POST', '/mlng_audit', rec).catch(e => console.warn('[mlng] 기록 실패', e.message)); },
    // 질의응답 — Claude API 중계 함수 주소 (없으면 규칙 기반)
    askUrl: () => CFG.ASK_URL === 'off' ? '' : (CFG.ASK_URL || (BASE ? `${BASE}/functions/v1/mlng-ask` : '')),
    async ask(body) {
      const r = await fetch(window.MLNGData.askUrl(), { method: 'POST', headers: KEY ? hdr() : { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      return j;
    },
    async addWorkOrder(wo) {                                            // 작업지시 초안 — 실시간이면 mlng_work_orders
      if (MODE !== 'live') return wo;
      const r = await db('POST', '/mlng_work_orders', wo);
      return r && r[0] ? r[0] : wo;
    },
  };
})();
