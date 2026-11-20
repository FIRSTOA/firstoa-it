[기획실 도면우]

# 계약 관리 (/contracts) — 소프트웨어 계약 · PC 유지보수 (설계안, 2026-11-20)

크기: **큰 일, 2단계로 나눔.** 1단계(소프트웨어 계약 + works 실시간 거래처 목록 + 비밀 칸 암호화·열람 인증 + 시트 옮기기)는 새 표 4개 + 새 화면 + 보안 코드.
2단계(PC 유지보수 방문 기록)는 새 표 1개 + 칸 추가 + 핸드폰 폼.
흐름: 기획 → (사용자 승인) → 팀장 사전 작업(공용 타입·상수) → db-schema ∥ ui-designer ∥ developer A·B·C → sql-review → qa-checker → deploy-check.
DB·works는 로컬에서 못 읽음(.env.local Supabase·WORKS 키 비어 있음) → 임대 숫자는 팀장 실측값, 시트 구조는 이번에 직접 읽은 값, works 응답 속도는 **배포 뒤 실측**.

## 사용자 확정 결정 (2026-11-20)

| # | 결정 | 설계 반영 |
|---|---|---|
| D1 | 방문 기록은 IT 웹앱에 둠(FIELD에 안 붙임). FIELD '미수 방문이력' 설계(1방문=1행, 폼 열 때 만든 UUID, 보완 기록, 사진, 초안 이어쓰기)를 빌림 | §3-3 2단계 표, §4 2단계 |
| D2 | **비번·라이선스 키 전부 앱으로 옮김(빠짐없이)**, 인증 비밀번호를 넣어야 보이고 **수정도 그 상태에서만** | §3-4 보안(확정), §3-5 옮기기 — 줄 수·암호화 칸 수·복호화 확인 숫자를 화면에 |
| D3 | 시트는 한 번 옮기고 앱이 원본(이후 동기화 없음) | §3-5 |
| D4 | 방문 주기는 거래처별 선택(없음/매월/격월/분기/직접 n일 …) + 다음 예정·밀린 곳 | §3-6 |
| D5 | 유지보수 대상은 PC유지보수만(복합기유지보수는 CS팀) | `PCM_ITEMS` |
| D6 | **거래처 목록은 실시간** — 계약 화면을 열 때마다 firstoa-works에서 품목 '소프트웨어'·'PC유지보수' 자산만 직접 읽음. 임대종료·사라진 건은 기록을 지우지 않고 "계약 종료". 우리 기록의 열쇠는 works assets.id / classification_number(순) / 거래처 코드 — **it_rental_list에 의존하지 않음**(그 표와 반영 방식은 그대로, 범위 밖). works가 안 읽힐 때만 it_rental_list로 대신 보여 줌 | §3-1, §3-2 |
| D7 | 비밀 칸 구조(암호화 저장 · 보기 누른 칸만 서버 복호화 · 짧은 쿠키 · 실패 횟수 제한 · 열람·수정 기록) 확정 | §3-4 |
| D8 | (§6 질문 답, 2026-11-20) 인증 비밀번호는 추천안(설정 화면에서 해시 → Vercel 환경변수 → 재배포), 유효 10분. **배포 뒤 비밀번호가 잘 들어가는지 먼저 확인하고 나서 시트 옮기기** | §5 1단계 배포 순서 3-1 |
| D9 | **2차인증 칸은 가리지 않음**(평문) — 좌석 칸 `mfa_note`. 월구독카드는 비밀 칸(card) 유지 | §3-3 ③, §3-5, §3-7 |
| D10 | 암호화 열쇠 백업은 **나중에**(사용자 결정). 설정 화면의 인쇄 버튼은 두되 강요하지 않음 — 위험은 CLAUDE.md에 적음 | §3-4 |
| D11 | (2단계) 서비스 이름은 예시 8개로 시작, **화면에서 추가·삭제** 가능 — 표 `it_pcm_service_items` | §5 2단계 |
| D12 | (2단계) 원격 지원은 방문 횟수에서 뺌(추천안 — 사용자가 반대 안 함) | §3-6 |
| **D13** | (2026-11-20, 1단계 배포 직후 사용자: "너무 어렵다 — 소프트웨어 메뉴 누르면 비번(예: 1234) 넣고 보이게") **§3-4를 대체**: 소프트웨어 탭 전체를 비밀번호 하나로 잠금 → 열면 목록·비밀 칸 값이 그냥 보임(칸마다 보기·60초 가림 없음), 2시간 쿠키. 비밀번호는 **화면에서 처음 정하고 화면에서 바꿈**(PBKDF2 해시를 새 표 `it_contract_settings`에, 쿠키 서명 값도 거기). 비밀 칸은 **암호화 없이 그대로 저장**(사용자 선택 "그냥 저장" — `it_contract_secrets.value_text`, 서버 전용 표). Vercel 환경변수·`/contracts/setup` 없음. 비밀번호를 잊으면 `it_contract_settings`의 'sw_password_hash' 줄을 지우고 다시 정함(값은 그대로). 틀린 시도 제한·기록은 유지 | §3-4는 역사 기록 — 실제는 이 줄 |

---

## 0. 지금 코드·데이터에서 확인한 것 (근거)

| # | 사실 | 위치 / 방법 |
|---|---|---|
| F1 | works 클라이언트는 REST(PostgREST) 직접 호출, 헤더 `apikey` + `Authorization: Bearer <WORKS_SUPABASE_SERVICE_ROLE_KEY>`. **GET만, 쓰기 코드 없음** | lib/works/client.ts:24-26 |
| F2 | 함수는 `fetchAllWorksRows(table, cols)` 하나 — **필터 인자 없음**, 먼저 `count=exact`+`Range: 0-0`으로 건수 → `Range` 헤더로 1000줄씩 8개 동시. **정렬(order) 없음, 시간 제한(timeout) 없음, `cache` 옵션 없음**, 한 쪽이라도 실패하면 throw | lib/works/client.ts:35-74 |
| F3 | works도 **한 번에 최대 1000줄**(limit=5000 줘도 1000 — 실측 주석) | lib/works/client.ts:10-11 |
| F4 | 임대리스트 동기화가 읽는 칸: id·classification_number(순)·name(거래처)·item_category(품목)·rental_status·asset_code·model_name·device_sn·contract_date·end_date·first_contract_date·removal_date·sales_location 등 27칸. 이름·자산번호 둘 다 빈 자산은 버림 | lib/rentals/worksSync.ts:81-109, 145-149 |
| F5 | works assets에는 **거래처 코드 `ecount_code`(이카운트 10자리, `_NRD(2)` 꼬리·P 번호도 있음)**, 임대 코드 `hanjo_code`(5자리, 'X'·'세단기' 같은 자리표시 값 섞임)가 있음 — 임대리스트 사본엔 안 가져옴. **ecount_code에 개인 고객의 주민번호 꼴 값이 원래대로 있을 수 있음** | FIELD docs/tasks/lease-source-works-2026-11-17.md §2-2, §4-1(104행), 221행 |
| F6 | 순(classification_number)은 **기기 한 줄 단위** 열쇠(FIELD lease_seq도 "기기 = 임대리스트 순"), 같은 자산번호가 여러 순에 있음(재임대) → 거래처 열쇠로는 못 씀. works assets.id는 임대 건 하나(재임대는 새 행) | FIELD 같은 문서 §2-2, docs/manual/ops/12-customer-numbering.md:26 |
| F7 | `it_rental_list.sheet_row` = works `assets.id`, `seq` = classification_number — works가 안 읽힐 때 대신 쓸 수 있는 같은 열쇠(단 거래처 코드는 없음) | lib/rentals/worksSync.ts:10-12, supabase/rentals_schema.sql |
| F8 | works 응답 속도·지역: **로컬에 키가 없어 못 잼.** 키 없이 보낸 요청의 401은 Cloudflare 서울 엣지(CF-RAY …-ICN)에서 바로 돌아와(약 0.05초) 지역 판단 근거가 안 됨 → 배포 뒤 화면에 실측 표시 | curl, 2026-11-20 |
| F9 | 사진: `prep-photos` 공개 버킷, 코드가 없으면 만듦, 리사이즈 후 base64로 서버 액션 업로드(한도 8mb) | app/shipment-prep/reportActions.ts:121-180, next.config.mjs |
| F10 | 로그인 없음. 이름은 직접 적고 브라우저에 기억(`firstoa-it.feedback-name`). 담당자 이름 목록 표 `it_staff_names` 있음 | components/home/FeedbackBoard.tsx:16, app/actions.ts:405 |
| F11 | 앱 어디에서도 쿠키를 아직 안 씀(이번이 처음) · 미들웨어 없음 | grep `cookies()` 0건 |
| F12 | 홈 카드: 함수마다 예외 안 던지고 실패하면 그 카드만 "못 읽음", Supabase는 1000줄 한도 → 건수는 count head, 합계는 `readAllPages` | lib/homeDashboard.ts |
| F13 | **청구 배분 작업이 아직 커밋 전** — lib/homeDashboard.ts · lib/supabase/server.ts 가 수정 중 상태. 이번 작업도 이 두 파일을 건드림 | git status |

### 소프트웨어 시트 실측 (2026-11-20, 읽기 3회 — 비밀 칸은 모양·개수만 봄)
- 스프레드시트 ID = 앱의 `GOOGLE_INVENTORY_SHEET_ID`와 **같음**(로컬 환경값 비교) → 기존 서비스계정·시트 클라이언트 그대로. IT재고 5개 탭과 **분당 읽기 한도를 같이 씀**.
- **병합 셀 아님**: 업체명·고객사 칸에 병합 0개(병합은 비용·월구독카드 칸에 2개씩뿐). 적게 채워진 건 진짜 빈 칸.
- `SW자산_비갱신형` 229줄(머리줄은 **2행**): 업체명이 **3번 칸(계약정보) 또는 21번 칸(사용자정보) 중 한 곳에만** 있음(둘 다 0 · 3번만 59 · 21번만 149 · 둘 다 없음 21). 위 168줄은 21번, 아래 61줄은 3번 → **둘 중 있는 값을 업체명으로**.
  - 업체 이름 **12종**(3번 6 + 21번 6, 겹침 0). 한 업체가 116줄(상품 2종, 영구)인 큰 묶음.
  - 업체명 없는 21줄 중 9줄은 같은 마스터 계정 도메인의 다른 줄로 업체 짐작 가능.
  - 0번 "순번" = 시트 안 일련번호(거의 1씩 증가) — 임대리스트 순 아님.
  - 25번 설치PC 자산번호 146줄, 전부 다름, 모양 `X1234`/`P1234`/`M1234`(IT 자산번호 체계).
  - 2번 소프트웨어명 11종(오타: "mirrosoft 365…", "…for busines"), 1번 매입처 8종(오타 "소프플래너").
  - 12번 라이선스유형 원문 7종: "영구 라이선스 (일회성 구매)" 119 · "? 구독" 54 · "년 구독/월 결제" 20 · "월 구독" 15 · "연 구독 / 연 결제" 4 · "연 구독" 1 · "무료" 1.
  - 날짜 형식 섞임: `2024-01-02` / `24-01-02` / `24. 1. 2`. 구매날짜 칸 두 개(15·16).
  - 7번 "퍼스트전산담당자"는 이름이 아니라 전화번호(161줄 같은 값).
  - 26~42번(날자·자산번호·OS·CPU…사양 붙여넣기)은 10줄 남짓만.
  - **비밀 칸 채움**: 9번 라이선스 키/ID **172칸**(키 모양 119 + 계정(@) 모양 50 + 여러 줄 3) · 10번 마스터아이디 및 비번 **226칸**("아이디 / 비번" 모양 154 + 짧은 값 70) · 11번 2차인증 218칸(전화번호 든 여러 줄 20) · 14번 월구독카드 40칸.
- `SW자산_갱신형` 32줄: 고객사 칸 **3줄만**. **사용자계정 29칸 · 관리자계정 29칸** 모두 "아이디 / 비번" 모양. 계정 메일 도메인으로 묶으면 **3묶음(25·4·3줄)**. 계약상품 3종, 상태 전부 "사용중", 갱신 날짜 21줄.
- 결론: 시트 거래처는 **대략 12~15곳**, 임대리스트 소프트웨어 거래처는 46곳(임대중) → **30곳 넘게 "상세 미입력"으로 시작**. 시트에만 있고 works 소프트웨어에 없는 곳(GPT·Gmail·한컴 등 판매 건일 수 있음)도 생김.
- 옮길 비밀 칸 합계(시트 기준, 빈 칸 제외): 라이선스 키 172 + 마스터 계정 226 + 사용자계정 29 + 관리자계정 29 = **456칸**(+ 2차인증 218 · 카드 40 — §6 질문 3에 따라). 옮긴 뒤 화면 숫자가 이와 맞아야 함.

---

## 1. 한 줄 목표와 쓰는 사람

**firstoa-works의 '소프트웨어'·'PC유지보수' 거래처를 화면을 열 때마다 실시간으로 모아 보여 주고, 소프트웨어는 계약 상품·라이선스·사용자(비번·키는 인증 비밀번호를 넣어야 보이고 고칠 수 있음)를, PC 유지보수는 방문 주기와 IT 직원 방문 기록을 앱에서 관리한다.** 시트는 한 번 빠짐없이 옮기고 보관용.

- 소프트웨어 계약: 주로 **PC**(목록·정리·옮기기). 핸드폰은 현장에서 라이선스 키·계정 찾아보기(인증 후 보기·복사).
- PC 유지보수: 방문 기록은 **핸드폰**(홈 화면 앱), 주기 설정·밀린 곳 확인은 PC.

---

## 2. 기존 코드 재사용·확장 지점

| 파일:함수 | 어떻게 |
|---|---|
| lib/works/client.ts | **새 함수 하나 추가**(`fetchWorksAssetsByItems`, §3-1). 기존 `fetchAllWorksRows`·헤더·환경변수는 **안 바꿈**(임대리스트 동기화가 씀) |
| lib/rentals/worksSync.ts `normalizeDate`·`str` 규칙 | 같은 규칙으로 날짜·문자 정리(가져다 쓰지 말고 lib/contracts 쪽에 같은 규칙 — worksSync는 범위 밖) |
| `it_rental_list` | **works가 안 읽힐 때만** 같은 품목 줄을 읽어 대신 보여 줌(읽기만, 표·반영 방식 안 건드림) |
| lib/homeDashboard.ts `readAllPages`·`errorCard`·`kstToday` | 계약 카드 `loadContractsCard` 추가 — works를 읽으므로 홈에선 `<Suspense>`(IT 재고 카드처럼) |
| lib/googleAuth.ts `getSheetsClient` | 시트 옮기기 읽기(같은 서비스계정). `values.batchGet` 한 번에 두 탭 |
| lib/confirmSheet.ts의 "쓰기 전 재확인" 정신 | 옮기기 반영 직전에 시트를 다시 읽어 미리보기 때와 같은지(지문) 확인 |
| app/shipment-prep/reportActions.ts `ensureBucket`·`storePrepPhotoFile` | 2단계 방문 사진 업로드를 같은 방식으로(버킷만 `pcm-photos`) |
| lib/imageResize.ts, components/PhotoLightbox.tsx | 2단계 사진 줄이기·크게 보기 |
| FIELD `src/misuVisitDraft.ts` 초안 봉투 · `supabase/misu-visits.sql` · `src/misuVisit.ts normMisuVendorName` | 2단계 방문 기록·이름 정규화 규칙을 그대로 빌림(같은 규칙으로 새로 씀) |
| components/MobileTableCards.tsx(`m-cards`·`data-m`), MobileFilterRows.tsx | 새 목록 표 핸드폰 카드·필터 접기 |
| FeedbackBoard `NAME_KEY` 패턴 + `it_staff_names` | 열람자·작성자 이름 기억 + 이름 후보 |
| app/rentals/actions.ts `isMissingAssignmentsTable` 방식 | 새 표가 아직 없을 때 안내(좁게 — 42P01/PGRST205 또는 "does not exist") |
| components/Shell.tsx `SIDEBAR_SECTIONS` | '임대·청구' 묶음에 `{ label: '계약 관리', href: '/contracts' }` |

---

## 3. 데이터 설계

### 3-1. 거래처 목록 = firstoa-works 실시간 (D6 확정)

**선택지 기록(짧게)**: (a) 임대리스트 사본에서 계산 — 빠르지만 "반영"을 눌러야 새 거래처가 뜸 / **(b) works 직접 읽기 — 확정**(항상 최신, works가 멈추면 대신 보여 줄 길 필요) / (c) works 반영 매일 자동 — 반영이 행 삭제·청구 줄 재작성까지 해서 위험, 안 함.

**읽는 쿼리 모양** (새 함수 `fetchWorksAssetsByItems(items, cols, { timeoutMs })`, lib/works/client.ts, server-only)
```
GET {WORKS_SUPABASE_URL}/rest/v1/assets
    ?select=id,classification_number,ecount_code,name,sales_location,contact_person,contact_phone,
            asset_code,model_name,device_sn,manufacturer,item_category,rental_status,
            contract_date,end_date,first_contract_date,removal_date
    &item_category=in.("소프트웨어","PC유지보수")      ← 값은 encodeURIComponent, 큰따옴표로 감쌈
    &order=id.asc                                      ← 페이지가 섞이지 않게(기존 함수엔 없음 — F2)
headers: apikey, Authorization: Bearer <works service key>, Range: 0-999  (다음 1000-1999 …)
fetch 옵션: cache: 'no-store', signal: AbortSignal.timeout(8000)
```
- 1000줄 한도(F3) → **받은 줄이 1000 미만이면 끝**인 순서대로 읽기(건수 요청 생략 — 지금 680줄 남짓이라 보통 요청 1번). 페이지마다 같은 필터·정렬.
- 지금 규모(팀장 실측, 임대리스트 시트 기준): 소프트웨어 임대중 338줄·종료 17, PC유지보수 임대중 323줄·종료 1 ≈ **680줄 = 1페이지**.
- 품목 이름이 정확히 '소프트웨어'·'PC유지보수'가 아니면 0줄이 나옴 → 0줄이면 화면에 "works에서 품목 '…'을 못 찾았어요(품목 이름 확인)" 안내. 배포 직후 거래처 수(소프트웨어 46·PC유지보수 20 근처)로 확인.
- 키는 서버에서만(Vercel 환경변수 — 임대리스트 대조가 이미 쓰는 `WORKS_SUPABASE_URL`·`WORKS_SUPABASE_SERVICE_ROLE_KEY`). 브라우저로 가는 것은 정리된 거래처 요약뿐(works 원본 줄·거래처 코드는 안 보냄).
- **속도**: 모름(F8). 서버가 잰 시간을 화면 위에 "works에서 방금 읽음 · 0.4초"로 표시, deploy-check가 배포 뒤 기록. 페이지는 `<Suspense>`로 틀(탭·칩 자리) 먼저 띄우고 목록은 도착하면(시트 화면들과 같은 방식). 2초를 자주 넘으면 그때 짧은 보관(캐시)을 검토 — 이번엔 안 함("실시간" 결정).

**works가 안 읽힐 때 (화면이 죽지 않게)** — `lib/contracts/worksSource.ts` `loadContractAssets()`가 위에서부터:
1. works 성공 → `source: 'works'`.
2. 실패(시간 초과·4xx/5xx·키 없음) → `it_rental_list`에서 `.in('item', [...SW_ITEMS, ...PCM_ITEMS])` 같은 칸(sheet_row→assetId, seq, vendor_name, status …)을 페이지로 읽어 → `source: 'rental_copy'`, 화면 위 주황 띠 **"firstoa-works를 못 읽어서 임대리스트 사본(마지막 '반영' 기준)으로 보여 드려요"**. 사본엔 거래처 코드가 없으므로 코드 맞추기는 건너뛰고 assets.id·이름으로만(§3-2).
3. 둘 다 실패 → `source: 'none'`, 우리 표에 저장된 거래처만 보여 주고 "거래처 목록을 못 읽었어요" + [다시 읽기]. 저장·방문 기록은 계속 가능.
- 어느 경우든 **우리 표에 쓰는 일은 works 결과에 따라 바뀌지 않음**(읽기 실패가 기록을 지우거나 "종료"로 저장하지 않음 — 종료는 화면 계산값일 뿐).

**상태(화면 계산, 저장 안 함)**
- 활성 = `rental_status <> '임대종료'`(임대리스트 화면과 같은 기준, 소송 등도 활성).
- `active` 활성 줄 1개 이상 / **`ended` "계약 종료"** = 그 품목 줄이 전부 임대종료 **또는** 우리 기록은 있는데 works 품목 줄에서 사라짐(사라진 경우 작은 글씨 "works에 없음") / `manual` = 우리가 "works에 없는 거래처"로 만든 곳(판매·직접 계약·옮기기 미분류).
- **새 거래처** = works에 있고 우리 기록 없음 → "상세 미입력". 기록은 절대 자동으로 지우지 않음.
- 사람이 정한 `manual_status`('ended'·'hidden')가 있으면 그것이 우선.

### 3-2. 거래처 열쇠 — works 열쇠 우선, 이름은 마지막 (D6)

works 품목 줄 하나 = 임대 건 하나(assets.id). 줄들을 거래처로 묶고, 우리 거래처 행과 맞추는 순서:

| 순서 | 열쇠 | 어디에 저장 | 비고 |
|---|---|---|---|
| ① | **works assets.id** | `it_contract_clients.seen_asset_ids integer[]` | 저장할 때 그 거래처에 맞았던 줄 id를 적어 둠. 임대 건 하나는 한 거래처 것(재임대는 새 행 — F6) → 이름·코드가 바뀌어도 그대로 찾음. **가장 확실** |
| ② | **거래처 코드(ecount_code)** | `vendor_codes text[]` | 정리: 앞뒤 공백 제거, `_NRD(2)` 같은 꼬리 떼고 앞 10자리 숫자, 또는 `P숫자`. **주민번호 꼴(숫자 13자리, 6-7 하이픈 포함)은 버림 — 저장·표시·비교 안 함**(F5). 화면·브라우저로 안 보냄 |
| ③ | 정규화 이름 `name_key`(unique) + 다른 표기 `alias_keys` | 같은 표 | FIELD `normMisuVendorName` 규칙: `㈜ (주) （주） 주식회사 (유) 유한회사` 제거, 공백·`·.,-_/()（）[]` 제거, 소문자 |

- **묶기(works 줄 → 임시 거래처)**: 코드가 있는 줄은 코드로 묶고, 코드 없는 줄은 이름 키로 묶은 뒤, 이름 키가 코드 묶음과 같으면 그 묶음에 합침. 묶음 이름 = 가장 많이 나온 거래처명.
- **맞추기(임시 거래처 → 우리 행)**: ①(줄 id 하나라도 겹침) → ②(코드 겹침) → ③(이름·별칭) → 없으면 새 거래처("상세 미입력", 열쇠 `new:<code 또는 name_key>`). ①로 찾았는데 지금 이름이 다르면 "works 이름이 바뀌었어요: 옛 → 새" 안내만(자동으로 우리 이름을 바꾸지 않음).
- 한 묶음이 두 우리 행에 맞으면(드묾) 첫 번째로 맞춘 행 + "거래처가 둘로 나뉘어 있어요 — 합치기" 안내.
- 저장할 때(거래처 정보·계약·좌석·방문 저장, 옮기기 반영)마다 그 순간 맞은 works 줄 id·코드를 `seen_asset_ids`·`vendor_codes`에 **더함**(빼지 않음). 화면을 여는 것만으로는 쓰지 않음.
- 같은 이름 키·코드가 두 거래처 행에 들어가지 않게 저장 전에 확인.
- **방문 기록·좌석의 기기 열쇠** = works assets.id + 순(classification_number) + 자산번호(표시용). 순은 FIELD lease_seq와 같은 값 → 나중에 FIELD와 이을 열쇠.
- 한 거래처가 소프트웨어·PC유지보수 둘 다면 **거래처 행은 하나**(연락처·메모 공유), 탭마다 자기 품목 줄 기준으로 나옴.
- `hanjo_code`(임대 코드)는 자리표시 값이 섞여 열쇠로 안 씀(안 읽음).

### 3-3. 새 표 (1단계 `supabase/contracts_schema.sql`)

공통: 모든 표 `enable row level security` + 정책 없음 + `revoke all on … from anon, authenticated`(다른 `it_*`와 같은 모델). `updated_at`은 `public.set_updated_at()` 트리거(feedback_schema.sql처럼 `create or replace`). 두 번 실행해도 안전. 끝에 `notify pgrst, 'reload schema';`. 롤백은 주석(비밀 표 먼저). **기존 표(it_rental_list 등)는 건드리지 않음.**
**ON CONFLICT에 쓸 unique는 부분 인덱스(where …)로 만들지 말 것** — PostgREST upsert 대상으로 못 씀(app/rentals/actions.ts:346 주석). nullable 칸에 그냥 `unique`(NULL끼리는 안 겹침).

**① `it_contract_clients` — 계약 거래처** (`CONTRACT_CLIENTS_TABLE`)
| 칸 | 형 | 뜻 |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| name | text not null, `btrim(name) <> ''` | 표시 이름(처음엔 works 거래처명) |
| name_key | text not null **unique** | 정규화 이름 |
| alias_keys | text[] not null default '{}' | 다른 표기 |
| vendor_codes | text[] not null default '{}' | works 거래처 코드(정리된 값, 주민번호 꼴 제외) |
| seen_asset_ids | integer[] not null default '{}' | 본 적 있는 works assets.id |
| not_in_works | boolean not null default false | works에 없는 거래처(판매·직접 계약·옮기기 미분류) |
| manual_status | text not null default '' check in ('', 'ended', 'hidden') | 사람이 "계약 종료"/"숨김" 지정 |
| sales_owner / it_owner | text not null default '' | 퍼스트 영업담당 / 전산담당(시트 6·7번) |
| key_person / key_phone | text not null default '' | 키맨(평문 — works·임대리스트에도 보이는 정보) |
| memo | text not null default '' | |
| created_by / updated_by | text not null default '' | 적은 사람(직접 입력) |
| created_at / updated_at | timestamptz default now() + 트리거 | |
- 색인: `vendor_codes`·`seen_asset_ids`는 GIN 안 함(거래처 수백 곳이라 서버 JS에서 맞춤).

**② `it_sw_contracts` — 계약 상품** (`SW_CONTRACTS_TABLE`) — 거래처의 소프트웨어 한 종류
| 칸 | 형 | 뜻 |
|---|---|---|
| id | uuid pk | |
| client_id | uuid not null references it_contract_clients(id) **on delete restrict** | |
| product | text not null, 빈 값 금지 | 상품명 |
| supplier | text not null default '' | 매입처 |
| license_type | text not null default 'unknown' check in ('perpetual','subscription','free','unknown') | |
| term | text not null default '' check in ('', 'monthly', 'yearly') | 구독 단위 |
| pay_cycle | text not null default '' check in ('', 'monthly', 'yearly', 'once') | 결제 주기 |
| license_type_raw | text not null default '' | 시트 원문 |
| quantity | integer null check (quantity >= 0) | 비우면 좌석 수로 셈 |
| starts_on / renews_on / ends_on | date null | 계약 전체 |
| cost_note | text not null default '' | 비용 원문(숫자로 안 바꿈) |
| admin_portal | text not null default '' | 관리 콘솔 주소 |
| setup_vendor | text not null default '' | 초기세팅업체 |
| status | text not null default '사용중' check in ('사용중','해지','만료','보류') | |
| memo | text not null default '' | |
| source | text not null default 'app' check in ('app','sheet_renew','sheet_perm') | |
| source_key | text **unique** null | 옮기기 중복 방지(`sheet:<client_id>:<상품>:<유형원문>:<매입처>` 정규화) |
| created_by / updated_by / created_at / updated_at | | |
- 색인: client_id, renews_on, ends_on.

**③ `it_sw_seats` — 라이선스 한 개 = 사용자 배정 한 줄** (`SW_SEATS_TABLE`)
| 칸 | 형 | 뜻 |
|---|---|---|
| id | uuid pk | |
| contract_id | uuid not null references it_sw_contracts(id) **on delete restrict** | |
| user_name / dept | text not null default '' | |
| pc_asset_code | text not null default '' | 설치 PC 자산번호(대문자·공백 제거) |
| mfa_note | text not null default '' | 2차인증(평문 — D9, 시트 11번 원문 그대로) |
| works_asset_id | integer null | 이 라이선스의 works 임대 건(assets.id) — 선택, 사람이 연결 |
| works_seq | text not null default '' | 그 임대 건의 순(classification_number) |
| installed_on / purchased_on / renews_on / ends_on | date null | |
| status | text not null default '사용중' check in ('사용중','미배정','회수','해지','만료') | |
| memo | text not null default '' | |
| source | text not null default 'app' check in ('app','sheet_renew','sheet_perm') | |
| source_key | text **unique** null | `perm:<시트 행번호>` / `renew:<시트 행번호>` |
| source_raw | jsonb not null default '{}' | 시트 원본 칸(**비밀 칸 제외**, 머리줄 이름 → 값) |
| created_by / updated_by / created_at / updated_at | | |
- 색인: contract_id, pc_asset_code, works_asset_id.

**④ `it_contract_secrets` — 비밀 칸 암호문** (`CONTRACT_SECRETS_TABLE`) — **lib/contracts/secrets.ts 한 파일만 읽고 씀**
| 칸 | 형 | 뜻 |
|---|---|---|
| id | uuid pk | |
| contract_id | uuid null references it_sw_contracts(id) on delete cascade | 계약 단위(사람이 넣는 관리 콘솔 계정·결제카드) |
| seat_id | uuid null references it_sw_seats(id) on delete cascade | 좌석 단위(시트에서 옮긴 것은 전부 여기) |
| field | text not null check in ('license_key','account','admin_account','card','other') | (mfa 없음 — D9) |
| sealed | text not null | `v1.<iv>.<tag>.<암호문>`(base64url) |
| key_version | smallint not null default 1 | |
| updated_by | text not null default '' | |
| created_at / updated_at | | |
- check `num_nonnulls(contract_id, seat_id) = 1`, `unique (contract_id, field)`, `unique (seat_id, field)`(부분 인덱스 아님).

**⑤ `it_contract_secret_log` — 열람·수정·인증 기록** (`CONTRACT_SECRET_LOG_TABLE`) — 값은 절대 안 적음
| 칸 | 형 | 뜻 |
|---|---|---|
| id | bigint generated always as identity pk | |
| at | timestamptz not null default now() | |
| action | text not null check in ('unlock_ok','unlock_fail','lock','view','view_bulk','edit','delete','import') | |
| actor | text not null default '' | 열 때 적은 이름 |
| client_id / contract_id / seat_id | uuid null (**FK 없음** — 지워져도 기록은 남게) | |
| client_name | text not null default '' | 그때 이름 |
| field | text not null default '' | |
| count | integer not null default 1 | |
| ip_hash | text not null default '' | IP를 HMAC한 앞 16자(원래 IP 저장 안 함) |
| ua | text not null default '' | 짧은 기기 이름(60자) |
| note | text not null default '' | |
- 색인 `(at desc)`, `(action, at desc)`, `(ip_hash, at desc)`. 실패 횟수 제한도 이 표로 셈.

되돌리기: `drop table if exists it_contract_secret_log, it_contract_secrets, it_sw_seats, it_sw_contracts, it_contract_clients;`. 코드는 표가 없으면 "SQL 먼저 실행" 안내만(works 거래처 목록은 그대로 보임).

### 3-4. 비밀 칸 보안 설계 (D2·D7 확정)

**암호화(앱 단계)**
- AES-256-GCM, 값마다 무작위 12바이트 IV, 16바이트 태그. **AAD = `it-contracts:v1:<seat|contract>:<owner id>:<field>`** → 암호문을 다른 줄·칸에 옮겨 붙이면 안 풀림.
- 열쇠: Vercel 환경변수 **`CONTRACT_SECRET_KEY`**(32바이트 base64, 44자). 없거나 길이가 틀리면 비밀 칸 기능만 꺼짐("설정 전"), 목록·상세는 정상.
- `sealed = v1.<iv>.<tag>.<ct>`, `key_version=1`. 열쇠 바꾸기(다시 암호화)는 범위 밖, 칸만 준비.
- 값·열쇠는 코드·SQL·문서·커밋·로그 어디에도 안 남김(저장소 공개). `console.*`에 평문·요청 본문 금지.

**목록·상세에는 비밀을 아예 안 실음**
- 목록/상세 액션은 ①②③만 **칸 이름을 적어서** select(`*` 금지). 상세에는 "어느 칸에 비밀이 있는지"(`secretFields`)만.
- `it_contract_secrets`를 부르는 곳은 `lib/contracts/secrets.ts`(server-only) 하나.
- flags 읽기는 `owner id, field`만 **페이지로**(시트만 옮겨도 456~714줄 → 1000 한도 근처, F12).

**보기 = 인증 비밀번호 → 짧은 쿠키 → 누른 칸만 복호화**
1. 환경변수 **`CONTRACT_PASSWORD_HASH`** = `pbkdf2-sha256$600000$<salt>$<hash>`(브라우저 설정 화면과 같은 계산이 되도록 PBKDF2). 서버에서 같은 계산 후 `timingSafeEqual`.
2. 성공 → **httpOnly · Secure(운영) · SameSite=Strict · Path=/** 쿠키 `it_ct_unlock` = `base64url({v:1, exp, name, pw:<해시 지문 8자>}).<HMAC-SHA256>`. 서명 열쇠는 `CONTRACT_SECRET_KEY`에서 HKDF로 따로 뽑음(info "unlock-cookie"). 유효 **10분**(§6 질문 2), 연장 없음. 해시 지문이 들어 있어 **비밀번호를 바꾸면 열린 쿠키 전부 무효**.
3. "보기" 누른 칸만 `revealSecret` → 쿠키 확인 → 그 한 칸 복호화 → 기록(`view`) → 값 반환. 화면은 [복사], **60초 뒤 다시 가림**, 탭이 숨겨지면 바로 가림.
4. "이 상품 모두 보기"(`revealContractSecrets`) — 한 계약 상품과 그 좌석들만, 기록 `view_bulk` + 개수. 거래처 전체·전체 내보내기 없음.
5. **비밀 칸 수정·삭제·비밀 있는 좌석 삭제·옮기기는 열람 중일 때만**(D2), 기록 `edit`/`delete`/`import`(값 없이). 잠긴 상태면 수정 버튼 대신 🔒.
- 열 때 이름 필수(2자 이상, 브라우저 기억, `it_staff_names` 후보) → 쿠키에 실려 이후 기록에 그대로.
- 화면 위 띠: "🔓 열람 중 · 홍길동 · 8분 남음 [잠그기]". 잠그기 = 쿠키 삭제 + `lock` 기록.

**실패 횟수 제한(DB 기반)**
- 확인 전에 `unlock_fail` 셈(count head): **같은 ip_hash 15분 안 5회 → 그 기기 15분 잠금**, **전체 15분 안 30회 → 모두 15분 잠금**. 잠금 중엔 비밀번호 계산도 안 함. 열람 기록 화면 위 "최근 24시간 틀린 시도 n회".

**인증 비밀번호 정하기·바꾸기 / 열쇠 만들기 — `/contracts/setup`**
- **브라우저 안에서만 계산**(서버 호출 없음, Web Crypto): ① 암호화 열쇠 만들기(무작위 32바이트) ② 비밀번호 해시 만들기(두 번 입력 → PBKDF2 600,000회). 인쇄용 보기 버튼.
- 사용자가 값을 **Vercel → Settings → Environment Variables (Production만)**에 붙이고 다시 배포(2~3분). 비밀번호는 채팅·카톡에 적지 않음. 해시는 클로드에게 넘겨도 되지만 열쇠는 넘기지 않기를 권함.
- 바꾸기 = 새 해시 → Vercel 값 교체 → 재배포 → 기존 열람 쿠키 모두 무효. 잊어버려도 데이터는 안전(새 해시로 바꾸면 끝).
- Preview 배포에는 두 값을 **넣지 않음**.

**열쇠를 잃으면**
- `CONTRACT_SECRET_KEY`를 잃으면 앱의 비번·키는 **누구도 못 풂**(Supabase 백업이 있어도). 백업: ① Vercel 변수(일반 변수 — 팀 소유자가 다시 볼 수 있음) ② **종이 한 장 회사 금고** 또는 관리자 비밀번호 관리 앱(§6 질문 4).
- 시트를 보관하는 동안은 시트가 마지막 안전망(새 열쇠로 다시 옮기기 가능 — 단 옮긴 뒤 앱에서 새로 넣은 비밀은 사라짐).

**고르지 않은 것**: Supabase Vault(열쇠가 DB 쪽 — DB 권한만으로 풀림), 비밀번호 해시를 DB에(화면에서 바로 바꿀 수 있지만 DB가 새면 같이 새고 "처음 정하기" 틈이 생김 — §6 질문 1).

### 3-5. 시트 → 앱 옮기기 (한 번, 배포된 앱에서, **빠짐없이** — D2·D3)

- 서버가 `values.batchGet` **한 번**에 두 탭(`'SW자산_갱신형'!A1:Z`, `'SW자산_비갱신형'!A1:AQ`). 미리보기 1회 + 반영 1회 = **읽기 2회**. 병합 정보는 안 읽음(실측상 없음).
- 칸은 **머리줄 이름으로 찾음**(앞뒤 공백·탭 제거 — "라이선스 키/ID\t"). 같은 이름 두 번(업체명·구매날짜)은 나온 순서. 비갱신형 머리줄 **2행**, 갱신형 1행. 필요한 머리줄이 없으면 "시트 칸 위치가 바뀌었어요"로 멈춤.
- **옮길 줄 = 아무 칸이라도 값이 있는 줄 전부.** 비밀 칸만 있는 줄도 좌석으로 옮김. 완전히 빈 줄만 셈에서 뺌(숫자로 보여 줌).
- **업체 정하기**: 비갱신형 = 3번 ‖ 21번. 비면 같은 계정 도메인(10번)의 다른 줄 업체가 **한 가지일 때만** "짐작". 갱신형 = 고객사, 비면 계정 도메인(6·7번) 묶음. 그래도 없으면 "업체 모름" 묶음.
- **어느 묶음도 버리지 않음**: 사람이 거래처를 안 고른 묶음은 **"미분류(시트에서 옮김)" 거래처**(`not_in_works=true`)로 들어감 → 나중에 [다른 거래처로 옮기기](`moveSwContract`). "건너뛰기" 선택지 없음.
- **묶음(계약 상품)**: (거래처, 정리된 상품명, 유형 원문, 정리된 매입처). 한 줄 = 좌석 하나.
- 유형 원문 → 칸: "영구…" perpetual/once · "월 구독" subscription/monthly/monthly · "년 구독/월 결제" subscription/yearly/monthly · "연 구독 / 연 결제"·"연 구독" subscription/yearly/yearly · "? 구독" subscription/''/'' · "무료" free · 빈 값 = 갱신형 탭이면 subscription, 아니면 unknown.
- 날짜: `YYYY-MM-DD` / `YY-MM-DD` / `YY. M. D` / `YYYY. MM. D` → date(YY는 20YY). 못 읽으면 null + `source_raw`에 원문 + 경고 수.
- 칸 → 좌석: 비갱신형 15→purchased_on(비면 16), 17→renews_on, 18→ends_on, 26→installed_on, 25→pc_asset_code, 23→user_name, 22→dept, 8 사용자→user_name이 비면. 갱신형 11→renews_on, 10→purchased_on, 12→status.
- 칸 → 계약 상품: 1 매입처, 2/8 상품, 12 유형, 13 비용→cost_note, 19 초기세팅업체, 머리 묶음 "admin.microsoft.com"→admin_portal. 칸 → 거래처(비었을 때만): 6·7 담당, 4·5 키맨.
- **2차인증(비갱신형 11번)은 비밀 칸이 아님(D9)** → 좌석 `mfa_note`에 원문 그대로(평문), `source_raw`에도 포함 가능.
- **비밀 칸은 시트 칸 하나 = 좌석 비밀 하나(1:1, 합치지 않음)** — 빠짐없음 확인을 단순하게: 비갱신형 9→`license_key`, 10→`account`, 14→`card` / 갱신형 6→`account`, 7→`admin_account`. (`mfa`는 쓰지 않음 — D9) 값은 손대지 않고 그대로(앞뒤 공백만 유지 여부: **그대로**, 줄바꿈 포함).
- **미리보기(쓰기 없음)** — 브라우저로 비밀 값을 **보내지 않고** 개수만:
  - 시트 업체 묶음마다: 시트 이름 → 추천 거래처(정규화 이름 같음 = "자동 매칭", 포함·거의 같음 = "확인 필요(후보)", 없음 = "works에 없음") · 줄 수 · 상품 · 비밀 칸 수. 선택: [works 거래처 ▼] / [새 거래처(works에 없음)] / [미분류로].
  - 업체 모름 묶음: "계정 도메인 @…" 힌트(열람 중에만 보이는 화면이라 허용) + 같은 선택.
  - **이름 정리표**: 상품명 11종·매입처 8종 오타 합치기.
  - **옮길 숫자 미리 보기**: 탭별 읽은 줄 / 빈 줄 / 옮길 좌석, 비밀 칸 종류별 개수(위 실측: 라이선스 키 172 · 마스터 계정 226 · 사용자계정 29 · 관리자계정 29 · 2차인증 218 · 카드 40), 이미 옮긴 것.
  - 시트 지문(전체 값의 sha256)만 돌려줌.
- **반영** — 선택(묶음 → 거래처 / 새 이름 / 미분류, 이름 정리표, 지문)을 받아 **시트를 다시 읽고** 지문이 다르면 "시트가 바뀌었어요 — 미리보기 다시"로 멈춤. 같으면:
  1. 거래처(없으면 만듦, name_key 충돌이면 기존 것), 고른 works 거래처면 그 줄 id·코드를 `seen_asset_ids`·`vendor_codes`에 더함.
  2. 계약 상품 upsert(onConflict `source_key`, **ignoreDuplicates**).
  3. 좌석 insert(onConflict `source_key`, ignoreDuplicates) → `source_key`로 id 다시 읽기.
  4. 비밀: 칸마다 암호화해 insert(`unique(seat_id, field)`, ignoreDuplicates).
  5. **확인**: 옮길 대상이던 모든 비밀 칸에 대해 DB에서 다시 읽어 **복호화한 값이 시트 값과 같은지** 서버 메모리에서 비교(평문은 응답·로그에 안 실음).
  6. 기록 `import`(개수).
- **결과 화면 숫자(D2)** — 표로:
  | | 갱신형 | 비갱신형 |
  |---|---|---|
  | 시트 줄(빈 줄 제외) | 32 | 229 |
  | 좌석: 새로 옮김 / 이미 있었음 | n / n | n / n |
  | 비밀 칸(종류별): 시트 / 암호화 저장(새로·이미) / **복호화 확인** | … | … |
  | **빠진 것** | 0 | 0 |
  빠진 것이 0이 아니면 시트 행 번호·칸 이름 목록(값 없이)과 [빠진 것만 다시 옮기기]. 미분류로 들어간 묶음 수도 표시.
- **여러 번 눌러도 중복 없음, 앱에서 고친 것도 안 덮음**(추가만). 첫 반영 뒤 시트에서 고친 값은 다시 안 들어옴(앱이 원본).
- 260줄 남짓 → 한 요청 안에 끝. 옮기기는 PC에서(핸드폰은 안내만).

### 3-6. 계산 규칙 (DB를 안 부르는 순수 함수 — QA가 Node로 바로 돌림)

**`lib/contracts/nameKey.ts`** — `nameKey(name)`, `vendorCodeKey(raw)`(10자리/P번호, 주민번호 꼴 → ''), `similarNames(a, b)`(포함 또는 편집거리 ≤ 2, 3자 미만 제외). import 없음.

**`lib/contracts/grouping.ts`** — `groupWorksRows(rows)` → 임시 거래처들(§3-2 묶기), `matchClients(groups, savedClients)` → 각 묶음의 우리 행·맞춘 방법(asset/code/name/new)·이름 바뀜·둘로 나뉨. import 없음.

**`lib/contracts/renewal.ts`** — 계약 상품의 다음 날짜·상태
- 보는 날짜: `ends_on`(계약·좌석), `renews_on`(계약·좌석) — **단 term이 'monthly'면 renews_on은 안 봄**(매달 오는 날짜라 늘 30일 안으로 떠서). '해지'·'만료' 상태는 제외.
- `expired`(지난 날짜) / `due30`(30일 안) / `ok` / `nodate`. 거래처 값 = 가장 급한 것.
- "갱신 처리": renews_on을 term만큼(비면 1년) 뒤로 — 시트 날짜가 안 고쳐진 줄이 많아 첫날 "날짜 지남"이 많을 수 있음.

**`lib/contracts/schedule.ts`** (2단계) — 방문 주기
- 주기: '' 미설정 / none 없음 / monthly 1개월 / bimonthly 2 / quarterly 3 / halfyear 6 / yearly 12 / days n일. 달 더하기는 말일 맞춤(1/31 + 1개월 = 2/28).
- 기준 = 마지막 "방문으로 세는" 기록의 방문일(KST) → 다음 예정 = 기준 + 주기. 기록이 없으면 `visit_anchor`가 다음 예정. 둘 다 없으면 `needs_first`(밀림 아님).
- 방문으로 세는 기록 = 숨기지 않음 + 보완 기록 아님 + 종류 '원격 지원' 아님(§6 질문 5).
- 상태: `unset`("상세 미입력") / `none` / `needs_first` / `ok` / `soon`(7일 안) / `overdue`(며칠). 계약 종료 거래처는 밀림으로 안 셈.

### 3-7. 화면·서버가 주고받는 모양 — `lib/contracts/types.ts` (server-only 아님, **팀장이 먼저 만듦**)

```ts
export const SW_ITEMS = ['소프트웨어'] as const;
export const PCM_ITEMS = ['PC유지보수'] as const; // 복합기유지보수는 CS팀 몫 — 넣지 않음
export type ContractTab = 'sw' | 'pcm';
export type ClientState = 'active' | 'ended' | 'manual';
export type EndedReason = 'rental_ended' | 'not_in_works' | 'manual' | null;
export type MatchedBy = 'asset' | 'code' | 'name' | 'new';
export type ListSource = 'works' | 'rental_copy' | 'none';
export type SecretField = 'license_key' | 'account' | 'admin_account' | 'mfa' | 'card' | 'other';
export type LicenseType = 'perpetual' | 'subscription' | 'free' | 'unknown';
export type RenewalState = 'expired' | 'due30' | 'ok' | 'nodate';

export type WorksLine = { // works assets 한 줄(품목 필터 후) — 거래처 코드는 안 실음
  assetId: number; seq: string; vendorName: string; siteName: string; assetCode: string;
  modelName: string; serial: string; item: string; status: string; contractDate: string; endDate: string;
};
export type ClientSummary = {
  key: string;            // 저장된 거래처 = id, 아직 없음 = 'new:<열쇠>'
  id: string | null; name: string; worksName: string; matchedBy: MatchedBy;
  state: ClientState; endedReason: EndedReason; needsDetail: boolean;
  activeLines: number; endedLines: number; firstContract: string; lastContract: string; sites: string[];
  notice: string | null;  // "works 이름이 바뀌었어요: 옛 → 새" / "거래처가 둘로 나뉘어 있어요"
  products: { name: string; count: number }[]; licenseCount: number; // SW
  nextDate: string | null; renewal: RenewalState;                    // SW
  salesOwner: string; itOwner: string;
  searchText: string;     // 상품·사용자·PC 자산번호(소문자) — 비밀 없음
};
export type ContractsOverview = {
  tab: ContractTab; clients: ClientSummary[];
  source: ListSource; sourceMs: number; sourceError: string | null; readAt: string;
  tablesMissing: boolean; secretsConfigured: boolean;
};
export type SwSeat = {
  id: string; userName: string; dept: string; pcAssetCode: string; worksAssetId: number | null; worksSeq: string;
  installedOn: string | null; purchasedOn: string | null; renewsOn: string | null; endsOn: string | null;
  status: string; memo: string; secretFields: SecretField[]; sourceRaw: Record<string, string> | null; updatedAt: string;
};
export type SwContract = {
  id: string; product: string; supplier: string; licenseType: LicenseType; term: '' | 'monthly' | 'yearly';
  payCycle: '' | 'monthly' | 'yearly' | 'once'; licenseTypeRaw: string; quantity: number | null;
  startsOn: string | null; renewsOn: string | null; endsOn: string | null;
  costNote: string; adminPortal: string; setupVendor: string; status: string; memo: string; source: string;
  secretFields: SecretField[]; seats: SwSeat[]; nextDate: string | null; renewal: RenewalState;
};
export type ClientDetail = {
  client: ClientSummary & { memo: string; keyPerson: string; keyPhone: string; aliasKeys: string[]; manualStatus: '' | 'ended' | 'hidden'; notInWorks: boolean };
  lines: WorksLine[]; source: ListSource; contracts: SwContract[];
};
export type UnlockState = { configured: boolean; unlocked: boolean; name: string; expiresAt: string | null; lockedUntil: string | null };
export type SecretOwner = { contractId: string } | { seatId: string };
export type SecretLogRow = { at: string; action: string; actor: string; clientName: string; field: string; count: number; ua: string; note: string };

export type ImportMatch = 'exact' | 'similar' | 'none';
export type ImportGroup = {
  groupKey: string; tab: 'renew' | 'perm'; sheetName: string; guessedBy: 'name' | 'domain' | 'none';
  domainHint: string; rows: number; products: { name: string; rows: number }[];
  secretCounts: Partial<Record<SecretField, number>>; match: ImportMatch;
  candidates: { key: string; name: string }[]; alreadyImported: number;
};
export type ImportCounts = { // 탭별
  sheetRows: number; blankRows: number; seats: number;
  secrets: Partial<Record<SecretField, number>>; // 시트에서 값이 있는 칸 수
};
export type ImportPreview = {
  fingerprint: string; groups: ImportGroup[]; counts: { renew: ImportCounts; perm: ImportCounts };
  productNames: { name: string; rows: number }[]; supplierNames: { name: string; rows: number }[]; warnings: string[];
};
export type ImportChoice = { groupKey: string; target: { clientKey: string } | { newName: string } | 'unsorted' };
export type ImportPlan = { fingerprint: string; choices: ImportChoice[]; productRenames: Record<string, string>; supplierRenames: Record<string, string> };
export type ImportTabResult = {
  sheetRows: number; seatsInserted: number; seatsExisting: number;
  secrets: Partial<Record<SecretField, { sheet: number; inserted: number; existing: number; verified: number }>>;
  missing: { row: number; field: SecretField | 'seat' }[]; // 값 없이 위치만
};
export type ImportResult = { clientsCreated: number; contractsCreated: number; unsortedGroups: number; renew: ImportTabResult; perm: ImportTabResult };
```

**서버 액션(이름·인자 고정, 모두 `{ ok: true; … } | { ok: false; error: string }`)**
- `app/contracts/actions.ts`: `getContractsOverview(tab)` · `getClientDetail(key)` · `saveClient(input, actor)`(key가 'new:'면 만들고 id 반환, 맞은 줄 id·코드 더함) · `addClientAlias(clientId, otherKey, actor)`(합치기 — 다른 저장된 거래처의 주 이름이면 거절) · `createManualClient(name, actor)` · `saveSwContract(input, actor)` · `deleteSwContract(id)`(좌석 0개일 때만) · `moveSwContract(contractId, clientKey, actor)` · `saveSwSeat(input, actor)`(비밀 칸 제외) · `addSwSeats(contractId, count, actor)`(최대 200) · `renewSwContract(id, actor)` · `listSecretLog(limit = 200)`.
- `app/contracts/secretActions.ts`: `getUnlockState()` · `unlockSecrets(password, name)`(`lockedUntil` 포함 실패) · `lockSecrets()` · `revealSecret(owner, field)`(쿠키 없으면 `{ ok:false, needUnlock:true }`) · `revealContractSecrets(contractId)` → `{ values: { owner: SecretOwner; field: SecretField; value: string }[] }` · `saveSecret(owner, field, value)`(빈 값 = 삭제, 쿠키 필수) · `deleteSwSeat(id)`(비밀 있으면 쿠키 필수 — 좌석 삭제는 여기로 일원화).
- `app/contracts/importActions.ts`: `previewSheetImport()` · `applySheetImport(plan)` → `ImportResult`. 둘 다 쿠키 필수.

**공용 함수 모양 — A·B·C가 이 모양에 맞춤**
```ts
// lib/works/client.ts (B가 추가, 기존 함수 안 건드림)
export async function fetchWorksAssetsByItems<T>(items: readonly string[], selectCols: string, opts?: { timeoutMs?: number }): Promise<T[]>;
// lib/contracts/worksSource.ts (B, server-only)
export async function loadContractAssets(): Promise<{ lines: (WorksLine & { vendorCodeKey: string })[]; source: ListSource; ms: number; error: string | null }>;
// lib/contracts/secrets.ts (A, server-only)
export class UnlockRequired extends Error {}
export function secretsConfigured(): boolean;
export async function requireUnlock(): Promise<{ name: string }>;
export async function secretFlags(ids: { contractIds: string[]; seatIds: string[] }): Promise<Map<string, SecretField[]>>; // 페이지·200개씩
export async function insertSecretsIfMissing(rows: { contractId?: string; seatId?: string; field: SecretField; plain: string }[], actor: string): Promise<{ inserted: number; existing: number }>;
export async function verifySecrets(rows: { seatId: string; field: SecretField; plain: string }[]): Promise<{ verified: number; mismatched: { seatId: string; field: SecretField }[] }>;
export async function logSecretEvent(e: { action: string; actor: string; clientId?: string; contractId?: string; seatId?: string; clientName?: string; field?: string; count?: number; note?: string }): Promise<void>; // 실패해도 안 던짐
```

---

## 4. 화면 흐름

### 1단계 — 소프트웨어 계약 (`/contracts?tab=sw`)

**PC**
1. 사이드바 '임대·청구' → **계약 관리**. 탭 [소프트웨어 계약] [PC 유지보수(2단계)]. 오른쪽 위 "works에서 방금 읽음 · 0.4초" (사본으로 대신이면 주황 띠, 못 읽으면 빨간 띠 + [다시 읽기]), 열람 띠(🔒 잠김 / 🔓 열람 중 · 이름 · n분 남음 [잠그기]). 목록은 틀 먼저, 도착하면 채움.
2. 숫자 칩(누르면 거름): 거래처 n · **상세 미입력 n** · **30일 안 갱신·만료 n** · 날짜 지남 n · 계약 종료 n · works에 없음 n + 검색칸(거래처·상품·사용자·PC 자산번호) + [⋯ 관리: 시트에서 옮기기 · 열람 기록 · works에 없는 거래처 추가].
3. 표: 거래처 · 상태 배지 · 상품 요약("M365 Apps ×26 · Office H&B 2021 ×112") · 임대 n건 / 라이선스 n개(다르면 주황) · 다음 날짜 · 담당 · [열기]. 정렬 = 날짜 지남 → 30일 안 → 상세 미입력 → 이름순, 계약 종료는 맨 아래.
4. [열기] → 거래처 창: 위 = 거래처 정보(키맨·담당·메모, 안내 문구, "같은 거래처로 합치기") + works 줄 접힘 목록(순·자산번호·모델·현장·상태). 아래 = 계약 상품 카드들 — 상품·매입처·유형·수량·날짜·비용·상태 + 계약 비밀 칸 + 좌석 표(사용자·부서·PC 자산번호(누르면 `/?asset=`)·임대 건 연결(선택)·날짜·상태·🔒 키/계정). [상품 추가] [좌석 n개 추가] [갱신 처리] [다른 거래처로 옮기기].
5. 🔒 보기(잠김) → 인증 창: 이름(기억) + 인증 비밀번호 → 성공하면 누른 칸이 바로 열림(60초 뒤 가림, [복사]). 틀리면 "남은 시도 n회", 잠기면 "15분 뒤 다시".
6. 비밀 칸 [수정] → 열람 중일 때만 보임 → 비밀번호식 입력(보기 토글) → 저장 → 기록.
7. 열람 기록(⋯ 관리): 최근 200건 — 언제 · 누가 · 무엇 · 거래처 · 칸 · 기기, 위에 "최근 24시간 틀린 시도 n회".

**시트에서 옮기기(PC, 열람 중일 때만)**: ① 미리보기(묶음별 거래처 고르기, 옮길 숫자) → ② 이름 정리 → ③ "좌석 n · 비밀 칸 n개를 옮길까요?" → 반영 → **결과 숫자 표(§3-5) — 빠진 것 0 · 복호화 확인 n/n** → "한 번 더 눌러도 새로 0이어야 정상".

**핸드폰(≤640px)**
- 탭·칩은 감싸서, 필터·검색은 `MobileFilterRows`. 표는 `m-cards`: 거래처 `title` · 상태 `badge` · 상품 요약 `inline` · 임대/라이선스 수 `sub` · 다음 날짜 `inline` · 담당 `hide` · [열기] `actions`.
- 거래처 창은 아래 시트(전체 높이, `100vh` 금지). 좌석 표도 `m-cards`(사용자 `title` · 상태 `badge` · PC `inline` · 날짜 `sub` · 🔒 `actions`).
- 인증 입력칸 16px 이상, `autocomplete="current-password"`. [복사]는 크게.
- 옮기기는 "PC에서 해 주세요" 안내만.

**설정 화면 `/contracts/setup`**(메뉴엔 없음, "설정 전" 안내에서 링크): 열쇠 만들기 / 비밀번호 해시 만들기 / 인쇄용 보기 / Vercel에 넣는 순서.

### 2단계 — PC 유지보수 (`/contracts?tab=pcm`)

**핸드폰(주 사용)**
1. 홈 화면 앱 → 계약 관리 → [PC 유지보수](마지막 탭 기억). 칩: **밀린 곳 n** · 이번 주 예정 n · 상세 미입력 n.
2. 카드 목록(밀린 순 → 예정일 순): 거래처 `title` · 상태 배지(n일 밀림/이번 주/첫 방문 필요/주기 없음) · 주기·마지막 방문 `inline` · 대수(데스크탑 n · 노트북 n · IT소프트웨어 n) `sub` · [방문 기록] `actions`.
3. 거래처 화면: 다음 방문 예정·주기·서비스 항목, 기기 목록(works 줄 — 순·자산번호·모델·현장, 접힘), 최근 방문 5건(보완 기록은 원래 기록 아래), [방문 기록 쓰기].
4. 방문 기록 폼(아래 시트 전체 화면): 방문 일시(기본 지금) · 종류 칩(정기 방문/요청 방문/설치·교체/원격 지원/기타) · 한 일 칩 + 직접 · 손본 기기 칩(그 거래처 works 줄에서 여러 개) + 목록에 없는 기기 · 내용 · 응대자 · 다음에 할 일 · 사진(고르면 바로 줄여 올림) · 작성자(기억) → [저장].
5. 저장 → "저장했어요 · 다음 방문 12/20". 쓰다가 앱이 꺼지면 다음에 "11/20 14:32에 쓰던 내용을 이어 씁니다 [새로 쓰기]".
6. 저장한 기록은 고치지 않음 → [보완 기록 쓰기] / [잘못 쓴 기록 숨기기](이름·이유 필수).
- works를 못 읽어도 폼은 열림(기기 칩은 사본 또는 직접 입력).

**PC**
- 표: 거래처 · 상태 · 주기 · 마지막 방문 · 다음 예정 · 대수 · 담당 · [열기]. 칩: 밀린 곳만/이번 달 예정/주기 미설정/계약 종료.
- 거래처 창에서 **주기 설정**(미설정/없음/매월/격월/분기/반기/매년/직접 n일) + 첫 방문 예정일 + 방문 메모 + 서비스 항목.
- [방문 기록] 보기: 모든 거래처 방문을 달별로.

**홈 카드 "📑 계약"** (`<Suspense>` — works를 읽으므로): 30일 안 갱신·만료 n(warn) · 날짜 지남 n(warn) · 상세 미입력 n(색 없음) · (2단계) 방문 밀린 곳 n(**bad**) · 이번 주 방문 예정 n. 경고 순서: 방문 밀린 곳 → 날짜 지남 → 30일 안. works를 못 읽으면 사본 기준으로 계산하고 카드에 "(사본 기준)".

---

## 5. 작업 분해

### 0. 팀장 사전 작업 (병렬 시작 전)
- **청구 배분 작업 먼저 커밋·배포**(F13 — lib/homeDashboard.ts·lib/supabase/server.ts 겹침).
- `lib/contracts/types.ts`(§3-7 그대로), `lib/supabase/server.ts`에 상수 5개(`CONTRACT_CLIENTS_TABLE`, `SW_CONTRACTS_TABLE`, `SW_SEATS_TABLE`, `CONTRACT_SECRETS_TABLE`, `CONTRACT_SECRET_LOG_TABLE`). 바꿀 필요가 생기면 직원은 고치지 말고 보고에.

### 1단계 (소프트웨어 계약) — 동시에: db-schema ∥ ui-designer ∥ developer A ∥ B ∥ C → sql-review → qa-checker → deploy-check

**db-schema (정규화)** — `supabase/contracts_schema.sql`(새)
- §3-3 ①~⑤, check·unique(부분 인덱스 금지)·FK·색인·트리거·RLS·revoke·reload schema. 머리 주석(날짜·목적·실행·비밀 값 없음·되돌리기). 기존 표 변경 없음. 두 번 실행해도 안전.
- 끝나면 **sql-review**(비밀 표 revoke, 로그 FK 없음, `num_nonnulls`, 두 번 실행).

**ui-designer (고화질)** — `components/contracts/ContractsPage.tsx`(탭·출처 띠·열람 띠), `SwClientList.tsx`, `SwClientModal.tsx`, `SwContractCard.tsx`, `SecretValue.tsx`(🔒 보기·복사·60초 가림·수정), `UnlockDialog.tsx`, `SheetImportModal.tsx`(결과 숫자 표 포함), `SecretLogView.tsx`, `components/Shell.tsx`(메뉴 한 줄), `app/globals.css`(핸드폰 블록에 꼭 필요한 것만)
- 서버 액션은 §3-7 이름으로만. 표는 `m-cards`+`data-m`, 필터 `MobileFilterRows`, 입력 16px.
- 상태 여섯 가지: 빈 목록 · 로딩 · 오류 · 표 없음(SQL 먼저) · 비밀 칸 설정 전 · works 대신 사본/못 읽음.

**developer A (구동민, model: opus — 보안)** — `lib/contracts/crypto.ts`(server-only: AES-256-GCM+AAD, PBKDF2 확인, HKDF, 쿠키 서명·확인, IP HMAC), `lib/contracts/secrets.ts`(§3-7 함수 + 실패 횟수 제한), `app/contracts/secretActions.ts`, `app/contracts/setup/page.tsx` + `components/contracts/SecretSetupTool.tsx`(Web Crypto — PBKDF2 형식·횟수를 서버와 똑같이)
- 쿠키: Next 15 `await cookies()`로 set/delete, `secure`는 운영에서만. 복호화 실패는 "열쇠가 다르거나 값이 손상됨"만.
- 환경변수가 없으면 `configured:false`로 비밀 액션 모두 거절(목록은 정상).

**developer B (구동민 2)** — `lib/works/client.ts`(**`fetchWorksAssetsByItems`만 추가**), `lib/contracts/worksSource.ts`(works → 실패 시 it_rental_list 사본, 시간 잼), `lib/contracts/nameKey.ts`·`grouping.ts`·`renewal.ts`(순수), `lib/contracts/clients.ts`(server-only: 개요·상세 조립, 맞은 줄 id·코드 더하기), `app/contracts/actions.ts`, `app/contracts/page.tsx`(searchParams.tab, Shell activeMenu '계약 관리', 목록은 `<Suspense>`), `lib/homeDashboard.ts`(`loadContractsCard`), `app/home/page.tsx`·`components/home/HomeSections.tsx`(계약 카드 Suspense 래퍼)
- 개요 읽기는 동시에: works(또는 사본) · 거래처 · 계약 · 좌석(페이지). 비밀 flags는 상세에서만 `secretFlags`.
- 거래처 코드는 서버 안에서만(브라우저 응답에 안 실음). 쓰기 뒤 `revalidatePath('/contracts')`, `'/home'`.

**developer C (구동민 3)** — `lib/contracts/sheetParse.ts`(순수: 머리줄·업체/도메인 짐작·묶음·유형·날짜·칸 1:1 비밀 목록 — import 없음), `lib/contracts/sheetImport.ts`(server-only: batchGet 1회, 지문, 미리보기·반영·확인 §3-5), `app/contracts/importActions.ts`
- 미리보기 응답에 비밀 값 없음(개수·도메인 힌트만). 비밀 쓰기는 `insertSecretsIfMissing`, 확인은 `verifySecrets`만.

**integration-rules: 불필요** — 시트 **읽기만**, works **GET만**(쓰기·네이버·카톡 없음). qa가 읽기 횟수와 쓰기 API 0을 grep으로 확인.

**qa-checker (이상무)**
- 타입·빌드 종료 코드, 범위(§7), 핸드폰(`m-cards`·`data-m`, 입력 16px, 시트 `100vh` 없음), JSX 삼항 안 `{/* */}` 없음.
- **비밀 검사**: `CONTRACT_SECRETS_TABLE`는 lib/contracts/secrets.ts에만 · 계약 표 select에 `*` 없음 · `console.`에 평문 없음 · 저장소에 44자 base64·`pbkdf2-sha256$…` 값 없음 · 개요·상세·미리보기 반환에 비밀·거래처 코드 없음.
- **works 검사**: lib/works/client.ts 기존 함수 diff 0, 새 함수에 `order=id`·timeout·`no-store`·1000 미만이면 끝, 한국어 품목 값 인코딩. works 실패 흉내(잘못된 URL)로 사본 대신 보기 → 띠 문구, 사본도 실패 → 저장된 거래처만. 실패가 우리 표에 쓰기를 일으키지 않음.
- 순수 함수 Node 시험(Node 24 .ts 직접): nameKey·vendorCodeKey(주민번호 꼴 '' · `_NRD(2)` 떼기 · P번호), grouping(코드 묶음+이름 합치기, 맞추기 순서 asset > code > name, 이름 바뀜·둘로 나뉨), renewal(월 구독 무시, 해지 제외, 경계), sheetParse(가짜 행 — 업체 3‖21, 도메인 짐작 한 가지일 때만, 유형 7종, 날짜 4형식, 머리줄 바뀌면 오류, 비밀 칸 1:1 개수, 빈 줄만 제외).
- crypto 시험(그 자리에서 만든 시험용 열쇠): 왕복, AAD 다르면 실패, 태그 변조 실패, 쿠키 서명·만료·해시 지문, 브라우저와 같은 PBKDF2 결과.
- "배포 뒤 확인"(로컬 Supabase·works 없음): works 읽기 시간, 거래처 수(소프트웨어 ≈46 · PC유지보수 ≈20), 옮기기 결과 빠진 것 0·복호화 확인 = 저장 수, 두 번째 반영 새로 0, 틀린 비밀번호 5번 → 잠김, 잠그기 뒤 보기 → 인증 창, 열람 기록에 값 없음.

**deploy-check (안정빈)** — 배포 전후. `/contracts`·`/contracts/setup` 200, 홈 계약 카드, 화면 위 works 읽기 시간 기록.

**팀장(마무리)** — diff 직접(secrets.ts·crypto.ts·sheetImport.ts·works client), `lib/releases.ts`, CLAUDE.md "계약 관리" 절(works 실시간·사본 대신·열쇠 순서·비밀 칸 규칙·열쇠 백업·옮기기 숫자).

### 1단계 배포 순서
0. 청구 배분 커밋·배포 끝.
1. sql-review 통과한 `supabase/contracts_schema.sql`을 Supabase SQL Editor에서 실행.
2. 배포 → `/contracts`에 works 거래처가 "상세 미입력"으로 뜨는지, 화면 위 works 읽기 시간(works 키는 임대리스트 대조가 쓰는 것이 이미 Vercel에 있음).
3. 사용자가 `/contracts/setup`에서 열쇠·비밀번호 해시 만들기 → **열쇠를 종이/금고에 백업** → Vercel Production에 `CONTRACT_SECRET_KEY`, `CONTRACT_PASSWORD_HASH` → 다시 배포.
3-1. **인증 확인 먼저(D8)**: `/contracts` → 🔓 열기(맞는 비밀번호 → "열람 중 · 이름 · 10분" 띠) · 틀린 비밀번호(남은 시도 수) · [잠그기] → 다시 🔒 · "works에 없는 거래처 추가"로 시험 거래처를 만들어 상품·좌석 하나에 시험 비밀 칸을 넣고 → 보기·60초 가림·복사·수정·지우기 → 열람 기록에 값 없이 남는지. 사용자가 "잘 된다" 한 뒤 시험 거래처를 지우고 다음으로.
4. `/contracts` → 🔓 열기 → 시트에서 옮기기(미리보기 → 거래처 맞추기·이름 정리 → 반영).
5. 결과 표: 빠진 것 0, 비밀 칸 종류별 숫자가 §0 실측(라이선스 키 172 · 마스터 계정 226 · 사용자계정 29 · 관리자계정 29 …)과 같음, 복호화 확인 = 저장 수. 비밀 칸 3~4개를 시트와 눈으로 비교. 한 번 더 반영 → 새로 0.

### 2단계 (PC 유지보수) — db-schema ∥ ui-designer ∥ developer D → sql-review → qa-checker → deploy-check

**팀장 사전**: types.ts에 PCM 타입(`VisitCycle`, `PcmClientSummary`(ClientSummary + cycle·lastVisit·nextDue·dueState·overdueDays·기기 수), `PcmVisit`, `PcmVisitDraft`(id 포함)), 상수 `PCM_VISITS_TABLE`.

**db-schema** — `supabase/pcm_visits_schema.sql`(새)
- `it_contract_clients` 칸 추가(if not exists): `visit_cycle text not null default '' check in ('', 'none','monthly','bimonthly','quarterly','halfyear','yearly','days')`, `visit_every_days integer null check (1..366)`, `visit_anchor date null`, `visit_note text not null default ''`, `service_items text[] not null default '{}'`.
- `it_pcm_visits`: `id uuid pk`(**폼 열 때 브라우저가 만든 값** — default 없음), `client_id uuid not null references it_contract_clients(id) on delete restrict`, `client_name text not null`(스냅샷), `site_name text not null default ''`, `visited_at timestamptz not null`, `visit_kind text not null check in ('정기 방문','요청 방문','설치·교체','원격 지원','기타')`, `author text not null check (btrim(author) <> '')`, `companions text not null default ''`, `work_items text[] not null default '{}'`, `devices jsonb not null default '[]'`(`[{assetId(works assets.id), seq, assetCode, model}]` — check array), `body text not null default ''`, `customer_contact text not null default ''`, `next_action text not null default ''`, `photos jsonb not null default '[]'`(`[{path,url,w,h,at}]`, check array), `supplement_of uuid null references it_pcm_visits(id)`, `hidden_at timestamptz null`, `hidden_by text not null default ''`, `hidden_reason text not null default ''`, `created_at timestamptz not null default now()`.
- 색인 `(client_id, visited_at desc)`, `(visited_at desc)`. RLS·revoke. 되돌리기 주석(기록이 있으면 먼저 백업).
- **`it_pcm_service_items`(D11)**: `id uuid pk`, `name text not null unique (btrim <> '')`, `sort integer not null default 0`, `active boolean not null default true`, `created_at`. 예시 8개 insert(on conflict do nothing): 정기점검 · 원격지원 · 윈도우·보안 업데이트 · 백신 관리 · 백업 확인 · 프린터·네트워크 · 부품 교체 · 프로그램 설치. 화면(PC 유지보수 탭 ⋯ 관리 → 서비스 이름)에서 추가·삭제(삭제 = active false — 지난 방문 기록의 글자는 그대로). 거래처의 `service_items`·방문의 `work_items`는 이름 글자 배열(표 id 참조 안 함).

**ui-designer** — `components/contracts/PcmClientList.tsx`, `PcmClientModal.tsx`, `PcmVisitForm.tsx`, `PcmVisitList.tsx`, `ContractsPage.tsx`(탭 켜기 — 2단계엔 ui-designer만).

**developer D** — `lib/contracts/schedule.ts`(순수), `lib/contracts/pcmVisitDraft.ts`(순수 — localStorage `firstoa-it.pcm-visit-draft.v1`, 7일 지나면 버림, 올린 사진 주소 포함), `app/contracts/visitActions.ts`(`getPcmOverview` · `savePcmSettings(clientKey, settings, actor)` · `savePcmVisit(draft)` → insert, **같은 id 중복(23505)이면 `{ ok:true, dup:true }`** · `hidePcmVisit(id, by, reason)` · `storePcmPhoto(base64, mediaType)` → `pcm-photos`(없으면 만듦, 공개, 무작위 경로) · `listPcmVisits({ clientId?, month? })`), `lib/contracts/clients.ts`(PCM 조립 — 2단계엔 D만), `lib/homeDashboard.ts`(방문 숫자).
- 방문은 **insert만**, 숨기기만 update. 사진은 고르는 즉시 올리고 실패하면 그 칸만 [다시], 덜 올라간 사진이 있으면 저장 막음.

**qa-checker** — schedule 시나리오(미설정/없음/기록 없음+기준일/둘 다 없음/말일/원격 지원·숨김·보완 안 셈/계약 종료 안 셈/경계), 같은 id 두 번 저장 → 1건, 초안 복원·7일 만료, works 못 읽을 때 폼 열림, 핸드폰(16px, `100vh` 금지), 사진 8mb 안.

### 3단계 (선택, 작게)
- 자산 상세(`components/AssetDetailModal.tsx`)에 "이 PC에 깔린 소프트웨어 n건(거래처)" · "PC 유지보수 거래처, 마지막 방문 11/02" 한 줄 + 링크. `it_sw_seats.pc_asset_code`·방문 `devices`로 찾음.

---

## 6. 위험·열린 질문

### 사용자에게 물을 것 (한 번에)

1. **인증 비밀번호를 바꾸는 방법**
   - 추천: **설정 화면에서 새 비밀번호의 '암호 글자'를 만들어 Vercel 설정에 붙이고 다시 배포**(2~3분, 클로드가 순서 안내). 비밀번호 정보가 데이터베이스에 안 남아 더 안전해요.
   - 다른 방법: 계약 화면에서 지금 비밀번호를 넣고 바로 바꾸기(편하지만 비밀번호 정보가 데이터베이스에 남음).
2. **한 번 비밀번호를 넣으면 몇 분 동안 다시 안 물을까요?** 추천: **10분**(핸드폰도 같음).
3. **가릴 칸 범위** — 확정: 마스터 아이디·비번, 라이선스 키/ID, 갱신형 사용자계정·관리자계정. 추천으로 **2차인증(전화번호가 들어 있어요)·월구독카드도 가림**. 키맨 연락처는 works·임대리스트에도 보이는 정보라 안 가려요. 괜찮을까요?
4. **암호화 열쇠 백업을 누가 어디에?** 이 열쇠를 잃으면 앱의 비번·키는 아무도 못 풀어요(일부러 그렇게 만든 것). 추천: **종이 한 장 회사 금고 + Vercel 설정**(두 곳). 보관할 분을 정해 주세요.
5. **(2단계) 방문 주기 셈과 서비스 이름**
   - 추천: 현장에 간 방문(정기·요청·설치)은 모두 "방문"으로 세고 **원격 지원은 안 셈.**
   - 유지보수 계약 서비스 이름을 알려 주세요. 없으면 이 예시로 시작: 정기점검 · 원격지원 · 윈도우·보안 업데이트 · 백신 관리 · 백업 확인 · 프린터·네트워크 · 부품 교체 · 프로그램 설치.

참고로 알려 드릴 것(질문 아님)
- 거래처 목록은 계약 화면을 열 때마다 firstoa-works에서 새로 읽어요. works가 잠깐 안 될 땐 임대리스트 사본으로 대신 보여 주고 화면 위에 알려 드려요(기록은 그대로).
- 시트 거래처는 12~15곳쯤이라 works 소프트웨어 거래처 46곳 중 **30곳 넘게 "상세 미입력"으로 시작**해요. 시트에만 있는 곳은 "works에 없음"으로, 업체를 못 정한 줄은 "미분류"로 일단 다 옮겨요(버리는 줄 없음).
- 옮긴 뒤 화면에 "시트 비밀 칸 n개 → 암호화 n개 → 다시 풀어서 확인 n개 · 빠진 것 0"이 나와요.
- 옮긴 뒤에도 **시트에는 비번이 그대로** 있어요. 한 달쯤 써 보고 문제없으면 시트의 비밀 칸만 지우는 걸 권해요(그 전까지는 열쇠를 잃었을 때의 안전망).
- PC유지보수 줄 중 모델명 "IT소프트웨어" 142줄은 팀장이 확인 중 — 답 전까지 기기 목록에서 모델별로 나눠 보여 줌.

### 위험 (개발·QA가 볼 것)
- **works 속도 모름**(F8) — 매번 읽기라 느리면 화면 전체가 느려짐 → Suspense로 틀 먼저, 시간 표시, 8초 넘으면 사본으로. 자주 2초 넘으면 그때 짧은 보관 검토(이번엔 안 함).
- **works 품목 이름**이 다르면 0곳 → 0줄 안내 + 배포 직후 거래처 수 확인.
- **거래처 코드의 개인정보**(F5) — 주민번호 꼴은 버리고, 코드는 서버 밖으로 안 보냄. QA grep.
- works가 사라지거나 품목이 바뀐 줄은 "계약 종료"로 보일 뿐 기록은 안 지움 — 일시적 장애로 종료처럼 보일 수 있어 사본·장애 띠로 구분.
- **열쇠 분실 = 비밀 영구 손실** — 백업 두 곳, 인쇄 버튼, CLAUDE.md. Preview 배포엔 열쇠 안 넣음.
- **로그인 없음** — 비밀 아닌 계약 정보는 주소를 아는 누구나 봄(임대리스트와 같은 수준). 비밀 칸만 인증. 인증 비밀번호는 팀 공용이라 "누가"는 본인이 적은 이름.
- **서버 액션은 누구나 부를 수 있음** → 비밀 관련 액션은 전부 서버에서 쿠키 확인. SameSite=Strict + Next의 Origin 확인.
- 비밀 flags가 1000줄 근처 → 페이지 읽기 필수.
- 시트 읽기 한도(IT재고와 공유) — 반영 버튼 누르는 동안 잠금, 한도면 "1분 뒤 다시"(재시도 루프 금지). 옮기기 중 시트가 바뀌면 지문으로 멈춤(의도).
- 갱신 날짜가 오래된 줄이 많으면 첫날 "날짜 지남"이 많음 → "갱신 처리"로 정리, 홈에서 bad 안 씀.
- 이름 정규화가 다른 두 곳을 하나로 볼 수 있음(드묾) → works 줄 id·코드가 먼저, 합치기는 사람이 누를 때만.
- 2단계 사진은 공개 버킷(주소를 알아야 봄, 출고 보고와 같음) — 폼에 "비번이 보이는 화면은 찍지 마세요".

---

## 7. 하지 않을 것 (범위 밖)

- `it_rental_list` 표·"대조→반영" 방식·`applyWorksSync` 변경, works 반영 자동화(크론). (works가 안 읽힐 때 사본을 **읽기만** 함)
- firstoa-works 쓰기, lib/works/client.ts 기존 함수 변경.
- 로그인·사람별 권한·사람별 비밀번호.
- 시트에 다시 쓰기·계속 맞추기, 시트 비밀 칸 지우기(나중에 사용자 결정).
- works 결과 보관(캐시) — "실시간" 결정.
- 좌석을 청구 금액과 대조(임대 건 연결 칸만 둠).
- 비밀 값 전체 내보내기·엑셀, 거래처 전체 한 번에 보기, 열쇠 바꾸기(다시 암호화) 화면.
- 라이선스 키 검증, 구독 결제·자동 갱신 처리, 비용 계산.
- 2단계: 카톡 발송, 네이버 캘린더 일정, FIELD 앱과 실제 연결(열쇠 seq·assets.id만 남김), 고객 서명, 방문 기록 수정.
- 복합기유지보수(CS팀 몫). 자산 상세 연결은 3단계(선택).
