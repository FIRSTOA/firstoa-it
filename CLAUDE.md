# firstoa-it 메모

## AI 에이전트 팀 (팀장 규칙) — 2026-11-19

참고: CS팀 FIELD 웹앱(GitHub FIRSTOA/FIRSTOA-field-webapp-MG)의 "FIELD AI 에이전트 팀"을 IT 웹앱에 맞춰 꾸림
(사용자 결정: 실제로 일하는 팀 + 홈 카드, 밝은 색, 홈 업데이트 바로 위).
팀장 = Claude Code 본체(클로드). `.claude/agents/`에 직원 10명 — 요청 종류에 따라 **묻지 말고 알아서** 부른다. 직원 보고 첫 줄은 `[부서 이름]`.

| 부서 | 이름 | 파일(key) | 모델 | 하는 일 |
|---|---|---|---|---|
| 기획실 | 도면우 📐 | feature-planner | opus | 조사·설계안·작업 분해(docs/tasks/), 코드 안 씀 |
| 디자인실 | 고화질 🎨 | ui-designer | sonnet | 화면 틀·PC/핸드폰(m-cards)·일관성 |
| 데이터실 | 정규화 🗄️ | db-schema | opus | Supabase 표·SQL, 구글시트 칸 구조 |
| 개발실 | 구동민 🧑‍💻 | developer | sonnet | 설계안대로 구현(큰 기능은 파일 단위로 여러 명 동시) |
| 개발실 | 원인규 🔍 | debugger | opus | 원인 추적·근본 수정·재발 방지 |
| 품질실 | 이상무 ✅ | qa-checker | sonnet | 타입·빌드·범위·회귀·핸드폰·비밀값 검사 |
| 검사실 | 안정빈 🚀 | deploy-check | haiku | 배포 전후 검사·라이브 확인 |
| 검사실 | 방화벽 🔐 | sql-review | sonnet | SQL 건네기 전 검사 |
| 검사실 | 연동희 🔗 | integration-rules | sonnet | 구글시트·네이버·카톡에 쓰는 코드 규칙 |
| 운영실 | 경보람 📡 | ops-monitor | haiku | 사이트·동기화·카톡 대기 읽기 전용 점검 |

| 요청 | 순서 |
|---|---|
| 기능 추가·개선("추가해줘", "만들어줘", "개선") | feature-planner → (설계안 사용자 승인) → ui-designer + db-schema 병렬(필요한 것만) → developer → qa-checker |
| 버그·에러·"안 돼요"·숫자가 이상함 | debugger → qa-checker |
| 화면·디자인·레이아웃만 | ui-designer → qa-checker |
| 표·SQL | db-schema → sql-review → qa-checker |
| 시트 쓰기·네이버 제목 태그/동기화·카톡 발송 코드 수정 | 구현 전후 integration-rules(실패면 그 코드는 푸시 안 함) |
| "검토해줘", "문제 없나" | feature-planner(조사만) + debugger(위험 지점) — 보고만 |
| "잘 돌아가?", "캘린더가 안 바뀌어", "카톡 안 가", "배포 됐어?" | ops-monitor 먼저 → 이상이면 debugger |
| 커밋·푸시·배포 직전과 직후 | deploy-check(실패면 멈추고 고친 뒤 다시) |
| 사용자에게 SQL을 건네기 직전 | sql-review("실행 금지"면 건네지 않음) |

- **작은 일은 팀장이 직접**: 한두 파일·문구·색처럼 범위가 분명하면 기획·디자인을 건너뛰고 팀장이 고친 뒤 qa-checker만(비용·시간). 애매하면 feature-planner에게 크기 판단만.
- 설계안은 사용자에게 한 번 보여주고 진행(사용자가 "그냥 해"면 생략). 열린 질문은 모아서 한 번에 — 사용자는 개발자가 아님, 쉬운 말·추천안 먼저.
- 모델: 판단이 필요한 기획·디버깅·DB는 opus, 구현·디자인·QA·SQL/연동 검토는 sonnet, 기계적 검사(배포·운영)는 haiku. 팀장은 최종 판단·코드 리뷰. 어려운 구현은 Agent 호출 때 model: opus.
- qa-checker가 실패를 내면 끝난 게 아님 — 고치고 다시 검사. 직원 결과는 그대로 믿지 말고 팀장이 diff를 직접 본다(특히 시트·DB·카톡).
- **작업 끝**: 사람이 알아야 할 변화는 `lib/releases.ts` 맨 위에 쉬운 말로, 새 규칙·주의는 이 파일 해당 절에.
  커밋 본문 끝(Co-Authored-By 위)에 `투입: 이름, 이름` — **실제로 부른 직원만**(팀장 혼자 한 일이면 줄 없음). 홈 카드의 '한 일'이 이 줄로 집계됨.
- **명단 바꾸기**: `.claude/agents/<key>.md`(머리 name·model, 본문 첫 줄 `이름 X · 부서 Y · 캐릭터 Z`)와 `lib/agentTeam.ts`를 같이 고침.
  다르면 `npm run build`의 prebuild(`scripts/gen-commit-log.mjs`)가 빌드를 멈춤. 새 직원 파일은 Claude Code를 다시 시작해야 Agent 목록에 잡힐 수 있음.
- **커밋 기록 파일** `lib/generated/commitLog.ts`: prebuild가 git 기록에서 만듦(홈 업데이트의 "개발 기록" + AI 카드 '한 일'). 직접 고치지 말 것.
  Vercel은 얕은 클론이라 이미 커밋된 파일과 해시로 합치고, git을 못 읽으면 Vercel 환경값으로 이번 커밋 한 건만 넣음 → 로컬에서 빌드해 갱신된 파일을 같이 커밋해 둘 것.
- `.gitignore`는 `.claude/*` + `!.claude/agents/` — 로컬 설정(settings*.json)은 계속 저장소 밖.
- 홈 카드: `components/home/AgentTeamCard.tsx`(클라이언트, 부서 펼침) · 한 일 계산 `lib/agentWork.ts`(서버 — 커밋 기록 전체를 브라우저로 안 보냄).
  카드 폭 900px 이상이면 가로 조직도, 좁으면 나무 모양(CSS 컨테이너 쿼리 `agentteam`).

## 메뉴 구성 · 사용설명서 (/manual) — 2026-11-20

사용자 요청: 위 메뉴 = 홈 · 통합 캘린더 · 재고관리 · 임대·청구 · 계약관리 · 사용설명서, 계약관리 안은 소프트웨어 / PC 유지보수로 나눔.
참고 화면: CS팀 FIELD 웹앱 사용설명서(왼쪽 묶음별 카드 + 오른쪽 검은 소개 상자·색 카드·목차) + 전략영업 매뉴얼(번호 꼭지).
- **메뉴**(`components/Shell.tsx`): `TOP_TABS` 6개, 왼쪽 `SIDEBAR_SECTIONS` 묶음 3개(재고관리·임대·청구·계약관리 — 위 메뉴 이름과 같음).
  위 메뉴 고르기 `tabForPath`(주소 앞부분), 지금 묶음 이름은 남색. 왼쪽 메뉴는 묶음과 상관없이 늘 전부 보임(핸드폰 서랍에서 찾기 쉽게).
  새 화면을 만들면 `SIDEBAR_SECTIONS`·`tabForPath` 둘 다 볼 것(목록에 없는 주소는 전부 '재고관리'로 칠해짐).
- **계약관리 두 메뉴** = 같은 화면 `/contracts?tab=sw|pcm`. page.tsx 가 탭별로 Shell 의 activeMenu·제목을 바꾸고, 화면 위 칩도 `Link`(예전 replaceState 아님).
  `<Suspense key={tab}>` 라 탭이 바뀌면 ContractsPage 가 새로 만들어짐 → `tab` 은 state 아님.
  주의: Next 는 주소 ?뒤만 바뀌면 page 를 새로 만들지 않고 pathname 도 그대로 → Shell 의 진행 표시(pendingHref)는 실제 주소(경로+?뒤)가 바뀌었을 때 끔.
- **사용설명서**: 설명서마다 정적 주소 `/manual/<key>`(빌드 때 미리 만듦, `dynamicParams=false`), `/manual` = 첫 설명서(처음 시작하기).
  틀(Shell + 왼쪽 목록 `ManualFrame`)은 `app/manual/layout.tsx` 라 설명서를 바꿔도 펼친 묶음 유지. 본문은 서버에서 그림(`ManualDocView` — 본문 글이 브라우저 JS 로 안 감).
  내용 = `lib/manual/docs/*.ts`(형식 `lib/manual/types.ts` — 글 안 `**굵게**`, `` `버튼` ``), 순서 = `lib/manual/index.ts` ORDER(왼쪽 메뉴 순서). key·꼭지 id 가 겹치면 빌드가 멈춤.
  **화면을 바꾸면 그 화면 설명서도 같이 고치고 `updated` 날짜를 바꿀 것** — 특히 버튼이 시트·네이버·카톡·works 에 쓰는지 여부. 새 화면이면 설명서 하나 추가 + ORDER.
  key 를 바꾸면 카톡으로 보낸 링크가 깨짐. 설명서에 실제 고객사·사람 이름·시트 ID·키 값 쓰지 말 것(예시는 OO상사·홍길동).

## 계약 관리 (/contracts) — 소프트웨어 계약(1단계) · PC 유지보수(2단계 예정) — 2026-11-20

설계 `docs/tasks/2026-11-20-contract-management.md`(맨 위 D1~D12 결정 표가 우선). 사용자 결정: IT 웹앱에 둠(CS팀 FIELD 앱에 안 붙임), 시트는 한 번 옮기고 앱이 원본,
비번·라이선스 키도 전부 앱으로(소프트웨어 탭 비밀번호로), 거래처 목록은 **실시간**, 유지보수 대상은 품목 'PC유지보수'만, 2차인증은 평문.
- **거래처 목록 = firstoa-works 실시간**: `lib/contracts/worksSource.ts` `loadContractAssets()` — 화면 열 때마다 works assets 에서 품목 소프트웨어·PC유지보수만
  (`fetchWorksAssetsByItems` — 기존 `fetchAllWorksRows` 는 그대로). 실패하면 `it_rental_list` 사본(읽기만, 주황 띠) → 둘 다 실패면 저장된 거래처만.
  읽기 실패가 우리 표에 쓰지 않음. 임대리스트 화면의 대조→반영 방식은 그대로(범위 밖).
- **거래처 맞추기 순서**: works assets.id(`seen_asset_ids`) → 거래처 코드(`vendor_codes`, ecount_code 정리 — 주민번호 꼴은 버림, 브라우저로 안 보냄) → 정규화 이름(`name_key`·`alias_keys`).
  저장할 때만 맞은 id·코드를 더함(화면 열기만으론 안 씀). 기록은 자동으로 안 지움 — 종료는 화면 계산값.
- **잠금(D13 — 사용자가 "너무 어렵다"고 해서 처음 설계 §3-4를 대체)**: [소프트웨어 계약] 탭 전체를 비밀번호 하나로 잠금 → 맞게 넣으면 2시간 동안
  목록·라이선스 키·마스터 계정이 **그냥 보임**(칸마다 보기·가림 없음). 비밀번호는 화면에서 처음 정하고 ⋯ 관리 → 비밀번호 바꾸기.
  해시는 표 `it_contract_settings`('sw_password_hash', PBKDF2) — 평문 없음. 쿠키 `it_ct_unlock`(httpOnly·strict) 서명 값도 같은 표('cookie_secret').
  서버가 'sw' 개요·상세·모든 쓰기에서 잠금 해제를 확인(서버 액션은 누구나 부를 수 있으므로). 틀린 비밀번호 같은 기기 15분 5회 / 전체 30회면 15분 잠금.
  **비밀번호를 잊으면**: Supabase SQL Editor 에서 `delete from it_contract_settings where key = 'sw_password_hash';` → 화면에서 새로 정함(값은 그대로).
- **비밀 칸 저장**: 사용자 선택 "그냥 저장" — `it_contract_secrets.value_text` 에 암호화 없이(다른 대장처럼 서버 전용 표, RLS·revoke). `lib/contracts/secrets.ts` 한 파일만 읽고 씀.
  Supabase 관리 화면에 들어가는 사람은 값을 볼 수 있음(사용자에게 설명함). Vercel 환경변수·설정 화면 없음.
  비밀 칸: 라이선스 키·마스터 계정·갱신형 사용자/관리자 계정·결제 카드. 2차인증은 좌석 `mfa_note`(일반 칸). 열람·수정 기록 `it_contract_secret_log`(값 없음, 칸 이름 `event_count`).
- **시트 옮기기**(한 번, 배포된 앱, 잠금을 푼 상태에서): IT재고 워크북(`GOOGLE_INVENTORY_SHEET_ID`) 탭 `SW자산_갱신형`(머리줄 1행)·`SW자산_비갱신형`(머리줄 2행)을 batchGet 1회.
  미리보기 → 묶음별 거래처 고르기(건너뛰기 없음, 못 정하면 "미분류") → 반영(시트 다시 읽어 지문 같을 때만) → 저장값을 다시 읽어 시트 값과 대조 → 결과 표 "빠진 것 0".
  `source_key` 로 여러 번 눌러도 중복 없음. 실측(2026-11-20): 갱신형 32줄·비갱신형 229줄, 비밀 칸 456(+카드 40).
  시트 조사 때 비밀 칸(비갱신형 9·10·14, 갱신형 6·7) 값은 출력하지 말 것.
  미리보기에서 묶음째 '옮기지 않기'(target 'skip')·줄 ☑ 해제(excludeRows)·줄 [수정](rowEdits — 일반 칸만, contractSig 계산 전에 적용, source_raw 는 원문 유지).
  뺀 줄은 결과의 skippedRows/skippedGroups 로만 셈("빠진 것"과 별개). 이미 옮긴 줄은 미리보기에서 못 고침(서버가 건너뜀) — 화면에서 고침.
- **옮긴 뒤 지우기**: 좌석 여러 개 `deleteSwSeats`(열람 중, 최대 500, 200개씩, 비밀 칸 cascade), "이 상품 지우기" = deleteSwSeats(전부) → deleteSwContract.
- 표 SQL `supabase/contracts_schema.sql`(6개 표, RLS·revoke — 예전 판(sealed 암호문)을 실행한 DB 는 다시 실행하면 value_text 로 바뀜). 화면 `components/contracts/*`, 액션 `app/contracts/{actions,secretActions,importActions}.ts`.

## 청구 배분 — 임대 건 단위 자산번호 지정 (/billing?view=review) — 2026-11-20

설계 `docs/tasks/2026-11-19-billing-allocation.md`(§8 팀장 결정이 우선). 사용자 결정: 지정표 새로 만듦, works 번호 우선, 옛 줄 단위 입력 옮기기 없음, 일괄 확정은 체크한 것만.
- **배경**: 청구(`it_billing_lines`)는 firstoa-works 대조·반영으로 들어옴(`lib/rentals/worksBilling.ts`). works 자산에 asset_code가 비면 그 청구 줄은 `needs_review`(배분 확인 필요).
  예전엔 청구리스트에서 줄마다 넣은 자산번호가 다음 반영 때 works 값(null)으로 덮였음.
- **지정표** `it_rental_asset_assignments`(`supabase/rental_asset_assignments_schema.sql`): 임대 건(`rental_sheet_row` = works assets.id = it_rental_list.sheet_row)마다 사람이 정한 자산번호.
  FK 없음 — 반영이 works에 없는 임대 건 행을 지우므로(restrict면 반영 실패, cascade면 사람이 한 일이 사라짐).
- **반영 규칙** `lib/rentals/allocationRule.ts` `decideAllocation`(import 없는 순수 함수 — Node 24로 바로 돌려 볼 수 있음), 위에서부터:
  ① works 자산번호 있음 → 그것(지정과 다르면 conflict 표시, 지정은 안 지움) ② 임대 건 + 지정 → 지정 번호 ③ 임대 건 모르는 줄에 사람이 넣은 값 → 유지 ④ needs_review.
  규칙을 적용한 **뒤에** `billingKey`로 비교 → 지정한 줄은 다시 대조해도 "변동없음". 반영은 지정표에 쓰지 않음(읽기만).
  지정표 "없음" 판정은 동기화 쪽에서 좁게(코드 42P01/PGRST205 또는 "does not exist" 류 문구) — 권한 오류를 "없음"으로 보면 빈 지정표로 반영해 지정이 풀림.
- **화면**: 청구리스트 보기 칩 [청구 명세] [자산번호 확인] [지정한 것](`components/billing/BillingAllocationView.tsx`).
  확정 = 지정표 upsert + 그 임대 건의 needs_review 줄 confirmed. 되돌리기 = 지정 삭제 + works 번호가 비어 있으면 그 번호였던 works 줄을 needs_review로.
  works 줄 중 임대 건이 있는 줄은 줄 단위 확인 대신 "임대 건으로 확인 →"(서버도 거절), 수정 창에서 자산번호 칸 잠금.
- **추천**: 같은 시리얼의 다른 임대 건·같은 임대 건의 확정 줄(시트 안 읽음). IT재고 시리얼은 "IT재고에서 시리얼로 찾기" 버튼을 누를 때만 `listAllAssets` 1번.
- **숫자**: 홈 청구 카드·청구리스트 위 숫자는 `summarizeReview`(`lib/billingAllocation.ts` — needs_review 줄을 페이지로 끝까지 읽어 임대 건 수). 청구 명세 목록 자체는 여전히 최근 500줄.
- 자산 상세·자산 이력은 지정된 임대 건도 포함(`assignedRentalRowsForAsset`).
- 배포 순서: SQL 실행 → 배포 → 임대리스트 "firstoa-works 대조" → 반영 → 다시 대조(청구 "변경"이 0에 가까운지).

## 출고 준비 리스트 (/shipment-prep) — 2026-11 구축

원본: first-as-search 백오피스의 출고 준비 기능(지침서 `C:\ref\first-as-search\00_READ_FIRST_guide.md`, 읽기 전용).
원본 백오피스 Supabase·Edge Function은 쓰지 않고 건드리지 않음.

- **일정 원본**: 통합캘린더 `it_calendar_events` (네이버 CalDAV → `lib/naverCalendarSync.ts`). 원본처럼 Edge Function / pg_cron / naver_events 를 따로 만들지 않음.
  - 네이버 별표(★)는 `naver_important` 칸(동기화가 채움). 앱 ⭐(`important`)도 같이 인정.
  - 리스트 대상: 별표 + IT 키워드(제목 "IT" 토큰, 모니터/노트북/데스크탑/NAS 등), 휴가·직송 제외 — `lib/shipmentPrep.ts`.
- **테이블**(`supabase/shipment_prep_schema.sql`): `it_prep_events`(prep_checks), `it_prep_people`, `it_prep_photo_items`, `it_prep_reports`(사진·기기·발송, id = 공개 앨범 키). Storage 버킷 `prep-photos`(public, 코드가 자동 생성).
- **네이버 제목 태그**: `syncPrepTitleTag` — SUMMARY 줄만 교체(VALARM 제외), 75바이트 줄접기, If-Match + 412 재시도. 우리 담당자 이름 태그만 지우고 붙임(백오피스 태그 보존).
- **카톡**: 메신저 Supabase `outbox`에 `{ room: '! IT 출고', text }` INSERT → 카톡봇 polling. 키는 Vercel Env `MESSENGER_SUPABASE_ANON_KEY`(publishable).
- **공개 앨범**: `/album?id=<report id>` (로그인 없음).
- **재고**: 납품·교체 보고 발송 시 자산번호의 IT재고 위치 → `임대중`, 비고에 `yy.mm.dd 업체명` 추가, `stock_applied`로 재발송 중복 방지. 철수는 제외.
  - 반영은 응답 뒤(`after()`, 16대에 1분 넘어서) — 결과를 한 대씩 보고 행에 기록: 됨 → `stock_applied`, 못 함 → `stock_issues`(자산번호 → not_found/error·이유, SQL `shipment_prep_schema.sql` 맨 끝 블록).
    칸이 없으면(SQL 전) "기기 − stock_applied"로만 셈 — 없음 판정은 `isMissingStockIssuesColumn`(42703/PGRST204·문구에 stock_issues)만, 권한 오류는 오류로.
    완료 보고 창이 발송 뒤 3초마다 `getPrepStock`으로 "📦 IT재고 반영" 상자를 갱신(90초), 결과 없는 기기는 5분 지나면 "끊김"(`prepStockView`). 목록 버튼·홈 카드에 "재고 반영 안 됨 n대".
    `retryPrepStock`("🔁 재고 다시 반영") = 카톡 안 보냄, 같은 `applyStockUnit`, 한 번에 6대. 쓰기 전 읽은 줄의 자산번호가 다르면(10분 행 번호 기억이 밀림) 안 쓰고 error.

## 영업 확인서 가져오기 (/confirm-form 기본 보기) — 2026-11-26, 1단계(목록)

설계 `docs/tasks/2026-11-26-sales-confirm-import.md`(맨 위 D1~D30 우선). 영업이 확인서를 영업 웹앱(firstoa-smart-sales-os)에서 만들게 되어
'IT확인서리스트' 시트 방식이 끊김 → 이 메뉴 기본 보기가 영업 확인서 목록. 1 목록 → 2 상세(자산번호·시리얼·사양·체크) → 3 출력, 단계마다 사용자 확인. 4단계 = 출고 준비 리스트와 합치기(따로 설계).
- **사용자 결정**: 영업은 IT 값을 안 봄 → 영업 쪽 되돌려 쓰기 없음(D4). 연락처·주소는 **지금은 안 잠금**(D7, 지침의 "로그인한 사람만"과 다름 —
  로그인 붙일 때 `/confirm-form`(목록·미리보기·인쇄)과 `/dispatch`(연락처)를 같이 막을 것). 새 메뉴 없음 — 주소 `/confirm-form` 그대로,
  `?view=legacy` = 예전 화면 그대로(D10, page.tsx 가 `<Suspense key={view}>`). 출고 준비 쪽(it_prep_*·네이버·카톡)에는 1~3단계에서 안 씀(D8).
- **가져오기**: `GET …/api/export/it-confirms?since=` + 헤더 `x-export-key` = Vercel 환경값 `SALES_EXPORT_KEY`(Production만, 영업 쪽 이름 `IT_EXPORT_KEY` —
  sensitive 라 Vercel 에서 다시 못 봄, 만든 사람에게 받음). 영업 export 코드는 GitHub 저장소에 없음(로컬 배포) — 키가 로컬에 없으니
  응답은 **배포된 라우트에 `{"force":true,"trigger":"manual","diag":true}` POST** 로만 봄(결과 `shape` = 칸 이름·종류·건수만, 값 없음).
  - 실측(2026-11-26, 9건): 바깥 `{count, list:[…]}`(extractRecords 가 "배열이 딱 하나"로 읽음), id 16자 글자, deliveryDate 'YYYY-MM-DD',
    지침 밖 칸 inflow(유입담당)·leaseNo·reason·contacts.contractor(계약담당), before/after = {item,model,maker,sn,asset,spec,sw}.
    **phone 은 회사 대표번호** — 담당자 연락처는 manager·contractor·resident 에 이름과 같이 → 목록 연락처는 `contactLine`(phone → IT담당 → 계약 → 현장).
    spec 에 지침 밖 한글 칸 2개 있음 → `specExtra`(이름 그대로) 로 보존해 미리보기에 보여 줌. 영업 웹앱의 '인치'는 노트북만.
  - 미리보기(이후 상세도)는 **저장된 payload 를 지금 normalize 로 다시 읽음** — 정규화를 고쳐도 이미 받은 건에 바로 반영(hash 는 원문 기준이라 안 바뀜 → 가짜 "수정됨" 없음).
    ① 의 정규화 칸(contacts·items 등)은 받을 때 한 번 만든 사본이라 목록 요약에만 씀(원문이 안 바뀌면 다시 안 씀).
  - 라우트 `POST /api/sales-confirms/import`(목록: 화면 열 때·**60초마다**·🔄·⋯날짜, 홈은 10분 넘었으면 `after()`). Vercel cron 안 씀(Hobby 하루 1번).
    **한 건 받기**(2026-11-27, 설계 `docs/tasks/2026-11-27-sales-export-b33a4c3.md` E1): 본문 `{id, trigger:'detail'|'print'}` — 상세 화면이 열 때·보이는 동안 60초·탭 복귀,
    출력 창이 열 때(3초) 그 한 건만 `?id=&type=`(type 은 ① 값). 쓰기 규칙은 목록과 같음(①② 만). 바뀌면 상세가 다시 읽음, 입력 중이면 [새로 보기] 띠.
  - since = 그날(한국) 첫 성공 전 90일(`last_deep_at`), 그 뒤 **어제부터**(영업 export since = 저장·지운 날짜 기준이라 빠짐없음), 날짜 고르기 365일까지.
    hash(키 정렬 JSON sha256)로 바뀐 것만 씀. 영업 시각(savedAt·createdAt·deletedAt)은 **시간대 없는 한국 시각** → normalize 가 +09:00 으로 읽음(전엔 UTC 로 읽어 9시간 늦었음).
  - 겹침 막기: ⑤ `it_sales_import_state` 'main' 줄 조건부 update(55초 — 화면 60초와 딱 같으면 두 번에 한 번 건너뜀, 강제 10초). 같은 표에 줄 'one'(한 건 3초)·'html'(양식 중계 2초)도 씀 —
    상태 띠·홈이 읽는 곳은 늘 'main' 만. 바뀐 건은 ②(판 원문) 먼저 → ①(그래야 실패해도 다음에 저절로 맞춰짐).
  - export 새 칸(영업 b33a4c3): status('deleted')·deletedAt/By·createdAt/By·renderer('confirm'|'swap'|'svc')·doc(영업 출력 함수에 그대로 넣는 확인서 전체).
    normalize → `renderer`·`formDoc`(svc 는 items[].cost 매입가 뺌 — 브라우저로 감)·`salesDeleted`(deleted 이고 savedAt ≤ deletedAt — 영업 납품·교체 저장이 지움 표시를 안 지움).
    svc(유지보수·소프트웨어) items 는 doc.items 에서(이름 빈 줄 빼고, '3대'→3).
  - **영업에서 지움(2차, E26~E29)**: ① `sales_state = '지움'`(SALES_STATE_DELETED) ↔ ''(되살아남). 목록 기본 숨김은 `isHiddenByDefault`(types.ts) 한 곳 —
    지운 건은 숨기되 IT가 손댄 건(준비중·준비완료·출고·보류)은 빨갛게 남김, 끝난 건(출고·취소)은 납품일 7일 안이거나 "영업에서 수정됨"이면 남김. ③ 처리여부는 **자동으로 안 바꿈**(상세 [처리여부를 '취소'로]).
    홈은 지운 건·따로 보는 종류를 숫자에서 빼고 "영업에서 지웠는데 준비 중 n"(bad). 지운 건 출력은 확인 체크해야.
    `first_saved_at = createdAt ?? savedAt`. **칸 다시 맞추기**: 그날 첫 90일 또는 날짜 골라 받기 때만, hash 가 같아도 ① first_saved_at·saved_at·sales_state·type·items 가
    지금 normalize 와 다르면 그 칸만 고침(② 안 씀, ⑤ counts.repaired) — 옛 9시간 어긋난 줄을 SQL 없이 바로잡는 길. 원문 싣는 묶음 50.
  - **판매·철수·이전 = "따로 보기"(2026-11-27 사용자: 받되 출고 준비가 아니니 별도 항목으로만)**: `isOtherSalesType(type)`(출고 준비 종류 SALES_SHIP_TYPES 밖이면 전부)
    → 목록 별도 칩, 기기 칸·IT 출력·홈 숫자 없음, 상세는 영업 값 + `영업 원본 보기`(영업 실시간 HTML 만 — 사본 없음). normalize 는 renderer null·`otherRenderer`(sale·pull·move)·
    formDoc null(판매 doc 의 items[].cost 매입가가 브라우저로 안 가게 — ①② payload 원문엔 남으니 payload 를 화면에 보내는 코드를 만들면 거를 것).
    영업이 export 에 추가함(영업 커밋 391dfbb — 영업 클라우드 배포 뒤 적용). 철수·이전 items 엔 asset·sn·leaseNo, 판매 cost 는 영업이 빼고 보냄.
  - **4단계(출고 준비 리스트와 함께 — 설계 `docs/tasks/2026-11-27-sales-confirm-prep-merge.md` F1~F30, 사용자 답 Q1~Q5 전부 추천안)**:
    두 메뉴 그대로 두고 이어 붙임 · 기기·체크는 확인서가 원본, 준비중·완료는 출고 준비 단추가 원본 · 네이버 일정은 앱이 안 만듦(없으면 알림만) · SQL 없음(③ prep_event_id·link_source).
    **4-0 오늘 준비할 것·직송**: 목록 맨 위 "준비하는 날" 줄(기본 오늘 → `lib/businessDay.ts` `nextBusinessDay` — 홈·출고 준비 화면과 같은 결과, 주말만 건너뜀),
    그날 납품분 지역 A→E 순 + 숫자 카드 3개, 목록 위 항목 `출고 준비 확인서`·`직송`·`철수·이전·판매`. **직송 판정 = `deliveryMode.ts` `isDirectShip`**(영업 statusDeliverer 와 같음 —
    위탁사 consign 이 있고 shipType '직송', 비면 head 에 '직송') — 목록은 payload 의 세 칸만(`readDeliveryModes`), 직송은 오늘 준비할 것·숫자 카드·홈 "준비 안 끝남"에서 빠짐, 상세는 그대로(띠만).
    출고 준비 리스트의 제목 키워드 직송 거르기(`DIRECT_DELIVERY_KEYWORDS`)는 안 바꿈(F30).
    **4-1 짝짓기**: 규칙 `prepLinkRules.ts`(순수 — 확실 = 영업 제목 줄(confTitle)과 일정 제목 `IT/` 뒤가 같고 날짜 같음 → 자동, 후보 = 상호+±1일+구분+지역, 약한 후보 ±3일),
    상태·읽기·쓰기 `prepLink.ts`(server-only — ③ prep_event_id·link_source 만 씀: ''·auto·manual·none), 액션 `app/confirm-form/prepLinkActions.ts`.
    **화면 열기만으론 안 씀**(자동은 보여 주기만 — 저장은 4-2·4-3 에서 사람이 무언가 할 때 'auto'). 일정 하나에 확인서 여럿 허용(그래서 "다른 확인서가 이미 연결 → 자동 아님(taken)"은 뺌).
    확인서 상세 "출고 준비" 상자(PrepLinkPanel), 출고 준비 카드 📋 배지(PrepConfirmBadge — 60초 동기화 때 같은 일정 묶음이면 안 다시 읽음), `/shipment-prep?event=<id>`,
    홈 "다음 영업일 출고 일정 없음 n". 복제본 정리(duplicateActions)는 ③ 연결도 "기록"으로 셈 — 연결된 앱 줄을 안 지움.
  - ver 0~2147483647 밖·`\u0000` 든 건은 그 건만 건너뜀(묶음 실패 방지). 일부만 모양이 다르면 나머지 반영 + 'bad_shape' 주황 띠.
- **표**(`supabase/sales_confirms_schema.sql`, 칸 이름은 `lib/salesConfirms/types.ts` 맨 위 주석이 기준): ①② 영업 원본 = **importer.ts 만 씀**,
  ③ work·④ units = IT 값 = 화면 액션만 씀. **가져오기 코드(normalize·source·importer·route)는 ③④ 표 이름을 import 도 하지 말 것**(IT 값 덮어쓰기를 구조로 막음).
  ③④ FK restrict(① 지우는 코드 없음). ③ `prep_event_id` 는 4단계용 — 그 전엔 쓰지 말 것.
  ③ 문자열 칸은 not null default '' — null 보내면 23502. 동시 수정은 DB 가 준 `updated_at` 문자열 그대로 `.eq`(JS Date 로 바꾸면 µs 잘려 늘 충돌).
- "새로" = ③ first_opened_at 없음(미리보기를 열면 채움), "영업에서 수정됨" = `salesChangedSince`(types.ts, 네 곳이 이것만) = seen_ver 있음 && **ver↑ 만** → [확인함].
  (2026-11-27 고침: 예전엔 "같은 ver hash 다름"도 셌는데, 영업이 export 칸을 넓힌 날 9건 전부 "v1→v1"로 잘못 뜸. 영업은 저장마다 ver = 판 개수+1 이라 내용이 바뀌면 ver 가 꼭 오름.
  hash 는 ② 판 구분·원문 저장·"무엇이 바뀌었나" 기준 판 찾기에만.)
  미리보기 열기·확인함은 ③ updated_at 을 바꾸므로 화면이 그 줄 `workUpdatedAt` 을 갱신해야 가짜 충돌이 안 남.
- 시트와 비교(`sheetCompare.ts`): 켰을 때만 IT확인서리스트 batchGet 1회, **연락처 N칸은 읽지 않음**, 쓰기 0. 처리여부 대응은 `sheetMatch.ts` `statusSame` 한 곳.
- 상세 주소(2단계) = `salesConfirmHref(id)` 로만(encodeURIComponent). `app/confirm-form/` 아래 정적 하위 폴더 만들지 말 것(id 를 가림).
- docUrl 은 `safeDocUrl`(https + 영업 웹앱 호스트만, `/api/export/`·`key=` 주소는 숨김 — 2026-11-27부터 영업 docUrl 이 키가 있어야 열리는 export 주소라 누르면 401.
  **키를 주소에 붙이지 말 것**). 로그·오류 문구·⑤·라우트 응답에 payload·연락처 금지.
  Supabase 오류의 `details`("Failing row contains (…)")에는 행 값이 통째로 들어가므로 **로그·응답엔 code 만**.

### 2+3단계 — 상세(/confirm-form/[id]) + 영업 양식 그대로 출력 (2026-11-26, 결정 D15~D30)
- **사용자 결정**: 기기마다 **제조사·모델명·자산번호·시리얼·출고사양**(이 순서). 종이엔 영업 값 그대로 + 출고 값 **덧붙임**("요청 8GB → 출고 16GB").
  영업 요청과 다르면 저장할 때 **닫을 수 없는 확인 창**(서버도 같은 검사 — acks 없으면 `needAck`). 유지보수도 **대마다**.
  라이선스 키는 **적음** — 입력은 확인서, 저장·보기는 계약관리 잠금 칸(넣을 때도 비밀번호), **종이에도 찍음**.
  출력은 **영업 웹앱 확인서 양식 그대로**. (2026-11-27 사용자: 영업이 **지금** 뽑는 양식 그대로 + 내용·양식 **실시간** — 아래 "출력 1차" 가 이 줄보다 우선)
- **품목 종류**(`itemKind.ts`): 유지보수(PC유지보수 포함) → 소프트웨어 → 모니터 → 장비 → 기타. 칸 계산은 `slots.ts` 한 곳(목록 진행 m 도) —
  유지보수·소프트웨어는 수량 0이면 1칸. 칸 열쇠 = `<품목구분>#n` + unit_no. 갈 곳 없는 칸(IT가 뭐라도 적은 것)은 "영업에서 빠진 칸"으로 남김(자동 삭제 없음).
- **같다고 보는 기준**(`specCompare.ts`): 공백·대소문자·하이픈 무시, 용량 16GB=16G=16·1TB=1000GB=1024GB, 애매하면 다름.
  제조사는 `makerKey`(조립=조립PC, 삼성=삼성전자=SAMSUNG, LG=엘지전자 — 회사 꼬리·다른 이름 무시), 모델명은 한쪽이 종류 이름뿐("데스크탑"·"노트북" — IT재고 조립PC 모델 칸)이면
  비교 안 함·6글자 이상 품으면 같음(NT751XHD ⊂ NT751XHD-KR735). 자산번호로 IT재고를 채울 때도 영업과 같은 제조사·종류 이름 모델은 안 채움(2026-11-27 사용자 신고 — 같은 기기인데 확인 창).
  SSD·HDD 는 7% 안이면 같은 급(500=512·240=256·120=128, RAM 은 정확히), CPU 는 "세대" 꼬리 무시. 자산번호를 넣으면 출고사양도 IT재고 사양 글자(CPU/세대/RAM/SSD/HDD/그래픽 — 한 칸)를
  `stockSpec.ts` `specFromStockLabel` 로 나눠 **빈 칸만** 채움(조각 5·6개 + CPU 꼴일 때만, 자신 없으면 안 채움 — OS·인치는 IT재고에 없음). diff_ack 는 칸마다 (영업, 출고) 쌍 —
  쌍이 바뀌면 다시 확인. 출고 값을 안 바꾸는 저장(자산번호·시리얼·체크만)은 막지 않음(창고 핸드폰 체크가 안 막히게).
- **출력 1차(2026-11-27, 설계 `docs/tasks/2026-11-27-sales-export-b33a4c3.md` E4~E23 — 옛 P1~P3·출고 명세 옵션·D22 한도 폐기)**:
  - **양식 = 영업 실시간 HTML + IT 칸 표시**: 출력 창이 열 때 한 건 받기 → `POST /api/sales-confirms/form-html {id}`(서버가 헤더 키로 영업 `html=1` 을 받아
    **JSON 으로만** 감쌈 — 우리 주소에서 영업 HTML 을 text/html 로 절대 내보내지 말 것, 2MB·4초, ⑤ 'html' 2초) → 브라우저 `DOMParser`(스크립트 안 도는 빈 문서)
    → `<body data-it-spec="1" data-it-form data-it-ver data-it-id>` 확인(`itFill.checkFormMarks`) → `applyFillPlan` 이 `[data-it]` 칸에 `textContent`·`createElement` 로만 값
    → `serializeFilled` → iframe `srcDoc` + `sandbox="allow-scripts allow-modals"`(**allow-same-origin 넣지 말 것**). **HTML 을 정규식으로 고치기·innerHTML 에 값 넣기 금지.**
    영업이 표시(data-it — 이름은 `itFill.ts` IT_MARK 한 곳 = 영업에 보낸 요청 글 설계 §11)를 붙이면 **배포 없이** 출력이 늘 영업 최신 양식.
  - **대신 그리기(사본)**: 영업 응답 없음·표시 없음(붙이기 전엔 늘)·모르는 판·판 다름·2면 켬·`SALES_FORM_SOURCE=copy`(끄는 스위치) → `printFill.renderCopy(formDoc, renderer, origin, withBack, marks=true)`
    를 같은 DOMParser→applyFillPlan 으로(채우기 한 길). 실시간인데 갈 칸 없는 값이 있으면 사람이 고름(E7). 출력 창 위에 "영업 최신 양식 / 받아 둔 양식(11-27판) — 이유".
  - 채울 값 = `printFill.buildFillPlan`(순수): 납품 = 새 양식 오른쪽 '출고시 기재사항' 대마다 5칸(제조사·모델명·자산번호·시리얼·출고 사양),
    요청과 다른 칸·토막만 굵게+밑줄("요청 → 출고" 글자 없음 — 왼쪽 요청·오른쪽 출고가 같은 줄), 비워 둔 기기 = 요청 값·"요청과 같음"(E15 상수),
    교체 = 교체 후 열(다르면 아래 "출고 ○○"), 유지보수·소프트웨어 = 고객 서명 장 뒤 'IT 기재 명세' 장. 2면은 기본 끔. 금액은 영업 종이처럼 그대로.
    원본 모드(`영업 원본 보기`)도 빈 plan 으로 applyFillPlan 을 거침(인쇄 스크립트가 붙어야 해서) — IT 값 없음·출력 기록 안 남김.
  - **사본 = 영업 렌더러 3개가 import 로 끄는 14개 파일만**(`salesForm/{confirm,confirmDoc,confTitle,statusRow,swap,pull,move,sale,svc,furn,kakaoParse,inkjet,swapDoc,svcDoc}.ts`,
    영업 커밋 b33a4c3 blob 그대로 + 표시 속성만 `[IT 표시]` 주석 자리). `lib/` 통째 금지(로그인·Supabase·고객 자료 bigcoSeed.json 이 따라옴).
    **marks=false 면 영업 원본과 글자까지 같아야 함.** printFill·itFill·사본은 출력 창을 열 때 `await import()`(상세 첫 화면 JS 안 키움).
  - **영업 새 판 받는 법**: 커밋 tree 에서 14개 blob 비교 → 렌더러 import 다시 따라가 목록이 늘었는지(서버·DB 코드가 끼면 멈춤) → 통째 교체 + 표시 자리 다시(영업이 표시를 넣었으면 사본 P 자리 없앰)
    → 옮겨 적기(tsc)만 + `node --permission` 으로 가짜 자료 비교(설계 §3-D 1~5) → 배포. 영업 담당 말: 영업이 양식을 고쳐도 GitHub 은 푸시할 때만 → 필요하면 최신 커밋 요청.
    **영업 코드 주석에 실제 거래처 이름·담당자 이름·휴대폰 번호·자산번호/시리얼(파싱 예시)이 있음** → 받을 때마다 주석 속 실값을 OO상사·홍길동·01000000000
    (번호는 모양만 X·0)으로 바꾸고 줄 끝에 `[IT 가림]`(b33a4c3 때 9개 파일 37줄). 주석만 바꾸므로 종이 모양은 그대로.
    **조각조각 말고 14개 파일 주석 전체를 한 번에 읽고 가릴 것**(b33a4c3 때 세 번 나눠 하다 검사실에 계속 걸림). 코드(문자열·정규식) 안이면 바꾸지 말고 멈춤.
    "코드 0 변경" 확인 = TypeScript scanner 로 주석 뺀 토큰 열이 원본과 같은지(스크립트 예: 스크래치패드 redact/verify.cjs 방식). 커밋 전 deploy-check 에 "주석 속 실제 상호·이름·번호" 검사를 꼭 시킬 것.
  - 신호는 그대로 `{source:'sales-confirm', type:'sales-confirm:print|overflow|size'}` postMessage(넘침은 알림만).
- **라이선스 키**(`lib/contracts/salesConfirmLink.ts` — 계약관리 쪽 유일한 새 파일, 기존 contracts 파일은 import 만): 확인서 소프트웨어 칸 하나 = 좌석 하나.
  거래처 → 상품(`source='sales_confirm'`, `source_key='sales_confirm:<확인서id>:<제품명 정규화>'`) → 좌석(`'sales_confirm_unit:<④ id>'`) → 키(`writeSecret`).
  키 넣기·보기·대장 쓰기는 전부 `requireUnlock`. 대장에서 사람이 고친 칸은 ④ `extra.ledgerPushed` 와 비교해 안 덮음. 키 값은 ③④·로그·localStorage 어디에도 없음.
  키 저장·대장 올리기는 ④ updated_at 을 바꾸므로 화면은 그 뒤 상세를 다시 읽음.
- **출고 준비 일정 시간 = 지역**(사용자 설명): 09:00 수도권A · 12:00 B · 15:00 C · 18:00 D · 21:00 E(`regionSlot.ts`, 정각 외 = 모름).
  상세의 "같은 건으로 보이는 출고 준비 일정"(`prepMatch.ts`)은 상호·±3일·구분 + 지역(둘 다 있을 때) — 읽기만, 연결 저장은 4단계.
- **SQL**: `sales_confirms_schema.sql` 맨 끝 블록 A(④ extra·diff_ack, ③ printed_ver·printed_by), `contracts_schema.sql` 맨 끝 블록 B(source 에 'sales_confirm').
  블록 A 전 판정 = 42703/PGRST204 + 칸 이름, 블록 B 전 = 23514 + `it_sw_*_source_check`(좁게). `select('*')` 는 없는 칸에 오류를 안 내니 판정엔 칸 이름을 적어서.

## 확인서 출고 기재 (/confirm-form?view=legacy 첫 탭 — 예전 방식) — 2026-11-18

영업이 확인서리스트 시트(`1seFubCF5rLa8yH81TYiNEXo4zj_MNHKglrMR-8vvbsA`, 서비스계정 편집 권한 있음)에
업체별 탭(예: `지니소프1118`)으로 만든 **납품 확인서**에 IT가 실제 내보낸 장비를 적는 기능.

- 칸 위치(`lib/confirmSheet.ts`): 품목 묶음 6줄, r = "구 분|…|제조사" 줄 → F{r} 제조사, H{r} 자산번호(줄바꿈),
  F{r+1} S/N, F{r+2} 하드웨어 = 영업 요청 + `\n[납품사양]\n ` + 우리 사양(앞 공백 한 칸 — 손으로 쓰던 방식).
  이 4칸만 씀(`writeConfirmBlocks`, 쓰기 전 줄 위치 재확인). 하드웨어 칸의 요청 부분은 시트 값을 유지.
  + B{r+2} 요청사항 = 모델명(제조사 머리말 뗌, 여러 모델이면 "모델 ×n") — A{r+2}가 "요청사항"일 때만, 영업이 다른 내용을 적어 둔 칸은 유지.
- 확인서 칸 방식(`cellMode`): full(줄바꿈으로 다) / summary(자산번호 두 개씩 한 줄, S/N "별첨 참조 (N대)", 사양 ×대수).
  S/N 칸의 "별첨 참조"로 다시 읽을 때 summary로 인식하고, 대수별 S/N·모델·사양은 앱 사본(`withAppDetails`)에서 보충.
- 별첨(대수별 출고 명세, `ConfirmAttachment`)은 앱 인쇄 전용 — "시트 그대로" 양식에서 데스크탑이거나 3대 넘으면 기본으로 2장째에 붙음. 시트엔 안 씀.
- 인쇄 양식(편집 창 아래, 브라우저에 기억): **표**(기본) — "작성시/출고시" 부분만 대수별 표로 다시 그림
  (왼쪽 영업 요청: 품목·수량·요청사항+하드웨어 요청, 오른쪽: 제조사·모델명·자산번호·시리얼·사양, 안 채운 대수는 빈 줄,
  색은 그 탭 양식 색). 요청사항이 우리 모델명 목록이면 왼쪽에서 뺌. 사양은 [납품사양]이 한 가지면 그것(지난 확인서 재인쇄용),
  여러 가지면 기기별. 시트 쓰기·양식은 그대로(영업 템플릿 안 바꿈). / **시트 그대로** — 예전 방식.
- 열 때 시트에서만 읽은 기기는 IT재고에서 모델명·사양을 채움(빈 칸만, S/N은 안 건드림).
- 목록의 삭제: 시트 탭은 탭 이름을 똑같이 입력해야 `deleteSheet`(목록/템플릿 탭·확인서 양식 아닌 탭은 거부), 앱 사본도 같이.
- 교체 확인서(교체전/교체후)·판매 납품확인서는 양식이 달라 아직 목록에 안 나옴.
- 앱 사본: `it_confirm_docs`(`supabase/confirm_docs_schema.sql`, 탭당 1행). 없으면 시트 기재만 되고 경고.
- 인쇄: 시트 탭의 값·배경색·병합·폭을 읽어(`readPrintGrid`) 같은 모양으로 그림.
- 출고 준비 연결(`lib/confirmLink.ts`): 제목의 "IT/…" 이후가 같으면 같은 건(앞 시간 문구·담당자 태그 무시),
  같은 제목 일정이 여럿이면 완료 보고 있는 쪽. 확인서 저장 → 완료 보고에 빈 칸만 채우고 없는 기기만 추가.
  완료 보고 저장 → `after()`에서 시트 묶음의 자산번호가 비었거나 보고 것의 일부일 때만 채움(사람이 다른 번호 적은 묶음은 안 건드림).

### 동기화 주의 (지침서 4장)
- 상태 테이블 `it_naver_sync_state`는 1000행 넘으면 잘리므로 페이지로 끝까지 읽음.
- 저장 실패한 일정은 etag를 저장하지 않음(영구 누락 방지).
- 삭제는 에러·밀린 분량 없을 때만, 동기화 기간 창(-30~+120일) 안의 일정만.
- **최선노력 반영도 실패는 삼키지 말고 경고로 돌려줌**(2026-11-20): 앱 저장은 성공으로 두되 결과에 `naverWarning`(캘린더)·`sheetWarning`(판매리스트)
  같은 이유를 실어 화면이 주황 알림(`.toast.toast-warn`, 저절로 안 닫힘)으로 "앱에는 저장, ○○는 실패 — 이렇게 하세요"를 보여 줌. 이유 문구는 `lib/syncFailure.ts`.
  응답 뒤(`after()`)에 도는 일은 결과를 DB에 적어 화면이 읽게(출고 재고 `stock_issues`). 새 최선노력 반영을 만들 때도 같은 방식.
- **앱 → 네이버 쓰기는 일정 출처로 먼저 나눔**(2026-11-20, `lib/calendar.ts` `calendarEventOrigin`: app / naver / broken / locked).
  예전엔 모든 일정을 `it-<id>.ics`로 올려서 네이버에서 만든 일정을 고치면 네이버에 복제본이 생기고 앱 줄 `naver_uid`가 `it-<id>`로 덮어써져 앱에 두 줄이 됐음.
  - **네이버 원본은 `naver_uid`를 절대 바꾸지 말 것.** 주소는 상태 표에서 `uid = naver_uid` + `calendar_id`로 좁혀 찾고(없으면 "네이버에서 하세요"),
    원문을 읽어 반복이면 거절 → 바꾼 칸마다 네이버 지금 값 = DB의 고치기 전 값인지(공백 정규화, 412 뒤 2회째도) → `lib/icsPatch.ts` `patchEventProps`로
    **바뀐 줄만** If-Match PUT → 성공한 뒤에 앱 저장. 날짜·시간·캘린더는 잠금. 상태 표 etag는 쓰지 않음(동기화가 갱신). 앱 전용 칸만 바뀌면 네이버 호출 0.
  - 지우기: 화면 확인 2번 + 서버도 `confirmNaverDelete` 필요, 제목·날짜 비교 → If-Match DELETE → 상태 표 줄 → 앱 줄(실패하면 상태 표 줄 되돌림). 네이버 실패면 앱도 안 지움. 감사는 서버 로그.
  - **네이버는 GET 에 ETag 헤더를 안 줌**(2026-11-23 실측, 모든 일정) → 버전은 `readEventByHref` 가 PROPFIND(Depth 0) getetag 로 먼저 읽고 그다음 GET(순서 바꾸지 말 것).
    값 = 마지막 수정 시각을 따옴표째(`"2026-11-17 14:54:23"`, 1초 단위) — If-Match 에 그대로(실측: 틀린 값 412, 이 값 200). 별표·완료만 바꾸면 안 바뀌므로 내용 비교와 같이 씀.
    11-20~23 사이엔 이걸 몰라 네이버 원본 고치기·지우기, 앱 일정 네이버 지우기, 복제본 정리가 "버전 표시를 주지 않아"로 전부 막혔었음.
  - 앱 일정(it-)도 VEVENT 통째 교체 금지(`mergeUpdate` 없앰 — 네이버의 별표·알림이 지워졌음). 반영이 실패하면 `naver_synced_at`을 비워 다음 [저장] 때 네이버와 다른 칸을 다시 맞춤.
  - `rewriteSummaryTags`(출고 태그)도 `lib/icsPatch.ts`의 같은 줄 찾기(VALARM 제외)를 씀 — 예전 결과와 글자까지 같은지 Node 로 확인함. 이 파일은 import 없는 순수 함수.
  - 예전 복제본 정리: `app/calendar/duplicateActions.ts`(🔗 캘린더 연결 → 🧹 복제본 정리). 순서 ①Y ②X 원복 ③복제본 상태 줄 ④네이버 복제본 If-Match 삭제 ⑤출고 태그 —
    **네이버 복제본을 먼저 지우면 동기화 정리 단계가 `it-<id>`로 앱 줄을 지워 출고 준비 기록·완료 보고가 cascade 로 사라짐**(사람에게도 "네이버에서 직접 지우지 마세요").

## 속도 (2026-11-18)

- Vercel 함수 지역은 서울(`vercel.json` `regions: ["icn1"]`) — Supabase가 서울이라. 기본값(미국 iad1)이면 DB 한 번에 0.4~0.6초씩 더 걸림.
- 구글시트(IT재고 5개 탭·소모품) 읽은 결과는 **보관(캐시)하지 않음** — 사람이 시트에서 직접 고친 게 바로 보여야 해서(사용자 결정). 대신:
  - 탭당 한 번에 읽음(`listAssetsFromSheet`가 머리줄+데이터 한 번, 읽은 김에 쓰기용 행 번호 색인도 갱신).
  - **IT재고 5탭 = `listAllAssets` batchGet 1회**(2026-11-27 사용자 결정 — 분당 60회 한도), 반환 `{assets, failed}`(`listAllAssetsUnified`도 같음) → 화면은 `InventoryReadWarning` 띠
    (일부 탭 실패 주황·전부 빨강 + 🔄 다시 읽기). 해석은 `parseTabValues` 하나(색인도 같이). 429 면 탭별로 되돌아가지 않음(한도만 더 씀), 그 밖의 실패(400 등)는 탭별 읽기로 한 번.
    **못 읽은 탭을 조용히 빈 목록으로 바꾸지 말 것**(`lib/inventory/tabRead.ts` — 실재고 조사 TabReadFailure 와 같은 모양).
  - 시트가 본문인 화면(IT 재고 리스트·재고 현황판·소모품)은 `<Suspense fallback={<PageLoading/>}>`로 틀부터 띄움.
  - 시트가 보조인 화면(입고·판매 등)은 Promise 그대로 넘기고 `useStreamedValue`로 도착하면 채움.
  - **서버 액션에서 revalidatePath 를 부르는 화면의 page 에는 시트 읽기를 두지 말 것** — Next 15 는 액션 안 revalidate 때 page 를 통째로 다시 그려 시트 5탭을 또 읽음.
    실재고 조사가 [확인]마다 5탭을 다시 읽어 분당 60회 한도를 넘기고, 못 읽은 탭이 조용히 빈 목록이 되어 조사 장비·남은 위치가 빠졌음(2026-11-27).
    실재고 조사는 위치 목록을 `loadStocktakeLocations`(useStocktakeLocations)로 필요할 때만 읽고, 조사 시작은 탭 하나라도 못 읽으면 거절(`mergeTabReads`).
  - **실재고 조사 = 선반 단위**(사용자 결정 2026-11-27): `lib/stocktake.ts` `shelfKeyOf` — B1 = B1수리중 = B1 (수리중)(꼬리말), B10·B1A·B1-2 는 다른 선반.
    조사 기록 위치엔 선반 열쇠, 장비마다 원래 위치 이름은 results[].location. 같은 선반이면 시트 위치를 안 고쳐 씀(사람이 다른 이름을 고를 때만).
    시트 읽기 **실패**(429 등)를 "IT재고에 없음"으로 보지 말 것(`lookupInventory` found/missing/error) — 신규등록·새 줄 만들기 직전에 5탭에서 다시 찾음(중복 줄 방지).
    조사 표는 1000줄 넘음(하루 ~14건) → `readAllStocktakePages` 로 끝까지(실재고체크완료 배지·현황판 2차 검증·목록).
  - IT 재고 표는 앞 120줄 먼저 그리고 나머지는 이어서(`InventoryTable`).
- 메뉴 누르면 `Shell`이 맨 위 진행 막대 + 누른 메뉴 빙글 표시.

## 홈 화면 앱 (PWA) — 2026-11-18

핸드폰 홈 화면에 설치해 앱처럼 씀(주소창 없이). 앱 이름 "퍼스트전산 IT ERP" / 홈 화면 이름 "퍼스트IT" / 색 #4f46e5 /
아이콘 = 퍼스트전산 토끼 캐릭터(바탕화면 `IT이슈컨텐츠제작/토끼캐릭터_퍼스트전산.jpg` 첫 번째 토끼 머리~어깨, 노트북 로고 빼고 자름 →
`scripts/assets/rabbit-it.png`) + 오른쪽 아래 "IT" 명찰. 안드로이드 원형(maskable)은 얼굴을 가려서 명찰 없이 토끼만.
아이콘을 바꿔도 이미 홈 화면에 추가한 폰은 그대로 — 지우고 다시 추가해야 바뀜(아이폰).

- **어디에 뭐가**: 이름·색 `lib/pwa.ts` → 설치 정보 `app/manifest.ts`(Next가 `/manifest.webmanifest`로 내보내고 link도 붙임,
  홈 화면 아이콘으로 켜면 `start_url: '/home'`, `id: '/'`는 바꾸지 말 것 — 바꾸면 이미 설치한 폰이 다른 앱으로 봄)
  → head 메타 `app/layout.tsx`(`metadata`·`viewport`). 아이콘 PNG `public/icons/` 4개(apple-touch 180, 192, 512, maskable 512).
- **아이콘 바꾸기**: `node scripts/make-pwa-icons.js` (토끼+명찰, 기본) / `--badge ""` 명찰 없이 / `--image 그림.png` 다른 캐릭터 /
  `--text IT` 글자 아이콘. sharp(next와 같이 깔림). 명찰 색을 바꾸면 `lib/pwa.ts` THEME_COLOR도.
  아이폰은 SVG 아이콘을 홈 화면에 못 써서 PNG. maskable은 런처가 원으로 잘라도 되게 그림을 80%로.
- **깨지기 쉬운 것**
  - `next.config.mjs`의 `htmlLimitedBots: /.*/` 빼지 말 것. Next 15.2+는 일반 브라우저에 메타데이터를 `<body>`로 흘려보내서
    Chrome이 manifest를 못 읽음(설치 불가, 실측 "no-manifest"). 이 설정은 메타데이터 위치만 바꾸고 화면 스트리밍은 그대로.
    확인: `curl -A "Mozilla/5.0 (iPhone…) Safari/604.1" <주소>/` 해서 `rel="manifest"`가 `</head>`보다 앞에 있어야 함.
    Next를 올릴 때(특히 16) 이 설정이 그대로 먹는지 다시 확인.
  - `appleWebApp.capable`은 Next 15가 `mobile-web-app-capable`만 내서 `apple-mobile-web-app-capable`은 `metadata.other`로 따로.
  - 상태바는 `statusBarStyle: 'default'` — `black-translucent`면 상태바가 화면 위를 덮음.
  - `viewport-fit=cover` + `body`의 `env(safe-area-inset-*)` 패딩(노치·홈바). 그래서 `.shell`·`.shell-main` 높이는 `100vh`가 아니라 `100%`
    (100vh면 패딩만큼 넘쳐 아래가 가림). 모바일 서랍 사이드바는 화면 끝에 붙어 직접 safe-area 패딩.
  - 모바일 서랍 사이드바 높이도 `100vh` 금지 → `top:0; bottom:0`. 아이폰 Safari의 100vh는 아래 주소창이 숨었을 때 높이라
    서랍이 화면보다 길어지고 메뉴가 그 안에 다 들어가 스크롤이 안 생겨, 아래쪽(임대·청구·설치 버튼)이 주소창 밑에 가려 못 내렸음(실기기 신고).
  - **서비스워커 넣지 말 것** — 배포해도 옛 화면이 계속 뜸. Chrome 설치 조건에 이제 필요 없음.
- **설치 버튼**(`components/InstallAppButton.tsx`, 사이드바 맨 아래 "📱 핸드폰에 앱처럼 설치하기"): 홈 화면 앱으로 켜져 있으면 숨김.
  안드로이드 Chrome은 `beforeinstallprompt`로 한 번에 설치 — 이 신호는 화면 뜨기 전에 올 수 있어 `layout.tsx`의 `beforeInteractive`
  스크립트가 먼저 받아 `window.__pwaInstallPrompt`에 둠. 아이폰 Safari는 "공유 → 홈 화면에 추가" 안내창,
  아이폰 Chrome·카카오톡 안은 Safari로 열라고, 안드로이드 카카오톡 안은 Chrome으로 열라고, PC는 핸드폰으로 열 주소 안내.
  안내창은 열린 서랍(z 60) 위에 떠야 해서 `.modal-overlay.install-guide-overlay{z-index:70}`.

## 핸드폰 화면 (≤640px) — 2026-11-18

PC 화면은 그대로 두고 `app/globals.css` 맨 끝 "핸드폰 화면" 블록에서만 덮어씀(위 막대 탭 두 개, 숫자 카드 4칸, 팝업은 아래 시트,
입력칸 16px — 아이폰이 16px 미만 입력칸을 누르면 화면을 확대해 버림).
- **목록 표 → 카드**: `<table className="m-cards">` + 머리줄 `<th data-m="…">`만 적으면 됨. `components/MobileTableCards.tsx`
  (Shell에 들어 있음)가 머리줄 이름·역할을 칸마다 `data-ml`/`data-mr`로 옮기고, 값이 없거나 "-"인 칸은 `data-m-empty`로 숨김.
  역할: title(굵은 제목) · badge(제목 줄 오른쪽) · check(체크박스) · inline(제목 아래 한 줄로 이어 붙임) · sub(흐린 한 줄) ·
  full(한 줄 통째로) · actions(버튼, 마지막 줄 오른쪽) · hide(핸드폰에선 숨김) · nolabel. 머리줄 글자와 다른 이름을 쓰려면 `data-label`.
  새 목록 표를 만들면 여기에 맞춰 표시할 것 — 안 하면 핸드폰에서 옆으로 밀어야 하는 표가 됨.
  주의: JSX 삼항(`? (`) 바로 안에는 `{/* */}` 주석을 못 넣음(빌드 실패) — `//` 주석으로.
- **필터 접기**: `.filter-row`(칩 줄)들을 `components/MobileFilterRows.tsx`로 감싸면 핸드폰에선 "⚙︎ 필터 · n개 적용" 버튼 하나.
  PC에선 감싼 div가 `display:contents`라 모양 그대로(통합 캘린더처럼 칩 묶음이 바로 flex 항목인 곳도).
- **통합 캘린더 월간**: 핸드폰에선 일정이 색 막대(눌리지 않음) → 날짜 칸을 누르면 그날 목록 팝업. 막대 CSS는 `.calendar-grid` 안에만
  (날짜 팝업도 같은 `.calendar-event-chip`을 써서 범위를 안 좁히면 팝업까지 막대가 됨).
- 출고 준비는 원래 900px 미만에서 자체 카드 화면(`isMobile`) — 바깥 여백만 `.prep-page`.
- 확인: Supabase 키가 로컬 `.env.local`에 비어 있어 Supabase 화면은 로컬에서 안 보임 → 배포 화면을 Playwright로 열어 새 CSS를 덧입혀 봄.

## 홈 대시보드 (/home) — 2026-11-18

위 탭 맨 앞 "홈". 참고: 점검AS(inspection-finder) 홈 구성을 IT팀 업무에 맞춰 밝은 화면으로(사용자 결정: 새 탭, 밝게).
`/`(IT 재고 리스트)는 그대로 — `/?asset=…` 링크들이 있어서 옮기지 않음.
- 데이터: `lib/homeDashboard.ts`(server-only). 함수마다 예외를 안 던지고 실패하면 그 카드만 "못 읽었어요" — 화면 전체가 죽지 않게.
  - 업무 현황 카드: 출고 준비(`listPrepEvents` — 오늘 준비할 것 = 다음 영업일 출고분, 오늘 출고분은 카톡 보고 여부)·입고·실재고·청구는
    Supabase라 바로, 확인서(`listConfirmDocs`)·IT 재고(`listAllAssets`)는 구글시트라 `<Suspense>`로 나중에 채움.
  - Supabase는 한 번에 최대 1000줄(`.limit(5000)`도 1000에서 잘림) — 건수는 `count: 'exact', head: true`, 합계는 `readAllPages`로 끝까지.
    (첫 배포 때 청구 "이번 달 983건"·실재고 "이번 달 완료 297"이 잘린 숫자였음)
  - 카드 띠 색 tone: bad(빨강, 오늘 손봐야 함) / warn(주황) / good(초록) / muted(못 읽음). 맨 위 오른쪽엔 bad·warn 카드의 한 줄만 모아 보여 줌.
  - 운영·시스템: DB·구글시트 응답 시간은 화면 만들 때 실제로 잰 값, 네이버 반영 = `it_calendar_events.naver_synced_at` 최댓값,
    카톡 발송 대기 = 메신저 Supabase `outbox` 남은 줄 수(봇이 보내면 지움 — anon 키로 읽기가 막혀 있으면 0으로 보일 수 있음, 아직 실제로 확인 못 함).
- 업데이트 기록: `lib/releases.ts` — 배포할 때 사람이 알아야 할 변화만 쉬운 말로 맨 위에 추가.
- 피드백 게시판: `supabase/feedback_schema.sql`(표 `it_feedback`)을 Supabase SQL Editor에서 한 번 실행해야 씀(없으면 안내만 뜸).
  서버 액션 `app/home/feedbackActions.ts`, 종류·상태 목록은 `lib/feedback.ts`('use server' 파일엔 async 함수만 export 가능해서 따로).
  로그인 전이라 이름은 적는 사람이 직접(브라우저에 기억), 상태·답변은 누구나 바꿀 수 있음 — 로그인 붙일 때 권한 나눌 것.
