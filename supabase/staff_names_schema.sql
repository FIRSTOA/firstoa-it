-- ==================================================================
-- 담당자 이름 드롭다운 — 실재고 조사 등에서 "담당자" 입력을 드롭다운으로 쓰기 위한 목록.
-- 새 이름을 입력하면 자동으로 이 목록에 추가되어(앱이 upsert) 다음부터 모든 사람의
-- 드롭다운에 같이 뜹니다(로컬 저장이 아니라 공유 테이블이라 기기/사용자 상관없이 공유됨).
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (if not exists).
-- ==================================================================

create table if not exists public.it_staff_names (
  name       text primary key,
  created_at timestamptz not null default now()
);

insert into public.it_staff_names (name) values
  ('김담우'), ('문종주'), ('손영근'), ('신동원'), ('김정식'), ('지경민'), ('김광태')
on conflict (name) do nothing;

-- 다른 테이블들과 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_staff_names enable row level security;
