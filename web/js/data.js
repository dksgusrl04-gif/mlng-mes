/* 데이터 층 — 데모(JSON) / 실시간(Supabase) 두 갈래를 같은 모양으로 돌려준다.
 *
 * 로그인 없이 anon 키로 읽는다 (Supabase RLS 가 anon 읽기를 허용 — supabase/new_project_setup.sql)
 *   SUPABASE_URL·ANON_KEY 가 비어 있으면  → 데모 스냅샷
 *   채워져 있고 mlng_lots 에 행이 있으면   → 실시간
 *   채워져 있지만 표가 비었거나 못 읽으면 → 데모 스냅샷 (연결 상태는 «데이터 상태» 화면에 표시)
 * 쓰는 것 (실시간일 때만): mlng_inspections · mlng_work_orders 추가
 */
(function () {
  'use strict';
  const CFG = window.MLNG_CONFIG || {};
  const BASE = (CFG.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = CFG.SUPABASE_ANON_KEY || '';
  const CONNECTED = !!(BASE && KEY);
  let MODE = 'demo';            // 'live' | 'demo'
  let DBSTATE = CONNECTED ? '확인 전' : '연결 안 함';

  const hdr = () => ({ apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' });
  async function db(method, path, body) {
    const r = await fetch(`${BASE}/rest/v1${path}`, { method, headers: Object.assign(hdr(), method === 'POST' ? { Prefer: 'return=representation' } : {}),
      body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const t = await r.text(); throw new Error(`${r.status} ${t.slice(0, 200)}`); }
    return r.status === 204 ? null : r.json();
  }
  const soft = p => p.catch(e => { console.warn('[mlng] 읽기 실패', e.message); return null; });

  async function loadDemo() {
    if (window.MLNG_DEMO) return window.MLNG_DEMO;
    const r = await fetch('data/demo.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('data/demo.json 을 읽지 못했습니다');
    return r.json();
  }

  // 실시간: 표 → 데모와 같은 모양으로
  async function loadLive() {
    const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const [items, equip, rout, codes, workers, wos, lots, trace, alerts, insp, recipe, jobs] = await Promise.all([
      '/mlng_items?select=*', '/mlng_equipment?select=*', '/mlng_routings?select=*&order=seq.asc', '/mlng_defect_codes?select=*', '/mlng_workers?select=*',
      `/mlng_work_orders?select=*&created_at=gte.${since}&order=created_at.desc&limit=1000`, `/mlng_lots?select=*&order=start_at.desc&limit=3000`,
      '/mlng_trace?select=*&order=at.desc&limit=3000', '/mlng_alerts?select=*&order=at.desc&limit=100', '/mlng_inspections?select=*&order=at.desc&limit=1000',
      '/heat_recipes?select=*', `/heat_jobs?select=*&start_at=gte.${since}&order=start_at.asc&limit=2000`,
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
    };
  }
  async function profile(id) {           // 실시간 모드에서 LOT 상세를 열 때만 읽는다
    const r = await db('GET', `/heat_profiles?job_id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    return r && r[0] ? { t0: r[0].t0, step: r[0].step_min || 2, s: r[0].series || {} } : null;
  }

  async function load() {
    if (CONNECTED) {
      const live = await loadLive().catch(e => { DBSTATE = '연결 실패 — ' + e.message; return null; });
      if (live) { MODE = 'live'; return live; }
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
    async addWorkOrder(wo) {                                            // 작업지시 초안 — 실시간이면 mlng_work_orders
      if (MODE !== 'live') return wo;
      const r = await db('POST', '/mlng_work_orders', wo);
      return r && r[0] ? r[0] : wo;
    },
  };
})();
