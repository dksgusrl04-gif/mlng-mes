/* 공구·소모품 등록 목록 — 공구 주문 화면에 미리 올려 두는 품목
 * ───────────────────────────────────────────────────────────────
 * 추천이 뜨지 않은 품목도 여기 있으면 골라서 발주할 수 있다 (MCT MES 공구 주문과 같은 방식).
 * MCT 공구는 MCT MES 의 공구 목록에서 시트 브래킷 가공(정면 밀링 · 구멍 · 탭 · 모따기 · 윤곽)에 해당하는 것만 가져왔다.
 *
 *   code  품목 코드          name  품명          spec  규격·용도
 *   proc  공정 (press · weld · heat · mach · insp)
 *   cls   부류 — 마모형(닳아서 교체) · 파손형(한 번에 부러짐) · 소모품 · 예비품
 *   unit  단위   qty  발주 기본 수량   vendor  주로 사는 곳
 *   on    이 화면을 가리키는 알람이 뜨면 «추천» (예: 'press_equip')
 *   mach  'insert' 면 MCT 마모 데이터로 수량을 계산해 추천
 * 현장에 맞게 품목을 더하거나 빼면 화면에 바로 반영된다.
 */
window.MLNG_CATALOG = [
  // ── MCT 가공 (MC-01 수직형 머시닝센터)
  { code: 'MC-FC80', name: '80.0 F/C 페이스커터', spec: '정면 밀링 커터 바디 · 인서트 6날', proc: 'mach', cls: '마모형', unit: '개', qty: 1, vendor: '공구 협력사 A' },
  { code: 'MC-INS', name: '페이스커터 인서트', spec: '80.0 F/C 용 · 초경 코팅', proc: 'mach', cls: '소모품', unit: '개', qty: 6, vendor: '공구 협력사 A', mach: 'insert', per_change: 6 },
  { code: 'MC-DR068', name: '6.8 D/R 드릴', spec: 'M8 탭 하공', proc: 'mach', cls: '마모형', unit: '개', qty: 2, vendor: '공구 협력사 A' },
  { code: 'MC-DR085', name: '8.5 D/R 드릴', spec: 'M10 탭 하공', proc: 'mach', cls: '마모형', unit: '개', qty: 2, vendor: '공구 협력사 A' },
  { code: 'MC-DR103', name: '10.3 D/R 드릴', spec: 'M12 탭 하공', proc: 'mach', cls: '마모형', unit: '개', qty: 2, vendor: '공구 협력사 A' },
  { code: 'MC-DR090', name: '9.0 D/R 드릴', spec: 'M8 볼트 관통 구멍', proc: 'mach', cls: '마모형', unit: '개', qty: 2, vendor: '공구 협력사 A' },
  { code: 'MC-DR040', name: '4.0 D/R 드릴', spec: '위치 결정 핀 구멍 · 소경', proc: 'mach', cls: '파손형', unit: '개', qty: 3, vendor: '공구 협력사 A' },
  { code: 'MC-TPM08', name: 'M8xP1.25 TAP', spec: '시트 레일 체결 나사', proc: 'mach', cls: '파손형', unit: '개', qty: 3, vendor: '공구 협력사 A' },
  { code: 'MC-TPM10', name: 'M10xP1.5 TAP', spec: '브래킷 고정 나사', proc: 'mach', cls: '파손형', unit: '개', qty: 3, vendor: '공구 협력사 A' },
  { code: 'MC-TPM12', name: 'M12 TAP', spec: '스토퍼 체결 나사', proc: 'mach', cls: '파손형', unit: '개', qty: 2, vendor: '공구 협력사 A' },
  { code: 'MC-CR160', name: '16.0 C/R 챔퍼', spec: '구멍 모따기 · 버 제거', proc: 'mach', cls: '마모형', unit: '개', qty: 1, vendor: '공구 협력사 A' },
  { code: 'MC-EM245', name: '24.5 E/M 엔드밀', spec: '윤곽 · 슬롯 가공', proc: 'mach', cls: '마모형', unit: '개', qty: 1, vendor: '공구 협력사 A' },

  // ── 프레스 성형 (PR-01)
  { code: 'PR-PUNB', name: '블랭킹 펀치', spec: '브래킷 외형 블랭킹 · 예비품', proc: 'press', cls: '파손형', unit: '개', qty: 1, vendor: '금형 협력사 B', on: 'press_equip' },
  { code: 'PR-PUNP', name: '피어싱 펀치 φ8.5', spec: '체결 구멍 피어싱', proc: 'press', cls: '파손형', unit: '개', qty: 2, vendor: '금형 협력사 B', on: 'press_home' },
  { code: 'PR-DIEB', name: '다이 버튼 φ8.5', spec: '피어싱 다이 인서트', proc: 'press', cls: '마모형', unit: '개', qty: 2, vendor: '금형 협력사 B' },
  { code: 'PR-SPR', name: '스트리퍼 스프링', spec: '금형 스트리퍼용 세트', proc: 'press', cls: '소모품', unit: '세트', qty: 1, vendor: '금형 협력사 B' },
  { code: 'PR-GPB', name: '가이드 포스트·부시 세트', spec: '금형 안내 · 정렬', proc: 'press', cls: '예비품', unit: '세트', qty: 1, vendor: '금형 협력사 B' },
  { code: 'PR-OIL', name: '프레스 가공유', spec: '20L · 블랭킹·성형용', proc: 'press', cls: '소모품', unit: '통', qty: 2, vendor: '설비 협력사 C' },

  // ── 점용접 (SP-01)
  { code: 'SP-TIP', name: '점용접 전극 팁', spec: 'Cu-Cr · 돔형 φ16', proc: 'weld', cls: '소모품', unit: '개', qty: 20, vendor: '용접 협력사 D', on: 'weld_home' },
  { code: 'SP-DRC', name: '팁 드레서 커터', spec: '전극 팁 연마용', proc: 'weld', cls: '마모형', unit: '개', qty: 1, vendor: '용접 협력사 D', on: 'weld_home' },
  { code: 'SP-SHK', name: '전극 섕크', spec: '건 암 체결부 · 예비품', proc: 'weld', cls: '예비품', unit: '개', qty: 2, vendor: '용접 협력사 D' },
  { code: 'SP-HOSE', name: '냉각수 호스', spec: '전극 냉각 라인', proc: 'weld', cls: '소모품', unit: '개', qty: 2, vendor: '용접 협력사 D' },

  // ── 염욕 열처리 (SB-01)
  { code: 'HT-HTR', name: '소입로 히터 엘리먼트', spec: '존별 교체용', proc: 'heat', cls: '예비품', unit: '개', qty: 1, vendor: '설비 협력사 C', on: 'heat_equip' },
  { code: 'HT-TCK', name: 'K형 열전대', spec: '로 내 온도 측정', proc: 'heat', cls: '소모품', unit: '개', qty: 2, vendor: '설비 협력사 C', on: 'heat_recipe' },
  { code: 'HT-BSK', name: '열처리 바스켓', spec: '내열강 · 장입용', proc: 'heat', cls: '마모형', unit: '개', qty: 2, vendor: '설비 협력사 C' },
  { code: 'HT-SALT', name: '염욕제 보충분', spec: '25kg · 소입·오스템퍼링용', proc: 'heat', cls: '소모품', unit: '포', qty: 4, vendor: '설비 협력사 C' },

  // ── 정밀가공 품질 검사 (IN-01)
  { code: 'IN-SEN', name: '변위 센서', spec: '검사 셀 축 측정', proc: 'insp', cls: '예비품', unit: '개', qty: 1, vendor: '설비 협력사 C', on: 'insp_signal' },
  { code: 'IN-PGM8', name: 'M8 나사 플러그 게이지', spec: 'GO / NO-GO', proc: 'insp', cls: '마모형', unit: '세트', qty: 1, vendor: '계측 협력사 E' },
  { code: 'IN-PIN', name: '핀 게이지 φ8.5', spec: '구멍 지름 확인', proc: 'insp', cls: '마모형', unit: '개', qty: 1, vendor: '계측 협력사 E' },
  { code: 'IN-PRB', name: '측정 프로브 팁', spec: '3차원 측정기 · 루비 φ2', proc: 'insp', cls: '소모품', unit: '개', qty: 2, vendor: '계측 협력사 E' },
];
