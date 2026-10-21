# MLNG MES — 공정별 모듈 + 공통 기반

공정마다 모듈을 만들고, **기준 정보·작업지시·LOT 이력·알림·검사**는 모든 모듈이 같이 쓰는 구조다.
지금 들어 있는 모듈: **생산 계획·작업지시**, 공정 **프레스 → 점용접 → 열처리 → 정밀가공 검사** (LOT 으로 이어짐). MCT 가공은 NASA 공개 밀링 데이터로 모듈화 (공정 6개 모두 연결). 용접 웹·MCT MES 는 별도 시스템으로 두고 공정 흐름에서 링크로 잇는다.

자세한 설계: `docs/설계.md`

## 바로 보기
- 웹: https://dksgusrl04-gif.github.io/mlng-mes/ (GitHub Pages, 로그인 없음)
- 파일: `preview.html` 더블클릭 → 데모 데이터로 모든 화면이 열린다 (인터넷·Supabase 필요 없음)

## 배포·Supabase
- GitHub Pages: 저장소 Settings → Pages → Branch `main` / `(root)`. 루트 `index.html` 이 `web/` 으로 넘겨 준다
- Supabase: **MLNG 전용 새 프로젝트** (MCT MES 프로젝트와 섞지 않는다)
  1. SQL Editor 에 `supabase/new_project_setup.sql` 전체를 붙여 넣고 Run (표 29개 + 로그인 없는 anon 읽기 권한)
  2. Project Settings → API 의 URL·anon 키를 `web/js/config.js` 에 넣고 push
- 표가 비어 있는 동안은 데모 스냅샷을 그대로 보여 준다. «데이터 상태» 화면에서 연결 상태를 확인할 수 있다
- 로그인이 없어서 anon 키로 읽기 + 검사 기록·작업지시 초안 «추가» 만 열려 있다 (수정·삭제 불가)

## 폴더
```
mlng-mes/
├─ preview.html            한 파일 데모
├─ web/                    정적 웹 (배포할 폴더 — 지금은 배포하지 않음)
│  ├─ index.html
│  ├─ css/style.css        MLNG 테마 (라이트/다크)
│  ├─ js/config.js         비우면 데모 모드 · 운영 기준(불량률 기준, 이탈 비율, 히터 출력 변화)
│  ├─ js/data.js           데모/실시간 데이터 층
│  ├─ js/core.js           공용 화면 틀 — 메뉴·알림·표·그림·상세 서랍·검사 기록·테마
│  ├─ js/mod_common.js     공장 현황 · 통합 알림 · 작업지시·LOT 이력 · 기준 정보 · 데이터 상태
│  ├─ js/mod_line.js       라인 운영 (공정 간 수급·병목·속도 조정)
│  ├─ js/mod_plan.js       계획 모듈 (생산 계획 · 작업지시)
│  ├─ js/mod_press.js      프레스 모듈 (현황 · 타발 실적 · 공정 조건 · 설비 진단)
│  ├─ js/mod_weld.js       점용접 모듈 (현황 · 검사 우선순위 · 안정 공정조건 · 작업 실적) — 용접 웹에서 옮김
│  ├─ js/mod_heat.js       열처리 모듈 (현황 · 작업 실적 · 공정 조건 · 설비 상태)
│  ├─ js/mod_mach.js       MCT 가공 모듈 (MCT 현황 · 공구 수명 · 가공 조건)
│  ├─ js/mod_insp.js       정밀가공 검사 모듈 (검사 현황 · 부품 이력 · 가공 신호)
│  ├─ js/boot.js
│  └─ data/demo.json
├─ tools/
│  ├─ device_heat_agg.py   원본(초 단위) → 2분 요약 — 데이터가 있는 PC 에서
│  ├─ build_heat.py        2분 요약 + 라벨 → out/heat.json (비식별·요약)
│  ├─ build_press.py       타발값·불량·진동 → out/press.json (20타발 평균·일별 요약)
│  ├─ build_insp.py        부품별 가공 신호·판정 → out/insp.json (부품 번호 비식별)
│  ├─ build_weld.py        용접 웹 demo.json(점용접) → out/weld.json
│  ├─ build_plan.py        수주·생산·재고 → out/plan.json
│  ├─ build_mach.py        NASA Milling mill.mat → out/mach.json (가공 1회 RMS·공구 마모)
│  ├─ build_demo.py        공통 기반 + 모듈 → web/data/demo.json
│  └─ build_preview.py     web/ → preview.html
├─ supabase/
│  ├─ mlng_core.sql        공통 표 (mlng_)  — 시연 후 실행
│  ├─ heat_schema.sql      열처리 표 (heat_)
│  ├─ press_schema.sql     프레스 표 (press_)
│  ├─ insp_schema.sql      검사 표 (insp_)
│  ├─ weld_schema.sql      점용접 표 (weld_, 용접 웹과 같은 것)
│  └─ plan_schema.sql      생산 계획 표 (plan_)
└─ docs/설계.md
```

## 데이터가 바뀌었을 때 (PowerShell, 한 줄씩)
```
cd mlng-mes\tools
python device_heat_agg.py --src "<열처리 품질보증 폴더>\data\품질전처리후데이터.csv" --out ..\_build
python build_heat.py --agg ..\_build --label "<열처리 공정최적화 폴더>\data\label.xlsx"
python build_press.py --press "<07. Dataset_Press>\dataset" --pdm "<소성가공 예지보전 폴더>\data"
python build_insp.py --csv "<정밀가공 품질보증 폴더>\data\정밀가공_품질보증_데이터셋.csv"
python build_weld.py --weld <weldweb>\web\data\demo.json
python build_plan.py --csv "<열처리 공급망최적화 폴더>\data\data.csv"
python build_mach.py --mat <경로>\mill.mat
python build_demo.py
python build_preview.py
```

## 새 공정 모듈 붙이기
1. `web/js/mod_<공정>.js` — `MLNG.mod({ id, proc, group, menu, views, alerts, summary, drawers })`
2. `supabase/<공정>_schema.sql` — 공정 전용 표만. LOT 은 `mlng_lots`, 이력은 `mlng_trace`, 알림·검사는 공용 표
3. `build_demo.py` 의 설비 `status` 를 `live` 로 → 공장 현황·LOT 이력에 자동으로 나타난다

## 지켜야 할 것
- MCT MES 프로젝트의 Supabase·저장소는 건드리지 않는다 (MLNG 는 별도 프로젝트·저장소)
- service_role 키는 수집기·업로더 PC 의 환경변수에만 (config.js·git 에 넣지 않는다)
- 제품 데모에는 원본 행을 넣지 않는다 (2분 평균·LOT 요약, 품번·작업자·소재 LOT 비식별)
