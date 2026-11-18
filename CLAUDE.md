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
