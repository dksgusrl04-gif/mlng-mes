"""열처리 모듈 화면용 데이터 만들기
입력 : 연결 폴더에서 device_heat_agg.py 로 만든 2분 요약(평균·최소·최대·개수) + KAMP 라벨(label.xlsx)
출력 : out/heat.json  — 작업 배정(LOT)별 요약, 2분 프로파일, 공정 조건(레시피), 히터 출력 추이

제품 데모용 원칙
  - 원본 행은 넣지 않는다 (2분 평균·LOT 요약만)
  - 품번·품명·작업자·소재 LOT 은 데모용 코드로 바꾼다 (원 데이터 제공사 정보 노출 방지)
"""
import argparse, json, os
import numpy as np, pandas as pd

# 공정 조건 — 설정값과 허용 폭. 장입부(1존)는 차가운 부품이 들어올 때 온도가 내려가므로 폭을 넓게 둔다
RECIPE = [
    dict(key='wash', col='세정기', label='세정기', grp='세정', unit='°C', lo=60, hi=75, d=1),
    dict(key='hz1', col='소입로 온도 1 Zone', label='소입로 1존 (장입부)', grp='소입로', unit='°C', sp=860, tol=10, d=1),
    dict(key='hz2', col='소입로 온도 2 Zone', label='소입로 2존', grp='소입로', unit='°C', sp=860, tol=5, d=1),
    dict(key='hz3', col='소입로 온도 3 Zone', label='소입로 3존', grp='소입로', unit='°C', sp=860, tol=5, d=1),
    dict(key='hz4', col='소입로 온도 4 Zone', label='소입로 4존', grp='소입로', unit='°C', sp=860, tol=5, d=1),
    dict(key='cp', col='소입로 CP 값', label='탄소 포텐셜 (CP)', grp='소입로', unit='%C', sp=0.45, tol=0.03, d=3),
    dict(key='sb1', col='솔트조 온도 1 Zone', label='솔트조 1존', grp='솔트조', unit='°C', sp=332, tol=3, d=1),
    dict(key='sb2', col='솔트조 온도 2 Zone', label='솔트조 2존', grp='솔트조', unit='°C', sp=332, tol=3, d=1),
    dict(key='cv1', col='솔트 컨베이어 온도 1 Zone', label='솔트 컨베이어 1존', grp='컨베이어', unit='°C', d=1),
    dict(key='cv2', col='솔트 컨베이어 온도 2 Zone', label='솔트 컨베이어 2존', grp='컨베이어', unit='°C', d=1),
    dict(key='dr1', col='건조로 온도 1 Zone', label='건조로 1존', grp='건조로', unit='°C', sp=100, tol=3, d=1),
    dict(key='dr2', col='건조로 온도 2 Zone', label='건조로 2존', grp='건조로', unit='°C', sp=100, tol=3, d=1),
]
HEATERS = [('op1', '소입1존 OP', '소입로 1존'), ('op2', '소입2존 OP', '소입로 2존'), ('op3', '소입3존 OP', '소입로 3존'),
           ('op4', '소입4존 OP', '소입로 4존'), ('opd1', '건조 1존 OP', '건조로 1존'), ('opd2', '건조 2존 OP', '건조로 2존')]
DEFECTS = [('변형(폭)', 'HT-DF', '변형(폭)'), ('내폭', 'HT-IW', '내폭 치수'), ('외폭', 'HT-OW', '외폭 치수'), ('형상파손', 'HT-SH', '형상 파손'),
           ('경도', 'HT-HD', '경도'), ('인장경도', 'HT-TS', '인장 경도'), ('원소재', 'HT-RM', '원소재'), ('초도품', 'HT-FA', '초도품'),
           ('TEST', 'HT-TT', '시험'), ('경도측정', 'HT-HM', '경도 측정')]
TARGET_PPM = 450   # 원 데이터의 «안정/위험» 구분이 이 값에서 갈린다 (안정 최대 449, 위험 최소 456)


def lim(r):
    if 'sp' in r: return r['sp'] - r['tol'], r['sp'] + r['tol']
    if 'lo' in r: return r['lo'], r['hi']
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--agg', required=True, help='heat_2min_*.csv 가 있는 폴더')
    ap.add_argument('--label', required=True, help='label.xlsx')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'out', 'heat.json'))
    a = ap.parse_args()

    rd = lambda n: pd.read_csv(os.path.join(a.agg, f'heat_2min_{n}.csv'), parse_dates=['b'])
    m, mn, mx = rd('mean'), rd('min'), rd('max')
    lab = pd.read_excel(a.label).sort_values('작업일', kind='stable')

    # 데모용 코드
    workers = {w: f'작업자 {chr(65 + i)}' for i, w in enumerate(lab['작업자'].value_counts().index)}
    mats = {}
    for x in lab['LOT NO.']:
        mats.setdefault(x, f'M22-{len(mats) + 1:03d}')
    wo = lambda p: f"WO-{str(p)[3:9]}-{str(p)[-4:]}"   # W20220103050078 → WO-220103-0078

    recipe = [{k: v for k, v in r.items() if k != 'col'} for r in RECIPE]
    lots, profiles = [], {}
    for _, L in lab.iterrows():
        jid = int(L['배정번호'])
        g = m[m['배정번호'] == jid].sort_values('b')
        gn, gx = mn[mn['배정번호'] == jid].set_index('b'), mx[mx['배정번호'] == jid].set_index('b')
        stats = {}
        for r in RECIPE:
            x = g[r['col']].astype(float)
            s = dict(mean=round(float(x.mean()), r['d'] + 1), std=round(float(x.std()), r['d'] + 1),
                     min=round(float(gn[r['col']].min()), r['d']), max=round(float(gx[r['col']].max()), r['d']))
            b = lim(r)
            if b: s['out'] = round(float(((x < b[0]) | (x > b[1])).mean()), 4)
            stats[r['key']] = s
        heat = {k: round(float(g[c].mean()), 2) for k, c, _ in HEATERS}
        defects = {code: int(L[col]) for col, code, _ in DEFECTS if int(L[col])}
        tot, bad = int(L['총수량']), int(L['불량수량'])
        lots.append(dict(id=f'HT-{jid}', job=jid, wo=wo(L['계획번호']), date=str(L['작업일'].date()),
                         start=str(g['b'].min())[:16], end=str(g['b'].max() + pd.Timedelta(minutes=2))[:16],
                         dur_h=round(len(g) * 2 / 60, 2), item='CH-001', mat_lot=mats[L['LOT NO.']], worker=workers[L['작업자']],
                         equip='SB-01', qty=tot, good=int(L['양품수량']), bad=bad, ppm=round(bad / tot * 1e6, 1) if tot else None,
                         defects=defects, stats=stats, heater=heat))
        ser = {}
        for r in RECIPE:
            if r['key'] in ('cv1', 'cv2'): continue
            ser[r['key']] = [None if pd.isna(v) else round(float(v), r['d']) for v in g[r['col']]]
        profiles[f'HT-{jid}'] = dict(t0=str(g['b'].min())[:16], step=2, s=ser)

    # 불량률과 함께 움직인 조건 (LOT 단위 순위상관) — 참고용
    df = pd.DataFrame([{**{f"{k}_std": l['stats'][k]['std'] for k in l['stats']}, **{f"{k}_out": l['stats'][k].get('out') for k in l['stats']},
                        'ppm': l['ppm']} for l in lots])
    rel = []
    for c in df.columns:
        if c == 'ppm' or df[c].nunique() < 5: continue
        rho = df[c].corr(df['ppm'], method='spearman')
        if pd.notna(rho): rel.append(dict(feat=c, rho=round(float(rho), 3)))
    rel = sorted(rel, key=lambda r: -abs(r['rho']))[:6]

    out = dict(target_ppm=TARGET_PPM, recipe=recipe,
               heaters=[dict(key=k, label=lbl) for k, _, lbl in HEATERS],
               defect_codes=[dict(code=c, name=n, proc='heat') for _, c, n in DEFECTS],
               workers=[dict(id=f'W{i + 1:02d}', name=n) for i, n in enumerate(workers.values())],
               lots=lots, profiles=profiles, rel=rel,
               source='KAMP 열처리 품질보증·공정최적화 AI 데이터셋 (2분 평균·LOT 요약으로 가공, 품번·작업자·소재 LOT 비식별)')
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{a.out}  LOT {len(lots)}  {os.path.getsize(a.out) / 1e6:.2f} MB')
    print('rel', rel)


if __name__ == '__main__':
    main()
