-- ==================================================================
-- 입고 대장 (구매입고예정 / 렌탈입고예정)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists).
-- 1행 = 1대 기준입니다 — 여러 대를 구매할 땐 등록 화면에서 수량만큼 행을 여러 개
-- 만듭니다(수량 자체는 저장하지 않음).
-- ==================================================================

create table if not exists public.it_receiving_log (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,

  kind           text not null default '구매입고예정', -- 구매입고예정 | 렌탈입고예정
  status         text not null default '입고대기',     -- 입고대기 | 입고완료 | 취소

  category       text not null default '',
  brand          text not null default '',
  model          text not null default '',
  cpu            text not null default '',
  spec           text not null default '',
  ram            text not null default '',
  storage        text not null default '',
  screen         text not null default '',

  vendor         text not null default '', -- 발주처 (구매만 의미, 렌탈은 빈 값)
  expected_date  date,
  manager        text not null default '',
  notes          text not null default '',

  asset_id       text not null default '',
  serial_number  text not null default '',
  location       text not null default '', -- 입고완료 처리 시 상태 계산에 씀

  completed_at   timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists it_receiving_log_created_at_idx on public.it_receiving_log (created_at desc, seq desc);
create index if not exists it_receiving_log_status_idx     on public.it_receiving_log (status);
create index if not exists it_receiving_log_kind_idx       on public.it_receiving_log (kind);

drop trigger if exists it_receiving_log_set_updated_at on public.it_receiving_log;
create trigger it_receiving_log_set_updated_at
  before update on public.it_receiving_log
  for each row execute function public.set_updated_at();

-- it_dispatch_log 와 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_receiving_log enable row level security;
