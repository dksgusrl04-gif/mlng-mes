"""공통 기반 + 공정 모듈 데이터를 web/data/demo.json 하나로 묶는다.

  python build_demo.py            (먼저 build_heat.py 로 out/heat.json 을 만든다)

공통 기반 = 기준 정보(품목·설비·공정 순서·불량 코드·작업자) + 작업지시 + LOT + 이력 연결
"""
import json, os
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'web', 'data', 'demo.json')

# 데모 공장 — 받은 데이터 흐름에 맞춘 공정 순서. 아직 모듈이 없는 공정은 status='planned'
EQUIP = [
    dict(id='PR-01', name='프레스 #1', proc='press', line='A', status='live', meta=dict(zones='순차 이송 금형 · 취수 12 (데모 설정)')),
    dict(id='SP-01', name='점용접 로봇 #1', proc='weld', line='A', status='live', meta=dict(zones='보강판 부착 · 타점별 공정값 수집')),
    dict(id='SB-01', name='염욕 열처리로 #1', proc='heat', line='A', status='live',
         meta=dict(zones='세정 → 소입로 4존 → 솔트조 2존 → 컨베이어 → 건조로 2존')),
    dict(id='MC-01', name='MCT #1 (수직형 머시닝센터)', proc='mach', line='A', status='live', meta=dict(zones='정면 밀링 · 주축 전류·진동·AE 센서 · 공구 마모(VB) 관리')),
    dict(id='IN-01', name='정밀가공 검사 셀 #1', proc='insp', line='A', status='live', meta=dict(zones='부품별 가공 신호 수집 + 합격 판정 (가공 사양 부품)')),
]
ROUTING = [(10, 'press', '프레스 성형', 'PR-01'), (20, 'weld', '점용접', 'SP-01'), (30, 'heat', '염욕 소입 열처리', 'SB-01'),
           (40, 'mach', 'MCT 가공', 'MC-01'), (50, 'insp', '정밀가공 품질 검사', 'IN-01')]


def main():
    heat = json.load(open(os.path.join(HERE, 'out', 'heat.json'), encoding='utf-8'))
    pp = os.path.join(HERE, 'out', 'press.json')
    press = json.load(open(pp, encoding='utf-8')) if os.path.exists(pp) else None
    ip = os.path.join(HERE, 'out', 'insp.json')
    insp = json.load(open(ip, encoding='utf-8')) if os.path.exists(ip) else None
    wp, plp = os.path.join(HERE, 'out', 'weld.json'), os.path.join(HERE, 'out', 'plan.json')
    weld = json.load(open(wp, encoding='utf-8')) if os.path.exists(wp) else None
    plan = json.load(open(plp, encoding='utf-8')) if os.path.exists(plp) else None
    wday = {w['date']: w for w in (weld['lots'] if weld else [])}
    mp = os.path.join(HERE, 'out', 'mach.json')
    mach = json.load(open(mp, encoding='utf-8')) if os.path.exists(mp) else None
    lots = heat['lots']
    wos, mlots, plots, trace = [], {}, [], []
    fed = {}                                   # 열처리 날짜 → 그날 투입된 프레스 LOT
    if press:
        for p in press['lots']:
            fed[p['feeds']] = wday[p['date']]['id'] if p['date'] in wday else p['id']   # 점용접이 있는 날은 프레스 → 점용접 → 열처리
            wos.append(dict(id=f"WO-{p['date'][2:].replace('-', '')}-PR", item_code='CH-001', qty_plan=p['qty'], status='done', created_at=p['date']))
            plots.append(dict(id=p['id'], kind='process', proc='press', wo_id=f"WO-{p['date'][2:].replace('-', '')}-PR", item_code='CH-001', equipment_id='PR-01',
                              worker='', qty=p['qty'], good=p['qty'] - p['bad'], bad=p['bad'], start_at=p['date'], end_at=p['date']))
    pmat = {}
    for l in lots:
        wos.append(dict(id=l['wo'], item_code='CH-001', qty_plan=l['qty'], status='done', created_at=l['date']))
        m = mlots.setdefault(l['mat_lot'], dict(id=l['mat_lot'], kind='material', item_code='CH-001', qty=0, first=l['date'], last=l['date']))
        m['qty'] += l['qty']; m['last'] = l['date']
        plots.append(dict(id=l['id'], kind='process', proc='heat', wo_id=l['wo'], item_code='CH-001', equipment_id='SB-01',
                          worker=l['worker'], qty=l['qty'], good=l['good'], bad=l['bad'], start_at=l['start'], end_at=l['end']))
        if l['date'] in fed:                   # 소재 → 프레스 → 열처리
            pid = fed[l['date']]
            pmat.setdefault(pid, set()).add(l['mat_lot'])
            trace.append(dict(parent_lot=pid, child_lot=l['id'], qty=l['qty'], at=l['start']))
        else:                                  # 프레스 데이터 기간 밖: 소재 → 열처리
            trace.append(dict(parent_lot=l['mat_lot'], child_lot=l['id'], qty=l['qty'], at=l['start']))
    for w in (weld['lots'] if weld else []):
        wo = f"WO-{w['date'][2:].replace('-', '')}-WD"
        wos.append(dict(id=wo, item_code='CH-001', qty_plan=w['welds'], status='done', created_at=w['date']))
        plots.append(dict(id=w['id'], kind='process', proc='weld', wo_id=wo, item_code='CH-001', equipment_id='SP-01', worker='',
                          qty=w['welds'], good=None if w['bad'] is None else w['welds'] - w['bad'], bad=w['bad'], start_at=w['date'], end_at=w['date'] + ' 23:00'))
        pr = next((x for x in press['lots'] if x['date'] == w['date']), None)
        if pr:
            trace.append(dict(parent_lot=pr['id'], child_lot=w['id'], qty=None, at=w['date']))
            pmat.setdefault(pr['id'], set()).update(pmat.pop(w['id'], set()))
    for pid, ms in pmat.items():
        p = next(x for x in press['lots'] if x['id'] == pid)
        for m in sorted(ms): trace.append(dict(parent_lot=m, child_lot=pid, qty=None, at=p['date']))
    if plan:                                   # 기어 2품목 — 공급망 데이터의 일별 생산을 작업지시로
        for d_ in plan['days']:
            if d_['prod']:
                wos.append(dict(id=f"WO-{d_['date'][2:].replace('-', '')}-{d_['item'][-3:]}", item_code=d_['item'], qty_plan=d_['prod'], status='done', created_at=d_['date']))
    hdates_all = sorted(set(l['date'] for l in lots))
    if mach:                                   # 열처리 → MCT 가공 (공구 1개 = 작업일 1개)
        for t in mach['tools']:
            wo = f"WO-{t['date'][2:].replace('-', '')}-MC"
            qty = t['runs'] * mach['parts_per_run']
            rs = [r for r in mach['runs'] if r['tool'] == t['id']]
            wos.append(dict(id=wo, item_code='CH-001', qty_plan=qty, status='done', created_at=t['date']))
            plots.append(dict(id=t['lot'], kind='process', proc='mach', wo_id=wo, item_code='CH-001', equipment_id='MC-01', worker='',
                              qty=qty, good=None, bad=None, start_at=rs[0]['t'], end_at=rs[-1]['t'], tool=t['id']))
            prev = [d for d in hdates_all if d < t['date']]
            for l in lots:
                if prev and l['date'] == prev[-1]: trace.append(dict(parent_lot=l['id'], child_lot=t['lot'], qty=None, at=rs[0]['t']))
    if insp:                                   # 열처리 → MCT 가공 → 정밀가공 검사
        for g in insp['lots']:
            wo = f"WO-{g['date'][2:].replace('-', '')}-IN"
            wos.append(dict(id=wo, item_code='CH-001', qty_plan=g['parts'], status='done', created_at=g['date']))
            plots.append(dict(id=g['id'], kind='process', proc='insp', wo_id=wo, item_code='CH-001', equipment_id='IN-01', worker='',
                              qty=g['parts'], good=g['parts'] - g['fail'], bad=g['fail'], start_at=g['start'], end_at=g['end']))
            mprev = [t for t in (mach['tools'] if mach else []) if t['date'] < g['date']]
            pars = [mprev[-1]['lot']] if mprev else g['parents']
            g['parents'] = pars
            for par in pars: trace.append(dict(parent_lot=par, child_lot=g['id'], qty=None, at=g['start']))
    plots.sort(key=lambda x: (x['end_at'], x['id']))
    asof = max(l['end'] for l in lots)
    demo = dict(
        built=datetime.now().strftime('%Y-%m-%d %H:%M:%S'), asof=asof,
        factory=dict(name='MLNG 데모 공장', line='A 라인'),
        masters=dict(
            items=[dict(code='CH-001', name='시트 트랙 스토퍼 브래킷', spec='자동차 시트용 강판 브래킷 · 오스템퍼링', unit='EA')] + ([dict(i, unit='EA') for i in plan['items']] if plan else []),
            equipment=EQUIP,
            routings=[dict(item_code='CH-001', seq=s, proc=p, step_name=n, equipment_id=e) for s, p, n, e in ROUTING]
                     + ([dict(item_code=i['code'], seq=30, proc='heat', step_name='염욕 소입 열처리', equipment_id='SB-01') for i in plan['items']] if plan else []),
            defect_codes=(press['defect_codes'] if press else []) + (weld['defect_codes'] if weld else []) + heat['defect_codes'] + (insp['defect_codes'] if insp else []),
            workers=heat['workers']),
        work_orders=wos, lots=list(mlots.values()) + plots, trace=trace,
        heat={k: heat[k] for k in ('target_ppm', 'recipe', 'heaters', 'lots', 'profiles', 'rel', 'source')},
        press=press, insp=insp, weld=weld, plan=plan, mach=mach,
        alerts=[], inspections=[])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(demo, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'[완료] {OUT} ({os.path.getsize(OUT) / 1e6:.2f} MB) 작업지시 {len(wos)} · 소재 LOT {len(mlots)} · 기준 시각 {asof}')


if __name__ == '__main__':
    main()
