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

### 동기화 주의 (지침서 4장)
- 상태 테이블 `it_naver_sync_state`는 1000행 넘으면 잘리므로 페이지로 끝까지 읽음.
- 저장 실패한 일정은 etag를 저장하지 않음(영구 누락 방지).
- 삭제는 에러·밀린 분량 없을 때만, 동기화 기간 창(-30~+120일) 안의 일정만.
