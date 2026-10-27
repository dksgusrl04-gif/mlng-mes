// MLNG MES 공용 타입 — 모듈 사이 API 의 모양. tsc --checkJs 로 검사하는 파일이 이 약속을 따른다.
interface MLNGStats {
  rng(seed: number): () => number; mean(x: number[]): number; var(x: number[]): number; sd(x: number[]): number; q(x: number[], q: number): number;
  phi(z: number): number; zOf(p: number): number;
  permTest(a: number[], b: number[], o?: { n?: number; seed?: number }): { diff: number; p: number };
  bootRatio(a: number[], b: number[], o?: { n?: number; seed?: number; level?: number }): { ratio: number; lo: number; hi: number };
  bh(ps: number[]): number[];
  changePoint(x: number[], o?: { min?: number; n?: number; seed?: number }): { i: number; before: number; after: number; p: number } | null;
  cusum(x: number[], o?: { base?: number; k?: number; h?: number }): { at: number; start: number; path: number[]; m: number; s: number };
  ewma(x: number[], o?: { lambda?: number; L?: number; base?: number }): { z: number[]; ucl: number[]; lcl: number[]; at: number; m: number; s: number };
  poissonGLM(X: number[][], y: number[], off: number[]): { beta: number[]; se: number[]; phi: number; mu: number[]; predict(x: number[], off: number): number };
  nbTail(mu: number, phi: number, t: number): number; gammaP(a: number, x: number): number; lgamma(z: number): number;
  powerFit(x: number[], y: number[]): { la: number; b: number; n: number; s2: number; cov: number[][] } | null;
  mvn2(m: number[], C: number[][], r: () => number): number[];
  shrink(m0: number, v0: number, m: number, v: number): { m: number; v: number; w: number };
  conformal(absErr: number[], alpha: number): number; psi(base: number[], cur: number[], bins?: number): number;
  holt(x: number[], al?: number, be?: number): { level: number; trend: number; next: number; sigma: number; fit: number[] } | null;
  poissonN(mu1: number, mu2: number, alpha?: number, power?: number): number;
  solve(A: number[][], b: number[]): number[]; inv(A: number[][]): number[][];
}
interface MLNGCore { st: MLNGStats; [k: string]: any }
interface Window { MLNG: MLNGCore; MLNGTrust: any; MLNG_BUILD?: { hash: string; files: Record<string, string> } }
