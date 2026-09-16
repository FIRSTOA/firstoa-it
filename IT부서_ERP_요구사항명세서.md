# IT부서 전용 자산관리 ERP — 요구사항 명세서

## 0. 프로젝트 성격
- IT부서(원격파트)만 사용하는 내부 전용 웹/앱 프로그램. 고객 견적(가격 제안) 기능 없음 — 견적은 타부서 영업용 ERP 영역.
- 기존 firstoa-it(IT재고관리 앱)을 기반으로 확장하는 개념. 완전히 새로 만들지 않는다.
- 사내 타부서 ERP(erp-system)에 이미 구현된 기능/코드가 있으면 참고해서 필요한 것만 가져온다.
  **원칙: 원본 리포지토리·DB는 절대 수정/커밋/푸시하지 않는다. 읽기 전용으로만 참고한다.**

## 1. 개발 대상과 참고 소스 구분

- **firstoa-it** — 영근이 현재 개발 중인 본 프로젝트. 이 문서의 모든 신규 설계는 firstoa-it에 적용한다. (참고 대상이 아니라 개발 대상 자체)
- **그 외 FIRSTOA 조직 저장소 전체** — 읽기 전용으로 조회해서 필요한 소스만 가져온다. 원본 리포지토리·DB는 절대 수정/커밋/푸시하지 않는다.

## 1-1. FIRSTOA 조직 저장소 전체 목록 및 검토 우선순위

이름만으로 추정한 우선순위이며, 실제 검토는 클로드코드가 각 저장소를 직접 열어 스키마·컴포넌트를 확인해야 확정된다.

**0순위 — Vercel/Supabase 배포 현황으로 확인된 담당자·운영상태 (실제 라이브 프로젝트)**
| 저장소/배포명 | 담당자 | 상태 | 비고 |
|---|---|---|---|
| `first_MPS` | 김숙영 | 진행중 (**메인ERP주의** 태그) | 사내 메인 ERP로 추정 — 가장 중요한 참고 대상이지만 운영중 시스템이라 더욱 조심스럽게 읽기 전용으로만 접근 |
| `overhaul-dashboard` | 이의수 | ACTIVE | **오버홀 통계** — 이 문서의 "오버홀 이력" 모듈과 거의 1:1로 겹침. 최우선 참고 |
| `firstoa-car` | 이의수 | ACTIVE | 법인차량관리 — 구매~운행~정비~매각의 생애주기 구조가 자산관리 모듈과 동형이라 스키마 패턴 참고 가치 높음 |
| `firstoa-sheets` | 손영근 | 진행중 | 구글시트 연동 웹앱으로 추정 — 이전에 결정한 "시트-앱 양방향 동기화" 구현이 이미 있을 가능성, 확인 필요 |
| `firstoa-system` | 손영근 | **운영중** | 영근이 직접 운영 중인 라이브 시스템 — 인증/레이아웃/공통 컴포넌트 우선 확인 |
| `firstoa-bo` | 손영근 | 진행중 | 백오피스 — 공통 UI 컴포넌트 후보 |
| `firstoa-groupware` | 김숙영 | 진행중 | 그룹웨어 — 인증 셸 참고용 |
| `recontract`, `sales-groupware`, `sw-quote` | 전략영업팀 | ACTIVE | 영업 도메인 — 견적/계약금액 로직 제외, `sw-quote`는 소프트웨어 데이터 모델만 부분 참고 |

**1순위 — 자산/재고/AS/라이선스 도메인 직접 관련**
- `firstoa-license-server` → 소프트웨어관리 모듈 (라이선스 발급/관리 로직 그대로 재사용 후보)
- `copier-inventory` → 복합기 재고관리, 자산 생애주기 스키마 패턴 참고
- `first-as-search` → AS 이력 검색, IT이슈수집 모듈에 직접 참고
- `inspection-history-webapp-MG`, `firstoa-inspection-finder-mg` → 점검/AS 이력 조회 UI·데이터 구조
- `chulgo-prep`, `chulgo-check` → "출고" 준비/체크 로직, 출고/렌탈 모듈 참고
- `vendor-search-MG` → 거래처·협력업체 검색, 협력업체 모듈 참고
- `cs-schedule-MG` → AS/점검 일정관리 패턴
- `firstoa-timesheet` → 근태 도메인, 낮은 관련성이나 이름 확인차 보류

**2순위 — 사내 ERP·공통 UI 후보**
- `firstoa-ERP`, `firstsales-erp` → 이력로깅, 모델코드 legend, 공통 테이블/필터 UI 컴포넌트 (0순위의 `first_MPS`가 실제 메인ERP일 가능성이 높으므로 이쪽은 2차 확인)
- `dashboard-MG`, `recontract-dashboard` → 대시보드 UI 패턴, 재계약(예약) 관련 데이터 구조
- `firstoa-works` → 인증·레이아웃 셸, 백오피스 공통 컴포넌트

**3순위 — 인접 도메인**
- `sw-quote-app`, `sales-profit-simulator` → 영업 도메인, 견적 로직 제외하고 데이터 모델만 부분 참고
- `first2001ksy-spec/expense-dashboard` → 별도 진행 중인 지출결의서 대시보드 프로젝트, 이 ERP와는 무관하나 존재만 확인
- `s-link`, `s-link-v4`, `s-link-v4-fjfm`, `sheets-webapp` → 용도 불명, 이름상 외부 연동/시트 웹앱 추정, 확인 필요

**4순위 — 스코프 무관 또는 확인 불가 (제외 또는 보류)**
- `HR_information` → HR 도메인, 무관
- `lee`, `wangjoo`, `hj`, `test-YG`, `test-YH`, `yayu2026`, `-`, `recorder-MG`, `First-DATA-MG`, `OPS` → 이름만으로 용도 불명, 클로드코드가 실제로 열어봐야 판단 가능

가져올 때는 영업/견적 관련 필드·로직은 반드시 제거하고 IT부서 스코프에 맞게 수정한다. 특히 `first_MPS`와 `firstoa-system`처럼 "운영중/진행중"으로 표시된 라이브 시스템은 절대 원본을 건드리지 않는다는 원칙을 더 엄격히 지킨다.

## 2. 모듈 구성 (큰 메뉴)
1. **자산관리** — 구매~폐기 생애주기 전체
2. **소프트웨어관리** — 라이선스/구독(무형자산)
3. **IT기술** — 지식베이스(케이스스터디, 매뉴얼) — 기존 주간 케이스스터디 데이터 소스 흡수
4. **IT이슈수집** — AS 케이스 수집·분류 — 기존 "원격" 구글시트 IT 플래그 케이스 데이터 소스 흡수
5. **협력업체** — 지방AS 발생 시 사용하는 외부 협력업체 리스트·파견 이력

## 3. 자산 생애주기 흐름
```
구매입고 → 검수/상품화 → 재고
반납입고 → (가용재고 판정) → 재고충분: PM창고 대기 / 재고부족: 즉시오버홀 → 재출고
재고 ↔ 출고/렌탈 ↔ 점검/AS ↔ 반납 ↔ 오버홀 ↔ 재출고 (반복)
최종: 분실 · 매각 · 폐기
```

## 4. 핵심 테이블 설계 (정규화 기준)

### assets (자산 마스터)
- asset_id, asset_number(자산번호), item_category(DT/NB/MN/BP/PR), spec_group(구분, 예: I5고사노), model_name, manufacturer, purchase_price, purchase_date, purchase_source(구매처)
- status(재고/임대중/오버홀중/PM대기/판매/폐기/분실) — 위치와 분리된 별도 컬럼
- current_location_id → FK locations
- purpose_tier(용도구분: 새기기/사무용/현장용/설계용/저사양)
- serial_number

### locations (위치 마스터)
- location_id, location_name, location_type(창고선반 | 거래처 | PM창고 | 협력업체)
- ※ 기존 시트는 "위치" 컬럼에 상태단어(임대중/오버홀/판매)와 실제 선반코드(G4/B2 등)가 혼용되어 있었음 — 신규 설계에서는 status와 location을 분리해서 해결

### asset_movements (이동 이력) — 신규, 최우선
- movement_id, asset_id, moved_at, from_location_id, to_location_id, receiving_type(구매입고/반납입고, nullable), 담당자
- 기존 시트는 비고란에 텍스트로 누적하는 방식이라 통계 집계가 불가능했음 → 행 단위 이력으로 전환

### asset_overhaul_records (오버홀 이력) — 신규
- overhaul_id, asset_id, 대기시작일, 착수일, 완료일, 작업내용, 비용, 담당자
- 기존 시트는 "오버홀날짜" 1개 필드만 존재 → 몇 번 오버홀했는지 집계 불가능했음

### asset_as_records (AS 이력) — 신규, IT이슈수집과 연결
- as_id, asset_id(FK, nullable), 발생일, 증상, 처리내용, 처리주체(내부/외부), partner_id(FK, 외부일 때만), 비용
- 기존 "원격" 시트의 IT 케이스 데이터가 자산번호로 연결되어 있지 않아 자산별 AS 횟수 집계가 불가능했음 → FK 연결로 해결

### reservations (예약/출고예정) — 신규
- reservation_id, asset_id 또는 (spec_group + qty), 예약자(영업담당), 예약일, 출고예정일, 상태(예약중/출고완료/취소)
- 기존 시트는 예약자/예약일이 자산 행에 컬럼으로 직접 붙어있어 예약 이력 관리 불가 → 별도 테이블로 분리

### licenses / license_assignments / license_renewal_history (소프트웨어)
- 물리자산과 대칭 구조. 구독시작→갱신→해지 라이프사이클

### it_issues (IT이슈수집)
- issue_id, 발생일, 고객사, 증상, 처리여부, 난이도(A/B/C), 처리자, asset_id(FK)

### partners / partner_dispatch_history (협력업체)
- partners: 업체명, 지역, 전문분야, 연락처, 계약조건, 평가등급
- partner_dispatch_history: partner_id, 관련 asset_id 또는 issue_id, 파견일, 처리내용, 비용, 정산여부

## 5. 자동화 로직 — 안전재고 판정
기존 "IT팀 데스크탑 주간 출고량 및 안전재고 분석 대시보드"의 기준을 그대로 자동화 규칙으로 채택:
- 1주 안전재고 = 주간 평균 출고량(올림)
- 2주 안전재고 = 1주 안전재고 × 2
- 가용재고 = 새기기 + 사무용 상태 수량
- **반납입고 시점에 "가용재고 < 안전재고"면 즉시오버홀 플래그 자동 표시**

## 6. 확인 필요 항목 (개발 착수 전 담당자 확인)
- 자산번호 접두어(P/X/A/D 등)가 정확히 무엇을 구분하는지
- 영업부 예약이 자산 단위(시리얼)인지 모델/스펙 단위인지
- "기타"(511건), "악성"(34건) 상태값의 정확한 정의
