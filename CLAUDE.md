# firstoa-it 메모

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

## 확인서 출고 기재 (/confirm-form 첫 탭) — 2026-11-18

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

## 속도 (2026-11-18)

- Vercel 함수 지역은 서울(`vercel.json` `regions: ["icn1"]`) — Supabase가 서울이라. 기본값(미국 iad1)이면 DB 한 번에 0.4~0.6초씩 더 걸림.
- 구글시트(IT재고 5개 탭·소모품) 읽은 결과는 **보관(캐시)하지 않음** — 사람이 시트에서 직접 고친 게 바로 보여야 해서(사용자 결정). 대신:
  - 탭당 한 번에 읽음(`listAssetsFromSheet`가 머리줄+데이터 한 번, 읽은 김에 쓰기용 행 번호 색인도 갱신).
  - 시트가 본문인 화면(IT 재고 리스트·재고 현황판·소모품)은 `<Suspense fallback={<PageLoading/>}>`로 틀부터 띄움.
  - 시트가 보조인 화면(입고·판매·실재고 조사의 위치 목록 등)은 Promise 그대로 넘기고 `useStreamedValue`로 도착하면 채움.
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
