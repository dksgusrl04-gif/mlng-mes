/* 4.0 ⑥ 판단 증명 — 어떤 데이터 · 어떤 모델 · 어떤 코드가 이 판단을 했는가
 * ───────────────────────────────────────────────────────────────
 * 보류 · 출하 · 사건 조치 · 에이전트 실행 · 계획 적용 같은 판단마다
 *   입력 데이터 해시 (판단에 쓴 값만 정규화해서 SHA-256) · 모델 버전 · 코드 빌드 해시(build.js) · 결과 해시
 * 를 묶어 우리 서명으로 신뢰 원장에 남긴다. 「재현」 은 저장한 입력으로 지금 코드가 같은 결과를 내는지 다시 계산해 확인한다.
 * 입력 스냅샷과 재계산 함수는 화면 안에 두고, 원장에는 해시만 (원본 데이터는 나가지 않는다).
 */
(function () {
  'use strict';
  const M = window.MLNG, T = window.MLNGTrust;
  const PV = M.prove = { log: [] };
  const REDO = {};
  let seq = 0;
  PV.code = () => (window.MLNG_BUILD || {}).hash || 'dev-build';
  PV.hash = o => T.sha256js(T.canon(o === undefined ? null : o));
  /** @param {{kind:string, ref:string, title:string, model?:string, inputs:any, output:any, redo?:(inputs:any)=>any, now?:()=>any}} d */
  PV.record = async d => {
    const rec = { id: `DP-${String(++seq).padStart(4, '0')}`, at: T.stamp(), kind: d.kind, ref: d.ref, title: d.title, model: d.model || '규칙', data: PV.hash(d.inputs), out: PV.hash(d.output), code: PV.code(), view: d.output };
    REDO[rec.id] = { inputs: JSON.parse(JSON.stringify(d.inputs === undefined ? null : d.inputs)), redo: d.redo, now: d.now };
    PV.log.unshift(rec);
    const e = await T.append('MLNG', 'decision', d.ref, `${d.title} [모델 ${rec.model} · 데이터 ${rec.data.slice(0, 8)} · 코드 ${rec.code.slice(0, 8)}]`.slice(0, 200), { id: rec.id, kind: rec.kind, model: rec.model, data: rec.data, out: rec.out, code: rec.code });
    rec.seq = e.seq; return rec;
  };
  /** 재현: 저장한 입력 → 지금 코드로 다시 계산 → 결과 해시 비교. now() 가 있으면 지금 데이터로 입력을 다시 만들어 데이터가 그때와 같은지도 본다 */
  PV.replay = id => {
    const r = PV.log.find(x => x.id === id), x = REDO[id]; if (!r || !x) return null;
    let out = null, err = null; try { out = x.redo ? x.redo(x.inputs) : null; } catch (e) { err = e.message; }
    let dataNow = null; try { dataNow = x.now ? PV.hash(x.now()) : null; } catch (e) { /* 지금 데이터로 못 만듦 */ }
    return { rec: r, can: !!x.redo, same: out != null && PV.hash(out) === r.out, out, err, dataSame: dataNow == null ? null : dataNow === r.data, codeSame: PV.code() === r.code };
  };
  PV.canReplay = id => !!(REDO[id] && REDO[id].redo);
})();
