-- ==================================================================
-- 출고/접수 대장 (구 "IT확인서리스트" 스프레드시트)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists).
-- 상태/구분 값은 실제 운영 스프레드시트 기준 자유 텍스트로 두고
-- (오탈자·예외값이 섞여 있었음) DB 단에서 CHECK 로 강제하지 않습니다.
-- ==================================================================

create table if not exists public.it_dispatch_log (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,

  delivery_date  date,
  received_date  date,
  received_time  text not null default '',
  start_time     text not null default '',
  end_time       text not null default '',
  status         text not null default '접수',
  receiver       text not null default '',
  processor      text not null default '',
  type           text not null default '납품',
  notes          text not null default '',
  company        text not null default '',
  contact        text not null default '',
  item           text not null default '',
  direct_spec    text not null default '',
  asset_id       text not null default '',
  remarks        text not null default '',
  serial_number  text not null default '',

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists it_dispatch_log_created_at_idx on public.it_dispatch_log (created_at desc, seq desc);
create index if not exists it_dispatch_log_status_idx     on public.it_dispatch_log (status);
create index if not exists it_dispatch_log_type_idx       on public.it_dispatch_log (type);

drop trigger if exists it_dispatch_log_set_updated_at on public.it_dispatch_log;
create trigger it_dispatch_log_set_updated_at
  before update on public.it_dispatch_log
  for each row execute function public.set_updated_at();

-- it_assets 와 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_dispatch_log enable row level security;
