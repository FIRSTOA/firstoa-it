-- ==================================================================
-- 자산 생애주기 1단계 · 이동 이력(asset_movements) + 오버홀 이력(asset_overhaul_records)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- schema.sql을 먼저 실행해서 public.set_updated_at() 함수가 있어야 합니다.
-- 여러 번 실행해도 안전합니다 (if not exists).
--
-- 설계 메모: IT부서_ERP_요구사항명세서.md 4번 섹션의 asset_movements는 원래 신규 assets
-- 마스터 테이블을 FK로 참조하는 구조입니다. 하지만 지금 firstoa-it의 실제 마스터 데이터는
-- 구글시트(INVENTORY_DATA_SOURCE=sheets)라서, 여기서 별도 assets 마스터를 또 만들면 "무엇이
-- 진짜 소스인지" 이중화되는 문제가 생깁니다. 그래서 asset_number(자산번호) + category를
-- 자연키로 써서 구글시트 쪽 자산을 가리키도록 했습니다. assets/locations 마스터 테이블은
-- 나중에 "구글시트 → Supabase 완전 전환" 단계에서 다시 설계합니다.
-- ==================================================================

create table if not exists public.asset_movements (
  id              uuid primary key default gen_random_uuid(),

  asset_number    text        not null,
  category        text        not null,

  moved_at        timestamptz not null default now(),
  from_location   text,
  to_location     text,
  from_status     text,
  to_status       text,
  receiving_type  text        check (receiving_type in ('구매입고', '반납입고')),
  actor           text        not null default '',
  memo            text        not null default '',

  -- copier-inventory 저장소의 패턴 참고: 물리 삭제 대신 반대 이벤트로 취소 기록.
  -- 지금은 이 컬럼을 채우는 로직이 없지만, 나중에 "이동 취소" 기능을 붙일 때를 대비해 미리 둡니다.
  canceled_by_id  uuid references public.asset_movements(id),

  created_at      timestamptz not null default now()
);

create index if not exists asset_movements_asset_number_idx on public.asset_movements (asset_number);
create index if not exists asset_movements_moved_at_idx     on public.asset_movements (moved_at desc);

alter table public.asset_movements enable row level security;

-- ------------------------------------------------------------------
-- 오버홀 이력 — 이번 단계에서는 테이블만 만듭니다. 오버홀 대기→착수→완료 워크플로우
-- 자체가 아직 앱에 없어서, 실제로 이 테이블에 기록하는 화면은 다음 단계에서 추가합니다.
-- ------------------------------------------------------------------
create table if not exists public.asset_overhaul_records (
  id              uuid primary key default gen_random_uuid(),

  asset_number    text        not null,
  category        text        not null,

  wait_started_at date,
  started_at      date,
  completed_at    date,
  work_content    text        not null default '',
  cost            numeric,
  actor           text        not null default '',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists asset_overhaul_records_asset_number_idx on public.asset_overhaul_records (asset_number);

drop trigger if exists asset_overhaul_records_set_updated_at on public.asset_overhaul_records;
create trigger asset_overhaul_records_set_updated_at
  before update on public.asset_overhaul_records
  for each row execute function public.set_updated_at();

alter table public.asset_overhaul_records enable row level security;
