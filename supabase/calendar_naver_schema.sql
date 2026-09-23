-- ==================================================================
-- 통합캘린더 Phase 2 — 네이버 캘린더 CalDAV 양방향 동기화
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- calendar_schema.sql을 먼저 실행해서 it_calendar_events가 있어야 합니다.
-- 여러 번 실행해도 안전합니다 (if not exists).
--
-- 대상 캘린더가 고정 1개가 아니라 여러 개 연결할 수 있습니다(화면의 "+ 캘린더 추가").
-- ==================================================================

-- 연결된 네이버 캘린더 목록 — "+ 캘린더 추가"로 사용자가 직접 고른 것만 여기 들어갑니다.
create table if not exists public.it_naver_calendars (
  id         text primary key,          -- 네이버 캘린더 ID
  name       text not null default '',  -- 표시용 이름(네이버 displayname)
  enabled    boolean not null default true,
  ctag       text not null default '',  -- 마지막으로 확인한 컬렉션 지문(폴링 절약용)
  created_at timestamptz not null default now()
);
alter table public.it_naver_calendars enable row level security;

-- 일정마다 어느 네이버 캘린더에 동기화되는지.
alter table public.it_calendar_events
  add column if not exists calendar_id text references public.it_naver_calendars(id) on delete set null;
create index if not exists it_calendar_events_calendar_id_idx on public.it_calendar_events (calendar_id);

-- 동기화 기억: href(=캘린더+UID가 담긴 CalDAV 리소스 경로) → etag. 네이버 → 앱 폴링이 씁니다.
create table if not exists public.it_naver_sync_state (
  href        text primary key,
  etag        text not null,
  uid         text not null,
  calendar_id text not null default ''
);
create index if not exists it_naver_sync_state_uid_idx on public.it_naver_sync_state (uid);
alter table public.it_naver_sync_state enable row level security;

-- 다른 대장들과 동일한 보안 모델: RLS만 켜고 정책은 안 만듦 — service_role 서버 코드만 접근.
