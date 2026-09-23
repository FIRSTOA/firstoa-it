-- ==================================================================
-- 통합캘린더 — IT팀 업무 일정 (Phase 1: 네이버 연동 없이 앱 안의 캘린더 자체)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists).
--
-- naver_uid/naver_synced_at/source 컬럼은 Phase 2(네이버 CalDAV 양방향 동기화)에서 씁니다 —
-- 지금은 항상 비어있고(naver_uid는 null), 미리 넣어둬서 나중에 마이그레이션 없이 바로
-- 이어서 쓸 수 있게 합니다.
-- ==================================================================

create table if not exists public.it_calendar_events (
  id              uuid primary key default gen_random_uuid(),

  title           text not null,
  date            date not null,             -- 시작일(YYYY-MM-DD)
  time            text not null default '',  -- 'HH:MM', 빈 값이면 종일 일정
  location        text not null default '',
  description     text not null default '',
  status          text not null default '진행중' check (status in ('진행중', '완료')),
  author          text not null default '',  -- 등록자

  naver_uid       text unique,               -- Phase 2: 'it-{id}'(앱에서 만든 것) 또는 네이버 원본 UID
  naver_synced_at timestamptz,
  source          text not null default 'app' check (source in ('app', 'naver')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists it_calendar_events_date_idx on public.it_calendar_events (date);

drop trigger if exists it_calendar_events_set_updated_at on public.it_calendar_events;
create trigger it_calendar_events_set_updated_at
  before update on public.it_calendar_events
  for each row execute function public.set_updated_at();

-- 다른 대장들과 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_calendar_events enable row level security;
