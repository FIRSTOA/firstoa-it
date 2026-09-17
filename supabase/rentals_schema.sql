-- ==================================================================
-- 임대리스트 (구글시트 로컬 사본)
--
-- 원본은 임대리스트 구글시트(22,808행, 84컬럼)입니다. 매번 구글시트 API로 전체를 읽으면
-- 느려서, 여기에 로컬 사본을 두고 "시트 대조/반영"(/rentals 화면)으로 수동 동기화합니다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists).
-- ==================================================================

create table if not exists public.it_rental_list (
  id             uuid primary key default gen_random_uuid(),

  sheet_row      integer not null unique, -- 구글시트 실제 행 번호 (동기화 키)
  row_hash       text not null default '', -- 매핑 필드 변경 감지용 해시

  seq            text not null default '', -- 순
  vendor_name    text not null default '', -- 거래처명
  site_name      text not null default '', -- 부서명/현장명
  manager        text not null default '', -- 키맨 (이름+연락처 원문)
  phone          text not null default '', -- 일반전화
  asset_code     text not null default '', -- 자산번호
  model_name     text not null default '', -- 모델명
  serial_number  text not null default '', -- 시리얼번호(기번)
  contract_date  text not null default '', -- 계약일
  end_date       text not null default '', -- 종료일
  status         text not null default '', -- 임대여부 (임대중/임대종료 등)
  item           text not null default '', -- 품목
  manufacturer   text not null default '', -- 제조사
  region         text not null default '', -- 담당지역
  province       text not null default '', -- 시/도
  grade          text not null default '', -- 등급
  contract_type  text not null default '', -- 일반/현장
  option1        text not null default '', -- FAX/CPU
  option2        text not null default '', -- 트레이/램/SSD
  option3        text not null default '', -- 피니셔/그래픽
  option4        text not null default '', -- 솔루션/윈도우

  synced_at      timestamptz not null default now()
);

create index if not exists it_rental_list_asset_code_idx  on public.it_rental_list (asset_code);
create index if not exists it_rental_list_vendor_name_idx on public.it_rental_list (vendor_name);
create index if not exists it_rental_list_status_idx      on public.it_rental_list (status);

-- 기존 테이블들과 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_rental_list enable row level security;
