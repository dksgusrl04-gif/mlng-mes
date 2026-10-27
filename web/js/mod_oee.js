/* 5.5 — 설비 OEE · 비가동 관리
 * ───────────────────────────────────────────────────────────────
 * OEE(설비종합효율) = 가동률 × 성능 × 양품률   (세계 수준 85% = 90% × 95% × 99.9%)
 *   가동률 = 가동 시간 ÷ 계획 가동 시간          (정지 손실: 고장 · 교체 · 자재 대기 · 품질 조치 · 미분류)
 *   성능   = 생산 수량 ÷ (이론 속도 × 가동 시간)   (소정지 · 속도 저하)
 *   양품률 = 양품 ÷ 생산 수량                    (불량 · 재작업)
 * 데이터
 *   · 열처리: 작업 시작·종료 시각이 있어 실제 가동 · 작업 사이 정지를 그대로 쓴다
 *   · 프레스 · 점용접 · MCT · 검사: 일 단위 실적만 있다 → 설비 신호(진동 이상 · 공구 교체 · 가압 이상)로 정지를 감지하고,
 *     나머지 짧은 정지는 «미분류» 로 두어 작업자가 POP/비가동 관리에서 사유를 고른다 (데모: 날짜·설비로 고정된 난수)
 *   · 이론 속도: config OEE.IDEAL 이 비어 있으면 관측 최대 일 생산 기준 (가정값 관리에서 확인)
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f, pct } = M;
  const OC = () => Object.assign({ PLANNED: {}, IDEAL: {}, TARGET: 0.85 }, M.CFG.OEE || {});
  const SIG = () => Object.assign({ OEE_GREEN: 0.85, OEE_YELLOW: 0.65 }, M.CFG.SIGNAL || {});
  const DAY = 86400000;
  // 비가동 사유 (6대 손실 기준)
  const REASONS = [
    ['BRK', '설비 고장', 'stop', '#D92D20'], ['SET', '금형 · 공구 교체', 'stop', '#7C3AED'], ['MAT', '자재 대기', 'stop', '#0E7490'],
    ['QLT', '품질 조치 · 조건 조정', 'stop', '#DC6803'], ['MAN', '작업자 부재', 'stop', '#64748B'], ['PM', '예방 점검 · 청소', 'stop', '#2563EB'],
    ['SMS', '소정지', 'perf', '#94A3B8'], ['UNK', '미분류', 'stop', '#B42318'],
  ];
  const RN = Object.fromEntries(REASONS.map(r => [r[0], r]));
  const EQS = [['PR-01', 'press', '프레스'], ['SP-01', 'weld', '점용접'], ['SB-01', 'heat', '열처리'], ['MC-01', 'mach', 'MCT 가공'], ['IN-01', 'insp', '정밀 검사']];
  const KEY = 'mlng_dt_reason';
  let CLS = {}; try { CLS = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { CLS = {}; }
  const saveCls = () => { try { localStorage.setItem(KEY, JSON.stringify(CLS)); } catch (e) { /* 이번 화면에만 */ } };
  const MAN = [];   // POP 에서 작업자가 직접 입력한 비가동
  let VER = 0;       // 사유 분류 · 수동 입력이 바뀔 때마다 다시 계산

  const pad = n => String(n).padStart(2, '0');
  const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.round(m % 60))}`;
  const rnd = seed => { let h = 2166136261; for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; }; };

  // ── 설비 · 가동일별 계산 (데이터 버전에 묶어 기억)
  function days() {
    return M.memo('oee.days', VER + '|' + JSON.stringify(OC()), () => {
      const L = (M.S.lots || []).filter(l => l.kind === 'process'), H = M.S.heat || { lots: [] }, out = [];
      const vib = ((M.S.press || {}).vib || { events: [] }).events, pr = (M.S.press || { lots: [] }).lots, wl = (M.S.weld || { lots: [] }).lots, tools = (M.S.mach || { tools: [] }).tools;
      EQS.forEach(([eq, proc, nm]) => {
        const byD = {};
        L.filter(l => l.equipment_id === eq || (!l.equipment_id && l.proc === proc)).forEach(l => { const d = String(l.end_at || l.start_at).slice(0, 10), x = byD[d] = byD[d] || { qty: 0, good: 0, bad: 0, badKnown: false, lots: [] };
          x.qty += l.qty || 0; if (l.bad != null) { x.bad += l.bad; x.badKnown = true; } x.lots.push(l); });
        Object.entries(byD).forEach(([d, x]) => {
          const R = rnd(eq + d), ev = []; let planned = OC().PLANNED[eq] || 460, start = 8 * 60;
          const add = (code, min, at, src, why) => { const id = `${eq}|${d}|${ev.length}`; ev.push({ id, eq, proc, nm, d, code: CLS[id] || code, auto: code, min: Math.round(min), at, src, why }); };
          if (proc === 'heat') {
            // 실제 작업 시각: 첫 시작 ~ 마지막 종료가 계획 가동, 작업 사이 빈 시간이 정지
            const hl = H.lots.filter(l => String(l.end).slice(0, 10) === d).sort((a, b) => String(a.start).localeCompare(String(b.start)));
            if (!hl.length) return;
            const t0 = M.toDate(hl[0].start).getTime(), t1 = M.toDate(hl[hl.length - 1].end).getTime();
            start = (t0 - new Date(d + 'T00:00').getTime()) / 60000; planned = Math.min(OC().PLANNED[eq] || 1320, Math.max(60, (t1 - t0) / 60000 + 30));
            add('SET', 30, start, '자동 감지', '첫 작업 전 승온 · 장입 준비');
            hl.forEach((l, i) => { if (!i) return; const g = (M.toDate(l.start) - M.toDate(hl[i - 1].end)) / 60000; if (g > 5) add(g > 90 ? 'MAT' : 'SET', g, (M.toDate(hl[i - 1].end) - new Date(d + 'T00:00')) / 60000, '자동 감지', `${hl[i - 1].id} 종료 → ${l.id} 시작 사이 ${f(g, 0)}분`); });
            if (hl.some(l => (M.heatDev ? M.heatDev(l) : 0) >= ((M.CFG.HEAT || {}).DEVIATION_RATE || 0.05))) add('QLT', 25, start + planned * 0.6, '자동 감지', '조건 이탈 작업 — 온도 재설정');
          } else {
            if (proc === 'press') {
              vib.filter(v => String(v.start).slice(0, 10) === d).forEach(v => add('BRK', 45 + Math.round(R() * 30), (M.toDate(v.start) - new Date(d + 'T00:00')) / 60000, '설비 신호', `진동 이상 ${f(v.ratio, 1)}배 — 정지 · 점검`));
              const pl = pr.find(p => p.date === d); if (pl && pl.changeover) add('SET', 40, start + 120, '설비 신호', '금형 교체');
              add('SET', 20 + Math.round(R() * 15), start + 5, '자동 감지', '작업 시작 금형 세팅');
            }
            if (proc === 'weld') { const w = wl.find(x => x.date === d); if (w && w.excursion) add('QLT', 25 + Math.round(R() * 20), start + 200, '설비 신호', '가압 이상 구간 — 조건 조정'); add('SET', 15, start + 100, '자동 감지', '전극 팁 드레싱 · 교체'); }
            if (proc === 'mach') { const ts = tools.filter(t => t.date === d); ts.forEach((t, i) => add('SET', 12, start + 60 + i * 90, '설비 신호', `${t.id} 공구 교체`)); if (ts.some(t => t.sensor_bad)) add('BRK', 30, start + 240, '설비 신호', '센서 값 비정상 — 점검'); }
            if (proc === 'insp') add('PM', 20, start + 10, '자동 감지', '측정기 영점 · 교정');
            if (R() < 0.6) add('MAT', 10 + Math.round(R() * 30), start + 150 + R() * 120, '자동 감지', '앞 공정 재공 없음');
            const ns = 1 + Math.floor(R() * 3); for (let i = 0; i < ns; i++) add('UNK', 8 + Math.round(R() * 18), start + 60 + R() * (planned - 120), '자동 감지', '정지 신호 — 사유 입력 필요');
          }
          MAN.filter(m => m.eq === eq && m.d === d).forEach(m => ev.push(m));
          const stopMin = ev.filter(e => RN[e.code][2] === 'stop').reduce((s, e) => s + e.min, 0), smsMin = ev.filter(e => e.code === 'SMS').reduce((s, e) => s + e.min, 0);
          const run = Math.max(1, planned - stopMin);
          const qBad = x.badKnown ? x.bad : proc === 'weld' ? Math.round((wl.find(w => w.date === d) || {}).est || 0) : 0;
          out.push({ eq, proc, nm, d, planned, start, run, stopMin, smsMin, qty: x.qty, bad: qBad, badKnown: x.badKnown || proc === 'weld', ev });
        });
      });
      // 이론 속도 (개/분): 설정이 없으면 관측 최대 (가동 시간당) × 1.02
      const ideal = {}; EQS.forEach(([eq]) => { const c = OC().IDEAL[eq]; const xs = out.filter(r => r.eq === eq && r.run >= 120).map(r => r.qty / r.run).sort((x, y) => x - y); ideal[eq] = c || (xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))] : 1); });
      out.forEach(r => { r.ideal = ideal[r.eq]; r.A = r.run / r.planned; r.P = Math.min(1, r.qty / (r.ideal * r.run)); r.Q = r.qty ? 1 - r.bad / r.qty : 1; r.oee = r.A * r.P * r.Q; });
      return out;
    });
  }
  // 기간 합산 (시간 가중)
  function agg(rows) {
    // 설비마다 단위(개)가 달라 수량을 그냥 더하지 않는다 — 성능 · 양품률은 가동 시간 가중 평균
    const pl = rows.reduce((s, r) => s + r.planned, 0), run = rows.reduce((s, r) => s + r.run, 0), qty = rows.reduce((s, r) => s + r.qty, 0), bad = rows.reduce((s, r) => s + r.bad, 0);
    const A = pl ? run / pl : 0, P = run ? rows.reduce((s, r) => s + r.P * r.run, 0) / run : 0, Q = run ? rows.reduce((s, r) => s + r.Q * r.run, 0) / run : 1;
    return { planned: pl, run, stop: pl - run, qty, bad, A, P, Q, oee: A * P * Q, n: rows.length };
  }
  const since = n => M.sinceDay(n - 1).getTime();
  const inP = (r, per) => M.toDate(r.d).getTime() >= since(per);
  const lastDay = () => { const ds = days().map(r => r.d).sort(); return ds[ds.length - 1]; };
  const sig = v => v >= SIG().OEE_GREEN ? 'ok' : v >= SIG().OEE_YELLOW ? 'warn' : 'danger';
  const pc = (v, d = 1) => v == null ? '—' : pct(v, d);
  M.oeeApi = {
    days, agg, REASONS, EQS,
    eqToday: eq => { const r = days().filter(x => x.eq === eq), t = r.find(x => x.d === ymd(M.now())) || r[r.length - 1]; return t || null; },
    period: (per, eq) => agg(days().filter(r => inP(r, per) && (!eq || r.eq === eq))),
    addManual: (eq, code, min, why, by) => { const d = ymd(M.now()), now = M.now(); MAN.push({ id: `${eq}|${d}|m${MAN.length}`, eq, proc: (EQS.find(e => e[0] === eq) || [])[1], nm: (EQS.find(e => e[0] === eq) || [])[2], d, code, auto: code, min: Math.max(1, Math.round(min)), at: now.getHours() * 60 + now.getMinutes() - min, src: '작업자 입력', why: why || '', by }); VER++; },
    classify: (id, code) => { CLS[id] = code; saveCls(); VER++; },
    unclassified: () => [].concat(...days().map(r => r.ev)).filter(e => e.code === 'UNK'),
    sig,
  };

  // ── 그림
  function waterfall(a) {
    const W = 560, Hh = 220, L = 10, B = 40, T = 14, steps = [['계획 가동', a.planned, 'base'], ['정지 손실', -(a.planned - a.run), 'loss'], ['성능 손실', -(a.run * (1 - a.P)), 'loss'], ['품질 손실', -(a.run * a.P * (1 - a.Q)), 'loss'], ['유효 가동', a.planned * a.oee, 'good']];
    const bw = (W - L * 2) / steps.length, Y = v => T + (Hh - T - B) * (1 - v / a.planned); let acc = 0;
    return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img">${steps.map(([t, v, k], i) => {
      let y0, y1; if (k === 'base' || k === 'good') { y0 = Y(0); y1 = Y(Math.abs(v)); acc = Math.abs(v); } else { y1 = Y(acc); acc += v; y0 = Y(acc); }
      const x = L + i * bw + bw * 0.16, w = bw * 0.68;
      return `<rect class="wf ${k}" x="${x.toFixed(1)}" width="${w.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" height="${Math.max(1, Math.abs(y0 - y1)).toFixed(1)}"><title>${t} ${f(Math.abs(v), 0)}분</title></rect>
        <text class="ax wfv" x="${(x + w / 2).toFixed(1)}" y="${(Math.min(y0, y1) - 4).toFixed(1)}" text-anchor="middle">${k === 'loss' ? '−' : ''}${f(Math.abs(v) / 60, 1)}h</text>
        <text class="ax" x="${(x + w / 2).toFixed(1)}" y="${Hh - 22}" text-anchor="middle">${t}</text>
        <text class="ax" x="${(x + w / 2).toFixed(1)}" y="${Hh - 8}" text-anchor="middle">${k === 'loss' ? pct(Math.abs(v) / a.planned, 0) : k === 'good' ? 'OEE ' + pct(a.oee, 0) : '100%'}</text>`; }).join('')}</svg>`;
  }
  function pareto(evs) {
    const by = {}; evs.forEach(e => { by[e.code] = (by[e.code] || 0) + e.min; });
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]), tot = rows.reduce((s, r) => s + r[1], 0) || 1;
    if (!rows.length) return '<div class="empty">비가동이 없습니다</div>';
    const W = 560, Hh = 220, L = 44, R = 40, T = 12, B = 46, mx = rows[0][1], bw = (W - L - R) / rows.length, Y = v => T + (Hh - T - B) * (1 - v / mx), Yc = p => T + (Hh - T - B) * (1 - p);
    let cum = 0; const pts = rows.map(([, v], i) => { cum += v; return [L + i * bw + bw / 2, Yc(cum / tot)]; });
    return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img">
      ${[0, 0.5, 1].map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(mx * t)}" y2="${Y(mx * t)}"/><text class="ax" x="${L - 6}" y="${Y(mx * t) + 4}" text-anchor="end">${f(mx * t / 60, 1)}h</text><text class="ax" x="${W - R + 6}" y="${Yc(t) + 4}">${t * 100}%</text>`).join('')}
      ${rows.map(([k, v], i) => `<rect x="${(L + i * bw + bw * 0.15).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" y="${Y(v).toFixed(1)}" height="${(Y(0) - Y(v)).toFixed(1)}" fill="${RN[k][3]}" opacity=".85"><title>${RN[k][1]} ${f(v, 0)}분 (${pct(v / tot, 0)})</title></rect>
        <text class="ax" x="${(L + i * bw + bw / 2).toFixed(1)}" y="${Hh - 30}" text-anchor="middle">${esc(RN[k][1].split(' ')[0])}</text><text class="ax" x="${(L + i * bw + bw / 2).toFixed(1)}" y="${Hh - 16}" text-anchor="middle">${f(v / 60, 1)}h</text>`).join('')}
      <polyline class="pcum" points="${pts.map(p => p.map(x => x.toFixed(1)).join(',')).join(' ')}"/>${pts.map(p => `<circle class="pcum-d" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6"/>`).join('')}
      <line class="lim" x1="${L}" x2="${W - R}" y1="${Yc(0.8)}" y2="${Yc(0.8)}"/></svg>`;
  }
  // 오늘(마지막 가동일) 설비 상태 타임라인: 06~24시, 가동 = 초록, 정지 = 사유 색
  function timeline(d) {
    const rows = days().filter(r => r.d === d), t0 = 0, t1 = 24 * 60, X = m => ((Math.max(t0, Math.min(t1, m)) - t0) / (t1 - t0) * 100);
    return `<div class="tl"><div class="tlh">${[0, 4, 8, 12, 16, 20, 24].map(h => `<span style="left:${X(h * 60)}%">${pad(h)}</span>`).join('')}</div>
      ${EQS.map(([eq, , nm]) => { const r = rows.find(x => x.eq === eq);
        if (!r) return `<div class="tlr"><b>${esc(nm)}</b><div class="tlb"><i class="off" style="left:0;width:100%" title="가동 계획 없음"></i></div><em>미가동</em></div>`;
        const end = r.start + r.planned, ev = r.ev.slice().sort((a, b) => a.at - b.at);
        return `<div class="tlr"><b>${esc(nm)}</b><div class="tlb"><i class="run" style="left:${X(r.start)}%;width:${X(end) - X(r.start)}%" title="계획 가동 ${hm(r.start)}~${hm(end)}"></i>
          ${ev.map(e => `<i style="left:${X(e.at)}%;width:${Math.max(0.4, X(e.at + e.min) - X(e.at))}%;background:${RN[e.code][3]}" title="${esc(RN[e.code][1])} ${hm(e.at)} · ${e.min}분 — ${esc(e.why)}"></i>`).join('')}</div>
          <em class="${sig(r.oee)}">${pct(r.oee, 0)}</em></div>`; }).join('')}</div>`;
  }

  // ── 화면
  let per = 7, eqSel = '';
  const V = {};
  V.oee = () => {
    const D = days().filter(r => inP(r, per)), a = agg(D.filter(r => !eqSel || r.eq === eqSel)), tg = OC().TARGET, A = M.asmTag ? M.asmTag('oee') : '';
    const byEq = EQS.map(([eq, proc, nm]) => ({ eq, proc, nm, a: agg(D.filter(r => r.eq === eq)), top: (() => { const by = {}; D.filter(r => r.eq === eq).forEach(r => r.ev.forEach(e => { by[e.code] = (by[e.code] || 0) + e.min; })); const t = Object.entries(by).sort((x, y) => y[1] - x[1])[0]; return t ? `${RN[t[0]][1]} ${f(t[1] / 60, 1)}h` : '—'; })() }));
    // 일별 추이 (공장 전체 · 최근 14 가동일)
    const ds = [...new Set(days().map(r => r.d))].sort().slice(-14), trend = ds.map(d => agg(days().filter(r => r.d === d && (!eqSel || r.eq === eqSel))).oee);
    const evs = [].concat(...D.filter(r => !eqSel || r.eq === eqSel).map(r => r.ev)), unk = M.oeeApi.unclassified().length, ld = lastDay();
    const kc = v => `style="color:var(--${sig(v) === 'ok' ? 'ok' : sig(v) + '-ink'})"`;
    return `<div class="tools">${M.seg('oper', per, [[1, '오늘'], [7, '최근 7일'], [30, '최근 30일']])}${M.seg('oeq', eqSel, [['', '전체 설비']].concat(EQS.map(e => [e[0], e[2]])))}</div>
    <div class="kstrip">
      <div class="kpi"><div class="lab">OEE${A}</div><div class="val" ${kc(a.oee)}>${pc(a.oee)}</div><div class="foot">목표 ${pct(tg, 0)} · 세계 수준 85%</div></div>
      <div class="kpi"><div class="lab">가동률</div><div class="val">${pc(a.A)}</div><div class="foot">가동 ${f(a.run / 60, 1)}h / 계획 ${f(a.planned / 60, 1)}h</div></div>
      <div class="kpi"><div class="lab">성능${A}</div><div class="val">${pc(a.P)}</div><div class="foot">이론 속도 대비</div></div>
      <div class="kpi"><div class="lab">양품률</div><div class="val">${pc(a.Q, 2)}</div><div class="foot">불량 ${f(a.bad, 0)}개 / ${f(a.qty, 0)}개</div></div>
      <div class="kpi click" data-go="downtime"><div class="lab">비가동</div><div class="val">${f(a.stop / 60, 1)}<small>h</small></div><div class="foot">미분류 ${unk}건 — 사유 입력 필요</div></div>
    </div>
    <div class="card dsec"><h2>설비별 OEE <span class="h2sub">${per === 1 ? '오늘' : `최근 ${per}일`} · 초록 ${pct(SIG().OEE_GREEN, 0)} 이상 · 노랑 ${pct(SIG().OEE_YELLOW, 0)} 이상</span></h2>
      <div class="tbx"><table class="tb oetab"><colgroup><col class="c-n"><col class="c-e"><col class="c-o"><col class="c-b"><col class="c-v"><col class="c-v"><col class="c-v"><col class="c-h"><col class="c-h"><col></colgroup>
        <thead><tr><th>설비</th><th>설비 번호</th><th class="n">OEE</th><th></th><th class="n">가동률</th><th class="n">성능</th><th class="n">양품률</th><th class="n">계획</th><th class="n">비가동</th><th>최대 손실 사유</th></tr></thead>
        <tbody>${byEq.map(x => `<tr class="click ${eqSel === x.eq ? 'hl' : ''}" data-oeq="${x.eq}"><td><b>${esc(x.nm)}</b></td><td class="muted">${x.eq}</td>
          <td class="n"><b class="sv ${x.a.n ? sig(x.a.oee) : ''}">${x.a.n ? pct(x.a.oee, 1) : '—'}</b></td>
          <td>${x.a.n ? `<div class="obar"><i class="${sig(x.a.oee)}" style="width:${Math.min(100, x.a.oee * 100)}%"></i><s style="left:${tg * 100}%"></s></div>` : '<span class="muted sm1">가동 없음</span>'}</td>
          <td class="n">${x.a.n ? pct(x.a.A, 1) : '—'}</td><td class="n">${x.a.n ? pct(x.a.P, 1) : '—'}</td><td class="n">${x.a.n ? pct(x.a.Q, 2) : '—'}</td>
          <td class="n">${f(x.a.planned / 60, 1)}h</td><td class="n">${f(x.a.stop / 60, 1)}h</td><td>${esc(x.top)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="dgrid">
      <div class="card"><h2>OEE 손실 워터폴 <span class="h2sub">${eqSel ? esc((EQS.find(e => e[0] === eqSel) || [])[2]) : '전체 설비'} · 시간 기준</span></h2>${a.planned ? waterfall(a) : '<div class="empty">가동 기록이 없습니다</div>'}</div>
      <div class="card"><h2>비가동 사유 파레토 <span class="h2sub">누적 80% 선</span><a class="more" href="#" data-go="downtime">비가동 관리 →</a></h2>${pareto(evs)}</div>
    </div>
    <div class="dgrid">
      <div class="card"><h2>일별 OEE 추이 <span class="h2sub">최근 14 가동일 · 목표선 ${pct(tg, 0)}</span></h2>
        ${M.lineChart([{ v: trend.map(v => v * 100), cls: 's1' }], null, { h: 210, d: 0, refs: [{ y: tg * 100, label: `목표 ${pct(tg, 0)}` }], xlab: ds.length ? [[0, ds[0].slice(5)], [ds.length - 1, ds[ds.length - 1].slice(5)]] : [], dots: trend.map((v, i) => ({ i, y: v * 100, cls: sig(v) === 'ok' ? '' : 'bad', t: `${ds[i]} OEE ${pct(v, 1)}` })) })}</div>
      <div class="card"><h2>설비 가동 타임라인 <span class="h2sub">${esc(ld || '')}</span></h2>${ld ? timeline(ld) : ''}
        ${M.legend([['l-run', '가동'], ...REASONS.filter(r => r[0] !== 'SMS').map(r => [`l-r${r[0]}`, r[1]])])}</div>
    </div>`;
  };

  let dtf = 'unk';
  V.downtime = () => {
    const evs = [].concat(...days().filter(r => inP(r, 30)).map(r => r.ev)).sort((a, b) => b.d.localeCompare(a.d) || b.at - a.at), unk = evs.filter(e => e.code === 'UNK');
    const brk = evs.filter(e => e.code === 'BRK'), run = days().filter(r => inP(r, 30)).reduce((s, r) => s + r.run, 0);
    const rows = evs.filter(e => dtf === 'all' || (dtf === 'unk' ? e.code === 'UNK' : e.src === '작업자 입력'));
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">비가동 · 30일</div><div class="val">${f(evs.reduce((s, e) => s + e.min, 0) / 60, 1)}<small>h</small></div><div class="foot">${evs.length}건</div></div>
      <div class="kpi"><div class="lab">미분류</div><div class="val" style="color:${unk.length ? 'var(--danger-ink)' : 'var(--ok)'}">${unk.length}<small>건</small></div><div class="foot">${f(unk.reduce((s, e) => s + e.min, 0), 0)}분 — 사유를 고르면 OEE 분석에 반영</div></div>
      <div class="kpi"><div class="lab">MTBF</div><div class="val">${brk.length ? f(run / brk.length / 60, 1) : '—'}<small>h</small></div><div class="foot">고장 ${brk.length}건 · 평균 고장 간격</div></div>
      <div class="kpi"><div class="lab">MTTR</div><div class="val">${brk.length ? f(brk.reduce((s, e) => s + e.min, 0) / brk.length, 0) : '—'}<small>분</small></div><div class="foot">평균 수리 시간</div></div>
    </div>
    <div class="card dsec"><div class="tools">${M.seg('dtf', dtf, [['unk', `미분류 ${unk.length}`], ['man', '작업자 입력'], ['all', '전체']])}<span class="tsum">${rows.length}건</span></div>
      <div class="tbx"><table class="tb dttab"><colgroup><col class="c-d"><col class="c-n"><col class="c-t"><col class="c-m"><col class="c-r"><col class="c-s"><col></colgroup>
        <thead><tr><th>일자</th><th>설비</th><th>시작</th><th class="n">시간</th><th>사유</th><th>구분</th><th>근거</th></tr></thead>
        <tbody>${rows.slice(0, 120).map(e => `<tr class="${e.code === 'UNK' ? 'unk' : ''}"><td>${esc(e.d.slice(5))}</td><td><b>${esc(e.nm)}</b></td><td>${hm(e.at)}</td><td class="n">${e.min}분</td>
          <td><select class="in dtsel" data-dt="${esc(e.id)}" ${e.src === '작업자 입력' ? 'disabled' : ''}>${REASONS.map(r => `<option value="${r[0]}" ${r[0] === e.code ? 'selected' : ''}>${r[1]}</option>`).join('')}</select></td>
          <td><span class="srcb ${e.src === '작업자 입력' ? 'man' : ''}">${esc(e.src)}</span></td><td class="muted sm1">${esc(e.why)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">해당 비가동이 없습니다</td></tr>'}</tbody></table></div></div>`;
  };

  M.mod({
    id: 'oee', proc: 'oee', group: '설비', order: 4.5,
    menu: [['oee', 'OEE 현황', 'gauge'], ['downtime', '비가동 관리', 'list']],
    views: V,
    bind(root) {
      root.querySelectorAll('[data-oper]').forEach(b => b.onclick = () => { per = +b.dataset.oper; M.render(); });
      root.querySelectorAll('[data-oeq]').forEach(b => b.onclick = () => { eqSel = eqSel === b.dataset.oeq ? '' : b.dataset.oeq; M.render(); });
      root.querySelectorAll('[data-dtf]').forEach(b => b.onclick = () => { dtf = b.dataset.dtf; M.render(); });
      root.querySelectorAll('[data-dt]').forEach(s => s.onchange = () => { M.oeeApi.classify(s.dataset.dt, s.value); M.render(); });
    },
  });
  M.PROC.oee = '설비';
})();
