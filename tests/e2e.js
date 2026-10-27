// 화면 · 시나리오 자동 시험 — node tests/e2e.js  (먼저 python tools/build_preview.py)
// 1.0 전체 화면 · 2.0 신뢰 계층 · 3.0 판단 · 4.0 확률 · 자기 의심 · 판단 증명까지, 실패하면 종료 코드 1
const { chromium } = require('playwright');
const path = require('path'), url = 'file://' + path.resolve(__dirname, '../preview.html');
const opt = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : (require('fs').existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); console.log(`${c ? '✓' : '✕'} ${m}`); };

(async () => {
  const b = await chromium.launch(opt);
  // ── 1. 모든 화면 (라이트 · 다크)
  for (const th of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: th }), errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(url); await p.waitForFunction(() => window.MLNGTrust && MLNGTrust.ready, null, { timeout: 60000 });
    const ks = await p.$$eval('#nav button', a => a.map(x => x.dataset.k)), empty = [];
    for (const k of ks) { await p.click(`#nav [data-k="${k}"]`); await p.waitForTimeout(60); if ((await p.$eval('#view', e => e.innerText.length)) < 50) empty.push(k); }
    ok(!empty.length && !errs.length, `${th} 화면 ${ks.length}개 — 빈 화면 ${empty.join(',') || '없음'} · 오류 ${errs.length}`);
    await p.close();
  }
  // ── 2~4. 시나리오
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }), p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(url); await p.waitForFunction(() => window.MLNGTrust && MLNGTrust.ready, null, { timeout: 60000 }); await p.waitForTimeout(300);
  const W = ms => p.waitForTimeout(ms || 300), go = k => p.evaluate(k => MLNG.nav(k), k), ev = fn => p.evaluate(fn);
  const note = () => p.evaluate(() => [...document.querySelectorAll('#view .note')].map(n => n.innerText).join(' | '));

  // 2.0 신뢰 계층
  await go('net_ledger'); await W(); await p.click('#lg-verify'); await W(800); ok(/모두 사슬과 서명이 맞습니다/.test(await note()), '원장 전체 검증');
  await p.click('#lg-tamper'); await W(800); ok(/바뀌었|끊|불일치|다릅/.test(await note()), '원장 위변조 감지');
  await p.click('#lg-restore'); await W(500);
  await go('pass_home'); await W(); await p.click('#pp-verify'); await W(700); ok(await ev(() => !!document.querySelector('#view .pp')), 'LOT 여권 검증 화면');
  const nDel = await ev(() => MLNGTrust.orders[0].deliveries.length); await go('deal_home'); await W(); await p.click('#so-deliver'); await W(1000);
  ok(await ev(() => MLNGTrust.orders[0].deliveries.length) === nDel + 1, '스마트 발주 납품 → 자동 검수');

  // 3.0 판단
  ok(await ev(() => MLNG.caseApi.open().length >= 3), '알림을 사건으로 묶음');
  await go('cases'); await W(); await p.click('[data-csel^="CS-HEAT"]'); await W();
  await p.click('.cdet .cnext [data-crun]'); await W(600); ok(/LOT|보류|요청|지시/.test(await p.$eval('.cdet .note', e => e.innerText)), '사건 다음 조치 실행');
  ok(await ev(() => { const c = MLNG.caseApi.list().find(x => x.tpl === 'heat'); return c.causes.some(x => x.cmp && x.cmp.p != null); }), '원인 후보에 순열 검정 p');
  await go('gate'); await W(); ok(await ev(() => MLNG.gate.candidates().some(l => MLNG.gate.predict(l.id).prob)), '출하 게이트 LOT 클레임 확률');
  await go('whatif'); await W(); await p.click('#wi-opt'); await W(2500); ok(await ev(() => /최적 조합/.test(document.querySelector('#view').innerText)), 'What-if 최적 찾기');
  await go('replay'); await W(); await p.click('[data-rp="-1"]'); await W(500); ok(await ev(() => /그때 라인/.test(document.querySelector('#view').innerText)), '공장 되감기');
  await go('shift'); await W(); await p.click('#sh-out'); await W(400); ok(await ev(() => /넘김 서명 완료/.test(document.querySelector('#view').innerText)), '교대 넘김 서명');
  await go('overview'); await W(); await p.keyboard.press('Control+k'); await W(150); await p.keyboard.type('HT-147004'); await W(150); await p.keyboard.press('Enter'); await W(300);
  ok(await ev(() => MLNG.cur === 'trace'), '찾기 · 이동 (Ctrl K)');
  await ev(() => MLNG.askApi.ask('열처리 2존 점검 지시하고 히터 발주 올려줘')); await W(700); ok(await ev(() => document.querySelectorAll('#chatbox [data-aok]').length >= 2), '말로 지시 → 승인 카드 2장');

  // 4.0 확률 · 자기 의심 · 판단 증명
  ok(await ev(() => MLNG.ml.all().length === 6 && MLNG.ml.all().every(x => x.trust >= 0 && x.trust <= 1)), '모델 6개 신뢰도');
  ok(await ev(() => MLNGTrust.agent.items.some(x => x.doubt)), '자기 의심 — 근거 모델 신뢰가 낮은 자동 조치를 승인 대기로');
  ok(await ev(() => { const r = MLNG.ml.rul('T15', 0), r3 = MLNG.ml.rul('T15', 3); return r.t90 - r.t10 >= r3.t90 - r3.t10; }), '공구 수명 — 측정이 쌓이면 구간이 좁아짐');
  ok(await ev(() => !!MLNG.ml.changeFor('heat')), '히터 변화점');
  await go('gate'); await W(); const holdBtn = await p.$('[data-ghold]'); if (holdBtn) { await holdBtn.click(); await W(700); }
  ok(await ev(() => MLNG.prove.log.length > 0), '판단 증명 기록');
  ok(await ev(() => MLNG.prove.log.filter(r => MLNG.prove.canReplay(r.id)).every(r => MLNG.prove.replay(r.id).same)), '판단 재현 — 같은 입력 → 같은 결과');
  await go('models'); await W(); ok(await ev(() => /자기 의심 정책/.test(document.querySelector('#view').innerText)), '모델 상태 화면');
  await go('prove'); await W(); await p.click('#pv-all').catch(() => {}); await W(300); ok(await ev(() => /같은 결과/.test(document.querySelector('#view').innerText)), '판단 증명 화면 재현');

  // 끝: 모든 동작 뒤에도 원장이 온전한가
  await go('net_ledger'); await W(); await p.click('#lg-verify'); await W(1000); ok(/모두 사슬과 서명이 맞습니다/.test(await note()), '모든 시나리오 뒤 원장 검증');
  ok(!errs.length, `페이지 오류 ${errs.length}건 ${errs.slice(0, 3).join(' / ')}`);
  await b.close();
  console.log(`\ne2e ${fails.length ? '✕' : '✓'} ${pass}/${pass + fails.length}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
