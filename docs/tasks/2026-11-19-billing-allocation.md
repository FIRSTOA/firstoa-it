[기획실 도면우]

# 청구 "배분 확인 필요" → 임대 건 단위 자산번호 지정 (설계안, 2026-11-19)

크기: **큰 일** — 동기화 규칙 + 새 표 1개(SQL) + 청구리스트 새 보기 + 홈 카드. 기획 → 디자인·데이터 병렬 → 개발 2명 병렬 → QA.
DB는 로컬에서 못 읽음(.env.local Supabase 키 비어 있음, WORKS_* 키 없음) → 아래 숫자·구조는 전부 **파일 기준**. 실제 건수는 모름.

---

## 0. 지금 코드에서 확인한 것 (근거)

| # | 사실 | 위치 |
|---|---|---|
| F1 | works 청구 한 줄의 자산번호 = works 자산(`billings.asset_id` → `assets.id`)의 `asset_code`. 비어 있으면 `needs_review` | lib/rentals/worksBilling.ts:50-51, 67 |
| F2 | `rental_sheet_row` = works `assets.id` = `it_rental_list.sheet_row`(이름만 "시트 행") | lib/rentals/worksBilling.ts:60, lib/rentals/worksSync.ts:10-12, supabase/rentals_schema.sql:14 |
| F3 | 이름·자산번호 둘 다 빈 works 자산은 임대리스트에서 빠짐 → 그 자산을 가리키는 청구 줄은 `rental_sheet_row` null(임대 건 모름) | lib/rentals/worksSync.ts:147-149, app/rentals/actions.ts:179-180 |
| F4 | 반영 때 우리 줄과 works 줄을 `billingKey`(자산번호·임대 건·거래처·날짜·금액·상태·배분상태)로 비교해 다르면 works 값으로 통째로 덮음 → 사람이 넣은 자산번호가 다음 반영 때 null/needs_review로 돌아감 | app/rentals/actions.ts:107-117, 175-198, 298-300 / 행 모양 lib/billing.ts:81-96 |
| F5 | **추가 발견** — 청구리스트의 줄 단위 확인 버튼이 임대 건을 `null`로 넘김 → 확인하는 순간 임대 건 연결까지 지워짐(그래서 비교 키가 더 확실히 달라짐) | components/billing/BillingPage.tsx:76 |
| F6 | **추가 발견** — 청구리스트는 최근 500줄만 읽고(`limit(500)`), "배분 확인 필요만" 칩과 위 "배분 확인 필요 n건"은 그 500줄 안에서만 셈 → 홈은 1930건인데 청구리스트에선 훨씬 적게 보일 수 있음 | app/billing/actions.ts:128, components/billing/BillingPage.tsx:37-47, 92, 118-124 |
| F7 | 자산별 청구 합계는 `confirmed`·비취소만 셈 | lib/billing.ts:102-106, 114-123, app/asset-history/actions.ts:113, components/AssetDetailModal.tsx:283, 310, 323 |
| F8 | 자산 상세·자산 이력은 임대 건을 `it_rental_list.asset_code`로만 찾음 → works 자산번호가 빈 임대 건은 자산번호를 지정해도 그 자산 화면에 "임대 건 미지정(수기 입력 등)"으로 보임 | app/billing/actions.ts:91-103, app/asset-history/actions.ts:75-88, 131-148, components/AssetDetailModal.tsx:308 |
| F9 | 홈 청구 카드는 needs_review **줄 수**를 count head로 셈 | lib/homeDashboard.ts:261, 281, 285 |
| F10 | firstoa-works는 GET만 함(쓰기 코드 없음), 한 쪽이라도 실패하면 throw | lib/works/client.ts:35-74 |
| F11 | 청구 데이터는 2025-10부터만 있음(커밋 26bb4d7 메시지) → 임대 건 하나에 많아야 십몇 줄. 1930줄이 임대 건 몇 개인지는 **모름**(추정으로는 수백 개 규모일 수 있음 — 확인 필요) | git log 26bb4d7 |
| F12 | `it_billing_lines`에 `allocation_status`·`rental_sheet_row` 색인 있음, `updated_at` 트리거 있음 | supabase/billing_schema.sql:54, 56, 58-61 |

---

## 1. 한 줄 목표와 쓰는 사람

**자산번호 없는 청구를 "임대 건(기기 1대)" 단위로 한 번만 지정하면, 그 임대 건의 지난·앞으로의 청구 줄이 모두 그 자산번호로 확정되고, firstoa-works 대조·반영을 다시 해도 풀리지 않게 한다.** 홈 경고는 "자산번호 없는 임대 건 n개"로.

- 쓰는 사람: IT팀원 — 주로 **PC**(청구리스트에서 여러 건을 훑으며 처리). 핸드폰은 홈 숫자 확인 + 한두 건 지정 정도.

---

## 2. 기존 코드 재사용·확장 지점

| 파일:함수 | 어떻게 |
|---|---|
| app/rentals/actions.ts `buildSyncPlan` | 줄마다 자산번호를 정하는 규칙을 바꿈(§3-2). `existingRentals` 읽을 때 `asset_code`도 같이(138-140줄). 지정표 읽기 추가 |
| app/rentals/actions.ts `compareWorksSync`/`applyWorksSync`/`CompareResult` | 숫자 몇 개 추가, 반영 때 "옮겨 적을 지정"을 지정표에 먼저 씀 |
| lib/rentals/worksBilling.ts `readWorksBillingLines` | **안 바꿈**(works 원본 그대로 변환하는 역할만 유지 — 규칙은 plan에서) |
| app/billing/actions.ts `resolveBillingAllocation` | "임대 건 모름" 줄 전용으로 남김. works 줄인데 임대 건이 있으면 거절("임대 건으로 확인해 주세요") |
| app/billing/actions.ts `getAssetRentalHistory` | 지정표에서 이 자산번호로 지정된 임대 건도 같이 읽음(F8 해결) |
| app/asset-history/actions.ts `getAssetLifecycle` | 같은 방식으로 지정된 임대 건 포함 |
| lib/homeDashboard.ts `loadBillingCard` | 줄 수 → 임대 건 수(§3-4) |
| app/actions.ts `lookupKnownAsset` | 자산번호 입력칸 blur 때 "IT재고에 있음/없음" 안내(막지 않음) — 기존 BillingLineModal과 같은 방식 |
| lib/inventory/sheets.ts `listAllAssets` | 추천: IT재고 시리얼 일치 — **버튼 눌렀을 때만** 한 번(5탭 읽기) |
| it_rental_list(serial_number, asset_code) | 추천: 같은 시리얼의 다른 임대 건에 자산번호가 있으면(시트 읽기 없음) |
| components/MobileTableCards.tsx, MobileFilterRows.tsx | 새 표 핸드폰 카드·필터 접기 |
| FeedbackBoard.tsx `NAME_KEY` / StocktakeListPage.tsx `STARTED_BY_KEY` 패턴 | "지정한 사람" 이름 브라우저 기억(로그인 전) |
| app/home/feedbackActions.ts `isMissingTable` 패턴(44줄) | 새 표가 아직 없을 때 안내 |

---

## 3. 데이터 설계

### 3-1. 사람이 정한 자산번호를 어디에 둘까 — 세 가지 비교

| | (A) 표 안 바꿈 — 규칙만 | (B) 청구 줄에 표시 칸 추가 (`allocation_source`) | **(C) 임대 건별 지정표 새로 (추천)** |
|---|---|---|---|
| SQL | 없음 | `it_billing_lines`에 칸 추가 | 새 표 1개 |
| 반영 뒤 유지 | "우리 줄이 확정인데 works는 비었으면 유지" — 사람이 넣은 건지 works가 예전에 줬다가 지운 건지 **추측**해야 함 | 정확(줄마다 표시) | 정확(임대 건마다 한 줄) |
| **다음 달 새 청구 줄** | 같은 임대 건의 다른 줄에서 유추해야 함(추측 2단) | 같은 문제 — 형제 줄 유추 필요 | **자동**(임대 건에 붙어 있으니 새 줄도 바로 확정) |
| works가 청구 줄을 지웠다 다시 만들면 | 사람이 넣은 값 사라짐 | 사라짐 | 남음 |
| 누가·언제 | 기록 없음 | 칸 더 필요 | 기록됨 |
| works에 나중에 다른 번호가 들어오면 | 조용히 바뀜, 흔적 없음 | 흔적 약함 | "works와 다름"으로 보여 줄 수 있음 |
| 되돌리기 | 줄들을 직접 되돌림 | 같음 | 지정 한 줄 지우고 줄들 되돌림 |

**추천 (C)** — 사용자가 원한 "임대 건 하나에 한 번"이 데이터 모양 그대로 됨. (A)는 SQL 없이 되지만 추측 규칙이 두 겹이라 나중에 숫자가 이상할 때 원인 찾기가 어려움.
SQL을 원치 않으면(§6 질문 1) (A)로 갈 수 있게 아래 규칙은 표가 없어도 동기화가 죽지 않고 "줄 값 유지"까지는 되도록 설계함.

### 3-2. 새 표 `it_rental_asset_assignments` (파일 `supabase/rental_asset_assignments_schema.sql`, 상수 `RENTAL_ASSET_ASSIGNMENTS_TABLE`)

| 칸 | 형 | 뜻 |
|---|---|---|
| rental_sheet_row | integer **primary key** | works `assets.id` = `it_rental_list.sheet_row` |
| asset_id | text not null, 빈 값 금지 check | 사람이 정한 자산번호(대문자·앞뒤 공백 제거) |
| assigned_by | text not null default '' | 지정한 사람(로그인 전 — 직접 적고 브라우저 기억) |
| source | text not null default 'manual', check in ('manual','migrated') | migrated = 예전에 줄마다 넣은 값을 반영 때 자동으로 옮겨 적은 것 |
| note | text not null default '' | |
| created_at / updated_at | timestamptz default now() + `public.set_updated_at()` 트리거 | |

- 색인: `asset_id`(자산 상세에서 "이 자산으로 지정된 임대 건" 찾기).
- **FK 안 걸기**: 반영이 임대 건을 한꺼번에 지움(app/rentals/actions.ts:305-308). restrict면 반영이 실패하고, cascade면 works가 잠깐 행을 빼기만 해도 사람이 한 일이 사라짐. 고아 행은 해가 없고 "지정한 것" 목록에 "임대 건 없어짐"으로 보여 줌.
- 보안: RLS 켜고 정책 없음(다른 `it_*`와 같음).
- 되돌리기: `drop table if exists public.it_rental_asset_assignments;` — 코드는 표가 없으면 빈 지정표로 보고 계속 돎.
- `it_billing_lines`·`it_rental_list`는 **안 바꿈**.

### 3-3. 반영 때 줄마다 자산번호 정하는 규칙 (`buildSyncPlan` 안, 위에서부터 먼저 맞는 것)

입력: C = works 자산번호(`assetCodeById`), R = 임대 건(기존 currentSheetRows 확인 뒤 값), A = 지정표[R], P = 우리 DB의 같은 줄(있으면), W = 지난 반영 때 임대리스트에 있던 R의 `asset_code`(이번 반영 쓰기 전 값, 없으면 '').

| 순서 | 조건 | 결과 | 비고 |
|---|---|---|---|
| ① | C 있음 | C, confirmed | **works 우선**. A가 있고 A≠C면 "works와 다른 지정"으로 셈(지정은 지우지 않음) |
| ② | R 있음 + A 있음 | A, confirmed | 다음 달 새 줄도 여기서 자동 확정 |
| ③ | P가 confirmed + 자산번호 X 있음, P의 임대 건이 null이거나 R과 같음, **X ≠ W** | X 유지, confirmed | 사람이 줄 단위로 넣은 값(예전 줄 확인 버튼·수정 창). X = W면 works가 줬다가 지운 것이므로 유지 안 함. 임대 건이 바뀐 줄(works에서 다른 자산으로 옮겨진 줄)도 유지 안 함 |
| ③-옮김 | ③이고 R 있음 + 지정표가 있음 + 같은 R의 ③ 값이 모두 같음 | ③과 같음 + 반영 때 지정표에 (R, X, source 'migrated') 기록 | 서로 다르면 옮기지 않고 줄 값만 유지 |
| ④ | 그 밖 | null, needs_review | |

- 이 규칙을 적용한 **뒤에** `billingKey`로 비교 → 사람이 정한 줄은 두 번째 대조부터 "변동없음"(F4 해결, "다시 대조"가 영원히 "변경"으로 세지 않음). 예전 확인 버튼으로 임대 건이 null이 된 줄(F5)은 첫 반영에서 한 번 "변경"(임대 건 복구) 후 안정.
- 지정표를 못 읽으면(42P01/PGRST205) 빈 지정표로 계속 진행, ③-옮김은 건너뜀(③ 유지만). 다른 오류는 지금처럼 throw.
- 규칙은 DB를 안 부르는 순수 함수로 따로: `lib/rentals/allocationRule.ts` `decideAllocation(input) → { assetId, status, reason: 'works'|'assignment'|'kept'|'none', conflict }` (import 없이 — QA가 node로 직접 돌려 볼 수 있게).
- 알려진 한계: 반영이 시간 예산으로 중간에 멈추고(done:false) 그 사이 works가 자산번호를 **지운** 임대 건이 있으면, 다음 회차에서 W가 이미 ''라 ③이 옛 번호를 사람 값으로 오인할 수 있음. 두 일이 겹쳐야 하므로 드묾 — 그렇게 옮겨진 건 source 'migrated'로 "지정한 것" 목록에 표시돼 사람이 볼 수 있음.
- 지워진 줄: works에서 사라진 청구 줄은 지금처럼 삭제(app/rentals/actions.ts:199, 301-303). 지정은 임대 건에 붙어 있으므로 영향 없음.

### 3-4. 읽기 (1000줄 한도 대비)

- **확인 필요 줄 전부**: `allocation_status='needs_review'` → `select('id, rental_sheet_row, billing_date, amount, status, vendor_name, source_invoice_id, source_line_id, note')` `.order('id').range()` 페이지로 끝까지(지금 1930줄 ≈ 2번). 묶기는 서버 JS에서 `rental_sheet_row` 기준.
- **임대 건 정보**: `it_rental_list .in('sheet_row', 묶음)` — `.in()`은 주소에 실리므로 200개씩 나눠서.
- **묶음 기준은 `rental_sheet_row` 하나뿐** — `groupRentalRows`(거래처+현장+계약일)로 합치면 같은 날 같은 현장에 나간 **다른 기기**가 합쳐지므로 쓰지 않음.
- **추천** (사람이 확정 눌러야 저장, 자동 확정 없음):
  1. 임대리스트 같은 시리얼: `it_rental_list .in('serial_number', 시리얼들).neq('asset_code','')` (200개씩, 빈 값·'-'·4자 미만 시리얼 제외). 한 가지면 추천, 여러 개면 모두 보여 줌.
  2. 같은 임대 건의 이미 확정된 줄(③으로 남은 예전 값): `.in('rental_sheet_row', 묶음).eq('allocation_status','confirmed').not('asset_id','is',null)` 페이지.
  3. IT재고 시리얼 일치: 버튼 "IT재고에서 시리얼로 찾기" → `listAllAssets()` **한 번**(탭 5번 읽기)으로 전체 묶음 처리. 화면 열 때마다 자동으로 읽지 않음(분당 60회 한도, 캐시 안 함 원칙).
- **홈·청구리스트 위 숫자**: needs_review 줄의 `rental_sheet_row`만 페이지로 읽어 서로 다른 값 수 = 임대 건 수, null 수 = "임대 건 모르는 줄". 지금 2번 요청. (줄이 수만 개로 늘면 SQL view의 count distinct로 바꿀 수 있음 — 지금은 안 함)

### 3-5. 화면·서버가 주고받는 모양 (계약 — `lib/billingAllocationTypes.ts`, server-only 아님)

```ts
export type AllocationSuggestion = { assetId: string; source: 'rental_serial' | 'sibling_line' | 'inventory_serial'; detail: string };
export type AllocationGroup = {
  rentalSheetRow: number;
  vendorName: string; siteName: string; item: string; manufacturer: string; modelName: string; serialNumber: string;
  contractDate: string; endDate: string; rentalStatus: string;
  firstMonth: string; lastMonth: string; // 'YYYY-MM'
  lineCount: number; amountSum: number;  // 금액은 취소 제외
  suggestions: AllocationSuggestion[];
};
export type AssignmentState = 'active' | 'works_same' | 'works_differs' | 'rental_gone';
export type RentalAssignment = {
  rentalSheetRow: number; assetId: string; assignedBy: string; source: 'manual' | 'migrated'; createdAt: string;
  vendorName: string; siteName: string; modelName: string; serialNumber: string; worksAssetCode: string; state: AssignmentState;
};
export type ReviewSummary = { rentals: number; orphanLines: number; lines: number };
export type AllocationReview = {
  summary: ReviewSummary; groups: AllocationGroup[]; orphanLines: BillingLine[]; assignments: RentalAssignment[]; tableMissing: boolean;
};
```

서버 액션(app/billing/actions.ts, 이름 고정):
- `getAllocationReview(): Promise<{ ok: true; data: AllocationReview } | { ok: false; error: string }>`
- `confirmRentalAllocation(rentalSheetRow: number, assetId: string, assignedBy: string): Promise<{ ok: true; lines: number } | { ok: false; error: string }>`
  — 임대 건 있는지 확인 → 지정표 upsert(onConflict rental_sheet_row) → `it_billing_lines` update `asset_id, allocation_status='confirmed'` where `rental_sheet_row=R` and (`source_invoice_id='works-asset'` or `allocation_status='needs_review'`) (임대 건 연결은 그대로). 표 없으면 "SQL 먼저 실행" 오류(줄도 안 바꿈).
- `confirmRentalAllocations(items: { rentalSheetRow: number; assetId: string }[], assignedBy: string)` — 한 번에 최대 100건, 결과에 성공·실패 수.
- `clearRentalAllocation(rentalSheetRow: number)` — 지정 지움. 그 임대 건의 works 자산번호가 비어 있으면 works 줄 중 그 번호인 줄을 null/needs_review로 되돌림.
- `suggestFromInventory(serials: string[]): Promise<Record<string, string[]>>` — 시리얼 → IT재고 자산번호들.
- `resolveBillingAllocation`(기존 이름·인자 그대로) — 임대 건 모르는 줄만.

---

## 4. 화면 흐름

**PC**
1. 홈 청구 카드 "⚠ 자산번호 없는 임대 건 n개"를 누름 → `/billing?view=review`.
2. 청구리스트 위 보기 칩: **[청구 명세] [자산번호 확인 n] [지정한 것 m]** (기존 "배분 확인 필요만" 칩 자리). 위 요약 글: "자산번호 없는 임대 건 n개 · 임대 건 모르는 청구 k줄"(500줄 기준이 아닌 실제 숫자, F6 해결).
3. "자산번호 확인" 표 — 임대 건 한 줄: ☐ · 거래처·현장 · 품목·제조사·모델 · 시리얼 · 계약일~/상태 · 청구 기간(25-10~26-11)·n줄·합계 · 추천 · [자산번호 입력][확정]. 검색칸(거래처/모델/시리얼). 정렬: 마지막 청구 월 최신순 → 금액 큰 순. 많으면 앞 100개 먼저 + "더 보기".
4. 추천이 하나면 입력칸에 미리 채우고 옆에 출처("같은 시리얼 — 임대리스트 2024 ○○상사"). 입력칸 blur → "IT재고에 있음(노트북·모델)" / "IT재고에 없음 — 확인해 주세요"(막지 않음). 버튼 "IT재고에서 시리얼로 찾기"(전체 한 번).
5. [확정] → "이 임대 건 청구 n줄을 X로 확정할까요?" → 저장 → 그 줄 사라지고 숫자 줄어듦, 토스트 "n줄 확정". 처음 한 번 "지정한 사람" 이름을 물어 브라우저에 기억.
6. 여러 개 체크 → "선택한 n건 추천대로 확정"(추천이 한 가지인 줄만 체크 가능).
7. "지정한 것" — 누가·언제·상태 배지(적용 중 / works에도 같은 번호 / **works와 다름(works 번호로 집계 중)** / 자동 옮김 / 임대 건 없어짐) + [되돌리기]. 맨 아래 접힌 "임대 건 모르는 청구 k줄" — 지금처럼 줄마다 자산번호(임대 건 연결 안 지움).

- 청구 명세(기존 표)에서 works 줄의 "⚠️ 배분 확인 필요" 버튼은 임대 건이 있으면 "임대 건으로 확인 →"(확인 보기로 이동, 그 임대 건 검색). 수정 창(BillingLineModal)에서 works 임대 건 줄은 자산번호 칸을 잠그고 "임대 건으로 확인에서 지정" 안내.
- 임대리스트 "firstoa-works 대조" 창: 청구 명세 줄 아래 "✋ 우리가 지정한 자산번호 유지 n줄 · ⚠ works와 다른 지정 m건 · 줄 지정을 임대 건 지정으로 옮김 k건"(0이면 숨김), 표 없으면 "지정표 SQL 미실행" 한 줄.

**핸드폰(≤640px)**
- 보기 칩 줄은 가로 스크롤 없이 감쌈, 검색은 `MobileFilterRows`.
- 표는 `m-cards`: ☐ `check` · 거래처·현장 `title` · 상태 `badge` · 모델/시리얼 `inline` · 청구 기간·줄·합계 `sub` · 추천 `full` · 입력+확정 `actions`. 입력칸 16px 이상. 확인 창은 기존 모달(아래 시트).
- 여러 건 일괄 확정은 핸드폰에서도 같은 버튼(화면 아래 고정은 안 함 — 단순하게).

---

## 5. 작업 분해 (겹치지 않게)

순서: **db-schema ∥ ui-designer → sql-review(SQL만) → developer A ∥ developer B → qa-checker → 팀장(기록)**
integration-rules: **불필요** — firstoa-works는 읽기만(F10, 이번에도 쓰기 없음), 구글시트·네이버·카톡 쓰기 없음. 시트는 읽기 1곳(추천 버튼)뿐이라 qa가 읽기 횟수만 확인.

### db-schema (정규화) — 파일: `supabase/rental_asset_assignments_schema.sql`(새), `lib/supabase/server.ts`(상수 한 줄)
- §3-2 표, 색인, 트리거(`drop trigger if exists` → `create trigger`), RLS. 두 번 실행해도 안전. 머리 주석(날짜·목적·SQL Editor 한 번 실행·되돌리기).
- `RENTAL_ASSET_ASSIGNMENTS_TABLE = 'it_rental_asset_assignments'` 추가.
- 끝나면 **sql-review** → 통과한 SQL만 사용자에게.

### ui-designer (고화질) — 파일: `lib/billingAllocationTypes.ts`(새, §3-5 그대로 복사), `components/billing/BillingAllocationView.tsx`(새), `components/billing/BillingPage.tsx`, `components/billing/BillingLineModal.tsx`, `app/globals.css`(핸드폰 블록에 꼭 필요한 것만)
- BillingPage props: `{ initialLines: BillingLine[]; summary: ReviewSummary | null; initialView: 'lines' | 'review' | 'assigned'; review: AllocationReview | null }`. 보기 바꾸면 `router.replace('?view=…')`, review가 없으면 `getAllocationReview()` 호출(로딩·오류·빈 상태 셋 다).
- BillingPage.tsx:76 `resolveBillingAllocation(id, …, null)` → 그 줄의 `rentalSheetRow`를 넘기도록(F5). works 임대 건 줄은 "임대 건으로 확인 →".
- §4 화면 전부, 서버 액션은 §3-5 이름으로만 호출(구현은 developer B).
- qa에게 넘길 확인: 390px 가로 넘침 0, 빈 상태 문구("자산번호 없는 임대 건이 없어요"), PC 청구 명세 표 모양 그대로.

### developer A (구동민, **model: opus** — 규칙이 까다로움) — 파일: `lib/rentals/allocationRule.ts`(새), `app/rentals/actions.ts`, `components/rentals/RentalSyncModal.tsx`
- `decideAllocation` 순수 함수(§3-3, import 없음).
- `buildSyncPlan`: `existingRentals` select에 `asset_code` 추가 → W 맵, 지정표 전체 페이지 읽기(없으면 빈 맵 + `assignmentsTableMissing`), 줄마다 규칙 적용 후 비교, ③-옮김 후보를 R별로 모아 "모두 같을 때만" `assignmentAdoptions`.
- `CompareResult`에 `billingKeptCount`(reason이 assignment/kept인 줄), `assignmentConflictCount`(임대 건 수), `assignmentAdoptCount`, `assignmentsTableMissing` 추가. `applyWorksSync`: 임대리스트 → **지정 옮김(upsert, ignoreDuplicates — 사람이 만든 지정은 안 덮음)** → 청구 줄 순서.
- RentalSyncModal: §4 마지막 줄 문구만(0이면 숨김).
- `lib/rentals/worksBilling.ts`는 건드리지 않음.

### developer B (구동민 2) — 파일: `lib/billingAllocation.ts`(새, server-only), `app/billing/actions.ts`, `app/billing/page.tsx`, `app/asset-history/actions.ts`, `lib/homeDashboard.ts`
- lib/billingAllocation.ts: `readReviewLines`, `summarizeReview`(→ ReviewSummary, 홈과 청구리스트가 같이 씀), `readAssignments`(표 없음 → `[]` + missing 표시), `assignedRentalRowsForAsset(assetId)`, 추천 1·2 조회(200개씩 나눔, 페이지 읽기).
- app/billing/actions.ts: §3-5 액션 5개 추가, `resolveBillingAllocation`에 "works 줄 + 임대 건 있음 → 거절" 가드, `getAssetRentalHistory`에 지정된 임대 건 포함(`.or('asset_code.eq.X,sheet_row.in.(…)')`, 값은 SAFE_KEY 확인 — app/asset-history/actions.ts:52 방식). 각 쓰기 뒤 `revalidatePath('/billing')`, `'/'`.
- app/billing/page.tsx: `searchParams.view` 읽기, `summary`는 늘, `review`는 view가 review/assigned일 때만 서버에서.
- app/asset-history/actions.ts `getAssetLifecycle`: 75-88줄 임대리스트 조회에 지정된 임대 건 포함.
- lib/homeDashboard.ts `loadBillingCard`: 261줄 count → `summarizeReview`; 지표 "자산번호 없는 임대 건"(warn), k>0일 때만 "임대 건 모르는 줄"(색 없음), 이번 달 건수·금액 그대로; alert `자산번호 없는 임대 건 ${n}개`; href `/billing?view=review`.

### qa-checker (이상무)
- 타입·빌드 종료 코드, 범위(§7 대조), 비밀값, 핸드폰 코드 점검(새 표 `m-cards`·`data-m`, 입력칸 16px).
- **규칙 시나리오**: 임시 폴더에 node 스크립트로 `lib/rentals/allocationRule.ts`를 직접 불러(Node 24는 .ts 바로 실행) 아래 10개 확인
  1) C 있음 → C / 2) C 없음+A → A, 같은 입력 두 번째 비교 "변동없음" / 3) C≠A → C + conflict / 4) C 없음·A 없음·P=X·W='' → X 유지 + 옮김 후보 / 5) P=X·W=X(works가 지움) → needs_review / 6) R 없음·P=X → X 유지 / 7) 새 줄(P 없음)+A → A / 8) P의 임대 건 R1, 지금 R2 → needs_review / 9) 같은 R에 ③ 값 X·Y → 각자 유지, 옮김 없음 / 10) 지정표 없음 → 4)가 유지만, 옮김 없음.
- 시트 읽기: 청구리스트를 열기만 해서는 IT재고 읽기 0번, 버튼 1번 = `listAllAssets` 1번인지 코드로.
- 회귀: `getAssetRentalHistory`·`getAssetLifecycle`·`loadBillingCard`를 쓰는 화면(AssetDetailModal, /asset-history, /home) 이름 적기.
- 로컬은 Supabase 화면 확인 불가 → "배포 뒤 확인" 항목: 대조 두 번 연속 시 두 번째에 "변경" 0에 가깝게, 홈 숫자 = 청구리스트 숫자.

### 팀장(마무리)
- `lib/releases.ts` 맨 위 쉬운 말 한 줄, CLAUDE.md에 "청구 배분(임대 건 지정)" 절(규칙 ①~④, 지정표, works 우선, FK 없음 이유, 추천은 버튼일 때만 시트 읽기).
- 배포 순서: SQL 실행 → 배포 → 임대리스트 "firstoa-works 대조"(옮김 k건 확인) → 반영 → 다시 대조(변동없음 확인).

---

## 6. 위험·열린 질문

### 사용자에게 물을 것 (한 번에)

1. **작은 표 하나를 새로 만들어도 될까요?** (Supabase SQL Editor에서 한 번 실행 — 피드백 게시판 때와 같은 방법)
   - 추천: **예.** 임대 건마다 "누가 언제 몇 번으로 정했는지"가 남고, 다음 달 새 청구도 자동으로 확정돼요.
   - 아니면: 표 없이도 되지만 지난 줄만 지켜지고, 다음 달 새 청구는 또 "확인 필요"로 떠요. 누가 정했는지도 안 남아요.
2. **firstoa-works에 나중에 다른 자산번호가 들어오면 어느 쪽을 믿을까요?**
   - 추천: **firstoa-works 번호를 따르고**, 우리가 정한 번호는 "works와 다름"으로 남겨서 보이게(지우지 않음). works가 회사 원장이라서요.
   - 다른 방법: 우리가 정한 번호를 계속 우선.
3. **임대 건 자체를 모르는 청구 줄**(works에서 기기와 연결이 아예 없는 줄)은 홈 경고에 넣을까요?
   - 추천: **경고에는 안 넣고 숫자만 회색으로.** 이런 줄은 거래처도 비어 있어서 사람이 채울 단서가 거의 없어요. 청구리스트 맨 아래 따로 모아 줄마다 처리.
4. **추천 번호를 여러 개 한 번에 확정**하는 버튼을 둘까요?
   - 추천: **체크한 것만 한 번에(최대 100건).** 추천이 딱 한 가지인 것만 체크할 수 있게. 사람 확인 없는 자동 확정은 안 함.
5. **그동안 청구리스트에서 줄마다 넣은 자산번호**는 다음 대조 때 "임대 건 지정"으로 자동으로 옮기고 "자동 옮김" 표시를 남길게요(지금은 그게 다음 대조 때 지워지고 있었어요). 일부러 같은 기기 청구에 서로 다른 번호를 넣은 적이 있으면 알려 주세요 — 그런 건 옮기지 않고 그대로 둬요.

### 위험 (개발·QA가 볼 것)
- 실제 규모 모름 — 1930줄이 임대 건 몇 개인지, 임대 건 모르는 줄이 몇 줄인지 배포 전엔 알 수 없음. 목록은 100개씩 + 검색으로 대비.
- 반영 중간 멈춤 + works가 번호를 지운 경우 ③ 오인(§3-3 알려진 한계) — "자동 옮김" 표시로 사람이 볼 수 있게.
- `.in()` 주소 길이 — 200개씩 나눔. 시리얼에 쉼표·괄호 같은 글자가 있으면 supabase-js가 따옴표 처리하는지 developer가 확인.
- IT재고 추천 버튼은 누를 때마다 시트 5번 읽기 — 연달아 누르면 분당 60회 한도에 가까워질 수 있음(버튼은 누르는 동안 잠금).
- 잘못 지정하면 그 자산의 청구 합계·원가회수율이 바로 바뀜 — 되돌리기 버튼, 확정 전 확인 창.
- 표 SQL을 실행하기 전에 배포되면: 동기화는 그대로 돌고(규칙 ③까지만), 지정 버튼은 "SQL 먼저" 안내.
- 수정 창에서 works 줄의 금액·날짜를 고쳐도 다음 반영 때 works 값으로 돌아가는 건 **지금과 같음**(이번에 안 바꿈) — 자산번호 칸만 잠금.

---

## 7. 하지 않을 것 (범위 밖)

- firstoa-works에 쓰기(자산번호를 works에 채워 넣기) — 읽기만.
- IT재고 구글시트 쓰기(위치·업체명 변경 등), 시트 결과 보관(캐시).
- `it_billing_lines`·`it_rental_list` 칸 추가·변경, SQL view/함수(RPC).
- 사람 확인 없는 자동 확정.
- works 청구 줄의 금액·날짜·상태 수동 수정 보존.
- 청구 명세 일반 목록의 500줄 제한·서버 검색 개선(별건), 엑셀 업로드 부활.
- 임대리스트 works 중복 행 정리, `groupRentalRows` 규칙 변경.
- 로그인·권한(지정한 사람은 직접 적는 이름).
- `lib/rentals/worksBilling.ts` 변경.

---

## 8. 팀장 결정 (2026-11-20, 사용자 답변 반영) — **위 내용과 다르면 이 절이 우선**

사용자 답: ① 새 표 만들기 **예** ② works 에 다른 번호가 들어오면 **works 따름**(우리 지정은 지우지 않고 "works와 다름" 표시) ③ 그동안 줄마다 넣은 적 **거의 없음 — 간단하게** ④ 일괄 확정은 **체크한 것만**(추천이 한 가지인 건만 체크 가능, 최대 100건).
§6 질문 3(임대 건 모르는 줄)은 추천대로: 홈 경고에 넣지 않고 0보다 클 때만 회색 숫자, 청구리스트 맨 아래 따로.

### 8-1. 규칙 단순화(옛 줄 단위 입력 옮기기 없음)
§3-3 의 ③(W 맵·③-옮김·source 'migrated'·assignmentAdoptions)은 **빼고** 아래 네 줄만. 위에서부터 먼저 맞는 것.

| 순서 | 조건 | 결과 | reason |
|---|---|---|---|
| ① | C(works 자산번호) 있음 | C, confirmed. A 가 있고 A≠C 면 conflict=true(지정은 유지) | 'works' |
| ② | R(임대 건) 있음 + A(지정표[R]) 있음 | A, confirmed | 'assignment' |
| ③ | R 없음 + P(우리 DB 같은 줄)가 confirmed·자산번호 X 있음·P 의 임대 건도 null | X 유지, confirmed | 'kept' |
| ④ | 그 밖 | null, needs_review | 'none' |

- ③은 "임대 건 모르는 줄"을 사람이 줄 단위로 지정한 값만 지킨다(그 줄은 works 쪽에 자산이 없어 C 가 생길 수 없음).
- 임대 건이 있는 줄에 예전에 줄마다 넣은 값(있다면)은 다음 반영 때 지금처럼 풀린다 — 대신 반영 전에는 "자산번호 확인" 화면에 추천(source 'sibling_line')으로 떠서 한 번에 다시 확정할 수 있다.
- `decideAllocation(input)` 입력: `{ worksCode: string|null; rentalSheetRow: number|null; assignment: string|null; prev: { assetId: string|null; allocationStatus: string; rentalSheetRow: number|null } | null }` → `{ assetId: string|null; status: 'confirmed'|'needs_review'; reason: 'works'|'assignment'|'kept'|'none'; conflict: boolean }`. import 없는 순수 함수.
- `CompareResult` 추가 숫자: `billingKeptCount`(reason 이 assignment·kept 인 줄), `assignmentConflictCount`(works와 다른 지정 = 임대 건 수), `assignmentsTableMissing`. (`assignmentAdoptCount` 없음)
- `applyWorksSync` 는 지정표에 **쓰지 않는다**(읽기만).

### 8-2. 표 단순화
`it_rental_asset_assignments`: `rental_sheet_row integer primary key`, `asset_id text not null check (btrim(asset_id) <> '')`, `assigned_by text not null default ''`, `note text not null default ''`, `created_at`, `updated_at`(+ `public.set_updated_at()` 트리거), `asset_id` 색인, RLS 켜고 정책 없음, FK 없음(이유 §3-2). `source` 칸 없음.
상수 `RENTAL_ASSET_ASSIGNMENTS_TABLE` 는 팀장이 lib/supabase/server.ts 에 이미 추가함.

### 8-3. 공용 계약 파일
`lib/billingAllocationTypes.ts` 는 **팀장이 이미 만들었다**(§3-5 에서 source 칸 뺀 모양 + `BillingView`). 모두 이것을 import 하고, 바꿀 필요가 있으면 고치지 말고 보고에 적는다.

### 8-4. 실행 방식
db-schema(SQL) · ui-designer · developer A · developer B 를 **동시에** 띄운다(파일이 겹치지 않게 §5 의 파일 목록만). 그 뒤 sql-review(SQL) → qa-checker.
- 동시에 작업하므로 `npm run build` 는 각자 돌리지 않는다(.next 공유). `npm run typecheck` 는 돌려도 되지만 **자기 파일의 에러만** 책임진다(다른 사람이 아직 안 만든 함수 때문에 나는 에러는 보고에 적기만).
- 서버 액션 이름·인자·반환 모양은 §3-5 그대로(단 `confirmRentalAllocation` 의 assetId 는 대문자·앞뒤 공백 제거 후 저장).
