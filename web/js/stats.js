// @ts-check
/* 4.0 분석 엔진 — 숫자 하나 대신 «얼마나 믿을 수 있는지» 까지
 * ───────────────────────────────────────────────────────────────
 * 외부 라이브러리 없이 브라우저에서 돈다. 난수는 씨앗을 고정해(mulberry32) 같은 데이터면 같은 결과 — 판단 증명(재현)의 전제.
 *   검정     permTest(순열 검정) · bootRatio(부트스트랩 신뢰구간) · bh(다중 비교 보정, Benjamini–Hochberg)
 *   변화     changePoint(평균 변화점 + 순열 p) · cusum · ewma(관리도)
 *   모델     poissonGLM(IRLS, 노출 offset) · nbTail(음이항 꼬리 확률) · powerFit(로그-로그 회귀 + 공분산)
 *   불확실성 conformal(분할 컨포멀 구간) · shrink(계층 베이즈 정규 축소) · mvn2(2변량 정규 표본)
 *   감시     psi(분포 변화 지수)
 *   예측     holt(이중 지수평활) · zOf(정규 분위수) · poissonN(두 조건 비교에 필요한 표본 수)
 */
(function () {
  'use strict';
  /** @type {any} */ const W = window;
  /** @type {MLNGStats} */ const ST = W.MLNG.st = /** @type {any} */ ({});
  /** @param {number} seed */
  ST.rng = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  /** @param {number[]} x */ const mean = x => x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN;
  /** @param {number[]} x */ const vr = x => { const m = mean(x); return x.length > 1 ? x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1) : 0; };
  ST.mean = mean; ST.var = vr; ST.sd = x => Math.sqrt(vr(x));
  /** @param {number[]} x @param {number} q */
  ST.q = (x, q) => { const b = x.filter(v => isFinite(v)).sort((p, r) => p - r); if (!b.length) return NaN; const i = (b.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); };
  // 정규 분포
  /** @param {number} z */
  ST.phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  /** @param {number} p 정규 분위수 (Acklam 근사) */
  ST.zOf = p => { const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572], c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425; let q, r; if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); };

  // ── 검정
  /** 순열 검정: A 평균이 B 평균보다 큰가(단측). p = 섞었을 때 차이가 이만큼 이상 나올 비율
   * @param {number[]} a @param {number[]} b @param {{n?:number, seed?:number}} [o] */
  ST.permTest = (a, b, o = {}) => {
    const n = o.n || 2000, r = ST.rng(o.seed || 7), all = a.concat(b), na = a.length, obs = mean(a) - mean(b);
    if (!a.length || !b.length) return { diff: NaN, p: NaN };
    let ge = 0; const x = all.slice();
    for (let k = 0; k < n; k++) { for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = x[i]; x[i] = x[j]; x[j] = t; }
      let sa = 0; for (let i = 0; i < na; i++) sa += x[i]; const d = sa / na - (all.reduce((s, v) => s + v, 0) - sa) / (all.length - na); if (d >= obs - 1e-12) ge++; }
    return { diff: obs, p: (ge + 1) / (n + 1) };
  };
  /** 부트스트랩: 평균 비(A/B)의 90% 신뢰구간
   * @param {number[]} a @param {number[]} b @param {{n?:number, seed?:number, level?:number}} [o] */
  ST.bootRatio = (a, b, o = {}) => {
    const n = o.n || 1500, r = ST.rng(o.seed || 11), lv = o.level || 0.9, rs = [];
    if (!a.length || !b.length) return { ratio: NaN, lo: NaN, hi: NaN };
    const pick = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[Math.floor(r() * x.length)]; return s / x.length; };
    for (let k = 0; k < n; k++) { const mb = pick(b); if (mb > 0) rs.push(pick(a) / mb); }
    return { ratio: mean(a) / mean(b), lo: ST.q(rs, (1 - lv) / 2), hi: ST.q(rs, 1 - (1 - lv) / 2) };
  };
  /** Benjamini–Hochberg 보정 q 값 @param {number[]} ps */
  ST.bh = ps => { const m = ps.length, idx = ps.map((p, i) => [p, i]).sort((x, y) => x[0] - y[0]), q = new Array(m); let prev = 1;
    for (let k = m - 1; k >= 0; k--) { const [p, i] = idx[k]; prev = Math.min(prev, p * m / (k + 1)); q[i] = Math.min(1, prev); } return q; };

  // ── 변화
  /** 평균이 한 번 바뀐 지점 (오차 제곱합 최소) + 순열로 우연일 확률
   * @param {number[]} x @param {{min?:number, n?:number, seed?:number}} [o] */
  ST.changePoint = (x, o = {}) => {
    const mn = o.min || 3, nn = x.length; if (nn < 2 * mn) return null;
    const best = y => { const cs = [0]; y.forEach((v, i) => cs.push(cs[i] + v)); const tot = cs[nn]; let bi = -1, bg = -Infinity;
      for (let i = mn; i <= nn - mn; i++) { const l = cs[i], g = l * l / i + (tot - l) ** 2 / (nn - i) - tot * tot / nn; if (g > bg) { bg = g; bi = i; } } return { i: bi, g: bg }; };
    const b0 = best(x), r = ST.rng(o.seed || 13), y = x.slice(); let ge = 0; const n = o.n || 400;
    for (let k = 0; k < n; k++) { for (let i = y.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = y[i]; y[i] = y[j]; y[j] = t; } if (best(y).g >= b0.g) ge++; }
    return { i: b0.i, before: mean(x.slice(0, b0.i)), after: mean(x.slice(b0.i)), p: (ge + 1) / (n + 1) };
  };
  /** 단측 CUSUM: 기준(처음 base 개) 평균에서 k·σ 이상 오른 누적이 h·σ 를 넘는 첫 지점
   * @param {number[]} x @param {{base?:number, k?:number, h?:number}} [o] */
  ST.cusum = (x, o = {}) => { const nb = Math.min(o.base || 10, Math.floor(x.length / 2)), b = x.slice(0, nb), m = mean(b), s = ST.sd(b) || 1e-9, k = (o.k ?? 0.5) * s, h = (o.h ?? 4) * s;
    let c = 0, at = -1, start = -1; const path = x.map((v, i) => { const prev = c; c = Math.max(0, c + v - m - k); if (prev === 0 && c > 0) start = i; if (at < 0 && c > h) at = i; return c; });
    return { at, start: at >= 0 ? start : -1, path, m, s }; };
  /** EWMA 관리도 @param {number[]} x @param {{lambda?:number, L?:number, base?:number}} [o] */
  ST.ewma = (x, o = {}) => { const l = o.lambda || 0.2, L = o.L || 3, nb = Math.min(o.base || 20, x.length), m = mean(x.slice(0, nb)), s = ST.sd(x.slice(0, nb)) || 1e-9;
    let z = m, at = -1; const zs = [], ucl = [], lcl = []; x.forEach((v, i) => { z = l * v + (1 - l) * z; const w = L * s * Math.sqrt(l / (2 - l) * (1 - (1 - l) ** (2 * (i + 1)))); zs.push(z); ucl.push(m + w); lcl.push(m - w); if (at < 0 && i >= nb && (z > m + w || z < m - w)) at = i; });
    return { z: zs, ucl, lcl, at, m, s }; };

  // ── 모델
  /** 작은 선형계 풀기 (가우스 소거) @param {number[][]} A @param {number[]} b */
  const solve = (A, b) => { const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) M[c][c] = 1e-12;
      for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; } }
    return M.map((r, i) => r[n] / r[i]); };
  /** 역행렬 @param {number[][]} A */
  const inv = A => A.map((_, j) => solve(A, A.map((__, i) => i === j ? 1 : 0))).reduce((acc, col, j) => { col.forEach((v, i) => { (acc[i] = acc[i] || [])[j] = v; }); return acc; }, /** @type {number[][]} */([]));
  ST.solve = solve; ST.inv = inv;
  /** 포아송 회귀 (IRLS) — 불량 수 ~ 노출(수량) × exp(Xβ). 과산포(φ) 추정
   * @param {number[][]} X @param {number[]} y @param {number[]} off */
  ST.poissonGLM = (X, y, off) => {
    const p = X[0].length; let b = new Array(p).fill(0); b[0] = Math.log((y.reduce((s, v) => s + v, 0) + 0.5) / off.reduce((s, v) => s + Math.exp(v), 0));
    for (let it = 0; it < 30; it++) {
      const XtWX = Array.from({ length: p }, () => new Array(p).fill(0)), XtWz = new Array(p).fill(0);
      X.forEach((x, i) => { const eta = off[i] + x.reduce((s, v, j) => s + v * b[j], 0), mu = Math.exp(eta), z = eta - off[i] + (y[i] - mu) / mu;
        for (let j = 0; j < p; j++) { XtWz[j] += x[j] * mu * z; for (let k = 0; k < p; k++) XtWX[j][k] += x[j] * mu * x[k]; } });
      for (let j = 1; j < p; j++) XtWX[j][j] += 1e-6;
      const nb = solve(XtWX, XtWz), d = Math.max(...nb.map((v, j) => Math.abs(v - b[j]))); b = nb; if (d < 1e-8) break;
    }
    const mus = X.map((x, i) => Math.exp(off[i] + x.reduce((s, v, j) => s + v * b[j], 0)));
    const chi = y.reduce((s, v, i) => s + (v - mus[i]) ** 2 / Math.max(mus[i], 1e-9), 0), phi = Math.max(1, chi / Math.max(1, y.length - p));
    const XtWX = Array.from({ length: p }, () => new Array(p).fill(0)); X.forEach((x, i) => { for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) XtWX[j][k] += x[j] * mus[i] * x[k]; });
    const cov = inv(XtWX).map(r => r.map(v => v * phi));
    return { beta: b, se: cov.map((r, j) => Math.sqrt(Math.max(0, r[j]))), phi, mu: mus, predict: (/** @type {number[]} */x, /** @type {number} */o) => Math.exp(o + x.reduce((s, v, j) => s + v * b[j], 0)) };
  };
  /** 음이항 P(Y > t) — 평균 mu, 과산포 φ(분산 = φ·mu). φ≈1 이면 포아송 @param {number} mu @param {number} phi @param {number} t */
  ST.nbTail = (mu, phi, t) => {
    const T = Math.floor(t); if (T < 0) return 1; if (mu <= 0) return 0;
    if (phi <= 1.0001) { let p = Math.exp(-mu), c = p; for (let k = 1; k <= T; k++) { p *= mu / k; c += p; } return Math.max(0, 1 - c); }
    const r = mu / (phi - 1), pr = r / (r + mu); let p = Math.pow(pr, r), c = p;
    for (let k = 1; k <= T; k++) { p *= (k - 1 + r) / k * (1 - pr); c += p; } return Math.max(0, Math.min(1, 1 - c));
  };
  /** 정규화 불완전 감마 P(a, x) (Numerical Recipes 급수 · 연분수) — 감마 분포 누적 확률 @param {number} a @param {number} x */
  ST.gammaP = (a, x) => {
    if (x <= 0) return 0; const gln = lgamma(a);
    if (x < a + 1) { let ap = a, sum = 1 / a, del = sum; for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; } return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - gln)); }
    let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d; for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break; }
    return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - gln) * h);
  };
  /** @param {number} z */
  function lgamma(z) { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z); z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x); }
  ST.lgamma = lgamma;
  /** 로그-로그 회귀 y = a·x^b — ln a, b 와 공분산 @param {number[]} x @param {number[]} y */
  ST.powerFit = (x, y) => {
    const pts = x.map((v, i) => [Math.log(v), Math.log(y[i])]).filter(p => isFinite(p[0]) && isFinite(p[1])), n = pts.length; if (n < 2) return null;
    const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1])), sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0) || 1e-9, sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
    const b = sxy / sxx, la = my - b * mx, res = pts.map(p => p[1] - la - b * p[0]), s2 = n > 2 ? res.reduce((s, v) => s + v * v, 0) / (n - 2) : 0.04;
    return { la, b, n, s2, cov: [[s2 * (1 / n + mx * mx / sxx), -s2 * mx / sxx], [-s2 * mx / sxx, s2 / sxx]] };
  };
  /** 2변량 정규 표본 @param {number[]} m @param {number[][]} C @param {() => number} r */
  ST.mvn2 = (m, C, r) => { const g = () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const l11 = Math.sqrt(Math.max(C[0][0], 1e-12)), l21 = C[1][0] / l11, l22 = Math.sqrt(Math.max(C[1][1] - l21 * l21, 1e-12)), z1 = g(), z2 = g(); return [m[0] + l11 * z1, m[1] + l21 * z1 + l22 * z2]; };
  /** 계층 베이즈 정규 축소: 사전(평균 m0, 분산 v0)과 관측(평균 m, 분산 v)을 정밀도로 가중 @param {number} m0 @param {number} v0 @param {number} m @param {number} v */
  ST.shrink = (m0, v0, m, v) => { const w0 = 1 / Math.max(v0, 1e-12), w = 1 / Math.max(v, 1e-12); return { m: (m0 * w0 + m * w) / (w0 + w), v: 1 / (w0 + w), w: w / (w0 + w) }; };
  /** 분할 컨포멀: 보정용 절대 오차의 (1-α)(1+1/n) 분위수 → 구간 ±q @param {number[]} absErr @param {number} alpha */
  ST.conformal = (absErr, alpha) => { const n = absErr.length; if (!n) return NaN; const k = Math.min(n, Math.ceil((n + 1) * (1 - alpha))); return absErr.slice().sort((x, y) => x - y)[k - 1]; };
  /** PSI (분포 변화 지수) — 기준 분위로 10칸 @param {number[]} base @param {number[]} cur */
  ST.psi = (base, cur, bins = 10) => { if (base.length < 5 || cur.length < 5) return NaN; const cuts = Array.from({ length: bins - 1 }, (_, i) => ST.q(base, (i + 1) / bins));
    const hist = x => { const h = new Array(bins).fill(0); x.forEach(v => { let k = 0; while (k < cuts.length && v > cuts[k]) k++; h[k]++; }); return h.map(c => Math.max(c / x.length, 1e-4)); };
    const a = hist(base), b = hist(cur); return a.reduce((s, p, i) => s + (b[i] - p) * Math.log(b[i] / p), 0); };
  /** Holt 이중 지수평활 @param {number[]} x @param {number} [al] @param {number} [be] */
  ST.holt = (x, al = 0.4, be = 0.2) => { if (x.length < 2) return null; let l = x[0], t = x[1] - x[0]; const fit = [], err = [];
    for (let i = 1; i < x.length; i++) { const f = l + t; fit.push(f); err.push(x[i] - f); const nl = al * x[i] + (1 - al) * (l + t); t = be * (nl - l) + (1 - be) * t; l = nl; }
    return { level: l, trend: t, next: l + t, sigma: Math.sqrt(mean(err.map(e => e * e))) || 0, fit }; };
  /** 두 조건의 불량 수(포아송) 차이를 검출하는 데 필요한 조건당 작업 수 @param {number} mu1 @param {number} mu2 @param {number} [alpha] @param {number} [power] */
  ST.poissonN = (mu1, mu2, alpha = 0.05, power = 0.8) => { const d = Math.abs(mu1 - mu2); if (!d) return Infinity; const z = ST.zOf(1 - alpha / 2) + ST.zOf(power); return Math.ceil(z * z * (mu1 + mu2) / (d * d)); };
})();
