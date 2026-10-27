// 분석 엔진 단위 테스트 — node tests/stats.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ctx = { window: { MLNG: {} }, Math, console }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/js/stats.js'), 'utf8'), ctx);
const ST = ctx.window.MLNG.st; let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const r = ST.rng(1), r2 = ST.rng(1); ok(r() === r2(), '같은 씨앗 → 같은 난수');
ok(Math.abs(ST.zOf(0.975) - 1.96) < 0.01, '정규 분위수');
ok(Math.abs(ST.phi(1.96) - 0.975) < 0.002, '정규 누적');
const a = [10, 12, 11, 13, 12, 14], b = [5, 6, 5, 7, 6, 5]; ok(ST.permTest(a, b).p < 0.01, '뚜렷한 차이 → 작은 p');
ok(ST.permTest(b, a).p > 0.9, '반대 방향 → 큰 p');
const br = ST.bootRatio(a, b); ok(br.lo < br.ratio && br.ratio < br.hi, '부트스트랩 구간이 비를 감쌈');
const q = ST.bh([0.01, 0.04, 0.03, 0.5]); ok(q[0] <= q[1] && q[3] === 0.5, 'BH 보정');
const cp = ST.changePoint([1, 1.1, 0.9, 1, 1.05, 3, 3.1, 2.9, 3, 3.2]); ok(cp.i === 5 && cp.p < 0.05, '변화점 위치·유의');
const cu = ST.cusum([0, 0.1, -0.1, 0, 0.05, -0.05, 0.1, 0, 2, 2, 2, 2], { base: 6 }); ok(cu.at >= 8, 'CUSUM 경보');
const ew = ST.ewma(Array.from({ length: 40 }, (_, i) => i < 25 ? (i % 3) * 0.1 : 1.5), { base: 20 }); ok(ew.at >= 25, 'EWMA 경보');
// 포아송 회귀: 진짜 β = [ln 1e-4, 0.8]
const rr = ST.rng(5), X = [], y = [], off = []; for (let i = 0; i < 300; i++) { const x = rr() * 2, q2 = 20000, mu = q2 * 1e-4 * Math.exp(0.8 * x); let k = 0, L = Math.exp(-mu), p = 1; do { k++; p *= rr(); } while (p > L); X.push([1, x]); y.push(k - 1); off.push(Math.log(q2)); }
const g = ST.poissonGLM(X, y, off); ok(Math.abs(g.beta[1] - 0.8) < 0.15, 'GLM 계수 회복 ' + g.beta[1].toFixed(3));
ok(Math.abs(ST.nbTail(3, 1, 2) - (1 - Math.exp(-3) * (1 + 3 + 4.5))) < 1e-9, '포아송 꼬리');
ok(ST.nbTail(10, 3, 15) > ST.nbTail(10, 1, 15), '과산포면 꼬리가 두꺼움');
const pf = ST.powerFit([1, 2, 4, 8], [0.1, 0.2, 0.4, 0.8]); ok(Math.abs(pf.b - 1) < 1e-6, '거듭제곱 적합');
ok(ST.shrink(0, 1, 10, 1).m === 5, '정규 축소');
ok(ST.conformal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1) === 10, '컨포멀 분위');
ok(ST.psi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) < 0.01, '같은 분포 PSI≈0');
ok(ST.holt([1, 2, 3, 4, 5]).next > 5.5, 'Holt 추세');
ok(ST.poissonN(10, 5) > 0 && ST.poissonN(10, 5) < 20, '표본 수 계산');
ok(Math.abs(ST.gammaP(1, 1) - (1 - Math.exp(-1))) < 1e-9, '감마 누적 (지수분포)');
ok(Math.abs(ST.gammaP(50, 50) - 0.5188) < 0.002, '감마 누적 (큰 a)');
ok(Math.abs(ST.lgamma(5) - Math.log(24)) < 1e-9, '로그 감마');
console.log(`stats ✓ ${n}개 통과`);
