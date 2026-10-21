/* MLNG MES 설정
 * ───────────────────────────────────────────────────────────────
 * 비워 두면 «데모 모드» — data/demo.json 만 보여 준다.
 * 채우면 Supabase 에서 읽는다 (로그인 없음, anon 키). 표가 비어 있으면 데모 스냅샷을 계속 보여 준다.
 * MLNG 전용 Supabase 프로젝트 값 — MCT MES 프로젝트와 섞지 않는다.
 * anon 키는 공개돼도 되는 키다. 절대 넣으면 안 되는 것: service_role 키
 */
window.MLNG_CONFIG = {
  SUPABASE_URL: 'https://vwgfeutvcvogutxuhcxt.supabase.co',   // MLNG MES 전용 프로젝트
  SUPABASE_ANON_KEY: 'sb_publishable_7FxcyivB8vrrJJdrWTSl9g_FZUiEV17',   // Publishable key (공개용)

  // 아직 이 셸에 합치지 않은 모듈 — 공정 흐름에서 누르면 새 탭으로 연다 (비우면 링크 없음)
  LINKS: {
    weld: '',                                              // 용접 웹 주소 (배포 후)
  },

  // 운영 기준 — 현장에서 정해 바꾼다
  OUTPUT_PROC: 'heat',        // 공장 «생산 수량» 을 세는 공정 (검사 셀은 가공 사양 부품만 거치므로 열처리 완료 기준)
  RECENT_DAYS: 7,             // «최근» 으로 보는 기간 (알림·KPI)
  STALE_HOURS: 24,            // 실시간 모드에서 이 시간 넘게 새 작업이 없으면 알림
  HEAT: {
    TARGET_PPM: null,         // 불량률 관리 기준. 비우면 데이터에 담긴 값(450 PPM)
    DEVIATION_RATE: 0.05,     // 한 작업에서 조건을 벗어난 시간이 이 비율을 넘으면 «조건 이탈»
    HEATER_DRIFT_PP: 5,       // 히터 출력이 초기 대비 이만큼(%p) 늘면 설비 점검 알림
    HEATER_BASE_JOBS: 20,     // 히터 출력 기준 = 처음 N개 작업의 중앙값, 비교 = 최근 N개
  },
  PRESS: {
    TARGET_PPM: 150,          // 프레스 불량률 관리 기준 (부품 기준 PPM)
    TREND_DAYS: 3,            // 최근 N작업일 불량률이
    TREND_RATIO: 2,           //   그 전보다 이 배수 이상이면 «불량 증가» 알림
    OUT_RATE: 0.01,           // 하루 타발 중 허용 범위 밖이 이 비율 이상이면 알림
    CPK_OK: 1.33, CPK_MIN: 1.0,
  },
  PLAN: {
    AVG_DAYS: 7,              // 내일 예상 수주 = 최근 N작업일 평균
    SAFETY_DAYS: 0.5,         // 안전재고 = 예상 수주의 이 비율
    LOT_SIZE: { 'GR-021': 150, 'GR-042': 200 },   // 1회 생산량
  },
  MACH: {
    VB_LIMIT: 0.5,            // 공구 교체 기준 — 플랭크 마모 VB (mm)
    VB_WARN: 0.35,            // 주의 기준
    LATE_RATIO: 1.2,          // 최종 VB 가 교체 기준의 이 배수를 넘으면 «늦은 교체»
  },
  // 구매·발주 — 알림에서 바로 발주하고 3단계 결재 후 발주서를 출력한다
  BUY: {
    COMPANY: 'MLNG 데모 공장',          // 발주서의 «발주처»
    ADDRESS: '부산광역시 (데모)',
    STEPS: ['담당', '검토', '승인'],     // 결재 단계 (순서대로)
    MACH_STOCK: 12,                     // 밀링 인서트 현재 재고 (데모값)
    MACH_WEEKS: 2,                      // 인서트는 «최근 7일 교체 횟수 × N주» 만큼 확보
    // 품목 — 단가는 예시값. 현장 단가로 바꿔 쓴다
    ITEMS: [
      { code: 'MC-INS-01', name: '정면 밀링 인서트', spec: '초경 코팅 · 정면 밀링 커터용', unit: '개', price: 12000, vendor: '공구 협력사 A', proc: 'mach', per_change: 6 },
      { code: 'SP-TIP-01', name: '점용접 전극 팁', spec: 'Cu-Cr · 돔형', unit: '개', price: 4500, vendor: '용접 협력사 D', proc: 'weld', on: 'weld_home', qty: 20 },
      { code: 'PR-PUN-01', name: '프레스 금형 펀치 예비품', spec: '브래킷 성형 금형용', unit: '개', price: 380000, vendor: '금형 협력사 B', proc: 'press', on: 'press_equip', qty: 1 },
      { code: 'HT-HTR-01', name: '소입로 히터 엘리먼트', spec: '존별 교체용', unit: '개', price: 450000, vendor: '설비 협력사 C', proc: 'heat', on: 'heat_equip', qty: 1 },
      { code: 'IN-SEN-01', name: '검사 셀 변위 센서', spec: '정밀가공 검사용 · 축 측정', unit: '개', price: 210000, vendor: '설비 협력사 C', proc: 'insp', on: 'insp_signal', qty: 1 },
    ],
  },
  // 질의응답 (Claude API) — 키는 Supabase Edge Function 에만 둔다 (supabase/functions/mlng-ask)
  //   'off' = 규칙 기반만. 함수를 배포한 뒤 '' 로 바꾸면 `${SUPABASE_URL}/functions/v1/mlng-ask` 를 자동으로 쓴다
  ASK_URL: 'off',
  RETRAIN_MIN_RECORDS: 50,
};
