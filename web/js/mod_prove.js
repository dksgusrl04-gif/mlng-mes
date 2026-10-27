/* 4.0 ⑥ — 판단 증명 화면
 * ───────────────────────────────────────────────────────────────
 * 판단마다 «데이터 해시 · 모델 버전 · 코드 빌드 해시 · 결과 해시» 와 원장 번호를 보여 주고,
 * 「재현」 을 누르면 저장한 입력으로 지금 코드가 같은 결과를 내는지 다시 계산한다 (데이터·코드가 그때와 같은지도 함께).
 */
(function () {
  'use strict';
  const M = window.MLNG, { esc, f } = M;
  const res = {};
  const KIND = { 'gate.hold': '출하 보류', 'gate.ship': '출하', agent: '에이전트 실행', case: '이슈 조치', whatif: '계획 적용', deal: '자동 수입검사' };
  const V = {};
  V.prove = () => {
    const PV = M.prove, T = window.MLNGTrust; if (!PV || !T || !T.ready) return '<div class="empty">준비하는 중…</div>';
    const B = window.MLNG_BUILD || { hash: 'dev-build', files: {} }, L = PV.log, ok = Object.values(res).filter(r => r.same).length;
    return `<div class="kstrip">
      <div class="kpi"><div class="lab">서명된 판정</div><div class="val">${L.length}<small>건</small></div><div class="foot">데이터 · 모델 · 코드 해시와 함께 원장에</div></div>
      <div class="kpi"><div class="lab">재현 확인</div><div class="val" style="color:var(--ok)">${ok}<small>/ ${Object.keys(res).length}</small></div><div class="foot">같은 입력 → 같은 결과</div></div>
      <div class="kpi"><div class="lab">코드 빌드</div><div class="val mono" style="font-size:15px">${esc(String(B.hash).slice(0, 12))}</div><div class="foot">${B.hash === 'dev-build' ? '스탬프 없음 (개발 중)' : 'stamp_version.py 스탬프'} · 파일 ${Object.keys(B.files || {}).length}개</div></div>
      <div class="kpi click" data-go="models"><div class="lab">모델 버전</div><div class="val">${Object.keys(M.ml ? M.ml.VERSION : {}).length}<small>개</small></div><div class="foot">모델 상태에서 검증 성적</div></div>
    </div>
    <div class="card"><h2>AI 판정 이력 <span class="h2sub">누가 아니라 «무엇이» 판단했는지 — 그때 그 판단을 같은 입력으로 다시 돌려 봅니다</span><button class="btn sm" id="pv-all" style="margin-left:auto" ${L.some(x => PV.canReplay(x.id)) ? '' : 'disabled'}>전체 재현</button></h2>
      ${M.table([['시각', r => `<span class="muted">${esc(r.at.slice(5, 16))}</span>`], ['판단', r => `<b>${esc(r.title)}</b><div class="muted" style="font-size:11.5px">${esc(KIND[r.kind] || r.kind)} · 원장 #${esc(r.seq)}</div>`],
        ['모델', r => `<span class="mono" style="font-size:12px">${esc(r.model)}</span>`], ['데이터', r => `<span class="mono" style="font-size:12px">${esc(r.data.slice(0, 10))}</span>`], ['코드', r => `<span class="mono" style="font-size:12px">${esc(r.code.slice(0, 10))}</span>`], ['결과', r => `<span class="mono" style="font-size:11.5px">${esc(JSON.stringify(r.view).slice(0, 34))}</span>`],
        ['재현', r => { const x = res[r.id]; return x ? `${x.same ? '<span class="prove-ok">✓ 같은 결과</span>' : `<span class="prove-ng">✕ ${esc(x.err || '결과 다름')}</span>`}<div class="muted" style="font-size:11px">데이터 ${x.dataSame == null ? '—' : x.dataSame ? '그때와 같음' : '지금은 바뀜'} · 코드 ${x.codeSame ? '같음' : '바뀜'}</div>` : PV.canReplay(r.id) ? `<button class="btn sm" data-pv="${esc(r.id)}">재현</button>` : '<span class="muted">기록만</span>'; }]],
        L.slice(0, 40), { wrap: false, empty: '아직 판단이 없습니다 — 출하 승인에서 보류·출하하거나 이슈 조치를 실행해 보세요' })}
      <p class="note">원장에는 해시만 남고 원본 값은 나가지 않습니다. 고객 · 감사는 같은 데이터와 같은 코드(빌드 해시)로 판단을 다시 계산해 확인할 수 있습니다. «데이터 지금은 바뀜» 은 그 뒤에 데이터가 늘거나 바뀌었다는 뜻이고, 저장한 입력으로는 여전히 같은 결과가 나와야 합니다.</p></div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><h2>코드 빌드 <span class="h2sub">tools/stamp_version.py 가 파일마다 해시를 찍습니다</span></h2>
        ${M.table([['파일', 'f'], ['해시', r => `<span class="mono" style="font-size:12px">${esc(r.h)}</span>`]], Object.entries(B.files || {}).map(([k, h]) => ({ f: k, h })).slice(0, 40), { wrap: false, empty: '빌드 스탬프가 없습니다 (로컬 개발 빌드)' })}</div>
      <div class="card"><h2>모델 카드 <span class="h2sub">버전 · 기법 · 검증</span></h2>
        ${M.ml ? M.table([['모델', x => `<b>${esc(x.name)}</b><div class="mono muted" style="font-size:11.5px">${esc(x.v)}</div>`], ['신뢰', x => `<span class="trust ${x.level}">${esc(M.ml.LEVEL[x.level][1])} ${f(x.trust * 100, 0)}</span>`]], M.ml.all(), { wrap: false, click: () => 'models' }) : ''}</div></div>`;
  };
  M.mod({
    id: 'prove', group: '증명하는 AI (4.0)', order: 9,
    menu: [['prove', '판단 증명', 'badge']],
    views: V,
    bind(root) {
      root.querySelectorAll('[data-pv]').forEach(b => b.onclick = () => { res[b.dataset.pv] = M.prove.replay(b.dataset.pv); M.render(); });
      const a = root.querySelector('#pv-all'); if (a) a.onclick = () => { M.prove.log.forEach(r => { if (M.prove.canReplay(r.id)) res[r.id] = M.prove.replay(r.id); }); M.render(); };
    },
  });
})();
