-- 확인서 출고 기재 — 앱 사본 (확인서리스트 시트 탭을 열어 자산번호·시리얼·[납품사양]을 채운 내용)
-- 시트 탭에서 온 건 source_tab = 탭 이름(탭당 1행), 붙여넣기로만 불러온 건 source_tab = ''.
-- Supabase SQL Editor 에서 한 번 실행하세요(여러 번 실행해도 안전).

create table if not exists public.it_confirm_docs (
  id               uuid primary key default gen_random_uuid(),
  source_tab       text not null default '',
  title            text not null default '',
  company          text not null default '',
  delivery_date    date,
  doc              jsonb not null default '{}'::jsonb,
  prep_event_id    uuid,
  sheet_written_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists it_confirm_docs_source_tab_idx
  on public.it_confirm_docs (source_tab) where source_tab <> '';
create index if not exists it_confirm_docs_delivery_date_idx on public.it_confirm_docs (delivery_date);

alter table public.it_confirm_docs enable row level security;
