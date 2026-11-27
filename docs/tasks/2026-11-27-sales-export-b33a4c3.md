[기획실 도면우]

# 영업 웹앱 새 export(커밋 b33a4c3) 반영 — 영업 양식 그대로 + IT 칸만 채움 · 내용·양식 실시간 동기화 · 교체/유지보수/소프트웨어 출력 · 지운 확인서 (설계안, 2026-11-27)

크기: **큰 일 — 나눠서 배포.** 앞 설계 `docs/tasks/2026-11-26-sales-confirm-import.md`(D1~D30)를 잇는 문서이고, **이 문서의 E 결정이 겹치는 D 결정보다 우선**한다(특히 D9 가져오기 시점·D14 since·D16 사본·D22 칸 한도·D24 출력 막음).

사용자 요구(2026-11-27): ① "지금 우리 출력이 전략영업 확인서처럼 안 된다 — 영업이 작성한 확인서가 그대로 들어오는 형식이어야" ② "전략영업에서 바뀐 것들이 있으면 확인서에 **실시간 동기화**" — 내용(영업이 고친 판)과 **양식**(영업이 종이 모양을 고친 것) 둘 다. 사용자는 "진행해" — 추천안으로 정하고 진행, 물을 것은 1개만(§9).

| 차례 | 내용 | 영업 쪽 일 |
|---|---|---|
| **지금(팀장 한 줄)** | '납품'이 아닌 확인서 출력 막음 — 지금 코드는 **'소프트웨어' 확인서를 납품 양식으로 잘못 그림**(E17) | 없음 |
| **1차(우선 — 사용자가 지금 막힌 것)** | ⓐ 영업 양식 사본을 b33a4c3 판으로(대신 그리기용) ⓑ **IT 칸 표시(data-it) 방식**으로 빈칸에 값 넣기 — 사본·영업 실시간 HTML 둘 다 같은 한 길 ⓒ 출력·원본 보기 때 **영업 실시간 HTML 을 먼저 씀**(표시가 있으면 채우고, 없거나 안 되면 사본으로) ⓓ 교체·유지보수·소프트웨어 출력 ⓔ **내용 동기화**: 상세 화면도 1분마다·출력 창 열 때, 목록은 1분마다 짧은 기간만 ⓕ 접수일시 9시간 어긋남 고침 | 없음(1차만으로 출력은 영업 양식 b33a4c3 그대로 됨) |
| **영업 일(요청 글 §11)** | 영업이 확인서 HTML 에 IT 칸 표시를 붙이면 → **우리 배포 없이 그 순간부터 출력이 늘 영업 최신 양식**(양식 실시간). 팀장이 한 장 확인 | 표시 붙이기 + 작은 수정 |
| 2차 | 영업에서 지운 확인서(목록·상세·홈) · 이미 받은 줄 칸 다시 맞추기 | — |
| 3차 | 하루 한 번 점검: 대신 그리기용 사본이 영업 최신과 같은지·표시가 붙어 있는지 | — |
| (선택) | 영업이 저장할 때 우리에게 "바뀜" 신호 → 몇 초 안에 반영 | 신호 보내기(선택) |

외부에 **쓰는** 코드 없음(영업 export 는 읽기만) → integration-rules 안 부름. **새 SQL 없음**(§6) → db-schema·sql-review 안 부름.
흐름(1차): 팀장 사전 작업 → developer D ∥ developer A ∥ developer B ∥ ui-designer → qa-checker → deploy-check → 팀장 실제 건 출력 미리보기 확인 → 사용자.

---

## 결정 표 (맨 위가 우선)

### 실시간 동기화
| # | 결정 | 상태 | 이유 |
|---|---|---|---|
| **E1** | **상세 화면 내용 동기화**: 상세를 열 때 + 화면이 보이는 동안 **60초마다** + **출력 창을 열 때(최대 3초 기다림)** 그 확인서 **한 건만** 영업에서 다시 받음(`?id=&type=` — 영업 쪽 저장소 읽기 1번). 바뀌었으면 입력 중이 아닐 때 바로 다시 읽어 "영업에서 수정됨" 띠, 입력 중이면 "영업이 방금 고쳤어요 [새로 보기]" 띠(적던 값 안 날림) | 추천(1차) | 지금은 상세에 머물면 안 가져옴. 한 건 받기는 아주 가벼움. 출력 직전에 최신 판인지가 가장 중요 |
| **E2** | **목록 내용 동기화**: 간격 3분 → **60초**(화면이 보일 때만, 겹침 막기 60초 그대로). 받는 기간 = **그날 첫 번은 90일, 그 뒤는 '어제부터'**(지금은 늘 30일) | 추천(1차) | 영업 export 의 since = **저장·지운 날짜** 기준임을 코드로 확인(G2) → 어제 뒤로 고치거나 새로 만들거나 지운 건은 '어제부터'로 다 옴. 하루 첫 90일이 빠진 걸 메움. 응답이 수십 KB 로 줄어 1분 간격도 부담 작음(§3-G 계산) |
| **E3** | (선택·나중) 영업이 저장·지울 때 우리 주소로 **"바뀜" 신호**(내용 없이 종류·id·판 + 비밀 헤더) → 우리가 그 한 건을 export 로 받아 감 → 몇 초 안 반영 | 요청만(§11-7) | 진짜 실시간. 영업 쪽 일이라 "가능하면". 없어도 E1·E2 로 1분 안 |
| **E4** | **양식 동기화 = (나)**: 영업 확인서 HTML 의 IT 빈칸에 **표시 속성(data-it…)**을 붙여 달라고 요청 → 출력·원본 보기 때 서버가 헤더 키로 `html=1`(그 순간 영업 최신 양식)을 받아 **JSON 으로 감싸** 브라우저에 주고, 브라우저가 **DOMParser(스크립트가 안 도는 빈 문서)**로 읽어 표시 칸에 값만 넣은 뒤 sandbox iframe. **사본(b33a4c3)은 대신 그리기용** | 추천(1차 + 영업 일) | 양식은 늘 영업 최신(사용자 요구). IT 값·라이선스 키는 우리 밖으로 안 나감(D4·D29). 칸 위치를 구조로 추측하지 않음 |
| **E5** | (가) 사본 + 알아채기만 — 실시간이 아님 → **대신 그리기·점검용으로만**. (다) 영업이 IT 값을 받아 채워 그려 주기 — **안 함** | 확정 | (다): IT 값·**라이선스 키**가 영업 서버로 감(D29·D30 잠금 경계 밖, 영업 로그에 남을 수 있음), 채우기 규칙이 영업 코드로 넘어가 바꿀 때마다 영업 일, 영업이 멈추면 출력도 멈춤. D4 는 "영업에 저장 안 함"이라 글자로는 안 어기지만 취지(IT 값은 ERP 에만)와 어긋남 |
| **E6** | **채우기는 한 길**: `printFill` = "어느 표시 칸에 무슨 값"(채움 목록 plan), `itFill.applyFillPlan(html, plan)` = DOM 으로 표시 칸에 값 넣기. **사본엔 P 자리에서 영업이 붙일 것과 똑같은 표시만** 붙임 → 사본 HTML·영업 실시간 HTML 이 같은 함수로 채워짐. 영업이 표시를 넣으면 사본의 P 자리는 없어짐(그냥 사본) | 추천(1차) | 길이 둘이면 둘이 달라짐. 사본 고치는 곳이 "속성 붙이기"로 줄어 새 판 받기가 쉬움 |
| **E7** | **대신 그리기(사본) 조건**: 영업 응답 없음(4초)·`data-it-spec` 없음(아직 표시 전 — 1차 배포 직후 늘 이것)·모르는 표시 판·영업 HTML 의 판(`data-it-ver`)이 우리 판과 다름(→ 한 건 다시 받고 한 번 더)·**넣을 값이 갈 칸을 못 찾음**. 못 찾은 값이 있으면 [받아 둔 양식으로 뽑기](추천)/[그래도 영업 양식으로] 고름. 출력 창 위에 "영업 최신 양식 / 받아 둔 양식(11-27판) — 이유" 한 줄. 환경값 `SALES_FORM_SOURCE=copy` 면 늘 사본(끄는 스위치) | 추천(1차) | 조용히 값이 빠진 종이가 나가지 않게 |
| **E8** | **중계 라우트** `POST /api/sales-confirms/form-html {id}`: ① 에 있는 id 만, 헤더 키로 `html=1`(키를 주소에 안 붙임), 4초, 2MB 상한, **응답은 JSON `{ok, html}` — `text/html` 로 절대 안 내보냄**(우리 주소에서 영업 HTML 이 페이지로 열리면 우리 쿠키 쪽에서 스크립트가 돎), `no-store`, ⑤ 'html' 줄로 2초 간격, 로그엔 HTTP 숫자만 | 추천(1차) | |
| **E9** | 값 넣기에 **정규식 금지** — DOMParser 문서에서 `querySelectorAll('[data-it]')` → `textContent`/`createElement` 로만(이스케이프 저절로). 우리 스크립트·CSS 도 DOM 요소로 덧붙임. 서버 쪽 HTML 파서 라이브러리는 안 씀(새 의존성·키가 서버 HTML 에 실림) | 확정(1차) | |

### 출력 내용
| # | 결정 | 상태 | 이유 |
|---|---|---|---|
| **E10** | 사본으로 그릴 때도 **export 의 `doc`(+`renderer`)을 영업 렌더러에 그대로** — 정규화 칸으로 영업 문서를 다시 만들던 것(`toConfDoc`)·P2(₩0 막기) 없앰 | 추천(1차) | 제목 줄(title·head·consign)·소모품 수량 글자 등이 정규화엔 없어 "영업 종이와 다름"(사용자 신고 원인) |
| **E11** | 사본 = 렌더러 3개가 import 로 끌어오는 **14개 파일만** b33a4c3 그대로(blob sha 확인함). `lib/` 통째 X | 추천(1차) | 통째면 로그인·Supabase·카톡·네이버·고객 자료(bigcoSeed.json)가 들어옴. 14개는 서버·DB·네트워크·환경값 코드 없음(G11) |
| **E12** | confTitle·statusRow 가 끌어오는 pull·move·sale·furn(·kakaoParse·inkjet)은 **잘라내지 않고 그대로** | 추천(1차) | 타입만이 아니라 **값**을 import(`shortAddr`·`saleQty`·`svcQty`·`furnSummary`·`parseDay`·`emptyUnit`·`parseDate`…) → 자르려면 사본을 고쳐야 하고 새 판마다 다시. 원본 TS 약 212KB — 창 열 때만 불러옴(E21) |
| **E13** | **납품(IT) 표 = 새 양식 오른쪽 '출고시 기재사항(IT팀 · 대마다 한 줄)' 빈칸 5개(제조사·모델명·자산번호·시리얼번호·출고 사양)에 ④ 값**(n번째 줄 = 그 품목 n번째 칸). 왼쪽 '요청사항(영업 작성)'은 영업 값 그대로 | 확정 방향(1차) | 옛 P1(회색 줄 덧붙이기) 버림 |
| **E14** | **"요청 → 출고" 글자는 따로 안 넣음** — 왼쪽 요청·오른쪽 출고가 같은 줄에 나란히 있어 둘 다 보임(D18 충족). **요청과 다른 칸만 굵게+밑줄**(출고 사양은 다른 토막만) | 추천(1차) | 오른쪽 칸이 좁아(시리얼 30mm) 글자를 더 넣으면 줄이 늘어 1면이 넘침. 강조는 글자 수를 안 늘림 |
| **E15** | IT가 출고 칸을 비워 둔 기기: 자산번호나 시리얼을 적은 기기는 제조사·모델명 = 영업 요청 값, 출고 사양 = **"요청과 같음"**. 아무것도 안 적은 기기는 빈칸(손으로) | 추천안으로 정함 | D27 확인 창이 안 떴다 = 요청과 같음. 요청 사양은 바로 왼쪽 — 다시 길게 안 씀. 규칙은 상수 하나라 바꾸기 쉬움 |
| **E16** | 납품 양식의 **소프트웨어 체크 줄**(WIN·오피스·한글·기타)은 손으로. 납품 안의 소프트웨어 품목: 자산번호 칸 = 설치 PC, 시리얼번호 칸 = "키 ○○"(D30 고르기 그대로). 유지보수 품목: 자산번호·시리얼만 | 추천(1차) | 앱에 체크 줄 자료 없음 |
| **E17** | 출력 막음 풂: **교체·유지보수·소프트웨어 열림.** 막는 건 `doc`·`renderer` 없는 옛 원문뿐("⋯ → 날짜 골라 다시 가져오기"). **지금 당장**: '납품'이 아니면 막는 한 줄 hotfix | 1차 · hotfix 즉시 | G7 |
| **E18** | 옛 P 정리: **P2 없앰**(돈이 실제로 옴, 비어 오면 영업 종이와 같게) · **P3 납품에선 안 씀**(대마다 칸이 생김 → 유지보수·소프트웨어 'IT 기재 명세' 장으로) · **P4 2면은 기본 끔**(영업이 기본으로 안 냄 — 추천안으로 정함), 켜면 출고 준비자·출고일 · **P5 꼬리 "IT 기재" 세 양식 모두** · **P6 그대로**(넘침은 알림만). **D22 한도·'출고 명세 자동·항상' 옵션 폐기** | 추천(1차) | G9 |
| **E19** | **교체(IT)**: 교체 후 열 — 기번(S/N)·자산번호 빈칸 ← ④, 제조사·기종 비었으면 ← ④ 제조사, 모델명·제조사가 영업 값과 다르면 칸 아래 작은 굵은 줄 "출고 ○○", 하드웨어 = 영업 값 + IT가 고친 사양이 있으면 "출고: I5/16GB/512GB". 품목·상태·소프트웨어·교체 전 열 = 영업 값. 상세는 지금처럼 **교체 후 1칸 입력 + 교체 전 보기만**(교체 전 IT 입력 칸은 안 만듦 — 추천안으로 정함, 4단계에서) | 추천(1차) | 교체 양식은 요청/출고 열이 따로 없음(교체 후 한 열). 교체 전 값은 영업이 임대리스트에서 채움(G6) |
| **E20** | **유지보수·소프트웨어**: 영업 양식엔 기기별 칸이 없음 → 고객 서명 1장은 그대로(꼬리·스크립트만) + **뒤에 'IT 기재 명세' 한 장**(같은 틀·색): 유지보수 = 순·품목·자산번호·S/N, 소프트웨어 = 순·제품·설치 PC·사용자·라이선스 키. 안 채운 대수는 빈 줄. ④ 메모는 안 찍음 | 추천(1차) | D19·D30 을 새 양식에 맞춤 |
| **E21** | 출력·원본 보기 코드(사본 14개·printFill·itFill)는 **창을 열 때 불러옴**(dynamic import) | 추천(1차) | 상세 첫 화면 JS 가 안 커지게 |
| **E22** | **영업 원본 보기 = 영업 실시간 HTML 그대로**(채우기가 없어 표시가 필요 없음 → 1차부터 바로 실시간), 안 되면 사본(fill 없음). 출력 창과 같은 sandbox iframe(`allow-same-origin` 금지) | 추천(1차) | 지금 docUrl 은 키 필요 주소라 숨김(팀장 39ef7c8) |
| **E23** | 금액(렌탈료·보증금)은 영업 종이처럼 **그대로 찍음** | 추천안으로 정함 | 고객 서명 종이 — 영업 종이와 같아야 함 |

### 가져오기·데이터
| # | 결정 | 상태 | 이유 |
|---|---|---|---|
| **E24** | **시간**: 영업 savedAt·createdAt·deletedAt = 시간대 없는 한국 시각 `YYYY-MM-DD HH:mm` → 한국 시각으로 읽음. **지금은 서버(UTC)가 UTC 로 읽어 접수일시·영업 저장 시각이 9시간 늦게 저장됨.** 접수일시 = `createdAt`(처음 저장) | 1차(읽기)·2차(저장된 줄 고침 E29) | G3 — Node 로 재현 |
| **E25** | normalize 새 칸: `renderer`·`formDoc`(**svc `items[].cost` 매입가는 뺌** — 브라우저로 안 감)·`salesStatus`·`salesDeleted`·`deletedAt`·`deletedBy`·`createdAt`·`createdBy`. svc 품목은 `doc.items` 에서(이름 빈 줄 빼고, '3대' → 3). **hash 그대로**(원문 키 정렬 JSON) — 지움·되살림(같은 판)이 이 길로 들어옴 | 추천(1차) | G5·§3-A |
| **E26** | **영업에서 지움 = ① `sales_state='지움'`**(기존 칸 — SQL 없음, 목록 표가 이미 "영업에서 {sales_state}" 빨강). **진짜 지움 = status 'deleted' 이면서 마지막 저장 ≤ 지운 시각** — 영업 납품·교체 저장 코드가 지운 뒤 다시 저장해도 지운 표시를 안 지우므로(G4) | 추천(2차) | §3-B |
| **E27** | 지운 건 화면: 기본 목록에서 숨김, **단 IT가 손댄 건(처리여부가 접수·취소가 아님)은 빨간 "영업에서 지움"으로 남김** · 칩 "영업에서 지움 n" · "새로" 안 붙임 · **③ 처리여부 자동 변경 없음**(상세 띠 [처리여부를 '취소'로]) · IT 값 그대로 · 출력은 "지운 걸 알고 뽑아요" 체크해야 · 홈: 숫자에서 빼고 "영업에서 지웠는데 IT가 준비 중 n건"(빨강) | 추천(2차) | |
| **E28** | 되살아남: 다음 가져오기에서 `sales_state=''`(판↑ 면 "영업에서 수정됨"). 기본 목록은 끝난 건이어도 **"영업에서 수정됨"이면 보여 줌**. 지운 건은 지운 날부터 받는 기간 안에서만 옴 → ① 은 마지막 상태를 그대로(맞는 값). 창 안인데 목록에서 사라진 건은 ⑤ 에 건수(`missing`)만 | 추천(2차) | |
| **E29** | **칸 다시 맞추기**: 그날 첫 90일 가져오기 때만, hash 가 같아도 ① `first_saved_at`·`saved_at`·`sales_state`·`type`·`items` 가 지금 normalize 결과와 다르면 그 칸만 고침(② 안 씀, ⑤ `repaired`) | 추천(2차) | E24 의 어긋난 값을 SQL 없이 |
| **E30** | 원문이 약 두 배(doc 이 맨 위 칸과 겹침) — **괜찮음**. 원문을 싣는 쓰기 묶음만 200 → 50. ⑤ 에 받은 크기·걸린 시간 기록 | 추천(2차) | §3-A |
| **E31** | **점검(3차)**: 하루 한 번(목록을 연 날 첫 번), 종류마다 최근 1건 — 영업 html=1 과 사본(같은 doc·같은 origin, fill 없음)을 sha256 비교 + 표시(`data-it-spec`) 유무. 결과는 ⑤ **두 번째 줄 id 'form'**(SQL 없음). 사본이 다르면 "대신 그리기용 양식이 오래됐어요 — 영업 새 커밋 받기" 띠(실시간 양식을 쓰는 동안엔 출력엔 영향 없음) | 추천(3차) | 영업이 멈춘 날의 종이가 영업과 달라지지 않게 |
| **E32** | **SQL 없음**. ⑤ 표에 줄 'one'(한 건 받기 간격)·'html'(중계 간격)·'form'(점검)을 더 씀 — id 에 CHECK 없음, 기존 읽기 4곳은 모두 'main' 만(G13) | 확정 | §6 |

---

## 0. 확인한 것 (근거 — 영업 파일은 읽기만, 실행·import 안 함)

받은 폴더 = `…\scratchpad\sales-b33a4c3\`(파일 이름은 경로의 `/` → `_`). "route" = `app_api_export_it-confirms_route.ts`.

| # | 사실 | 위치 |
|---|---|---|
| G1 | export 한 줄에 `status('active'|'deleted')`·`deletedAt`·`deletedBy`·`createdAt`(첫 판 savedAt)·`createdBy`·`renderer('confirm'|'swap'|'svc')`·`doc`(그 renderer 에 넣으면 같은 종이). 납품은 ConfDoc 칸 전부를 맨 위에도 펼침. `doc` = `fullConf/fullSwap/fullSvc(마지막 판)` | route 12~27, 49~126 |
| G2 | **since = 목록 색인의 savedAt 날짜(한국) 기준** — 저장할 때마다 색인 savedAt 이 지금으로 바뀜. 지운 건은 `deletedAt` 날짜 ≥ since 일 때 `status 'deleted'` 로. 납품 = confirm kind 'it', 교체 = swap kind 'it', 유지보수·**소프트웨어** = svc 전부. 철수·이전·판매·가구 없음. 한 건 `?id=&type=`(지운 것도), `&html=1` = 영업 양식 HTML(헤더 키 우선, 없으면 `&key=`) | route 16~21, 33~40, 133~191 · docStore.ts 147~148 |
| G3 | 영업 시각 = `kstNow()` = **시간대 없는 `'YYYY-MM-DD HH:mm'`(한국)**. 우리 `normalize.ts` `toIso` 는 `Date.parse` → **서버가 UTC 면 9시간 늦게**(재현: `TZ=UTC` Node 에서 `'2026-11-27 09:10'` → `09:10Z` = 한국 18:10) | docStore.ts 39 · confirm route 42 · normalize.ts 184~193 |
| G4 | 지운 뒤 다시 저장: svc 등 `docRoutes` 는 `delete rec.deleted`. **납품·교체 저장 코드는 안 지움** → 영업 화면엔 다시 보이는데 export 는 계속 `deleted`(목록 쪽은 `!rec.deleted` 로 빼고 지운 목록에서 `deleted.at` ≥ since 일 때만) | docStore.ts 145 · app_api_confirm_route.ts 116~117 · app_api_swap_route.ts 104~105 · route 169·177 |
| G5 | svc export `items` = `{cat: '유지보수'|'소프트웨어', model: 이름, qty: Number(qty)||0}` — 이름 빈 줄도 오고 '3대'면 0. 영업 종이는 이름 있는 줄만·숫자만 떼어 셈. `SvcItem.cost` = **매입가**(확인서엔 안 나옴) — doc 에만 | route 119 · lib_svc.ts 10·81 · lib_svcDoc.ts 72~79 |
| G6 | 교체 export: `items` = 교체 후 한 줄(`spec {사양: hw, 소프트웨어: sw}`), `before {item,model,maker,sn,asset,spec,sw}`(영업이 임대리스트에서 채움), `contacts.contractor` = 결제담당, `resident` = 교체 요청자(고객), `term` = 임대리스트 '일반/현장' | route 99~106 · lib_swap.ts 43~46 |
| G7 | `type` 에 **'소프트웨어'** 새로. 우리 `printFill.ts` 는 `/교체|유지보수/` 만 막음 → 소프트웨어 확인서를 납품 양식으로 그림 | printFill.ts 410 |
| G8 | 우리 사본 = 11-18판(`salesForm/confirm.ts` = 영업 bedddc1 와 같음 확인) | diff |
| G9 | 새 `renderConfirm(d0, origin='', withBack=false)` — **2면 기본 안 냄**. IT 표 = 대마다 한 줄(빈칸 `<td></td>`×5) + PC류 소프트웨어 체크 줄, 1면 8줄·별지 26줄. 촘촘한 모양(compact)은 코드만 있고 안 씀. 넘치면 `tight`~`tight5`(최대 80%) 스크립트. 글꼴 Pretendard(CDN) | lib_confirmDoc.ts 235~274, 298~319, 372, 401, 447~491 |
| G10 | 14개 파일 blob sha = GitHub b33a4c3 tree 와 같음, `public/confirm/rabbit.png` 도 같음(f8884b9…) | gh api git/trees · git hash-object |
| G11 | 렌더러 3개의 import 를 따라간 파일 14개(§3-D). 그 안에 `process.env`·`fetch`·`require`·`node:`·`@/` 없음. `Date.now()` 는 빈 문서 기본값 함수에만 | grep |
| G12 | 두 저장소 tsconfig 같음(strict·bundler) | tsconfig.json |
| G13 | ⑤ `it_sales_import_state.id` 에 CHECK 없음, 읽는 곳 4곳 모두 `.eq('id','main')` | schema 241 · grep |
| G14 | ① `sales_state` 칸 있음, 목록 표가 이미 `영업에서 {salesState}` 빨강. 홈 카드 select 엔 없음 | SalesConfirmTable.tsx 196 · homeDashboard.ts 430 |
| G15 | 앱에 CSP 헤더 없음 → iframe 안 CDN 글꼴·영업 로고(절대 주소) 받아짐 | next.config.mjs·vercel.json |
| G16 | `fullConf` 가 `emptyConf`(orderDate = 오늘) 위에 덮음 → 저장본에 칸이 없으면 날마다 hash 가 바뀔 수 있음 | route 50~51 · lib_confirm.ts 128 |
| G17 | **상세 화면은 가져오기를 안 부름** — 부르는 곳은 목록(열 때·3분·🔄·⋯)과 홈(10분)뿐 | SalesConfirmListPage.tsx 30·191·307 |
| G18 | 영업 지운 목록 읽기(`deletedRecs`)는 지운 확인서를 **전부(모든 판째)** 읽은 뒤 날짜로 거름 — 부를 때마다 지운 건 수만큼 영업 저장소에서 읽음 | docStore.ts 33~37 · route 174~178 |

---

## 1. 한 줄 목표와 쓰는 사람

**영업 웹앱이 지금 뽑는 확인서(납품 일반/현장 · 교체 고장/일반 · 유지보수 · 소프트웨어)를 색·구성·제목 줄까지 그대로 — 가능하면 그 순간 영업 최신 양식으로 — 뽑고, IT 칸만 우리 값으로 채운다. 영업이 고친 내용은 열어 둔 화면에 1분 안에 들어온다.** 덧붙여 영업에서 지운 확인서를 알아보게 한다.
- 출력·원본 보기: **PC**(창고 사무실). 핸드폰은 입력·체크(지금처럼 "출력은 PC에서"), 원본 보기는 축소 보기만.

---

## 2. 기존 코드 재사용·확장 지점

| 파일:함수 | 어떻게 |
|---|---|
| `lib/salesConfirms/salesForm/confirm.ts`·`confirmDoc.ts` | **b33a4c3 판으로 통째 교체**(머리 주석만 새로) + confirmDoc 에 P 자리(표시 속성) |
| 새 `salesForm/{confTitle,statusRow,swap,pull,move,sale,svc,furn,kakaoParse,inkjet,swapDoc,svcDoc}.ts` | 사본 그대로(머리 주석 + `/* eslint-disable */`). swapDoc·svcDoc 만 P 자리 |
| 새 `salesForm/itFill.ts` | **우리 파일** — 표시 이름 상수, `applyFillPlan`(DOM), FILL_CSS, 우리 스크립트(인쇄 신호·넘침·높이), IT 기재 명세 장, 꼬리 글자 |
| `lib/salesConfirms/printFill.ts` | **다시 씀**: `buildFillPlan`(순수) + `renderCopy`(사본 그리기, 표시 붙임). `toConfDoc`·P2·명세 옵션·회색 칸 계산 없앰 |
| `lib/salesConfirms/normalize.ts` | 새 칸(E24·E25) — hash·`extractRecords`·건너뛰기 그대로 |
| `lib/salesConfirms/importer.ts` | (1차) since 짧게(E2)·한 건 받기 경로(E1) / (2차) sales_state·칸 다시 맞추기·묶음 50 |
| `lib/salesConfirms/source.ts` | (1차) 한 건 JSON·HTML 받기(헤더 키) |
| `app/api/sales-confirms/import/route.ts` | `{id}` 이면 한 건 받기, 트리거 'detail'·'print' |
| 새 `app/api/sales-confirms/form-html/route.ts` | E8 중계(JSON) |
| `lib/salesConfirms/work.ts` `loadSalesConfirmDetail` | 상세 데이터에 `formDoc`·`renderer`, (2차) 지움 정보, (3차) 점검 결과 |
| `lib/salesConfirms/listQuery.ts`, `lib/homeDashboard.ts` | (2차) 지운 건 규칙, (3차) 점검 결과 |
| `components/salesConfirms/SalesPrintDialog.tsx` | 실시간 HTML/사본 고르기·채우기·대신 그리기 이유·원본 모드·dynamic import·2면 기본 끔 |
| `SalesConfirmDetail.tsx`·`SalesChangeBanner.tsx`·`DeviceSlotCard.tsx` | 60초 한 건 받기·입력 중 보호 띠, `영업 원본 보기` 버튼, 교체·유지보수 막음 문구 없앰, 교체 칸 머리 |
| `SalesConfirmListPage.tsx`·`SalesConfirmTable.tsx`·`ImportStatusBar.tsx` | (1차) 간격 60초, (2차) 지움 칩·숨김 규칙, (3차) 점검 띠 |
| `lib/contracts/salesConfirmLink.ts`·`app/confirm-form/salesLicenseActions.ts` | **안 고침** — `getSalesPrintKeys`·잠금 그대로 |
| 안 건드림 | 영업 쪽, 출고 준비·네이버·카톡·시트, 계약관리 기존 파일, `?view=legacy`, `public/confirm/rabbit.png`(같음) |

---

## 3. 설계

### 3-G. 내용 실시간 동기화 (1차)

**상세(E1)**
- 열 때(화면을 그린 뒤 — 첫 화면은 저장본으로 바로), 화면이 보이는 동안 60초마다, 탭으로 돌아왔을 때(60초 지났으면), 출력 창을 열 때(최대 3초 기다리고 안 되면 저장본으로 + 알림 "영업 웹앱에 연결이 안 돼 마지막으로 받은 판으로 그렸어요").
- `POST /api/sales-confirms/import { id, trigger: 'detail'|'print' }` → importer 한 건 경로: ① 의 type 으로 `GET <export>?id=&type=`(헤더 키, 4초) → 지금 normalize·hash·쓰기 규칙 그대로(①② 만) → 응답 `{ changed, ver, salesState, notFound }`(원문 없음).
- 간격 막기: ⑤ 줄 `'one'` 조건부 update 3초(누구나 부를 수 있으니). 막혔으면 `skippedRecent` — 화면은 다음 60초에.
- 404(영업에서 못 찾음 — 종류가 복합기로 바뀜 등): 아무것도 안 씀, 상세에 회색 한 줄.
- `changed` 면: 입력 중인 칸이 없으면 `openSalesConfirm` 으로 다시 읽음(새 `workUpdatedAt` 도 받음 — 가짜 충돌 없음) → "영업에서 수정됨" 띠가 바로 뜸. 입력 중이면 띠 "영업이 방금 고쳤어요 — [새로 보기]"(적던 값은 그대로, 누르면 다시 읽음). 저장할 때는 서버의 D27 차이 검사가 새 판 기준으로 다시 물음(그대로).

**목록(E2)**
- 간격 60초(보일 때만), 열 때·🔄·⋯ 그대로. 겹침 막기 60초 그대로(여러 명이 열어도 영업 목록 호출은 1분에 1번).
- since: 그날(한국) 첫 성공 전 = 90일(지금처럼 `last_deep_at`), 그 뒤 = **어제**(오늘−1, 자정 넘김 대비). ⋯ 날짜 골라 다시 가져오기(365일) 그대로. 홈의 10분 `after()` 도 같은 규칙.
- 근거: export since 는 **저장·지운 날짜**(G2) → 어제 이후 고치거나 만들거나 지운 건은 빠짐없이 옴. 며칠 아무도 안 열었으면 그날 첫 번이 90일이라 메움.

**부담 계산(추정)**
| | 지금 | 바꾼 뒤 |
|---|---|---|
| 영업 목록 호출 | 3분마다, 30일(약 100건 → 영업 저장소 약 100번 읽기·응답 0.4~0.8MB) | 1분마다, 어제부터(보통 0~10건 → 읽기 십여 번·응답 수십 KB) + 하루 첫 번 90일 |
| 영업 한 건 호출 | 없음 | 상세를 연 화면마다 1분에 1번(읽기 1번·응답 수 KB) |
| 우리 함수 호출 | 하루 수백 | 화면 3개를 하루 10시간 열어 두면 하루 약 2,000번 → 한 달 약 4만 번(Vercel Hobby 월 한도보다 훨씬 적음 — 팀장이 사용량 화면에서 한 번 확인) |
- 주의: 영업 `deletedRecs` 는 부를 때마다 지운 확인서를 전부 읽음(G18) — 지운 건이 쌓이면 1분 간격이 영업 저장소에 부담 → 요청 글에 "날짜로 걸러 읽기"를 넣음(§11-6). 영업이 부담을 말하면 목록 간격만 2분으로.

### 3-H. 양식 실시간 동기화 (1차 + 영업 일)

| | (가) 사본 + 알아채기 | **(나) 영업 HTML + IT 칸 표시 — 추천** | (다) 영업이 채워 그려 주기 |
|---|---|---|---|
| 영업이 양식을 고치면 | 사람이 새 커밋 받아 배포할 때까지 옛 양식 | **그 순간부터 새 양식** | 그 순간부터 |
| IT 값·라이선스 키 | 우리 안 | **우리 안(브라우저에서 넣음)** | **영업 서버로 감** — D29·D30 경계 밖 |
| 채우기 규칙 | 우리 | **우리** | 영업 코드(바꿀 때마다 영업 일) |
| 영업이 멈추면 | 상관없음 | 사본으로 대신 그리기 | 출력 못 함 |
| 영업 쪽 일 | 없음 | 속성 붙이기(모양 안 바뀜) | 새 창구 + 채우기 규칙 |
| 깨지기 쉬움 | 사본 P 자리 | 표시 약속(판 번호로 관리) | 양쪽 규칙 맞추기 |

**(나) 흐름**
1. 출력 창(또는 원본 보기)을 열면: ⓐ 한 건 받기(E1) ⓑ `POST /api/sales-confirms/form-html {id}` → 서버가 ① 에서 type 을 읽어 `GET <export>?id=&type=&html=1`(헤더 `x-export-key`) → `{ ok:true, html }` JSON(4초·2MB 상한·`no-store`). 안 되면 `{ ok:false, reason:'unreachable'|'unauthorized'|'too_big'|… }`.
2. 브라우저: `new DOMParser().parseFromString(html, 'text/html')` — 이 문서에선 스크립트가 안 돌고 그림도 안 받음. `body[data-it-spec]` 확인 → 모르는 판·없음이면 사본으로(E7).
3. `data-it-ver` 가 우리 ① 판과 다르면 한 건 받기 한 번 더 → 그래도 다르면 사본으로.
4. `applyFillPlan(doc, plan)`: 표시 칸마다 값 넣기(`textContent`, 강조는 `b`·`u` 요소를 만들어), 우리 CSS·스크립트를 `style`·`script` 요소로 덧붙임, svc 면 IT 기재 명세 장을 `body` 끝에. **plan 의 값 중 갈 칸이 없는 것**을 세어 돌려줌.
5. `'<!doctype html>' + documentElement.outerHTML` → sandbox iframe `srcDoc`(`allow-scripts allow-modals`, **allow-same-origin 금지**). 영업 양식 스크립트(줄이기)와 우리 스크립트(인쇄 신호·넘침)가 iframe 안에서 돎.
6. 출력 창 위 한 줄: "영업 최신 양식으로 그렸어요" 또는 "받아 둔 양식(11-27판)으로 그렸어요 — 이유". 못 넣은 값이 있으면 고르기(E7).
- 옵션(2면·키 고르기)을 바꿀 땐 받은 HTML 을 다시 쓰고 영업을 다시 부르지 않음.
- 원본 보기(E22): 1~2 와 5 만(채우기 없음 — 표시 없어도 됨).
- 1차 배포 때 영업 HTML 엔 아직 표시가 없음 → 출력은 사본(표시를 P 자리에서 붙임)으로, 원본 보기는 실시간. 영업이 표시를 붙이는 순간 **배포 없이** 출력도 실시간으로 바뀜(검사를 엄격하게 — 대수만큼 칸이 있어야 함).

**표시 약속(영업에 요청 — §11 이 원문)**
| 자리 | 속성 |
|---|---|
| `<body>` | `data-it-spec="1"` · `data-it-form="confirm|swap|svc"` · `data-it-ver="<판>"` · `data-it-id="<id>"` |
| 납품 대마다 줄의 빈칸 5개 | `data-it="maker|model|asset|sn|spec"` + `data-it-item="<품목 번호 n>"` + `data-it-unit="<1..대수>"` |
| 납품 촘촘 모양(쓰게 되면) | `.cm` span 3개 `maker|model|spec` + item, `.uc` span 2개 `asset|sn` + item + unit |
| 납품 소프트웨어 체크 줄 | `td.swr` 에 `data-it="sw"` + item(자리만 — 지금은 안 채움) |
| 2면 | 출고 준비자 칸 `data-it="preparer"`, 출고일 칸 `data-it="ship-date"` |
| 모든 꼬리(.foot 첫 span 끝) | 빈 `<span data-it="stamp"></span>` |
| 교체(IT 갈래) 교체 후 칸 | `after-model|after-maker|after-sn|after-asset|after-hw|after-sw` (교체 전 기번·자산번호 `before-sn|before-asset` — 자리만) |
| 유지보수·소프트웨어 | 품목 표 `tr` 에 `data-it-item="<k>"`, 꼬리 stamp |
- 우리 쪽 상수는 `itFill.ts` 한 곳(`IT_MARK`). 표시 판이 바뀌면(`data-it-spec` 2) 우리가 맞출 때까지 사본으로.

### 3-D. 양식 사본 새 판 (1차 — 대신 그리기용)

**우리 사본(11-18판)과 b33a4c3 의 차이(종이에 보이는 것만)**

| 곳 | 11-18판(지금 우리) | b33a4c3(영업이 지금 뽑는 것) |
|---|---|---|
| 머리 | 로고·회사명 | **제목 줄**(titleConf), 고객센터 자리 바뀜 |
| 색 | 초록 | 일반/장기 = 초록, **현장/단기 = 산호(빨강)** + 노란 '유의사항' 줄, 띠·칸 머리 연한 색 |
| 계약 조건 | 보증금 없으면 ₩0 | 없으면 **'없음'**, 계약기간 적은 그대로('36' → '36개월'), '20만원' → 200,000 |
| 임대료 | 품목 표 안 | **따로 '임대료' 상자** |
| **IT 품목 표** | 품목 줄 + 사양 줄 + 회색 줄(자산번호·S/N·설치장소) | **왼쪽 '요청사항(영업 작성)' + 오른쪽 '출고시 기재사항(IT팀 · 대마다 한 줄)' 5칸 빈칸**, PC류 아래 **소프트웨어 체크 줄** |
| 1면/별지 | 2품목·7품목 | IT 는 줄 수(1면 8줄·별지 26줄) |
| 소모품·확인란 | 늘 | 소모품은 있을 때만, 확인란 바뀜 |
| 2면 | 늘 붙음 | **기본 안 냄** |
| 넘침·글꼴 | 잘림·맑은 고딕 | `tight` 줄이기·Pretendard |
| 교체·유지보수·소프트웨어 | 없음 | `swapDoc.ts`(교체 전/후 비교표, 고장/AS 남색·일반 청록, 조건 변경 표) · `svcDoc.ts`(월 요금 표·서비스 내용, 기기별 칸 없음) |

**가져올 파일 14개 — 통째 vs 필요한 것만**
- 통째(약 70개): 로그인·Supabase·카톡·네이버·시트·AI·**고객 자료 bigcoSeed.json** — 우리 빌드가 깨지고 검토 범위가 큼. ✗
- **필요한 것만(추천)**: `confirmDoc`·`confirm`·`confTitle`·`statusRow`·`swap`·`pull`·`move`·`sale`·`svc`·`furn`·`kakaoParse`·`inkjet`·`swapDoc`·`svcDoc`. 이 중 statusRow·pull·move·sale·furn·kakaoParse·inkjet 은 종이에 직접 안 쓰이지만 import 로 이어져 같이(E12). 받는 곳 `lib/salesConfirms/salesForm/<같은 이름>.ts`(상대 import 가 그대로 맞음). 머리 주석: 출처·커밋 `b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be`·blob sha·받은 날. furnDoc·pullDoc·moveDoc·saleDoc·docStore·라우트는 안 가져옴.

**P 자리 = 표시 속성 붙이기만(값은 `applyFillPlan` 이 넣음)** — `marks` 인자가 참일 때만 붙임 → **marks 없이 부르면 원본과 글자까지 같음**. 영업이 표시를 넣으면 이 자리들은 없앰.

| 파일 | 자리(b33a4c3 행) | 붙이는 것 |
|---|---|---|
| confirmDoc | 시그니처 477 | `renderConfirm(d0, origin = '', withBack = false, marks = false)` + itemTable·itemRows·page1(372)·pageMore(401)·page2 에 marks 전달 |
| confirmDoc | 487 `<body>` | body 표시 4개 |
| confirmDoc | itemRows 269 대마다 줄 `<td></td>`×5 | 5칸 표시(item = `n`, unit = `u + 1`) |
| confirmDoc | itemRows 259~266 촘촘 모양 | `.cm`·`.uc` 표시(영업이 아직 안 씀 — 대비) |
| confirmDoc | itemRows 265·271 `td.swr` | `data-it="sw"` |
| confirmDoc | page2 414 출고 준비자·출고일 칸 | preparer·ship-date |
| confirmDoc | foot 394·402·435 | stamp span |
| swapDoc | 시그니처 70 · 150 `<body>` | `renderSwap(d, origin = '', marks = false)` · body 표시 |
| swapDoc | IT 갈래 106~111 교체 후 칸, 108·109 교체 전 칸 | after-*·before-* |
| swapDoc | foot 146 | stamp |
| svcDoc | 시그니처 69 · 116 `<body>` | `renderSvc(d, origin = '', marks = false)` · body 표시 |
| svcDoc | rows 73~79 `<tr>` · foot 114 | item · stamp |

**없앤 것**: 옛 P1(회색 줄·사양 덧붙임)·P2·P3(납품)·출고 명세 옵션·D22 한도·넘침 신호로 다시 그리기(바꿀 모양이 없음 → 알림만).

**"marks 없이 = 영업 원본과 글자까지 같음" 확인(qa-checker — 안전하게)**
1. 빈 새 폴더 `<scratch>/sales-src-b33a4c3/lib/` 에 14개를 **원래 이름으로** 받음(`gh api …/contents/lib/<이름>.ts?ref=<커밋> -H "Accept: application/vnd.github.raw"`), `git hash-object` 가 tree blob sha 와 같은지. 고객 자료 파일은 받지 않음.
2. 그 폴더에서 `process|require|import\(|fetch|eval|Function\(|child_process|node:` grep → 0 이어야 다음(있으면 멈추고 팀장).
3. **옮겨 적기(transpile)만 — 실행 아님**: 작업 폴더는 빈 `<scratch>/work`, 우리 저장소 TypeScript 를 경로로 부름  
   `node <repo>/node_modules/typescript/lib/tsc.js --outDir <scratch>/out-sales --module commonjs --moduleResolution node --target es2022 --skipLibCheck <…>/lib/confirmDoc.ts <…>/lib/swapDoc.ts <…>/lib/svcDoc.ts` — 우리 사본도 같은 방법으로 `<scratch>/out-ours`.
4. 비교 스크립트는 **따로 폴더** `<scratch>/tools/compare-forms.cjs`(우리가 씀): 두 out 폴더를 인자로 받아 require, **가짜 자료**(OO상사·홍길동·010-0000-0000)로 그려 문자열 비교 → "같음/다름 + 첫 차이 위치"만.  
   실행: `env -i PATH="$PATH" TZ=Asia/Seoul node --permission --allow-fs-read=<out-sales> --allow-fs-read=<out-ours> --allow-fs-read=<tools> <tools>/compare-forms.cjs <out-sales> <out-ours>`(파일 쓰기·자식 프로세스 불가, 환경값 없음, origin `https://example.invalid`).
5. 경우: 납품 일반/현장 · 1/3/8/12/30대 한 품목 · 여러 품목(별지) · 소모품 0/5줄 · 보증금 ''/'20만원' · 계약서메일 ''/메일/'수기' · 제목 칸 있음/없음 · `<script>`·`"`·`&` 든 글자 · withBack 끔/켬 / 교체 고장·일반 / svc 유지보수·소프트웨어(품목 0·1·5줄, 이름 빈 줄). **marks 켬**일 때는 표시 개수 = 대수 합·꼬리 수인지도.
6. 실제 자료는 3차 점검(E31)이 배포된 서버에서 값 없이 같음/다름만.

**영업 새 판을 받는 법(CLAUDE.md 로)**: 커밋 해시 → tree 에서 14개 blob 비교(바뀐 것만) → 렌더러 3개의 import 를 다시 따라가 목록이 늘었는지(서버·DB 코드가 끼면 멈춤) → 통째 교체(영업이 표시를 넣은 뒤면 P 자리 없음, 그 전이면 표시 자리 다시) → 위 1~5 → 배포 → ⋯ "영업 양식 지금 점검" = 같음.

### 3-E. 채울 값 (1차) — `printFill.buildFillPlan` (순수)

공통
- 입력: 상세 데이터(`formDoc`·`renderer`·기기 칸·③), 키(D30), 옵션 `{ withBack, keys, mode: 'fill'|'original' }`, 지금 시각, 찍는 사람.
- 출력: `{ cells: { '<표시>|<item>|<unit>': { text, emph } }, back: { preparer, shipDate }, stamp, svcSheet: 줄 목록 | null, regionFill: string | null, notes, blocked }`.
- `formDoc`·`renderer` 가 없으면 blocked "예전 모양으로 받아 출력 자료가 없어요 — ⋯ → 날짜 골라 다시 가져오기". renderer 와 type 이 어긋나면 renderer 를 믿고 알림.
- 지역: 사본으로 그릴 땐 doc 복사본의 region 이 비면 `regionOf(주소)`(D21). 영업 실시간 HTML 엔 손대지 않음(영업 종이 그대로) — 지역 칸 표시가 생기면 그때.
- 우리 글자는 굵게 8.4pt 이상(7.4pt 미만 금지), 다른 칸 강조 = 굵게+밑줄(흑백 인쇄라 색 안 씀).

**납품(confirm) — 대마다 줄 5칸**

| 품목 종류 | maker | model | asset | sn | spec |
|---|---|---|---|---|---|
| 장비(hasSpec) | ④ 출고 제조사 | ④ 출고 모델명 | ④ 자산번호 | ④ 시리얼 | 고친 칸이 있으면 요청 순서(인치·OS·CPU·RAM·SSD·HDD·그래픽)로 한 줄, 고친 토막만 강조 / 없으면 E15 |
| 모니터·기타 | 같음 | 같음 | 같음 | 같음 | 빈칸 |
| 유지보수 | 빈칸 | 빈칸 | ④ 자산번호 | ④ 시리얼 | 빈칸 |
| 소프트웨어 | ④ 제조사 | ④ 제품명 | 설치 PC | "키 " + 키(찍기로 했을 때) | 빈칸 |
- 영업 줄 수 = `max(1, 수량)`, 우리 칸 = `unitCountFor`(0~50) → 칸 없는 줄은 빈칸.
- 제조사·모델명이 요청과 다르면 그 칸 강조(같음 판정 = `specCompare`, D27 과 같은 기준).
- **E15**: 자산번호나 시리얼이 있는 칸에서 출고 제조사·모델명이 비면 요청 값, 출고 사양이 비면 "요청과 같음". 둘 다 없는 칸은 전부 빈칸.
- 2면(☑ 켰을 때): preparer = 처리자 이름 · 서명, ship-date = 출고 날짜.
- 넘침: 한 품목이 9대를 넘으면 영업 종이도 1면이 넘칠 수 있음(G9) → 우리 스크립트가 넘친 장을 알리면 알림 "n쪽 아래가 넘쳐요 — 인쇄 미리보기에서 확인"(다시 그리는 길 없음). 영업에 알림(§11-6).

**교체(swap, kind 'it') — 교체 후 열(E19)**: `after-sn`·`after-asset` = 칸이 비었으면 ④ 값, 영업 값이 있고 다르면 아래 줄 "출고 ○○" · `after-maker` = 비었으면 ④ 제조사, 다르면 아래 줄 · `after-model` = 영업 값 그대로 + 다르면 아래 줄 · `after-hw` = 영업 값 + 고친 사양 있으면 "출고: …" · `after-sw`·교체 전 = 그대로. 칸 1개(교체 후 한 대).

**유지보수·소프트웨어(svc) — IT 기재 명세 장(E20)**: `body` 끝에 같은 `.page t-svc` 한 장(작은 머리: 로고·"IT 기재 명세 — 유지보수 대상 기기 / 소프트웨어 라이선스"·상호·시작일·번호). 유지보수 = 순·품목·자산번호·S/N, 소프트웨어 = 순·제품·설치 PC·사용자·라이선스 키. 품목 줄 = `doc.items` 중 이름 있는 줄(영업 종이 순서), 수량만큼 줄, 안 채운 줄은 빈 줄. 한 장 28줄, 넘으면 다음 장(머리줄 반복). 꼬리 "1면 품목의 별첨 · IT 기재".

**알림(막지 않음)**: 그린 양식(실시간/받아 둔 것 + 이유) · 자산번호 빈 기기 n대 · 영업 수정됨 미확인 · 다시 확인 필요 n칸 · 지역 추정 · 출력 뒤 바뀜 · 빠진 칸은 안 나감 · 키 없이/키 없는 칸 · 넘침 · 못 넣은 값 · (2차) 지운 확인서 · (3차) 받아 둔 양식이 오래됨. **없앰**: "영업이 안 보내 주는 칸"·"명세 참조로 돌림".

**출력 창**: 옵션 `2면(출고·설치) 포함` ☐(기본 끔, 브라우저에 기억) · 키 고르기(D30) · 모드 칩 `[IT 기재 넣음] [영업 원본 그대로]`. "출고 명세 자동·항상" 없앰. [인쇄] = 지금처럼 iframe 에 인쇄 신호 + `markSalesConfirmPrinted`(원본 모드는 기록 안 함).

### 3-A. normalize·importer

**normalize 새 칸(1차 — 순수, import 없음 그대로)**

| 칸 | 읽는 법 |
|---|---|
| `renderer` | 'confirm'|'swap'|'svc' 일 때만, 아니면 null |
| `formDoc` | `doc` 이 객체면 얕은 복사, **svc 면 `items[].cost` 뺀 사본**, 아니면 null |
| `salesStatus` | `status === 'deleted'` → 'deleted', 아니면 'active' |
| `savedAt`·`createdAt`·`deletedAt` | 시간대 없는 `YYYY-MM-DD HH:mm(:ss)` → **한국 시각** ISO. 시간대가 붙어 있으면 그대로 |
| `deletedBy`·`createdBy` | 글자(영업 직원 이름) |
| `salesDeleted` | salesStatus 'deleted' **이고** savedAt ≤ deletedAt(둘 중 하나 모르면 지움으로) |
| svc `items` | renderer 'svc' 이고 `doc.items` 배열이면: 이름 빈 줄 빼고 `{cat: type, model: 이름, qty: 숫자만(svcQty 규칙)}` |
| `print` | 그대로 둠(출력은 안 씀 — 다음 정리 때) |

**칸 이름·종류 대조(우리 `print` ↔ 영업 ConfDoc)** — 출력은 이제 doc 을 직접 쓰므로 참고용

| 칸 | 영업 | 우리 | 판정 |
|---|---|---|---|
| kind · payNote · extra · industry · statusNo · fax · taxMail · contractMail | 글자 | 글자 | 맞음 |
| months | 글자(적은 그대로) | 글자 | 맞음 |
| deposit | 글자('20만원' 가능) | 글자 | 맞음(옛 사본 `num` 은 '20만원'→20 — 새 사본 필요) |
| orderDate | 'YYYY-MM-DD'(없으면 오늘 — G16) | 날짜 | 맞음 |
| items[].rent | 숫자(**줄 합계**, VAT 별도) | 숫자 | 맞음 |
| supplies[].price | 글자 | 글자 | 맞음 |
| supplies[].qty | **글자**('1박스') | 숫자로 바꿈 | 다름 — doc 직접 쓰면 해결 |
| title·head·consign·shipType·route·consultNo·quoteId·hanjo·installCount | 글자 | 없음 | 제목 줄이 달라짐 — doc 직접 쓰면 해결 |
| 빈 값 | 늘 ''(fullConf) | null=안 옴 / ''=비움 | null 은 이제 안 생김 → **P2 필요 없음** |
교체·svc: 정규화로는 G5·G6 대로 읽힘(교체 사양은 `specExtra` '사양'·'소프트웨어'). 상세 연락처 이름표만 교체면 `현장상주` → `교체 요청자`, 계약담당이 결제담당과 같으면 숨김(ui).

**hash 그대로**: 같은 판인데 hash 다름 = ① 다시 씀 + ② 한 줄 — 지움·되살림·export 모양 변화가 이 길(필요). "영업에서 수정됨"은 판↑ 만(팀장 39ef7c8). 날마다 바뀌는 칸(G16) 감시 = ⑤ `last_counts.sameVer`.

**크기**: 한 줄 ≈ 맨 위 칸 + doc → 약 두 배(짐작 4~8KB/건, 긴 jsonb 는 압축). E2 뒤 평소 응답은 수십 KB, 하루 첫 90일만 1~2MB(15초 제한 안). 목록·홈은 payload 를 안 읽음. 원문 싣는 insert/upsert 묶음만 200 → 50(2차).

**importer**
- (1차) since: `autoDeep` 이면 90일, 아니면 **어제**(지금 30일). 한 건 경로 `runSalesConfirmImport({ id })`: ⑤ 'one' 3초 잡기 → `fetchSalesConfirmOne(id, type)` → 같은 분류·쓰기. 결과 `{ changed, ver, salesState, notFound }`.
- (2차) `sales_state: n.salesDeleted ? '지움' : ''` · `first_saved_at = createdAt ?? savedAt`(새 건·바뀐 건 모두 — 처음 저장 시각은 안 바뀜) · **칸 다시 맞추기(E29)**: 90일 때만 5단계 읽기에 `first_saved_at, saved_at, sales_state, type, items` 를 더 읽어 다르면 그 칸만(시각은 ms, items 는 정렬 JSON 비교) · `missing`(받은 기간 안·지움 아님·이번에 없음 — 건수만) · `sameVer`·`bytes`·`ms` · 묶음 50.
- 가져오기 코드는 여전히 ③④·계약관리를 import 안 함.

### 3-C. "영업 원본 보기" (1차) — 가 vs 나

| | (가) 저장된 doc → 사본(fill 없음) | (나) 서버가 html=1 받아 보여 주기 |
|---|---|---|
| 영업 최신 양식 | 사본 판 | **늘 최신** |
| 영업이 멈추면 | 됨 | 안 됨 |
| 추가 코드 | 없음 | 중계 라우트(E8 — 출력에 어차피 필요) |
**추천 = (나) 먼저, 안 되면 (가)**(E22). 처음 생각은 (가)였으나 양식 실시간(E4)을 위해 중계 라우트를 어차피 만들고, 원본 보기는 채우기가 없어 표시 없이도 바로 실시간이 됨. 중계는 JSON 으로만 내보내고(E8) 화면은 sandbox iframe. 상세 위 `영업 원본 보기`(링크 대신)·"영업에서 수정됨" 띠의 같은 버튼 → 출력 창 원본 모드. 창 위 "영업 최신 양식 / 받아 둔 양식(11-27판) — 이유".

### 3-B. 영업에서 지운 확인서 (2차)

| 상황 | 우리 쪽 |
|---|---|
| 지움이 옴 | ① `sales_state='지움'`(같은 판·hash 다름 → 다시 씀). ③④·처리여부 그대로 |
| 처음 받는 건이 이미 지움 | 그대로 넣음 — "새로" 없음, IT가 손댄 적 없으니 기본 목록에 안 보임 |
| 다시 살아남 | svc 등: 새 판으로 옴 → `''` + "영업에서 수정됨" / 납품·교체: export 가 계속 deleted(G4) → **savedAt > deletedAt 이면 살아 있음**(E26). 단 지운 날 뒤로 받는 기간이 지나면 아예 안 옴 → 영업에 고쳐 달라고(§11-6) |
| 받는 기간 밖 | 더 안 옴 → ① 은 '지움' 그대로(맞는 값). ⋯ 날짜 골라(365일)로 언제든 다시 확인 |
| 지움 표시 없이 목록에서 사라짐 | 아무것도 안 함, ⑤ `missing` 건수만 |
- 목록(E27): 기본 = 지운 건 숨김, 단 ③ 처리여부가 준비중·준비완료·출고·보류면 남기고 빨간 `영업에서 지움`. 칩 `영업에서 지움 n`. "전체"는 포함. 끝난 건이어도 "영업에서 수정됨"이면 보임(E28). 판정 = 팀장이 types.ts 에 순수 함수 `isHiddenByDefault(row, today)`.
- 상세: 빨간 띠 "영업에서 이 확인서를 지웠어요(11/27 14:20 · 지운 사람 OOO) — 출고를 멈출지 영업에 확인하세요" + `[처리여부를 '취소'로]`(기존 `saveSalesWork`, 동시 수정 검사 그대로). 입력·저장은 됨.
- 출력: 빨간 알림 + `☐ 영업에서 지운 걸 알고 뽑아요` 체크해야 [인쇄].
- 홈: select 에 `sales_state` → 새로·준비 안 끝남·수정됨에서 빼고, "영업에서 지웠는데 IT가 준비 중 n건"(준비중·준비완료·보류)을 맨 앞 빨강.

### 3-F. 점검 (3차 — E31)
- 목록을 열 때 `POST /api/sales-confirms/form-check`(기다리지 않음). ⑤ 'form' 줄을 한국 날짜로 하루 한 번 잡음(강제 = ⋯ "영업 양식 지금 점검", 10분).
- 종류(confirm·swap·svc)마다 `sales_state=''` 이고 `payload->>renderer` 가 그 값인 가장 최근 1건: 한 건 JSON 의 doc 으로 사본(marks 없음, 납품 withBack=false, origin = export 주소의 origin)을 그려 같은 순간 받은 html=1 과 sha256 비교 + `data-it-spec` 유무. 호출마다 6초.
- 기록(⑤ 'form'): `last_attempt_at`·`last_success_at`·`last_error_code`('form_diff'|'form_error'|null)·`last_error`(쉬운 말)·`last_counts {confirm:'same'|'diff'|'error'|'none', swap, svc, marks:{confirm:true…}, diffAt, ours:'b33a4c3'}`. **HTML·doc·id·연락처는 어디에도 안 남김**(로그도 종류·같음/다름·위치·HTTP 숫자만).
- 화면: 사본이 'diff' → 목록 띠 아래·출력 창에 주황 "대신 그리기용 양식이 영업 최신과 달라요 — 영업 웹앱이 멈추면 옛 양식으로 나가요. 개발 담당에게 '영업 새 커밋 받기'". 실시간 양식을 쓰는 동안 출력은 영향 없음.
- 비용: 하루 최대 6번.

---

## 4. 화면 흐름

**PC — 출력(1차)**
1. 목록(1분마다 영업 변경 반영) → 상호 → 상세. 교체 건은 기기 칸 머리 "교체 후 기기", 교체 전은 회색 보기 상자.
2. 기기 칸 입력(지금 그대로 — 다르면 D27 확인 창). 열어 둔 동안 영업이 고치면 1분 안에 "영업에서 수정됨" 띠(입력 중이면 [새로 보기]).
3. `🖨 확인서 출력` → 한 건 다시 받기 → 영업 양식(가능하면 그 순간 최신)으로, 오른쪽 출고 칸에 IT 값. 교체 = 교체 후 열, 유지보수·소프트웨어 = 뒤에 IT 기재 명세 장. 위에 "영업 최신 양식 / 받아 둔 양식 — 이유".
4. 키가 있으면 D30 고르기 → `2면 포함`은 필요할 때만 → [인쇄].
5. `[영업 원본 그대로]` 또는 상세 위 `영업 원본 보기` → IT 값 없는 영업 종이.

**지운 확인서(2차)**: 홈 빨강 "지웠는데 준비 중 1건" → 목록 빨간 `영업에서 지움` → 상세 띠 → 영업에 확인 → `[처리여부를 '취소'로]`.

**핸드폰**: 목록·상세(1분 동기화 포함)·입력·지움 띠 그대로, 출력 대신 "출력은 PC에서", 원본 보기는 축소 보기만.

---

## 5. 작업 분해 — 파일 겹침 없이

### 지금(팀장 — 작은 일) → qa-checker → deploy-check
- `lib/salesConfirms/printFill.ts` 410행: `/교체|유지보수/` → **'납품'이 아니면(빈 값 제외) 막음**, 문구에 '소프트웨어'.

### 1차 — 팀장 사전 작업
- `lib/salesConfirms/types.ts`: `NormalizedSalesConfirm` 새 칸(E25) · `SalesFillPlan`(§3-E 출력 모양) · `SalesPrintOptions = { withBack, keys, mode }` · `SalesImportRouteResult` 에 `changed`·`ver`·`salesState`·`notFound`(한 건)·`deep` · `SalesImportTrigger` 에 'detail'·'print' · 중계 응답 `SalesFormHtmlResult` · (2차) `SALES_STATE_DELETED='지움'`·`isHiddenByDefault` · (3차) `FormCheckState`·`formCheckFromRow` · `SalesImportCounts` 선택 칸(`repaired`·`sameVer`·`missing`·`bytes`·`ms`).
- 표시 이름(§3-H 표)을 `itFill.ts` 상수로 확정해 D·ui 에 알림. 영업 요청 글(§11) 전달.
- 환경값 이름: `SALES_FORM_SOURCE`(선택, 'copy' 면 늘 사본) — `.env.local.example` 에 이름만.

| 누가 | 할 일 | 파일 |
|---|---|---|
| **developer D** (opus 권함) | 사본 14개 + P 자리(표시만) · `itFill.ts`(표시 상수·`applyFillPlan` DOM·FILL_CSS·우리 스크립트·IT 기재 명세 장·꼬리·못 넣은 값 세기·body 표시 검사) · `printFill.ts`(`buildFillPlan` 순수 + `renderCopy(doc, renderer, origin, withBack, marks)`) · E15 규칙은 상수 하나로 | 새: `lib/salesConfirms/salesForm/{confTitle,statusRow,swap,pull,move,sale,svc,furn,kakaoParse,inkjet,swapDoc,svcDoc,itFill}.ts` / 통째 교체: `salesForm/confirm.ts`·`confirmDoc.ts` / 다시 씀: `lib/salesConfirms/printFill.ts` |
| **developer A** | normalize 새 칸 전부 · importer since 짧게·한 건 경로·⑤ 'one' 3초 · source 한 건 JSON·HTML 받기(헤더 키, 4초, 2MB) · import 라우트 `{id}` · 중계 라우트(JSON·⑤ 'html' 2초·`SALES_FORM_SOURCE`) | `lib/salesConfirms/normalize.ts` · `importer.ts` · `source.ts` · `app/api/sales-confirms/import/route.ts` · 새 `app/api/sales-confirms/form-html/route.ts` |
| **developer B** | 상세 데이터에 `formDoc`·`renderer`, 교체 연락처 이름표용 값, `openSalesConfirm` 을 다시 부를 때 ③ 을 불필요하게 안 바꾸는지 확인(처음 열람만) | `lib/salesConfirms/work.ts` · (필요하면) `app/confirm-form/salesDetailActions.ts` |
| **ui-designer** | 출력 창: 열 때 한 건 받기 → 중계 HTML → DOMParser → 표시 검사 → `applyFillPlan` / 사본 대신 그리기·이유 한 줄·못 넣은 값 고르기·원본 모드 칩·2면 기본 끔·명세 옵션 없앰·`await import()` · 상세: 열 때·60초·탭 복귀 한 건 받기, 입력 중 보호 띠, `영업 원본 보기`, 교체·유지보수 막음 문구 없앰, 교체 칸 머리·연락처 이름표 · 수정됨 띠의 원본 보기 · 목록 간격 60초 | `components/salesConfirms/SalesPrintDialog.tsx` · `SalesConfirmDetail.tsx` · `SalesChangeBanner.tsx` · `DeviceSlotCard.tsx` · `SalesConfirmListPage.tsx`(간격 상수만) · `app/globals.css`(필요하면 끝에) |
| **qa-checker** | §7 1차 | — |
| 팀장 | 설명서·releases·CLAUDE.md(§8), 배포 뒤 실제 납품·교체·유지보수 1건씩 미리보기(값 출력 금지), Vercel 사용량 한 번 | `lib/manual/docs/shipping.ts` · `lib/releases.ts` · `CLAUDE.md` |
순서: D 가 사본 14개를 먼저(10분 일) → 나머지 동시. A·B·ui 는 types.ts·표시 상수만 보고 시작.

### 영업이 표시를 붙였다고 알려 오면(배포 없음)
- 팀장: 그 확인서 한 건으로 출력 창 → "영업 최신 양식으로 그렸어요"·못 넣은 값 0·칸 자리 눈으로. 문제면 `SALES_FORM_SOURCE=copy` 로 끄고 고침. 이어서 사본도 영업 새 커밋으로 바꾸고 P 자리 없앰(developer D, 작게).

### 2차
| 누가 | 할 일 | 파일 |
|---|---|---|
| developer A | importer: sales_state·first_saved_at·칸 다시 맞추기·missing·sameVer·bytes·ms·묶음 50 | `lib/salesConfirms/importer.ts` |
| developer B | 목록 줄 지움·IT 손댐, 홈 카드, 상세 지움 정보 | `lib/salesConfirms/listQuery.ts` · `lib/homeDashboard.ts` · `lib/salesConfirms/work.ts` |
| ui-designer | 목록 칩·숨김·새로 빼기, 상세 지움 띠·[취소로], 출력 창 체크 | `SalesConfirmListPage.tsx` · `SalesConfirmTable.tsx` · `SalesConfirmDetail.tsx` · `SalesPrintDialog.tsx` |
| 팀장 | types.ts `isHiddenByDefault`, 설명서 꼭지 | |

### 3차
| 누가 | 할 일 | 파일 |
|---|---|---|
| developer A | 점검·기록·라우트 | 새 `lib/salesConfirms/formCheck.ts`(server-only — ①⑤·salesForm 만 import) · 새 `app/api/sales-confirms/form-check/route.ts` |
| developer B | ⑤ 'form' 읽어 목록·상세 데이터에 | `listQuery.ts` · `work.ts` |
| ui-designer | 목록 열 때 부르기, 띠, ⋯ "영업 양식 지금 점검" | `SalesConfirmListPage.tsx` · `ImportStatusBar.tsx` · `SalesPrintDialog.tsx` |
| 팀장 | types.ts `formCheckFromRow`, `sales_confirms_schema.sql` 머리 **주석만**(⑤ 'one'·'html'·'form' 줄 설명 — 실행할 것 없음) | |

### (선택) 영업이 "바뀜" 신호를 보내 주면
- developer A: 새 `app/api/sales-confirms/notify/route.ts` — 헤더 `x-notify-key` = 환경값 `SALES_NOTIFY_KEY`(새로 만들어 영업과 나눔, 시간 비교는 상수 시간), 본문 `{type, id, ver, status}` 검사 → 한 건 받기(⑤ 'one') → 204. 원문·키 로그 없음. 화면은 그대로 1분 동기화(신호는 DB 를 먼저 맞춰 둘 뿐).

**안 부름**: integration-rules(외부 쓰기 없음), db-schema·sql-review(SQL 없음).

---

## 6. SQL

**없음.** 지움 = 기존 `sales_state`, 간격·점검 = ⑤ 표의 줄 'one'·'html'·'form'(id 에 CHECK 없음, 읽는 곳은 모두 'main' 만), 칸 다시 맞추기 = 코드. 사용자가 실행하려는 2+3단계 블록 A·B 는 그대로 실행(이 문서와 무관). `sales_confirms_schema.sql` 은 머리 주석만(다시 실행할 필요 없음).

---

## 7. QA 목록

**지금(hotfix)**: type '소프트웨어'·'교체'·'유지보수' → blocked, '납품' → 그대로.

**1차**
- 타입·빌드(prebuild 포함), 사본 14개 lint·타입 통과.
- **사본 정확**: §3-D 1~5(blob sha 14개 · grep 0 · transpile 만 · 권한 막은 Node · marks 없이 전부 "같음", marks 켜면 표시 수 = 대수 합·꼬리 수). 우리 사본과 원본 diff 가 표시 자리뿐.
- Node(순수): normalize — `'2026-11-27 09:10'` → `2026-11-27T00:10:00.000Z` 를 `TZ=UTC`·`TZ=Asia/Seoul` 둘 다 · svc 이름 빈 줄 빠짐·'3대'→3 · formDoc 에 cost 없음 · renderer 이상 → null · 옛 원문 → renderer null · salesDeleted · importer since(그날 첫 번 90·그 뒤 어제·날짜 고름 그대로).
- Node(buildFillPlan): 납품 1/3/8/12/30대 · 종류 섞임 · 칸 < 줄 · E15 · 다른 칸 강조 / 같음(16GB=16G) 강조 없음 · 키 찍음/빈칸 · 2면 · 교체(영업 sn·asset 빈칸/있음·다름, 모델 다름, 사양) · svc 유지보수 5대·소프트웨어 3칸 키 · doc 없음 → blocked · renderer·type 어긋남.
- **브라우저(배포 화면 Playwright 또는 로컬)**: `applyFillPlan` — 사본(marks)에 값이 표시 칸에만 들어가는지, `<script>`·`"`·`&`·`<img onerror>` 가 글자로만, 못 넣은 값 셈, 표시 없는 HTML → 사본으로, 모르는 `data-it-spec` → 사본으로, `data-it-ver` 다름 → 다시 받기 뒤 사본.
- **중계 라우트**: 응답 content-type 이 JSON(절대 text/html 아님), 키가 주소에 없음(grep `key=`), ① 에 없는 id → 거절, 2초 간격, 4초 넘으면 `unreachable`, 로그엔 HTTP 숫자만.
- **내용 동기화**: 상세 열면 한 건 받기 1번·60초마다(숨긴 탭에선 안 함)·출력 창 열 때 · 입력 중 바뀜 → 값 안 날아감·[새로 보기] · 404 → 회색 한 줄·쓰기 없음 · 목록 60초 · ⑤ 'one' 3초. 실제 확인은 영업이 다음에 고칠 때(또는 영업에 "OO상사 테스트" 건 부탁).
- **실제 인쇄 미리보기(PC Chrome·Edge)**: 납품 일반/현장(색·유의사항·소모품) 3대·9대 넘는 한 품목(넘침 알림)·여러 품목(별지) · 교체 고장/AS·일반 · 유지보수·소프트웨어(+명세 장) — **확인란·서명 칸이 안 잘리는지 눈으로**, Pretendard·영업 로고가 iframe 에서 받아지는지, `allow-same-origin` 없음.
- 원본 모드 = 실시간(안 되면 사본)·IT 값 없음·출력 기록 안 남김. 키 잠김 → 고르기 전 [인쇄] 꺼짐(D30 회귀).
- 상세 첫 화면 JS(빌드 출력 `/confirm-form/[id]` First Load)가 크게 안 늚.
- 개인정보: 상세 데이터에 `cost` 없음, 로그에 payload·doc·html 없음(grep `console.*(payload|doc|html)`).
- 회귀: 목록·상세 입력·차이 확인·라이선스 키·계약관리·`?view=legacy` 인쇄·홈 카드.

**2차**: 강제 가져오기 2번 — 1번째 ⑤ `repaired` = 어긋난 줄 수(숫자만), 2번째 0 · 목록 접수일시 = 영업 화면 시각(한 건 눈으로) · `isHiddenByDefault` 경우(지움+접수 숨김 / 지움+준비중 빨강 / 지움+취소 숨김 / 끝난 건+수정됨 보임) · 홈 숫자 · 실제 지움(가능하면 영업 테스트 건) · importer 가 ③④·계약관리를 import 안 함 · 묶음 50.

**3차**: 비교 순수 부분(같음/한 글자 다름+위치/실패) · ⋯ "영업 양식 지금 점검" → 같음 또는 비교할 건 없음 · 하루 두 번째는 건너뜀 · ⑤ 'form' 에 값 없음 · 'main' 을 읽는 4곳 그대로.

---

## 8. 설명서 · releases · CLAUDE.md

- **설명서** `lib/manual/docs/shipping.ts` `confirm-form`(updated): 출력 꼭지 새로(영업 양식 그대로 — 왼쪽 요청·오른쪽 출고 칸, 비워 둔 칸 = "요청과 같음", 교체 = 교체 후 열, 유지보수·소프트웨어 = IT 기재 명세 장, 2면은 필요할 때 ☑, 위의 "영업 최신 양식/받아 둔 양식" 뜻) · 영업 원본 보기 · 영업 변경이 1분 안에 들어옴(입력 중이면 [새로 보기]) · (2차) 지운 확인서 · (3차) 점검 띠. 옛 꼭지 id 는 안 바꿈. 예시는 OO상사·홍길동.
- **releases**: 1차 "확인서 출력이 영업 웹앱 종이와 똑같아졌어요(제목 줄·색·임대료). 오른쪽 '출고시 기재' 칸에 IT 값. 교체·유지보수·소프트웨어도 뽑혀요. 영업이 고치면 열어 둔 화면에도 1분 안에. 영업 원본 보기. 접수일시가 9시간 늦게 보이던 것 고침" / (영업 표시 뒤) "영업이 종이 모양을 바꾸면 우리 출력도 바로 같은 모양" / 2차 "영업에서 지운 확인서 표시" / 3차.
- **CLAUDE.md** "영업 확인서 가져오기" 절: b33a4c3 export 칸, since = 저장·지운 날짜(그날 첫 번 90일·그 뒤 어제), 상세 한 건 받기(60초·출력 때)·⑤ 'one'·'html'·'form' 줄, 시각은 시간대 없는 한국 시각, `sales_state='지움'` 규칙, 칸 다시 맞추기, svc cost 는 브라우저로 안 보냄. "2+3단계" 절: **양식 = 영업 실시간 HTML + IT 칸 표시(data-it, 표 §3-H) → 브라우저 DOMParser 로 값만, 정규식 금지, 중계는 JSON 으로만**, 대신 그리기 사본 = 14개 파일·커밋·P 자리(표시만), `SALES_FORM_SOURCE=copy` 끄는 스위치, 새 판 받는 법, 옛 P1·P2·P3(납품)·D22 폐기.

---

## 9. 위험 · 열린 질문

### 사용자에게 물을 것 (1개)
**Q1. 영업 웹앱의 철수·이전·판매 확인서도 IT가 처리하나요?** (지금 영업은 납품·교체·유지보수·소프트웨어만 보내요)
- **추천: 판매(노트북·소프트웨어를 파는 납품)는 IT가 출고 준비를 하니 보내 달라고 해요. 철수(기기 회수)·이전(옮겨 설치)은 IT가 실제로 나가는 일이면 같이요. 가구는 안 받아요.** 받게 되면 처음엔 목록·영업 양식 그대로 출력까지, 기기 칸은 그다음.
- 답이 오기 전엔 지금 범위(납품·교체·유지보수·소프트웨어)로 진행.

### 추천안으로 정하고 진행하는 것 (사용자가 아니라고 하면 바꿈)
- 오른쪽 출고 칸을 IT가 안 고친 기기 = 제조사·모델명은 요청 값, 출고 사양은 "요청과 같음"(자산번호·시리얼도 없으면 빈칸)(E15).
- 2면(출고·설치)은 기본으로 안 붙임 — 필요할 때 ☑(E18). 금액은 영업 종이처럼 그대로(E23). 교체 전 기기 IT 입력 칸은 이번엔 안 만듦(E19).
- 영업에서 지운 확인서: 목록에서 숨기되 IT가 준비 중이던 건은 빨갛게 남기고 홈에도 알림, 처리여부는 자동으로 안 바꿈(E27).

### 참고로 알려 드릴 것
- 출력이 영업 웹앱 종이와 똑같아짐(제목 줄·색·임대료·현장 유의사항). 왼쪽 영업 요청, 오른쪽 '출고시 기재' 칸에 IT 값 — 요청과 다른 칸은 굵게 밑줄.
- 영업이 확인서를 고치면 열어 둔 화면에도 1분 안에 들어옴(적던 값은 안 날아감). 출력 창을 열 때도 한 번 더 확인.
- 영업이 종이 모양을 바꾸는 것까지 바로 따라가려면 영업 쪽에 작은 표시를 붙여 달라고 요청함 — 붙이기 전엔 오늘 받은 영업 양식으로 뽑힘(오늘 기준으론 똑같음).
- 교체·유지보수·소프트웨어 확인서도 뽑힘. 접수일시가 9시간 늦게 보이던 것 고침.

### 위험 (개발·QA)
- **영업 HTML 을 우리 화면에 띄움** — DOMParser(스크립트 안 돎) → sandbox iframe(같은 출처 권한 없음)만. 중계는 JSON 으로만(우리 주소에서 영업 HTML 이 페이지로 열리면 안 됨). 값은 `textContent`·요소 만들기로만.
- **표시 약속이 깨짐**(영업이 칸을 옮기거나 지움) — body `data-it-spec` 판 + 못 넣은 값 세기 → 사본으로 대신·사람이 고름. 조용히 빠진 종이가 안 나가게.
- **영업 남의 코드를 우리 앱에서 돌림(사본)** — 14개는 순수 함수(G11)지만 새 판마다 grep·import 추적 다시. 표시가 생기면 사본은 대신 그리기용으로만.
- **영업 쪽 부담** — 1분 간격은 '어제부터'라 가볍지만, 영업 `deletedRecs` 가 지운 건을 전부 읽음(G18) → 요청 글에 날짜로 걸러 읽기. 영업이 부담을 말하면 목록만 2분.
- **입력 중 덮어쓰기** — 바뀌어도 입력 중이면 자동으로 다시 읽지 않음([새로 보기]). 저장 때 D27 서버 검사가 새 판 기준으로 다시 물음.
- **1면 넘침** — 영업 종이도 같음(§11-6). 알림만, 인쇄 미리보기 확인을 설명서에.
- **E15 "요청과 같음"이 사실과 다를 수 있음** — D27 확인 창이 막지만 IT가 사양을 안 봤을 수 있음. 설명서에 "사양이 다르면 꼭 적기".
- **svc 매입가** — formDoc 에서 빼서 브라우저로 안 감. ①② 원문엔 남음(서버 전용).
- **날마다 hash 가 바뀌는 건**(G16) — `sameVer` 감시.
- **'지움' 판단** — 같은 분에 지우고 다시 저장하면 지움으로 봄(보수적). 영업이 §11-6 을 고치면 없어짐.
- **옛 유지보수 2건**: b33a4c3 전에 받은 건이 이제 다른 모양·id 로 오면 옛 줄은 갱신 안 되고 출력은 "다시 가져오기"로 막힘 → 1차 배포 뒤 팀장이 ① 중 `payload->>renderer` 가 없는 줄 **건수만** 확인.
- **글꼴·로고** — Pretendard(CDN)·영업 로고(영업 주소)를 iframe 이 받아 옴. 막히면 맑은 고딕(영업 종이도 같음)·로고 빠짐 → 사본으로 그릴 땐 우리 로고.
- **누구나 라우트를 부름(로그인 없음)** — 목록 60초·한 건 3초·중계 2초·점검 하루 1번 간격. 응답에 원문은 중계(영업 HTML)뿐 — 상세 화면과 같은 수준(D7).

---

## 10. 하지 않을 것 (범위 밖)
- 영업 쪽에 쓰기·IT 값을 영업에 보내기((다) 포함), 영업 Supabase 연결, 개발 중 영업 export 직접 부르기(배포된 우리 라우트로만), **키를 주소에 붙이기**.
- 영업 양식 바꾸기(표시 속성 요청 밖), 촘촘한 모양을 우리가 켜기, 1면 넘침을 우리가 다시 배치.
- 소프트웨어 체크 줄(WIN·오피스·한글) 앱 체크, 교체 전 기기 IT 칸, 교체 '기종'·'소프트웨어' 입력.
- 철수·이전·판매·가구 받기(Q1 뒤 따로).
- 옛 판(②) 골라 원본 보기, 지운 건 ③ 자동 '취소', 목록에서 사라진 건 자동 표시.
- 새 SQL, ① 칸 추가, Supabase Realtime·웹소켓(우리 표는 RLS 정책 없음 — 브라우저가 직접 못 들음).
- 출고 준비 리스트와 합치기(4단계), 개인정보 잠금(D7).

---

## 11. 영업 웹앱 개발자에게 보낼 요청 글 (그대로 붙여 넣기용 — 팀장이 `<IT ERP 주소>` 만 채움)

```
[IT ERP 연동 요청] 확인서 HTML 에 'IT 칸 표시' 속성 추가 (+ 작은 수정)

배경
- IT ERP 는 GET /api/export/it-confirms?id=…&type=…&html=1 (헤더 x-export-key) 로 받은
  확인서 HTML 을 그대로 출력하고, IT 가 적는 빈칸에만 값을 넣으려 합니다(양식이 바뀌어도 바로 따라가게).
- 칸 위치를 HTML 구조로 추측하면 양식을 고칠 때 깨지므로, IT 칸에 아래 data 속성만 붙여 주세요.
  화면·인쇄 모양은 안 바뀝니다(속성만). IT 값은 영업 쪽으로 보내지 않습니다.

1. 문서 표시 — renderConfirm · renderSwap · renderSvc 의 <body> 에
   data-it-spec="1"  data-it-form="confirm|swap|svc"  data-it-ver="${d.ver}"  data-it-id="${d.id}"
   (data-it-spec = 이 표시 규칙의 판. 아래 이름·자리를 바꾸거나 빼면 2, 3 … 으로 올려 주세요.)

2. 납품 — lib/confirmDoc.ts itemRows (IT 갈래)
   - 대마다 줄(tr.iu)의 오른쪽 빈칸 <td> 5개에 차례로
       data-it="maker" / "model" / "asset" / "sn" / "spec"
     다섯 칸 모두 data-it-item="${n}"  (왼쪽 td.n 에 찍히는 품목 번호 — 별지까지 이어지는 번호)
                 data-it-unit="${u + 1}" (그 품목의 몇 번째 대, 1부터)
   - 촘촘한 모양(compact)을 쓰게 되면: .cm 의 span 3개에 data-it="maker|model|spec" + data-it-item,
     .uc 의 span 2개에 data-it="asset|sn" + data-it-item + data-it-unit
   - 소프트웨어 체크 줄 td.swr 에 data-it="sw" data-it-item="${n}"  (지금은 IT 가 안 채움 — 자리만)
   - 2면(page2): '출고 준비자' 값 칸 <td> 에 data-it="preparer", '출고일' 값 칸에 data-it="ship-date"
   - 모든 .foot 의 첫 <span> 안 맨 끝에 빈 <span data-it="stamp"></span>  (1면·별지·2면)

3. 교체 — lib/swapDoc.ts renderSwap (it 갈래일 때만)
   - 교체 후 칸 <td class="af…"> 에: 모델명·상태 data-it="after-model", 제조사·기종 "after-maker",
     기번(S/N) "after-sn", 자산번호 "after-asset", 하드웨어 "after-hw", 소프트웨어 "after-sw"
   - 교체 전 칸 <td class="bf"> 의 기번·자산번호에 data-it="before-sn" / "before-asset"  (자리만)
   - foot 첫 span 끝에 stamp span (2번과 같음)

4. 유지보수·소프트웨어 — lib/svcDoc.ts renderSvc
   - 품목 표의 각 <tr> 에 data-it-item="${k + 1}", foot 에 stamp span
   (IT 는 기기별 자산번호·라이선스 키 명세를 별도 장으로 뒤에 붙입니다 — 영업 양식엔 손대지 않음)

5. 지킬 것
   - 표시가 붙은 칸은 지금처럼 비워 두거나 영업 값만. 값은 지금처럼 esc().
   - 속성 이름·뜻을 바꾸거나 칸을 빼면 data-it-spec 을 올려 주세요
     (IT 는 모르는 판이면 받아 둔 사본 양식으로 대신 출력합니다).

6. 같이 고쳐 주시면 좋은 것
   - (버그) 납품·교체 저장(app/api/confirm/route.ts · app/api/swap/route.ts POST)이 지운 확인서를 다시 저장해도
     rec.deleted 를 지우지 않음 → 영업 화면엔 다시 보이는데 export 는 계속 status 'deleted'.
     lib/docStore.ts docRoutes 처럼 저장 때 delete rec.deleted.
   - (부담) export 목록이 부를 때마다 deletedRecs 로 지운 확인서를 전부(모든 판째) 읽습니다.
     IT 가 1분마다 짧은 기간(since=어제)으로 부르게 바꾸므로, 가능하면 지운 시각(data->deleted->>at)으로
     거른 것만 읽어 주세요.
   - (확인) IT 한 품목이 9대쯤 넘으면 1면이 넘칠 수 있어요 — itCompact 가 있는데 itemTable 호출에
     compact 가 안 넘어갑니다. 의도인지요.
   - export items[].qty (유지보수·소프트웨어)가 Number(qty) 라 '3대' 면 0 — svcQty 로.
   - (확인) export 시각(savedAt·createdAt·deletedAt)은 시간대 없는 한국 시각 'YYYY-MM-DD HH:mm' 이 맞는지
     (IT 는 그렇게 읽습니다).

7. (선택 — 해 주시면 '실시간'이 1분 → 몇 초) 저장·지움 때 IT ERP 에 신호
   POST <IT ERP 주소>/api/sales-confirms/notify
   헤더 x-notify-key: <양쪽 환경값에 같은 값 — IT 가 만들어 따로 전달>
   본문 { "type": "납품|교체|유지보수|소프트웨어", "id": "…", "ver": n, "status": "active|deleted" }  (고객 값 없음)
   1초 시간 제한, 실패해도 저장은 그대로(기다리지 말고 after/waitUntil). IT 는 신호를 받으면 export 로 그 한 건을 받아 갑니다.

8. 다 되면 커밋 해시를 알려 주세요(GitHub main 에도 푸시).
   확인 방법: ?id=…&type=납품&html=1 응답의 <body> 에 data-it-spec="1" 이 있고,
   data-it="maker" 가 그 확인서 대수 합만큼 있는지.
```
