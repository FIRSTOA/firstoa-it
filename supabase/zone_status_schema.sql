-- ==================================================================
-- 재고 현황판 — 위치별/상태별 재고 집계 + 검증자 지정 (대표님 피드백)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists). 구글시트 원장은 전혀 건드리지 않고,
-- 자산번호를 키로 하는 Supabase 오버레이 테이블입니다.
-- ==================================================================

-- 위치/상태 태깅 (자산 1건 = 행 1개)
create table if not exists public.it_zone_status (
  asset_id          text primary key,
  location          text not null default '',
  condition_status  text not null default '가용',
  note              text not null default '',
  updated_by        text not null default '',
  updated_at        timestamptz not null default now()
);

-- 성장형 위치 목록 (it_staff_names와 동일한 패턴)
create table if not exists public.it_zone_locations (
  name       text primary key,
  created_at timestamptz not null default now()
);

insert into public.it_zone_locations (name) values
  ('지하'), ('1층'), ('2층'), ('2층 수리실'), ('3층'),
  ('외부위탁-LG서비스센터'), ('직원불출'), ('회의실용')
on conflict (name) do nothing;

-- 실제 운영 위치 코드(A1/B1/K2 등 — 기존 Asset.location 필드에 이미 쓰고 있는 코드)를
-- 층/구역으로 묶기 위한 작은 매핑표. 자산 769건을 하나하나 태깅할 필요 없이, 코드 20~30개만
-- 층에 매핑해두면 전체 자산의 위치가 자동으로 집계됩니다.
create table if not exists public.it_location_floor_map (
  code       text primary key,
  floor      text not null default '',
  created_at timestamptz not null default now()
);

-- 위치×품목 조합별 검증자 지정 + 검증 상태
create table if not exists public.it_zone_verifications (
  location       text not null,
  category       text not null,
  verifier_name  text not null default '',
  verified       boolean not null default false,
  verified_at    timestamptz,
  verified_count integer,
  primary key (location, category)
);

drop trigger if exists it_zone_status_set_updated_at on public.it_zone_status;
create trigger it_zone_status_set_updated_at
  before update on public.it_zone_status
  for each row execute function public.set_updated_at();

-- 다른 테이블들과 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_zone_status enable row level security;
alter table public.it_zone_locations enable row level security;
alter table public.it_zone_verifications enable row level security;
alter table public.it_location_floor_map enable row level security;
