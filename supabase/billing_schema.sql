-- ==================================================================
-- 장비별 임대·청구 추적 — 구매단가/구입처 오버레이 + 청구 명세
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists).
--
-- "임대 건"은 별도 테이블을 새로 만들지 않고 기존 it_rental_list(임대리스트 시트 사본,
-- supabase/rentals_schema.sql)의 한 행(sheet_row)을 그대로 씁니다 — 그 시트가 이미
-- 거래처가 바뀔 때마다 같은 자산번호로 새 행이 쌓이는 "임대 건" 단위 그대로입니다.
-- ==================================================================

-- 구매단가/구입처 — 자산번호 키 오버레이. IT재고 구글시트의 "구입처"/"구매단가" 컬럼에
-- 의존하지 않습니다(일부 품목 탭엔 그 컬럼 자체가 없음 — 예: 노트북). 공유 스프레드시트에
-- 금액을 쓰는 리스크도 피합니다.
create table if not exists public.it_asset_purchase_info (
  asset_id        text primary key,
  purchase_price  numeric,
  purchase_vendor text not null default '',
  note            text not null default '',
  updated_by      text not null default '',
  updated_at      timestamptz not null default now()
);
alter table public.it_asset_purchase_info enable row level security;

-- 청구 명세 — 최소 구조. 한 행 = 청구 전표의 한 줄(한 자산에 귀속된 금액 하나).
create table if not exists public.it_billing_lines (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity,

  source_invoice_id text not null default '',  -- 청구번호(원본 전표 식별자)
  source_line_id    text not null default '',  -- 원본 명세 행 식별자 — 재업로드 중복 방지 키

  asset_id          text,                       -- 자산번호(배분 안 되면 null)
  rental_sheet_row  integer references public.it_rental_list(sheet_row) on delete set null,
  vendor_name       text not null default '',  -- 수입 시점 거래처명(매칭 안 돼도 원문 보존)

  billing_date      date,
  period_start      date,
  period_end        date,
  amount            numeric not null default 0, -- 양수=청구, 음수=조정(감액)
  status            text not null default '확정' check (status in ('확정','취소','조정')),
  allocation_status text not null default 'confirmed' check (allocation_status in ('confirmed','needs_review')),
  note              text not null default '',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 같은 파일을 다시 올려도 (청구번호, 행식별자)가 같으면 upsert로 덮어써서 중복 합산을
-- 막습니다. 수기 입력(청구번호를 안 적는 1건씩 추가)은 이 제약 대상이 아닙니다.
create unique index if not exists it_billing_lines_source_idx on public.it_billing_lines (source_invoice_id, source_line_id)
  where source_invoice_id <> '' and source_line_id <> '';
create index if not exists it_billing_lines_asset_id_idx on public.it_billing_lines (asset_id);
create index if not exists it_billing_lines_allocation_idx on public.it_billing_lines (allocation_status);

drop trigger if exists it_billing_lines_set_updated_at on public.it_billing_lines;
create trigger it_billing_lines_set_updated_at
  before update on public.it_billing_lines
  for each row execute function public.set_updated_at();

alter table public.it_billing_lines enable row level security;

-- 다른 대장들과 동일한 보안 모델: RLS만 켜고 정책은 안 만듦 — service_role 서버 코드만 접근.
