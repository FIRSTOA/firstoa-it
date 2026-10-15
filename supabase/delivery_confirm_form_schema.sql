-- ==================================================================
-- 정식 납품 확인서 (구 "확인서리스트" 구글시트의 업체명+날짜별 개별 탭을 대체)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists).
-- ==================================================================

create table if not exists public.it_delivery_confirm_forms (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity,

  company          text not null default '',   -- 상호
  order_date       date,                         -- 발주일
  delivery_date    date,                         -- 납품일
  department       text not null default '',    -- 부서/위치
  inflow_type      text not null default '',    -- 유입구분
  sales_manager    text not null default '',    -- 영업담당자
  request_manager  text not null default '',    -- 요청담당자
  site_address     text not null default '',    -- 사업장주소
  special_notes    text not null default '',    -- 특이사항
  business_type    text not null default '',    -- 업종
  consumables      text not null default '',    -- 소모품
  contract_period  text not null default '',    -- 계약기간
  deposit          text not null default '',    -- 보증금
  payment_notes    text not null default '',    -- 결제 특이사항
  items            jsonb not null default '[]'::jsonb,
  raw_text         text not null default '',    -- 붙여넣은 원문(텍스트 인식 경로) — OCR이 놓친 내용도 원문으로 남겨둠

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists it_delivery_confirm_forms_created_at_idx
  on public.it_delivery_confirm_forms (created_at desc, seq desc);

drop trigger if exists it_delivery_confirm_forms_set_updated_at on public.it_delivery_confirm_forms;
create trigger it_delivery_confirm_forms_set_updated_at
  before update on public.it_delivery_confirm_forms
  for each row execute function public.set_updated_at();

-- 다른 테이블들과 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_delivery_confirm_forms enable row level security;

-- 출고/접수 대장(it_dispatch_log) 행이 어느 정식 납품확인서에서 나왔는지 역추적하기 위한 컬럼.
-- 일반 출고/접수 등록(이 테이블과 무관)은 그대로 null.
alter table public.it_dispatch_log
  add column if not exists delivery_form_id uuid references public.it_delivery_confirm_forms(id);

-- 이미 테이블을 만든 뒤 이 파일을 다시 실행하는 경우를 위한 방어적 마이그레이션.
alter table public.it_delivery_confirm_forms
  add column if not exists raw_text text not null default '';
