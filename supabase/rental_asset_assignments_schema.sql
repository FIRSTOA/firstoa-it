-- ==================================================================
-- 임대 건별 자산번호 지정 (2026-11-20)
--
-- 목적: firstoa-works 청구 중 자산번호가 비어 "배분 확인 필요"(needs_review)로 뜨는 줄을
--       임대 건(기기 1대 = it_rental_list 한 행) 단위로 한 번만 지정해 두는 표.
--       works 대조·반영 때 이 표를 읽어 그 임대 건의 지난·앞으로의 청구 줄을 모두
--       이 자산번호로 확정합니다(works 에 자산번호가 있으면 works 가 우선 — 지정은 지우지 않고
--       "works와 다름"으로 보여 줌). 반영은 이 표에 쓰지 않습니다(읽기만).
--       설계: docs/tasks/2026-11-19-billing-allocation.md §3-2, §8-2
--
-- 실행 방법: Supabase SQL Editor 에서 한 번 실행 (New query 에 붙여넣고 Run).
-- 여러 번 실행해도 안전합니다 (if not exists / drop trigger if exists / create or replace).
-- 이 표가 없으면 앱은 빈 지정표로 보고 동기화는 계속 돌고, 지정 버튼만 "SQL 을 먼저 실행해 주세요" 안내.
--
-- 되돌리기(롤백): 아래 한 줄. 색인·트리거도 같이 지워집니다.
--   drop table if exists public.it_rental_asset_assignments;
-- (public.set_updated_at() 함수는 다른 표들도 쓰므로 지우지 않습니다.)
-- ==================================================================

create table if not exists public.it_rental_asset_assignments (
  -- 임대 건 = firstoa-works assets.id = it_rental_list.sheet_row (이름만 "시트 행").
  --
  -- it_rental_list 로 FK 를 걸지 않습니다: works 대조 "반영"이 works 에 없는 임대 건 행을
  -- 한꺼번에 지우므로(app/rentals/actions.ts applyWorksSync 3단계), on delete restrict 면 반영이 실패하고,
  -- on delete cascade 면 works 가 잠깐 행을 빼기만 해도 사람이 지정한 값이 사라집니다.
  -- 임대 건이 없어진 지정(고아 행)은 해가 없고, "지정한 것" 목록에 "임대 건 없어짐"으로 보여 줍니다.
  rental_sheet_row  integer primary key,

  -- 사람이 정한 자산번호. 대문자·앞뒤 공백 제거는 앱(서버 액션)이 저장 전에 함 — 여기선 빈 값만 막음.
  asset_id          text not null
                    constraint it_rental_asset_assignments_asset_id_not_blank check (btrim(asset_id) <> ''),
  assigned_by       text not null default '',  -- 지정한 사람(로그인 기능 전이라 직접 적고 브라우저에 기억)
  note              text not null default '',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 자산 상세·자산 이력에서 "이 자산번호로 지정된 임대 건" 찾기용.
create index if not exists it_rental_asset_assignments_asset_id_idx
  on public.it_rental_asset_assignments (asset_id);

-- updated_at 자동 갱신(schema.sql 의 것과 내용이 똑같음 — 없을 때를 대비해 다시 만들어 둠)
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists it_rental_asset_assignments_set_updated_at on public.it_rental_asset_assignments;
create trigger it_rental_asset_assignments_set_updated_at
  before update on public.it_rental_asset_assignments
  for each row execute function public.set_updated_at();

-- 다른 대장들과 동일한 보안 모델: RLS 켜고 정책·grant 는 만들지 않음 → 서버(관리자 키)로만 접근
alter table public.it_rental_asset_assignments enable row level security;
