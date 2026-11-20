-- =============================================================================
-- 출고 준비 리스트 (출고 메뉴) — 원본: first-as-search 백오피스 출고 준비 기능 이식
--   일정 원본은 통합캘린더(it_calendar_events, 네이버 CalDAV 동기화)를 그대로 씁니다.
--   (원본처럼 Edge Function / pg_cron / naver_events 를 새로 만들지 않음)
-- 여러 번 실행해도 안전합니다(if not exists).
-- =============================================================================

-- 1) 네이버 "중요(★)" 표시 — 동기화가 채움. 앱의 important(앱 전용 별표)와는 별개.
alter table public.it_calendar_events
  add column if not exists naver_important boolean not null default false;
create index if not exists it_calendar_events_naver_important_idx
  on public.it_calendar_events (date) where naver_important or important;

-- 2) 일정별 준비 상태 — 사람마다 { overhaul_at, started_at, completed_at, handed_off }
create table if not exists public.it_prep_events (
  event_id    uuid primary key references public.it_calendar_events(id) on delete cascade,
  prep_checks jsonb not null default '{}'::jsonb,
  prep_note   text not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.it_prep_events enable row level security;

-- 3) 준비 담당자 명단(👥 담당자 관리)
create table if not exists public.it_prep_people (
  name       text primary key,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.it_prep_people enable row level security;

-- 4) 완료 보고 사진 체크리스트 항목(화면에서 추가/삭제)
create table if not exists public.it_prep_photo_items (
  label      text primary key,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.it_prep_photo_items enable row level security;
insert into public.it_prep_photo_items (label, sort_order) values
  ('확인서', 1),
  ('제품 라벨(모델·시리얼)', 2),
  ('자산번호 스티커', 3),
  ('부팅/윈도우 정품인증', 4),
  ('사양 화면(CPU·RAM·SSD)', 5),
  ('필수 프로그램 설치', 6),
  ('인터넷 연결', 7),
  ('구성품(어댑터·케이블·키보드·마우스)', 8),
  ('외관(정면·옆면·뒷면)', 9)
on conflict (label) do nothing;

-- 5) 완료 보고 — 일정 1건당 1개. 사진/기기는 jsonb, 보고 id 가 공개 앨범(/album?id=) 키.
create table if not exists public.it_prep_reports (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null unique references public.it_calendar_events(id) on delete cascade,
  company       text not null default '',
  model         text not null default '',
  author        text not null default '',
  units         jsonb not null default '[]'::jsonb,  -- [{ serial, assetId, grade }]
  photos        jsonb not null default '[]'::jsonb,  -- [{ path, url, at }]
  checked_items jsonb not null default '[]'::jsonb,  -- 체크한 사진 항목 label 목록
  note          text not null default '',
  message       text not null default '',
  sent_at       timestamptz,
  stock_applied jsonb not null default '[]'::jsonb,  -- 재고 위치를 이미 바꾼 자산번호(재발송 시 중복 방지)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.it_prep_reports enable row level security;

-- 6) 별표 표시를 기존 일정에도 채우기 위해 동기화 지문을 비웁니다(일정 데이터는 안 지움).
--    다음 동기화부터 일정 본문을 다시 읽어 naver_important 를 채워요(몇 분에 걸쳐 나눠 처리).
delete from public.it_naver_sync_state;
update public.it_naver_calendars set ctag = '';

notify pgrst, 'reload schema';

-- ── 롤백(down) ─────────────────────────────────────────────────
-- drop table if exists public.it_prep_reports;
-- drop table if exists public.it_prep_photo_items;
-- drop table if exists public.it_prep_people;
-- drop table if exists public.it_prep_events;
-- drop index if exists public.it_calendar_events_naver_important_idx;
-- alter table public.it_calendar_events drop column if exists naver_important;

-- ── 2026-11-20 추가: 재고 반영 결과(stock_issues) ──────────────────
-- ※ 이미 위 파일을 실행한 DB 는 **이 블록만** 복사해서 실행하세요. 파일 전체를 다시 실행해도 표·데이터는
--   안 지워지지만, 6) 이 네이버 동기화 지문을 비워 일정 본문을 처음부터 다시 읽게 해요(몇 분 걸림).
-- 무엇: 완료 보고를 보낸 뒤 IT재고 위치를 '임대중'으로 못 바꾼 기기를 자산번호별로 적어 둠.
--   예) {"A123": {"reason": "not_found", "message": "IT재고에 없는 자산번호예요", "at": "2026-11-20T01:23:45Z"}}
--   reason: not_found(IT재고에 없음) / error(시트 쓰기 실패 등). 반영되면 그 번호는 여기서 빠지고 stock_applied 로 감.
-- 왜: 재고 반영은 카톡 발송 응답 뒤(after)에 돌아서 실패해도 화면에 못 알렸음 → 완료 보고 창·출고 준비 목록·홈 카드가
--   이 칸을 읽어 "재고 반영 안 됨 n대 · 재고 다시 반영"을 보여 줌.
-- 여러 번 실행해도 안전(if not exists). 실행 전에도 앱은 돌아감(이 칸이 없으면 "기기 − stock_applied"로만 셈).
-- 되돌리기: alter table public.it_prep_reports drop column if exists stock_issues;
alter table public.it_prep_reports add column if not exists stock_issues jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
