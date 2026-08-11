-- ==================================================================
-- FIRSTOA ERP · IT 재고 리스트 테이블
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 이 파일은 여러 번 실행해도 안전합니다 (if not exists / or replace).
-- ==================================================================

create table if not exists public.it_assets (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated always as identity,

  asset_id    text        not null unique,
  category    text        not null,
  brand       text        not null,
  model       text        not null,
  cpu         text        not null default '미상',
  spec        text        not null default '사무용',
  ram         text        not null default '',
  storage     text        not null default '',
  screen      text        not null default '-',
  location    text        not null default '',
  status      text        not null default '상품화준비중',
  history     text        not null default '',
  is_new      boolean     not null default false,
  malicious   boolean     not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint it_assets_status_check
    check (status in ('상품화준비중', '상품화완료', '임대중', '기타')),
  constraint it_assets_category_check
    check (category in ('노트북', '데스크탑', '모니터', '기타주변기기'))
);

-- 목록 정렬(최신 등록 순) 및 필터링용 인덱스
create index if not exists it_assets_created_at_idx on public.it_assets (created_at desc, seq asc);
create index if not exists it_assets_status_idx     on public.it_assets (status);
create index if not exists it_assets_category_idx   on public.it_assets (category);

-- ------------------------------------------------------------------
-- updated_at 자동 갱신 트리거
-- ------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists it_assets_set_updated_at on public.it_assets;
create trigger it_assets_set_updated_at
  before update on public.it_assets
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- Row Level Security
--
-- RLS 를 켜고 정책은 만들지 않습니다.
--   → anon / authenticated 키로는 이 테이블에 전혀 접근할 수 없습니다.
--   → 앱은 service_role 키를 쓰는 서버 코드에서만 접근합니다 (RLS 우회).
--
-- 나중에 Supabase Auth 로 로그인을 붙이면, 아래 주석을 풀어
-- 로그인한 사용자에게 직접 권한을 줄 수 있습니다.
-- ------------------------------------------------------------------
alter table public.it_assets enable row level security;

-- create policy "로그인 사용자 조회 허용"
--   on public.it_assets for select
--   to authenticated using (true);
--
-- create policy "로그인 사용자 쓰기 허용"
--   on public.it_assets for all
--   to authenticated using (true) with check (true);
