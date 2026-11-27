[기획실 도면우]

# 영업 확인서 가져오기 → '확인서/출고및반출준비' 화면을 새 목록·상세·출력으로 (설계안, 2026-11-26 · 사용자 답 반영판 · 2·3단계 고침판 · **고침판 2 — 사용자 답: 출고 값 덧붙임·차이 확인 창, 유지보수 대마다, 라이선스 키 기록**)

크기: **큰 일. 1 목록(배포됨) → 2+3 상세·출력(한 번에 만들고 한 번에 보여 드림 — D24).** 출고 준비 리스트와 합치는 일은 **4단계로 따로 설계**(D8).
- 1단계(배포됨): 새 표 5개(SQL 한 번) + `/confirm-form` 기본 보기 교체(예전 화면은 `?view=legacy`로 그대로) + 영업 API 가져오기.
- 2+3단계: 상세 `/confirm-form/[id]`에서 기기마다 **제조사·모델명·자산번호·시리얼·출고사양** 입력(영업 요청과 다르면 **확인 창이 강제로 뜸** — D27) → **영업 웹앱 확인서 양식 그대로 출력, 영업 값은 그대로 두고 출고 값을 덧붙임**(D15~D18). 소프트웨어는 **라이선스 키까지 — 계약관리 잠긴 비밀 칸·소프트웨어 대장에 같이 쌓임**(D28~D30). 작은 SQL 추가 블록 2개(영업 확인서 표 칸 4개 · 계약관리 표 '출처' 값 1개).
외부에 **쓰는** 코드 없음 — 영업·시트·네이버·카톡·출고 준비 표 어디에도 안 씀(1~3단계). 단 2+3단계는 **우리 앱의 계약관리 소프트웨어 대장 표에 씀**(D28 — sql-review·qa 검사 항목).
흐름: (1단계) 기획 → 팀장 사전 작업 → db-schema ∥ developer A ∥ developer B ∥ ui-designer → sql-review → qa-checker → deploy-check.
(2+3단계) 팀장 사전 작업 → db-schema(작은 블록 2개) ∥ developer C(상세·차이 확인) ∥ developer E(라이선스 키·대장 연결) ∥ developer D(출력 양식) ∥ ui-designer → sql-review → qa-checker → deploy-check.
영업 API 응답 모양은 실측 끝(9건, CLAUDE.md "영업 확인서 가져오기" 절).

## 결정 표 (맨 위가 우선)

| # | 결정 | 상태 | 설계 반영 |
|---|---|---|---|
| D1 | 영업 데이터는 **영업 웹앱 읽기 전용 API로만** — `GET https://firstoa-smart-sales-os.vercel.app/api/export/it-confirms?since=YYYY-MM-DD`, 헤더 `x-export-key`. 우리 쪽 키 환경값 이름 `SALES_EXPORT_KEY`(Vercel Production, 코드·깃에 없음. 영업 쪽 이름은 `IT_EXPORT_KEY`). 영업 Supabase에 직접 안 붙음 | 확정(사용자 지침) | §3-6 |
| D2 | 같은 확인서는 영업 `id`로 덮어씀. `ver`가 오르면 "영업에서 수정됨" | 확정(지침) | §3-2 ①②, §3-6 |
| D3 | 영업 원래 값은 그대로 두고 IT 값(사양 수정·자산번호·시리얼·체크·처리)은 **다른 표에** 따로. 영업이 고쳐도(ver↑) IT 값은 안 덮음 — 가져오기 코드는 IT 표를 아예 안 읽고 안 씀 | 확정(지침) | §3-2 ③④, §3-4 |
| D4 | (2026-11-26 사용자) **영업은 IT 입력값을 안 봄 → ERP에만 저장, 영업 쪽 되돌려 쓰기 없음**(시트든 API든 만들지 않음) | 확정 | §7 |
| D5 | (2026-11-26 사용자) 앞으로 확인서는 영업 웹앱 API에서 읽기만. 영업 시트 탭에 IT가 칸을 써 넣는 방식(지금의 `📄 확인서 출고 기재`)은 **새 확인서에는 안 씀**. 기존 시트(확인서리스트 워크북의 `IT확인서리스트` 탭·업체별 탭)와 그 화면은 **전환하는 동안 그대로**(이 기능은 시트에 안 씀) | 확정 | §2, §3-8, §7 |
| D6 | 1 목록 → 2 상세 → 3 출력 순서, 단계마다 사용자 확인 — **2·3은 D24로 한 번에 보여 드림** | 확정(지침) | §5 |
| **D7** | (2026-11-26 사용자) **개인정보(연락처·주소)는 지금은 안 잠금. 로그인을 붙일 때 같이 막음.** ※ 지침 "IT팀 로그인한 사람만"과 **다름** — 그때까지는 주소를 아는 누구나 연락처를 볼 수 있음(지금 출고 대장과 같은 수준). 잠금 설계는 범위 밖. 유지하는 규칙: 서버 로그·오류 문구에 영업 원문(payload) 안 남김, docUrl 검사. (라이선스 키는 별도 — D29 잠금) | 확정 | §3-5, §7 |
| **D8** | (2026-11-26 사용자: "확인서/출고및반출준비가 이걸로 바뀌는 거고, 나아가서는 출고준비리스트와 함께 운영") **출고 준비 리스트와는 나중에 합침(4단계, 따로 설계).** 1~3단계는 새 화면만 — 출고 준비 쪽 표(`it_prep_reports`·`it_prep_events`)·네이버·카톡에 **안 씀**. 상세에서 "같은 건으로 보이는 출고 준비 일정"을 **보여 주기만**(읽기). 연결 칸 `prep_event_id`는 표에 미리 만들어 두되 4단계 전엔 안 씀 | 확정 | §3-7, §5 4단계 |
| D9 | 가져오기 시점 = 화면(목록·상세) 열 때 + 열려 있는 동안 **3분마다** + `🔄 새로고침` + 홈 열 때(10분 넘었으면 응답 뒤에). **Vercel cron은 안 씀**(Hobby는 하루 1번 — `app/api/cron/naver-calendar-sync/route.ts:9`) | 제안(팀장 확인) | §3-6 |
| **D10** | (2026-11-26 사용자) **새 메뉴 없음 — '확인서/출고및반출준비' 메뉴가 새 화면으로 바뀜.** 주소는 `/confirm-form` 그대로(홈 카드·설명서 key `confirm-form`·카톡 링크 안 깨짐). `page.tsx`가 보기 칩(`Link`, 계약관리 `?tab` 방식 + `<Suspense key={view}>`)으로 나눔: **기본 = 영업 확인서 목록**, `?view=legacy` = 지금의 `ConfirmFormPage` 그대로(📄 확인서 출고 기재·간단 등록·정식 납품확인서 — 컴포넌트 안 고침, 전환 기간 유지). 상세 = `/confirm-form/[id]`. `Shell` `SIDEBAR_SECTIONS`는 안 바꿈. 홈의 기존 "확인서 출고 기재" 카드 링크는 `?view=legacy`로 | 확정 | §2, §4, §5 |
| D11 | 출고 체크리스트 = **기존 표 `it_prep_photo_items` 그대로 읽음**(시트 '출고체크리스트' 탭 항목이 이미 들어가 있음 — F7). 데스크탑&노트북·모니터 묶음은 **기기마다**, 기타 묶음(랜선·공유기…)은 **건마다**. 항목 추가·삭제는 출고 준비 완료 보고 창에서만(같은 목록 공유, 새 화면은 읽기만) | 제안 | §3-2 ③④, §3-4 |
| D12 | 처리자 명단 = 출고 준비 `👥 담당자 관리` 명단(`it_prep_people`)을 읽어 씀, 한 건에 여러 명 가능(시트에도 두 명씩 적은 줄이 있음) | 제안 | §3-2 ③ |
| D13 | 처리여부 6단계 = 접수 → 준비중 → 준비완료 → 출고 + **보류·취소**(지침의 4단계 + 시트에 실제로 있는 보류 2·취소 8) | 제안 | §3-3 |
| **D14** | (2026-11-26 팀장 지시) **since 뜻을 영업에 묻지 않아도 되게**: 늘 **최근 30일**을 다시 받고 hash로 걸러 바뀐 것만 씀 + 그날 첫 가져오기 한 번은 **90일**. `⋯ 날짜 골라 다시 가져오기` 유지. since가 "만든 날" 기준이어도 30일(하루 한 번 90일) 안 수정분은 안 놓침 | 확정 | §3-6 |
| **D15** | (2026-11-26 사용자) **최종 목표 = 영업이 만든 확인서를 영업 양식 그대로 출력하고, 빈칸을 IT 값으로 채움**("영업 양식 그대로·빈칸 채움"). 양식 = 1면 고객 서명용(초록 띠에 지역 크게·거래처 정보·계약·청구 요약·품목 표의 회색 칸 '자산번호·S/N'·사양 줄·소모품·연락처·서명 전 확인·확인란) + 별지(품목이 많을 때) + 2면 출고·설치 확인(내부). 예전 설계의 "A4 1장 우리 양식"은 **버림** | 확정 | §3-9, §4-3 |
| **D16** | 양식은 **영업 웹앱 코드(`lib/confirmDoc.ts`·`lib/confirm.ts`·`public/confirm/rabbit.png`)를 우리 앱에 사본으로**(순수 함수) — 채움 없이 그리면 **영업 출력과 글자까지 같게**, 바꾸는 곳은 정해 둔 자리 P1~P6뿐. 지금은 GitHub의 11-20판, 영업이 최신판을 올리면 통째로 바꾸고 P1~P6을 다시 적용 | 확정(사용자 방향) | §3-9 |
| **D17** | (팀장 지시) 영업 가져오기에 **안 오는 칸**(계약기간·보증금·결제특이·추가조건·발주일·업종·현황표 순·팩스·계산서메일·계약서메일·품목별 렌탈료·소모품 단가)은 **빈칸으로 출력 — 실패 아님.** 영업 양식이 값 없을 때 찍는 **가짜 값(₩0, '확인서서명' 자동 체크)은 안 찍음**(F21). 오면 그대로 씀. 영업 쪽에 칸 추가 요청(§6) | 확정 | §3-1, §3-9 P2 |
| **D18** | (2026-11-26 사용자 Q1 답: "영업값은 두고 출고값이 있는 거야. 두 개가 같이 있는 거지. 영업 두고 덧붙임") 상세 입력 순서 = **제조사 · 모델명 · 자산번호 · 시리얼 · 출고사양**. **종이 = 영업이 적은 제조사·모델명·사양은 그대로 두고 출고 값을 덧붙임(둘 다 보임)**: 제조사·모델명이 다르면 회색 S/N 칸 첫 줄에 "출고 ○○ ○○", 사양 줄은 다른 칸만 "요청 8GB → 출고 16GB". 영업이 비워 둔 칸은 그 칸에 출고 값(빈칸 채움). 입력 칸을 비워 두면 = 출고 값 없음(영업 값만 나감) | 확정 | §3-4, §3-9, §4-2 |
| **D19** | (2026-11-26 사용자 Q2 답: "유지보수도 대마다") 품목 종류별 칸: **장비 / 모니터 / 유지보수 / 소프트웨어 / 기타 — 전부 수량만큼 칸.** 유지보수 = 칸마다 대상 기기 자산번호·시리얼(출고사양·체크리스트 없음). 소프트웨어 = 칸 하나 = 라이선스 하나(= 계약관리 좌석 하나, D28). 유지보수·소프트웨어는 수량 0이면 1칸 | 확정(유지보수) · 제안(소프트웨어 대마다) | §3-4 |
| **D20** | (2026-11-26 사용자) **유지보수·소프트웨어도 IT 것** — 받은 건을 다 보이고 상세·출력 대상. 유지보수는 이미 들어옴(2건), 소프트웨어는 0건 → 영업 쪽에 포함 요청 | 확정 | §3-4, §6 |
| **D21** | (2026-11-26 사용자) **지역은 목록·상세·출력 모두 눈에 띄게.** 출력은 영업 양식 머리 띠의 큰 지역 칸 그대로. 영업이 지역을 비워 두면 주소로 추정(영업 웹앱과 같은 `regionOf` 규칙) — 화면엔 "(추정)", 종이엔 빈칸 채움으로 그냥 적음 | 확정 · 제안(추정) | §3-3, §3-9, §4-2 |
| **D22** | 회색 칸 채우는 규칙: 기기 순서대로 칸 안에 — "출고 모델" 줄이 없으면 한 품목 **4대까지**, 있으면 **2대까지**, 소프트웨어(키 한 줄에 하나)는 **2대까지**. 넘거나 칸이 넘치면 "출고 명세 참조 (n대)" + 뒤에 **'출고 명세(대수별)' 장**. 기기끼리 출고 모델·사양이 다르면 그 자리만 "기기별(명세)" | 제안(팀장 확인) | §3-9 |
| **D23** | 출력 방식 = 상세의 **출력 창 안에 격리된 미리보기(iframe `srcDoc` + `sandbox`)를 띄우고 그 안에서 인쇄**(영업 앱 미리보기와 같은 방식). 예전 인쇄 포털 `#print-confirm-sheet-root`·`ConfirmAttachment`는 **안 씀** | 제안(팀장 확인) | §3-9, §4-3 |
| **D24** | **2단계와 3단계를 합쳐 한 번에 만들고 한 번에 보여 드림.** 입력 칸이 출력 칸에서 정해지고, 사용자는 종이를 보고 판단하므로. 납품 확인서는 지금 가진 11-20판 양식으로, **교체·유지보수 확인서의 출력은 영업 최신 양식을 받은 뒤 열림**(그 전엔 출력 버튼 자리에 이유 — 11-20판엔 교체 전/후·유지보수 자리가 없어 회수 기기가 빠진 종이가 나감). 입력은 모든 구분이 지금부터 됨 | 제안(팀장 확인) | §5 |
| **D25** | 출력 기록 = ③ `printed_at`·`printed_ver`·`printed_by`(새 칸 2개). 출력 뒤 영업이 고치거나 IT가 칸을 고치면 "출력 뒤 바뀜 — 다시 뽑기". 종이 꼬리에 "IT 기재" 표시(영업이 뽑은 빈 종이와 구별), 2면 출고 준비자 = 처리자 이름·출고일 = 출고 시각 | 제안 | §3-2, §3-9 P4·P5 |
| ~~D26~~ | ~~라이선스 키는 이 화면·종이에 안 적음~~ → **뒤집음**(2026-11-26 사용자: "라이선스키는 적어야지 우리가 관리하지") — D28~D30 | 폐기 | — |
| **D27** | (2026-11-26 사용자: "사양이 영업부에서 요청한 거인데 다를 경우 강제 입력 팝업이 떠서 한 번 더 체크") **제조사·모델명(소프트웨어는 제품명)·출고사양이 영업 요청과 다르면 저장할 때 확인 창이 강제로 뜸** — 칸별 "영업 요청 8GB → 출고 16GB", [맞아요, 이대로]를 눌러야 저장. 서버도 같은 검사. 누가 언제 어느 칸을 확인했는지 ④ `diff_ack`에 남김 — 그 뒤 출고 값이나 영업 요청이 또 바뀌면 다시 물음. 자산번호로 IT재고에서 채운 값도 같은 규칙. 종이엔 확인 표시 안 함(덧붙은 출고 값이 곧 확인한 값) | 확정 | §3-10 |
| **D28** | (2026-11-26 사용자) **라이선스 키 입력은 이 확인서 상세에서, 저장은 계약관리의 잠긴 비밀 칸**(`it_contract_secrets`, `lib/contracts/secrets.ts` 한 파일로만), **거래처 소프트웨어 대장(계약관리 → 소프트웨어 계약)에도 같이 쌓여 한 곳에서 관리.** 확인서 소프트웨어 칸 하나 = 대장 좌석 하나, 제품 = 대장 상품 하나, 확인서 상호 = 대장 거래처(처음 한 번 고름). 중복 막는 열쇠 = 대장 표의 `source='sales_confirm'` + `source_key` | 확정(방향) · 제안(연결 규칙) | §3-11 |
| **D29** | 라이선스 키 **보기·고치기·지우기, 대장에 상품·좌석 만들기 = 계약관리 비밀번호로 잠금 해제한 상태에서만**(같은 쿠키 `it_ct_unlock`, 2시간 — 서버가 `requireUnlock`으로 막음). **키 넣기도 잠금 해제 상태에서만**(추천 — 이유 §3-11, **Q3**). 설치 PC·사용자·제품명 같은 일반 칸은 잠금 없이 확인서에 저장. 열람·수정은 `it_contract_secret_log`에 남김(값 없이) | 확정(보기 잠금) · 제안(넣기도 잠금 — Q3) | §3-11 |
| **D30** | (2026-11-26 사용자) **종이에도 키를 찍음** — 소프트웨어 칸의 회색 S/N 자리에. 출력 창을 열 때 풀려 있으면 키까지 그리고, 잠겨 있으면 [🔓 비밀번호 넣고 키까지 찍기] / [키 없이 찍기] 중 **골라야 인쇄 버튼이 켜짐**(키 없이 = 그 자리 밑줄 빈칸). 키는 출력 창 안에만 있고 어디에도 저장 안 함, 출력 때 `view_bulk` 기록 | 확정(찍음) · 제안(고르기 강제) | §3-9, §4-3 |

---

## 0. 지금 코드·데이터에서 확인한 것 (근거)

| # | 사실 | 위치 / 방법 |
|---|---|---|
| F1 | **`IT확인서리스트`·`출고체크리스트` 탭은 영업 확인서리스트 워크북**(`1seFubCF…` = `CONFIRM_SHEET_ID`, 업체별 확인서 탭과 같은 곳)에 있음. 코드는 확인서 목록에서 이 두 탭을 건너뛰기만 함 | lib/confirmSheetServer.ts:9,13 |
| F2 | **`/dispatch`(출고/접수 대장, 표 `it_dispatch_log`)가 이미 "구 IT확인서리스트를 웹으로 옮긴 것"** — 칸 이름이 시트 머리줄과 1:1. 손으로 한 줄씩 적는 대장. `/confirm-form`의 간단 등록·정식 납품확인서도 여기 씀. 목록은 `.limit` 없이 읽음(1000줄 잘림 위험 — 이번 범위 밖) | lib/dispatch.ts:1-9, supabase/dispatch_schema.sql, app/dispatch/page.tsx:19-23 |
| F3 | 그런데 **시트 `IT확인서리스트`는 지금도 매일 씀**(11-26 접수 줄 있음) → `/dispatch`로는 안 넘어갔음 | 아래 실측 |
| F4 | 앱 전체 로그인 없음(미들웨어 없음). 잠금은 계약관리 소프트웨어 탭 비밀번호뿐 — 연락처엔 D7로 안 씀, **라이선스 키엔 씀(D29)** | lib/contracts/secrets.ts |
| F5 | 고객 연락처는 이미 다른 화면에도 잠금 없이 보임(출고 대장 `연락처` 칸, 확인서 시트 내용) → 로그인 붙일 때 같이 막을 화면 목록에 넣음 | lib/dispatch.ts:24 |
| F6 | Vercel cron은 하루 1번(Hobby) — 네이버 동기화도 실제로는 "화면 열 때 + 열려 있는 동안 60초마다"(API 라우트로 빼서 버튼과 따로 돔) | app/api/cron/naver-calendar-sync/route.ts:9-16, app/api/shipment-prep/sync/route.ts, components/shipmentPrep/ShipmentPrepPage.tsx:93 |
| F7 | 출고 체크리스트는 이미 앱 표 `it_prep_photo_items(label, grp, sort_order)`에 시트 탭과 같은 항목 31개(데스크탑&노트북 20 · 모니터 5 · 기타 6) | supabase/shipment_prep_checklist.sql |
| F8 | 자산번호 → 시리얼·모델·사양 조회는 `lookupUnitByAsset(assetId, hint)`(서버 액션, IT재고 색인 5분 캐시 `findAssetBriefs` — 읽기만) | app/shipment-prep/reportActions.ts:238, lib/inventory/assetIndex.ts |
| F9 | 확인서 ↔ 일정 후보: `eventsAround(dates)`(납품일 ±14일 IT 일정 읽기), 일정 제목 구조 `parseEventTitle`(구분 칸 +4 = 거래처) | lib/confirmLink.ts:52, lib/shipmentPrep.ts:43 |
| F10 | 확인서 → 완료 보고 기기 채우기 `pushDocToPrep` — 4단계 참고용(이번엔 안 씀) | lib/confirmLink.ts:133 |
| F11 | (예전 화면) 인쇄: body 바로 아래 포털 `#print-confirm-sheet-root` + `@page A4 margin 0` + 재서 줄이기(zoom) + 별첨 `breakBefore: page`. 별첨 `ConfirmAttachment({ doc: ConfirmDoc })` = 대수별 자산번호·모델·S/N·사양 표(A4 폭 733px, 분홍 머리). **새 출력은 이걸 안 씀(D23)** | components/confirmForm/ConfirmSheetEditor.tsx:216-238,687-703, app/globals.css:373-379, components/confirmForm/ConfirmAttachment.tsx |
| F12 | 홈 카드: 함수마다 예외 안 던지고 그 카드만 "못 읽음". 시트 기반 "확인서 출고 기재" 카드 링크 = `/confirm-form`(→ `?view=legacy`로 바꿀 곳) | lib/homeDashboard.ts:368-369, components/home/HomeSections.tsx:77 |
| F13 | 최선노력 반영 실패는 삼키지 않고 주황 알림(`.toast.toast-warn`), 이유 문구 `lib/syncFailure.ts` | CLAUDE.md 동기화 주의 |
| F14 | 의존성에 zod 없음 → API 응답 검사는 손으로 쓴 순수 함수 | package.json |
| **F15** | **영업 API 팀장 실측(2026-11-26)**: 키 없이 `GET /api/export/it-confirms` → **401** `{"message":"키가 없거나 맞지 않습니다."}`, 없는 주소 `/api/export/zz` → **404** ⇒ **주소는 배포돼 있음**. 영업 Vercel 프로젝트 환경값 `IT_EXPORT_KEY`(production, sensitive — 다시 볼 수 없음 → 영업 담당에게 값을 따로 받아야 함). GitHub `FIRSTOA/firstoa-smart-sales-os` main 마지막 push 11-20, export 코드 없음(로컬 배포로 보임) → **응답 모양은 코드로 못 봄, 키 받은 뒤 1회 실측** | 팀장 |
| F16 | 계약관리의 보기 나누기 = `page.tsx`가 `searchParams`로 탭을 고르고 `Shell` 제목·메모를 바꾼 뒤 `<Suspense key={tab}>` | app/contracts/page.tsx |
| F17 | `/confirm-form`을 가리키는 곳: Shell 메뉴, 홈 확인서 카드, 설명서 `confirm-form`, 예전 액션의 `revalidatePath('/confirm-form')` 4곳. `app/confirm-form/` 아래 하위 폴더 없음 | grep |
| **F18** | **영업 양식(GitHub main 11-20판)**: `lib/confirmDoc.ts` `renderConfirm(d, origin, withBack)` → **HTML 문자열 한 장**(CSS·스크립트 포함). 영업 앱은 미리보기를 `<iframe srcDoc>`로, 인쇄는 `window.open` + `document.write` + `print()`. 1면 품목 **2개**(`FIRST_CAP`), 나머지는 별지 한 장에 **7개씩**(`MORE_CAP`), 2면 = 출고·설치(내부, `withBack`). 머리 초록 띠 = **지역(크게)** · 기간 · 제목 · 현황표 순 | `gh api …/contents/lib/confirmDoc.ts`(읽기만), components/ConfirmBuilder.tsx:198-232 |
| **F19** | IT 품목 한 줄 = 첫 줄(품목구분·모델명·제조사·기기상태·수량·월 렌탈료) + **사양 줄**(`hasSpec(cat)` = /데스크탑\|노트북\|맥북\|PC\|본체/ 일 때만, 칸은 `specKeys(cat)` — 인치는 노트북·맥북만) + **회색 줄**(자산번호 칸 약 38mm · S/N 칸 약 76mm · 설치장소·요청사항 칸 = 영업 `place`). 회색 줄 높이 8mm, 양식 안 스크립트가 남는 자리만큼 키움(최대 12mm) | confirmDoc.ts itemRows·colgroup·CSS |
| **F20** | **`.page` 높이 고정(284.5mm) + `overflow:hidden`** → 1면 내용이 길어지면 맨 아래 **확인란·서명 칸이 말없이 잘림.** 영업 주석: 7.4pt 미만 글씨·연한 색 금지(출력 때 깨짐) | confirmDoc.ts CSS |
| **F21** | 값이 없을 때 영업 양식이 찍는 것: 렌탈료 합계·보증금·최초 청구액 = **₩0**, 계약서 = `contractType('')` → **'확인서서명'에 자동 체크**, 현황표 순·발주일·업종 = 빈칸. ⇒ 가져오기에 그 칸이 안 오는데 그대로 그리면 **가짜 값이 종이에 찍힘** | confirm.ts contractType·totalRent, confirmDoc.ts page1 |
| **F22** | 영업 `lib/confirm.ts`: `ConfDoc` 칸 목록, `IT_CATS` = 데스크탑·노트북·모니터·맥북·태블릿·기타(11-20판), `REGIONS` 수도권A~E, `regionOf(address)`(주소 → 지역, 모르면 ''). **배포된 영업 웹앱은 이보다 새 판**(type 납품/교체/유지보수·before/after `{item,model,maker,sn,asset,spec,sw}` — 11-20판엔 없음) | `gh api`, 실측 |
| **F23** | 1단계 목록의 `unitsTotal`이 품목 수량을 **전부** 더함 → 소프트웨어 등 진행에 안 셀 종류도 n에 들어감. 칸 열쇠 계산이 목록 안에 따로 있음(`slotKeys`) | lib/salesConfirms/listQuery.ts:153-177 |
| **F24** | `lookupUnitByAsset` 결과: `model` = "제조사 모델" 붙인 글자, `brand` 따로, `spec` = IT재고 사양 **한 줄 글자**("I7/12/16/512/X/4050" 꼴 — 칸별 아님) | app/shipment-prep/reportActions.ts:238-270 |
| **F25** | 자산번호는 짧음(설명서 예시 5자 안팎), 시리얼은 13자 안팎 → 회색 자산번호 칸(38mm) 한 줄에 3개, S/N 칸(76mm) 한 줄에 2개 정도. 라이선스 키(보통 25~29자)는 한 줄에 하나 | lib/manual/docs |
| **F26** | 우리 앱엔 iframe 을 쓰는 화면이 아직 없음. `public/`엔 `icons/`뿐(`/confirm/` 경로 비어 있음) | grep, ls |
| **F27** | 계약관리 비밀 칸 `it_contract_secrets`: 주인 = **상품(contract_id) 또는 좌석(seat_id) 중 정확히 하나**(`one_owner`), (주인, field) 유일, field ∈ license_key·account·admin_account·card·other, 값 `value_text` 평문. 주인이 지워지면 cascade | supabase/contracts_schema.sql:208-238 |
| **F28** | `it_sw_contracts`·`it_sw_seats`의 `source` CHECK = **('app','sheet_renew','sheet_perm')뿐**, `source_key` 일반 unique(시트 옮기기 중복 방지 — `perm:<행>` 꼴). 새 출처 값을 쓰려면 **CHECK 교체 SQL 필요** | contracts_schema.sql:130-138,180-187 |
| **F29** | `secrets.ts`: `writeSecret`·`readSecretsForOwners`는 **안에서 `requireUnlock`을 다시 함**, `secretFlags`(어느 칸에 값이 있는지만)는 잠금 없이, `logSecretEvent`(값 없이 기록, 실패해도 안 던짐). `insertSecretsIfMissing`은 부르는 쪽이 잠금 확인. 계약관리 소프트웨어 쪽 읽기·쓰기 액션은 전부 `runLocked`(잠금 해제 필요) | lib/contracts/secrets.ts:276-293,670-814, app/contracts/actions.ts:78-90 |
| **F30** | 거래처 만들기: `ensureClient('new:…')`(works 묶음에서 — 맞은 줄 id·코드 기록), `createManualClientRow(name)`(works에 없음 `not_in_works`, 같은 이름 키면 그것), 시트 옮기기의 못 정한 묶음 = `'미분류(시트에서 옮김)'` 거래처. 후보 목록은 `buildContractsOverview('sw')`(저장된 거래처 + works 실시간). 상품을 다른 거래처로 = `moveSwContract`. 잠금 해제 화면은 `components/contracts/PasswordGate.tsx`(`unlock`·`onUnlocked`) | lib/contracts/clients.ts:358,615-677, lib/contracts/sheetImport.ts:42,292 |
| **F31** | 계약관리 화면은 상품·좌석의 `source` 값을 화면에 안 그림(메모만) → 새 출처 값을 넣어도 화면 코드는 안 고쳐도 됨 | grep components/contracts |

### 시트 실측 (2026-11-26, 읽기 전용 — 연락처·상호·사람 이름 값은 문서에 안 옮김)
- 워크북 탭 65개: 앞 6개(확인서·IT확인서리스트·복합기확인서리스트·출고체크리스트·장비반출확인서·지우지마시요) + 업체별 확인서 탭 59개. **업체별 탭이 11-24·25·27·30 날짜로도 새로 생김** → 영업이 시트 확인서도 아직 일부 만듦(전환 중).
- **`IT확인서리스트`**: 머리줄 1행(고정), 데이터 803줄. 칸: A 순번 · B 납품/교체일(`11월27일` — **연도 없음**) · C 접수일(`11.25`) · D 접수시간 · E 시작 · F 종료 · G 처리여부 · H 접수자 · I 처리자 · J 구분 · K 날짜(뜻 미확인) · L 소모품/특이사항 · M 상호 · N 연락처 · O 품목 · P 직송(실제로는 사양 메모) · Q 자산번호(568칸, 여러 줄 14) · R 비고 · S 이름 없는 칸 · T 시리얼번호(**14칸뿐**).
  - 처리여부: 준비완료 726 · 처리완료 52 · 취소 8 · 보류 2 · 요청사항을 적은 긴 글 몇 줄. 구분: 납품 646 · 교체 148 · 판매 2 · 이전 2. 처리자 칸에 두 명을 같이 적은 줄 있음.
  - 최근 열흘(11-16~26) 접수 약 25줄 ⇒ **하루 2~3건** → 30일이면 약 70~100건(응답 크기 추정 근거, §3-6).
- **`출고체크리스트`**: 데스크탑&노트북 20 · 모니터 5 · 기타 6 = 앱 `it_prep_photo_items`와 같음(F7). 아래 두 줄(사진·카톡방 업로드·포장·대수 일치)은 건 단위 일 — 출고 준비 완료 보고 몫이라 새 화면엔 안 넣음.

---

## 1. 한 줄 목표와 쓰는 사람

**영업 웹앱에서 저장된 IT 확인서를 몇 분 간격으로 가져와 '확인서/출고및반출준비' 화면의 기본 목록으로 보여 주고('IT확인서리스트' 시트 대신), 건마다 기기 칸(품목 수량만큼)에 IT가 제조사·모델명·자산번호·시리얼·출고사양(소프트웨어는 설치 PC·라이선스 키)을 넣고 — 영업 요청과 다르면 한 번 더 확인하고 — 출고 체크를 채워, 영업이 만든 확인서를 영업 양식 그대로(1면 고객 서명용 · 별지 · 2면 출고·설치) 영업 값 옆에 출고 값을 덧붙여 뽑는다.** 영업 값은 읽기만, IT 값은 ERP에만. 라이선스 키는 계약관리 잠금 칸·소프트웨어 대장에 같이 쌓인다.

- 목록·상세 편집·**출력**·라이선스 키: 주로 **PC**(창고 사무실).
- 창고에서 기기 앞: **핸드폰**(홈 화면 앱) — 목록 카드, 상세에서 자산번호·시리얼 입력과 체크(차이 확인 창도 핸드폰에서 뜸). 출력은 PC.

---

## 2. 기존 코드 재사용·확장 지점

| 파일:함수 | 어떻게 |
|---|---|
| `app/confirm-form/page.tsx` | **바뀜(팀장, 1단계 끝)** — 계약관리처럼 `searchParams.view`로 나눔. 기본 = 새 목록, `legacy` = 지금 내용 그대로(`listRecentConfirmFormEntries` + `ConfirmFormPage`). `maxDuration = 60` 유지 |
| `components/confirmForm/*`, `app/confirmForm/*`, `lib/confirmSheet*.ts`, `lib/confirmLink.ts` | **안 고침** — 예전 보기에서 그대로 돎 |
| `components/confirmForm/ConfirmAttachment.tsx`, `app/globals.css` `#print-confirm-sheet-root` | **안 씀**(D23) — 대수별 표라는 생각만 참고해 영업 양식 색·글꼴로 HTML 안에 새로 그림(§3-9 P3). 예전 보기 인쇄는 그대로 |
| 영업 저장소 `lib/confirm.ts`·`lib/confirmDoc.ts`·`public/confirm/rabbit.png`(`gh api`로 읽기만) | **사본으로 옮겨 옴**(D16, §3-9) — `lib/salesConfirms/salesForm/` + `public/confirm/rabbit.png` |
| `lib/salesConfirms/normalize.ts` | **출력용 칸을 더 읽음**(안 오면 null — D17). 반환 모양에 칸만 추가, 가져오기 동작·hash·`extractRecords` 그대로 |
| `lib/salesConfirms/listQuery.ts` `slotKeys`·`unitsTotal` | 칸 계산을 `slots.ts` 한 곳으로(F23), 진행 n/m 의 m = 장비·모니터·유지보수 수량만, 지역 추정·출력 표시·"다시 확인 필요" 표시 추가 |
| `lib/contracts/secrets.ts` `writeSecret`·`readSecretsForOwners`·`secretFlags`·`logSecretEvent`·`requireUnlock`·`isUnlocked` | **import만**(고치지 않음) — 라이선스 키 쓰기·읽기·있음 표시·기록(D28·D29) |
| `lib/contracts/clients.ts` `buildContractsOverview('sw')`·`ensureClient`·`createManualClientRow`, `lib/contracts/nameKey.ts` `nameKey` | **import만** — 대장 거래처 후보·만들기(F30) |
| `components/contracts/PasswordGate.tsx`, `app/contracts/secretActions.ts` `getUnlockState`·`unlockSecrets` | **import만** — 확인서 화면에서 같은 비밀번호로 잠금 해제(같은 쿠키라 계약관리도 같이 풀림) |
| 새 파일 `lib/contracts/salesConfirmLink.ts` | 계약관리 쪽에 **새 파일 하나만** — 확인서 소프트웨어 칸 ↔ 대장 거래처·상품·좌석·키 연결(§3-11). 기존 계약관리 파일은 안 고침 |
| `app/contracts/page.tsx` 보기 나누기 방식 | 같은 모양(`<Suspense key>`, 칩은 `Link`) — CLAUDE.md "주소 ?뒤만 바뀌면 page를 새로 안 만듦" 주의 그대로 |
| `app/shipment-prep/reportActions.ts` `lookupUnitByAsset` | 기기 칸 자산번호 입력 → 제조사(`brand`)·모델명(`model`에서 앞 제조사 뗌)·시리얼 채우기, IT재고 사양은 힌트(F24). 채운 값도 차이 확인 창 규칙(D27) |
| `it_prep_photo_items`(읽기) | 체크리스트 항목(D11) |
| `app/shipment-prep/actions.ts` `listPrepPeople`(읽기) | 처리자 명단(D12) |
| `lib/confirmLink.ts` `eventsAround`, `lib/shipmentPrep.ts` `parseEventTitle`·`isItPrepTarget`(읽기) | 상세의 "같은 건으로 보이는 출고 준비 일정" 표시(D8) |
| `components/MobileTableCards.tsx`(`m-cards`)·`MobileFilterRows.tsx` | 목록 핸드폰 카드·필터 접기 |
| `lib/syncFailure.ts`, `.toast.toast-warn` | 가져오기 실패 문구·주황 띠 |
| `lib/homeDashboard.ts` | 새 카드 `loadSalesConfirmCard` + 운영 타일 1개, `loadConfirmCard` 링크만 `?view=legacy` |
| **안 건드림** | `components/Shell.tsx`(메뉴 그대로), `/dispatch`, 출고 준비 화면·액션, 네이버·카톡 코드, 계약관리 기존 파일(`lib/contracts/*` 기존·`app/contracts/*`·`components/contracts/*` — import만) |

---

## 3. 데이터 설계

### 3-1. 받는 데이터(영업 API 1건) — 실측으로 확정(CLAUDE.md "영업 확인서 가져오기")
`{ id, no, ver, type('납품'|'교체'|'유지보수'), term('일반/장기'|'현장/단기'), savedAt, savedBy, sales, company, address, region, deliveryDate, contacts{manager,resident,payer,contractor,phone}, special, items:[{cat,model,maker,state,qty,spec{CPU,RAM,SSD,HDD,그래픽,OS,인치,…},place}], supplies:[{name,qty,charge,note}], before/after, docUrl, inflow, leaseNo, reason }` — 바깥은 `{count, list}`.
- 개인정보: `contacts` 전부, `address`(D7 — 지금은 화면에 그냥 보임).

**영업 양식이 쓰는 칸 vs 지금 오는 칸(D17)** — 안 오는 칸은 빈칸으로 출력, 영업 쪽에 추가 요청(§6). 오면 `normalize`가 읽어 그대로 씀.

| 양식 자리 | 칸 | 지금 |
|---|---|---|
| 머리 띠 | region · term · statusNo(현황표 순) | region·term 옴 / **statusNo 안 옴** |
| 거래처 정보 | company · orderDate(발주일) · deliveryDate · inflow(유입담당) · sales · industry(업종) · address · special | **orderDate·industry 안 옴** |
| 계약·청구 요약 | months(계약기간) · contractMail(계약서 종류 판단) · items[].rent(월 렌탈료) · deposit(보증금) · payNote(결제특이) | **전부 안 옴** → 빈칸(₩0·자동 체크 안 함) |
| 납품 정보(품목 표) | items[] cat·model·maker·state·qty·spec·place · rent · extra(추가조건·혜택) | **rent·extra 안 옴** |
| 소모품 | supplies[] name·qty·charge·note · price | **price 안 옴** → 양식대로 청구 건은 '청구 시' |
| 거래처 연락처 | phone(회사전화) · fax · payer · contractor · manager · resident · taxMail · contractMail | **fax·taxMail·contractMail 안 옴** |
| 꼬리 | no · ver · company | 옴 |
| (확인서 종류) | kind 'it' / 'mfp' | **안 옴** → 'it'로 봄 |
| **회색 칸** | 자산번호 · S/N (복합기는 개시 카운터·여분) | 영업 앱은 **비워 둠**(종이에 손으로) → **우리 ④ 값으로 채움** |

정규화 확장(developer D): `NormalizedSalesConfirm`에 `print: { kind, orderDate, months, deposit, payNote, extra, industry, statusNo, fax, taxMail, contractMail }`(각 `string | null` — **null = 안 옴, '' = 영업이 비워서 보냄**), 품목 `rent: number | null`, 소모품 `price: string | null`. ① 표 칸은 안 늘림 — 상세·출력은 payload 를 지금 normalize 로 다시 읽음(1단계 규칙).

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
| sales_state | text default '' | 영업에서 취소·삭제 신호가 오면(§6 영업 요청 4) |
| first_seen_at / changed_at / fetched_at | timestamptz | 처음 받은 때 / ver·내용이 바뀐 때 / 마지막으로 받은 때 |

인덱스: `delivery_date`, `first_seen_at desc`.

② `it_sales_confirm_versions` — ver마다 원문(무엇이 바뀌었나 보기용). `(confirm_id, ver, payload_hash)` 유일, `payload jsonb`, `fetched_at`. FK → ①(cascade — ①을 지우는 코드는 없음).

③ `it_sales_confirm_work` — **IT 처리(건당 1행, 화면만 씀).** 행이 없으면 = 접수·아무도 안 열어 봄.

| 칸 | 메모 |
|---|---|
| confirm_id text PK, FK → ① | |
| status text default '접수' | D13 6단계(DB CHECK 없음 — 기존 대장처럼) |
| processors text[] | D12 · **출력 2면 '출고 준비자'**(D25) |
| started_at / finished_at / shipped_at | 시작·종료·출고 시각(사람이 고칠 수 있음) · shipped_at = **출력 2면 '출고일'**·대장 좌석 설치일 |
| note text | 비고 |
| seen_ver int, seen_hash text | **IT가 마지막으로 확인한 영업 버전** → "영업에서 수정됨" = seen_ver 있음 && ver > seen_ver (2026-11-27 바꿈 — 예전 "또는 같은 ver인데 hash 다름"은 영업이 export 칸을 넓힌 날 전부 잘못 뜸. 영업은 저장마다 ver 를 올림. `salesChangedSince`) |
| first_opened_at, first_opened_by | "새로" 강조 = 이게 비어 있음 |
| checks jsonb `{label:{at,by}}` | 건 단위 체크(기타 묶음) |
| prep_event_id uuid null, FK → it_calendar_events **on delete set null** · link_source text | **4단계용 — 미리 만들어 두고 1~3단계 코드는 안 씀**(D8) |
| printed_at | 마지막 인쇄 |
| **printed_ver int null, printed_by text default ''** | **2+3단계 추가(D25)** — 출력한 영업 판·사람 |
| updated_at, updated_by | 동시 수정 확인용 |

④ `it_sales_confirm_units` — **기기 칸(화면만 씀).** 빈 칸은 행을 안 만듦(처음 입력할 때 생김).

| 칸 | 메모 |
|---|---|
| id uuid PK | **소프트웨어 칸이면 대장 좌석 열쇠(`sales_confirm_unit:<id>`)** — 칸을 옮겨도 안 바뀜 |
| confirm_id text FK → ① | |
| slot_key text, unit_no int | `unique(confirm_id, slot_key, unit_no)` — 규칙 §3-4 |
| item_snapshot jsonb | 이 칸을 채울 때의 영업 품목(cat·model·maker·state·spec) — 영업이 품목을 바꾸면 비교해 경고 |
| asset_id, serial | text default '' — 유지보수는 대상 기기의 것. **소프트웨어는 안 씀**(설치 PC는 extra — 다른 건 같은 자산번호 경고가 잘못 뜨지 않게) |
| actual_maker, actual_model | **출고 값**(IT재고에서 채움, 고칠 수 있음). 비어 있으면 = 출고 값 없음(영업 값만 나감 — D18). 소프트웨어는 actual_model = 제품명 |
| spec_override jsonb `{RAM:'16GB',…}` | **출고 사양 중 IT가 적은 칸만**(영업 값은 ①에 그대로). 키 이름 = 영업 양식 `SPEC_KEYS`와 같음(CPU·RAM·SSD·HDD·그래픽·OS·인치) |
| checks jsonb `{label:{at,by}}` | 기기별 체크(D11) |
| note | |
| **extra jsonb default '{}'** | **2+3단계 추가** — 종류별 칸. 소프트웨어 `{ installPc, userName, ledgerPushed: { pc, user, product } }`(ledgerPushed = 지난번에 대장 좌석에 올린 값 — §3-11 덮어쓰기 규칙). **라이선스 키는 여기 절대 안 넣음** |
| **diff_ack jsonb default '{}'** | **2+3단계 추가(D27)** — 영업 요청과 다른 칸을 확인한 기록 `{ "maker": {sales, actual, at, by}, "model": {…}, "spec.RAM": {…} }`. 지금의 (영업 값, 출고 값) 쌍이 기록과 같을 때만 "확인됨" |
| updated_at, updated_by | |

인덱스: `confirm_id`, `asset_id`(다른 건에 같은 자산번호 경고용, `where asset_id <> ''`).

⑤ `it_sales_import_state` — 가져오기 상태 1행(`id='main'`, SQL이 만들어 둠): `last_attempt_at, last_success_at, last_deep_at(90일 받은 때), last_window_days, last_error_code, last_error text(이유만, 원문 없음), last_counts jsonb{received,new,updated,unchanged,older,skipped}`.

표 이름 상수는 `lib/supabase/server.ts`에(팀장 사전 작업).

**2+3단계 SQL 추가 블록 2개**(db-schema가 쓰고 sql-review가 검사 — 사용자는 아래 순서로 한 번씩, 둘 다 배포 전에):

**블록 A — `supabase/sales_confirms_schema.sql` 맨 끝**(여러 번 실행해도 안전):
- ④ `add column if not exists extra jsonb not null default '{}'::jsonb`, `add column if not exists diff_ack jsonb not null default '{}'::jsonb` + 각각 `jsonb_typeof(…) = 'object'` 검사 — 제약은 `do $$ … if not exists (select 1 from pg_constraint where conname = '…') then alter table … add constraint … $$`로(이름 고정).
- ③ `add column if not exists printed_ver integer`, `add column if not exists printed_by text not null default ''`.
- `notify pgrst, 'reload schema'`. 권한은 표 단위 revoke 그대로(새 칸도 막힘). 데이터 바꾸는 문장 없음.
- 롤백 주석: `alter table … drop column if exists diff_ack, drop column if exists extra;` / `… drop column if exists printed_ver, drop column if exists printed_by;`(확인 기록·출력 기록이 사라짐을 적어 둠).

**블록 B — `supabase/contracts_schema.sql`**(계약관리 표의 출처 값 하나 추가, D28):
- 위쪽 `create table` 두 곳의 CHECK 목록에도 `'sales_confirm'`을 더함(새 DB용 — 기존 DB에선 `if not exists`라 안 돎).
- 맨 끝 블록(기존 DB용): **한 트랜잭션 안에서** `it_sw_contracts`·`it_sw_seats` 각각 `drop constraint if exists it_sw_*_source_check` → `add constraint it_sw_*_source_check check (source in ('app','sheet_renew','sheet_perm','sales_confirm'))`. 여러 번 실행해도 같은 결과, 기존 줄은 전부 통과(값을 넓히기만 함), 제약이 없는 틈이 없음(`begin; … commit;`).
- `source_key` 주석에 새 열쇠 꼴 두 가지(`sales_confirm:<확인서 id>:<제품 정규화>`, `sales_confirm_unit:<④ id>`) 추가. 비밀 칸·기록 표는 안 바꿈.
- 롤백 주석: 먼저 `select count(*) from it_sw_seats where source = 'sales_confirm'`(상품 표도) → 0일 때만 CHECK 를 옛 목록으로. 0이 아니면 그 줄을 지우거나(키도 cascade로 지워짐 — 경고) 출처를 'app'으로 바꾼 뒤.

**SQL 전(칸·값 없음) 동작**:
- 블록 A 전: 없음 판정은 코드 42703/PGRST204 **이면서** 문구에 그 칸 이름이 있을 때만(`stock_issues` 방식 — 권한 오류는 오류로). extra·diff_ack 가 없으면 **기기 칸 저장을 막고** "SQL 실행 필요" 안내(차이 확인 기록 없이 저장하면 D27이 무너짐). printed_ver 가 없으면 출력은 되고 기록은 printed_at 만.
- 블록 B 전: 대장 상품·좌석 insert 가 23514 이면서 제약 이름이 `it_sw_contracts_source_check`/`it_sw_seats_source_check` 일 때만 "계약관리 SQL 추가 블록을 실행해 주세요"(키는 저장 안 됨, 확인서 일반 칸은 저장됨).

### 3-3. 목록 한 줄 = 시트 칸과의 대응
| 목록 칸 | 어디서 |
|---|---|
| 순번 | ① doc_no |
| 납품/교체일 | ① delivery_date |
| **지역** | ① region(초록 꼬리표) — **비었으면 `regionOf(주소)` 흐리게 "(추정)"**(D21), 지역 칩 거르기도 추정값 포함 |
| 접수일시 | ① first_saved_at |
| 처리여부 | ③ status (없으면 접수) |
| 접수자 / 처리자 | ① saved_by / ③ processors |
| 구분 | ① type (+ term이 현장/단기면 작은 표시) |
| 상호 | ① company |
| 연락처 | `contactLine`(대표번호 → IT담당 → 계약 → 현장, D7 — 그냥 보임) |
| 품목 요약 | ① items → "데스크탑 3 · 모니터 3 · 유지보수 2" |
| 사양 요약 | 품목별 사양(출고 값이 있으면 출고 값) → "I5/16/512" 꼴, 출고 값이 영업과 다른 품목은 표시 |
| 자산번호 / 시리얼 | ④ (앞 3개 + "외 n", 입력 n/전체 m — **m = 장비·모니터·유지보수 수량만**, F23) |
| 소모품/특이사항 | ① supplies + special |
| 비고 | ③ note |
| (상태 표시) | 새로 · 영업에서 수정됨 v2→v3 · 영업에서 취소(신호가 있으면) · **다시 확인 필요(영업 요청이 바뀌어 차이 확인이 풀림)** · **출력함 v2 / 출력 뒤 바뀜** · 시트 비교(켰을 때). 라이선스 키 관련은 목록에 안 보임 |

### 3-4. 기기 칸 규칙 — 영업이 품목을 바꿔도 IT 값을 안 잃기 (순수 함수 `lib/salesConfirms/slots.ts`, import 는 `itemKind.ts`만)
- 칸 열쇠 `slot_key` = **품목 종류 + 같은 종류 안 순서**(예: 데스크탑 줄이 두 개면 `데스크탑#1`, `데스크탑#2`), `unit_no` = 1..qty. 종류가 비면 '기타'. qty는 0~50으로 자름(**유지보수·소프트웨어는 0이면 1**).
- 화면을 그릴 때마다 지금 버전 품목으로 칸을 계산하고 ④ 행을 (slot_key, unit_no)로 붙임 → **가져오기는 ④를 안 건드림(쓰기 0).**
- **칸 계산은 이 파일 한 곳** — 1단계 `listQuery.ts`의 `slotKeys`도 이걸 쓰게 바꿈(F23).
- 영업이 바꾼 경우:
  - **수량 늘어남** → 빈 칸이 더 생김.
  - **수량 줄어듦 / 품목 줄이 빠짐 / 종류가 바뀜** → 갈 곳 없는 행 중 **IT가 뭐라도 적은 행**은 지우지 않고 아래 **"영업에서 빠진 칸"**(회색)에 모음: 자산번호·시리얼·고친 사양 그대로 보임 + `[다른 칸으로 옮기기]`·`[지우기]`(사람이 누를 때만). 아무것도 안 적은 행은 그냥 안 보임. 소프트웨어 칸을 지워도 **대장 좌석·키는 그대로**(§3-11).
  - **같은 칸인데 모델·사양이 바뀜** → `item_snapshot`과 비교해 칸에 "영업 품목이 바뀌었어요: 전 ○○ → 지금 ○○" + `[확인함]`(스냅숏 갱신). 출고 값은 그대로, 영업 새 값은 옆에 흐리게. 출고 값과 새 영업 값이 다르면 차이 확인도 다시(§3-10).
  - 같은 종류 줄 순서가 바뀌거나 앞 줄이 빠지면 `#2`가 `#1`로 당겨져 다른 품목에 붙을 수 있음 → 위 스냅숏 경고로 드러남(조용히 틀리지 않음). "모델이 같은 품목 먼저 맞추기"는 실제 수정 사례를 보고 QA 때 판단.

**품목 종류별 칸(D19 — 사용자 답 반영)** — 종류 판정 `itemKind(cat)`(순수, `lib/salesConfirms/itemKind.ts`, import 없음). 위에서부터 첫 번째로 맞는 것:
① **유지보수** /유지보수/ (그래서 'PC유지보수'는 장비가 아니라 유지보수) → ② **소프트웨어** /소프트웨어\|S\/?W\|라이선스\|라이센스/i → ③ **모니터** /모니터/ → ④ **장비** /데스크탑\|데스크톱\|노트북\|맥북\|태블릿\|아이패드\|PC\|본체\|올인원\|워크스테이션/i → ⑤ **기타**.

| 종류 | 칸 개수 | 입력 칸(이 순서 — D18) | 차이 확인(D27) | 기기별 체크(D11) | 진행 n/m 에 셈 | 종이 회색 칸(§3-9) |
|---|---|---|---|---|---|---|
| 장비 | 수량만큼 | **제조사 · 모델명 · 자산번호 · 시리얼 · 출고사양** — 사양 칸은 `hasSpec(cat)` 품목만(영업 양식과 같은 기준, 키는 `specKeys(cat)` — 인치는 노트북·맥북만). 태블릿은 사양 칸 없음 | 제조사·모델명·사양 칸별 | 데스크탑&노트북(태블릿은 없음) | 셈(자산번호) | 출고 모델 줄 + 자산번호 · S/N |
| 모니터 | 수량만큼 | 제조사 · 모델명 · 자산번호 · 시리얼 | 제조사·모델명 | 모니터 | 셈(자산번호) | 같음 |
| 유지보수 | **수량만큼**(0이면 1) | **자산번호 · 시리얼**(대상 기기 — 우리 장비가 아니면 시리얼만) · 메모. 출고사양·제조사·모델명 없음 | 없음 | 없음 | 셈(자산번호 **또는** 시리얼) | 자산번호 · S/N |
| 소프트웨어 | **수량만큼**(0이면 1) — 칸 하나 = 라이선스 하나 = 대장 좌석 하나 | 제품명(= 모델명) · 제조사 · 설치 PC 자산번호 · 사용자(선택) · **라이선스 키(🔒 — §3-11)** · 메모 | 제조사·제품명 | 없음 | 안 셈(따로 "키 2/3") | 자산번호 칸 = 설치 PC, S/N 칸 = 라이선스 키 |
| 기타 | 수량만큼 | 제조사 · 모델명 · 자산번호 · 시리얼(전부 선택) · 메모 | 제조사·모델명 | 없음(건 단위 '기타' 묶음은 그대로) | 안 셈 | 적은 것만 |

- 종류가 바뀌어(예: 영업이 '기타' → '소프트웨어') 칸 수가 줄면 위 "영업에서 빠진 칸" 규칙 그대로.
- 제조사·모델명·사양 칸은 **비어 있는 게 기본**이고 흐린 글씨(placeholder)로 영업 요청 값을 보여 줌. 비워 두면 출고 값 없음 → 종이엔 영업 값만.
- **자산번호 입력하고 나가면** `lookupUnitByAsset` → **빈 칸만**: 제조사 = `brand`, 모델명 = `model`에서 앞의 제조사 글자를 뗀 것, 시리얼 = 첫 후보(F24). 채운 값이 영업 요청과 다르면 **그 저장에서 차이 확인 창**(D27). IT재고 사양은 "IT재고: I7/12/16/512" **힌트로만**(칸별 형식이 아니라 자동으로 안 옮김).
- 품목 줄 머리 `[이 품목 사양 한꺼번에]` — 그 줄 모든 칸의 spec_override 를 같은 값으로(칸 행이 없으면 만듦). 차이 확인 창은 한 번(§3-10).
- 소프트웨어 줄 머리 `[제품명 한꺼번에]`·`[같은 키를 모든 칸에]`(볼륨 라이선스 — §3-11).
- **교체 건**: 칸은 지금처럼 `items` 기준. 교체 건에 items 가 비고 after 만 있는지는 팀장이 사전 작업에서 **건수로만** 확인(값 없이 — diag) → items 가 비어 오면 after 한 건을 1칸(종류 = after.item)으로 보는 규칙을 developer C가 추가. before(회수 기기)는 읽기만.
- QA가 Node로 돌릴 경우: 수량 증감, 품목 삭제(가운데), 종류 변경, 같은 종류 두 줄, 모델만 변경, qty 0(장비 0칸 / 유지보수·소프트웨어 1칸), 빈 items, **'PC유지보수' → 유지보수, 유지보수 qty 3 → 3칸, 소프트웨어 qty 5 → 5칸, 기타 → 소프트웨어로 바뀜**.

### 3-5. 개인정보 (D7 — 지금은 안 잠금)
- 연락처·주소는 목록·상세·인쇄에 그냥 보임(지금 출고 대장과 같은 수준). **로그인을 붙일 때 같이 막을 화면**: `/confirm-form`(영업 확인서 연락처·주소 — 목록·상세·인쇄), `/dispatch`(연락처) → CLAUDE.md 새 절에 적어 둠.
- 그래도 지키는 규칙:
  - 서버 로그·오류 문구·가져오기 상태(⑤)·라우트 응답에 **영업 원문(payload)을 안 넣음** — 건너뛴 건은 id와 이유만.
  - 홈 카드·운영 타일에 개인정보 없음(건수만).
  - **docUrl**은 `https:` + 영업 웹앱 호스트일 때만 링크로(`javascript:` 등 막기), 새 탭 `rel="noopener noreferrer"`.
  - 응답 실측(§3-6)·개발·QA 때 키·연락처 값·`.env.local` 값을 셸에 출력하지 않음(이름·건수·형식만).
  - **출력 미리보기 iframe 은 sandbox**(§3-9) — 영업이 적은 글자가 우리 화면에서 스크립트로 돌 길을 막음.
  - **라이선스 키는 이 절과 다름 — D29 잠금**(§3-11): 값은 ④·③·로그·오류 문구·브라우저 저장소 어디에도 안 남김.

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
  - **가져오기 코드는 ③④를 import도 안 함**(QA grep). IT 값 덮어쓰기가 구조적으로 불가능. **계약관리 코드도 import 안 함.**
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
- **응답 모양 1회 실측(1단계 첫 일, 팀장)**: 키를 Vercel에 넣고 배포 → 배포된 라우트로 1번 받아 **키 이름·건수·형식만** 확인(값 출력 금지). 확인할 것: 배열/감싼 모양, 건수 상한 흔적, id 형식(→ §4-2 주소 규칙), 날짜·숫자 형식, 생성 시각 칸 유무, spec 키 이름(그래픽·인치 등), 취소·삭제 표시 칸 유무, 같은 건의 ver 변화(며칠 지켜봄). → 파서 확정. **(2026-11-26 끝 — CLAUDE.md 실측 메모)**

### 3-7. 출고 준비 리스트와의 관계 (D8 — 1~3단계는 따로, 4단계에서 합침)
- 1~3단계: 새 화면은 출고 준비 쪽 표·네이버·카톡에 **아무것도 안 씀**. 카톡 보고·사진·네이버 이름 표시·IT재고 '임대중' 반영은 지금처럼 출고 준비 리스트에서 하고, **자산번호도 완료 보고에 따로 넣어야 함**(§6 참고에 적음).
- **남기는 것(읽기만, 상세)**: "같은 건으로 보이는 출고 준비 일정" 상자 — 순수 함수 `lib/salesConfirms/prepMatch.ts`: `eventsAround`로 읽은 IT 일정 중 `parseEventTitle` 거래처(정규화: 공백·㈜·(주)·주식회사 뗌, 소문자) = 상호, 날짜 차 ≤ 3일, 제목 구분(납품/교체) 같음. 후보의 날짜·제목·준비 상태(누가 준비중/완료)·완료 보고 발송 여부를 보여 주고 `출고 준비에서 열기` 링크만. **DB에 연결을 저장하지 않음**(매번 계산). 남기는 이유: 두 화면을 같이 쓰는 동안 같은 건을 바로 찾게 하고, 4단계 매칭 규칙을 실제 데이터로 미리 검증.
  - 목록에는 안 넣음(목록 속도·혼동 방지).
- **4단계(따로 설계 — feature-planner가 다시)**: 연결 저장(`prep_event_id`·`link_source`), 자산번호를 완료 보고로 보내기(`pushDocToPrep` 규칙 참고 — 빈 칸만, 기존 기기 유지), 완료 보고 기기로 빈 칸 채우기, 시작·완료 ↔ 네이버 이름 표시, 카톡·재고 반영을 어느 화면에서 할지, 두 목록 합치기. 네이버·카톡·시트 쓰기가 생기므로 integration-rules 필수.

### 3-8. 시트와 비교 (전환 기간, D5 — 읽기만)
- 목록 위 `📄 시트와 비교` 켜기(PC만, 브라우저에 기억) → 화면 열 때 **1번만** 확인서리스트 워크북 `IT확인서리스트`를 batchGet 1회로 읽음: **B·C·D, G~J, M, O~Q, T 칸만**(연락처 N은 안 읽음). 3분 자동 가져오기 때는 안 읽음(분당 한도는 IT재고와 공유).
- 맞추기(순수 함수 `lib/salesConfirms/sheetMatch.ts`): 상호 정규화 + 납품/교체일(`11월27일` → 연도는 접수일·오늘로 추정, 12월↔1월 넘김 처리) + 구분.
- 목록에 "시트" 칸: `✓ 같음` / `⚠ 다름`(처리여부·자산번호가 다르면 어느 칸인지) / `— 시트에 없음`, 아래 접힌 "시트에만 있는 건 n"(영업 웹앱 밖에서 들어온 건 확인용). 시트에 쓰기 없음.
- 실패(한도·권한) → 그 칸만 "시트를 못 읽었어요(1분 뒤 다시)", 재시도 반복 없음.

### 3-9. 출력 — 영업 양식 사본 + 출고 값 덧붙이기 (D15~D18·D21~D23·D25·D30)

**파일(전부 순수 — 화면에서 바로 부름. 서버 읽기는 키를 찍을 때 한 번뿐)**
- `lib/salesConfirms/salesForm/confirm.ts` — 영업 `lib/confirm.ts` **그대로** 사본. 맨 위 주석: 출처(저장소·파일·커밋 해시·받은 날), "고치지 말 것 — 영업 새 판을 받으면 통째로 바꿈". `ConfDoc`·`specKeys`·`hasSpec`·`contractType`·`regionOf`·`dayText`·`totalUnits`를 여기서 씀.
- `lib/salesConfirms/salesForm/confirmDoc.ts` — 영업 `lib/confirmDoc.ts` 사본 + **아래 P1~P6 자리만 바꿈**(자리마다 `// [IT 바꿈 Pn]`, 머리 주석에 목록). `renderConfirm(d, origin, withBack, fill?)` — **fill 없이 부르면 영업 원본과 글자까지 같은 HTML**(QA가 Node로 비교 — 사본이 정확한지의 기준).
- `public/confirm/rabbit.png` — 영업 저장소 같은 파일(머리 로고, 약 120KB).
- `lib/salesConfirms/printFill.ts` — `buildSalesPrint(input) → { doc: ConfDoc, fill: SalesPrintFill, notes: SalesPrintNote[], blocked: string | null }`. 입력 = 다시 정규화한 확인서(출력용 칸 포함, §3-1) + `slots` 칸 계산 + ④ 행 + ③(처리자·shipped_at·printed_*) + **라이선스 키(④ id → 키, 없으면 빈 지도 — 아래 D30)** + 옵션 `{ withBack, attach: 'auto' | 'always', keys: 'shown' | 'blank' }` + 지금 시각.

**바꾼 곳 P1~P6 — 영업 새 판을 받으면 이 목록대로 다시 적용**
- **P1** `itemRows`(IT 갈래): **모델명·제조사 칸은 영업 값 그대로**(영업 칸이 비었을 때만 출고 값 — 빈칸 채움). **사양 줄 = 영업 값 + 다른 칸만 "요청 → 출고"**(규칙 3). **회색 줄 = "출고 모델" 줄 + 자산번호·S/N**(소프트웨어는 설치 PC·라이선스 키 — 규칙 2). 우리가 넣는 글자는 굵게 8.4pt(7.4pt 미만 금지 규칙 지킴), "출고" 머리말은 양식 초록(`--gd`). 설치장소·요청사항 칸은 영업 값 그대로.
- **P2** 돈·계약서(D17): 그 칸이 **안 왔으면(null)** 렌탈료·합계·보증금·최초 청구액 자리 = ₩0 대신 **빈칸**, 계약서 종류 = **체크 안 함**. 영업이 빈 값('')으로 보낸 건 영업 출력과 같게 둠.
- **P3** **출고 명세(대수별)** 장 — 별지 뒤·2면 앞, `fill.attach`일 때만. 같은 CSS·작은 머리(`head(…, small)`), 위에 상호·납품일, 표 = 순 · 품목 · 제조사 · 모델명 · 자산번호 · S/N · 출고사양. 제조사·모델명·사양 칸은 **출고 값(없으면 영업 값), 다르면 아래 작게 "요청 ○○"**. 소프트웨어 줄은 자산번호 = 설치 PC, S/N = 라이선스 키. 한 장 28줄(넘으면 다음 장, 머리줄 반복), **안 채운 대수는 빈 줄**(손으로). 꼬리 "1면 납품 정보의 별첨". 고객 서명 칸 없음(1면이 서명 대상).
- **P4** 2면: '출고 준비자' 칸 = 처리자 이름 + " · 서명"(서명은 손으로), '출고일' = ③ shipped_at 날짜(없으면 양식 그대로 `YYYY-MM-DD`). 검수·설치 칸은 손으로.
- **P5** 꼬리(.foot) 왼쪽 끝에 " · IT 기재 MM-DD HH:mm" — 영업이 뽑은 빈 종이와 구별(D25).
- **P6** 문서 안 작은 스크립트 둘: ⓐ 부모 창이 보낸 '인쇄' 신호(보낸 쪽이 `window.parent`일 때만)를 받으면 `window.print()` ⓑ 그린 뒤(양식의 높이 맞춤 스크립트 다음) 페이지마다 꼬리가 종이 밖으로 밀렸는지 재서 부모에게 '넘침' 신호 → 부모는 넘친 장의 품목을 "명세 참조"로 바꿔 다시 그림(F20 대비).
- **안 바꿈**: 복합기 갈래(kind 'mfp' — 안 씀), CSS·색, 안내·주의·법적 문구, 1면 품목 2개·별지 7개, 양식 안 높이 맞춤 스크립트.

**채우는 규칙(`printFill` — 품목 줄마다)**
1. **지역**(D21): 영업 값, 비었으면 `regionOf(주소)`(영업과 같은 규칙) — 종이엔 그냥 채움, 출력 창 알림엔 "(추정)". 모르면 빈칸.
2. **회색 줄**(D18·D22):
   - **출고 모델 줄**(장비·모니터·기타·소프트웨어): 그 줄 기기의 출고 제조사·모델명이 영업 값과 다르고 영업 칸이 비어 있지 않으면 S/N 칸 **첫 줄**에 "출고 제조사 모델". 기기끼리 출고 값이 다르면 "출고 모델 기기별 — 명세 참조"(+ 명세 장). 영업 칸이 비었으면 이 줄 대신 영업 칸 자리에 채움(P1).
   - **장비·모니터·유지보수·기타**: 기기 순서 그대로(1번 기기의 자산번호와 S/N이 같은 자리) — 자산번호는 한 줄에 3개, 시리얼은 한 줄에 2개(13자 넘으면 1개), 칸마다 **2줄까지**(출고 모델 줄이 있으면 S/N 칸은 시리얼 1줄). ⇒ 출고 모델 줄이 없으면 **4대까지**, 있으면 **2대까지** 칸 안에. 안 채운 대수는 밑줄 빈칸(＿＿＿)으로 남겨 손으로.
   - **소프트웨어**: 자산번호 칸 = 설치 PC, S/N 칸 = "키 XXXXX-…" 한 줄에 하나 ⇒ **2대까지**(출고 제품명 줄이 있으면 1대). 키를 안 찍기로 했거나 키가 없으면 그 자리 밑줄 빈칸.
   - **넘으면** 자산번호·S/N 두 칸 모두 "출고 명세 참조 (n대)" + 명세 장(한 칸만 명세로 가면 짝이 헷갈려서 둘 다 같이).
3. **사양 줄**(`hasSpec` 품목, D18): 칸(CPU·RAM…)마다 — 출고 값이 없거나 영업 값과 같으면(§3-10 비교 규칙) **영업 값 그대로**, 다르면 **"8GB → 16GB"**(앞이 요청, 뒤 출고 값 굵게), 영업 칸이 비었는데 출고 값이 있으면 출고 값만(빈칸 채움), 기기끼리 출고 값이 다르면 "8GB → 기기별"(+ 명세 장). 아무도 안 적었으면 영업 출력과 같음. 사양 줄이 두 줄로 늘 수 있음 → P6ⓑ가 받쳐 줌.
4. **명세 장 붙이기** = 옵션 '항상', 또는 2·3에서 "명세 참조/기기별"이 하나라도, 또는 P6ⓑ 넘침 신호.
5. 품목구분·기기상태·수량·렌탈료·설치장소·특이사항·소모품·연락처·안내 문구·확인란 = **영업 값 그대로**(우리가 안 바꿈).
6. 확인서 종류 = 원문 kind 가 'mfp'면 'mfp', 아니면 'it'(지금은 안 옴 → 'it').
7. 차이 확인 여부는 종이에 표시 안 함(D27 — 덧붙은 출고 값이 곧 IT가 확인한 값).

**라이선스 키를 종이에(D30 — 추천 흐름)**
- 출력 창을 열 때 이 확인서 소프트웨어 칸에 키가 있는지(`secretFlags` — 값 안 읽음) 봄.
  - 없음 → 그냥 출력.
  - 있고 **잠금이 풀려 있음** → `getSalesPrintKeys(confirmId)`(서버: `requireUnlock` → 이 확인서 좌석들의 키만 `readSecretsForOwners` → `logSecretEvent({action:'view_bulk', count, note:'영업 확인서 <순번> 출력'})`) → 키까지 그림.
  - 있고 **잠겨 있음** → 출력 창 위 주황 상자 "라이선스 키 n개가 잠겨 있어요" + `[🔓 비밀번호 넣고 키까지 찍기]`(계약관리와 같은 비밀번호 창 → 풀리면 위처럼) / `[키 없이 찍기]`(그 자리 밑줄 빈칸). **둘 중 하나를 고르기 전엔 [인쇄]가 꺼져 있음** — 모르고 키 없이 나가는 일을 막음.
- 키는 출력 창의 메모리(iframe `srcDoc`)에만. 브라우저 저장소·서버 기록·로그에 값을 안 남김. 창을 닫으면 사라짐.

**출력 창 알림(notes — 막지 않음)**: 자산번호 빈 기기 n대(장비·모니터·유지보수) · "영업에서 수정됨"을 아직 확인 안 함 · **"다시 확인 필요" 칸 n개**(영업 요청이 바뀌어 차이 확인이 풀림) · 영업이 안 보내 준 칸(계약기간·렌탈료·보증금… → 빈칸으로 나가요) · 지역 추정 · 출력 뒤 영업 수정/IT 값 고침 · 넘침으로 명세 장에 돌림 · 키 없이 찍음.
**막음(blocked — D24)**: 구분이 교체·유지보수인 확인서 → "영업 웹앱 최신 양식을 받으면 출력이 열려요(지금 가진 양식엔 교체 전/후·유지보수 자리가 없어요)". 최신판을 받으면 P1~P6을 다시 적용하고, 교체 양식의 회색 칸(교체 후 기기)에 우리 값을 넣는 자리를 정한 뒤 풂(그때 이 절에 덧붙임).

**출력 방식(D23)**
- 상세 위 `🖨 확인서 출력`(PC) → **출력 창**(큰 팝업): 위 알림·키 상자 · 옵션(`2면 포함` ☑ 기본 — 영업과 같게 / `출고 명세: 자동·항상` — 브라우저에 기억) · 미리보기 = `<iframe srcDoc={html} sandbox="allow-scripts allow-modals">`.
  - 왜 iframe: 영업 양식은 `*`·`table{width:100%}`·`html,body` 같은 넓은 CSS와 자체 `@page`(A4·13mm)·94% 줄임을 가진 **완성된 문서 한 장**이라, 앱 화면 안(포털)에 넣으면 앱 CSS와 서로 깨지고 영업 새 판을 받을 때마다 다시 옮겨야 함. iframe이면 영업 HTML을 그대로 씀. 영업 앱도 같은 방식(F18).
  - 왜 sandbox(같은 출처 권한 없음): 영업이 적은 글자가 혹시 이스케이프를 빠져나가도 우리 앱(쿠키·서버 액션)에 손을 못 댐 — 키를 찍는 문서라 더 중요. 그래서 부모가 iframe 안을 직접 만지지 않고 **신호(postMessage)로만** 인쇄를 부탁함(P6ⓐ). 화면 맞춤은 iframe 바깥 `transform: scale`로.
  - 이미지 주소는 `location.origin`을 붙인 절대 주소(영업과 같음).
- `[인쇄]` → iframe에 '인쇄' 신호 → 브라우저 인쇄 창(양식의 @page 그대로) + 동시에 `markSalesConfirmPrinted({ id, ver, actor })` → ③ `printed_at`·`printed_ver`·`printed_by`만 바꿈(다른 칸을 안 덮으므로 updated_at 충돌 검사 없이, 새 updated_at을 돌려줘 화면의 `workUpdatedAt` 갱신). 인쇄 창에서 취소해도 기록은 남음("출력함" = "출력 창에서 인쇄를 누름").
- 값은 전부 양식의 `esc()`를 거침 — 우리가 넣는 글자(자산번호·시리얼·사양·이름·키)도 예외 없이.
- 브라우저: PC Chrome·Edge 기준. 다른 브라우저는 QA 때 확인(안 되면 그때 `새 창으로 열기`를 더함).
- 핸드폰(≤640px): 출력 버튼 대신 "출력은 PC에서" 한 줄.

### 3-10. 영업 요청과 다를 때 한 번 더 확인 (D27)
- **비교하는 칸**: 영업 요청 값이 **비어 있지 않은** 칸만 — 제조사, 모델명(소프트웨어는 제품명), 출고사양 칸별(CPU·RAM·SSD·HDD·그래픽·OS·인치). 영업이 비워 둔 칸은 요청이 없으니 안 물음. 유지보수 칸은 비교할 게 없음.
- **같다고 보는 기준**(순수 함수 `lib/salesConfirms/specCompare.ts`, import 없음): 앞뒤 공백·대소문자·띄어쓰기·하이픈 무시. 용량 칸(RAM·SSD·HDD)은 숫자+단위로 맞춤(16GB = 16G = 16 / 1TB = 1000GB = 1024GB), 인치는 숫자만. 그 밖(CPU·그래픽·OS·제조사·모델명)은 글자 비교. **애매하면 "다름"으로 봄**(한 번 더 묻는 쪽이 안전 — 쓰면서 너무 자주 뜨는 칸이 있으면 규칙을 넓힘).
- **저장 흐름**:
  1. 화면이 저장 전 차이를 계산 → 차이가 있고 그 칸의 확인 기록(diff_ack)이 지금 쌍(영업 값, 출고 값)과 다르면 **확인 창이 뜸**(닫기 버튼 없음): 칸마다 "제조사: 영업 요청 Dell → 출고 HP", "RAM: 영업 요청 8GB → 출고 16GB" + `[맞아요, 이대로]` / `[다시 고칠게요]`.
  2. `[맞아요, 이대로]` → 값과 확인 기록을 **한 번의 저장**으로(`diff_ack["maker"] = {sales:'Dell', actual:'HP', at, by}`). `[다시 고칠게요]` → 저장 안 하고 그 칸에 커서.
  3. **서버도 같은 검사**(서버 액션은 누구나 부를 수 있음): 저장 액션 인자 `acks: { field, sales, actual }[]` — 서버가 지금 DB 의 영업 값(①을 다시 normalize)과 저장할 출고 값으로 차이를 다시 계산해, acks 에도 기존 diff_ack 에도 없는 차이가 있으면 **저장하지 않고** `{ ok:false, needAck: [...] }`. 화면은 그걸로 확인 창을 띄움(영업이 그 사이 요청을 바꾼 경우도 여기서 잡힘).
  4. 차이가 없어진 칸(출고 값을 지우거나 영업과 같게 고침)의 기록은 지움.
- **다시 묻는 때**: 지금의 (영업 값, 출고 값) 쌍이 기록과 **다르면** 확인되지 않은 것 — IT가 출고 값을 또 고치면 저장 때 다시 창, 영업이 요청을 바꾸면(ver↑) 기기 칸에 **"다시 확인 필요"** + `[확인]`(값은 안 바꾸고 기록만 새로, 같은 창) · 목록 상태 표시 · 출력 창 알림(막지는 않음 — 종이엔 두 값이 다 보이므로).
- **IT재고에서 채운 값**(자산번호 입력 → 제조사·모델명·시리얼)도 같은 저장 흐름이라 다르면 같은 창.
- `[이 품목 사양 한꺼번에]`·`[제품명 한꺼번에]`: 한 번의 창에 그 줄 차이를 다 보여 주고, 확인 하나로 그 줄 칸 전부에 기록.
- 동시 수정: 기존 updated_at 검사와 한 번에(확인 기록도 같은 줄의 칸이라 따로 충돌 없음).
- 핸드폰: 확인 창은 아래 시트(입력칸 16px 규칙), 버튼 크게.

### 3-11. 라이선스 키 — 확인서에서 넣고, 계약관리 잠금 칸·소프트웨어 대장에 쌓임 (D28~D30)

**연결 모양**
| 확인서 쪽 | 계약관리 쪽 | 중복 막는 열쇠 |
|---|---|---|
| 확인서의 상호 | `it_contract_clients` 한 곳 | 처음 한 번 고름(아래). 한 확인서의 소프트웨어는 모두 같은 거래처 — 이미 이 확인서로 만든 상품이 있으면 그 거래처 |
| 소프트웨어 품목(제품) | `it_sw_contracts` 한 줄(상품) | `source='sales_confirm'`, `source_key='sales_confirm:<확인서 id>:<제품명 정규화>'` — 같은 확인서의 같은 제품 줄 둘은 한 상품 |
| 소프트웨어 칸(라이선스 하나) | `it_sw_seats` 한 줄(좌석) | `source='sales_confirm'`, `source_key='sales_confirm_unit:<④ id>'` — ④ id 는 칸을 옮겨도(빠진 칸 → 다른 칸) 안 바뀜 |
| 라이선스 키 | `it_contract_secrets`(seat_id, field `'license_key'`) | 표의 (seat_id, field) 유일 |

- 상품 칸: product = 출고 제품명(없으면 영업 모델명), license_type `'unknown'`(대장에서 고침), starts_on = 납품일, status `'사용중'`, memo = "영업 확인서 <순번>에서", 매입처·비용 등은 빈칸.
- 좌석 칸: pc_asset_code = 설치 PC(대문자·공백 제거 — 대장 규칙), user_name = 사용자, installed_on = ③ shipped_at 날짜(없으면 납품일), status = 설치 PC 있으면 `'사용중'` 아니면 `'미배정'`, source_raw = `{확인서 순번, 판, 품목, 영업 모델}` — 비밀 없음.
- **언제 만드나**: 잠금이 풀린 상태에서 **처음 키를 저장할 때**(또는 `[대장에 올리기]`) — 거래처 → 상품 → 좌석 → 키 순서, 앞 단계가 이미 있으면(source_key) 그대로 씀. 여러 번 눌러도 중복 없음. 상품이 이미 있으면 제품명을 나중에 고쳐도 새 상품을 안 만듦(좌석은 처음 상품에 남음).

**거래처 맞추기**(계약관리 규칙과 같은 열쇠 — CLAUDE.md 계약 관리 절, F30): 이 확인서로 만든 상품이 이미 있으면 그 거래처. 없으면 처음 한 번 **거래처 고르기 창**(건너뛰기 없음 — 시트 옮기기와 같은 방식):
1. 추천 후보 = `buildContractsOverview('sw')`(잠금 풀린 상태 — 저장된 거래처 + works 실시간 묶음) 중 `nameKey`가 상호 또는 상호의 '-' 앞 부분(영업 상호 = "상호-현장명")과 같거나 alias 에 있는 것. 하나면 맨 위에 "추천".
2. 다른 거래처 검색해서 고르기.
3. **새 거래처로 만들기** = 상호('-현장명' 뗀 것)로 `createManualClientRow`(works에 없는 거래처 — 같은 이름 키가 있으면 그것). 후보가 없을 때 기본 선택.
4. 못 정하면 **'미분류(영업 확인서에서)'** 거래처 — 나중에 계약관리에서 `moveSwContract`로 옮김.
- works 묶음(`new:…`)을 고르면 `ensureClient`가 만듦(맞은 works 줄 id·코드 기록 — 계약관리 규칙 그대로).

**키 저장·보기**
- 저장 = `writeSecret({seat}, 'license_key', 값, 열 때 적은 이름)`(안에서 잠금 다시 확인) + `logSecretEvent({ action:'edit', field:'license_key', seatId, contractId, clientName, note:'영업 확인서 <순번>' })`. 지우기 = 빈 값 저장(`writeSecret`이 줄을 지움, 기록 `'delete'`).
- `[같은 키를 모든 칸에]`(볼륨 라이선스): 그 줄 칸마다 같은 값을 저장(상품 단위 비밀은 안 씀 — 칸·종이·대장 모두 좌석 기준으로 단순하게). 좌석이 없는 칸은 만들고 넣음. 기록은 칸 수만큼 `edit` 대신 한 줄 `edit`(event_count = 칸 수).
- 보기: **잠겨 있으면** 칸마다 "🔒 키 있음 / 키 없음"만(`secretFlags` — 값을 안 읽음). **풀려 있으면** 상세를 열 때 이 확인서 좌석들의 키를 `readSecretsForOwners`로 한 번에 읽어 그대로 보여 줌(계약관리 D13과 같게 — 풀리면 그냥 보임) + `view_bulk`(개수·순번) 기록.
- 키 값은 **④·③·서버 로그·오류 문구·브라우저 저장소 어디에도 안 남김**. 화면 상태(메모리)에만.

**일반 칸이 바뀔 때(설치 PC·사용자·제품명)**
- ④ 에 저장(잠금 없이 — 확인서 쪽 값).
- 좌석이 이미 있으면: 잠금이 풀려 있으면 좌석에도 반영하되 **대장의 지금 값이 지난번에 우리가 올린 값(④ extra.ledgerPushed)과 같을 때만** — 대장에서 사람이 고친 칸은 안 덮고 "대장에서 바뀜(대장: ○○)" 표시. 잠겨 있으면 "대장 반영 대기" 표시 → 다음에 풀렸을 때 `[대장에 올리기]`(같은 규칙).
- 칸이 '영업에서 빠진 칸'이 되거나 `[지우기]` → ④만 지움. **대장의 좌석·키는 그대로**(안내: "대장 좌석은 계약관리에서 지우세요" — 대장은 납품 뒤에도 계속 쓰는 기록).
- 계약관리에서 그 좌석을 지우면 확인서 칸은 "대장에서 지워짐 — `[다시 올리기]`".
- 잠겨 있을 때 이 화면에 보이는 대장 정보 = 칸마다 "대장에 있음/없음 · 키 있음/없음 · 반영 대기"뿐(대장 상품 목록·다른 좌석은 안 보임).

**잠금 — 키 넣기도 잠금 해제 상태에서(D29 추천, Q3)**
- 키 칸을 누르면: 이미 풀려 있으면 바로 입력, 잠겨 있으면 계약관리와 같은 비밀번호 창(`PasswordGate` — 같은 쿠키 `it_ct_unlock`, 2시간. 확인서 화면에서 풀어도 계약관리도 풀림. 이름은 계약관리 이름 기억 칸 그대로).
- **추천 이유**: ① 서버 액션은 주소만 알면 누구나 부를 수 있어서, 잠금 없이 "넣기"를 열면 남의 거래처 좌석 키를 덮어쓰거나 지우는 길이 생김 — 계약관리의 "비밀 쓰기는 잠금 해제 상태에서만" 규칙(`writeSecret`)을 깨야 함 ② 잠금 없이 넣으면 넣은 사람도 ●●● 만 보여 오타를 확인 못 함 ③ 한 번 풀면 2시간이라 여러 건을 이어서 넣을 수 있음 ④ 대장에 상품·좌석을 만드는 것도 계약관리 소프트웨어 쪽 쓰기라 원래 잠금 대상.
- 다른 방법(추천 안 함): "빈 칸에 처음 넣기만 잠금 없이" — `secrets.ts`에 잠금 확인 없는 쓰기 함수를 새로 만들어야 하고(그 파일 규칙 위반), 대장에 상품·좌석을 잠금 없이 만드는 길도 생김.
- 일반 칸(설치 PC·사용자·제품명)은 잠금 없이 확인서에 저장 — 대장 반영만 잠금.

**파일·서버 검사**
- `lib/contracts/salesConfirmLink.ts`(server-only, **계약관리 쪽 새 파일 하나** — 기존 파일은 안 고침, `secrets.ts`·`clients.ts`·`nameKey.ts`를 import만): `clientCandidatesForConfirm` · `ensureLedgerForUnit`(거래처 → 상품 → 좌석, source_key 로 있으면 그대로) · `saveUnitLicenseKey` · `readConfirmLicenseKeys` · `confirmLicenseFlags` · `pushUnitToLedger`(덮어쓰기 규칙) · `getPrintKeys`. **값을 읽거나 쓰거나 대장에 쓰는 함수는 전부 맨 앞에서 `requireUnlock`**(있음 표시 `confirmLicenseFlags`만 예외).
- 확인서 쪽 액션 `app/confirm-form/salesLicenseActions.ts`('use server')가 위 함수만 부름. 잠겨 있으면 `{ ok:false, needUnlock:true }`(계약관리 `runLocked`와 같은 모양).
- 서버가 확인: ④ 행이 그 확인서의 것이고 칸 종류가 소프트웨어인지(다른 종류 칸에 키 저장 거절), 확인서 id·④ id 모양.

---

## 4. 화면 흐름

메뉴는 그대로: 재고관리 → **확인서/출고및반출준비**(`/confirm-form`). 화면 위 보기 칩 2개(`Link`):
`[📋 영업 확인서]`(기본, `/confirm-form`) · `[🗂 예전 방식 (시트 기재·간단 등록·정식 납품확인서)]`(`/confirm-form?view=legacy` — 지금 화면 그대로).
`Shell` 제목은 그대로 `📋 확인서/출고및반출준비`, 메모(note)만 보기마다. `<Suspense key={view}>`라 칩을 바꾸면 아래가 새로 그려짐(`view`는 state 아님).

### 4-1. 1단계 — 목록 (`/confirm-form` 기본 보기)
PC
1. 열면 저장된 목록이 바로 뜸(기본: 안 끝난 건 + 지난 7일), 동시에 가져오기 → 새 건 있으면 목록 갱신. 위 띠 "영업 웹앱에서 2분 전에 가져옴 · `🔄 새로고침` · `⋯`(날짜 골라 다시 가져오기)".
2. 새 건은 굵게 + `새로`, 영업이 고친 건은 `영업에서 수정됨 v2→v3`.
3. 칩: 처리여부 6개 · 구분 · **지역** · 날짜(오늘·내일·이번 주·지난 것·직접) · 처리자 선택 · 검색(상호·순번·자산번호·시리얼·연락처).
4. 줄에서 처리여부·처리자 바로 바꿈(③ 씀).
5. `📄 시트와 비교` 켜면 "시트" 칸 + 시트에만 있는 건.
6. 줄 누름 → 1단계 배포 땐 읽기 전용 미리보기 창(영업 원문 정리 + `영업 원본 열기`), **2+3단계부터 상세 주소로**(미리보기 창은 없앰).

핸드폰(≤640px)
1. `m-cards`: 제목=상호, badge=처리여부, inline=지역·납품일·구분·품목 요약, sub=사양 요약, "자산 2/3" 진행, 새로·수정됨·다시 확인 필요 표시, 연락처 한 줄.
2. 보기 칩은 위에 그대로(두 개라 한 줄), 필터는 `MobileFilterRows`로 "⚙︎ 필터" 하나. 시트 비교는 숨김.
3. 카드 누름 → 상세.

### 4-2. 2+3단계 — 상세 `/confirm-form/[id]` (카톡으로 주소 공유 가능)
**주소 규칙**: 링크는 한 함수(`salesConfirmHref(id)`)로만 만듦 = `/confirm-form/` + `encodeURIComponent(id)`. 페이지는 받은 값을 한 번 decode(실패하면 받은 값 그대로)해서 찾고, 없으면 "확인서를 못 찾았어요 → 목록으로". **`app/confirm-form/` 아래에 다른 하위 폴더(정적 경로)를 만들지 않음** — 만들면 같은 이름의 id를 가림. `legacy`는 `?view=` 값이라 경로와 안 겹침. QA는 `/`·`%`·한글·공백이 든 가짜 id로 확인(실측 id는 16자 글자).

PC
1. 머리: **지역 크게**(영업 양식 머리 띠처럼 초록 칸 — 비었으면 "수도권B (주소로 추정)" 흐리게, 모르면 "지역 없음") · 상호 · 순번·판 · 구분(+현장/단기) · 납품일 · 접수자 · 영업담당 · 유입담당 · 주소 · 연락처(대표번호·IT담당·계약·현장·결제 전부) · `영업 원본 열기`(docUrl, 새 탭) · `← 목록` · **`🖨 확인서 출력`** · 출력 상태("v2 출력함 11-26 14:05" / "출력 뒤 영업이 고쳤어요 — 다시 뽑기") · 소프트웨어가 있으면 잠금 상태 "🔒 라이선스 키 잠김 / 🔓 열림(1시간 40분 남음)".
2. 상태 단계 버튼(접수→준비중→준비완료→출고, 보류·취소) · 처리자 칩 · `시작`(지금 시각, 접수면 준비중으로) / `끝`(지금 시각, 준비완료로) — 시각은 고칠 수 있음.
3. "영업에서 수정됨" 띠 → `무엇이 바뀌었나`(마지막 확인 버전 ↔ 지금: 품목 추가·삭제·수량·모델·사양·날짜·주소·연락처) → `확인함`(seen_ver 갱신). 요청이 바뀌어 차이 확인이 풀린 칸이 있으면 "다시 확인 필요 n칸 →".
4. **품목별 카드** — 줄 머리: 번호 · 품목구분 · 영업 요청 모델/제조사 · 기기상태 · 수량 · 영업 요청 사양 · 설치장소·요청사항 + `[이 품목 사양 한꺼번에]`(사양 있는 품목만). 아래 **기기 칸**(종류별 §3-4 표):
   - 장비·모니터·기타: **제조사 · 모델명 · 자산번호 · 시리얼 · 출고사양** 순서(D18). 제조사·모델명·사양 칸은 비어 있고 흐린 글씨로 영업 요청 값. 자산번호를 넣고 나가면 IT재고에서 **위의** 제조사·모델명과 시리얼의 빈 칸만 채움 + "IT재고: I7/12/16/512" 힌트. 출고사양 = 칸별(CPU·RAM·SSD·HDD·그래픽·OS·인치), 영업 요청과 다른 칸은 노란색 "요청 8GB". **영업 요청과 다르면 저장할 때 확인 창**(§3-10). 확인한 칸은 작게 "✓ 홍길동 11-26 확인". 체크리스트 접힘 "7/20". 메모. 칸마다 나가면 저장 + "저장됨". 다른 건에 같은 자산번호가 있으면 노란 경고.
   - 유지보수: 칸마다 대상 기기 **자산번호 · 시리얼** · 메모(대마다).
   - 소프트웨어: 줄 머리 `[제품명 한꺼번에]`·`[같은 키를 모든 칸에]`. 칸마다 제품명 · 제조사 · 설치 PC 자산번호 · 사용자 · **라이선스 키**(🔒 잠겨 있으면 "키 있음/없음" + `[🔓 열고 넣기·보기]`, 풀려 있으면 값이 보이고 바로 고침) · 메모 · 대장 상태("대장에 있음 · OO상사" / "반영 대기" / "대장에서 바뀜" / "대장에서 지워짐"). 처음 키를 저장할 때 **거래처 고르기 창**(§3-11) 한 번.
5. 건 단위: 기타 묶음 체크(랜선·공유기…) · 소모품(무상/청구) · 특이사항 · 비고 · 교체 건은 "회수할 기존 기기"(읽기만).
6. "같은 건으로 보이는 출고 준비 일정"(읽기만, §3-7) — 후보·준비 상태·`출고 준비에서 열기`. 안내 한 줄: "자산번호는 출고 준비 완료 보고에도 넣어 주세요(합치기 전까지)".
7. 영업에서 빠진 칸(있을 때만) — 옮기기·지우기(소프트웨어 칸이면 "대장 좌석은 그대로" 안내).

핸드폰
- 같은 순서, 지역은 머리 맨 위 한 줄. 기기 칸 카드는 한 줄씩 꽉 차게(입력 순서 D18 그대로), 차이 확인 창은 아래 시트, 체크리스트는 접힌 "체크 7/20 ▸", 입력칸 16px, 아래에 고정 막대(상태·다음 빈 칸으로). 라이선스 키도 핸드폰에서 넣을 수 있음(같은 비밀번호 창). 출력 버튼 대신 "출력은 PC에서".

동시 수정: 칸·건 저장마다 `updated_at`를 같이 보내 다르면 "다른 사람이 방금 고쳤어요 — 새로 불러올게요"(체크는 서버가 그 항목만 합침). 출력 기록만 예외(§3-9). 키는 `writeSecret` 덮어쓰기(마지막 저장이 이김 — 계약관리와 같음).

### 4-3. 2+3단계 — 출력 (상세 위 `🖨 확인서 출력`, PC)
1. 출력 창이 열림: 위 알림(§3-9 notes) · 옵션(2면 포함 ☑ · 출고 명세 자동/항상) · **미리보기 = 영업 웹앱 확인서와 같은 종이**(1면 → 별지 → 출고 명세(필요할 때) → 2면). 1면 위 초록 띠에 지역이 크게.
2. 1면 품목 표: 영업 요청 모델·사양은 그대로, 회색 칸에 "출고 ○○"(다를 때)·자산번호·S/N, 사양 줄에 "8GB → 16GB"(다른 칸만). 칸에 안 들어가면 "출고 명세 참조 (n대)"와 뒤에 대수별 표.
3. 소프트웨어 키가 있으면: 풀려 있으면 키까지 그려져 있음. 잠겨 있으면 주황 상자 `[🔓 비밀번호 넣고 키까지 찍기]` / `[키 없이 찍기]` — **골라야 [인쇄]가 켜짐**(D30).
4. 교체·유지보수 확인서(영업 최신 양식 받기 전)는 미리보기 대신 이유 한 줄(D24).
5. `[인쇄]` → 브라우저 인쇄 창. 기록(판·사람·시각) → 상세·목록에 "출력함 v2". 키를 찍었으면 계약관리 기록에 `view_bulk`.
6. 출력 뒤 영업이 고치거나(ver↑) IT가 칸을 고치면 상세·목록에 "출력 뒤 바뀜 — 다시 뽑기". 1면이 넘쳐 명세로 돌렸으면 출력 창에 주황 한 줄.

---

## 5. 작업 분해

### 0. 팀장 사전 작업 (1단계 — 끝남)
- `lib/salesConfirms/types.ts`(server-only 아님): 영업 원문 타입, 정규화 타입, 목록 줄·상세·기기 칸 타입, 상태 6개 상수, 체크 묶음 이름, `salesConfirmHref(id)`, 서버 액션·라우트 이름과 인자 주석, 아래 컴포넌트·함수 이름.
- `lib/supabase/server.ts`에 표 이름 상수 5개.
- `app/confirm-form/page.tsx` 다시 쓰기(F16 방식): `searchParams.view` → `'legacy' | 'sales'`, 보기별 Shell note, 보기 칩(ui-designer의 `ConfirmViewChips`), `<Suspense key={view} fallback={<PageLoading/>}>` 안에 legacy = 지금 코드 그대로(`listRecentConfirmFormEntries` + `ConfirmFormPage`), sales = `loadSalesConfirmList()`(developer B) → `<SalesConfirmListPage>`(ui-designer). SetupGuide 분기는 보기별(legacy는 지금 schemaFile, sales는 `supabase/sales_confirms_schema.sql`).
- **Shell·`tabForPath` 안 고침**(주소가 그대로라).

### 1단계 (목록 + 가져오기 + 시트 비교) — db-schema ∥ developer A ∥ developer B ∥ ui-designer → sql-review → qa-checker → deploy-check (배포됨)

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

### 2+3단계 (상세 + 출력, 한 번에 — D24) — 팀장 사전 작업 → db-schema ∥ developer C ∥ developer E ∥ developer D ∥ ui-designer → sql-review → qa-checker → deploy-check

**왜 합치나(D24)**: ① 입력 칸(제조사·모델명·자산번호·시리얼·출고사양·키)이 출력 종이의 칸에서 정해짐 — 사용자는 종이를 봐야 판단 ② 상세만 먼저 보여 드리면 왕복이 한 번 더 ③ 출력 코드는 순수 함수라 상세 코드와 파일이 안 겹쳐 **동시에** 만들 수 있음. 단 **교체·유지보수의 출력만** 영업 최신 양식을 받은 뒤(그 전엔 잠금 + 이유, 입력은 지금부터).

**0. 팀장 사전 작업(겹침 방지 — 병렬 시작 전)**
- 영업 쪽 요청 보냄(§6) — 답을 기다리지 않고 시작.
- `lib/salesConfirms/salesForm/confirm.ts` = 영업 `lib/confirm.ts` 사본(그대로 + 머리 주석) — C(`regionOf`·`hasSpec`)와 D가 같이 import.
- `lib/salesConfirms/itemKind.ts`(순수, import 없음): `itemKind(cat)` 5종 + 종류별 규칙 상수(칸 개수·0이면 1칸·체크 묶음·진행에 셈·차이 확인 칸) — §3-4 표 그대로.
- `types.ts`에: 상세 데이터·기기 칸·종류별 extra 모양, `DiffAck`·`DiffItem`(`{field, sales, actual}`)·저장 결과 `needAck`, `NormalizedSalesConfirm.print`·품목 `rent`·소모품 `price`(자리만, null = 안 옴), `SalesPrintFill`·`SalesPrintNote`·`buildSalesPrint` 입출력, 라이선스 쪽 화면 타입(`UnitLicenseState` = 대장 상태·키 있음·값(풀렸을 때만)), 서버 액션 이름·인자 주석(아래 C·E 목록), 컴포넌트 이름.
- `lib/supabase/server.ts` 상수는 그대로(계약관리 표 상수 이미 있음).
- 교체 건 모양 확인: 배포된 diag 로 **교체 건에 items 가 있는지·after 가 채워져 오는지 건수·칸 이름만**(값 출력 금지) → §3-4 교체 칸 규칙 확정.

| 누가 | 할 일 | 파일 |
|---|---|---|
| **db-schema** | §3-2 블록 A(④ `extra`·`diff_ack`, ③ `printed_ver`·`printed_by`) · 블록 B(계약관리 상품·좌석 `source` CHECK 에 `'sales_confirm'` — create table 목록 + 기존 DB용 트랜잭션 교체 블록) + 롤백 주석 + `notify pgrst` | `supabase/sales_confirms_schema.sql`(**맨 끝 블록만**) · `supabase/contracts_schema.sql`(CHECK 목록 2곳 + **맨 끝 블록**) |
| **sql-review** | 두 블록 검사: 여러 번 실행 안전, CHECK 교체가 한 트랜잭션(제약 없는 틈 없음)·기존 줄 통과, 데이터 바꾸는 문장 없음, RLS·revoke 그대로, 롤백이 줄 확인 뒤에만 | — |
| **developer C** (상세·저장·차이 확인) | 칸 계산(종류별·0이면 1칸, listQuery 의 `slotKeys` 대체), 차이 비교(순수 — §3-10 기준), 버전 차이, 출고 준비 후보(읽기), 상세 읽기(payload 다시 normalize·③④·체크 항목·처리자 명단), 칸·건 저장(updated_at 확인·체크 항목 합침·extra·**서버 차이 검사 + diff_ack 기록·지우기**·SQL 전 좁은 판정), 줄 단위 사양·제품명 한꺼번에, "다시 확인" `[확인]`, 처음 열람·확인함, 자산번호 조회(`lookupUnitByAsset` 그대로 부르고 제조사·모델명 나눔), 같은 자산번호 경고, 출력 기록 액션, 상세 페이지·주소 규칙. 목록: 진행 m·지역 추정·출력 표시·다시 확인 필요 | 새: `lib/salesConfirms/slots.ts`(순수) · `specCompare.ts`(순수) · `diff.ts`(순수) · `prepMatch.ts`(순수) · `work.ts`(server-only) · `app/confirm-form/[id]/page.tsx` · `app/confirm-form/salesDetailActions.ts`('use server' — `openSalesConfirm`·`saveSalesUnit`·`applyLineValues`·`ackUnitDiffs`·`saveSalesWork`·`lookupSalesUnitAsset`·`markSalesConfirmPrinted`) / 고침: `lib/salesConfirms/listQuery.ts` |
| **developer E** (라이선스 키·대장 연결 — C와 파일이 안 겹쳐 따로 둠. 사람이 모자라면 C가 이어서) | §3-11 전부: 거래처 후보·고르기(새 거래처·미분류 포함), 상품·좌석 만들기(source_key, 중복 없음), 키 저장·지우기·같은 키 모두에, 잠금 확인(`requireUnlock` — 있음 표시만 예외), 일반 칸 대장 반영(ledgerPushed 비교 덮어쓰기 규칙), 대장 상태 계산, 출력용 키 읽기 + `view_bulk`, 기록(`logSecretEvent`), 블록 B 전 좁은 판정 | 새: `lib/contracts/salesConfirmLink.ts`(server-only — **계약관리 쪽 유일한 변경, 기존 `lib/contracts/*`는 import만**) · `app/confirm-form/salesLicenseActions.ts`('use server' — `getConfirmLicenseState`·`listLedgerClientCandidates`·`saveUnitLicenseKey`·`saveLineLicenseKey`·`pushUnitsToLedger`·`getSalesPrintKeys`) |
| **developer D** (출력 양식) | 영업 `confirmDoc.ts` 사본 + P1~P6, 채우기 규칙(순수 — §3-9 규칙 1~7·키 자리·notes·blocked, 차이 판정은 C의 `specCompare.ts`를 import), 출력용 칸 정규화(안 오면 null — 기존 칸·hash·`extractRecords` 그대로), 로고 파일 | 새: `lib/salesConfirms/salesForm/confirmDoc.ts` · `lib/salesConfirms/printFill.ts` · `public/confirm/rabbit.png`(영업 저장소에서 `gh api`로 받음) / 고침: `lib/salesConfirms/normalize.ts`(출력용 칸 읽기만 추가) |
| **ui-designer** | 상세 화면(PC·핸드폰 — 지역 크게), 기기 칸 카드(종류별, 입력 순서 D18, 흐린 영업 요청 값, 다른 칸 노란색, 확인 표시), **차이 확인 창**(칸별 요청 → 출고, 닫기 없음), 유지보수 칸, 소프트웨어 칸·**키 칸**(잠김/열림/대장 상태), **거래처 고르기 창**, 잠금 해제는 `PasswordGate` import(고치지 않음 — 안 맞으면 감싸는 컴포넌트를 새로), 사양 편집, 체크리스트, 영업 수정 띠·차이 보기, 빠진 칸, 출고 준비 후보 상자, **출력 창**(알림·키 고르기 상자·옵션·sandbox iframe 미리보기·화면 맞춤·인쇄 신호·넘침 신호), 목록 줄 → 상세 링크·출력/다시 확인 표시·지역 추정(미리보기 창 없앰) | 새: `components/salesConfirms/SalesConfirmDetail.tsx` · `DeviceSlotCard.tsx` · `SoftwareSlotCard.tsx` · `LicenseKeyField.tsx` · `LedgerClientDialog.tsx` · `DiffConfirmDialog.tsx` · `SpecDiffEditor.tsx` · `ChecklistPanel.tsx` · `SalesChangeBanner.tsx` · `PrepHintBox.tsx` · `SalesPrintDialog.tsx` / 고침: `SalesConfirmTable.tsx` · `SalesConfirmListPage.tsx`(미리보기 → 링크) · `app/globals.css`(새 블록 + 핸드폰 블록 끝에 덧붙임) / 지움: `SalesConfirmPreview.tsx`(안 쓰게 되면) |
| **qa-checker** | 아래 목록 | — |
| integration-rules | **안 부름** — 영업·시트·네이버·카톡·출고 준비에 쓰는 코드 없음. 계약관리 표 쓰기는 sql-review·qa 검사 항목으로 | — |
| 팀장 | 설명서 `confirm-form` 꼭지 추가(상세·종류별 칸·차이 확인·라이선스 키·출력, `updated`) + 계약관리 설명서에 "영업 확인서에서 올라온 상품·좌석" 한 꼭지, releases, CLAUDE.md(확인서 절: 결정 D1~D30·양식 사본·P1~P6·**새 판 받는 법**·extra·diff_ack·printed_* / 계약 관리 절: 출처 `'sales_confirm'`·열쇠 두 가지·`salesConfirmLink.ts`) | `lib/manual/docs/shipping.ts` · 계약관리 설명서 파일 · `lib/releases.ts` · `CLAUDE.md` |

**qa-checker 할 일**
- 타입·빌드.
- Node 로 순수 함수: `slots`(§3-4 사례 전부), `specCompare`(16GB/16G/16, 1TB/1000GB, 대소문자·공백·하이픈, i5 vs i5-12400 = 다름, 영업 빈 값 = 안 물음), `diff`, `prepMatch`, `itemKind`, `printFill`(1대·2대·4대·5대·12대, 출고 모델 줄 있음/없음, 기기끼리 사양·모델 다름, 영업 칸 빈 값 → 그 칸에 채움, 자산번호 빈 기기 섞임, 유지보수 대마다, 소프트웨어 키 찍음/빈칸, 지역 빈 값 → 추정, 돈·계약서 칸 안 옴 → **₩0·자동 체크 없음**, '' 로 옴 → 영업과 같게).
- **사본이 정확한지**: 같은 `ConfDoc`로 영업 원본 `renderConfirm`(GitHub 에서 받은 것)과 우리 사본(fill 없음)의 결과가 **글자까지 같음**.
- **차이 확인**: 확인 없이 저장 액션을 직접 부르면 거절(`needAck`) · 확인 뒤 저장되고 diff_ack 에 칸·사람·시각 · 출고 값을 또 고치면 다시 물음 · 가짜로 영업 ver 을 올려 요청을 바꾸면 "다시 확인 필요" · IT재고 자동 채움도 창이 뜸 · 한꺼번에 고치기는 창 한 번.
- **라이선스 키**: 쿠키 없이 키 저장·읽기·대장 만들기·출력용 키 액션을 부르면 전부 `needUnlock`(값 안 나감) · 키 값이 ④·③·`it_contract_secret_log`·서버 로그·오류 문구·라우트 응답·localStorage 에 없음(grep + DB 확인) · 같은 칸 두 번 저장/두 번 누름 → 상품·좌석 하나(source_key) · 빠진 칸으로 옮긴 ④ 가 같은 좌석 유지 · 계약관리 화면에서 그 거래처 아래 상품·좌석이 보이고 키가 잠금 해제 후 같음 · 대장에서 PC 를 고친 뒤 확인서에서 고치면 안 덮고 "대장에서 바뀜" · 대장에서 좌석 지우면 "대장에서 지워짐" · 다른 종류 칸(장비)에 키 저장 시도 → 거절 · 기록 표에 edit/view_bulk 줄(값 없음).
- **계약관리 회귀**: 블록 B 뒤 시트 옮기기·상품/좌석 추가·좌석 지우기·비밀번호 잠금이 그대로, 기존 줄 출처 값 그대로.
- 이스케이프: 상호·자산번호·시리얼·사양·키에 `<script>`·`"`·`&`·`<img onerror>` → 종이에 글자로만. iframe 에 `allow-same-origin` 없음.
- **실제 인쇄 미리보기**(PC Chrome·Edge): 1대·3대·4대·5대·12대, 출고 모델 다름, 사양 다름(두 줄), 데스크탑+모니터+유지보수+소프트웨어 섞임, 품목 3개 이상(별지), 소모품 5줄 + 긴 특이사항(1면 넘침 → 명세로 돌림) — **1면 확인란·서명 칸이 잘리지 않는지 눈으로**(F20). 2면 포함/뺌. 키 잠김 → 고르기 전 [인쇄] 꺼짐.
- 영업 ver 올린 가짜 데이터로 IT 값 그대로·"출력 뒤 바뀜" 표시.
- grep: 출고 준비 표에 쓰는 코드 없음(`it_prep_reports`·`it_prep_events` insert/update), **가져오기 코드가 ③④·계약관리를 import 안 함(normalize 를 고쳤으므로 다시)**, `it_contract_secrets`를 `secrets.ts` 밖에서 안 씀, payload·연락처가 로그에 없음.
- SQL 전(칸·값 없음) 동작: 블록 A 전 → 상세 열림·기기 칸 저장은 "SQL 실행 필요"·출력 기록은 printed_at 만 / 블록 B 전 → 키 저장만 "계약관리 SQL" 안내.
- 이상한 id 주소, 핸드폰 16px·카드·차이 확인 창·출력 버튼 숨김.
- **예전 보기 회귀**: `?view=legacy` 확인서 인쇄(`#print-confirm-sheet-root`)가 그대로.

2+3단계 배포 순서: SQL 블록 B(`contracts_schema.sql` 끝) → 블록 A(`sales_confirms_schema.sql` 끝) 실행(사용자 — 순서는 상관없지만 둘 다 배포 전) → 배포 → 팀장이 실제 납품 확인서 1건 출력 미리보기 확인(값 출력 금지 — 화면으로만) → 사용자에게 상세·차이 확인 창·키 넣기·출력 보여 줌.
**영업 최신 양식을 받으면**(별건, 작게): developer D가 두 파일을 통째로 바꾸고 P1~P6 다시 적용 → "사본 정확" 테스트 → 교체 양식 회색 칸 자리 정함(이 문서 §3-9에 덧붙임) → 교체·유지보수 잠금 풂 → qa-checker 인쇄 미리보기.

### 4단계 (출고 준비 리스트와 합치기) — **따로 설계**(D8)
feature-planner가 1~3단계를 써 본 뒤 다시 설계. 후보: 연결 저장, 자산번호 → 완료 보고, 완료 보고 → 빈 칸, 시작·완료 ↔ 네이버 이름 표시, 카톡·재고 반영 위치, 두 목록 합치기, 예전 보기(`?view=legacy`)와 `/dispatch` 정리. 네이버·카톡·시트에 쓰게 되므로 integration-rules 필수.

---

## 6. 위험·열린 질문

### 사용자 답 (2026-11-26 — 반영함)
- **Q1 모델명** → "영업 값은 두고 출고 값을 덧붙임, 다르면 강제 확인 창" → D18·D27.
- **Q2 유지보수** → "대마다" → D19.
- **라이선스 키** → "적어야 관리함. 입력은 확인서 상세, 저장·보기는 계약관리 잠금, 소프트웨어 대장에도 같이, 종이에도 찍음" → D26 폐기, D28~D30.

### 사용자에게 물을 것 (1개 — 추천안 먼저)
**Q3. 라이선스 키를 넣을 때도 비밀번호를 넣어야 하는데, 괜찮을까요?**
- **추천: 네 — 키를 넣을 때도 계약관리 비밀번호를 한 번 넣어요.** 한 번 넣으면 2시간 동안 여러 건을 이어서 넣을 수 있고, 계약관리 화면도 같이 열려요. 넣은 키가 바로 보여서 오타도 확인할 수 있어요.
- 이유: 이 앱은 아직 로그인이 없어서, 비밀번호 없이 넣을 수 있게 하면 주소를 아는 누구나 다른 거래처의 키를 덮어쓰거나 지울 수 있는 길이 생겨요.
- 다른 방법: 빈 칸에 처음 넣을 때만 비밀번호 없이(넣은 뒤엔 ●●● 로만 보이고, 확인·수정은 비밀번호). 추천하지 않아요.

### 영업 웹앱 쪽에 요청할 것 (팀장이 문구로 — 우리 쪽은 답을 기다리지 않고 진행)
1. **가져오기(`it-confirms`)에 칸 추가** — 확인서 종이에 찍히는데 지금 안 오는 칸: `months`(계약기간) · `deposit`(보증금) · `payNote`(결제특이) · `extra`(추가조건·혜택) · `orderDate`(발주일) · `industry`(업종) · `statusNo`(현황표 순) · `fax` · `taxMail` · `contractMail` · `kind`(it/mfp) · `items[].rent`(품목별 월 렌탈료) · `supplies[].price`(소모품 단가). (복합기 확인서도 보낸다면 `hanjo`·`installCount`·`baseColor`·`overColor`·`baseMono`·`overMono`도 — IT만 보낸다면 필요 없음.) 안 오면 그 칸은 빈칸으로 나감.
2. **소프트웨어 품목·확인서도 포함** — 지금 0건이에요. 가져오기에서 빼는 건지, 아직 만든 게 없는 건지.
3. **최신 확인서 양식 코드를 GitHub(`FIRSTOA/firstoa-smart-sales-os` main)에 올려 주기** — `lib/confirmDoc.ts` · `lib/confirm.ts` · `public/confirm/*`(교체 전/후·유지보수가 들어간 판). GitHub 마지막 판이 11-20이라 배포된 앱보다 옛 판이에요. 가능하면 가져오기 라우트(`api/export/it-confirms`) 코드도. 앞으로 양식을 바꾸면 알려 주거나 `confirmDoc.ts` 맨 위에 판 날짜 한 줄.
4. **지우거나 취소한 확인서**가 가져오기에 어떻게 나오는지 — 목록에서 사라지기만 하면 IT가 계속 준비할 수 있어요. 가능하면 취소 표시 칸(`state:'취소'`·`deletedAt` 같은 것)으로.
5. **`docUrl`이 로그인 없이 열리는지** — IT팀은 영업 웹앱 계정이 없어요. 안 열리면 IT팀 읽기 계정이나 보기 전용 주소.
6. (있으면 좋음) 확인서를 **처음 만든 시각** 칸(`createdAt`) — 지금은 처음 받은 판의 저장 시각을 "접수일시"로 씀.

### 참고로 알려 드릴 것 (질문 아님)
- **출력은 영업 웹앱에서 뽑는 확인서와 똑같은 종이**예요. 영업이 적은 모델·사양은 그대로 두고, 다르면 옆에 "출고 ○○"·"8GB → 16GB"처럼 실제 나간 값을 덧붙여요. 회색 빈칸엔 자산번호·S/N(소프트웨어는 설치 PC·라이선스 키). 꼬리에 작게 "IT 기재"가 찍혀 영업이 뽑은 빈 종이와 구별돼요.
- 제조사·모델명·사양이 영업 요청과 다르면 **저장할 때 확인 창**이 떠요. [맞아요, 이대로]를 누른 사람·시각이 남고, 영업이 요청을 바꾸면 "다시 확인 필요"로 다시 물어요. 자산번호로 IT재고에서 채운 값도 같아요.
- 유지보수 품목도 대마다 칸이 생겨요(대상 기기 자산번호·시리얼).
- 소프트웨어는 라이선스 하나에 칸 하나예요. 키는 계약관리의 잠긴 칸에 저장되고, **계약관리 → 소프트웨어 계약의 그 거래처 아래에도 상품·좌석으로 같이 쌓여요**. 처음 한 번 어느 거래처인지 골라요(못 찾으면 새 거래처로, 그래도 모르면 '미분류'에 두고 나중에 옮겨요). 확인서에서 칸을 지워도 대장 기록은 남아요(지우려면 계약관리에서).
- 키가 잠겨 있을 때 출력하면 "비밀번호 넣고 키까지 찍기 / 키 없이 찍기"를 골라야 인쇄가 돼요.
- 영업 웹앱이 아직 안 보내 주는 칸(계약기간·렌탈료·보증금·발주일·업종·팩스·메일)은 **빈칸으로** 나가요(₩0처럼 틀린 값은 안 찍어요). 영업 쪽에 보내 달라고 요청해요.
- 한 품목이 회색 칸에 다 안 들어가면(보통 5대부터, 출고 모델이 다르면 3대부터, 소프트웨어 키는 3개부터) "출고 명세 참조"라고 적고 뒤에 '출고 명세(대수별)' 장이 붙어요.
- **교체·유지보수 확인서의 출력은 영업 웹앱 최신 양식 코드를 받은 뒤에 열려요**(지금 가진 양식엔 교체 전/후 자리가 없어서). 입력은 지금부터 돼요.
- 출력은 PC에서. 핸드폰은 입력·체크(키 넣기 포함)만.
- 지역은 목록·상세·종이 맨 위에 크게. 영업이 비워 두면 주소로 추정해서(영업 웹앱과 같은 규칙) 채워요.
- 뽑은 판을 기억해서, 뽑은 뒤 영업이 고치거나 IT 값이 바뀌면 "다시 뽑기"로 알려 드려요.
- (1단계 때 알려 드린 것 — 그대로) 메뉴는 그대로, 예전 화면은 `🗂 예전 방식` 칩으로. 영업 쪽에 되돌려 쓰지 않음. `IT확인서리스트` 시트는 전환 동안 그대로·이 기능은 시트에 안 씀. 연락처·주소는 로그인 붙일 때 같이 잠금. **출고 준비 리스트와 합치기 전까지는 자산번호를 출고 준비 완료 보고에도 따로 넣어 주셔야 해요**(카톡 보고·IT재고 반영은 그 보고 기준). 3분마다·열 때마다 최근 30일을 다시 받음. 영업이 수량을 줄이거나 품목을 바꿔도 IT가 적은 값은 "영업에서 빠진 칸"으로 남음. 처리여부 6단계·처리자 명단은 출고 준비 `👥 담당자 관리`. 체크리스트는 기기마다(사진·카톡방 업로드는 출고 준비 완료 보고에서). 교체 건의 회수할 기존 기기는 보기만.

### 위험 (개발·QA가 볼 것)
- **라이선스 키 노출** — 값은 `secrets.ts` 함수로만 읽고 씀, 액션마다 `requireUnlock`, ④·③·로그·오류 문구·브라우저 저장소에 값 없음, 출력 iframe 은 sandbox. **종이에 찍힌 키는 우리가 지킬 수 없음**(고객에게 주는 종이 — 사용자 결정). 출력 때 `view_bulk` 기록으로 누가 언제 찍었는지만 남김.
- **계약관리 표에 씀** — 출처 `'sales_confirm'`·열쇠로 중복을 막고, 대장의 사람 수정은 안 덮음(ledgerPushed 비교), 대장 줄은 확인서 쪽에서 자동으로 안 지움. CHECK 교체 SQL 은 한 트랜잭션·넓히기만. 계약관리 회귀 QA.
- **거래처를 잘못 고름** — 추천은 이름이 같을 때만, 나머지는 사람이 고름. 잘못 골랐으면 계약관리 `moveSwContract`로 옮김(설명서에 적음). '미분류'가 쌓이면 계약관리에서 정리.
- **확인 창이 너무 자주 뜸**(같은 값을 다르게 적은 경우) — 비교 기준을 순수 함수 한 곳(`specCompare.ts`)에 두고 써 보며 넓힘. 반대로 다른 값을 같다고 보면 안 되므로 애매하면 "다름".
- **사본이 영업 최신과 다름**(F22) — 교체·유지보수 출력 잠금으로 막고, 새 판을 받으면 P1~P6 다시 적용 + "fill 없으면 원본과 같음" 테스트. 바꾼 곳을 P1~P6 밖으로 늘리지 말 것.
- **1면 넘침 → 서명 칸이 말없이 잘림**(F20) — 출고 값 덧붙임으로 줄이 늘어남 → 칸 한도(4/2대) + P6ⓑ 넘침 신호로 자동 명세 전환 + QA 실제 인쇄 미리보기. 한도를 늘리려면 실제 인쇄로 다시 확인.
- **가짜 값**(₩0·'확인서서명' 자동 체크, F21) — P2. "안 옴(null)"과 "영업이 비움('')"을 정규화에서 섞지 말 것.
- **종이 두 장**: 영업은 IT 값을 모름(D4) — 영업이 같은 건을 자기 앱에서 다시 뽑으면 빈칸 종이. 현장에서 섞이지 않게 P5 "IT 기재" 표시.
- **iframe 인쇄 브라우저 차이** — PC Chrome·Edge 확인, 다른 브라우저는 QA에서. sandbox 에 `allow-same-origin`을 넣지 말 것.
- **normalize 고침이 가져오기에 번짐** — 반환에 칸만 더함, hash(원문 기준)·`extractRecords`·건너뛰기 규칙 그대로. ① items 사본은 hash 가 바뀐 건만 새 모양으로 써짐(목록 요약엔 영향 없음).
- **교체 건 칸 기준**(items vs after) — 사전 작업에서 건수로 확인 전까지 추측 금지.
- **응답 모양 모름**(F15 — 영업 저장소에 코드 없음) — 1단계에서 실측으로 확정함. 칸이 더 오면(§6 요청 1) 정규화만 넓힘.
- **30일 창 밖 수정·건수 상한** — 하루 한 번 90일 + 날짜 골라 다시 가져오기로 메움. 받은 건수가 딱 떨어지는 수면 상한 의심(§3-6).
- **취소·삭제를 모를 수 있음**(영업 요청 4) — 답 전까지 "영업에서 사라진 건"은 표시 못 함. 오래 안 받힌 건(30일 창 안인데 받은 목록에 없음)을 "영업 목록에 없음"으로 흐리게 보일지는 실측 뒤 판단.
- **IT 값 보호**는 구조로 — importer는 ③④를 import도 안 함, ③④는 화면 액션만. QA grep.
- **기기 칸 열쇠**가 종류+순서라 같은 종류 줄 순서가 바뀌면 다른 품목에 붙을 수 있음 → 스냅숏 경고로 드러남(§3-4). 소프트웨어 좌석은 ④ id 로 묶여 있어 칸을 옮겨도 대장 연결이 안 끊김.
- **개인정보 잠금 없음(D7)** — 주소를 아는 누구나 연락처·주소를 봄. 로그인 때 막을 화면을 CLAUDE.md에 적어 잊지 않게. 원문이 로그·오류 문구·상태 표·라우트 응답으로 새지 않게(QA grep `console.*payload` 류).
- **예전 보기 회귀** — `page.tsx`만 바뀌고 예전 컴포넌트는 그대로지만, Suspense·searchParams로 감싸면서 `maxDuration`·SetupGuide·`revalidatePath('/confirm-form')`(새 보기도 같이 새로 그려짐 — 무해) 동작 확인. 주소 ?뒤만 바뀔 때 page 재생성·진행 표시는 계약관리와 같은 주의(CLAUDE.md).
- **상세 주소에 영업 id** — 하위 정적 폴더 금지, encode/decode 한 곳(§4-2).
- **누구나 가져오기 라우트를 부를 수 있음**(로그인 없음) → 60초/10초 간격으로 막고, 응답에 원문 없음.
- **시트 읽기 한도**(IT재고·확인서와 같은 서비스계정) — 비교는 켰을 때 화면 열 때 1회, 연락처 칸 안 읽음, 한도면 "1분 뒤". 자산번호 조회는 5분 캐시 색인 먼저(F8).
- **Supabase 1000줄** — 목록은 날짜 창 + 페이지로 끝까지, 기기 칸 요약·가져오기 비교는 id 200개씩, 비밀 칸 읽기는 `secrets.ts`가 이미 페이지로 끝까지.
- **영업 쪽 장애가 출고를 막으면 안 됨** — 저장된 목록·상세·출력은 영업 API 없이도 다 됨.
- **두 화면에 자산번호를 두 번 적는 불편**(D8) — 4단계 전까지 감수. 출고 준비 완료 보고 쪽에 적은 번호와 다르면 보이지 않음(상세의 출고 준비 후보 상자에 보고 기기 수만 표시).
- 셸·로그에 `.env.local`·키·연락처·라이선스 키 값을 출력하지 않음(이름·길이·건수만). 영업 API·영업 Supabase 를 개발·QA 중에 직접 부르지 않음(배포된 우리 라우트로만).

---

## 7. 하지 않을 것 (범위 밖)
- **영업 쪽에 쓰기**(API·영업 Supabase·영업 시트 — D4), 영업 Supabase 직접 연결(D1). 출력 사실·IT 값·차이 확인을 영업에 알리기.
- **영업 양식 자체 바꾸기**(문구·색·칸 배치 — P1~P6 밖), 복합기 확인서 출력, 우리만의 별도 양식.
- 출력본 PDF 저장·보관, 서명 받은 종이 사진 올리기(필요하면 4단계 때 출고 준비 완료 보고 사진과 같이).
- `IT확인서리스트`·업체별 확인서 탭에 쓰기, 시트 → 앱 옮기기(지난 803줄 가져오기 없음 — 비교만).
- **개인정보 잠금**(연락처·주소 — D7, 로그인 때 같이), 로그인, 개인정보 보관 기간 정리.
- 라이선스 키 **밖의** 비밀 칸(마스터 계정·관리자 계정·결제 카드)을 확인서 화면에서 넣기 — 계약관리 화면에서. 상품 단위 비밀(공용 키를 상품에 한 번) — 좌석마다 같은 값으로 대신.
- 계약관리 기존 화면·파일 고치기(새 파일 `salesConfirmLink.ts` 하나만), 대장 좌석·상품을 확인서 쪽에서 지우기.
- IT재고 사양 글자("I7/12/16/512")를 칸별로 자동 나누기(힌트로만).
- **출고 준비 쪽에 쓰기**(D8 — 4단계): 연결 저장, 완료 보고로 기기 보내기, 완료 보고 기기로 채우기, 네이버 이름 표시, 카톡 발송, IT재고 반영, 사진 올리기.
- 예전 보기 컴포넌트(`ConfirmFormPage` 등)·`/dispatch` 코드 변경, 예전 보기·`/dispatch` 없애기(4단계 때 정리), Shell 메뉴 변경.
- 새 확인서 카톡 알림, 외부 스케줄러·Vercel 유료 cron.
- 교체 건 회수 기기 자산번호 기록(영업 최신 양식을 받은 뒤 그 양식에 자리가 있으면 그때 판단), 소모품 챙김 체크, 견적·청구 연결.
- `/dispatch` 목록 1000줄 잘림 손보기(별건).
