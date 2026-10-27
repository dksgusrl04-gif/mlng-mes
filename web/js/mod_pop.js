/* 5.5 — 현장 실적 입력 (POP · 태블릿)
 * ───────────────────────────────────────────────────────────────
 * 작업자가 설비 앞 태블릿에서 터치로 입력한다: 설비 · 작업자 고르기 → 작업 선택 → 시작 → (정지 시 비가동 사유) → 양품 · 불량 수량(키패드) → 불량 사유 → 완료
 *   완료하면 그 실적이 LOT 으로 등록되어 공정 실적 · OEE · 생산 일보에 바로 반영되고, 신뢰 원장에 남는다
 *   정지 사유는 OEE 비가동으로 들어가고, 자동 감지된 «미분류» 정지도 이 화면에서 사유를 고른다
 * 데모: 기록은 이 브라우저 메모리 (새로고침하면 처음 상태) · 실시간이면 불량은 mlng_inspections 로 저장
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f } = M;
  const T = () => window.MLNGTrust || {};
  const EQ = [['PR-01', 'press', '프레스', 'PR'], ['SP-01', 'weld', '점용접', 'WD'], ['SB-01', 'heat', '열처리', 'HT'], ['MC-01', 'mach', 'MCT 가공', 'MC'], ['IN-01', 'insp', '정밀 검사', 'IN']];
  const EXTRA = { mach: [['MC-DIM', '치수 불량'], ['MC-BUR', '버'], ['MC-SUR', '조도 불량']], insp: [['IN-DIM', '치수 불합격']] };
  const st = { eq: 'PR-01', worker: '', job: null, run: null, stop: null, target: 'good', good: '', bad: '', code: '', msg: '', log: [], done: {} };
  const pad = n => String(n).padStart(2, '0');
  const stamp = t => { const d = t || M.now(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const eqOf = id => EQ.find(e => e[0] === id);
  const codes = p => ((M.S.masters.defect_codes || []).filter(c => c.proc === p).map(c => [c.code, c.name])).concat(EXTRA[p] || []).concat([['ETC', '기타']]);

  // 작업 대기열: 진행 중 수주의 잔량을 설비 하루 계획 단위로 나눈 작업지시
  const JOBQ = {};   // 그날 설비별 작업지시는 처음 만든 수량으로 고정 (실적이 들어와도 계획이 바뀌지 않게)
  function queue(eq) {
    const k = eq + stamp().slice(0, 10); if (!JOBQ[k]) JOBQ[k] = queue0(eq);
    return JOBQ[k].map(q => Object.assign({}, q, { state: st.done[q.id] ? 'done' : st.job && st.job.id === q.id ? 'run' : 'wait', result: st.done[q.id] || null }));
  }
  function queue0(eq) {
    const e = eqOf(eq), B = M.flow ? M.flow.book() : { orders: [] }, lm = M.lineApi ? M.lineApi.model() : null;
    const per = lm ? Math.max(1, Math.round(lm.plan[e[1]] / (e[1] === 'heat' ? 2 : 1) / 10) * 10) : 1000;
    const ymd = stamp().slice(2, 10).replace(/-/g, '');
    const out = [];
    B.orders.filter(o => o.stage !== 'done' && o.remain > 0).slice(0, 3).forEach((o, i) => {
      const id = `WO-${ymd}-${e[3]}${i + 1}`, done = st.done[id];
      out.push({ id, order: o.id, buyer: o.buyer, item: o.item, qty: Math.min(per, Math.max(per / 2, Math.round(o.remain / 10) * 10)), due: o.due, state: done ? 'done' : st.job && st.job.id === id ? 'run' : 'wait', result: done || null });
    });
    return out;
  }
  const elapsed = t0 => { if (!t0) return '00:00:00'; const s = Math.max(0, Math.floor((Date.now() - t0) / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };

  const V = {};
  V.pop = () => {
    const e = eqOf(st.eq), Q = queue(st.eq), workers = (M.S.masters.workers || []).map(w => w.name);
    if (!st.worker) st.worker = workers[0] || '작업자';
    if (st.job && !Q.some(q => q.id === st.job.id)) st.job = null;
    const j = st.job, state = st.stop ? 'stop' : st.run ? 'run' : 'idle';
    const good = +st.good || 0, bad = +st.bad || 0, plan = j ? j.qty : 0;
    const unk = M.oeeApi ? M.oeeApi.unclassified().filter(x => x.eq === st.eq).slice(0, 4) : [];
    const RS = M.oeeApi ? M.oeeApi.REASONS.filter(r => !['UNK', 'SMS'].includes(r[0])) : [];
    const today = st.log.filter(l => l.eq === st.eq);
    return `<div class="pop">
      <div class="pophead">
        <div class="peqs">${EQ.map(x => `<button class="${x[0] === st.eq ? 'on' : ''}" data-peq="${x[0]}"><b>${esc(x[2])}</b><small>${x[0]}</small></button>`).join('')}</div>
        <label class="pwk">작업자<select class="in" id="pop-wk">${workers.map(w => `<option ${w === st.worker ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
      </div>
      <div class="popgrid">
        <section class="pcol">
          <h3>작업 대기열 <span>${Q.filter(q => q.state !== 'done').length}건</span></h3>
          ${Q.map(q => `<button class="pjob ${q.state} ${j && j.id === q.id ? 'sel' : ''}" data-pjob="${q.id}" ${st.run && (!j || j.id !== q.id) ? 'disabled' : ''}>
            <div class="pj1"><b>${esc(q.id)}</b><span class="pjs ${q.state}">${q.state === 'done' ? '완료' : q.state === 'run' ? '진행 중' : '대기'}</span></div>
            <div class="pj2">${esc(q.order)} · ${esc(q.item)} · 납기 ${esc(String(q.due).slice(5))}</div>
            <div class="pj3"><span>계획</span><b>${f(q.qty, 0)}</b>${q.result ? `<span>실적</span><b>${f(q.result.good, 0)}</b>` : ''}</div></button>`).join('') || '<div class="empty">작업지시가 없습니다</div>'}
        </section>
        <section class="pcol pmain">
          <div class="pstate ${state}"><div><span class="pdot"></span>${state === 'run' ? '가동 중' : state === 'stop' ? `정지 — ${esc(st.stop.name)}` : '대기'}</div><b id="pop-timer">${state === 'stop' ? elapsed(st.stop.t0) : state === 'run' ? elapsed(st.run.t0) : '00:00:00'}</b></div>
          <div class="pcur">${j ? `<div class="pcj"><b>${esc(j.id)}</b><span>${esc(j.order)} · ${esc(e[2])}</span></div>` : '<div class="pcj muted">작업 대기열에서 작업을 고르세요</div>'}
            <div class="pnums"><div><span>계획</span><b>${f(plan, 0)}</b></div><div class="g"><span>양품</span><b>${f(good, 0)}</b></div><div class="r"><span>불량</span><b>${f(bad, 0)}</b></div><div><span>달성률</span><b>${plan ? Math.round(good / plan * 100) : 0}%</b></div></div>
            <div class="pprog"><i style="width:${plan ? Math.min(100, good / plan * 100) : 0}%"></i></div>
            ${j ? `<dl class="pinfo"><dt>수주</dt><dd>${esc(j.order)} · ${esc(({ 'T1-B': 'B사', 'T1-E': 'E사', 'T1-F': 'F사' })[j.buyer] || j.buyer || '')}</dd><dt>품목</dt><dd>${esc(j.item)}</dd><dt>납기</dt><dd>${esc(j.due)}</dd>
              <dt>설비</dt><dd>${esc(e[2])} (${esc(st.eq)})</dd><dt>작업자</dt><dd>${esc(st.worker)}</dd><dt>시작</dt><dd>${st.run ? esc(new Date(st.run.t0).toTimeString().slice(0, 5)) : '—'}</dd></dl>` : ''}</div>
          <div class="pbtns">
            <button class="pb start" data-pact="start" ${!j || st.run ? 'disabled' : ''}>작업 시작</button>
            <button class="pb stop ${state === 'stop' ? 'on' : ''}" data-pact="${state === 'stop' ? 'resume' : 'stop'}" ${!st.run ? 'disabled' : ''}>${state === 'stop' ? '재가동' : '비가동'}</button>
            <button class="pb done" data-pact="done" ${!st.run || st.stop || !(good + bad) || (bad && !st.code) ? 'disabled' : ''}>작업 완료</button>
          </div>
          ${st.msg ? `<div class="pmsg note msg">${esc(st.msg)}</div>` : ''}
          ${st.pickStop ? `<div class="pover"><h3>비가동 사유</h3><div class="preasons">${RS.map(r => `<button data-pstop="${r[0]}" style="--c:${r[3]}">${esc(r[1])}</button>`).join('')}</div><button class="btn" data-pact="cancel">취소</button></div>` : ''}
        </section>
        <section class="pcol">
          <div class="ptgt"><button class="${st.target === 'good' ? 'on g' : ''}" data-ptgt="good">양품 수량</button><button class="${st.target === 'bad' ? 'on r' : ''}" data-ptgt="bad">불량 수량</button></div>
          <div class="pdisp ${st.target === 'bad' ? 'r' : 'g'}">${f(+(st.target === 'bad' ? st.bad : st.good) || 0, 0)}</div>
          <div class="pkeys">${['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '←'].map(k => `<button data-pkey="${k}" ${!st.run ? 'disabled' : ''}>${k}</button>`).join('')}</div>
          <div class="pquick">${['+1', '+10', '+100', '+1000'].map(k => `<button data-pkey="${k}" ${!st.run ? 'disabled' : ''}>${k}</button>`).join('')}</div>
          ${bad ? `<h3>불량 사유 <span class="req">필수</span></h3><div class="pcodes">${codes(e[1]).map(([c, n]) => `<button class="${st.code === c ? 'on' : ''}" data-pcode="${c}">${esc(n)}</button>`).join('')}</div>` : ''}
        </section>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h2>오늘 입력한 실적 <span class="h2sub">${esc(e[2])}</span></h2>
          ${M.table([['작업', r => `<b>${esc(r.job)}</b>`], ['시작', r => esc(r.t0.slice(11))], ['종료', r => esc(r.t1.slice(11))], ['양품', r => f(r.good, 0), 'n'], ['불량', r => f(r.bad, 0), 'n'], ['불량 사유', r => esc(r.codeName || '—')], ['비가동', r => r.stopMin ? `${r.stopMin}분` : '—', 'n'], ['작업자', 'by']], today, { wrap: false, empty: '아직 입력한 실적이 없습니다' })}</div>
        <div class="card"><h2>사유 입력이 필요한 정지 <span class="h2sub">자동 감지 · ${esc(e[2])}</span><a class="more" href="#" data-go="downtime">비가동 관리 →</a></h2>
          ${unk.length ? `<div class="punk">${unk.map(u => `<div class="pu"><div><b>${esc(u.d.slice(5))} ${String(Math.floor(u.at / 60)).padStart(2, '0')}:${String(Math.round(u.at % 60)).padStart(2, '0')}</b> · ${u.min}분</div>
            <div class="pur">${RS.slice(0, 5).map(r => `<button data-pcls="${esc(u.id)}|${r[0]}">${esc(r[1].split(' ')[0])}</button>`).join('')}</div></div>`).join('')}</div>` : '<div class="empty">사유를 입력할 정지가 없습니다</div>'}</div>
      </div>
    </div>`;
  };

  let tick = null;
  const startTick = () => { clearInterval(tick); tick = setInterval(() => { const el = document.getElementById('pop-timer'); if (!el || M.cur !== 'pop') { clearInterval(tick); return; } el.textContent = st.stop ? elapsed(st.stop.t0) : st.run ? elapsed(st.run.t0) : '00:00:00'; }, 1000); };
  async function complete() {
    const e = eqOf(st.eq), j = st.job, good = +st.good || 0, bad = +st.bad || 0, t1 = M.now(), t0 = new Date(t1.getTime() - Math.max(60000, Date.now() - st.run.t0));
    const id = `${e[3]}-${stamp(t1).slice(2, 10).replace(/-/g, '')}-P${st.log.length + 1}`, codeName = bad ? (codes(e[1]).find(c => c[0] === st.code) || [])[1] : '';
    const lot = { id, kind: 'process', proc: e[1], wo_id: j.id, item_code: j.item, equipment_id: st.eq, worker: st.worker, qty: good + bad, good, bad, start_at: stamp(t0), end_at: stamp(t1), pop: true };
    M.S.lots.push(lot);
    if (bad) { try { await M.D.addInspection({ proc: e[1], lot_id: id, target: null, result: '불량', defect_code: st.code, qty: bad, note: `POP · ${codeName}` }); } catch (er) { /* 기록 실패해도 실적은 남긴다 */ } }
    if (T().ready) await T().append('MLNG', 'pop', id, `POP 실적 — ${e[2]} ${j.id} 양품 ${good} · 불량 ${bad}${bad ? ` (${codeName})` : ''} · ${st.worker}`.slice(0, 160), { lot: id, wo: j.id, good, bad, code: st.code || null, by: st.worker });
    st.log.unshift({ eq: st.eq, job: j.id, t0: stamp(t0), t1: stamp(t1), good, bad, codeName, stopMin: st.run.stopMin || 0, by: st.worker });
    st.done[j.id] = { good, bad };
    st.msg = `${j.id} 완료 — 양품 ${f(good, 0)} · 불량 ${f(bad, 0)} 등록. 공정 실적 · OEE · 생산 일보에 반영됩니다.`;
    st.run = null; st.job = null; st.good = ''; st.bad = ''; st.code = ''; st.target = 'good';
  }

  M.mod({
    id: 'pop', group: '현장', order: 4.2,
    menu: [['pop', '실적 입력 (POP)', 'sign']],
    views: V,
    bind(root) {
      if (!root.querySelector('.pop')) return;
      startTick();
      const R = () => M.render();
      root.querySelectorAll('[data-peq]').forEach(b => b.onclick = () => { if (st.run) { st.msg = '진행 중인 작업을 먼저 완료하세요'; return R(); } st.eq = b.dataset.peq; st.job = null; st.msg = ''; R(); });
      const wk = root.querySelector('#pop-wk'); if (wk) wk.onchange = () => { st.worker = wk.value; };
      root.querySelectorAll('[data-pjob]').forEach(b => b.onclick = () => { if (st.run) return; const q = queue(st.eq).find(x => x.id === b.dataset.pjob); if (!q || q.state === 'done') return; st.job = q; st.msg = ''; R(); });
      root.querySelectorAll('[data-ptgt]').forEach(b => b.onclick = () => { st.target = b.dataset.ptgt; R(); });
      root.querySelectorAll('[data-pkey]').forEach(b => b.onclick = () => { const k = b.dataset.pkey, key = st.target; let v = String(st[key] || '');
        if (k === 'C') v = ''; else if (k === '←') v = v.slice(0, -1); else if (k.startsWith('+')) v = String((+v || 0) + +k.slice(1)); else v = (v === '0' ? '' : v) + k;
        st[key] = String(Math.min(9999999, +v || 0) || ''); if (key === 'bad' && !+st.bad) st.code = ''; R(); });
      root.querySelectorAll('[data-pcode]').forEach(b => b.onclick = () => { st.code = b.dataset.pcode; R(); });
      root.querySelectorAll('[data-pcls]').forEach(b => b.onclick = () => { const [id, c] = b.dataset.pcls.split('|'); M.oeeApi.classify(id, c); st.msg = '정지 사유를 등록했습니다 — OEE 분석에 반영'; R(); });
      root.querySelectorAll('[data-pstop]').forEach(b => b.onclick = () => { const r = M.oeeApi.REASONS.find(x => x[0] === b.dataset.pstop); st.stop = { code: r[0], name: r[1], t0: Date.now() }; st.pickStop = false; st.msg = ''; R(); });
      root.querySelectorAll('[data-pact]').forEach(b => b.onclick = async () => {
        const a = b.dataset.pact;
        if (a === 'start' && st.job) { st.run = { t0: Date.now(), stopMin: 0 }; st.msg = `${st.job.id} 시작 — ${st.worker}`; if (T().ready) await T().append('MLNG', 'pop', st.job.id, `POP 작업 시작 — ${eqOf(st.eq)[2]} ${st.job.id} · ${st.worker}`, { wo: st.job.id, by: st.worker }); }
        if (a === 'stop') st.pickStop = true;
        if (a === 'cancel') st.pickStop = false;
        if (a === 'resume' && st.stop) { const min = Math.max(1, Math.round((Date.now() - st.stop.t0) / 60000)); M.oeeApi.addManual(st.eq, st.stop.code, min, `${st.job ? st.job.id : ''} 작업 중 정지`, st.worker); st.run.stopMin += min; st.msg = `${st.stop.name} ${min}분 — 비가동 등록`; st.stop = null; }
        if (a === 'done' && st.run) await complete();
        R();
      });
    },
  });
})();
