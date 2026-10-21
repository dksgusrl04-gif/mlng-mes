"""생산 계획 화면용 데이터 만들기
입력 : KAMP 열처리 공급망최적화 AI 데이터셋 data.csv (시각·품목·생산필요량·재고·생산량·수주량)
출력 : out/plan.json

데모 공장 구성
  · 품목 GEAR_21 / GEAR_42 → 데모 품목 GR-021 기어 A / GR-042 기어 B (염욕 열처리로 SB-01 의 두 번째 제품군)
  · 날짜는 마지막 날이 열처리 데이터 마지막 날(07-19)이 되게 같은 일수만큼 옮긴다
"""
import argparse, json, os
import pandas as pd

ITEMS = {'GEAR_21': ('GR-021', '기어 A'), 'GEAR_42': ('GR-042', '기어 B')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True)
    ap.add_argument('--end', default='2022-07-19', help='옮긴 뒤 마지막 날짜')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'out', 'plan.json'))
    a = ap.parse_args()
    d = pd.read_csv(a.csv, encoding='utf-8-sig')
    d['t'] = pd.to_datetime(d['시간'], format='%Y.%m.%d %H:%M')
    off = pd.Timestamp(a.end) - d['t'].max().normalize()
    d['t'] = d['t'] + off
    d['item'] = d['품목'].map(lambda x: ITEMS[x][0])
    d = d.sort_values(['t', 'item'])
    events = [dict(t=str(r.t)[:16], item=r['item'], need=int(r['생산필요량']), inv=int(r['재고']), prod=int(r['생산량']), order=int(r['수주량'])) for _, r in d.iterrows()]
    days = []
    for (day, item), g in d.groupby([d['t'].dt.strftime('%Y-%m-%d'), 'item']):
        days.append(dict(date=day, item=item, order=int(g['수주량'].iloc[0]), need=int(g['생산필요량'].sum()), prod=int(g['생산량'].sum()),
                         inv_open=int(g['재고'].iloc[0]), inv_close=int(g['재고'].iloc[-1]), inv_min=int(g['재고'].min()),
                         zero_at=(str(g.loc[g['재고'] == 0, 't'].iloc[0])[11:16] if (g['재고'] == 0).any() else None), runs=int((g['생산량'] > 0).sum())))
    out = dict(items=[dict(code=c, name=n, spec='공급망 데이터 품목 (데모)') for c, n in ITEMS.values()], days=days, events=events,
               source='KAMP 열처리 공급망최적화 AI 데이터셋 (품목명 데모 코드, 날짜 이동)')
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    z = [x for x in days if x['zero_at']]
    print(a.out, f'{os.path.getsize(a.out) / 1e6:.2f} MB', '이동', off.days, '일 ·', len(days), '품목일 · 재고 0 도달', len(z), z[-3:])


if __name__ == '__main__':
    main()
