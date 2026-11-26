[기획실 도면우]

# 영업 확인서 가져오기 → '확인서/출고및반출준비' 화면을 새 목록·상세·출력으로 (설계안, 2026-11-26 · 사용자 답 반영판)

크기: **큰 일, 3단계(1 목록 → 2 상세 → 3 출력), 단계마다 사용자에게 화면을 보여 주고 다음 단계로.** 출고 준비 리스트와 합치는 일은 **4단계로 따로 설계**(D8).
새 표 5개(SQL 한 번) + `/confirm-form` 기본 보기 교체(예전 화면은 `?view=legacy`로 그대로) + 상세 `/confirm-form/[id]` + 영업 API 가져오기 + 인쇄.
외부에 **쓰는** 코드 없음 — 영업·시트·네이버·카톡·출고 준비 표 어디에도 안 씀(1~3단계).
흐름: 기획 → (사용자 승인) → 팀장 사전 작업 → db-schema ∥ developer A ∥ developer B ∥ ui-designer → sql-review → qa-checker → deploy-check. 2·3단계는 db-schema 없이.
영업 API는 배포돼 있음(팀장 실측 F15). **응답 모양은 키를 받은 뒤 배포 환경에서 1번 실측하고 파서 확정**(§3-6).

## 결정 표 (맨 위가 우선)

| # | 결정 | 상태 | 설계 반영 |
|---|---|---|---|
| D1 | 영업 데이터는 **영업 웹앱 읽기 전용 API로만** — `GET https://firstoa-smart-sales-os.vercel.app/api/export/it-confirms?since=YYYY-MM-DD`, 헤더 `x-export-key`. 우리 쪽 키 환경값 이름 `SALES_EXPORT_KEY`(Vercel Production, 코드·깃에 없음. 영업 쪽 이름은 `IT_EXPORT_KEY`). 영업 Supabase에 직접 안 붙음 | 확정(사용자 지침) | §3-6 |
| D2 | 같은 확인서는 영업 `id`로 덮어씀. `ver`가 오르면 "영업에서 수정됨" | 확정(지침) | §3-2 ①②, §3-6 |
| D3 | 영업 원래 값은 그대로 두고 IT 값(사양 수정·자산번호·시리얼·체크·처리)은 **다른 표에** 따로. 영업이 고쳐도(ver↑) IT 값은 안 덮음 — 가져오기 코드는 IT 표를 아예 안 읽고 안 씀 | 확정(지침) | §3-2 ③④, §3-4 |
| D4 | (2026-11-26 사용자) **영업은 IT 입력값을 안 봄 → ERP에만 저장, 영업 쪽 되돌려 쓰기 없음**(시트든 API든 만들지 않음) | 확정 | §7 |
| D5 | (2026-11-26 사용자) 앞으로 확인서는 영업 웹앱 API에서 읽기만. 영업 시트 탭에 IT가 칸을 써 넣는 방식(지금의 `📄 확인서 출고 기재`)은 **새 확인서에는 안 씀**. 기존 시트(확인서리스트 워크북의 `IT확인서리스트` 탭·업체별 탭)와 그 화면은 **전환하는 동안 그대로**(이 기능은 시트에 안 씀) | 확정 | §2, §3-8, §7 |
| D6 | 1 목록 → 2 상세 → 3 출력 순서, 단계마다 사용자 확인 | 확정(지침) | §5 |
| **D7** | (2026-11-26 사용자) **개인정보(연락처·주소)는 지금은 안 잠금. 로그인을 붙일 때 같이 막음.** ※ 지침 "IT팀 로그인한 사람만"과 **다름** — 그때까지는 주소를 아는 누구나 연락처를 볼 수 있음(지금 출고 대장과 같은 수준). 잠금 설계는 범위 밖. 유지하는 규칙: 서버 로그·오류 문구에 영업 원문(payload) 안 남김, docUrl 검사 | 확정 | §3-5, §7 |
| **D8** | (2026-11-26 사용자: "확인서/출고및반출준비가 이걸로 바뀌는 거고, 나아가서는 출고준비리스트와 함께 운영") **출고 준비 리스트와는 나중에 합침(4단계, 따로 설계).** 1~3단계는 새 화면만 — 출고 준비 쪽 표(`it_prep_reports`·`it_prep_events`)·네이버·카톡에 **안 씀**. 상세에서 "같은 건으로 보이는 출고 준비 일정"을 **보여 주기만**(읽기). 연결 칸 `prep_event_id`는 표에 미리 만들어 두되 4단계 전엔 안 씀 | 확정 | §3-7, §5 4단계 |
| D9 | 가져오기 시점 = 화면(목록·상세) 열 때 + 열려 있는 동안 **3분마다** + `🔄 새로고침` + 홈 열 때(10분 넘었으면 응답 뒤에). **Vercel cron은 안 씀**(Hobby는 하루 1번 — `app/api/cron/naver-calendar-sync/route.ts:9`) | 제안(팀장 확인) | §3-6 |
| **D10** | (2026-11-26 사용자) **새 메뉴 없음 — '확인서/출고및반출준비' 메뉴가 새 화면으로 바뀜.** 주소는 `/confirm-form` 그대로(홈 카드·설명서 key `confirm-form`·카톡 링크 안 깨짐). `page.tsx`가 보기 칩(`Link`, 계약관리 `?tab` 방식 + `<Suspense key={view}>`)으로 나눔: **기본 = 영업 확인서 목록**, `?view=legacy` = 지금의 `ConfirmFormPage` 그대로(📄 확인서 출고 기재·간단 등록·정식 납품확인서 — 컴포넌트 안 고침, 전환 기간 유지). 상세 = `/confirm-form/[id]`. `Shell` `SIDEBAR_SECTIONS`는 안 바꿈. 홈의 기존 "확인서 출고 기재" 카드 링크는 `?view=legacy`로 | 확정 | §2, §4, §5 |
| D11 | 출고 체크리스트 = **기존 표 `it_prep_photo_items` 그대로 읽음**(시트 '출고체크리스트' 탭 항목이 이미 들어가 있음 — F7). 데스크탑&노트북·모니터 묶음은 **기기마다**, 기타 묶음(랜선·공유기…)은 **건마다**. 항목 추가·삭제는 출고 준비 완료 보고 창에서만(같은 목록 공유, 새 화면은 읽기만) | 제안 | §3-2 ③④ |
| D12 | 처리자 명단 = 출고 준비 `👥 담당자 관리` 명단(`it_prep_people`)을 읽어 씀, 한 건에 여러 명 가능(시트에도 두 명씩 적은 줄이 있음) | 제안 | §3-2 ③ |
| D13 | 처리여부 6단계 = 접수 → 준비중 → 준비완료 → 출고 + **보류·취소**(지침의 4단계 + 시트에 실제로 있는 보류 2·취소 8) | 제안 | §3-3 |
| **D14** | (2026-11-26 팀장 지시) **since 뜻을 영업에 묻지 않아도 되게**: 늘 **최근 30일**을 다시 받고 hash로 걸러 바뀐 것만 씀 + 그날 첫 가져오기 한 번은 **90일**. `⋯ 날짜 골라 다시 가져오기` 유지. since가 "만든 날" 기준이어도 30일(하루 한 번 90일) 안 수정분은 안 놓침 | 확정 | §3-6 |

---

## 0. 지금 코드·데이터에서 확인한 것 (근거)

| # | 사실 | 위치 / 방법 |
|---|---|---|
| F1 | **`IT확인서리스트`·`출고체크리스트` 탭은 영업 확인서리스트 워크북**(`1seFubCF…` = `CONFIRM_SHEET_ID`, 업체별 확인서 탭과 같은 곳)에 있음. 코드는 확인서 목록에서 이 두 탭을 건너뛰기만 함 | lib/confirmSheetServer.ts:9,13 |
| F2 | **`/dispatch`(출고/접수 대장, 표 `it_dispatch_log`)가 이미 "구 IT확인서리스트를 웹으로 옮긴 것"** — 칸 이름이 시트 머리줄과 1:1. 손으로 한 줄씩 적는 대장. `/confirm-form`의 간단 등록·정식 납품확인서도 여기 씀. 목록은 `.limit` 없이 읽음(1000줄 잘림 위험 — 이번 범위 밖) | lib/dispatch.ts:1-9, supabase/dispatch_schema.sql, app/dispatch/page.tsx:19-23 |
| F3 | 그런데 **시트 `IT확인서리스트`는 지금도 매일 씀**(11-26 접수 줄 있음) → `/dispatch`로는 안 넘어갔음 | 아래 실측 |
| F4 | 앱 전체 로그인 없음(미들웨어 없음). 잠금은 계약관리 소프트웨어 탭 비밀번호뿐 — D7로 이번엔 안 씀 | lib/contracts/secrets.ts |
| F5 | 고객 연락처는 이미 다른 화면에도 잠금 없이 보임(출고 대장 `연락처` 칸, 확인서 시트 내용) → 로그인 붙일 때 같이 막을 화면 목록에 넣음 | lib/dispatch.ts:24 |
| F6 | Vercel cron은 하루 1번(Hobby) — 네이버 동기화도 실제로는 "화면 열 때 + 열려 있는 동안 60초마다"(API 라우트로 빼서 버튼과 따로 돔) | app/api/cron/naver-calendar-sync/route.ts:9-16, app/api/shipment-prep/sync/route.ts, components/shipmentPrep/ShipmentPrepPage.tsx:93 |
| F7 | 출고 체크리스트는 이미 앱 표 `it_prep_photo_items(label, grp, sort_order)`에 시트 탭과 같은 항목 31개(데스크탑&노트북 20 · 모니터 5 · 기타 6) | supabase/shipment_prep_checklist.sql |
| F8 | 자산번호 → 시리얼·모델·사양 조회는 `lookupUnitByAsset(assetId, hint)`(서버 액션, IT재고 색인 5분 캐시 `findAssetBriefs` — 읽기만) | app/shipment-prep/reportActions.ts:238, lib/inventory/assetIndex.ts |
| F9 | 확인서 ↔ 일정 후보: `eventsAround(dates)`(납품일 ±14일 IT 일정 읽기), 일정 제목 구조 `parseEventTitle`(구분 칸 +4 = 거래처) | lib/confirmLink.ts:52, lib/shipmentPrep.ts:43 |
| F10 | 확인서 → 완료 보고 기기 채우기 `pushDocToPrep` — 4단계 참고용(이번엔 안 씀) | lib/confirmLink.ts:133 |
| F11 | 인쇄: body 바로 아래 포털 `#print-confirm-sheet-root` + `@page A4 margin 0` + 재서 줄이기(zoom) + 별첨 `breakBefore: page`. 별첨 `ConfirmAttachment({ doc: ConfirmDoc })` = 대수별 자산번호·모델·S/N·사양 표(A4 폭 733px) | components/confirmForm/ConfirmSheetEditor.tsx:216-238,687-703, app/globals.css:374-379, components/confirmForm/ConfirmAttachment.tsx |
| F12 | 홈 카드: 함수마다 예외 안 던지고 그 카드만 "못 읽음". 시트 기반 "확인서 출고 기재" 카드 링크 = `/confirm-form`(→ `?view=legacy`로 바꿀 곳) | lib/homeDashboard.ts:368-369, components/home/HomeSections.tsx:77 |
| F13 | 최선노력 반영 실패는 삼키지 않고 주황 알림(`.toast.toast-warn`), 이유 문구 `lib/syncFailure.ts` | CLAUDE.md 동기화 주의 |
| F14 | 의존성에 zod 없음 → API 응답 검사는 손으로 쓴 순수 함수 | package.json |
| **F15** | **영업 API 팀장 실측(2026-11-26)**: 키 없이 `GET /api/export/it-confirms` → **401** `{"message":"키가 없거나 맞지 않습니다."}`, 없는 주소 `/api/export/zz` → **404** ⇒ **주소는 배포돼 있음**. 영업 Vercel 프로젝트 환경값 `IT_EXPORT_KEY`(production, sensitive — 다시 볼 수 없음 → 영업 담당에게 값을 따로 받아야 함). GitHub `FIRSTOA/firstoa-smart-sales-os` main 마지막 push 11-20, export 코드 없음(로컬 배포로 보임) → **응답 모양은 코드로 못 봄, 키 받은 뒤 1회 실측** | 팀장 |
| F16 | 계약관리의 보기 나누기 = `page.tsx`가 `searchParams`로 탭을 고르고 `Shell` 제목·메모를 바꾼 뒤 `<Suspense key={tab}>` | app/contracts/page.tsx |
| F17 | `/confirm-form`을 가리키는 곳: Shell 메뉴, 홈 확인서 카드, 설명서 `confirm-form`, 예전 액션의 `revalidatePath('/confirm-form')` 4곳. `app/confirm-form/` 아래 하위 폴더 없음 | grep |

### 시트 실측 (2026-11-26, 읽기 전용 — 연락처·상호·사람 이름 값은 문서에 안 옮김)
- 워크북 탭 65개: 앞 6개(확인서·IT확인서리스트·복합기확인서리스트·출고체크리스트·장비반출확인서·지우지마시요) + 업체별 확인서 탭 59개. **업체별 탭이 11-24·25·27·30 날짜로도 새로 생김** → 영업이 시트 확인서도 아직 일부 만듦(전환 중).
- **`IT확인서리스트`**: 머리줄 1행(고정), 데이터 803줄. 칸: A 순번 · B 납품/교체일(`11월27일` — **연도 없음**) · C 접수일(`11.25`) · D 접수시간 · E 시작 · F 종료 · G 처리여부 · H 접수자 · I 처리자 · J 구분 · K 날짜(뜻 미확인) · L 소모품/특이사항 · M 상호 · N 연락처 · O 품목 · P 직송(실제로는 사양 메모) · Q 자산번호(568칸, 여러 줄 14) · R 비고 · S 이름 없는 칸 · T 시리얼번호(**14칸뿐**).
  - 처리여부: 준비완료 726 · 처리완료 52 · 취소 8 · 보류 2 · 요청사항을 적은 긴 글 몇 줄. 구분: 납품 646 · 교체 148 · 판매 2 · 이전 2. 처리자 칸에 두 명을 같이 적은 줄 있음.
  - 최근 열흘(11-16~26) 접수 약 25줄 ⇒ **하루 2~3건** → 30일이면 약 70~100건(응답 크기 추정 근거, §3-6).
- **`출고체크리스트`**: 데스크탑&노트북 20 · 모니터 5 · 기타 6 = 앱 `it_prep_photo_items`와 같음(F7). 아래 두 줄(사진·카톡방 업로드·포장·대수 일치)은 건 단위 일 — 출고 준비 완료 보고 몫이라 새 화면엔 안 넣음.

---

## 1. 한 줄 목표와 쓰는 사람

**영업 웹앱에서 저장된 IT 확인서를 몇 분 간격으로 가져와 '확인서/출고및반출준비' 화면의 기본 목록으로 보여 주고('IT확인서리스트' 시트 대신), 건마다 기기 칸(품목 수량만큼)에 IT가 사양을 고치고 자산번호·시리얼·출고 체크를 채워, 확정 사양이 들어간 출고 확인서를 A4로 뽑는다.** 영업 값은 읽기만, IT 값은 ERP에만.

- 목록·상세 편집·인쇄: 주로 **PC**(창고 사무실).
- 창고에서 기기 앞: **핸드폰**(홈 화면 앱) — 목록 카드, 상세에서 자산번호·시리얼 입력과 체크. 인쇄는 PC.

---

## 2. 기존 코드 재사용·확장 지점

| 파일:함수 | 어떻게 |
|---|---|
| `app/confirm-form/page.tsx` | **바뀜(팀장)** — 계약관리처럼 `searchParams.view`로 나눔. 기본 = 새 목록, `legacy` = 지금 내용 그대로(`listRecentConfirmFormEntries` + `ConfirmFormPage`). `maxDuration = 60` 유지 |
| `components/confirmForm/*`, `app/confirmForm/*`, `lib/confirmSheet*.ts`, `lib/confirmLink.ts` | **안 고침** — 예전 보기에서 그대로 돎. `ConfirmAttachment`는 3단계에서 import만 |
| `app/contracts/page.tsx` 보기 나누기 방식 | 같은 모양(`<Suspense key>`, 칩은 `Link`) — CLAUDE.md "주소 ?뒤만 바뀌면 page를 새로 안 만듦" 주의 그대로 |
| `app/shipment-prep/reportActions.ts` `lookupUnitByAsset` | 기기 칸 자산번호 입력 → 시리얼·모델·IT재고 사양 채우기(읽기) |
| `it_prep_photo_items`(읽기) | 체크리스트 항목(D11) |
| `app/shipment-prep/actions.ts` `listPrepPeople`(읽기) | 처리자 명단(D12) |
| `lib/confirmLink.ts` `eventsAround`, `lib/shipmentPrep.ts` `parseEventTitle`·`isItPrepTarget`(읽기) | 2단계 상세의 "같은 건으로 보이는 출고 준비 일정" 표시(D8) |
| `components/confirmForm/ConfirmAttachment.tsx` | 3단계 2장째 기기 표 — `ConfirmDoc` 모양으로 바꾸는 어댑터만 새로 |
| `app/globals.css` `#print-confirm-sheet-root` | 3단계 인쇄 포털에 같은 id(CSS 안 고침) |
| `components/MobileTableCards.tsx`(`m-cards`)·`MobileFilterRows.tsx` | 목록 핸드폰 카드·필터 접기 |
| `lib/syncFailure.ts`, `.toast.toast-warn` | 가져오기 실패 문구·주황 띠 |
| `lib/homeDashboard.ts` | 새 카드 `loadSalesConfirmCard` + 운영 타일 1개, `loadConfirmCard` 링크만 `?view=legacy` |
| **안 건드림** | `components/Shell.tsx`(메뉴 그대로), `/dispatch`, 출고 준비 화면·액션, 네이버·카톡 코드 |

---

## 3. 데이터 설계

### 3-1. 받는 데이터(영업 API 1건) — 지침 그대로, 키 받은 뒤 실측으로 확정
`{ id, no, ver, type('납품'|'교체'|'유지보수'), term('일반/장기'|'현장/단기'), savedAt, savedBy, sales, company, address, region, deliveryDate, contacts{manager,resident,payer,phone}, special, items:[{cat,model,maker,state,qty,spec{CPU,RAM,SSD,HDD,그래픽,OS,인치},place}], supplies:[{name,qty,charge,note}], before/after, docUrl }`
- 개인정보: `contacts` 전부, `address`(D7 — 지금은 화면에 그냥 보임).
- 응답이 배열인지 `{ items: [] }`인지, 한 번에 몇 건까지인지, id 형식은 모름 → 1회 실측(§3-6).

### 3-2. 새 표 (`supabase/sales_confirms_schema.sql` — 1단계에서 5개 한 번에, 여러 번 실행해도 안전)
보안 모델 그대로: **RLS 켜고 정책 없음 + `revoke all … from anon, authenticated`**(표·시퀀스, `contracts_schema.sql` 방식). 서버 service_role만.

① `it_sales_confirms` — **영업 원본 최신본. 가져오기 코드만 씀**(화면 액션은 안 씀)

| 칸 | 형 | 메모 |
|---|---|---|
| id | text PK | 영업 id(형식 모름 → text) |
| doc_no | text | `no`(D-261124-04) — 목록의 "순번" |
| ver | int | |
| type, term | text | |
| saved_at | timestamptz | 영업 마지막 저장 |
| first_saved_at | timestamptz | **처음 본 버전의 savedAt = 목록 "접수일시"**(실측에서 생성 시각 칸이 보이면 그걸로) |
| saved_by, sales_rep | text | 접수자·영업담당 |
| company, region | text | |
| delivery_date | date | |
| items, supplies | jsonb | 표시·기기 칸 계산용 사본 |
| replace_info | jsonb null | before/after(교체) |
| special | text | |
| doc_url | text | |
| payload | jsonb | 원문 전체(연락처·주소 포함) — 로그·오류 문구에 안 넣음 |
| payload_hash | text | 바뀐 것만 쓰기(D14) |
| sales_state | text default '' | 영업에서 취소·삭제 신호가 오면(§6 영업 확인 1) |
| first_seen_at / changed_at / fetched_at | timestamptz | 처음 받은 때 / ver·내용이 바뀐 때 / 마지막으로 받은 때 |

인덱스: `delivery_date`, `first_seen_at desc`.

② `it_sales_confirm_versions` — ver마다 원문(무엇이 바뀌었나 보기용). `(confirm_id, ver, payload_hash)` 유일, `payload jsonb`, `fetched_at`. FK → ①(cascade — ①을 지우는 코드는 없음).

③ `it_sales_confirm_work` — **IT 처리(건당 1행, 화면만 씀).** 행이 없으면 = 접수·아무도 안 열어 봄.

| 칸 | 메모 |
|---|---|
| confirm_id text PK, FK → ① | |
| status text default '접수' | D13 6단계(DB CHECK 없음 — 기존 대장처럼) |
| processors text[] | D12 |
| started_at / finished_at / shipped_at | 시작·종료·출고 시각(사람이 고칠 수 있음) |
| note text | 비고 |
| seen_ver int, seen_hash text | **IT가 마지막으로 확인한 영업 버전** → "영업에서 수정됨" = seen_ver 있음 && (ver > seen_ver 또는 같은 ver인데 hash 다름) |
| first_opened_at, first_opened_by | "새로" 강조 = 이게 비어 있음 |
| checks jsonb `{label:{at,by}}` | 건 단위 체크(기타 묶음) |
| prep_event_id uuid null, FK → it_calendar_events **on delete set null** · link_source text | **4단계용 — 미리 만들어 두고 1~3단계 코드는 안 씀**(D8) |
| printed_at | 마지막 인쇄 |
| updated_at, updated_by | 동시 수정 확인용 |

④ `it_sales_confirm_units` — **기기 칸(화면만 씀).** 빈 칸은 행을 안 만듦(처음 입력할 때 생김).

| 칸 | 메모 |
|---|---|
| id uuid PK | |
| confirm_id text FK → ① | |
| slot_key text, unit_no int | `unique(confirm_id, slot_key, unit_no)` — 규칙 §3-4 |
| item_snapshot jsonb | 이 칸을 채울 때의 영업 품목(cat·model·maker·state·spec) — 영업이 품목을 바꾸면 비교해 경고 |
| asset_id, serial | text default '' |
| actual_maker, actual_model | 실제로 나가는 기기(IT재고에서 채움, 고칠 수 있음) |
| spec_override jsonb `{RAM:'16GB',…}` | **IT가 고친 칸만**(영업 값은 ①에 그대로) |
| checks jsonb `{label:{at,by}}` | 기기별 체크(D11) |
| note | |
| updated_at, updated_by | |

인덱스: `confirm_id`, `asset_id`(다른 건에 같은 자산번호 경고용, `where asset_id <> ''`).

⑤ `it_sales_import_state` — 가져오기 상태 1행(`id='main'`, SQL이 만들어 둠): `last_attempt_at, last_success_at, last_deep_at(90일 받은 때), last_window_days, last_error_code, last_error text(이유만, 원문 없음), last_counts jsonb{received,new,updated,unchanged,older,skipped}`.

표 이름 상수는 `lib/supabase/server.ts`에(팀장 사전 작업).

### 3-3. 목록 한 줄 = 시트 칸과의 대응
| 목록 칸 | 어디서 |
|---|---|
| 순번 | ① doc_no |
| 납품/교체일 | ① delivery_date |
| 접수일시 | ① first_saved_at |
| 처리여부 | ③ status (없으면 접수) |
| 접수자 / 처리자 | ① saved_by / ③ processors |
| 구분 | ① type (+ term이 현장/단기면 작은 표시) |
| 상호 | ① company (+ region) |
| 연락처 | ① payload.contacts.phone(D7 — 그냥 보임) |
| 품목 요약 | ① items → "데스크탑 3 · 모니터 3" |
| 사양 요약 | 품목별 확정 사양(IT 고친 값 우선, 없으면 영업 값) → "I5/16/512" 꼴, IT가 고친 품목은 표시 |
| 자산번호 / 시리얼 | ④ (앞 3개 + "외 n", 입력 n/전체 m) |
| 소모품/특이사항 | ① supplies + special |
| 비고 | ③ note |
| (상태 표시) | 새로 · 영업에서 수정됨 v2→v3 · 영업에서 취소(신호가 있으면) · 시트 비교(켰을 때) |

### 3-4. 기기 칸 규칙 — 영업이 품목을 바꿔도 IT 값을 안 잃기 (순수 함수 `lib/salesConfirms/slots.ts`, import 없음)
- 칸 열쇠 `slot_key` = **품목 종류 + 같은 종류 안 순서**(예: 데스크탑 줄이 두 개면 `데스크탑#1`, `데스크탑#2`), `unit_no` = 1..qty. 종류가 비면 '기타'. qty는 0~50으로 자름.
- 화면을 그릴 때마다 지금 버전 품목으로 칸을 계산하고 ④ 행을 (slot_key, unit_no)로 붙임 → **가져오기는 ④를 안 건드림(쓰기 0).**
- 영업이 바꾼 경우:
  - **수량 늘어남** → 빈 칸이 더 생김.
  - **수량 줄어듦 / 품목 줄이 빠짐 / 종류가 바뀜** → 갈 곳 없는 행 중 **IT가 뭐라도 적은 행**은 지우지 않고 아래 **"영업에서 빠진 칸"**(회색)에 모음: 자산번호·시리얼·고친 사양 그대로 보임 + `[다른 칸으로 옮기기]`·`[지우기]`(사람이 누를 때만). 아무것도 안 적은 행은 그냥 안 보임.
  - **같은 칸인데 모델·사양이 바뀜** → `item_snapshot`과 비교해 칸에 "영업 품목이 바뀌었어요: 전 ○○ → 지금 ○○" + `[확인함]`(스냅숏 갱신). IT가 고친 사양 칸은 그대로 IT 값, 영업 새 값은 옆에 흐리게.
  - 같은 종류 줄 순서가 바뀌거나 앞 줄이 빠지면 `#2`가 `#1`로 당겨져 다른 품목에 붙을 수 있음 → 위 스냅숏 경고로 드러남(조용히 틀리지 않음). "모델이 같은 품목 먼저 맞추기"는 실제 수정 사례를 보고 2단계 QA 때 판단.
- QA가 Node로 돌릴 경우: 수량 증감, 품목 삭제(가운데), 종류 변경, 같은 종류 두 줄, 모델만 변경, qty 0, 빈 items.

### 3-5. 개인정보 (D7 — 지금은 안 잠금)
- 연락처·주소는 목록·상세·인쇄에 그냥 보임(지금 출고 대장과 같은 수준). **로그인을 붙일 때 같이 막을 화면**: `/confirm-form`(영업 확인서 연락처·주소 — 목록·상세·인쇄), `/dispatch`(연락처) → CLAUDE.md 새 절에 적어 둠.
- 그래도 지키는 규칙:
  - 서버 로그·오류 문구·가져오기 상태(⑤)·라우트 응답에 **영업 원문(payload)을 안 넣음** — 건너뛴 건은 id와 이유만.
  - 홈 카드·운영 타일에 개인정보 없음(건수만).
  - **docUrl**은 `https:` + 영업 웹앱 호스트일 때만 링크로(`javascript:` 등 막기), 새 탭 `rel="noopener noreferrer"`.
  - 응답 실측(§3-6)·개발·QA 때 키·연락처 값·`.env.local` 값을 셸에 출력하지 않음(이름·건수·형식만).

### 3-6. 가져오기 (D1·D2·D9·D14)
- **환경값**: `SALES_EXPORT_KEY`(필수, Vercel **Production만**), `SALES_EXPORT_URL`(선택, 비우면 받은 주소). `.env.local.example`에 이름만 추가. 키는 응답·로그·화면 어디에도 안 나감. 로컬엔 키를 안 둠.
- **언제**: ⓐ 목록·상세 화면을 열 때 ⓑ 열려 있고 화면이 보이는 동안 3분마다 ⓒ `🔄 새로고침`(강제) ⓓ 홈을 열 때 마지막 성공이 10분 넘었으면 응답 뒤(`after()`). 아무도 안 열면 안 가져오지만, 열면 최근 30일을 다시 받으므로 빠짐 없음.
  - ⓐⓑⓒ는 **API 라우트 `POST /api/sales-confirms/import`**(출고 준비 동기화와 같은 이유 — 서버 액션은 한 화면에서 차례로 돌아 버튼을 붙잡음). 응답은 건수·상태만(원문 없음). 누구나 부를 수 있으니 아래 간격으로 막음.
- **겹침 막기**: ⑤의 `last_attempt_at`이 60초(강제는 10초) 안이면 건너뜀 — 조건부 update(`last_attempt_at < 기준`)로 한 명만 잡음. 시간 제한 8초(`AbortSignal.timeout`, 90일 받을 땐 15초), `cache: 'no-store'`, 라우트 `maxDuration` 30.
- **since (D14 — 영업에 since 뜻을 묻지 않음)**: 늘 `since = 오늘(한국) − 30일`. ⑤ `last_deep_at`이 오늘이 아니면 그 한 번은 `− 90일`. `⋯ → 날짜 골라 다시 가져오기`(강제, 고른 날부터).
  - 30일로 정한 근거: 시트 기준 하루 2~3건 → 30일 약 70~100건, 건당 수 KB로 잡으면 수백 KB. 겹침 막기로 전체에서 1분에 최대 1번이라 부담 작음.
  - **실측 후 조정**: 30일 응답이 1MB 넘거나 2초 넘으면 14일로 줄임. 받은 건수가 딱 떨어지는 수(100·500·1000)면 영업 쪽 상한으로 보고 날짜를 쪼개 받음(그때 결정).
- **한 건씩 반영 규칙**(①②만 씀 — 먼저 받은 id들의 `(id, ver, payload_hash)`를 200개씩 읽어 비교):
  1. 모양 검사 실패한 건 → 건너뛰고 skipped(id·이유만), 나머지는 계속.
  2. 없던 id → ① insert(first_saved_at) + ② insert.
  3. ver 올라감, 또는 같은 ver인데 hash 다름 → ① 영업 칸만 update(changed_at) + ② insert.
  4. ver 내려감(옛 사본) → 무시(older).
  5. 같음 → 아무것도 안 씀(대부분 — 30일을 매번 받아도 쓰기는 바뀐 것만).
  - **가져오기 코드는 ③④를 import도 안 함**(QA grep). IT 값 덮어쓰기가 구조적으로 불가능.
- **실패 화면**(최선노력도 삼키지 않음 — 화면은 저장된 목록을 그대로 보여 주고 위에 띠):
  | 상황 | 띠 |
  |---|---|
  | 키 환경값 없음 | 회색 "영업 웹앱 연결 키가 아직 없어요 — 개발 담당에게"(저장분만 보임) |
  | 401(실측: `{"message":"키가 없거나 맞지 않습니다."}`)·403 | 주황 "영업 웹앱이 키를 거절했어요 — 영업 쪽에서 키를 바꿨는지 확인" |
  | 404 | 주황 "영업 웹앱의 가져오기 주소가 바뀌었어요"(지금은 배포돼 있음 — F15) |
  | 시간 초과·5xx·연결 실패 | 주황 "영업 웹앱이 응답하지 않아요 — 3분 뒤 자동으로 다시"(마지막 성공 n분 전) |
  | 모양 다름 | 주황 "영업 웹앱이 보낸 모양이 달라요 — n건 건너뜀"(전부 다르면 하나도 안 씀) |
  | 표 없음(SQL 전) | SetupGuide(`supabase/sales_confirms_schema.sql`) — 판정은 42P01/PGRST205만 |
  - 띠는 저절로 안 닫힘. 마지막 성공 30분 넘고 오류가 있으면 홈 운영 타일도 주황.
- **응답 모양 1회 실측(1단계 첫 일, 팀장)**: 키를 Vercel에 넣고 배포 → 배포된 라우트로 1번 받아 **키 이름·건수·형식만** 확인(값 출력 금지). 확인할 것: 배열/감싼 모양, 건수 상한 흔적, id 형식(→ §4-2 주소 규칙), 날짜·숫자 형식, 생성 시각 칸 유무, spec 키 이름(그래픽·인치 등), 취소·삭제 표시 칸 유무, 같은 건의 ver 변화(며칠 지켜봄). → 파서 확정.

### 3-7. 출고 준비 리스트와의 관계 (D8 — 1~3단계는 따로, 4단계에서 합침)
- 1~3단계: 새 화면은 출고 준비 쪽 표·네이버·카톡에 **아무것도 안 씀**. 카톡 보고·사진·네이버 이름 표시·IT재고 '임대중' 반영은 지금처럼 출고 준비 리스트에서 하고, **자산번호도 완료 보고에 따로 넣어야 함**(§6 참고에 적음).
- **남기는 것(읽기만, 2단계 상세)**: "같은 건으로 보이는 출고 준비 일정" 상자 — 순수 함수 `lib/salesConfirms/prepMatch.ts`: `eventsAround`로 읽은 IT 일정 중 `parseEventTitle` 거래처(정규화: 공백·㈜·(주)·주식회사 뗌, 소문자) = 상호, 날짜 차 ≤ 3일, 제목 구분(납품/교체) 같음. 후보의 날짜·제목·준비 상태(누가 준비중/완료)·완료 보고 발송 여부를 보여 주고 `출고 준비에서 열기` 링크만. **DB에 연결을 저장하지 않음**(매번 계산). 남기는 이유: 두 화면을 같이 쓰는 동안 같은 건을 바로 찾게 하고, 4단계 매칭 규칙을 실제 데이터로 미리 검증.
  - 목록에는 안 넣음(목록 속도·혼동 방지).
- **4단계(따로 설계 — feature-planner가 다시)**: 연결 저장(`prep_event_id`·`link_source`), 자산번호를 완료 보고로 보내기(`pushDocToPrep` 규칙 참고 — 빈 칸만, 기존 기기 유지), 완료 보고 기기로 빈 칸 채우기, 시작·완료 ↔ 네이버 이름 표시, 카톡·재고 반영을 어느 화면에서 할지, 두 목록 합치기. 네이버·카톡·시트 쓰기가 생기므로 integration-rules 필수.

### 3-8. 시트와 비교 (전환 기간, D5 — 읽기만)
- 목록 위 `📄 시트와 비교` 켜기(PC만, 브라우저에 기억) → 화면 열 때 **1번만** 확인서리스트 워크북 `IT확인서리스트`를 batchGet 1회로 읽음: **B·C·D, G~J, M, O~Q, T 칸만**(연락처 N은 안 읽음). 3분 자동 가져오기 때는 안 읽음(분당 한도는 IT재고와 공유).
- 맞추기(순수 함수 `lib/salesConfirms/sheetMatch.ts`): 상호 정규화 + 납품/교체일(`11월27일` → 연도는 접수일·오늘로 추정, 12월↔1월 넘김 처리) + 구분.
- 목록에 "시트" 칸: `✓ 같음` / `⚠ 다름`(처리여부·자산번호가 다르면 어느 칸인지) / `— 시트에 없음`, 아래 접힌 "시트에만 있는 건 n"(영업 웹앱 밖에서 들어온 건 확인용). 시트에 쓰기 없음.
- 실패(한도·권한) → 그 칸만 "시트를 못 읽었어요(1분 뒤 다시)", 재시도 반복 없음.

---

## 4. 화면 흐름

메뉴는 그대로: 재고관리 → **확인서/출고및반출준비**(`/confirm-form`). 화면 위 보기 칩 2개(`Link`):
`[📋 영업 확인서]`(기본, `/confirm-form`) · `[🗂 예전 방식 (시트 기재·간단 등록·정식 납품확인서)]`(`/confirm-form?view=legacy` — 지금 화면 그대로).
`Shell` 제목은 그대로 `📋 확인서/출고및반출준비`, 메모(note)만 보기마다. `<Suspense key={view}>`라 칩을 바꾸면 아래가 새로 그려짐(`view`는 state 아님).

### 4-1. 1단계 — 목록 (`/confirm-form` 기본 보기)
PC
1. 열면 저장된 목록이 바로 뜸(기본: 안 끝난 건 + 지난 7일), 동시에 가져오기 → 새 건 있으면 목록 갱신. 위 띠 "영업 웹앱에서 2분 전에 가져옴 · `🔄 새로고침` · `⋯`(날짜 골라 다시 가져오기)".
2. 새 건은 굵게 + `새로`, 영업이 고친 건은 `영업에서 수정됨 v2→v3`.
3. 칩: 처리여부 6개 · 구분 · 날짜(오늘·내일·이번 주·지난 것·직접) · 처리자 선택 · 검색(상호·순번·자산번호·시리얼·연락처).
4. 줄에서 처리여부·처리자 바로 바꿈(③ 씀).
5. `📄 시트와 비교` 켜면 "시트" 칸 + 시트에만 있는 건.
6. 줄 누름 → 1단계 배포 땐 읽기 전용 미리보기 창(영업 원문 정리 + `영업 원본 열기`), 2단계부터 상세 주소로.

핸드폰(≤640px)
1. `m-cards`: 제목=상호, badge=처리여부, inline=납품일·구분·품목 요약, sub=사양 요약, "자산 2/3" 진행, 새로·수정됨 표시, 연락처 한 줄.
2. 보기 칩은 위에 그대로(두 개라 한 줄), 필터는 `MobileFilterRows`로 "⚙︎ 필터" 하나. 시트 비교는 숨김.
3. 카드 누름 → 상세.

### 4-2. 2단계 — 상세 `/confirm-form/[id]` (카톡으로 주소 공유 가능)
**주소 규칙**: 링크는 한 함수(`salesConfirmHref(id)`)로만 만듦 = `/confirm-form/` + `encodeURIComponent(id)`. 페이지는 받은 값을 한 번 decode(실패하면 받은 값 그대로)해서 찾고, 없으면 "확인서를 못 찾았어요 → 목록으로". **`app/confirm-form/` 아래에 다른 하위 폴더(정적 경로)를 만들지 않음** — 만들면 같은 이름의 id를 가림. `legacy`는 `?view=` 값이라 경로와 안 겹침. QA는 `/`·`%`·한글·공백이 든 가짜 id로 확인(실측으로 id 형식이 uuid 꼴이면 문제없음).

PC
1. 머리: 상호·순번·구분·납품일·접수자·영업담당·주소·연락처 · `영업 원본 열기`(docUrl, 새 탭) · `← 목록`.
2. 상태 단계 버튼(접수→준비중→준비완료→출고, 보류·취소) · 처리자 칩 · `시작`(지금 시각, 접수면 준비중으로) / `끝`(지금 시각, 준비완료로) — 시각은 고칠 수 있음.
3. "영업에서 수정됨" 띠 → `무엇이 바뀌었나`(마지막 확인 버전 ↔ 지금: 품목 추가·삭제·수량·모델·사양·날짜·주소·연락처) → `확인함`(seen_ver 갱신).
4. 품목별 기기 칸 카드(데스크탑 3대 = 3칸): 자산번호(입력하고 나가면 IT재고에서 시리얼·제조사·모델 채움 — 빈 칸만, IT재고 사양은 "IT재고: I7/16/512 [이 사양으로]"로 제안만) · 시리얼 · 사양 표(영업 값 | IT 값, 고친 칸 강조, 되돌리기) · 체크리스트(품목 묶음, "7/20") · 메모. 칸마다 나가면 저장 + "저장됨". 다른 건에 같은 자산번호가 있으면 노란 경고.
5. 건 단위: 기타 묶음 체크(랜선·공유기…) · 소모품(무상/청구) · 특이사항 · 비고 · 교체 건은 "회수할 기존 기기"(읽기만).
6. "같은 건으로 보이는 출고 준비 일정"(읽기만, §3-7) — 후보·준비 상태·`출고 준비에서 열기`. 안내 한 줄: "자산번호는 출고 준비 완료 보고에도 넣어 주세요(합치기 전까지)".
7. 영업에서 빠진 칸(있을 때만) — 옮기기·지우기.

핸드폰
- 같은 순서, 기기 칸 카드는 한 줄씩 꽉 차게, 체크리스트는 접힌 "체크 7/20 ▸", 입력칸 16px, 아래에 고정 막대(상태·다음 빈 칸으로). 인쇄 버튼은 숨김.

동시 수정: 칸·건 저장마다 `updated_at`를 같이 보내 다르면 "다른 사람이 방금 고쳤어요 — 새로 불러올게요"(체크는 서버가 그 항목만 합침).

### 4-3. 3단계 — 출력 (상세 위 `🖨 출고 확인서 인쇄`, PC)
1. A4 1장: 머리(상호·순번·구분·납품일·주소·담당자/연락처·영업담당·접수자·처리자) → 품목 표(영업 요청 | 확정 사양) → 기기 표(자산번호·시리얼·제조사/모델·확정 사양) → 소모품·특이사항.
2. 기기가 한 장에 안 들어가면(기준은 디자인에서 — 예: 8대 초과) 1장엔 "기기 명세는 다음 장", 2장째에 `ConfirmAttachment`(어댑터로) — 머리줄 반복.
3. 인쇄하면 printed_at 기록. 원본은 `영업 원본 열기`.
4. (3단계 화면 보여 드릴 때 확인) 맨 아래 고객 서명 칸을 둘지.

---

## 5. 작업 분해

### 0. 팀장 사전 작업 (병렬 시작 전, 겹침 방지)
- `lib/salesConfirms/types.ts`(server-only 아님): 영업 원문 타입, 정규화 타입, 목록 줄·상세·기기 칸 타입, 상태 6개 상수, 체크 묶음 이름, `salesConfirmHref(id)`, 서버 액션·라우트 이름과 인자 주석, 아래 컴포넌트·함수 이름.
- `lib/supabase/server.ts`에 표 이름 상수 5개.
- `app/confirm-form/page.tsx` 다시 쓰기(F16 방식): `searchParams.view` → `'legacy' | 'sales'`, 보기별 Shell note, 보기 칩(ui-designer의 `ConfirmViewChips`), `<Suspense key={view} fallback={<PageLoading/>}>` 안에 legacy = 지금 코드 그대로(`listRecentConfirmFormEntries` + `ConfirmFormPage`), sales = `loadSalesConfirmList()`(developer B) → `<SalesConfirmListPage>`(ui-designer). SetupGuide 분기는 보기별(legacy는 지금 schemaFile, sales는 `supabase/sales_confirms_schema.sql`).
- **Shell·`tabForPath` 안 고침**(주소가 그대로라).

### 1단계 (목록 + 가져오기 + 시트 비교) — db-schema ∥ developer A ∥ developer B ∥ ui-designer → sql-review → qa-checker → deploy-check

| 누가 | 할 일 | 파일 |
|---|---|---|
| **db-schema** | §3-2 표 5개 + ⑤ 첫 행 + RLS·revoke(표·시퀀스) + 롤백 주석 + `notify pgrst` | `supabase/sales_confirms_schema.sql`(새) |
| **sql-review** | 위 SQL 검사(사용자에게 건네기 전) | — |
| **developer A** (가져오기) | 응답 검사·정규화·hash용 정렬 문자열(순수), API 호출(키·시간 제한·오류 분류), 30일/90일 since·반영 규칙·겹침 막기·상태 기록, 라우트, 환경값 예시 | `lib/salesConfirms/normalize.ts`(순수) · `lib/salesConfirms/source.ts`(server-only) · `lib/salesConfirms/importer.ts`(server-only) · `app/api/sales-confirms/import/route.ts` · `.env.local.example`(이름 2줄) — 모두 새 파일(예시만 수정) |
| **developer B** (목록 데이터·홈) | 목록 읽기(날짜 창·페이지로 끝까지·기기 칸 요약 id 200개씩 `.in`), 처리여부·처리자 바로 바꾸기, 시트 비교 읽기·맞추기, 홈 새 카드·운영 타일·예전 카드 링크 | `lib/salesConfirms/listQuery.ts`(server-only, `loadSalesConfirmList`) · `app/confirm-form/salesActions.ts`('use server') · `lib/salesConfirms/sheetMatch.ts`(순수) · `lib/salesConfirms/sheetCompare.ts`(server-only, 시트 읽기만) — 새 파일 / `lib/homeDashboard.ts`(`loadSalesConfirmCard`·타일 추가, `loadConfirmCard` href → `/confirm-form?view=legacy`) · `components/home/HomeSections.tsx`(카드 한 칸 추가) · `app/home/page.tsx`(ⓓ 홈 열 때 가져오기 `after()`) |
| **ui-designer** | 보기 칩, 목록 화면·필터·가져오기 띠·m-cards·시트 비교 칸, 1단계 읽기 전용 미리보기 창, CSS | `components/salesConfirms/ConfirmViewChips.tsx` · `SalesConfirmListPage.tsx` · `SalesConfirmTable.tsx` · `ImportStatusBar.tsx` · `SalesConfirmPreview.tsx` — 새 파일 / `app/globals.css`(새 블록만, 핸드폰 덮어쓰기는 맨 끝 핸드폰 블록에 덧붙임) |
| **팀장** (마무리) | 설명서 `confirm-form` 다시 씀(주소·key 그대로 — 맨 위는 새 목록, 예전 꼭지 id `what`~`faq`는 "예전 방식" 아래로 옮겨 그대로 두어 카톡으로 보낸 `#꼭지` 링크가 안 깨지게, `updated`), releases, CLAUDE.md 새 절(로그인 때 막을 화면 목록 포함) | `lib/manual/docs/shipping.ts` · `lib/releases.ts` · `CLAUDE.md` |
| **qa-checker** | 타입·빌드, 순수 함수 Node 실행(normalize·sheetMatch), **importer가 ③④ 표 이름을 안 쓰는지 grep**, payload가 로그·라우트 응답·오류 문구에 없는지, 키가 코드에 없는지, **예전 보기(`?view=legacy`) 회귀**(세 탭·시트 기재·인쇄·출고 대장 기록), 칩으로 보기 오갈 때 진행 표시가 꺼지는지, 1000줄 페이지 읽기, 핸드폰 카드 | — |
| integration-rules | **안 부름**(외부·출고 준비에 쓰는 코드 없음) | — |

1단계 배포 순서: SQL 실행(사용자) → 키 Vercel(Production) → 배포 → 팀장 응답 모양 1회 실측(§3-6) → 파서 손볼 것 있으면 고쳐 다시 배포 → 사용자에게 목록 보여 줌.

### 2단계 (상세 편집) — developer C ∥ ui-designer → qa-checker → deploy-check

| 누가 | 할 일 | 파일 |
|---|---|---|
| **developer C** | 기기 칸 계산(순수), 버전 차이(순수), 출고 준비 후보 맞추기(순수, 읽기), 칸·건 저장(updated_at 확인, 체크 항목 단위 합치기), 처음 열람·확인함, 자산번호 조회(`lookupUnitByAsset` 그대로), 같은 자산번호 경고, 상세 페이지·주소 규칙 | `lib/salesConfirms/slots.ts`(순수) · `lib/salesConfirms/diff.ts`(순수) · `lib/salesConfirms/prepMatch.ts`(순수) · `lib/salesConfirms/work.ts`(server-only) · `app/confirm-form/[id]/page.tsx` · `app/confirm-form/salesDetailActions.ts`('use server') — 새 파일 |
| **ui-designer** | 상세 화면(PC·핸드폰), 기기 칸 카드, 사양 비교 편집, 체크리스트, 영업 수정 띠·차이 창, 빠진 칸, 출고 준비 후보 상자(읽기), 목록 줄 → 상세 링크로 바꾸기 | `components/salesConfirms/SalesConfirmDetail.tsx` · `DeviceSlotCard.tsx` · `SpecDiffEditor.tsx` · `ChecklistPanel.tsx` · `SalesChangeBanner.tsx` · `PrepHintBox.tsx` — 새 파일 / `SalesConfirmTable.tsx`(링크만) · `globals.css`(새 블록) |
| **qa-checker** | slots·diff·prepMatch Node 테스트(§3-4 사례), 영업 ver 올린 가짜 데이터로 IT 값 그대로인지, 동시 저장, **출고 준비 표에 쓰는 코드가 없는지 grep**(`it_prep_reports`·`it_prep_events` insert/update), 이상한 id 주소, 핸드폰 입력 16px·카드 | — |
| integration-rules | **안 부름**(D8 — 출고 준비 쪽에 안 씀) | — |
| 팀장 | 설명서 꼭지 추가·releases·CLAUDE.md | `lib/manual/docs/shipping.ts`, `lib/releases.ts`, `CLAUDE.md` |

### 3단계 (출력) — ui-designer + developer D → qa-checker → deploy-check

| 누가 | 할 일 | 파일 |
|---|---|---|
| **ui-designer** | A4 1장 양식, 넘칠 때 2장 기준 | `components/salesConfirms/SalesConfirmPrintDocument.tsx`(새) |
| **developer D** | 인쇄 포털(`#print-confirm-sheet-root` 재사용)·재서 줄이기(편집기 효과를 새 훅으로 복사 — 기존 편집기는 안 고침), `ConfirmAttachment`용 어댑터(순수), printed_at 저장 함수 하나 | `components/salesConfirms/usePrintFit.ts` · `lib/salesConfirms/printAdapter.ts`(순수) — 새 파일 / `app/confirm-form/salesDetailActions.ts`(함수 하나 추가) |
| **qa-checker** | 실제 인쇄 미리보기(1대·3대·12대·데스크탑+모니터 섞임), docUrl 검사, **예전 보기의 확인서 인쇄 회귀 없음** | — |

### 4단계 (출고 준비 리스트와 합치기) — **따로 설계**(D8)
feature-planner가 1~3단계를 써 본 뒤 다시 설계. 후보: 연결 저장, 자산번호 → 완료 보고, 완료 보고 → 빈 칸, 시작·완료 ↔ 네이버 이름 표시, 카톡·재고 반영 위치, 두 목록 합치기, 예전 보기(`?view=legacy`)와 `/dispatch` 정리. 네이버·카톡·시트에 쓰게 되므로 integration-rules 필수.

---

## 6. 위험·열린 질문

### 사용자에게 물을 것
**없음**(키 받는 방법만 팀장이 따로 물음). 3단계 화면을 보여 드릴 때 "고객 서명 칸을 둘지"만 같이 확인.

**영업 쪽에 물어봐 주실 것**(꼭 필요한 것만 — 나머지는 키 받은 뒤 실측으로 확인, §3-6)
1. 영업에서 확인서를 **지우거나 취소**하면 API에 어떻게 나오나요(목록에서 사라짐 / 취소 표시)? — 사라지기만 하면 우리 쪽은 알 수 없어 IT가 계속 준비할 수 있어요.
2. `docUrl`은 **로그인 없이** 열리나요? (IT팀이 영업 웹앱 계정이 없어도 원본을 볼 수 있는지)

참고로 알려 드릴 것(질문 아님)
- **메뉴는 그대로** — '확인서/출고및반출준비'를 누르면 이제 영업 확인서 목록이 먼저 나와요. 예전 화면(시트 기재·간단 등록·정식 납품확인서)은 위 `🗂 예전 방식` 칩으로 그대로 쓸 수 있어요(전환하는 동안). 홈의 "확인서 출고 기재" 카드는 예전 방식으로 바로 가요.
- 영업은 IT가 넣은 값을 안 보므로 **영업 쪽에 되돌려 쓰는 길은 만들지 않아요**(시트·API 모두). IT 값은 이 앱에만 남아요.
- `IT확인서리스트` 시트는 전환 동안 그대로 두고 이 기능은 시트에 안 써요. 목록에서 `📄 시트와 비교`를 켜면 같은 건을 나란히 볼 수 있어요(켰을 때만 시트를 읽어요).
- **연락처·주소는 지금은 잠그지 않아요**(결정하신 대로). 로그인을 붙일 때 이 화면과 출고 대장의 연락처를 같이 막아요.
- **출고 준비 리스트와 합치기 전까지는, 자산번호를 출고 준비 완료 보고에도 따로 넣어 주셔야 해요**(카톡 보고·IT재고 반영은 그 보고 기준). 상세 화면에 같은 건으로 보이는 출고 준비 일정과 바로 가는 버튼은 보여 드려요.
- 화면을 열어 두면 3분마다, 열 때마다 새 확인서를 가져와요. 아무도 안 열어 두면 안 가져오지만, 열면 최근 30일 것을 다시 받아서 빠지는 건 없어요. 새 확인서 카톡 알림은 이번에 안 해요.
- "새로" = 아직 아무도 상세를 안 열어 본 건. "영업에서 수정됨" = IT가 마지막으로 확인한 뒤 영업이 고친 건(무엇이 바뀌었는지 보여 드려요).
- 영업이 수량을 줄이거나 품목을 바꿔도 IT가 적은 자산번호·시리얼·고친 사양은 **지우지 않고** "영업에서 빠진 칸"으로 모아 보여 드려요.
- 처리여부는 접수·준비중·준비완료·출고에 **보류·취소**도 넣어요(시트에 실제로 있어서). 처리자 명단은 출고 준비의 `👥 담당자 관리` 명단을 같이 써요.
- 출고 체크리스트는 시트 '출고체크리스트' 탭과 같은 항목이 이미 앱에 있어서 그대로 써요(기기마다). 사진·카톡방 업로드 같은 건 단위 항목은 출고 준비 완료 보고에서 계속.
- 교체 건의 회수할 기존 기기는 보기만 해요(자산번호 칸 없음). 필요하면 말해 주세요.

### 위험 (개발·QA가 볼 것)
- **응답 모양 모름**(F15 — 영업 저장소에 코드 없음) — 추측 파서 금지. 배포 뒤 1회 실측(값 출력 금지) 후 확정. 모양이 다르면 하나도 안 씀.
- **30일 창 밖 수정·건수 상한** — 하루 한 번 90일 + 날짜 골라 다시 가져오기로 메움. 받은 건수가 딱 떨어지는 수면 상한 의심(§3-6).
- **취소·삭제를 모를 수 있음**(영업 확인 1) — 답 전까지 "영업에서 사라진 건"은 표시 못 함. 오래 안 받힌 건(30일 창 안인데 받은 목록에 없음)을 "영업 목록에 없음"으로 흐리게 보일지는 실측 뒤 판단.
- **IT 값 보호**는 구조로 — importer는 ③④를 import도 안 함, ③④는 화면 액션만. QA grep.
- **기기 칸 열쇠**가 종류+순서라 같은 종류 줄 순서가 바뀌면 다른 품목에 붙을 수 있음 → 스냅숏 경고로 드러남(§3-4). 실제 영업 수정 사례로 2단계에서 재평가.
- **개인정보 잠금 없음(D7)** — 주소를 아는 누구나 연락처·주소를 봄. 로그인 때 막을 화면을 CLAUDE.md에 적어 잊지 않게. 원문이 로그·오류 문구·상태 표·라우트 응답으로 새지 않게(QA grep `console.*payload` 류).
- **예전 보기 회귀** — `page.tsx`만 바뀌고 예전 컴포넌트는 그대로지만, Suspense·searchParams로 감싸면서 `maxDuration`·SetupGuide·`revalidatePath('/confirm-form')`(새 보기도 같이 새로 그려짐 — 무해) 동작 확인. 주소 ?뒤만 바뀔 때 page 재생성·진행 표시는 계약관리와 같은 주의(CLAUDE.md).
- **상세 주소에 영업 id** — 하위 정적 폴더 금지, encode/decode 한 곳(§4-2).
- **누구나 가져오기 라우트를 부를 수 있음**(로그인 없음) → 60초/10초 간격으로 막고, 응답에 원문 없음.
- **시트 읽기 한도**(IT재고·확인서와 같은 서비스계정) — 비교는 켰을 때 화면 열 때 1회, 연락처 칸 안 읽음, 한도면 "1분 뒤".
- **Supabase 1000줄** — 목록은 날짜 창 + 페이지로 끝까지, 기기 칸 요약·가져오기 비교는 id 200개씩.
- **영업 쪽 장애가 출고를 막으면 안 됨** — 저장된 목록·상세는 영업 API 없이도 다 됨.
- **두 화면에 자산번호를 두 번 적는 불편**(D8) — 4단계 전까지 감수. 출고 준비 완료 보고 쪽에 적은 번호와 다르면 보이지 않음(상세의 출고 준비 후보 상자에 보고 기기 수만 표시).
- 셸·로그에 `.env.local`·키·연락처 값을 출력하지 않음(이름·길이·건수만).

---

## 7. 하지 않을 것 (범위 밖)
- **영업 쪽에 쓰기**(API·영업 Supabase·영업 시트 — D4), 영업 Supabase 직접 연결(D1).
- `IT확인서리스트`·업체별 확인서 탭에 쓰기, 시트 → 앱 옮기기(지난 803줄 가져오기 없음 — 비교만).
- **개인정보 잠금**(비밀번호 칸 가리기·잠금 쿠키·연락처 빼고 보내기 — D7, 로그인 때 같이), 로그인, 개인정보 보관 기간 정리.
- **출고 준비 쪽에 쓰기**(D8 — 4단계): 연결 저장, 완료 보고로 기기 보내기, 완료 보고 기기로 채우기, 네이버 이름 표시, 카톡 발송, IT재고 반영, 사진 올리기.
- 예전 보기 컴포넌트(`ConfirmFormPage` 등)·`/dispatch` 코드 변경, 예전 보기·`/dispatch` 없애기(4단계 때 정리), Shell 메뉴 변경.
- 새 확인서 카톡 알림, 외부 스케줄러·Vercel 유료 cron.
- 교체 건 회수 기기 자산번호 기록, 소모품 챙김 체크, 견적·청구 연결.
- `/dispatch` 목록 1000줄 잘림 손보기(별건).
