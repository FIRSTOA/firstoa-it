[기획실 도면우]

# 영업 확인서 ↔ 출고 준비 리스트 함께 쓰기 — 4단계 설계안 (2026-11-27)

앞 설계 `docs/tasks/2026-11-26-sales-confirm-import.md`(D1~D30)·`docs/tasks/2026-11-27-sales-export-b33a4c3.md`(E1~E32)를 잇는다.
**이 문서의 F 결정이 D8("1~3단계는 출고 준비 쪽에 안 씀")을 대신한다.** 나머지 D·E 결정은 그대로.

사용자 말(요지): "확인서/출고및반출준비가 영업 확인서 목록으로 바뀌는 거고, **나아가서는 출고준비리스트와 함께 운영**하는 거야." → 지금 4단계 진행.

사용자 추가 요구(같은 날, 팀장 전달): "확인서 화면에도 출고 준비 리스트처럼 **그날 준비해야 하는 것**(오늘 11/27 금 → **11/30(월)** 출고분)이 보여야 해. 그리고 납품엔 **직송**(우리를 안 거치고 매입처에서 고객사로 바로)이 있어 — **별도로** 볼 수 있으면 좋겠어." → **4-0 으로 맨 앞에 작게**(F25~F30).

크기: **큰 일 — 다섯 번에 나눠 배포.** **4-0 오늘 준비할 것·직송 따로(작은 일 — 먼저)** → 4-1 연결·서로 보이기 → 4-2 기기 한 번만 적기 → 4-3 준비 단추·체크 한 번만 → 4-4(써 본 뒤) 한 목록·예전 방식 정리.
- **4-0 은 확인서 목록 화면·상세 띠·홈 숫자만** — SQL 없음, 외부 쓰기 없음, integration-rules 없음, 출고 준비 쪽 코드 안 건드림. 합치기 본설계(4-1~)와 따로 먼저 배포 가능.
- **새 SQL 없음** — 1단계에서 미리 만든 ③ `it_sales_confirm_work.prep_event_id`·`link_source` 만 씀(§4-G). → sql-review·사용자 SQL 실행 없음.
- **네이버에 새로 쓰는 일 없음** — 일정을 만들거나 고치지 않음. 쓰는 것은 지금 있는 "준비 단추 → 제목 태그"뿐(4-3 에서 부르는 화면이 하나 늘어남).
- 카톡·IT재고 반영·공개 앨범은 **지금 코드 그대로**, 연결된 건은 "완료 보고에 들어가는 기기 목록을 어디서 가져오나"만 바뀜(4-2).
- integration-rules: 4-1(복제본 정리 기록 세기 한 줄 — 가볍게), 4-2(완료 보고·카톡·재고 경로 — 구현 전후), 4-3(제목 태그를 새 화면에서 부름·카톡 체크 숫자 — 구현 전후).
- 흐름(단계마다): 팀장 사전 작업(types) → developer(파일 나눔) ∥ ui-designer → integration-rules(해당 단계) → qa-checker → deploy-check → 팀장 라이브 확인(건수만) → 사용자.

---

## 결정 표 (맨 위가 우선)

### 오늘 준비할 것 · 직송 (4-0 — 번호는 뒤지만 **먼저 배포**)
| # | 결정 | 상태 | 이유 |
|---|---|---|---|
| **F25** | 확인서 목록 맨 위에 **출고 준비 리스트와 같은 "준비하는 날" 줄**: 날짜 고르기 · `[오늘]` · `[전체]` · "→ 11/30(월) 납품분". **기본 = 오늘 → 다음 영업일**(주말 건너뜀 — 출고 준비 리스트·홈과 같은 규칙, 공휴일은 모름). 그날 납품분만, **지역 순(수도권A→E = 일정 시간 9·12·15·18·21시 순) → 상호**. `[전체]` = 지금 목록 그대로(안 끝난 건 + 날짜 칩) | 확정 방향(사용자 요구) · 모양 추천 | 출고 준비 리스트와 같은 날을 같은 말로 보게. 지금 목록의 `내일` 칩은 달력 기준이라 금요일엔 토요일을 봄(H24) |
| **F26** | 그 위 **숫자 카드 3개**(출고 준비 리스트 모양): 🚨 준비 남음(접수·준비중·보류) · ✅ 준비 완료(준비완료·출고) · 전체 — **그날 납품분**, 직송·영업에서 지움·취소·철수·이전·판매는 뺌. 카드를 누르면 그 처리여부로 거름 | 추천 | 출고 준비 리스트의 "잔여·완료·전체"와 같은 읽기. 4-3 뒤엔 처리여부가 준비 단추를 따라가 두 화면 숫자가 맞음(그 전엔 다를 수 있음) |
| **F27** | **날짜 밖 소식을 안 놓치게**: 준비하는 날 보기에서도 그 위 한 줄 "다른 날짜 — 새 확인서 n · 영업에서 수정됨 n · 영업에서 지웠는데 준비 중 n `[보기]`"(누르면 `[전체]` + 그 칩) | 추천 | 기본 보기를 날짜로 좁히면 "새로 들어온 확인서"를 못 볼 수 있음(목록의 다른 역할 = 받은 편지함) |
| **F28** | **직송 판정 한 곳**(`lib/salesConfirms/deliveryMode.ts` `isDirectShip`, 순수) = **영업 값**: 위탁사(`consign`)가 있고 위탁·직송 칸(`shipType`)이 '직송', 그 칸이 비면 앞머리글(`head`)에 '직송' — 영업 현황표 '납품담당' 규칙(`statusDeliverer`)과 같음. 위탁사가 없으면 직송 아님. **위탁(위탁사가 있고 직송 아님)은 보통 건**(출고 준비 리스트도 위탁납품은 안 뺌). 목록은 payload 통째가 아니라 **칸 세 개만** 읽음(`payload->>shipType` 꼴 — 납품은 맨 위, 교체·유지보수·소프트웨어는 `payload->doc` 안 — 지운 정보 읽기와 같은 방식) | 추천 | 영업이 직접 고르는 값이라 가장 정확. 제목 글자로 추측하지 않음 |
| **F29** | **직송 = 목록 위 항목 하나 더**: `[출고 준비 확인서 n] [직송 n] [철수·이전·판매 n]`. 직송 건은 **"오늘 준비할 것"·숫자 카드·홈 "준비 안 끝남"·(4-1) "출고 일정 없음" 알림에서 빠짐**. 직송 줄엔 매입처(위탁사) 이름. **상세는 그대로 열림**(기기 칸·출력 그대로 — Q5), 상세 위에 "직송 — 매입처 ○○ (우리 출고 준비 없음)" 띠 | 추천(**Q5**) | 우리가 준비하지 않는 건을 오늘 할 일에서 빼되, 매입처에서 받은 시리얼·자산번호를 적어 둘 길은 남김 |
| **F30** | 출고 준비 리스트의 직송 거르기(일정 제목 키워드 `DIRECT_DELIVERY_KEYWORDS` — '직송' + 업체 이름 몇 개)는 **이번에 안 바꿈**. 두 판정이 다른 건(확인서는 직송인데 일정 제목에 표시가 없어 출고 준비 리스트에 뜸, 또는 반대)은 4-1 연결 뒤 배지에 "확인서는 직송" / "확인서는 직송 아님"으로 드러내고, 건수를 보고 키워드를 손볼지 판단 | 추천 | 출고 준비 쪽엔 일정 제목밖에 없고, 연결 전엔 어느 확인서인지 모름. 키워드를 지금 바꾸면 출고 준비 리스트 동작이 바뀜 |

### 화면·연결
| # | 결정 | 상태 | 이유 |
|---|---|---|---|
| **F1** | **메뉴 두 개 그대로, 한 화면으로 합치지 않고 "이어 붙임".** 출고 준비 리스트 = **날짜별 오늘 할 일**(창고·핸드폰, 네이버 ★ 일정 기준), 확인서 = **건 하나의 작업대**(기기·체크·출력) + 들어온 확인서 관리(새로·수정됨·지움). 출고 준비 줄에 `📋 확인서` 한 줄(누르면 상세), 확인서 상세 위에 **출고 준비 상자**(연결된 일정·준비 단추·`📷 완료 보고`). `Shell` 메뉴·`tabForPath` 안 바꿈 | 추천(**Q1**) | 두 목록은 기준이 다름(일정: 별표·시간=지역·준비하는 날 / 확인서: 영업 판·새로·지움·출력). 한 표로 합치면 둘 다 복잡해지고 지금 손에 익은 핸드폰 흐름이 깨짐. 이어 붙이면 한 건 일은 확인서 상세 하나에서 끝남 |
| **F2** | **연결 저장 = ③ `prep_event_id`(일정 id) + `link_source`** — 값: `''`(아무도 안 정함) · `'auto'`(확실한 짝을 저장함) · `'manual'`(사람이 고름) · `'none'`(사람이 "출고 일정과 연결 안 함"). **확인서 1 → 일정 1, 일정 1 → 확인서 여럿 허용**(같은 출장에 납품 + 소프트웨어 확인서). 새 SQL 없음 | 추천 | 칸이 이미 있음(D8). 확인서 여럿 → 일정 하나는 ③ 여러 줄이 같은 id 를 가리키면 됨. 반대(한 확인서를 이틀에 나눠 보냄)는 드물다고 보고 첫 일정에만 연결 — 4-1 배포 뒤 실제 건수로 확인(§7) |
| **F3** | **짝 찾기 = 순수 함수 한 곳**(`lib/salesConfirms/prepLinkRules.ts`). **확실** = 영업 확인서 제목(우리 사본 `salesForm/confTitle.ts` 로 만든 것)과 일정 제목의 `IT/` 뒤가 같고 **날짜가 같음**. **후보** = 상호(제목 `/` 칸 어디에 있든) + 날짜 ±1일 + 구분 맞음 + 지역(둘 다 알 때). **약한 후보** = 상호 + ±3일 + 구분. 지금 `prepMatch` 의 틈 3개를 고침(H9) | 추천 | 영업 웹앱이 확인서마다 만드는 "제목 한 줄"이 출고 일정 제목과 같은 모양(H8) — 예전 방식도 "IT/ 이후가 같으면 같은 건"으로 잘 돌았음 |
| **F4** | **확실한 짝은 자동 연결로 보여 줌(누를 것 없음).** 저장은 화면 열기만으론 안 하고, 사람이 그 건으로 무언가 할 때(완료 보고 저장·발송, 준비 단추) `'auto'` 로. 틀리면 `[풀기]` → `'none'`. 확실하지 않으면 후보를 보여 주고 `[연결]` 한 번 | 추천(**Q4**) | 하루 2~3건 — 매번 누르게 하면 잊음. 제목·날짜가 다 같은 짝이 틀릴 일은 거의 없음. "화면 열기만으론 안 씀"은 계약관리와 같은 원칙(CLAUDE.md) |
| **F5** | **네이버 일정이 없는 확인서: 앱이 일정을 만들거나 고치지 않음.** 기기·체크·출력은 일정 없이 다 됨, 카톡 보고·IT재고 반영은 영업이 일정을 만들면 완료 보고에서. 확인서 목록·홈에 "내일 납품인데 출고 일정 없음 n"(주황) → 영업에 부탁. 원격 설치처럼 출고가 없는 건은 상세에서 `[출고 일정 없음으로 두기]`(`'none'`) → 알림에서 빠짐 | 추천(**Q3**) | 앱이 일정을 만들면 영업이 나중에 만든 일정과 둘이 됨(복제본 — CLAUDE.md 동기화 주의). 앱 일정은 네이버에 `it-<id>` 로 올라가는 길이라 더 위험 |
| F6 | 확인서 없는 일정 = 지금 그대로(완료 보고에 기기 직접). 출고 준비 줄엔 "확인서 없음" 흐리게 + 후보가 있으면 `[연결]` | 확정 | 시트 확인서·영업 웹앱 밖 건이 아직 있음 |
| F7 | 철수·이전·판매(따로 보기) 확인서도 **연결은 됨**(보기용 — 출고 준비 줄에서 확인서를 바로 엶). 기기는 완료 보고에 직접(지금처럼, 따로 보기엔 기기 칸이 없음) | 추천 | 철수 일정은 출고 준비 리스트에 나옴. 회수할 품목을 보는 데 도움 |
| F8 | 일정이 지워지면(영업이 네이버에서 지움 → 동기화가 앱 줄을 지움) 연결은 FK `set null` 로 풀리고 ③ 은 남음. `link_source` 가 `auto`/`manual` 인데 `prep_event_id` 가 비면 **"연결했던 일정이 없어졌어요 — 다시 골라 주세요"** + 후보 | 확정 | 칸 하나로 "풀림"을 알 수 있음(SQL 없음). 완료 보고·사진은 지금처럼 일정과 같이 사라짐(기존 위험) — 기기는 확인서에 남음 |

### 두 번 적기 없애기
| # | 결정 | 상태 | 이유 |
|---|---|---|---|
| **F9** | **연결된 건의 기기 원본 = 확인서 기기 칸(④).** 완료 보고 창의 기기 칸은 확인서에서 가져와 **보여 주기만** + `[확인서에서 고치기]`. 저장·발송 때 **서버가 확인서에서 다시 만들어** 완료 보고 `units` 에 사본으로 저장 → 카톡 문구·IT재고 반영·재고 다시 반영·공개 앨범·예전 시트 채우기는 지금 코드가 이 사본을 그대로 씀 | 추천(**Q2**) | 확인서 쪽이 칸이 더 많고(제조사·모델명·출고사양·차이 확인) 종이로도 나감. 지금은 확인서에만 적으면 카톡·IT재고에 안 가는 구멍이 있음(H3). 보고 쪽 동작은 손대지 않고 "넣는 목록"만 바꿈 |
| F10 | 보고로 가는 칸 = **장비·모니터·기타 칸 중 자산번호나 시리얼이 있는 칸**(교체는 교체 후 칸). **유지보수·소프트웨어 칸은 안 감.** 확인서에 장비·모니터·기타 칸이 하나도 없는 건(유지보수·소프트웨어만)은 **지금처럼 보고 창에서 직접**. "영업에서 빠진 칸"도 안 감(창에 "n칸은 영업에서 빠져 안 넣었어요") | 추천 | IT재고 '임대중'은 새로 나가는 기기만(CLAUDE.md "납품·교체 보고 발송 시"). 유지보수 대상이 고객 PC면 "IT재고에 없음" 경고만 쌓임 |
| F11 | 보고 한 줄 만들기: 자산번호·시리얼 = ④, 모델 = 출고 제조사+모델(비면 영업 요청), 구분·사양 = IT재고(자산번호로 5분 색인 `findAssetBriefs`) — 단 IT가 확인서에서 사양을 고쳤으면 그 출고 사양 요약. 같은 자산번호는 한 번만, 외관 등급(grade)은 예전 보고 값 유지. **카톡 문구 모양은 그대로** | 추천 | 지금 보고 창이 자산번호로 채우던 값과 같은 출처 |
| F12 | **연결 전에 보고에 적어 둔 기기**: 보고 창·확인서 상자에 "보고에만 있는 기기 n대" + `[확인서 빈 칸으로 옮기기]`(사람이 누를 때만, **자산번호·시리얼만**, 품목 종류(IT재고 품목)로 빈 칸을 고름, 남는 건 그대로 보여 줌). 둘 다 있고 다르면 확인서 기준 + 다른 번호 목록 | 추천 | 4단계 배포 날 이미 보고에 적어 둔 건이 있음. 제조사·모델은 안 옮김(차이 확인 창 D27 을 건너뛰지 않게 — 옮긴 뒤 상세에서 IT재고로 채움) |
| F13 | 보낸 뒤 확인서 기기가 바뀌면 **"보고 뒤 바뀜"** 표시(확인서 상자·출고 준비 줄) → `[✏️ 고치기만]`/`[🔁 수정해서 다시 보내기]`는 사람이. 자동 재발송 없음 | 확정 | 카톡은 사람이 보냄 |
| F14 | **카톡 두 번 막기를 서버에도**: 처음 발송(`send`)인데 이미 보낸 보고면 서버가 거절("이미 보냈어요 — 수정해서 다시 보내기"). 같은 확인서가 **다른 일정(복사본)**으로 이미 보고했으면 보고 창에 경고 | 추천 | 지금은 화면 단추만 막음(H4) — 두 화면·두 사람이 같은 창을 열 수 있게 되므로 |
| **F15** | **준비 상태 원본 = 출고 준비 단추**(사람별 오버홀·준비중·완료 → 네이버 제목에 이름 태그). 연결된 확인서 상세에도 **같은 단추**. 확인서 처리여부는 **앞으로만 따라감**: 누가 준비중 → '준비중', 누가 완료 또는 완료 보고 발송 → '준비완료'(접수·준비중일 때만), 단추 누른 사람을 처리자에 더함. 출고·보류·취소는 사람이 확인서에서. 단추를 꺼도 처리여부는 그대로 | 추천(**Q2**) | 영업은 네이버 제목 태그로 준비 상태를 봄 → 그 단추가 원본이어야 함. 뒤로 돌리거나 보류·취소를 덮지 않음 |
| **F16** | **체크리스트 원본 = 확인서(기기마다 + 기타는 건마다).** 연결된 건의 완료 보고 체크리스트는 확인서 체크를 **모아 보여 주기만**("데스크탑&노트북 3대 중 다 끝난 항목 18/20"), 카톡 "체크리스트 x/y" = 모든 기기에서 다 체크된 항목 수 / 이 건에 해당하는 항목 수 | 추천(**Q2**) | 같은 항목표(31개)를 두 번 체크하고 있음(H1). 기기마다가 더 정확하고 사용자가 정한 방식(D11) |
| F17 | 사진·카톡·앨범·IT재고 반영 = **완료 보고 그대로**(일정 기준). 확인서 상세 `📷 완료 보고` = 같은 창(`PrepReportModal`) | 확정 | 사진 앨범 주소가 보고 id |
| F18 | 홈: 출고 준비 카드에 "확인서 연결 안 된 내일 출고 n", 영업 확인서 카드에 "내일 납품인데 출고 일정 없음 n"(둘 다 주황, 직송·`none` 뺌). 카드는 합치지 않음. (4-0 에서 먼저: 영업 확인서 카드 "준비 안 끝남"에서 직송을 뺌) | 추천 | 카드 모양 그대로, 숫자 한 줄씩 |

### 네이버·예전 방식·안전
| # | 결정 | 상태 | 이유 |
|---|---|---|---|
| F19 | 네이버 쓰기: **새 종류 없음.** 확인서 번호를 네이버에 적지 않음, 일정 만들기·고치기 없음, `naver_uid` 안 건드림. 준비 단추의 제목 태그는 지금 함수(`syncPrepTitleTag`, `/api/shipment-prep/title-tag`) 그대로 | 확정 | CLAUDE.md 동기화 주의 — 영업 일정을 고치는 길은 412·복제본 위험 |
| F20 | **예전 방식(`?view=legacy`·`lib/confirmLink.ts`·완료 보고 저장 뒤 시트 채우기)은 4단계 동안 그대로.** 빼는 때: `📄 시트와 비교`의 "시트에만 있는 건"이 **2주 연속 0** → 사용자 확인 → `🗂 예전 방식` 칩 접기(4-4) → 한 달 뒤 코드 정리(따로) | 추천 | 영업이 시트 확인서도 아직 만듦(11-24~30 새 탭 — 앞 설계 실측) |
| F21 | 복제본 정리(`app/calendar/duplicateActions.ts` 기록 세기)에 **③ 연결도 '기록'으로 셈** — 연결된 앱 줄을 '기록 없음'으로 보고 지우지 않게 | 확정(4-1) | H15 |
| F22 | 확인서 상세 페이지 시간 한도 60초 → **300초**(완료 보고를 상세에서 보내면 재고 반영이 응답 뒤에 1분 넘게 돎) | 확정(4-2) | H12 |
| F23 | 연결을 못 읽을 때(확인서 표 오류): 출고 준비 리스트는 그대로 돎(배지 자리만 "확인서 정보를 못 읽었어요"). 완료 보고 **발송은 막지 않고** 창에 보이던 확인서 기기로 보낸 뒤 주황 알림(`toast-warn`). 확인서 표가 아예 없으면(42P01/PGRST205) 예전처럼 | 추천 | 카톡 보고가 확인서 쪽 문제로 멈추면 안 됨. 창이 이미 확인서 기기를 보여 주고 있으므로 그 목록이 가장 맞음 |
| F24 | (4-4, 써 본 뒤) 출고 준비 리스트에 **일정 없는 확인서를 회색 줄로** 그 납품일에 같이 보임(준비 단추·보고 없음 — "네이버 일정 없음 · 영업에 부탁"). 앱이 일정을 만들지는 않음 | 추천(**Q3**) | "함께 운영" — 내일 나갈 일을 한 목록에서 빠짐없이 |

---

## 0. 확인한 것 (근거 — 코드 읽기만, 서버·DB·네이버·카톡·시트 조회 없음)

| # | 사실 | 위치 |
|---|---|---|
| H1 | 두 화면이 **같은 체크 항목표**(`it_prep_photo_items`, 31개·묶음 grp)를 씀 — 완료 보고는 **건마다** `checked_items`(보이는 묶음은 일정 제목 글자로 고름), 확인서는 **기기마다** ④ `checks` + 기타 묶음 **건마다** ③ `checks` | components/shipmentPrep/PrepReportModal.tsx:53-60 · lib/salesConfirms/work.ts readChecklist · itemKind.ts checkGroupFor |
| H2 | 완료 보고 기기 `PrepUnit {serial, assetId, grade, model, gubun, spec, category}` vs ④ `asset_id·serial·actual_maker·actual_model·spec_override·checks·extra`. grade 는 보고 창에 입력 칸이 없음(값만 이어 씀) | lib/shipmentPrep.ts:130-139 · supabase/sales_confirms_schema.sql:190-227 |
| H3 | 카톡 문구·IT재고 반영·재고 다시 반영·앨범은 전부 **완료 보고 한 줄**(`units`·`company`·`photos`)과 일정 제목(`eventKindOf`)만 봄 → 지금은 **확인서에만 자산번호를 적으면 카톡에도 IT재고에도 안 감** | app/shipment-prep/reportActions.ts sendPrepReport 351-407 · applyStockUnit 426-462 · retryPrepStock 540-566 · getAlbum 569-577 |
| H4 | 처음 발송을 두 번 막는 건 **화면 단추뿐** — 서버 `sendPrepReport(mode 'send')` 는 `sent_at` 을 안 봄 | reportActions.ts:351-388, PrepReportModal.tsx:717 |
| H5 | 예전 방식 연결이 살아 있음: 보고 저장 뒤 `after()` 로 예전 시트 확인서 칸 채우기(`syncPrepToConfirm`), 예전 확인서 저장은 반대로 보고 기기 채우기(`pushDocToPrep`) | reportActions.ts:124-129 · lib/confirmLink.ts:133-165,201-242 |
| H6 | ③ `prep_event_id uuid` FK → `it_calendar_events` **on delete set null**, `link_source text not null default ''`, 연결된 줄만 부분 색인. 1~3단계 코드는 안 씀(`work.ts` 칸 목록에 없음) | supabase/sales_confirms_schema.sql:166-182 · lib/salesConfirms/work.ts:71-74 |
| H7 | `it_prep_events`·`it_prep_reports` 는 일정 줄이 지워지면 **cascade**. 동기화는 기간 창 안에서 네이버에 없어진 일정의 앱 줄을 지움 → 영업이 네이버 일정을 지우고 새로 만들면 준비 체크·완료 보고·사진이 같이 사라짐(지금도). 날짜만 옮기면 같은 줄(`naver_uid` upsert) | supabase/shipment_prep_schema.sql:16,54 · lib/naverCalendarSync.ts:172-188,226-245 |
| **H8** | 영업 웹앱은 확인서마다 **"제목 한 줄"**을 만듦(카톡 선행방에 확인서 사진과 올리는 줄) — 우리 사본 `titleConf·titleSwap·titleSvc`. 모양이 출고 일정 제목과 같음(`…-IT/납품(현장)/퍼스트/운영팀/유입/상호-현장/모델(새기기) 2대, 소모품/계약서`). 예전 방식도 제목 `IT/` 뒤가 같으면 같은 건(`titleBody`). 준비 단추 태그는 제목 **앞**에 붙어 `IT/` 뒤는 안 바뀜. **영업이 이 제목을 네이버 일정에 그대로 쓰는지는 실측 필요**(4-1 첫 일 — 건수만) | lib/salesConfirms/salesForm/confTitle.ts:1-60,117-124 · lib/shipmentPrep.ts:39-52 · lib/confirmSheet.ts:231 titleBody · lib/icsPatch.ts:176-192 |
| **H9** | 지금 `prepMatch` 의 틈: ⓐ 상호를 `parseEventTitle`(구분 칸 **+4**)로 뽑는데 유입경로가 비면(빈 칸은 제목에서 빠져 당겨짐)·위탁납품(운영팀 없음)·유지보수 제목(운영팀 없음)이면 **품목 칸을 상호로 읽음** ⓑ 유지보수·소프트웨어 확인서의 영업 제목은 `납품(일반)`(titleSvc)인데 `confirmKindOf('유지보수')='유지보수'` → **유지보수 확인서는 일정과 영영 안 맞음** ⓒ 철수는 구분을 안 봄 | lib/salesConfirms/prepMatch.ts:64-86,111-123 · lib/shipmentPrep.ts:43-52 · confTitle.ts titleSvc·join |
| H10 | 출고 준비 리스트 = 네이버 ★(또는 앱 ⭐) + IT 제목, -14~+60일. 확인서 후보 찾기(`loadPrepHints`)는 ★ 를 안 봄 → **★ 없는 일정에 연결하면 출고 준비 리스트엔 안 보임** | app/shipment-prep/actions.ts:55-78 · work.ts:481-520 |
| H11 | 출고 준비 화면은 주소로 특정 일정을 못 엶(`searchParams` 없음). 확인서 상세의 링크는 `/shipment-prep` 첫 화면 | app/shipment-prep/page.tsx · components/salesConfirms/PrepHintBox.tsx:37 |
| **H12** | `/shipment-prep` 페이지는 `maxDuration 300`(발송 뒤 `after()` 재고 반영이 16대에 1분 넘음), `/confirm-form/[id]` 는 **60**. 서버 액션은 부른 페이지의 시간 한도를 따름(Next 규칙 — developer 가 확인) → 상세에서 보내면 재고 반영이 60초에서 끊길 수 있음 | app/shipment-prep/page.tsx:5-7 · app/confirm-form/[id]/page.tsx:9 |
| H13 | `setPrepStage` = 읽고 → 합치고 → 통째로 upsert(`updated_at` 비교 없음) — 두 화면에서 동시에 누르면 한 사람 표시가 빠질 수 있음(지금도 두 핸드폰이면 같음) | app/shipment-prep/actions.ts:145-160 |
| H14 | 홈 출고 준비 카드·영업 확인서 카드는 따로, `listPrepEvents` 결과 모양을 홈도 씀 → **모양을 바꾸지 말고 배지는 따로 읽기** | lib/homeDashboard.ts:133-176,426-521 |
| H15 | 복제본 정리의 기록 세기는 예전 확인서 연결(`it_confirm_docs.prep_event_id`)은 세지만 **③ 연결은 안 셈** → 연결된 앱 줄을 '기록 없음'으로 보고 지울 수 있음(지우면 ③ 연결이 풀림) | app/calendar/duplicateActions.ts:124-162 |
| H16 | 확인서 상세는 ③ `updated_at` 으로 동시 수정을 막음 → 연결·처리여부 따라가기가 ③ 을 고치면 열린 상세가 다음 저장에서 "다른 사람이 고쳤어요"(가짜 충돌) | app/confirm-form/salesDetailActions.ts:683-686 |
| H17 | 판매·철수·이전 = 따로 보기(기기 칸·formDoc 없음 — 그래서 제목도 못 만듦). 출고 준비엔 철수 일정이 나오고 재고는 안 바꿈 | lib/salesConfirms/types.ts:185-195 · lib/shipmentPrep.ts:172-175 |
| H18 | `📄 시트와 비교`에 "시트에만 있는 건 n" 이 있음 → 예전 방식을 언제 뺄지 재는 데 씀 | lib/salesConfirms/sheetCompare.ts · 앞 설계 §3-8 |
| H19 | 목록 줄 요약(자산 n/m·출력함·다시 뽑기)은 `loadListRowsByIds(ids)` 로 몇 건만 다시 만들 수 있음 | lib/salesConfirms/listQuery.ts:406-416 |
| H20 | "오늘 준비할 것" 규칙 = `nextBusinessDay(today)`(주말 건너뜀, 공휴일 없음) — 홈은 `lib/homeDashboard.ts`(server-only), 출고 준비 화면은 자기 사본(`nextBusinessDayOf`, 브라우저 시각). 출고 준비 화면은 "준비하는 날"을 고르고 `→ 날짜 출고분`, 카드 3개(잔여·완료·전체), `완료 포함` | lib/homeDashboard.ts:53-58 · components/shipmentPrep/ShipmentPrepPage.tsx:22-31,53,100-106,245-279 |
| H21 | 영업 확인서에 `consign`(위탁사)·`shipType`('위탁'·'직송' — 위탁사가 있을 때)·`head`(앞머리글) 칸. 영업 현황표 '납품담당'은 위탁사 없음 → 퍼스트, `shipType` 이 있으면 그 값, 없으면 앞머리글에 '직송'이 있으면 직송(`statusDeliverer`) | lib/salesConfirms/salesForm/confirm.ts:67-71 · salesForm/statusRow.ts:113-122 |
| H22 | 출고 준비 리스트의 직송 거르기는 **일정 제목 글자**(`'직송'` + 업체 이름 몇 개)로만. 영업 제목은 위탁사가 있으면 `★…위탁납품`·위탁사 이름이 들어가지만 '직송' 글자는 앞머리글에 적었을 때만 → 제목만으론 직송·위탁을 못 가름 | lib/shipmentPrep.ts:22,29-34 · salesForm/confTitle.ts:34-58 |
| H23 | 목록은 payload 통째가 아니라 필요한 칸만 JSON 경로로 읽는 방식이 이미 있음(`payload->>deletedAt`) | lib/salesConfirms/listQuery.ts:384-391 |
| H24 | 지금 목록의 날짜 칩 `오늘`·`내일`은 **달력 기준**(금요일 `내일` = 토요일), 위 항목은 `[출고 준비 확인서] [철수·이전·판매]` 두 개. 목록은 납품일이 120일 안이거나 안 끝난 건을 다 읽어 와서 날짜 거르기는 화면에서 바로 됨 | components/salesConfirms/SalesConfirmListPage.tsx:38-76,523-543 · listQuery.ts:430-465 |
| H25 | 홈 영업 확인서 카드 "준비 안 끝남" = 납품일 오늘~다음 영업일 + 처리여부 접수·준비중 — **직송도 들어감** | lib/homeDashboard.ts:479-491 |

---

## 1. 한 줄 목표와 쓰는 사람

**같은 출고 한 건을 영업 확인서와 출고 준비 일정으로 짝지어 두고, 기기·체크·준비 상태를 한 곳에서 한 번만 적으면 다른 화면·카톡 보고·IT재고 반영·확인서 출력이 그 값을 같이 쓰게 한다. 네이버에는 새로 쓰지 않는다.**

- **창고(핸드폰, 홈 화면 앱)**: 출고 준비 리스트 카드 → `📋 확인서` → 확인서 상세에서 기기·기기별 체크·준비 단추 → `📷 완료 보고`(사진·카톡).
- **사무실(PC)**: 확인서 목록(맨 위 "준비하는 날" = 다음 영업일 납품분, 새로·수정됨·출고 일정 있음/없음, 직송 따로) · 연결 확인 · 출력.

---

## 2. 지금 두 화면의 일이 어떻게 겹치나 (같은 출고 1건)

| 일 | 출고 준비 리스트 | 영업 확인서(목록·상세) | 지금 | 4단계 뒤 |
|---|---|---|---|---|
| 그날 준비할 것 | 준비하는 날 → 다음 영업일 출고분(카드 3개) | 날짜 칩 `오늘`·`내일`(달력 기준) | **같은 날을 다르게 셈** | 확인서도 같은 "준비하는 날"(4-0, F25) |
| 직송 | 일정 제목 키워드로 목록에서 뺌 | 구분 없이 섞임 | 확인서에서 못 가름 | 확인서에 `직송` 항목(4-0, F28·F29) |
| 일정·건 찾기 | 준비하는 날 → 다음 영업일 ★ 일정 | 납품일·지역 목록 + "같은 건으로 보이는 일정"(읽기) | **두 목록에서 같은 건을 따로 찾음** | 서로 한 줄로 이어짐(F1) |
| 누가 준비 | 이름 옆 오버홀·준비중·완료(네이버 제목 태그) | 처리여부 칩 + 처리자 칩 | **두 번** | 단추 하나, 처리여부가 따라감(F15) |
| 체크 | 완료 보고 체크리스트(건마다) | 기기마다 + 기타(건마다) — 같은 항목표 | **두 번** | 확인서 한 번, 보고는 모아 보기(F16) |
| 기기(자산번호·시리얼) | 완료 보고 기기 칸(자산번호 → 시리얼·모델·구분·사양 자동) | 기기 칸(제조사·모델명·자산번호·시리얼·출고사양, 차이 확인) | **두 번** — 확인서에만 적으면 카톡·IT재고에 안 감(H3) | 확인서 한 번(F9) |
| 사진 | 완료 보고 | — | 한 번 | 그대로, 상세에서도 열림(F17) |
| 카톡 보고 | 완료 보고 `✅ 완료 · 카톡 발송` | — | 한 번 | 그대로(기기는 확인서에서) |
| IT재고 '임대중' | 발송 뒤 자동(보고 기기) | — | 한 번 | 그대로(기기는 확인서에서) |
| 네이버 제목 태그 | 준비 단추 | — | 한 번 | 그대로, 상세에서도 같은 단추(4-3) |
| 확인서 출력 | — | `🖨 확인서 출력` | 한 번 | 그대로 |
| 예전 시트 확인서 | 보고 저장 뒤 시트 칸 채움 | 예전 방식 화면만 | — | 그대로(F20) |

---

## 3. 기존 코드 재사용·확장 지점

| 파일:함수 | 어떻게 |
|---|---|
| `lib/salesConfirms/prepMatch.ts` `normCompanyName`·`companyBase`·`regionWithGuess`·`matchPrepEvents` | 정규화 함수는 그대로 재사용. 짝 판정은 새 `prepLinkRules.ts` 로 옮기고 H9 틈을 고침(`matchPrepEvents` 는 새 규칙을 부르는 얇은 껍데기로 남기거나 없앰 — 쓰는 곳 `work.ts` 하나) |
| `lib/salesConfirms/salesForm/confTitle.ts` `titleConf`·`titleSwap`·`titleSvc` | **import 만**(영업 사본 — 고치지 말 것). formDoc + renderer 로 영업 제목을 만듦 |
| `lib/confirmSheet.ts` `titleBody` | 제목 비교 열쇠의 모양 참고(같은 규칙으로 새로 — 예전 방식 파일은 안 고침) |
| `lib/salesConfirms/regionSlot.ts` `regionFromEventTime` | 그대로 |
| `lib/salesConfirms/slots.ts` `buildSlotLines`·`slotItems` · `itemKind.ts` `checkGroupFor` | 보고 기기 만들기·체크 모아 보기의 칸 계산(한 곳 원칙 그대로) |
| `lib/salesConfirms/work.ts` `readConfirmRecord`·`readUnitsFor`·`readWorkRow`·`loadPrepHints` | 앞 셋은 재사용, `loadPrepHints` → 새 `prepLink` 읽기로 바꿈 |
| `lib/salesConfirms/listQuery.ts` `loadListRowsByIds`·`isMissingSalesTable` | 출고 준비 줄 배지(자산 n/m·출력함)·표 없음 판정 재사용 |
| `lib/inventory/assetIndex.ts` `findAssetBriefs` | 보고 줄의 구분·사양(5분 색인 — 시트 한도) |
| `app/shipment-prep/reportActions.ts` `getPrepReport`·`savePrepReport`·`sendPrepReport` | 4-2: 연결된 건이면 기기(4-3: 체크 수)를 확인서에서 넣음, 처음 발송 두 번 서버에서 막음. **카톡 문구·`applyStockUnit`·`retryPrepStock`·앨범은 안 고침** |
| `app/shipment-prep/actions.ts` `listPrepEvents`·`setPrepStage`·`syncPrepTitleTag` | `listPrepEvents` 모양 그대로(홈이 씀). 4-2 에 한 줄 읽기 `getPrepEventRow` 추가, 4-3 에 `setPrepStage` 끝에 `after()` 따라가기 한 줄 |
| `components/shipmentPrep/PrepReportModal.tsx` | 4-2: "확인서 연결 모드"(기기 보기만), 4-3: 체크 모아 보기 |
| `components/shipmentPrep/ShipmentPrepPage.tsx` `personButtons` | 4-1: 배지·`?event=` 열기, 4-3: 단추를 따로 빼서(`PrepStageButtons`) 확인서 상세와 같이 씀 |
| `components/salesConfirms/PrepHintBox.tsx` | 4-1 에 `PrepLinkPanel` 로 바꿈 |
| `app/calendar/duplicateActions.ts` `countRecords` | ③ 연결도 셈(F21) |
| `lib/homeDashboard.ts` `nextBusinessDay`·`loadPrepOverview`·`loadSalesConfirmCard` | 4-0: `nextBusinessDay` 를 순수 파일 `lib/businessDay.ts` 로 옮기고 홈은 import(같은 함수 — 확인서 목록 화면도 씀), "준비 안 끝남"에서 직송 뺌. 4-1: 알림 한 줄씩(F18) |
| `lib/salesConfirms/salesForm/statusRow.ts` `statusDeliverer` | 직송 규칙의 원본(영업 사본 — 고치지 말 것). `isDirectShip` 은 같은 규칙을 우리 파일에 적고 Node 로 두 결과가 같은지 확인 |
| `lib/salesConfirms/listQuery.ts` 지운 정보 읽기(`payload->>…`) | 4-0: 같은 방식으로 `shipType`·`consign`·`head` 세 칸만(목록 60초 읽기에 payload 통째를 안 실음) |
| `components/salesConfirms/SalesConfirmListPage.tsx` 위 항목(`sc-groupbar`)·날짜 칩 | 4-0: 항목 `직송` 추가, "준비하는 날" 줄·카드 3개(출고 준비 리스트 모양 따라)·날짜 밖 소식 한 줄 |
| **안 건드림** | 가져오기(`importer`·`normalize`·`source`·라우트), 영업 양식 사본, 계약관리, 네이버 동기화(`naverCalendarSync.ts`)·`naverCaldav.ts`·`icsPatch.ts`, 카톡 `enqueueOutbox`, `applyStockUnit`, 예전 방식(`components/confirmForm/*`·`lib/confirmLink.ts`·`lib/confirmSheet*.ts`), `Shell.tsx` |

---

## 4. 데이터 설계 (새 표·칸·SQL 없음)

보안 모델 그대로 — ③ 은 RLS 켜고 정책 없음 + revoke, 서버 service_role 만. **③ 을 쓰는 건 화면 액션뿐**(가져오기 코드는 ③④·`prepLink` 를 import 도 안 함 — 기존 규칙 그대로, QA grep).

### 4-0. 오늘 준비할 것 · 직송 (새 칸 없음 — 읽기만)

- **준비하는 날**(화면 상태, 브라우저에 안 남김 — 출고 준비 리스트와 같음): `prepDate`(기본 = 한국 오늘) → `target = nextBusinessDay(prepDate)`(`lib/businessDay.ts`, 순수 — 홈과 같은 함수). 목록 = 출고 준비 확인서 항목 중 `deliveryDate === target`, 직송·영업에서 지움 제외, 취소는 기본 숨김(출고 준비 리스트의 `완료 포함`처럼 칩으로 볼 수 있게), 정렬 = 지역(수도권A→E, 지역 모름은 끝 — 영업 지역이 비면 주소 추정값) → 상호 → 순번.
- **숫자 카드**: 위 목록에서 처리여부로 — 준비 남음(접수·준비중·보류) / 준비 완료(준비완료·출고) / 전체.
- **날짜 밖 소식**: 지금 목록 데이터(이미 화면에 있음)에서 납품일이 target 이 아닌 것 중 "새로"·"영업에서 수정됨"·"영업에서 지웠는데 준비 중" 수 — 새 읽기 없음.
- **직송**: 목록 서버(`listQuery`)가 ① 에서 `ship_type:payload->>shipType, consign:payload->>consign, head:payload->>head`(+ `payload->doc->>…` 같은 세 칸)를 같이 읽어 `isDirectShip` → 줄에 `directShip: boolean`·`consignName: string`(매입처 — 회사 이름, 개인정보 아님). 상세는 `formDoc`(이미 읽음)에서 같은 함수. 영업이 칸을 안 보내는 옛 원문이면 `false`(보통 건).
  - `isDirectShip({consign, shipType, head})` = `consign.trim() !== '' && (shipType ? shipType.trim() === '직송' : /직송/.test(head))` — `statusDeliverer` 와 같은 결과(QA: 사본 함수와 표로 비교).
- 홈: `loadSalesConfirmCard` 가 읽는 칸에 같은 세 칸을 더해 "준비 안 끝남"(urgent)에서 직송을 뺌. "새로 들어옴"·"영업에서 수정됨"엔 그대로 셈(새 소식이므로).
- 실패: 세 칸이 없으면(없는 JSON 경로는 null — 오류 아님) 직송 아님으로 — 목록이 멈추지 않음.

### 4-A. 연결 저장 (③ `it_sales_confirm_work`)

| `prep_event_id` | `link_source` | 뜻 | 화면 |
|---|---|---|---|
| null | `''` | 아무도 안 정함 | 확실한 짝이 있으면 "자동 연결"로 보임(화면 계산), 아니면 후보·"일정 없음" |
| 일정 id | `'auto'` | 확실한 짝을 저장함(사람이 그 건으로 무언가 할 때) | "연결됨(자동)" + `[풀기]` |
| 일정 id | `'manual'` | 사람이 고름 | "연결됨" + `[바꾸기]` `[풀기]` |
| null | `'none'` | 사람이 "출고 일정과 연결 안 함/자동 끄기" | 자동 연결·"일정 없음" 알림 안 함, 후보는 접어서 |
| null | `'auto'`·`'manual'` | **연결했던 일정이 지워짐**(FK set null — F8) | 주황 "연결했던 일정이 없어졌어요 — 다시 골라 주세요" + 후보 |

- 값은 앱이 검사(DB CHECK 없음 — status 처럼). 목록은 `lib/salesConfirms/types.ts` 상수 한 곳(`PREP_LINK_SOURCES`).
- **쓰기 규칙**(`lib/salesConfirms/prepLink.ts` 한 파일만 ③ 연결 칸을 씀):
  - 연결: `update … set prep_event_id, link_source='manual', updated_by where confirm_id = ? and prep_event_id is not distinct from <화면이 본 값>` → 0줄이면 "다른 사람이 방금 연결을 바꿨어요". ③ 줄이 없으면 insert(`first_opened_at` 은 안 채움 — "새로" 유지, `seen_ver` 는 비워 둠 → 상세를 처음 열 때 지금 규칙대로 채움).
  - 자동 저장(`'auto'`): `… where prep_event_id is null and link_source = ''` 일 때만(사람이 정한 것 안 덮음).
  - 풀기: `prep_event_id = null, link_source = 'none'`(같은 조건부).
  - FK 위반(23503) = "일정이 방금 지워졌어요 — 새로고침".
  - ③ `updated_at` 이 바뀌므로 **응답에 새 `workUpdatedAt`** → 상세 화면이 갱신(H16).
- 일정 하나에 확인서 여럿 = ③ 여러 줄이 같은 id. 확인서 하나에 일정 여럿(나눠 보냄)은 첫 일정에만 — 다른 날 일정은 "같은 확인서가 다른 일정(11/28)에 연결돼 있어요" 안내만, 보고는 그 일정에서 직접(4-1 배포 뒤 실제 건수를 보고 다시 판단).

### 4-B. 짝 찾기 규칙 (`lib/salesConfirms/prepLinkRules.ts` — 순수, import 는 `prepMatch` 정규화·`regionSlot`·`salesForm/confTitle`·`salesForm/confirm` 만)

입력: 확인서(`id·docNo·company·deliveryDate·type·region(+주소 추정)·renderer·formDoc·salesState·status`), 일정(`id·date·time·title·calendarId·isPrepTarget(★·IT)`).

1. **제목 열쇠** `titleKey(t)` = NFKC → `IT/` 부터(없으면 구분 칸 `(위탁)?납품(…)|교체(…)|철수(…)` 부터) → 공백·★☆⭐ 뗌 → 소문자. 확인서 쪽은 `salesTitle` = renderer 별 `titleConf/titleSwap/titleSvc(formDoc)`(따로 보기·옛 원문은 formDoc 이 없어 제목 없음 → 2번부터).
2. **확실(sure)** = `titleKey(일정) === titleKey(salesTitle)` **그리고** 일정 날짜 = 납품일.
3. **후보(strong)** = 상호 맞음 + 날짜 차 ≤ 1 + 구분 맞음 + 지역(둘 다 알면 같아야).
4. **약한 후보(weak)** = 상호 맞음 + 날짜 차 ≤ 3 + 구분 맞음(지역이 둘 다 있고 다르면 뺌).
- **상호 맞음**(H9ⓐ 고침): 일정 제목을 `/` 로 나눈 칸 중 **어느 칸이든** `normCompanyName` 이 같거나, `companyBase`(‘-’ 앞) 가 같음(2글자 이상). 칸 위치를 가정하지 않음.
- **구분 맞음**(H9ⓑⓒ 고침): 확인서 납품 ↔ 일정 납품·위탁납품 / 교체 ↔ 교체 / **유지보수·소프트웨어 ↔ 납품·유지보수**(영업 제목이 '납품') / 철수 ↔ 철수·회수 / 이전·판매 ↔ 구분 안 봄.
- **빼는 것**: 영업에서 지운 확인서(`sales_state='지움'`)·처리여부 취소는 자동 연결 안 함(후보로만, 회색 딱지). 일정 제목이 휴가·직송(`isItPrepTarget` false)이면 뺌. ★ 없는 일정은 후보로는 보이되 "출고 준비 리스트엔 안 보여요(★ 없음)"(H10).
- **자동 연결(화면 계산)** 조건: 확인서에 sure 일정이 **딱 하나**, 그 일정에 sure 확인서가 **딱 하나**, 둘 다 다른 확인서/일정에 사람이 정한 연결이 없음, 확인서 `link_source = ''`.
- **같은 제목 일정이 여럿**(다른 캘린더 복사본): 자동 안 함, "같은 제목 일정 n개 — 복사본일 수 있어요" + 준비 기록·완료 보고가 있는 쪽을 맨 위(예전 `pickLinked` 와 같은 생각).
- 정렬: sure → strong → weak, 그 안에서 상호 통째 같음 → 날짜 가까움 → 시각.
- 출력 모양(타입은 팀장 사전 작업): `{ eventId, grade: 'sure'|'strong'|'weak', dayDiff, regionOfEvent, notPrepTarget, linkedTo?: {confirmId, docNo} }`.

### 4-C. 연결 상태 한 곳에서 정하기 (`prepLink.ts` resolve — 확인서 쪽·일정 쪽 둘 다)

확인서마다 위에서부터 첫 번째: ① 사람이 정함(`manual`/`auto` + 일정 있음) = **연결됨** ② `none` = **끔** ③ `manual`/`auto` + 일정 없음 = **풀림**(F8) ④ 자동 연결 조건 = **자동** ⑤ 후보 있음 = **후보** ⑥ **직송**(F28) = **출고 준비 대상 아님**(알림 없음, 후보가 있으면 접어서) ⑦ 납품일 있음 = **일정 없음** / 납품일 없음 = **모름**.
일정마다: 연결된 확인서들(①·④) + 후보 확인서들.
- 읽기 범위: 확인서 쪽은 납품일 ±3일 IT 일정(지금 `loadPrepHints` 와 같음). 일정 쪽은 **화면에 보이는 일정만**(출고 준비 리스트의 그날 줄, 보통 5~20개) — 그 날짜 ±3일 확인서의 가벼운 칸(`id·doc_no·company·delivery_date·type·region·address·sales_state`) + ③ 연결 칸을 읽고, 상호가 맞는 것만 payload 를 읽어 제목을 만듦(payload 는 서버 안에서만 — 화면으로 안 보냄).
- 1000줄: ③ `.in('prep_event_id', ids)` 200개씩, 확인서 날짜 범위는 페이지로 끝까지.

### 4-D. 확인서 기기 → 완료 보고 기기 (4-2, 순수 `prepUnitsFromLines` + 서버 `linkedReportSource(eventId)`)

- 대상 확인서 = 그 일정의 연결됨·자동(4-C). 둘 이상이면 문서번호 순으로 합침, 같은 자산번호는 한 번.
- **모드**: 대상 확인서에 장비·모니터·기타 칸이 하나라도 있으면 **확인서 모드**, 없으면(유지보수·소프트웨어만·따로 보기) **예전 모드**(보고 창에서 직접 — 지금 그대로).
- 칸 → `PrepUnit`(F11): `assetId` = ④ asset(대문자) · `serial` = ④ serial · `model` = `[출고 제조사 || 영업 제조사, 출고 모델 || 영업 모델]` · `gubun` = IT재고 구분 · `spec` = IT가 고친 사양이 있으면 출고 사양 요약(목록 `specSummary` 와 같은 꼴), 없으면 IT재고 사양 · `category` = IT재고 품목 || 영업 품목구분 · `grade` = 예전 보고의 같은 자산번호 값. 자산번호도 시리얼도 없는 칸은 안 넣음. "영업에서 빠진 칸"은 안 넣고 개수만 알림.
- **언제**: `getPrepReport` 가 확인서 모드면 `linked: { confirms:[{id, docNo}], units, skipped:{svc, orphan}, reportOnly: [보고에만 있는 자산번호] }` 를 같이 돌려줌(창이 보기만). `savePrepReport`·`sendPrepReport` 는 **서버가 다시 만들어** `units` 에 저장(화면이 보낸 units 는 무시) + 자동 짝이면 `'auto'` 저장(4-A). 서버가 확인서를 못 읽으면 **화면이 보낸 units(=창에 보이던 확인서 기기)로 저장·발송** + `linkWarning`(F23).
- 확인서 모드에서 기기 0대로 처음 발송하면 확인 창("확인서에 기기가 없어요. 기기 없이 보낼까요?").
- **보고 뒤 바뀜**(F13): 보낸 보고(`sent_at`)의 `units` 자산번호·시리얼 묶음 ≠ 지금 확인서에서 만든 묶음 → 표시만.
- **보고에만 있는 기기 → 확인서**(F12): `importReportUnitsToConfirm(confirmId, eventId)` — 보고 units 중 확인서에 없는 자산번호를, IT재고 품목(노트북·데스크탑 → 장비, 모니터 → 모니터, 나머지 → 기타)으로 같은 종류 빈 칸에 차례로(자산번호·시리얼만, `item_snapshot` = 지금 영업 품목, ④ 줄 없으면 만듦 — `insertUnit`/`updateUnitIf` 재사용, 동시 수정 규칙 그대로). 갈 칸이 없으면 남김.

### 4-E. 처리여부 따라가기 (4-3, 순수 `followPrepChecks(work, prepChecks, reportSent)`)

| 출고 준비 쪽 | 확인서 ③ (앞으로만) |
|---|---|
| 누가 `준비중`(또는 그 뒤 완료) | 처리여부 접수 → **준비중**, `started_at` 비었으면 가장 이른 시작 시각 |
| 누가 `완료`(인수 아님) 또는 완료 보고 발송 | 접수·준비중 → **준비완료**, `finished_at` 비었으면 완료 시각 |
| 단추 누른 사람(오버홀 포함, 인수 처리된 사람 포함) | 처리자에 더함(최대 5, 빼지 않음) |
| 단추를 끔 | 안 바꿈 |
| 처리여부가 출고·보류·취소 | 안 바꿈 |

- 어디서: 출고 준비 리스트 단추 → `setPrepStage` 끝 `after(() => followPrepToConfirms(eventId))`(DB 만). 확인서 상세 단추 → `setPrepStageFromConfirm`(같은 `setPrepStage` + 따라가기를 바로 → 새 `workUpdatedAt` 돌려줌) → 화면이 제목 태그 라우트를 따로 부름(지금 목록과 같은 방식). 발송 → `sendPrepReport` 끝에 같은 따라가기.
- 따라가기는 ③ 조건부 update(읽은 `updated_at`), 0줄이면 한 번 다시 읽고 끝(실패는 서버 로그 code 만 — 단추 저장을 막지 않음).

### 4-F. 체크 모아 보기 (4-3, 순수 `checklistSummary(lines, units, workChecks, items)`)

- 이 건에 해당하는 묶음 = 확인서 칸에 있는 기기별 묶음(데스크탑&노트북·모니터 — `checkGroupFor`) + 기타. (지금 보고 창은 일정 제목 글자로 고름 — 확인서 모드에선 칸 기준.)
- 기기별 묶음 항목 = 그 묶음의 **모든 칸**이 체크해야 "다 됨", 기타 항목 = ③ `checks` 에 있으면 "다 됨".
- 카톡 "체크리스트 x/y" = 다 된 항목 수 / 해당 항목 수, 보고 `checked_items` = 다 된 항목(보고 줄에도 의미 있는 값). 창에는 묶음별 "3대 중 2대 다 끝남"과 `[확인서에서 체크]`.

### 4-G. SQL 이 없는 이유와 실패할 때

- 쓰는 칸: ③ `prep_event_id`·`link_source`(1단계 SQL 로 있음 — H6), ③ `status`·`processors`·`started_at`·`finished_at`(있음), ④(있음), 완료 보고 `units`·`checked_items`(있음).
- 연결한 사람·시각을 따로 남기지 않음(③ `updated_by`·서버 로그로 충분하다고 봄). 나중에 필요하면 그때 칸 추가(이번 범위 밖).
- 확인서 표가 없음(42P01/PGRST205 — `isMissingSalesTable`): 출고 준비 쪽은 배지 없음·보고 예전 모드(아무 안내 없음). 그 밖의 오류: 배지 자리 "확인서 정보를 못 읽었어요(잠시 뒤 다시)", 보고는 F23. 로그엔 code 만(payload·연락처 금지 — 기존 규칙).
- 시트: 보고 줄 만들기의 구분·사양은 5분 색인(차가우면 IT재고 5개 탭 읽기 — 지금 보고 창 자동 채움과 같은 부담). 새 시트 쓰기 없음.

---

## 5. 화면 흐름

### PC (사무실 — 보통 출고 전날)
0. (4-0) `확인서/출고및반출준비` 를 열면 맨 위 **"준비하는 날 [오늘] → 11/30(월) 납품분"** + 카드(🚨 준비 남음 · ✅ 준비 완료 · 전체) + 그날 건이 지역 순으로. 위 항목 `[출고 준비 확인서] [직송] [철수·이전·판매]`. 다른 날짜 새 확인서는 위 한 줄 `[보기]`.
1. 목록 — 줄 끝 **출고 준비** 칸(4-1): `11/28 15시 수도권C · 자동 연결` / `후보 1 [연결]` / `일정 없음`(주황) / `연결 풀림`. 칩 `출고 일정 없음 n`.
2. 상세 — 맨 위 **출고 준비 상자**: 연결된 일정(날짜·시각=지역·제목), 준비 상태(4-3 부터 단추), 완료 보고 상태(사진 n장·카톡 보냄·재고 문제 n대·보고 뒤 바뀜), `[📷 완료 보고]`(4-2), `[출고 준비 리스트에서 보기 →]`.
3. 기기 칸 입력(지금 그대로) → 기기마다 체크.
4. `🖨 확인서 출력`(지금 그대로).

### 핸드폰 (창고)
1. 홈 화면 앱 → `출고 준비 리스트`(내일 출고분 카드 — 지금 그대로).
2. 카드에 한 줄 `📋 확인서 D-…  자산 1/3 · 체크 40/60 →`(4-3 부터 체크) — 누르면 확인서 상세. 확인서가 없으면 지금처럼.
3. 상세(핸드폰 카드 화면): 출고 준비 상자의 **내 이름 `준비중`**(4-3, 네이버 제목에 이름) → 기기마다 자산번호(IT재고 자동 채움)·체크.
4. 다 되면 `완료` → `📷 완료 보고` — 기기는 이미 채워져 있음(보기만) → 사진 찍어 올리기 → `✅ 완료 · 카톡 발송`.
5. 창 아래 "📦 IT재고 반영" 확인(지금 그대로).

(4-0 핸드폰: 확인서 목록도 출고 준비 리스트처럼 맨 위 날짜 줄 + 카드 3개(한 줄에 3칸) + 그날 건 카드. 날짜 줄·위 항목은 접지 않음(필터 접기 `MobileFilterRows` 밖), 나머지 필터는 지금처럼 접힘.)

### 화면별 바뀌는 것 (단계)
| 화면 | 4-0 | 4-1 | 4-2 | 4-3 | 4-4 |
|---|---|---|---|---|---|
| 출고 준비 리스트(PC 표·핸드폰 카드) | — | `📋 확인서` 배지(연결·자동·후보 `[연결]`·없음), `?event=<id>` 로 그 일정 열기 | 배지에 "보고 뒤 바뀜" | 배지에 체크 진행, 단추 컴포넌트 공용화 | 일정 없는 확인서 회색 줄 |
| 완료 보고 창 | — | — | 확인서 모드(기기 보기만·옮기기·0대 확인·복사본 경고) | 체크 모아 보기 | — |
| 확인서 상세 | 직송 띠 | 출고 준비 상자(연결·풀기·후보·풀림·일정 없음) | `📷 완료 보고` 단추·보고 상태 | 준비 단추, 처리여부 칩 옆 "출고 준비 단추를 따라가요" | — |
| 확인서 목록 | 준비하는 날 줄·카드 3개·날짜 밖 소식·`직송` 항목 | 출고 준비 칸·칩 `출고 일정 없음` | — | — | `🗂 예전 방식` 접기(조건 충족 때) |
| 홈 | 영업 확인서 "준비 안 끝남"에서 직송 뺌 | 알림 한 줄씩(F18) | — | — | — |

핸드폰 규칙: 새 표는 `m-cards` + `data-m`(출고 준비 칸 = `sub`), 상자 단추는 큰 버튼(지금 `personButtons(big)` 과 같은 크기), 입력 16px, 완료 보고 창은 아래 시트(지금 CSS). JSX 삼항 안 `{/* */}` 금지.

---

## 6. 예전 방식(`?view=legacy`, `lib/confirmLink.ts`)과의 관계

- 4단계 동안 **코드·동작 그대로**: 예전 시트 확인서 저장 → 보고 기기 채우기(`pushDocToPrep`), 보고 저장 → 예전 시트 칸 채우기(`syncPrepToConfirm`).
- 같은 출고에 시트 확인서와 영업 웹앱 확인서가 **둘 다** 있으면: 보고 기기는 영업 확인서가 원본(4-2 서버가 저장 때 다시 만듦 — `pushDocToPrep` 가 넣은 값은 다음 저장에서 바뀜), 시트 칸은 그 보고 기기로 지금 규칙대로 채워짐(사람이 다른 번호를 적은 묶음은 안 건드림). 설명서에 "영업 웹앱 확인서가 있으면 그쪽에 적으세요".
- 빼는 순서(F20): 4-4 에서 "시트에만 있는 건 2주 연속 0" 확인 → 사용자 확인 → 칩 접기 → 한 달 뒤 `confirmLink`·`savePrepReport` 의 `after()` 시트 채우기·예전 컴포넌트 정리(따로 설계, integration-rules — 시트 쓰기를 없애는 일). `/dispatch`(출고 대장)는 이번 범위 밖.

---

## 7. 단계 나누기 (작게 배포)

| 단계 | 내용 | SQL | 외부 쓰기 변화 | integration-rules | 배포 뒤 확인(팀장, 값 출력 금지) |
|---|---|---|---|---|---|
| **4-0 오늘 준비할 것·직송 따로(먼저, 작은 일)** | F25~F30: 확인서 목록 준비하는 날·카드·날짜 밖 소식·직송 항목, 상세 직송 띠, 홈 숫자에서 직송 뺌 | **없음** | **없음**(읽기·화면만, 출고 준비 코드 안 건드림) | **아니오** | 11/30(월) 납품분 **건수**가 출고 준비 리스트 11/30 출고분과 비슷한지, 직송 건수(0 이면 영업이 위탁·직송 칸·앞머리글을 안 채우는지 확인) |
| **4-1 연결·서로 보이기** | 짝 찾기 규칙(F3·H9 고침), 연결·풀기·끄기, 확인서 상세 출고 준비 상자, 목록 칸·칩, 출고 준비 배지·`?event=`, 복제본 정리 기록, 홈 알림 | 없음 | 없음(③ 만) | 가볍게(복제본 정리 기록 세기 diff) | 확인서 목록의 상태별 **건수**(자동·후보·없음) → H8(영업이 제목을 그대로 쓰는지) 판단. 확인서 하나에 sure 일정 2개 이상 / 다른 날 후보가 있는 건 수 → 나눠 보냄 빈도 |
| **4-2 기기 한 번만** | 보고 확인서 모드(F9~F14·F22·F23), 상세에서 완료 보고, 옮기기, 처음 발송 서버 막기 | 없음 | 카톡·IT재고는 같은 경로, **넣는 기기 목록만** 확인서에서 | **구현 전·후 필수** | 실제 1건: 상세에서 보고 → 카톡 문구의 기기 = 확인서 기기, 재고 반영 상자 정상(문구는 화면으로만 확인) |
| **4-3 준비 단추·체크 한 번만** | 상세 준비 단추(제목 태그 같은 함수), 처리여부 따라가기(F15), 체크 모아 보기(F16) | 없음 | 제목 태그를 새 화면에서 부름, 카톡 체크 숫자 출처 | **구현 전·후 필수** | 상세에서 `준비중` → 네이버 제목 태그·출고 준비 리스트 단추·확인서 처리여부 셋이 맞는지 |
| **4-4 한 목록·정리**(써 본 뒤, Q3 답에 따라) | 일정 없는 확인서 회색 줄(F24), 예전 방식 칩 접기 판단(F20) | 없음 | 없음 | 아니오(시트 쓰기를 없앨 때 따로) | — |

배포마다: 커밋·푸시 전후 deploy-check. SQL 실행 단계 없음. 4-0 은 4-1 과 상관없이 바로(설계 승인 = 4-0 바로 시작 가능). 4-2·4-3 은 앞 단계를 며칠 써 본 뒤(4-1 의 건수로 F3·F4 를 고칠 수 있게).

---

## 8. 작업 분해 (단계별 · 파일 단위 · 겹침 없이)

### 4-0 (작은 일 — 기획·디자인을 다시 안 거침. 팀장 + developer 1 + ui-designer 1 + qa-checker)
| 누가 | 할 일 | 파일 |
|---|---|---|
| 팀장 사전 | 타입: `SalesConfirmListRow.directShip?`·`consignName?`, 상세 데이터 `directShip?`·`consignName?`, 목록 항목 키 `'direct'` | `lib/salesConfirms/types.ts` |
| developer A | `isDirectShip`(순수) + `statusDeliverer` 와 같은지 Node 표 비교, `nextBusinessDay` 를 순수 파일로 옮김(홈은 import — 결과 같음), 목록 서버가 세 칸 읽고 `directShip`·`consignName` 채움, 상세에서 `formDoc` 으로 같은 판정, 홈 "준비 안 끝남"에서 직송 뺌 | `lib/salesConfirms/deliveryMode.ts`(새), `lib/businessDay.ts`(새), `lib/salesConfirms/listQuery.ts`, `lib/salesConfirms/work.ts`, `lib/homeDashboard.ts` |
| ui-designer | 준비하는 날 줄(출고 준비 리스트와 같은 글자·자리: 날짜 · `오늘` · `전체` · "→ 11/30(월) 납품분"), 카드 3개(누르면 거름), 날짜 밖 소식 한 줄, 위 항목 `직송`(매입처 칸·안내 띠 "우리를 안 거치고 매입처에서 바로 가는 건 — 출고 준비 숫자에서 빠져요"), 상세 직송 띠, 핸드폰(카드 3칸·`m-cards`·날짜 줄은 접지 않음) | `components/salesConfirms/SalesConfirmListPage.tsx`, `components/salesConfirms/SalesConfirmTable.tsx`, `components/salesConfirms/SalesConfirmDetail.tsx`, `app/globals.css` |
| 팀장 | 설명서 `confirm-form` 새 꼭지 **`sales-today` "오늘 준비할 것 · 직송"** + `updated`, releases, CLAUDE.md "영업 확인서" 절에 두 줄 | `lib/manual/docs/shipping.ts`, `lib/releases.ts`, `CLAUDE.md` |
| qa-checker | §9 QA 4-0 | — |
| 안 부름 | db-schema·sql-review(SQL 없음), integration-rules(외부 쓰기 없음) | — |

### 4-1
| 누가 | 할 일 | 파일 |
|---|---|---|
| 팀장 사전 | 타입·상수: `PREP_LINK_SOURCES`, `PrepLinkGrade`, `PrepLinkCandidate`, `PrepLinkState`(4-C 상태), `SalesConfirmDetailData.prepLink`(`prepHints` 대신), 목록 줄 `prepBadge?`, 일정 배지 `PrepConfirmBadge` 타입, 액션 입출력 주석 | `lib/salesConfirms/types.ts` |
| db-schema | **SQL 없음 판단 확인만**(15분): ③ `link_source` 값 규칙·FK set null·부분 색인으로 `.in('prep_event_id')` 충분한지. 파일엔 **주석만** 추가(값 목록 — 실행할 것 없음) | `supabase/sales_confirms_schema.sql`(주석) |
| developer A | 짝 규칙(순수) + Node 로 돌려 보기(스크래치패드), 서버 읽기·연결 쓰기 한 곳, 상세 읽기에서 `loadPrepHints` → prepLink | `lib/salesConfirms/prepLinkRules.ts`(새), `lib/salesConfirms/prepMatch.ts`(정규화만 남기고 규칙 이동), `lib/salesConfirms/prepLink.ts`(새, server-only), `lib/salesConfirms/work.ts` |
| developer B | 액션(연결·풀기·끄기·목록 배지·일정 배지), 출고 준비 화면 연결(배지 불러오기·`?event=`·연결 팝업 열기), 복제본 기록, 홈 알림 | `app/confirm-form/prepLinkActions.ts`(새 'use server' — async 만 export), `components/shipmentPrep/ShipmentPrepPage.tsx`, `app/shipment-prep/page.tsx`, `app/calendar/duplicateActions.ts`, `lib/homeDashboard.ts` |
| ui-designer | 출고 준비 상자(상태 6가지·후보 고르기·`[출고 일정 없음으로 두기]`), 출고 준비 배지 + 연결 고르기 팝업(행동은 props), 목록 칸·칩, 상세에 상자 끼우기(연결 뒤 `workUpdatedAt` 갱신), CSS·핸드폰 | `components/salesConfirms/PrepLinkPanel.tsx`(새), `components/salesConfirms/PrepHintBox.tsx`(지움), `components/shipmentPrep/PrepConfirmBadge.tsx`(새), `components/salesConfirms/SalesConfirmTable.tsx`, `components/salesConfirms/SalesConfirmListPage.tsx`, `components/salesConfirms/SalesConfirmDetail.tsx`, `app/globals.css` |
| integration-rules | `duplicateActions.ts` 기록 세기 diff(지우기 판단이 더 보수적으로만 바뀌는지) | — |
| qa-checker | §9 QA 4-1 | — |
| 팀장 | 설명서 두 개·releases·CLAUDE.md(§9 끝) | `lib/manual/docs/shipping.ts`, `lib/releases.ts`, `CLAUDE.md` |

### 4-2
| 누가 | 할 일 | 파일 |
|---|---|---|
| 팀장 사전 | 타입: `LinkedReportSource`, `PrepReport.linked?`, 액션 결과 `linkWarning` | `lib/salesConfirms/types.ts`, `lib/shipmentPrep.ts`(타입만) |
| developer C | `prepUnitsFromLines`(순수)·`linkedReportSource`(서버), 보고 읽기·저장·발송에 확인서 모드·`'auto'` 저장·처음 발송 서버 막기·`linkWarning`, `getPrepEventRow`, 옮기기 액션, 상세 시간 한도 300 | `lib/salesConfirms/prepLinkRules.ts`, `lib/salesConfirms/prepLink.ts`, `app/shipment-prep/reportActions.ts`, `app/shipment-prep/actions.ts`(함수 하나 추가), `app/confirm-form/prepLinkActions.ts`, `app/confirm-form/[id]/page.tsx` |
| ui-designer | 보고 창 확인서 모드(기기 목록 보기만·`[확인서에서 고치기]`·보고에만 있는 기기·0대 확인·복사본 경고·`linkWarning` 주황 알림), 상세 상자에 `📷 완료 보고`·보고 상태·보고 뒤 바뀜, 상세에서 창 띄우고 닫힌 뒤 다시 읽기 | `components/shipmentPrep/PrepReportModal.tsx`, `components/salesConfirms/PrepLinkPanel.tsx`, `components/salesConfirms/SalesConfirmDetail.tsx` |
| integration-rules | **구현 전**: 카톡 문구·`stockTargetIds`·`applyStockUnit` 경로가 안 바뀌는지 기준 정함. **구현 후**: `reportActions.ts` diff — 처음 발송 막기, `units` 바꿔 넣기 위치(저장 전), 실패 때 경로, `after()` 시트 채우기 그대로 | — |
| qa-checker | §9 QA 4-2 | — |

#### 4-2 연동 규칙 기준 (integration-rules 구현 전 검사 2026-11-27 — 이 기준이 위 표보다 우선)
- **바뀌면 안 되는 것**: 카톡 KAKAO_ROOM·enqueueOutbox 본문·buildPrepMessage(units 값만 다름), stockTargetIds(납품·교체만, 철수 제외)·retryPrepStock 철수 거절·6대 한도,
  applyStockUnit(읽은 줄 자산번호 ≠ id 면 안 씀, 임대중+같은 tag 면 이력 중복 안 씀, not_found/error 구분)·recordStockOutcome(stock_applied·stock_issues), 순서 = 보고 저장 → after() 재고,
  공개 앨범 report.id(보고 행을 지우고 다시 만들지 말 것), savePrepReport 의 after(syncPrepToConfirm)·lib/confirmLink.ts 조건. 보낸 뒤 확인서 변경은 표시만(자동 재발송·재반영 금지).
- **units 교체 위치 = savePrepReport 안 update 직전 한 곳**(sendPrepReport 는 저장 뒤 DB 를 다시 읽으므로 모든 경로가 같은 사본). 정규화는 지금과 같게(trim·자산번호 대문자·같은 번호 1회),
  grade 는 DB 기존 값 유지. 교체는 확인서 읽기 성공 + 장비·모니터·기타 칸 ≥1 일 때만(유지보수·소프트웨어만이면 draft 그대로). "연결됨" = ③ 저장 연결 또는 확실 자동만(후보로 덮지 말 것).
  자산번호·시리얼 있는 칸 0대면 거절하지 말고 draft 그대로 + 화면 "0대 확인 창"을 거친 요청만.
- **확인서 읽기 실패**: "연결 없음"과 구분. 실패면 draft.units 로 계속 + 결과 warning(naverWarning/sheetWarning 방식, lib/syncFailure.ts) → 화면 주황 알림. 단 send/resend 에서 draft.units 가 비어 있으면 거절. 로그는 code 만.
- **처음 발송 서버 막기**: mode==='send' 이면 enqueueOutbox 전에 `update({sent_at: now}).eq('id', report.id).is('sent_at', null).select('id')` 0행이면 "이미 보냈어요" 거절,
  enqueue 실패면 `.eq('sent_at', 내가 쓴 값)` 으로만 null 되돌림(되돌림 실패도 알림). 이미 보낸 보고의 send 거절은 savePrepReport **보다 먼저**(보낸 뒤 사본이 안 바뀌게). resend/fix 는 안 막음.
- 반복문 안 시트·DB 호출 금지(한 번 색인), outbox INSERT 요청당 1회, after() 두 개 그대로, app/confirm-form/[id]/page.tsx maxDuration 60 → 300, 가져오기 코드는 ③④ import 금지(확인서 읽기는 별도 server-only).
- 구현 후 integration-rules 체크리스트 12개(위 항목 + confirmLink 무변경·설명서/releases/CLAUDE.md 에 "카톡·IT재고에 쓰는지" 명시).

### 4-3
| 누가 | 할 일 | 파일 |
|---|---|---|
| 팀장 사전 | 타입: `PrepFollowResult`, 체크 요약 타입 | `lib/salesConfirms/types.ts` |
| developer D | `followPrepChecks`·`checklistSummary`(순수), `followPrepToConfirms`(서버), `setPrepStage` 끝 `after()`(+ 선택: 조건부 저장으로 H13 막기), `setPrepStageFromConfirm`, 발송 때 체크 수·따라가기 | `lib/salesConfirms/prepLinkRules.ts`, `lib/salesConfirms/prepFollow.ts`(새, server-only), `app/shipment-prep/actions.ts`, `app/shipment-prep/reportActions.ts`, `app/confirm-form/prepLinkActions.ts` |
| ui-designer | 준비 단추를 공용 컴포넌트로 빼서 두 화면에서 씀(모양 그대로), 상세 상자 단추·처리여부 칩 안내, 보고 창 체크 모아 보기, 출고 준비 배지 체크 진행 | `components/shipmentPrep/PrepStageButtons.tsx`(새), `components/shipmentPrep/ShipmentPrepPage.tsx`, `components/shipmentPrep/PrepConfirmBadge.tsx`, `components/salesConfirms/PrepLinkPanel.tsx`, `components/salesConfirms/SalesConfirmDetail.tsx`, `components/shipmentPrep/PrepReportModal.tsx` |
| integration-rules | 전: 제목 태그를 상세에서 부를 때 규칙(같은 라우트, 연달아 누르면 마지막 결과만). 후: `actions.ts`·`reportActions.ts` diff | — |
| qa-checker | §9 QA 4-3 | — |

### 4-4 (써 본 뒤 — 사용자 답 Q3 에 따라)
- developer: 일정 없는 확인서 읽기(새 함수, `listPrepEvents` 모양 안 바꿈) · ui-designer: 출고 준비 리스트 회색 줄 · 팀장: 예전 방식 칩 접기 판단·사용자 확인. 시트 쓰기 정리는 따로 설계.

---

## 9. 위험 · QA · 문서

### 위험
1. **잘못 짝지음 → 다른 건 기기가 카톡·IT재고로 감.** 자동은 제목+날짜가 다 같을 때만(F3·F4), 나머지는 사람. 보고 창 맨 위에 "확인서 D-… 기기 n대를 보내요". `[풀기]` 한 번.
2. **IT재고 두 번 반영**: 같은 보고는 `stock_applied` 로 막힘(그대로). 복사본 일정 두 곳에서 보고 → F14 경고. 다른 날 같은 자산 재발송은 비고 이력이 두 번(지금도).
3. **카톡 두 번**: 처음 발송 서버 막기(F14). 사람이 `수정해서 다시 보내기`를 누르는 건 그대로.
4. **네이버 복제본**: 새 네이버 쓰기 없음(F19). 영업·IT에 "네이버에서 일정을 지우고 새로 만들지 마세요(완료 보고·사진이 사라져요)" 설명서 유지. 일정이 지워지면 연결 풀림 표시(F8). 복제본 정리가 연결된 줄을 안 지움(F21).
5. **동시 수정**: 연결은 조건부 update, ③ 바뀌면 `workUpdatedAt` 갱신(H16), 따라가기 실패는 단추 저장을 막지 않음. 준비 단추 동시 누름(H13)은 4-3 에서 조건부 저장으로 고칠지 선택.
6. **보고 뒤 확인서가 바뀜**: 표시만(F13), 바뀐 자산의 예전 번호는 IT재고에 '임대중'으로 남음(지금 `고치기만` 과 같은 한계 — 설명서에).
7. **상세에서 보내면 재고 반영 끊김**: 시간 한도 300(F22). QA 가 설정 확인.
8. **확인서 표 문제로 카톡이 멈춤**: F23(막지 않고 창에 보이던 기기로).
9. **자동 연결이 조용히 바뀜**(영업이 제목을 고침): 자동은 저장 전엔 화면 계산 — 사람이 무언가 하는 순간 `'auto'` 로 굳음. 보고 창은 늘 어느 확인서인지 보여 줌.
10. **★ 없는 일정에 연결**: 출고 준비 리스트엔 안 보임 → 상자에 "★ 없음 — 영업에 별표 부탁" + 상세에서 완료 보고는 열림(4-2).
11. **속도**: 배지는 보이는 줄만, payload 는 상호가 맞는 것만, 목록 60초 가져오기 고리에 안 넣음(목록 열 때·5분마다).
12. **개인정보**: 배지·상자에 연락처·주소 없음(상호·문서번호·날짜만). payload·연락처는 로그·응답에 금지(기존 규칙).
13. **예전 방식과 둘 다 있음**: §6 — 시트 칸은 보고 기기로 채워짐(그대로), 설명서에 "영업 웹앱 확인서가 있으면 그쪽에".
14. **카톡 내용이 달라 보임**(연결된 건의 모델·사양이 확인서 값) — releases·설명서에 미리.
15. **유지보수 건은 보고 기기 0대가 될 수 있음** → F10 으로 유지보수·소프트웨어만 있는 건은 예전 모드(직접 적기).
16. **(4-0) 공휴일**: 다음 영업일은 주말만 건너뜀(출고 준비 리스트·홈과 같음) — 공휴일 전날엔 `준비하는 날`을 직접 골라야. 토요일 납품은 "오늘 준비할 것"에 안 잡힘(출고 준비 리스트도 같음) → 설명서에.
17. **(4-0) 두 화면 숫자가 다름**: 확인서 카드는 처리여부, 출고 준비 카드는 준비 단추 기준 — 4-3 전까지 다를 수 있음(설명서에 한 줄). 확인서 납품일과 네이버 일정 날짜가 다른 건도 다르게 셈.
18. **(4-0) 직송 판정이 영업 값에 달림**: 영업이 위탁·직송 칸과 앞머리글을 안 채우면 직송이 보통 건으로 섞임 → 배포 뒤 건수 확인, 필요하면 영업에 부탁(§11). 출고 준비 리스트(제목 키워드)와 다르게 가를 수 있음 → F30.
19. **(4-0) 기본 보기가 날짜로 좁아짐**: 새로 들어온 다른 날짜 확인서를 못 볼 수 있음 → F27 한 줄 + `[전체]`.

### QA 목록
- **4-0**: 11/27(금) → 11/30(월), 토·일에 열면 → 월, 월 → 화, 날짜 골라 바꾸기, `[전체]` = 예전 목록 그대로(날짜 칩·기본 보기) / 카드 숫자에 직송·지움·취소·철수·이전·판매 안 셈, 카드 누르면 거름 / 지역 순(A→E, 모름은 끝, 추정 지역 포함) / 날짜 밖 소식 숫자 / `isDirectShip` 표(위탁사 없음·`shipType` 직송·위탁·빈 칸+앞머리글 직송·위탁사 없이 앞머리글 직송 = 아님)가 사본 `statusDeliverer` 와 같은 결과, 납품(맨 위)·교체·유지보수(`doc` 안) 경로, 칸 없는 옛 원문 → 보통 건 / 목록 응답에 payload 통째 안 실림(세 칸만) / 직송 항목 줄 매입처, 상세 직송 띠, 직송 상세에서도 기기 칸·출력 그대로 / 홈 "준비 안 끝남"에서 직송 빠짐 / `nextBusinessDay` 옮긴 뒤 홈 출고 준비 카드 날짜 그대로 / 핸드폰(≤640px): 날짜 줄·카드 3칸·위 항목 3개 줄바꿈, 입력 16px.
- **공통 grep**: 가져오기 코드(`importer`·`normalize`·`source`·`app/api/sales-confirms/import`)가 ③④·`prepLink`·`prepFollow` 를 import 안 함 / 새 파일에 `naverPutEvent`·`putEventByHref`·`deleteEventByHref`·`createEvent`·`enqueueOutbox`·`updateAssetInSheet` 없음(4-3 의 제목 태그는 기존 라우트를 화면이 부름) / payload·contacts 가 로그·응답에 없음 / 영업 사본(`salesForm/*`) 안 바뀜.
- **4-1 순수(Node)**: 제목 열쇠(앞 태그 `홍길동준비중 `·앞머리글 `전일연락필수-`·★·⭐·위탁·`IT/` 없는 제목) / 상호(유입경로 빈 제목·위탁·유지보수 제목·`상호-현장`·㈜) / 구분(유지보수·소프트웨어 ↔ 납품, 교체, 철수·회수, 이전·판매) / 지역(둘 다·한쪽만) / 날짜(0·1·3·4일) / 복사본 2개 / 일정 하나에 확인서 둘 / 지운 확인서·취소 / 상태 판정 6가지 + 풀림.
- **4-1 화면**: 연결·풀기·끄기 → 목록·상세·출고 준비 배지가 같이 바뀜, 두 탭에서 동시에 연결 → 한쪽 "다른 사람이 바꿨어요", 연결 뒤 상세에서 비고 저장해도 가짜 충돌 없음, `?event=` 로 그 일정 열림, 확인서 표 없음·읽기 실패 때 출고 준비 리스트 정상, 복제본 정리 미리보기에서 연결된 줄 = 기록 있음, 홈 알림 숫자(지운 건·따로 보기·끔 빠짐).
- **4-2**: 연결된 납품 건 발송 → 카톡 문구 기기 = 확인서 장비·모니터·기타(자산번호·시리얼 있는 칸), 재고 대상 = 그 자산번호, `고치기만`·`다시 보내기`·`재고 다시 반영` 그대로 / 교체 → 교체 후 칸 / 유지보수만 있는 건 → 예전 모드 / 0대 확인 창 / 보고에만 있는 기기 옮기기(종류 맞는 빈 칸, 남는 것 표시, 차이 확인 창 안 건너뜀) / 두 탭 처음 발송 → 두 번째 거절 / 서버가 확인서를 못 읽게 만든 경우 → 창의 기기로 발송 + 주황 알림 / 상세 페이지 `maxDuration` 300 / 공개 앨범 그대로 / 예전 시트 채우기 `after()` 그대로 돎(예전 방식 회귀) / 보고 뒤 바뀜 표시.
- **4-3**: 상세 `준비중` → 네이버 제목 태그·출고 준비 리스트 단추·확인서 처리여부(접수→준비중)·처리자 / `완료`·발송 → 준비완료 / 보류·취소·출고는 안 바뀜 / 단추 끄면 그대로 / 출고 준비 리스트에서 누른 것도 확인서가 따라감(응답 뒤) / 카톡 체크 숫자 = 모아 보기 숫자 / 412·태그 실패 때 빨간 띠·다시 시도(지금과 같음).
- **핸드폰**(≤640px, 배포 화면 Playwright 덧입히기 — CLAUDE.md 방식): 출고 준비 카드 배지 한 줄, 상세 상자 큰 단추, 상세에서 띄운 보고 창이 아래 시트, 입력 16px, 목록 카드 `data-m`.
- **회귀**: 홈 두 카드, 확인서 출력, `?view=legacy` 인쇄·저장, 통합 캘린더 고치기·지우기(이번에 안 건드렸는지 diff 로).

### 문서 고칠 곳
- **설명서** `lib/manual/docs/shipping.ts`:
  - `shipment-prep`: `highlights` '확인서'(예전 시트 → 영업 확인서 연결), `daily`(카드 `📋 확인서` → 상세에서 기기·체크 → 완료 보고), `read`(배지 뜻), `links`(확인서 줄), `mobile`, `faq`("기기 칸이 회색이에요" = 확인서에서 고침), `updated`.
  - (4-0) `confirm-form`: 새 꼭지 **`sales-today` "오늘 준비할 것 · 직송"**(준비하는 날 = 다음 영업일, 카드 3개 뜻, `[전체]`, 날짜 밖 소식, 직송 = 매입처에서 바로 — 오늘 준비할 것에서 빠짐·상세는 그대로, 공휴일·토요일 주의, 출고 준비 리스트 숫자와 다를 수 있는 이유), `sales-list` 한 줄, `updated`.
  - `confirm-form`: `sales-what` 의 주황 tip("아직 따로") 지우고 새 꼭지 **`sales-prep` "출고 준비와 같이 쓰기"**(연결 상태 6가지·자동 연결·풀기·일정 없음·완료 보고·준비 단추), `sales-detail`·`sales-faq` 한두 줄, `updated`. 실제 상호·이름 금지(OO상사·홍길동).
  - 꼭지 id 겹치면 빌드가 멈춤 — 새 id 는 `sales-prep` 하나.
- **releases** `lib/releases.ts`: 단계마다 맨 위 쉬운 말 한 항목(4-2 는 "연결된 건은 기기를 확인서에만 적으면 카톡·재고까지 가요", 4-3 은 "준비 단추를 확인서에서도").
- **CLAUDE.md**(4-0): "영업 확인서" 절에 — 목록 기본 = 준비하는 날(오늘 → `nextBusinessDay`, `lib/businessDay.ts` 한 곳 — 홈·확인서 목록이 같이 씀, 출고 준비 화면은 아직 자기 사본), 직송 판정 `isDirectShip`(영업 `statusDeliverer` 와 같은 규칙, 목록은 payload 세 칸만), 직송은 오늘 준비할 것·홈 준비 안 끝남에서 빠지고 상세는 그대로.
- **CLAUDE.md**: 새 절 "영업 확인서 ↔ 출고 준비 (4단계)" — link_source 값·상태 판정 순서·자동 연결 저장 때·보고 기기 규칙(모드·대상 칸·서버가 다시 만듦·실패 때)·따라가기 규칙·처음 발송 서버 막기·상세 maxDuration 300·복제본 정리 기록. 기존 "영업 확인서" 절의 "③ `prep_event_id` 는 4단계용 — 그 전엔 쓰지 말 것" 줄을 새 절 가리키게, "출고 준비 리스트" 절에 "연결된 건의 보고 기기 원본은 확인서" 한 줄.
- 커밋 본문 끝 `투입:` 줄 — 실제로 부른 직원만.

---

## 10. 사용자에게 물을 것

> **사용자 답(2026-11-27)**: Q1 두 메뉴 두고 이어 붙이기 · Q2 네, 한 곳에서만 · Q3 앱은 일정 안 만들고 알림만 · Q5 목록만 따로, 상세는 그대로 — 전부 추천안.
> Q4(자동 연결)는 묻지 않고 추천안(제목·날짜가 다 같을 때만 자동, 틀리면 `풀기`)으로 진행 — 사용자에게 알림.

(질문 5개 — 추천안 먼저, 쉬운 말)

**Q1. 두 화면을 하나로 합칠까요, 이어 붙일까요?**
- **추천: 메뉴 두 개는 그대로 두고 서로 이어 붙여요.** 출고 준비 리스트는 "내일 나갈 일" 보드(핸드폰), 확인서는 "한 건 작업대"(기기·체크·출력). 출고 준비 카드에 `📋 확인서` 줄이 생겨 누르면 바로 그 확인서로 가고, 확인서 위에는 그 건의 출고 일정·준비 단추·`📷 완료 보고`가 붙어요. 한 건 일은 확인서 화면 하나에서 끝나요.
- 이유: 두 목록은 기준이 달라서(네이버 별표 일정 vs 영업이 보낸 확인서) 한 표로 합치면 둘 다 복잡해지고, 지금 손에 익은 핸드폰 화면이 바뀌어요.
- 다른 방법: 메뉴 하나로 합치기 — 화면을 새로 짜야 해서 오래 걸리고, 익숙한 화면이 바뀜.

**Q2. 기기·체크·준비 단추를 각각 "한 곳"에서만 하게 할까요?**
- **추천: 네.** ① **기기(자산번호·시리얼)는 확인서에만** 적어요 — 완료 보고 창은 그걸 가져와 보여 주기만 하고, 카톡 보고·IT재고 '임대중'도 그 값으로 돼요. ② **체크리스트는 확인서의 기기마다 체크 하나**로 — 완료 보고 창은 모아서 보여 줘요. ③ **준비중·완료 단추는 출고 준비 단추 하나**(네이버 제목에 이름 붙는 그것) — 확인서 처리여부가 저절로 따라가요(준비중 → 준비완료, 뒤로는 안 감, 보류·취소·출고는 사람이).
- 이유: 지금은 같은 일을 두 화면에서 두 번 해요. 특히 확인서에만 자산번호를 적으면 카톡·IT재고에 안 가는 구멍이 있어요.
- 다른 방법: 두 곳 다 적게 두고 빈 칸만 서로 채우기 — 두 값이 다를 때 어느 게 맞는지 헷갈려요.
- 참고: 유지보수·소프트웨어만 있는 건은 지금처럼 완료 보고에 직접 적어요(새로 나가는 기기가 아니라서 IT재고를 안 바꿈).

**Q3. 네이버에 출고 일정이 아직 없는 확인서는 어떻게 할까요?**
- **추천: 앱이 네이버 일정을 만들지 않아요.** 기기·체크·출력은 일정 없이 다 되고, 목록·홈에 "내일 납품인데 출고 일정 없음 n건"을 주황으로 띄워 영업에 일정 등록을 부탁해요. (써 본 뒤) 출고 준비 리스트에도 그날 줄에 회색으로 "일정 없음"을 같이 보여 줘요. 원격 설치처럼 출고가 없는 건은 `출고 일정 없음으로 두기`를 누르면 알림이 꺼져요.
- 이유: 앱이 일정을 만들면 영업이 나중에 만든 일정과 두 개가 돼요(예전에 네이버 복제본 문제로 고생한 것과 같은 길).
- 다른 방법: 앱이 앱 캘린더에만 임시 일정을 만들기 — 영업 일정이 생기면 둘이 되어 정리가 필요해요.

**Q4. 제목·날짜가 똑같은 짝은 자동으로 연결할까요?**
- **추천: 네 — 자동 연결로 보여 주고, 틀리면 `풀기` 한 번.** 영업 웹앱이 확인서마다 만드는 제목과 네이버 일정 제목, 날짜가 다 같을 때만 자동이에요. 조금이라도 다르면 "후보"로만 보여 주고 `연결`을 한 번 눌러요.
- 이유: 하루 2~3건이라 매번 누르게 하면 잊기 쉽고, 제목·날짜가 다 같은 짝이 틀릴 일은 거의 없어요.
- 다른 방법: 늘 사람이 한 번 눌러 확정 — 가장 안전하지만 한 단계가 늘어요.

**Q5. 직송 건(우리를 안 거치고 매입처에서 고객사로 바로 가는 것)에 IT가 할 일이 있나요?**
- **추천: 목록에서만 따로 모으고(`직송` 항목), 상세는 지금처럼 열어 둬요.** 매입처에서 시리얼·자산번호를 받으면 적어 둘 수 있고 확인서 출력도 돼요. 빠지는 건 "오늘 준비할 것"과 "준비 안 끝남" 같은 숫자뿐이에요.
- 이유: 직송도 우리 임대 자산이면 자산번호·시리얼을 남겨 둬야 나중에 임대·청구 대조가 쉬워요. 칸을 남겨 두면 안 쓰면 그만이지만, 숨기면 필요할 때 다시 열기 어려워요.
- 다른 방법: 직송은 철수·이전·판매처럼 **보기만**(기기 칸·출력 없음).
- 같이 알려 주세요: 직송인데 위탁사·직송 표시 없이 들어오는 건이 있으면 영업에 "위탁·직송 칸을 골라 달라"고 부탁할게요(그 칸으로 가려요).

**참고 — 진행 순서(질문 아님):** ⓪ 오늘 준비할 것·직송 따로(작은 일 — 바로) → ① 연결·서로 보이기 → (며칠 써 보고) ② 기기 한 번만 → ③ 준비 단추·체크 한 번만 → ④ 한 목록·예전 방식 정리. 단계마다 배포하고 보여 드려요. 이번엔 **SQL 실행이 필요 없어요.** ①만으로도 같은 건을 바로 찾게 되고, 자동 연결이 실제로 얼마나 맞는지 건수로 본 뒤 ②③을 해요(②부터 카톡·IT재고 쪽 코드에 닿아 검사를 단계마다 따로 함).

---

## 11. 영업 쪽에 부탁할 것 (선택 — 답을 기다리지 않고 진행)
1. 네이버 출고 일정 제목을 **영업 웹앱이 만든 확인서 제목 그대로** 써 주기(지금도 그렇게 하는 것으로 보임 — 4-1 배포 뒤 건수로 확인). 시간 문구·담당자 표시는 제목 앞에 붙여도 됨.
2. 확인서를 지우거나 납품일을 바꾸면 네이버 일정도 같이(일정을 **지우고 새로 만들지 말고** 날짜만 옮기기 — 새로 만들면 IT 완료 보고·사진이 사라짐).
3. IT 출고 일정엔 별표(★) — 지금 규칙 그대로.
4. (4-0) 직송 건은 확인서 제목 칸의 **위탁사 + 위탁·직송**을 꼭 골라 주기(그 칸으로 직송을 가름). 네이버 일정 제목 앞머리글에도 "○○ 직송"을 적어 주면 출고 준비 리스트에서도 빠짐.

---

## 12. 하지 않을 것 (범위 밖)
- 네이버에 일정 만들기·고치기·지우기, 확인서 번호를 네이버에 적기, 앱 캘린더 임시 일정(F5·F19).
- (4-0) 공휴일 달력, 출고 준비 리스트의 직송 키워드 바꾸기(F30), 출고 준비 화면의 `nextBusinessDayOf` 사본 정리(4-3 에서 그 파일을 만질 때 같이), 위탁 건 따로 보기, 직송 건 매입처 연락·발주 관리.
- 메뉴 합치기·새 메뉴·`Shell` 변경(F1). 홈 카드 합치기.
- 카톡 문구 모양·방 바꾸기, IT재고 반영 규칙(위치·비고 꼴) 바꾸기, 철수 건 재고 처리, **교체 회수 기기 자산번호 기록·IT재고 회수 반영**(E19 — 따로 설계).
- 완료 보고 없이 카톡·재고 반영(일정 없는 확인서에서) — 완료 보고는 일정이 있어야 함(표 구조 그대로).
- 확인서 하나를 여러 일정에 나눠 연결(나눠 보냄) — 4-1 건수를 보고 따로.
- 연결 기록용 새 칸(연결한 사람·시각·당시 일정 제목), 새 표.
- 예전 방식·`/dispatch` 코드 삭제(4-4 판단 뒤 따로), 시트 쓰기 정리.
- 서명 받은 종이 사진 따로 보관(지금 완료 보고 사진에 '확인서' 항목이 있음).
- 로그인·개인정보 잠금(D7 그대로).
- 영업 쪽에 쓰기(D4 그대로).
