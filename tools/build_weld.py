"""용접(점용접) 모듈 화면용 데이터 만들기
입력 : 용접 웹(weldweb)의 web/data/demo.json — 점용접 Extra Trees LLP 결과 (타점별 위험·공정값, 안정 공정조건, 작업일별 실적)
       out/press.json (데모 공장 흐름 — 프레스 작업일에 맞춰 잇는다)
출력 : out/weld.json

제품 데모 원칙
  · 아크용접(Polito 데이터, CC BY-NC)은 상업 이용이 안 되므로 넣지 않는다
  · 점용접 9작업일(학습 8일 + 예측일 1일)을 프레스 마지막 9작업일에 맞춘다. 타점별 자료가 있는 예측일 = 마지막 날
  · 점용접은 보강 브래킷 부착 사양만 거친다 (수량이 프레스보다 작음)
"""
import argparse, json, os

KEEP = ['idx', 'force', 'current', 'voltage', 'weld_time', 'defect_prob', 'risk_ratio', 'uncertainty_sd', 'risk_tier', 'pred_defect', 'inspection_rank', 'out_of_control']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--weld', required=True, help='weldweb/web/data/demo.json')
    ap.add_argument('--press', default=os.path.join(os.path.dirname(__file__), 'out', 'press.json'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'out', 'weld.json'))
    a = ap.parse_args()
    w = json.load(open(a.weld, encoding='utf-8'))['spot']
    pdates = [l['date'] for l in json.load(open(a.press, encoding='utf-8'))['lots']]
    train = sorted(w['lodo'], key=lambda r: r['date'])
    days = pdates[-(len(train) + 1):]
    lots = []
    for r, d in zip(train, days[:-1]):
        lots.append(dict(id='WD-' + d[2:].replace('-', ''), date=d, welds=int(r['타점수']), bad=int(r['실제 불량수']), est=round(r['예측 불량수'], 1),
                         out_rate=round(r['범위 밖 비율'], 3), excursion=str(r['가압 이상 구간 포함']) == 'True', has_detail=False))
    s = w['summary']; d = days[-1]
    lots.append(dict(id='WD-' + d[2:].replace('-', ''), date=d, welds=int(s['welds']), bad=None, est=round(s['expected'], 1), ci=[round(x, 1) for x in s['ci']],
                     pred=int(s['pred_defect']), excursion=s['excursion'] > 0, has_detail=True,
                     out_rate=round(sum(p['out_of_control'] for p in w['preds']) / len(w['preds']), 3)))
    preds = [{k: p[k] for k in KEEP} for p in w['preds']]
    out = dict(lots=lots, preds=preds, windows=[{k: v for k, v in x.items() if k not in ('id', 'run_id', 'process')} for x in w['windows']],
               summary={k: s[k] for k in ('welds', 'expected', 'ci', 'tiers', 'pred_defect', 'excursion', 'base_rate', 'model')},
               types=[dict(name=t['데이터 유형'], n=t['건수'], top=t['주요 변수(상위 3)']) for t in w['types']],
               defect_codes=[dict(code='WD-' + c, name=n, proc='weld') for c, n in (('PT', '파임'), ('LF', '용접부족'), ('CR', '크랙'))],
               source='KAMP 경진대회 점용접 데이터 · Extra Trees LLP 예측 (타점 번호 유지, 날짜는 데모 공장 흐름에 맞춰 이동). 아크용접(Polito, CC BY-NC)은 상업 데모에서 제외')
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(a.out, f'{os.path.getsize(a.out) / 1e6:.2f} MB', [(l['id'], l['welds'], l['bad'], l['est']) for l in lots])


if __name__ == '__main__':
    main()
