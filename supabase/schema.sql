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
    check (status in ('상품화준비중', '상품화완료', '임대중', '수리중', '미정', '기타')),
  constraint it_assets_category_check
    check (category in ('노트북', '데스크탑', '모니터', '빔프로젝트', '기타주변기기'))
);

-- ------------------------------------------------------------------
-- 사양 자동 코드화(parseSpecs 이식) 결과를 담을 컬럼 — 아직 채워주는 로직이
-- 없어서 전부 비워둔 채로만 존재합니다. 이 파일을 나중에 다시 실행해도
-- 안전하도록 add column if not exists 로 추가합니다.
-- ------------------------------------------------------------------
alter table public.it_assets add column if not exists spec_code   text;
alter table public.it_assets add column if not exists cpu_type    text;
alter table public.it_assets add column if not exists gen         text;
alter table public.it_assets add column if not exists tier_group  text;
alter table public.it_assets add column if not exists detail_spec jsonb not null default '{}'::jsonb;
alter table public.it_assets add column if not exists serial_no   text not null default '';

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

-- ==================================================================
-- asset_history · 자산 이력 (기존 '비고'란에 뭉쳐 있던 텍스트를 구조화)
--
-- 원본 구글시트의 비고 텍스트는 "YY.MM.DD 내용 / YY.MM.DD 내용" 형식으로
-- 여러 건이 이어져 있었습니다. 한 건마다 한 행으로 분리해서 저장합니다.
-- 날짜 패턴이 없는 조각(예: "하드미포함 가격")은 event_date 없이
-- content/raw_text 만 채워서 보존합니다. scripts/backfill-asset-history.js
-- 가 이 테이블을 채웁니다.
-- ==================================================================
create table if not exists public.asset_history (
  id          uuid primary key default gen_random_uuid(),

  asset_id    text        not null references public.it_assets(asset_id) on delete cascade,
  event_date  date,
  content     text        not null default '',
  raw_text    text        not null,

  created_at  timestamptz not null default now()
);

create index if not exists asset_history_asset_id_idx   on public.asset_history (asset_id);
create index if not exists asset_history_event_date_idx on public.asset_history (event_date);

-- it_assets 와 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.asset_history enable row level security;
