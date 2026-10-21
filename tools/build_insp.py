"""정밀가공·검사 모듈 화면용 데이터 만들기
입력 : KAMP 정밀가공 품질보증 AI 데이터셋 (부품 번호별 가공 신호 요약 + 합격/불합격)
       out/heat.json (데모 공장 흐름 — 앞 공정 열처리 LOT 과 잇는다)
출력 : out/insp.json

데모 공장 구성 (데이터 상태 화면에 밝힌다)
  · 검사 3일(2022-08-23~25)을 일정한 간격만큼 앞당겨 열처리 마지막 날(07-19)에 끝나게 맞춘다
  · 하루 검사분 = 공정 LOT 1개, 앞 LOT = 검사일 전 마지막 열처리 작업일의 LOT 들
  · 부품 번호는 그대로 쓰지 않고 데모 번호(CH-YYMMDD-NNNN)로 바꾼다
"""
import argparse, json, os
from datetime import timedelta
import numpy as np, pandas as pd

SIG = [('SpindleSpeed_max', 'spd_max', '주축 최고 회전수', 'rpm', 1), ('SpindleSpeed_mean', 'spd_mean', '주축 평균 회전수', 'rpm', 0),
       ('SpindleLoad_max', 'sload_max', '주축 최대 부하', '', 0), ('SpindleLoad_mean', 'sload_mean', '주축 평균 부하', '', 0),
       ('ServoCurrent_X_mean', 'x_cur', 'X축 평균 전류', '', 1), ('ServoCurrent_X_std', 'x_cur_sd', 'X축 전류 변동', '', 1),
       ('ServoCurrent_Z1_mean', 'z1_cur', 'Z1축 평균 전류', '', 1), ('ServoLoad_Z3_max', 'z3_load', 'Z3축 최대 부하', '', 0)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True)
    ap.add_argument('--heat', default=os.path.join(os.path.dirname(__file__), 'out', 'heat.json'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'out', 'insp.json'))
    a = ap.parse_args()
    q = pd.read_csv(a.csv, parse_dates=['ReceivedDateTime']).sort_values(['ReceivedDateTime', 'passorfail'], kind='stable').reset_index(drop=True)
    heat = json.load(open(a.heat, encoding='utf-8'))
    hl = heat['lots']
    last_end = pd.Timestamp(max(l['end'] for l in hl))
    # 마지막 검사 날짜가 열처리 마지막 날과 같아지도록 날짜 단위로 앞당긴다 (시각은 그대로)
    off = (q['ReceivedDateTime'].max().normalize() - last_end.normalize()).days
    q['t'] = q['ReceivedDateTime'] - timedelta(days=off)
    # 데이터 점검: 변하지 않는 신호, 같은 번호·같은 시각에 합격·불합격이 함께 있는 기록
    const = [c for c in q.columns if c.startswith(('Servo', 'Spindle')) and q[c].std() < 1e-9]
    stuck_axes = sorted({c.split('_')[1] for c in const if c.split('_')[1] in ('Z2',)})
    dup = q.groupby(['SerialNo', 'ReceivedDateTime'])['passorfail'].agg(['nunique', 'size'])
    conflict = set(dup[dup['nunique'] > 1].index.get_level_values(0))
    # 데모 번호
    ser = {}
    for s, t in zip(q['SerialNo'], q['t']):
        if s not in ser:
            d = t.strftime('%y%m%d'); n = sum(1 for v in ser.values() if v[3:9] == d) + 1
            ser[s] = f'CH-{d}-{n:04d}'
    hdates = sorted(set(l['date'] for l in hl))
    recs = []
    for _, r in q.iterrows():
        recs.append(dict(sn=ser[r['SerialNo']], t=str(r['t'])[:19], lot='IN-' + r['t'].strftime('%y%m%d'), ok=int(r['passorfail']) == 0,
                         conflict=r['SerialNo'] in conflict, s={k: round(float(r[c]), dd) for c, k, _, _, dd in SIG}))
    lots = []
    for lot, g in pd.DataFrame(recs).groupby('lot'):
        day = '20' + lot[3:5] + '-' + lot[5:7] + '-' + lot[7:9]
        prev = max(d for d in hdates if d < day)
        ct = pd.to_datetime(g['t']).diff().dt.total_seconds()
        lots.append(dict(id=lot, date=day, start=g['t'].min()[:16], end=g['t'].max()[:16], parts=int(g['sn'].nunique()), recs=len(g),
                         fail=int((~g['ok']).sum()), conflict=int(g[g['conflict']]['sn'].nunique()),
                         cycle_s=round(float(ct[(ct > 0) & (ct < 600)].median()), 1), parents=[l['id'] for l in hl if l['date'] == prev]))
    # 신호 비교: 합격/불합격 기록, 그리고 같은 번호 짝끼리
    df = q.copy()
    sig = []
    for c, k, lbl, u, dd in SIG:
        p, f_ = df.loc[df.passorfail == 0, c], df.loc[df.passorfail == 1, c]
        pair = df[df.SerialNo.isin(conflict)].pivot_table(index='SerialNo', columns='passorfail', values=c)
        sig.append(dict(key=k, label=lbl, unit=u, d=dd, pass_med=round(float(p.median()), dd), fail_med=round(float(f_.median()), dd),
                        effect=round(float((f_.mean() - p.mean()) / df[c].std()), 2), pair_diff=round(float((pair[1] - pair[0]).median()), dd),
                        pass_q=[round(float(x), dd) for x in p.quantile([.05, .25, .5, .75, .95])], fail_q=[round(float(x), dd) for x in f_.quantile([.05, .25, .5, .75, .95])]))
    out = dict(signals=[dict(key=k, label=l, unit=u, d=d) for _, k, l, u, d in SIG], records=recs, lots=lots, compare=sig,
               checks=dict(conflict=len(conflict), stuck=stuck_axes, stuck_cols=len([c for c in const if '_Z2_' in c]), const_value=float(q['ServoCurrent_Z2_max'].iloc[0])),
               defect_codes=[dict(code='IN-NG', name='가공 품질 불합격', proc='insp')],
               source='KAMP 정밀가공 품질보증 AI 데이터셋 (부품별 가공 신호 요약·판정, 부품 번호 비식별. 날짜는 데모 공장 흐름에 맞춰 이동)')
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(a.out, f'{os.path.getsize(a.out) / 1e6:.2f} MB', '이동', off, '일', [(l['id'], l['parts'], l['recs'], l['fail'], l['conflict'], l['cycle_s'], l['parents']) for l in lots], out['checks'])
    for s in sig: print(s['label'], s['pass_med'], s['fail_med'], s['effect'], s['pair_diff'])


if __name__ == '__main__':
    main()
