-- 홈(/home) 피드백 게시판 — 팀원이 불편·버그·개선 의견을 적고, 처리 상태를 바꿔 가며 관리.
-- Supabase SQL Editor 에서 한 번 실행. (앱은 이 표가 없으면 "표를 먼저 만들어 주세요" 안내만 띄움)

create table if not exists public.it_feedback (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default '불편' check (kind in ('불편', '버그', '개선', '기타')),
  body        text not null check (char_length(body) between 1 and 2000),
  author      text not null default '',            -- 로그인 기능 전이라 이름은 적는 사람이 직접(선택)
  page        text not null default '',            -- 관련 화면(메뉴 이름)
  status      text not null default '접수' check (status in ('접수', '진행', '완료', '보류', '반려')),
  reply       text not null default '',            -- 처리 메모·답변
  plus_count  integer not null default 0,          -- "나도 그래요"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists it_feedback_created_idx on public.it_feedback (created_at desc);
create index if not exists it_feedback_status_idx on public.it_feedback (status);

-- updated_at 자동 갱신(schema.sql 의 것과 내용이 똑같음 — 없을 때를 대비해 다시 만들어 둠)
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists it_feedback_set_updated_at on public.it_feedback;
create trigger it_feedback_set_updated_at
  before update on public.it_feedback
  for each row execute function public.set_updated_at();

-- 다른 대장들과 동일한 보안 모델: RLS 켜고 정책은 만들지 않음 → service_role 서버 코드만 접근
alter table public.it_feedback enable row level security;
