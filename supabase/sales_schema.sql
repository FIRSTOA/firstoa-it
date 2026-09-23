-- ==================================================================
-- 판매 리스트 (별도 관리 — IT재고/입고/출고와 자동 연동되지 않는 독립 대장)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists).
-- 1행 = 1대 기준입니다 — 여러 대를 한 번에 팔았을 땐 등록 화면에서 수량만큼 행을 여러 개
-- 만듭니다(수량 자체는 저장하지 않음).
-- ==================================================================

create table if not exists public.it_sales_log (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,

  purchase_vendor text not null default '', -- 구매처 (우리가 원래 구매한 곳)
  purchase_price  text not null default '', -- 매입금액
  sale_price      text not null default '', -- 판매금액

  model           text not null default '', -- 모델명
  spec            text not null default '', -- 스펙
  asset_id        text not null default '', -- 자산번호
  serial_number   text not null default '', -- 시리얼번호

  destination     text not null default '', -- 위치(=판매한 곳, 거래처명)
  sale_date       date,
  notes           text not null default '', -- 비고 (주소/담당자 등)

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 기존에 이미 테이블이 있는 경우(create table if not exists가 no-op)에도 새 컬럼이 생기도록.
alter table public.it_sales_log add column if not exists serial_number text not null default '';

create index if not exists it_sales_log_created_at_idx on public.it_sales_log (created_at desc, seq desc);
create index if not exists it_sales_log_asset_id_idx   on public.it_sales_log (asset_id);

drop trigger if exists it_sales_log_set_updated_at on public.it_sales_log;
create trigger it_sales_log_set_updated_at
  before update on public.it_sales_log
  for each row execute function public.set_updated_at();

-- 다른 대장들과 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_sales_log enable row level security;
