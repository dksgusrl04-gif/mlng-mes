"""열처리 원본(초 단위, 약 300만 행)을 2분 요약으로 줄인다 — 데이터가 있는 PC 에서 실행.

  python device_heat_agg.py --src "Dataset_열처리 품질보증 AI 데이터셋/data/품질전처리후데이터.csv" --out _mlng_build

출력: heat_2min_mean/min/max/count.csv  (배정번호 × 2분 구간 × 변수)
→ build_heat.py 의 --agg 로 넘긴다.
"""
import argparse, os, time
import numpy as np, pandas as pd

VARS = ['소입로 온도 1 Zone', '소입로 온도 2 Zone', '소입로 온도 3 Zone', '소입로 온도 4 Zone', '소입로 CP 값', '솔트조 온도 1 Zone', '솔트조 온도 2 Zone',
        '솔트 컨베이어 온도 1 Zone', '솔트 컨베이어 온도 2 Zone', '건조로 온도 1 Zone', '건조로 온도 2 Zone', '세정기',
        '소입1존 OP', '소입2존 OP', '소입3존 OP', '소입4존 OP', '건조 1존 OP', '건조 2존 OP']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='_mlng_build')
    ap.add_argument('--encoding', default='cp949')
    a = ap.parse_args()
    t0, parts = time.time(), []
    for ch in pd.read_csv(a.src, chunksize=700000, encoding=a.encoding, usecols=['TAG_MIN', '배정번호'] + VARS):
        ch['b'] = pd.to_datetime(ch.TAG_MIN).dt.floor('2min')
        parts.append(ch.groupby(['배정번호', 'b'])[VARS].agg(['mean', 'min', 'max', 'count']))
    g = pd.concat(parts)
    # 청크 경계에서 같은 (배정번호, 2분) 칸이 나뉠 수 있어 다시 합친다
    m, c = g.xs('mean', axis=1, level=1), g.xs('count', axis=1, level=1)
    cc = c.groupby(level=[0, 1]).sum()
    mean = (m * c).groupby(level=[0, 1]).sum() / cc.replace(0, np.nan)
    os.makedirs(a.out, exist_ok=True)
    mean.to_csv(os.path.join(a.out, 'heat_2min_mean.csv'))
    g.xs('min', axis=1, level=1).groupby(level=[0, 1]).min().to_csv(os.path.join(a.out, 'heat_2min_min.csv'))
    g.xs('max', axis=1, level=1).groupby(level=[0, 1]).max().to_csv(os.path.join(a.out, 'heat_2min_max.csv'))
    cc.to_csv(os.path.join(a.out, 'heat_2min_count.csv'))
    print(f'[완료] {mean.shape[0]}구간 · {time.time() - t0:.0f}초 → {a.out}')


if __name__ == '__main__':
    main()
