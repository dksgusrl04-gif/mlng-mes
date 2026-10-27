"""데모 데이터 스키마 · 일관성 검사 — python tests/test_data.py
tools/build_*.py 가 원본을 다시 만들었을 때 화면이 조용히 틀어지는 것을 막는다."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = json.load(open(os.path.join(ROOT, 'web', 'data', 'demo.json'), encoding='utf-8'))
fails, n = [], 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


for k in ['built', 'asof', 'factory', 'masters', 'work_orders', 'lots', 'trace', 'heat', 'press', 'weld', 'mach', 'insp', 'plan']:
    check(k in D, f'최상위 키 없음: {k}')
ids = [l['id'] for l in D['lots']]
check(len(ids) == len(set(ids)), 'LOT id 중복')
S = set(ids)
bad_trace = [t for t in D['trace'] if t['parent_lot'] not in S or t['child_lot'] not in S]
check(not bad_trace, f'LOT 이력이 없는 LOT 을 가리킴 {len(bad_trace)}건')
for l in D['heat']['lots']:
    check(0 <= l['bad'] <= l['qty'], f"{l['id']} 불량 > 수량")
    check(abs(l['ppm'] - (l['bad'] / l['qty'] * 1e6 if l['qty'] else 0)) < 1, f"{l['id']} PPM 불일치")
    check(l['start'] <= l['end'], f"{l['id']} 시작 > 종료")
for l in D['press']['lots']:
    check(abs(l['ppm'] - l['bad'] / l['qty'] * 1e6) < 1, f"{l['id']} 프레스 PPM 불일치")
    check(all(s.get('cpk') is None or s['cpk'] > -5 for s in l['stats'].values()), f"{l['id']} Cpk 이상")
tools = {t['id'] for t in D['mach']['tools']}
check(all(r['tool'] in tools for r in D['mach']['runs']), '가공 기록이 없는 공구를 가리킴')
check(all(r['vb'] is None or 0 <= r['vb'] < 3 for r in D['mach']['runs']), 'VB 범위 이상')
check(all(set(['sn', 't', 'lot', 'ok']).issubset(r) for r in D['insp']['records']), '검사 기록 필드 누락')
eqs = {e['id'] for e in D['masters']['equipment']}
check(all(r['equipment_id'] in eqs for r in D['masters']['routings']), '라우팅 설비 누락')
check(D['asof'] >= max(l['end'] for l in D['heat']['lots'])[:16], '기준 시각이 마지막 작업보다 이름')
if fails:
    print('\n'.join('✕ ' + f for f in fails)); print(f'data ✕ {len(fails)}/{n} 실패'); sys.exit(1)
print(f'data ✓ {n}개 통과')
