/* MLNG MES 설정
 * ───────────────────────────────────────────────────────────────
 * 비워 두면 «데모 모드» — data/demo.json 만 보여 준다.
 * 채우면 Supabase 에서 읽는다 (로그인 없음, anon 키). 표가 비어 있으면 데모 스냅샷을 계속 보여 준다.
 * MLNG 전용 Supabase 프로젝트 값 — MCT MES 프로젝트와 섞지 않는다.
 * anon 키는 공개돼도 되는 키다. 절대 넣으면 안 되는 것: service_role 키
 */
window.MLNG_CONFIG = {
  SUPABASE_URL: '',          // https://<프로젝트>.supabase.co
  SUPABASE_ANON_KEY: '',     // Project Settings → API → anon public

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
  RETRAIN_MIN_RECORDS: 50,
};
