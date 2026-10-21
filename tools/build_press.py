"""프레스 모듈 화면용 데이터 만들기
입력 : KAMP 프레스 데이터셋(Press_RawDataSet.xlsx · Press_error.xlsx)
       KAMP 소성가공 예지보전 데이터셋(press_data_normal.csv · outlier_data.csv)
       out/heat.json (열처리 작업 날짜에 맞춰 데모 공장의 공정 흐름을 잇는다)
출력 : out/press.json

데모 공장 구성 (제품 데모용 — 데이터 상태 화면에 밝힌다)
  · 서로 다른 공개 데이터를 한 공장 흐름으로 묶기 위해 프레스 18작업일을 열처리 마지막 18작업일의 전날로 옮긴다
  · 타발 1회 = 부품 12개 (취수 12, 데모 설정) → 열처리 수량과 규모를 맞춘다
  · 원본 타발 행은 넣지 않는다 (20타발 평균 · 일별 요약만)
"""
import argparse, json, os
from datetime import datetime, timedelta
import numpy as np, pandas as pd

CAV = 12
BIN = 20
VARS = [('ptime', 'Press time(ms)', '타발 시간', 'ms', 1), ('p1', 'Pressure 1', '압력 1', '', 1),
        ('p2', 'Pressure 2', '압력 2', '', 1), ('p5', 'Pressure 5', '압력 합계', '', 1)]
TOL = {'ptime': 5.0, 'p1': 3.0, 'p2': 3.0, 'p5': 6.0}           # 허용 폭 (데모 설정 — 관리자가 바꿈)
DEFECTS = {1: ('PR-WR', '주름'), 2: ('PR-SP', '터짐'), 3: ('PR-BR', '버')}


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--press', required=True, help='07. Dataset_Press/dataset 폴더')
    ap.add_argument('--pdm', required=True, help='소성가공 예지보전 data 폴더')
    ap.add_argument('--heat', default=os.path.join(os.path.dirname(__file__), 'out', 'heat.json'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'out', 'press.json'))
    a = ap.parse_args()

    raw = pd.read_excel(os.path.join(a.press, 'Press_RawDataSet.xlsx'))
    # 엑셀에서 날짜가 깨진 행이 있다 → 타발 번호(idx)가 1로 돌아가는 곳을 작업일 경계로 보고, 그 묶음의 정상 날짜를 쓴다
    raw['wt'] = raw['working time'].astype(str)
    raw['blk'] = (raw['idx'].diff() < 0).cumsum()
    good = raw['wt'].str.match(r'\d{4}-\d\d-\d\d') & raw['wt'].str.startswith('2020-05')
    day_of_blk = raw[good].groupby('blk')['wt'].first().str[:10]
    raw['day'] = raw['blk'].map(day_of_blk)
    # 같은 날짜가 여러 묶음에 걸치면(첫날 중간 정지) 한 날로 합친다
    days = sorted(raw['day'].dropna().unique())

    heat = json.load(open(a.heat, encoding='utf-8'))
    hdates = sorted(set(l['date'] for l in heat['lots']))[-len(days):]
    shift = {d: (datetime.strptime(h, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d') for d, h in zip(days, hdates)}
    feeds = dict(zip(days, hdates))

    err = pd.read_excel(os.path.join(a.press, 'Press_error.xlsx'))
    err['day'] = err['working time'].astype(str).str[:10]

    # 압력 2 설정 변경 찾기: 일 평균이 앞뒤로 가장 크게 갈리는 날
    dm = raw.groupby('day')['Pressure 2'].mean().reindex(days)
    best, cut = 0, None
    for i in range(2, len(days) - 2):
        d = abs(dm.iloc[:i].mean() - dm.iloc[i + 1:].mean())
        if d > best: best, cut = d, i
    sp2_old, sp2_new = round(float(dm.iloc[:cut].median())), round(float(dm.iloc[cut + 1:].median()))
    change_day = days[cut]
    recipe_hist = [dict(key='p2', from_=shift[days[0]], sp=sp2_old), dict(key='p2', from_=shift[change_day], sp=sp2_new, note='설정 변경 감지')]
    sp = {'ptime': 550.0, 'p1': 275.0, 'p5': None}

    lots, series = [], {}
    for d in days:
        g = raw[raw['day'] == d].reset_index(drop=True)
        s2 = sp2_old if d < change_day else sp2_new
        sp_d = dict(ptime=550.0, p1=275.0, p2=float(s2), p5=275.0 + s2)
        stats = {}
        for k, col, _, _, dd in VARS:
            x = g[col].astype(float)
            lo, hi = sp_d[k] - TOL[k], sp_d[k] + TOL[k]
            sd = float(x.std())
            cpk = min(hi - x.mean(), x.mean() - lo) / (3 * sd) if sd > 0 else None
            stats[k] = dict(mean=round(float(x.mean()), 2), std=round(sd, 3), min=round(float(x.min()), 1), max=round(float(x.max()), 1),
                            sp=sp_d[k], out=int(((x < lo) | (x > hi)).sum()), cpk=None if cpk is None else round(float(cpk), 2))
        de = err[err['day'] == d]
        defects = {DEFECTS[int(t)][0]: int(n) for t, n in zip(de['defect type'], de['defect']) if int(n)}
        bad, strokes = sum(defects.values()), len(g)
        pid = 'PR-' + shift[d].replace('-', '')[2:]
        lots.append(dict(id=pid, date=shift[d], strokes=strokes, qty=strokes * CAV, bad=bad, ppm=round(bad / (strokes * CAV) * 1e6, 1),
                         defects=defects, stats=stats, feeds=feeds[d], changeover=(d == change_day), equip='PR-01', item='CH-001'))
        nb = int(np.ceil(strokes / BIN))
        series[pid] = {k: [round(float(g[col].iloc[i * BIN:(i + 1) * BIN].mean()), 2) for i in range(nb)] for k, col, *_ in VARS}

    # 설비 진동·전류 (1초 RMS). 정상 기록으로 기준선을 잡고 이상 구간과 비교한다
    def sec(path):
        df = pd.read_csv(path, parse_dates=['TimeStamp'])
        df['s'] = df['TimeStamp'].dt.floor('1s')
        g = df.groupby('s').agg(v0=('AI0_Vibration', rms), v1=('AI1_Vibration', rms), c=('AI2_Current', rms))
        return g
    nrm, out = sec(os.path.join(a.pdm, 'press_data_normal.csv')), sec(os.path.join(a.pdm, 'outlier_data.csv'))
    base = {k: dict(p50=round(float(nrm[k].median()), 3), p99=round(float(nrm[k].quantile(0.99)), 3)) for k in ('v0', 'v1', 'c')}
    nrm10 = nrm.resample('10s').mean().dropna()
    events = []
    o = out.copy(); o['hit'] = (o['v0'] > base['v0']['p99']) | (o['v1'] > base['v1']['p99'])
    if o['hit'].any():
        hit = o[o['hit']]
        events.append(dict(equip='PR-01', start=str(hit.index.min())[:19], end=str(hit.index.max())[:19], secs=int(hit.shape[0]),
                           v0_max=round(float(out['v0'].max()), 3), v1_max=round(float(out['v1'].max()), 3), c_max=round(float(out['c'].max()), 1),
                           ratio=round(float(out['v0'].max() / base['v0']['p99']), 1)))
    vib = dict(base=base, normal=dict(t0=str(nrm10.index.min())[:19], step=10, v0=[round(float(v), 3) for v in nrm10['v0']], v1=[round(float(v), 3) for v in nrm10['v1']]),
               event=dict(t0=str(out.index.min())[:19], t=[str(t)[11:19] for t in out.index], v0=[round(float(v), 3) for v in out['v0']], v1=[round(float(v), 3) for v in out['v1']]),
               events=events)

    recipe = [dict(key=k, label=lbl, unit=u, d=dd, sp=sp_d_k, tol=TOL[k]) for (k, _, lbl, u, dd), sp_d_k in
              zip(VARS, [550.0, 275.0, float(sp2_new), 275.0 + sp2_new])]
    out_ = dict(cav=CAV, bin=BIN, recipe=recipe, recipe_hist=[{('from' if kk == 'from_' else kk): vv for kk, vv in r.items()} for r in recipe_hist],
                defect_codes=[dict(code=c, name=n, proc='press') for c, n in DEFECTS.values()],
                lots=lots, series=series, vib=vib,
                source='KAMP 프레스·소성가공 예지보전 AI 데이터셋 (20타발 평균·일별 요약, 진동 1초 RMS로 가공. 날짜는 데모 공장 흐름에 맞춰 이동)')
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out_, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{a.out} {os.path.getsize(a.out) / 1e6:.2f} MB · 작업일 {len(lots)} · 압력2 설정 {sp2_old}→{sp2_new} ({shift[change_day]}) · 이벤트 {events}')
    for l in lots: print(l['id'], l['date'], '→', l['feeds'], l['strokes'], l['bad'], l['ppm'], {k: v['cpk'] for k, v in l['stats'].items()}, {k: v['out'] for k, v in l['stats'].items()})


if __name__ == '__main__':
    main()
