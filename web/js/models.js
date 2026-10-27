/* 4.0 모델 계층 — 공장 데이터로 학습한 모델과 «자기 신뢰도»
 * ───────────────────────────────────────────────────────────────
 * 모든 모델은 (1) 예측 (2) 구간 (3) 지금 얼마나 믿을 수 있는지(신뢰도) 를 함께 돌려준다. 버전은 VERSION 에 고정.
 *   heat   열처리 LOT 불량 수 = 수량 × exp(β·[조건 이탈, 히터 출력, 장입량])  — 포아송 회귀 + 과산포 → LOT 별 클레임 확률
 *   tool   공구 마모 VB = a·t^b (가공 시간)  — 재질별 계층 베이즈 사전 + 공구별 관측 → 잔여 수명 구간 (몬테카를로)
 *   vb     센서로 추정한 VB 의 오차  — 분할 컨포멀로 «±q mm 안에 90%» 보장, 최근 오차로 드리프트 감시
 *   insp   정밀가공 검사 판정  — 센서 고착이면 신뢰 불가
 *   heater 히터 출력 변화점 (평균 변화 + 순열 p · CUSUM 경보)
 *   demand 계획 품목 수요 (Holt + 서비스 수준 안전재고)
 *   line   라인 하루 산출 분포 (공정별 하루 실적 부트스트랩 몬테카를로)
 *   psi    입력 분포 변화 (기준 구간 대비)
 * 신뢰도 ≥ 0.75 신뢰 · ≥ 0.5 주의 · 그 아래 신뢰 불가 → 에이전트 자동 실행 권한이 이 값에 따라 내려간다 (mod_agent).
 */
(function () {
  'use strict';
  const M = window.MLNG, ST = M.st, { f } = M;
  const ML = M.ml = {};
  ML.VERSION = { heat: 'heat-nb@1.0', tool: 'tool-hb@1.0', vb: 'vb-conf@1.0', insp: 'insp-chk@1.0', heater: 'heater-cp@1.0', demand: 'demand-holt@1.0', line: 'line-mc@1.0', psi: 'psi@1.0' };
  const H = () => M.S.heat || { lots: [], heaters: [] }, MC = () => M.S.mach || { tools: [], runs: [], parts_per_run: 25 };
  const DEVR = () => (M.CFG.HEAT || {}).DEVIATION_RATE || 0.05, VBL = () => 0.5;   // 품질 기준 VB (교체 기준 설정과 별개)
  const lvl = t => t >= 0.75 ? 'ok' : t >= 0.5 ? 'warn' : 'bad';
  ML.LEVEL = { ok: ['j-ok', '신뢰'], warn: ['j-warn', '주의'], bad: ['j-danger', '신뢰 불가'] };
  const memo = (k, fn) => M.memo('ml.' + k, '', fn);

  // ── 열처리 불량 모델 (LOT 별 클레임 확률)
  const zone = () => { const w = M.dx && M.dx.heaterWaste()[0]; return w ? w.key : 'op2'; };
  ML.heat = () => memo('heat', () => {
    const ls = H().lots.filter(l => l.qty > 0), z = zone(), hv = ls.map(l => (l.heater || {})[z]).filter(v => v != null), hm = ST.mean(hv), hs = ST.sd(hv) || 1, qm = ST.mean(ls.map(l => l.qty)), qs = ST.sd(ls.map(l => l.qty)) || 1;
    const xOf = l => [1, M.heatDev ? Math.min(1, M.heatDev(l)) * 10 : 0, (((l.heater || {})[z] ?? hm) - hm) / hs, (l.qty - qm) / qs];
    const n = ls.length, cut = Math.floor(n * 0.7), fit = rows => ST.poissonGLM(rows.map(xOf), rows.map(l => l.bad), rows.map(l => Math.log(l.qty)));
    const g = fit(ls), gTrain = fit(ls.slice(0, cut));
    // 검증: 앞 70% 로 학습 → 뒤 30% LOT 의 실제 불량이 90% 상한 안에 드는 비율 (목표 0.9)
    const test = ls.slice(cut), up = l => { const mu = gTrain.predict(xOf(l), Math.log(l.qty)); let k = 0; while (ST.nbTail(mu, gTrain.phi, k) > 0.1 && k < 1e5) k++; return k; };
    const cover = test.length ? test.filter(l => l.bad <= up(l)).length / test.length : NaN;
    const trust = isFinite(cover) ? Math.max(0, 1 - Math.abs(0.9 - cover) * 2.5) * (g.phi > 20 ? 0.7 : 1) : 0.5;
    const names = ['기본', '조건 이탈 (10%p당)', `히터 출력 ${z} (σ당)`, '장입량 (σ당)'];
    return { v: ML.VERSION.heat, g, xOf, names, z, cover, ntest: test.length, trust, level: lvl(trust),
      effects: g.beta.map((b, i) => ({ name: names[i], rr: Math.exp(b), lo: Math.exp(b - 1.645 * g.se[i]), hi: Math.exp(b + 1.645 * g.se[i]) })).slice(1) };
  });
  /** LOT 이 계약 기준 PPM 을 넘을 확률 @param {string} lotId @param {number} thPpm */
  // 사전 = 모델이 이 조건(이탈·히터·장입량)에서 기대하는 불량률 (감마, 형상은 과산포로) / 관측 = 이 LOT 의 실제 불량 수
  // 사후 감마로 «이 LOT 의 참 불량률이 계약 기준을 넘을 확률» — 같은 PPM 이라도 조건이 나쁘면 확률이 높다
  ML.claimP = (lotId, thPpm) => { const m = ML.heat(), l = H().lots.find(x => x.id === lotId); if (!l || !thPpm) return null;
    const mu = m.g.predict(m.xOf(l), Math.log(l.qty)), lam0 = mu / l.qty, a0 = m.g.phi > 1.01 ? Math.max(0.5, Math.min(50, mu / (m.g.phi - 1))) : 50, b0 = a0 / Math.max(lam0, 1e-9);
    const a = a0 + l.bad, b = b0 + l.qty, th = thPpm / 1e6, p = 1 - ST.gammaP(a, b * th);
    return { p, mu, ppmPrior: lam0 * 1e6, ppmPost: a / b * 1e6, actualPpm: l.ppm, a0, b0, a, b, x: m.xOf(l), th: thPpm, model: m.v }; };

  // ── 공구 수명 (계층 베이즈 + 몬테카를로)
  const pts = t => MC().runs.filter(r => r.tool === t.id && r.vb != null && r.vb > 0 && r.minute > 0).map(r => [r.minute, r.vb]);
  const fitTool = (t, k) => { const p = pts(t).slice(0, k || undefined); return p.length >= 2 ? ST.powerFit(p.map(x => x[0]), p.map(x => x[1])) : null; };
  // 같은 재질의 다른 공구(없으면 전체)로 만든 사전 분포 — 다른 공장의 요약 통계만으로도 만들 수 있다 (2.0 연합학습과 같은 구조)
  //   ln VB = l + b·(ln t − ln t_ref) : 기울기 b 는 사전에서, 수준 l(기준 시각의 마모) 은 사전 + 이 공구 측정으로 축소 추정
  function prior(t) {
    const others = MC().tools.filter(o => o.id !== t.id && pts(o).length >= 3), same = others.filter(o => o.material === t.material), use = same.length >= 2 ? same : others;
    const fs = use.map(o => ({ o, p: pts(o), fit: fitTool(o) })).filter(x => x.fit && x.fit.b > 0.1);
    const bs = fs.map(x => x.fit.b), bm = ST.mean(bs), vb = Math.max(ST.var(bs), 0.01), lt = ST.mean(fs.map(x => ST.mean(x.p.map(q => Math.log(q[0])))));
    const res = fs.map(x => { const ls = x.p.map(q => Math.log(q[1]) - bm * Math.log(q[0])), m = ST.mean(ls); return { c: m, r: ST.var(ls) }; });
    return { bm, vb, lt, c: res.map(x => x.c), s2: Math.max(ST.mean(res.map(x => x.r)), 0.005), n: fs.length, from: same.length >= 2 ? t.material : '전체' };
  }
  /** 공구 잔여 수명: 처음 k 개 측정만 쓰면 «첫날 예측», 생략하면 지금까지 전부 @param {string} id @param {number} [k] */
  ML.rul = (id, k) => {
    const t = MC().tools.find(x => x.id === id); if (!t) return null;
    const pr = prior(t), p = pts(t).slice(0, k == null ? undefined : k), tNow = p.length ? p[p.length - 1][0] : 0;
    // 절편 c = ln VB − b̄·ln t : 사전(다른 공구들의 c 분포) + 이 공구 관측(평균, 분산 s²/k) 정밀도 가중
    const c0 = ST.mean(pr.c), v0 = Math.max(ST.var(pr.c), 0.01), own = p.length ? ST.mean(p.map(q => Math.log(q[1]) - pr.bm * Math.log(q[0]))) : null;
    const post = own == null ? { m: c0, v: v0, w: 0 } : ST.shrink(c0, v0, own, pr.s2 / p.length);
    const tref = p.length ? Math.exp(ST.mean(p.map(q => Math.log(q[0])))) : Math.exp(pr.lt);
    const r = ST.rng(101 + id.charCodeAt(1) * 7 + (k || 0)), L = VBL(), ts = [];
    for (let i = 0; i < 600; i++) { const [cs, bs] = ST.mvn2([post.m, pr.bm], [[post.v, 0], [0, pr.vb]], r); const b1 = Math.max(0.2, bs), lref = cs + pr.bm * Math.log(tref);   // 기준 시각의 마모 수준은 b̄ 로 고정, 기울기만 흔든다
      ts.push(tref * Math.exp((Math.log(L) - lref) / b1)); }
    const mpr = t.runs ? t.minutes / t.runs : 3, q = x => ST.q(ts, x);
    const cross = (() => { const a = pts(t); for (let i = 1; i < a.length; i++) if (a[i][1] >= L) { const [t0, v0] = a[i - 1], [t1, v1] = a[i]; return t0 + (L - v0) / (v1 - v0) * (t1 - t0); } return null; })();
    return { id, material: t.material, k: p.length, tNow, mpr, prior: pr, wOwn: post.w,
      t10: q(0.1), t50: q(0.5), t90: q(0.9), r10: Math.max(0, (q(0.1) - tNow) / mpr), r50: Math.max(0, (q(0.5) - tNow) / mpr), r90: Math.max(0, (q(0.9) - tNow) / mpr),
      pNext: n => ts.filter(x => x <= tNow + n * mpr).length / Math.max(1, ts.length), cross, samples: ts.length };
  };
  /** 첫날 예측 → 측정이 쌓일수록 구간이 좁아지는 모습 @param {string} id */
  ML.coldStart = id => { const t = MC().tools.find(x => x.id === id); if (!t) return []; return Array.from({ length: Math.min(pts(t).length, 8) + 1 }, (_, k) => Object.assign(ML.rul(id, k), { kk: k })); };
  ML.tool = () => memo('tool', () => {
    // 검증: 공구 하나씩 빼고 처음 3개 측정 + 다른 공구 사전으로 예측 → 실제 기준 도달 시간이 80% 구간 안에 드는 비율
    const ev = MC().tools.filter(t => pts(t).length >= 4).map(t => { const r = ML.rul(t.id, 3); return r && r.cross != null ? { id: t.id, hit: r.cross >= r.t10 && r.cross <= r.t90, r } : null; }).filter(Boolean);
    const cover = ev.length ? ev.filter(e => e.hit).length / ev.length : NaN, trust = isFinite(cover) ? Math.max(0, 1 - Math.abs(0.8 - cover) * 2) : 0.5;
    return { v: ML.VERSION.tool, ev, cover, trust, level: lvl(trust) };
  });

  // ── VB 추정 오차 (컨포멀)
  ML.vb = () => memo('vb', () => {
    const rows = MC().runs.filter(r => r.vb != null && r.vb > 0 && r.vb_est != null), tools = [...new Set(rows.map(r => r.tool))];
    const cal = rows.filter(r => tools.indexOf(r.tool) % 2 === 0), test = rows.filter(r => tools.indexOf(r.tool) % 2 === 1), err = r => Math.abs(r.vb_est - r.vb);
    const q = ST.conformal(cal.map(err), 0.1), cover = test.length ? test.filter(r => err(r) <= q).length / test.length : NaN;
    const recent = tools.slice(-3), recErr = rows.filter(r => recent.includes(r.tool)).map(err), recCover = recErr.length ? recErr.filter(e => e <= q).length / recErr.length : NaN;
    const trust = Math.max(0, Math.min(1, 1 - Math.max(0, 0.9 - (isFinite(recCover) ? recCover : cover)) * 2.5 - (q > 0.1 ? 0.15 : 0)));
    return { v: ML.VERSION.vb, q, cover, recCover, recent, ncal: cal.length, ntest: test.length, trust, level: lvl(trust) };
  });

  // ── 검사 판정 신뢰 (센서 고착 · 이중 기록)
  ML.insp = () => memo('insp', () => { const c = (M.S.insp || {}).checks || {}, stuck = (c.stuck || []).length, conf = c.conflict || 0;
    const trust = Math.max(0, 1 - stuck * 0.35 - Math.min(0.3, conf / 300)); return { v: ML.VERSION.insp, stuck: c.stuck || [], conf, trust, level: lvl(trust) }; });

  // ── 히터 출력 변화점
  ML.heater = () => memo('heater', () => { const L = H().lots;
    const zs = (H().heaters || []).map(h => { const x = L.map(l => (l.heater || {})[h.key]), ok = x.map((v, i) => [v, i]).filter(p => p[0] != null), v = ok.map(p => p[0]);
      const cp = ST.changePoint(v, { min: 5 }), cu = ST.cusum(v, { base: 20 }), at = i => i >= 0 && ok[i] ? L[ok[i][1]] : null;
      return { key: h.key, label: h.label, cp, cpLot: cp ? at(cp.i) : null, cuLot: at(cu.at), cuStart: at(cu.start), shift: cp ? cp.after - cp.before : 0 }; });
    return { v: ML.VERSION.heater, zones: zs, trust: 1, level: 'ok' }; });

  // ── 사건 유형별 «통계적으로 변하기 시작한 때» (변화점) — 규칙 알림보다 며칠 먼저였나를 재는 기준
  ML.changeFor = tpl => memo('chg.' + tpl, () => {
    const day = s => String(s || '').slice(0, 10);
    if (tpl === 'heat') { const z = ML.heater().zones.filter(x => x.cp && x.cp.p < 0.1 && x.shift > 0).sort((a, b) => b.shift - a.shift)[0];
      return z ? { what: `${z.label} 히터 출력 ${f(z.cp.before, 1)}% → ${f(z.cp.after, 1)}%`, day: day(z.cpLot && z.cpLot.end), p: z.cp.p, cusum: z.cuLot ? day(z.cuLot.end) : null } : null; }
    if (tpl === 'press') { const ls = ((M.S.press || {}).lots || []), cp = ST.changePoint(ls.map(l => l.ppm), { min: 3 }); return cp && cp.after > cp.before ? { what: `프레스 불량률 ${f(cp.before, 0)} → ${f(cp.after, 0)} PPM`, day: ls[cp.i].date, p: cp.p } : null; }
    if (tpl === 'tool') { const ts = MC().tools.filter(t => t.rate), cp = ST.changePoint(ts.map(t => t.rate * 1000), { min: 3 }); return cp && cp.after > cp.before ? { what: `공구 마모 속도 ${f(cp.before, 1)} → ${f(cp.after, 1)} µm/분`, day: ts[cp.i].date, p: cp.p } : null; }
    return null; });
  // ── 수요 예측 · 안전재고
  ML.demand = () => memo('demand', () => { const P = M.S.plan; if (!P) return { v: ML.VERSION.demand, items: [], trust: 1, level: 'ok' };
    const z = ST.zOf(0.95), items = P.items.map(it => { const ds = P.days.filter(d => d.item === it.code).sort((a, b) => a.date.localeCompare(b.date)), x = ds.map(d => d.order), h = ST.holt(x), last = ds[ds.length - 1] || {};
      const avg7 = ST.mean(x.slice(-7)), ss = h ? z * h.sigma : 0, need = h ? Math.max(0, h.next + ss - (last.inv_close || 0)) : 0;
      return { code: it.code, name: it.name, next: h ? h.next : null, sigma: h ? h.sigma : null, ss, avg7, oldSS: avg7 * ((M.CFG.PLAN || {}).SAFETY_DAYS || 0.5), inv: last.inv_close, need, pShort: h && h.sigma ? 1 - ST.phi(((last.inv_close || 0) - h.next) / h.sigma) : null }; });
    return { v: ML.VERSION.demand, items, trust: 1, level: 'ok' }; });

  // ── 라인 산출 분포 (몬테카를로)
  ML.lineMC = (mult = {}, target, n = 2000) => { if (!M.lineApi) return null; const m = M.lineApi.model(), r = ST.rng(29), procs = ['press', 'weld', 'heat'], out = [];
    const ser = p => (m.b[p].series || []).map(s => s.q).filter(v => v > 0);
    for (let i = 0; i < n; i++) { let o = Infinity; procs.forEach(p => { const s = ser(p); if (!s.length || !m.fac[p]) return; const q = s[Math.floor(r() * s.length)] * (mult[p] ?? 1); o = Math.min(o, q / m.fac[p]); }); out.push(Math.min(o, target ?? Infinity)); }
    const tg = target ?? m.target; return { v: ML.VERSION.line, p10: ST.q(out, 0.1), p50: ST.q(out, 0.5), p90: ST.q(out, 0.9), pMeet: out.filter(x => x >= tg * 0.999).length / n, target: tg, samples: out }; };

  // ── 입력 분포 변화
  ML.psi = () => memo('psi', () => { const L = H().lots, half = a => [a.slice(0, Math.floor(a.length * 0.6)), a.slice(-Math.max(10, Math.floor(a.length * 0.25)))];
    const add = (name, arr, model) => { const [b, c] = half(arr.filter(v => v != null && isFinite(v))); const v = b.length >= 30 && c.length >= 20 ? ST.psi(b, c, 5) : NaN;   /* 표본이 적으면 판단하지 않음 */ return { name, model, psi: v, level: !isFinite(v) ? 'ok' : v > 0.25 ? 'bad' : v > 0.1 ? 'warn' : 'ok' }; };
    const z = zone(), runs = MC().runs.filter(r => r.s);
    const rows = [add(`히터 출력 ${z}`, L.map(l => (l.heater || {})[z]), 'heat'), add('열처리 장입량', L.map(l => l.qty), 'heat'), add('열처리 조건 이탈', L.map(l => M.heatDev ? M.heatDev(l) : null), 'heat'),
      add('프레스 하루 타발 수', ((M.S.press || {}).lots || []).map(l => l.strokes), 'line'), add('MCT 주축 전류', runs.map(r => r.s.smcAC), 'vb'), add('MCT 테이블 진동', runs.map(r => r.s.vib_table), 'vb')];
    return { v: ML.VERSION.psi, rows }; });

  // ── 모델별 종합 신뢰도 (입력 변화가 크면 깎는다)
  ML.all = () => { const ps = ML.psi().rows, pen = m => ps.filter(x => x.model === m).reduce((s, x) => s + (x.level === 'bad' ? 0.15 : x.level === 'warn' ? 0.05 : 0), 0);
    const list = [['heat', '열처리 LOT 불량 · 클레임 확률', ML.heat()], ['tool', '공구 잔여 수명', ML.tool()], ['vb', 'VB 센서 추정', ML.vb()], ['insp', '정밀가공 검사 판정', ML.insp()], ['heater', '히터 출력 변화점', ML.heater()], ['demand', '수요 예측 · 안전재고', ML.demand()]];
    return list.map(([k, name, m]) => { const t = Math.max(0, (m.trust ?? 1) - pen(k)); return { k, name, m, trust: t, level: lvl(t), v: m.v }; }); };
  ML.trustOf = k => { const x = ML.all().find(y => y.k === k); return x ? x : { trust: 1, level: 'ok' }; };
  // 에이전트 조치 종류 ↔ 근거 모델
  ML.KIND_MODEL = { buy: 'tool', insp: 'insp', wo: 'demand' };
  ML.fmtTrust = x => `${ML.LEVEL[x.level][1]} ${f(x.trust * 100, 0)}`;
})();
