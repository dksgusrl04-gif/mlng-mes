"""MCT 가공 모듈 화면용 데이터 만들기 — NASA Ames / UC Berkeley Milling Data Set (공개 데이터)
입력 : mill.mat (1×167 구조체, 수직형 머시닝센터 Matsuura MC-510V 정면 밀링, 공구 16개(case)의 마모 시험)
       out/heat.json (데모 공장 흐름 — 열처리 작업일에 맞춰 잇는다)
출력 : out/mach.json

처리
  · 가공 1회(run)마다 6개 센서(주축 전류 AC/DC, 테이블·주축 진동, 테이블·주축 AE)의 RMS 계산
  · 값이 비정상(무한대·천문학적 크기·0)인 기록은 «센서 이상» 으로 분류
  · 플랭크 마모(VB)가 측정되지 않은 가공은 주축 전류 등 신호로 추정 (공구 단위 교차검증으로 오차 확인)
  · 공구(case) 1개 = 하루 작업, 16개 공구를 열처리 마지막 16작업일에 배치, 가공 1회 = 부품 25개 묶음 (데모 설정)
"""
import argparse, json, os
from datetime import datetime, timedelta
import numpy as np, pandas as pd, scipy.io as sio

SIG = [('smcAC', '주축 전류 AC'), ('smcDC', '주축 전류 DC'), ('vib_table', '테이블 진동'), ('vib_spindle', '주축 진동'), ('AE_table', '테이블 AE'), ('AE_spindle', '주축 AE')]
PARTS_PER_RUN = 25
MAT = {1: '주철', 2: '스테인리스강'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mat', required=True)
    ap.add_argument('--heat', default=os.path.join(os.path.dirname(__file__), 'out', 'heat.json'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'out', 'mach.json'))
    a = ap.parse_args()
    m = sio.loadmat(a.mat)['mill'][0]
    rows = []
    for r in m:
        g = lambda k: (np.array(r[k]).ravel()[0] if np.array(r[k]).size else np.nan)
        d = dict(case=int(g('case')), run=int(g('run')), VB=float(g('VB')), time=float(g('time')), DOC=float(g('DOC')), feed=float(g('feed')), material=int(g('material')))
        bad = False
        for s, _ in SIG:
            x = np.array(r[s]).ravel().astype(float)
            v = float(np.sqrt(np.mean(x ** 2))) if x.size and np.all(np.isfinite(x)) else np.nan
            if not np.isfinite(v) or v > 100 or v < 1e-3: bad = True
            d[s] = v
        d['sensor_bad'] = bad
        rows.append(d)
    df = pd.DataFrame(rows).sort_values(['case', 'run']).reset_index(drop=True)
    ok = df[~df.sensor_bad]

    # 신호로 마모 추정: VB ~ 주축 전류 DC·AC·테이블 AE + 가공 조건 (선형). 공구 단위로 빼고 검증
    X = lambda d: np.column_stack([np.ones(len(d)), d.smcDC, d.smcAC, d.AE_table, d.DOC, d.feed, (d.material == 2).astype(float), d.time])
    lab = ok.dropna(subset=['VB'])
    err = []
    for c in lab.case.unique():
        tr, te = lab[lab.case != c], lab[lab.case == c]
        w, *_ = np.linalg.lstsq(X(tr), tr.VB.values, rcond=None)
        err += list(np.abs(X(te) @ w - te.VB.values))
    w, *_ = np.linalg.lstsq(X(lab), lab.VB.values, rcond=None)
    df['VB_est'] = np.nan
    df.loc[~df.sensor_bad, 'VB_est'] = np.clip(X(ok) @ w, 0, None)
    # 공구 안에서는 측정값 사이를 시간으로 이어 «현재 마모» 를 만든다 (측정값 우선, 없으면 보간, 보간 불가면 신호 추정)
    df['VB_now'] = np.nan
    for c, g in df.groupby('case'):
        meas = g.dropna(subset=['VB'])
        if len(meas) >= 2:
            interp = np.interp(g.time, meas.time, meas.VB)
            df.loc[g.index, 'VB_now'] = np.where(g.VB.notna(), g.VB, np.where(g.time <= meas.time.max(), interp, g.VB_est))
        else:
            df.loc[g.index, 'VB_now'] = g.VB.fillna(g.VB_est)
    corr = {s: round(float(lab[[s, 'VB']].corr(method='spearman').iloc[0, 1]), 2) for s, _ in SIG}

    heat = json.load(open(a.heat, encoding='utf-8'))
    hdates = sorted(set(l['date'] for l in heat['lots']))
    cases = sorted(df.case.unique())
    day = dict(zip(cases, hdates[-len(cases):]))
    tools, runs = [], []
    for c in cases:
        g = df[df.case == c]; d0 = datetime.strptime(day[c], '%Y-%m-%d') + timedelta(hours=8)
        meas = g.dropna(subset=['VB'])
        slope = float(np.polyfit(meas.time, meas.VB, 1)[0]) if len(meas) >= 3 and meas.time.nunique() > 2 else None
        tools.append(dict(id=f'T{c:02d}', case=int(c), date=day[c], lot='MC-' + day[c][2:].replace('-', ''), runs=int(len(g)), minutes=float(g.time.max()),
                          DOC=float(g.DOC.iloc[0]), feed=float(g.feed.iloc[0]), material=MAT[int(g.material.iloc[0])],
                          vb_last=round(float(g.VB_now.iloc[-1]), 3) if pd.notna(g.VB_now.iloc[-1]) else None, vb_meas_max=round(float(meas.VB.max()), 3) if len(meas) else None,
                          rate=round(slope, 4) if slope else None, n_meas=int(len(meas)), sensor_bad=int(g.sensor_bad.sum())))
        for _, r in g.iterrows():
            runs.append(dict(tool=f'T{c:02d}', run=int(r.run), t=str(d0 + timedelta(minutes=float(r.time)))[:16], minute=float(r.time),
                             vb=None if pd.isna(r.VB) else round(float(r.VB), 3), vb_est=None if pd.isna(r.VB_est) else round(float(r.VB_est), 3),
                             vb_now=None if pd.isna(r.VB_now) else round(float(r.VB_now), 3), bad=bool(r.sensor_bad),
                             s={s: None if (r.sensor_bad or pd.isna(r[s])) else round(float(r[s]), 3) for s, _ in SIG}))
    # 조건별 마모 속도 (mm/분)
    tl = pd.DataFrame(tools)
    cond = tl.dropna(subset=['rate']).groupby(['material', 'DOC', 'feed']).agg(rate=('rate', 'mean'), n=('rate', 'size'), minutes=('minutes', 'mean')).reset_index()
    out = dict(parts_per_run=PARTS_PER_RUN, signals=[dict(key=s, label=l) for s, l in SIG], tools=tools, runs=runs,
               conditions=cond.round(4).to_dict('records'), corr=corr, est_mae=round(float(np.mean(err)), 3), n_bad=int(df.sensor_bad.sum()),
               machine='Matsuura MC-510V 수직형 머시닝센터 · 절삭속도 200 m/min (826 rpm) · 인서트 KC710',
               source='NASA Ames Prognostics Data Repository — Milling Data Set (A. Agogino, K. Goebel, UC Berkeley). 가공 1회 RMS 요약, 날짜는 데모 공장 흐름에 맞춰 배치')
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(a.out, f'{os.path.getsize(a.out) / 1e3:.0f} KB · 공구 {len(tools)} · 가공 {len(runs)} · 센서 이상 {out["n_bad"]} · 추정 오차 {out["est_mae"]} mm · 상관 {corr}')
    print(cond.round(4).to_string()); print(tl[['id', 'date', 'runs', 'minutes', 'material', 'DOC', 'feed', 'vb_last', 'rate', 'sensor_bad']].to_string())


if __name__ == '__main__':
    main()
