-- ==================================================================
-- 영업 확인서 가져오기 — 표 5개 (2026-11-26)
-- 2+3단계 블록 A 추가(2026-11-26) — 맨 끝 블록(④ extra·diff_ack, ③ printed_ver·printed_by). 1단계를 이미 실행했으면 그 블록만 실행.
--
-- 목적: 영업 웹앱 읽기 전용 API(it-confirms)에서 받은 IT 확인서를 '확인서/출고및반출준비'(/confirm-form)
--       기본 목록으로 보여 주고, IT가 건마다 처리여부·기기 칸(자산번호·시리얼·사양 수정·체크)을 적는 표.
--         ① it_sales_confirms          영업 원본 최신본(건당 1행)          — 가져오기(lib/salesConfirms/importer.ts)만 씀
--         ② it_sales_confirm_versions  영업 버전마다 원문(무엇이 바뀌었나) — 가져오기만 씀
--         ③ it_sales_confirm_work      IT 처리(건당 1행, 상태·처리자·비고)  — 화면 액션만 씀
--         ④ it_sales_confirm_units     IT 기기 칸(품목 수량만큼, 적은 칸만 행) — 화면 액션만 씀
--         ⑤ it_sales_import_state      가져오기 상태 1행('main')           — 가져오기만 씀
--       영업 값(①②)과 IT 값(③④)을 표로 나눔(D3) — 영업이 고쳐도(ver↑) IT 값은 안 덮임. 영업 쪽에 되돌려 쓰는 길 없음(D4).
--       칸 이름은 lib/salesConfirms/types.ts 맨 위 주석과 1:1(코드가 이 이름으로 읽고 씀 — 바꾸지 말 것).
--       설계: docs/tasks/2026-11-26-sales-confirm-import.md §3-2·§3-6 (맨 위 D1~D14 결정이 우선)
--
-- 개인정보(D7): ① contacts·address·payload, ② payload 에 고객 연락처·주소가 들어갑니다.
--       지금은 화면에 잠금 없이 보입니다(사용자 결정 — 로그인을 붙일 때 같이 막음).
--       서버 로그·오류 문구·⑤ 상태·라우트 응답에는 원문을 넣지 않습니다(코드 규칙).
--
-- 실행 방법: Supabase SQL Editor 에서 한 번 실행 (New query 에 붙여넣고 Run).
-- 여러 번 실행해도 안전합니다 (create table if not exists / create index if not exists /
-- drop trigger if exists / create or replace / insert … on conflict do nothing).
-- 기존 표는 건드리지 않습니다(③이 it_calendar_events 를 FK 로 가리키기만 함 — 그 표의 칸·데이터는 안 바꿈).
-- 먼저 있어야 하는 것: it_calendar_events(supabase/calendar_schema.sql — 통합 캘린더를 쓰고 있으면 이미 있음).
-- 이 표들이 없으면 앱은 "SQL 을 먼저 실행해 주세요" 안내(판정은 42P01/PGRST205 만).
--
-- 보안: 다른 it_* 대장과 같은 모델 — RLS 켜고 정책 없음 + anon·authenticated 권한 회수(표·시퀀스)
--       → 서버(관리자 키, service_role)로만 접근. 브라우저가 직접 읽는 길은 없습니다.
--
-- 되돌리기(롤백): 아래를 이 순서로(④ ③ ② ⑤ ①). 색인·트리거·제약도 같이 지워집니다.
--   !! ③④는 IT가 화면에서 적은 값(처리여부·처리자·자산번호·시리얼·고친 사양·체크)이 있는 유일한 곳 —
--      지우면 영구히 사라집니다. 데이터가 있으면 먼저 Table Editor 에서 표마다 CSV 로 내보내 두세요. !!
--   (①②는 영업 API 에서 다시 받을 수 있지만, 영업이 아직 주는 기간만이고 "처음 받은 때"(목록 순서·새로 표시)는 새로 매겨집니다.)
--   drop table if exists public.it_sales_confirm_units;
--   drop table if exists public.it_sales_confirm_work;
--   drop table if exists public.it_sales_confirm_versions;
--   drop table if exists public.it_sales_import_state;
--   drop table if exists public.it_sales_confirms;
--   notify pgrst, 'reload schema';
-- (public.set_updated_at() 함수는 다른 표들도 쓰므로 지우지 않습니다.)
-- ==================================================================


-- 먼저 있어야 하는 표 확인(없으면 아무것도 만들지 않고 멈춤 — 쉬운 말로)
do $$
begin
  if to_regclass('public.it_calendar_events') is null then
    raise exception 'it_calendar_events 표가 없어요 — supabase/calendar_schema.sql 을 먼저 실행한 뒤 이 파일을 다시 실행해 주세요.';
  end if;
end
$$;


-- ------------------------------------------------------------------
-- ① 영업 원본 최신본 — 건당 1행. 가져오기만 씀(화면 액션은 안 씀).
--    같은 확인서는 영업 id 로 덮어씀(D2). ver 가 오르거나 같은 ver 인데 payload_hash 가 다르면 영업 칸만 update.
--    문자열 칸은 not null default ''(다른 대장처럼 — 빈 값은 '' 로).
-- ------------------------------------------------------------------
create table if not exists public.it_sales_confirms (
  -- 영업 id(형식 모름 → text). 상세 주소 /confirm-form/<encodeURIComponent(id)>.
  id              text primary key
                  constraint it_sales_confirms_id_not_blank check (btrim(id) <> ''),

  doc_no          text not null default '',   -- 영업 no(예: D-261124-04) — 목록의 "순번"
  -- 영업 버전(작은 정수로 보고 int). 실측에서 시각 꼴(큰 수)이면 bigint 로 바꿀 것(설계 §3-6 실측).
  ver             integer not null default 0,
  type            text not null default '',   -- '납품' | '교체' | '유지보수'(그 밖의 값도 그대로)
  term            text not null default '',   -- '일반/장기' | '현장/단기' | ''

  saved_at        timestamptz,                -- 영업 마지막 저장(savedAt) — 없으면 null
  first_saved_at  timestamptz,                -- 처음 본 버전의 savedAt = 목록 "접수일시"(없으면 화면이 first_seen_at)

  saved_by        text not null default '',   -- 접수자
  sales_rep       text not null default '',   -- 영업담당
  company         text not null default '',   -- 상호
  address         text not null default '',   -- 주소(개인정보 — D7)
  region          text not null default '',

  delivery_date   date,                       -- 납품/교체일 — 없으면 null

  -- 담당자·연락처 {manager, resident, payer, phone}(개인정보 — D7)
  contacts        jsonb not null default '{}'::jsonb
                  constraint it_sales_confirms_contacts_is_object check (jsonb_typeof(contacts) = 'object'),
  -- 품목·소모품 — 표시·기기 칸 계산용 정규화 사본(원문은 payload)
  items           jsonb not null default '[]'::jsonb
                  constraint it_sales_confirms_items_is_array check (jsonb_typeof(items) = 'array'),
  supplies        jsonb not null default '[]'::jsonb
                  constraint it_sales_confirms_supplies_is_array check (jsonb_typeof(supplies) = 'array'),
  -- 교체 건 before/after({before, after}) — 교체가 아니면 null
  replace_info    jsonb
                  constraint it_sales_confirms_replace_info_is_object
                  check (replace_info is null or jsonb_typeof(replace_info) = 'object'),

  special         text not null default '',   -- 특이사항
  doc_url         text not null default '',   -- 영업 원본 보기 주소(검사 전 원문 — 화면은 safeDocUrl() 을 거쳐서만 링크로)

  -- 원문 전체(연락처·주소 포함). 로그·오류 문구·상태 표·라우트 응답에 넣지 않음.
  payload         jsonb not null
                  constraint it_sales_confirms_payload_is_object check (jsonb_typeof(payload) = 'object'),
  payload_hash    text not null default '',   -- 키 정렬 원문의 sha256 — 바뀐 것만 쓰기(D14)
  sales_state     text not null default '',   -- 영업에서 취소·삭제 신호가 오면(영업 확인 뒤 — 지금은 늘 '')

  first_seen_at   timestamptz not null default now(),  -- 처음 받은 때("새로"·목록 기본 순서)
  changed_at      timestamptz,                         -- ver·내용이 바뀌어 다시 쓴 때
  fetched_at      timestamptz not null default now()   -- 가져오기가 이 줄을 마지막으로 쓴 때(같은 내용이면 안 씀)
);

create index if not exists it_sales_confirms_delivery_date_idx on public.it_sales_confirms (delivery_date);
create index if not exists it_sales_confirms_first_seen_at_idx on public.it_sales_confirms (first_seen_at desc);


-- ------------------------------------------------------------------
-- ② 영업 버전 원문 — ver 마다(같은 ver 인데 내용이 다르면 그것도) 한 줄. 가져오기만 씀.
--    ①을 지우는 코드는 없음 — 혹시 지우면 버전 기록도 같이(cascade).
-- ------------------------------------------------------------------
create table if not exists public.it_sales_confirm_versions (
  id            bigint generated always as identity primary key,

  confirm_id    text not null
                constraint it_sales_confirm_versions_confirm_id_fkey
                references public.it_sales_confirms(id) on delete cascade,
  ver           integer not null,
  payload_hash  text not null,
  payload       jsonb not null               -- 그 버전 원문(개인정보 — D7)
                constraint it_sales_confirm_versions_payload_is_object check (jsonb_typeof(payload) = 'object'),
  fetched_at    timestamptz not null default now(),

  -- 일반 unique(부분 인덱스 아님) → upsert onConflict 'confirm_id,ver,payload_hash' + ignoreDuplicates 대상.
  -- confirm_id 로 시작하므로 "이 건의 버전들" 조회·cascade 삭제 색인으로도 쓰임(confirm_id 색인을 따로 안 만듦).
  constraint it_sales_confirm_versions_confirm_id_ver_payload_hash_key
    unique (confirm_id, ver, payload_hash)
);


-- ------------------------------------------------------------------
-- ③ IT 처리 — 건당 1행, 화면 액션만 씀(가져오기 코드는 이 표를 import 도 안 함 — D3).
--    행이 없으면 = 접수·아무도 안 열어 봄.
--    ①을 지우려 하면 막음(restrict) — IT가 적은 값이 조용히 사라지지 않게.
-- ------------------------------------------------------------------
create table if not exists public.it_sales_confirm_work (
  confirm_id       text primary key
                   constraint it_sales_confirm_work_confirm_id_fkey
                   references public.it_sales_confirms(id) on delete restrict,

  -- 처리여부 6단계(D13: 접수·준비중·준비완료·출고·보류·취소). DB CHECK 없음 — 기존 대장처럼 앱이 검사.
  status           text not null default '접수',
  processors       text[] not null default '{}',   -- 처리자(여러 명 — D12, it_prep_people 명단에서)

  started_at       timestamptz,                    -- 시작·종료·출고 시각(사람이 고칠 수 있음)
  finished_at      timestamptz,
  shipped_at       timestamptz,

  note             text not null default '',       -- 비고

  -- IT가 마지막으로 확인한 영업 버전 → "영업에서 수정됨" = seen_ver 있음 && (ver > seen_ver 또는 같은 ver 인데 hash 다름)
  seen_ver         integer,                        -- 아직 확인 전이면 null
  seen_hash        text not null default '',

  first_opened_at  timestamptz,                    -- 비어 있으면 "새로"
  first_opened_by  text not null default '',

  -- 건 단위 체크(기타 묶음 — 랜선·공유기…) {항목 이름: {at, by}}
  checks           jsonb not null default '{}'::jsonb
                   constraint it_sales_confirm_work_checks_is_object check (jsonb_typeof(checks) = 'object'),

  -- 4단계(출고 준비 리스트와 합치기)용 — 미리 만들어 두고 1~3단계 코드는 안 씀(D8).
  -- 일정이 지워지면(네이버 동기화 정리 등) 연결만 풀림(set null) — 이 행은 남음.
  prep_event_id    uuid
                   constraint it_sales_confirm_work_prep_event_id_fkey
                   references public.it_calendar_events(id) on delete set null,
  link_source      text not null default '',       -- 4단계: 연결을 누가/어떻게 정했나

  printed_at       timestamptz,                    -- 마지막 인쇄(3단계)

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),  -- 동시 수정 확인용(트리거가 갱신)
  updated_by       text not null default ''
);

-- 일정이 지워질 때 FK(set null)가 이 표를 찾는 색인 — 연결된 행만(4단계 전엔 비어 있음).
create index if not exists it_sales_confirm_work_prep_event_id_idx
  on public.it_sales_confirm_work (prep_event_id) where prep_event_id is not null;


-- ------------------------------------------------------------------
-- ④ IT 기기 칸 — 품목 수량만큼의 칸 중 IT가 적은 칸만 행(빈 칸은 행 없음). 화면 액션만 씀.
--    칸 열쇠 = (slot_key '데스크탑#1' 꼴, unit_no 1..qty) — 규칙 lib/salesConfirms/slots.ts(설계 §3-4).
--    영업이 품목을 바꿔 갈 곳 없는 행도 지우지 않음("영업에서 빠진 칸"). ①을 지우려 하면 막음(restrict).
-- ------------------------------------------------------------------
create table if not exists public.it_sales_confirm_units (
  id             uuid primary key default gen_random_uuid(),

  confirm_id     text not null
                 constraint it_sales_confirm_units_confirm_id_fkey
                 references public.it_sales_confirms(id) on delete restrict,
  slot_key       text not null
                 constraint it_sales_confirm_units_slot_key_not_blank check (btrim(slot_key) <> ''),
  unit_no        integer not null
                 constraint it_sales_confirm_units_unit_no_check check (unit_no >= 1),

  -- 이 칸을 채울 때의 영업 품목(cat·model·maker·state·spec) — 영업이 품목을 바꾸면 비교해 경고. 아직 없으면 null.
  item_snapshot  jsonb
                 constraint it_sales_confirm_units_item_snapshot_is_object
                 check (item_snapshot is null or jsonb_typeof(item_snapshot) = 'object'),

  asset_id       text not null default '',   -- 자산번호(대문자·공백 정리는 앱이 저장 전에)
  serial         text not null default '',
  actual_maker   text not null default '',   -- 실제로 나가는 기기(IT재고에서 채움, 고칠 수 있음)
  actual_model   text not null default '',

  -- IT가 고친 사양 칸만 {RAM: '16GB', …} — 영업 값은 ① items 에 그대로
  spec_override  jsonb not null default '{}'::jsonb
                 constraint it_sales_confirm_units_spec_override_is_object check (jsonb_typeof(spec_override) = 'object'),
  -- 기기별 체크(D11 — 데스크탑&노트북·모니터 묶음) {항목 이름: {at, by}}
  checks         jsonb not null default '{}'::jsonb
                 constraint it_sales_confirm_units_checks_is_object check (jsonb_typeof(checks) = 'object'),
  note           text not null default '',

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),  -- 동시 수정 확인용(트리거가 갱신)
  updated_by     text not null default '',

  -- 일반 unique(부분 인덱스 아님) → upsert onConflict 'confirm_id,slot_key,unit_no' 대상.
  -- confirm_id 로 시작하므로 "이 건의 칸들" 조회(.in('confirm_id', …))·FK 확인 색인으로도 쓰임(confirm_id 색인을 따로 안 만듦).
  constraint it_sales_confirm_units_confirm_id_slot_key_unit_no_key
    unique (confirm_id, slot_key, unit_no)
);

-- "다른 건에 같은 자산번호" 경고용 — 자산번호를 적은 칸만.
create index if not exists it_sales_confirm_units_asset_id_idx
  on public.it_sales_confirm_units (asset_id) where asset_id <> '';


-- ------------------------------------------------------------------
-- ⑤ 가져오기 상태 — 'main' 한 줄(아래에서 만들어 둠). 가져오기만 씀.
--    겹침 막기: update … set last_attempt_at = 지금 where id = 'main'
--               and (last_attempt_at is null or last_attempt_at < 기준) returning *
--    → 동시에 둘이 와도 줄 잠금 뒤 두 번째는 조건을 다시 보고 0줄(한 명만 잡음).
--    last_error_code 는 성공이면 null(코드가 null 로 씀). 원문·연락처·키는 어느 칸에도 넣지 않음.
-- ------------------------------------------------------------------
create table if not exists public.it_sales_import_state (
  id                text primary key,
  last_attempt_at   timestamptz,               -- 마지막으로 받기를 시작한 때(겹침 막기 기준)
  last_success_at   timestamptz,
  last_deep_at      timestamptz,               -- 90일을 받은 때(D14 — 한국 날짜로 그날 첫 한 번)
  last_window_days  integer,                   -- 마지막으로 받은 기간(일)
  last_error_code   text,                      -- no_key·unauthorized·not_found·unreachable·bad_shape·no_table·db_error 또는 null
  last_error        text not null default '',  -- 쉬운 말 이유만(원문 없음)
  -- {received, new, updated, unchanged, older, skipped}
  last_counts       jsonb
                    constraint it_sales_import_state_last_counts_is_object
                    check (last_counts is null or jsonb_typeof(last_counts) = 'object'),
  updated_at        timestamptz not null default now()
);

insert into public.it_sales_import_state (id) values ('main')
on conflict (id) do nothing;


-- ------------------------------------------------------------------
-- updated_at 자동 갱신(schema.sql 의 것과 내용이 똑같음 — 없을 때를 대비해 다시 만들어 둠)
-- ①② 는 updated_at 이 없음(first_seen_at·changed_at·fetched_at 를 가져오기가 직접 씀).
-- ------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists it_sales_confirm_work_set_updated_at on public.it_sales_confirm_work;
create trigger it_sales_confirm_work_set_updated_at
  before update on public.it_sales_confirm_work
  for each row execute function public.set_updated_at();

drop trigger if exists it_sales_confirm_units_set_updated_at on public.it_sales_confirm_units;
create trigger it_sales_confirm_units_set_updated_at
  before update on public.it_sales_confirm_units
  for each row execute function public.set_updated_at();

drop trigger if exists it_sales_import_state_set_updated_at on public.it_sales_import_state;
create trigger it_sales_import_state_set_updated_at
  before update on public.it_sales_import_state
  for each row execute function public.set_updated_at();


-- ------------------------------------------------------------------
-- 보안: RLS 켜고 정책은 만들지 않음 + anon·authenticated 권한 회수 → 서버(관리자 키)로만 접근.
-- (Supabase 는 public 스키마의 새 표에 anon·authenticated 권한을 자동으로 주므로 명시적으로 회수)
-- ------------------------------------------------------------------
alter table public.it_sales_confirms          enable row level security;
alter table public.it_sales_confirm_versions  enable row level security;
alter table public.it_sales_confirm_work      enable row level security;
alter table public.it_sales_confirm_units     enable row level security;
alter table public.it_sales_import_state      enable row level security;

revoke all on table
  public.it_sales_confirms,
  public.it_sales_confirm_versions,
  public.it_sales_confirm_work,
  public.it_sales_confirm_units,
  public.it_sales_import_state
from anon, authenticated;

-- ②의 번호(identity) 시퀀스도 같은 이유로 회수(시퀀스 이름은 DB 에서 직접 찾음).
do $$
declare
  seq_name text := pg_get_serial_sequence('public.it_sales_confirm_versions', 'id');
begin
  if seq_name is not null then
    execute format('revoke all on sequence %s from anon, authenticated', seq_name);
  end if;
end
$$;


-- 표·칸 설명(Supabase Table Editor 에 보임)
comment on table public.it_sales_confirms         is '영업 확인서 — 영업 웹앱 원본 최신본(건당 1행, 가져오기만 씀). contacts·address·payload 는 개인정보';
comment on table public.it_sales_confirm_versions is '영업 확인서 — 영업 버전마다 원문(가져오기만 씀, ① 지우면 같이 지워짐). payload 는 개인정보';
comment on table public.it_sales_confirm_work     is '영업 확인서 — IT 처리(건당 1행: 처리여부·처리자·비고·체크, 화면만 씀). prep_event_id·link_source 는 4단계용';
comment on table public.it_sales_confirm_units    is '영업 확인서 — IT 기기 칸(자산번호·시리얼·고친 사양·체크, 화면만 씀). 적은 칸만 행';
comment on table public.it_sales_import_state     is '영업 확인서 — 가져오기 상태(main 한 줄, 원문 없음)';

comment on column public.it_sales_confirms.payload        is '영업 원문 전체(연락처·주소 포함) — 로그·오류 문구·라우트 응답에 넣지 말 것';
comment on column public.it_sales_confirms.first_saved_at is '처음 본 버전의 savedAt = 목록 접수일시';
comment on column public.it_sales_confirm_work.prep_event_id is '4단계용(출고 준비 일정 연결) — 1~3단계 코드는 안 씀';

notify pgrst, 'reload schema';


-- ==================================================================
-- 2+3단계 블록 A (2026-11-26) — ④ 기기 칸 종류별 값·차이 확인 기록, ③ 출력 기록
--
-- ※ 위(1단계)를 이미 실행한 DB 는 **이 블록만** 복사해서 SQL Editor 에서 실행하세요.
--   파일 전체를 다시 실행해도 결과는 같습니다(위쪽은 전부 if not exists·on conflict do nothing).
--   앱 2+3단계 배포 전에 실행. 실행 전에도 앱은 열림 — 상세는 보이고 기기 칸 저장만 "SQL 실행 필요",
--   출력은 되고 기록은 printed_at 만(설계 §3-2 "SQL 전 동작").
--
-- 무엇(칸 이름·모양 = lib/salesConfirms/types.ts SalesUnitRow·SalesUnitExtra·DiffAckMap·SalesConfirmDetailData.work):
--   ④ it_sales_confirm_units
--      extra       jsonb not null default '{}' — 품목 종류별 칸. 소프트웨어 = { pc: 설치 PC 자산번호, user: 사용자,
--                  ledgerPushed: { product, pc, user, at } }(지난번 대장 좌석에 올린 값 — 대장에서 사람이 고친 칸을
--                  안 덮기 위한 비교용, 설계 §3-11). 다른 종류는 지금 비어 있음('{}').
--      diff_ack    jsonb not null default '{}' — 영업 요청과 다른 칸을 확인한 기록(D27).
--                  { 'maker' | 'model' | 'spec:<사양 칸>'(예 'spec:RAM'): { sales, actual, at, by } }
--                  지금의 (영업 값, 출고 값) 쌍이 기록과 같을 때만 "확인됨" — 다르면 화면·서버가 다시 물음.
--   ③ it_sales_confirm_work
--      printed_ver integer null            — 마지막으로 출력한 영업 판(ver). 출력 전이면 null(D25).
--      printed_by  text not null default '' — 출력한 사람(열 때 적은 이름). printed_at 은 1단계에 이미 있음.
--
-- !! 라이선스 키는 이 표들(①~⑤) 어디에도 넣지 않습니다 — extra·diff_ack·note·item_snapshot·checks 포함.
--    키는 계약관리 잠긴 비밀 칸(it_contract_secrets, lib/contracts/secrets.ts 한 파일)에만 저장(D28·D29). !!
--
-- 권한: 위 표 단위 RLS·revoke 그대로 — 새 칸도 서버(관리자 키)만 읽고 씀. 정책·grant 없음.
-- 데이터를 바꾸는 문장 없음(기존 줄은 기본값 '{}'·null·'' 로 채워짐 — 기존 칸은 안 건드림).
-- 여러 번 실행해도 안전: add column if not exists, 검사(제약)는 이름 고정 + 이미 있으면 건너뜀.
--
-- 되돌리기(롤백) — 앱을 먼저 2+3단계 전으로 되돌린 뒤에(앱이 남아 있으면 기기 칸 저장이 "SQL 실행 필요"로 막힘):
--   !! 지우면 영구히 사라집니다:
--      diff_ack = 누가 언제 어느 칸의 차이(영업 요청 → 출고 값)를 확인했는지,
--      extra    = 소프트웨어 칸의 설치 PC·사용자와 대장 비교값(ledgerPushed — 지우면 다음 대장 반영 때
--                 대장에서 사람이 고친 칸을 구별 못 함),
--      printed_ver·printed_by = 출력 기록("출력 뒤 바뀜 — 다시 뽑기" 판단이 사라짐).
--      데이터가 있으면 먼저 Table Editor 에서 it_sales_confirm_units·it_sales_confirm_work 를 CSV 로 내보내 두세요.
--      칸을 지우면 그 칸의 검사(_is_object 제약)도 같이 지워집니다. !!
--   alter table public.it_sales_confirm_units drop column if exists diff_ack, drop column if exists extra;
--   alter table public.it_sales_confirm_work  drop column if exists printed_ver, drop column if exists printed_by;
--   notify pgrst, 'reload schema';
-- ==================================================================

-- 먼저 있어야 하는 표 확인(1단계 SQL 전이면 아무것도 안 바꾸고 멈춤 — 쉬운 말로)
do $$
begin
  if to_regclass('public.it_sales_confirm_units') is null
     or to_regclass('public.it_sales_confirm_work') is null then
    raise exception '영업 확인서 표가 없어요 — supabase/sales_confirms_schema.sql 파일 전체를 먼저 실행해 주세요.';
  end if;
end
$$;

-- ④ 기기 칸: 종류별 칸 · 차이 확인 기록
alter table public.it_sales_confirm_units
  add column if not exists extra    jsonb not null default '{}'::jsonb,
  add column if not exists diff_ack jsonb not null default '{}'::jsonb;

-- ③ IT 처리: 출력 기록(판·사람)
alter table public.it_sales_confirm_work
  add column if not exists printed_ver integer,
  add column if not exists printed_by  text not null default '';

-- ④ 두 칸은 객체({…})만(1단계 checks·spec_override 와 같은 꼴). 이름 고정 — 이미 있으면 건너뜀.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.it_sales_confirm_units'::regclass
                   and conname  = 'it_sales_confirm_units_extra_is_object') then
    alter table public.it_sales_confirm_units
      add constraint it_sales_confirm_units_extra_is_object check (jsonb_typeof(extra) = 'object');
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.it_sales_confirm_units'::regclass
                   and conname  = 'it_sales_confirm_units_diff_ack_is_object') then
    alter table public.it_sales_confirm_units
      add constraint it_sales_confirm_units_diff_ack_is_object check (jsonb_typeof(diff_ack) = 'object');
  end if;
end
$$;

-- 칸 설명(Supabase Table Editor 에 보임)
comment on column public.it_sales_confirm_units.extra       is '종류별 칸(소프트웨어: pc·user·ledgerPushed) — 라이선스 키는 절대 넣지 않음(키는 it_contract_secrets 에만)';
comment on column public.it_sales_confirm_units.diff_ack    is '영업 요청과 다른 칸 확인 기록 {maker|model|spec:<칸>: {sales, actual, at, by}} — 지금 쌍과 같을 때만 확인됨(D27)';
comment on column public.it_sales_confirm_work.printed_ver  is '마지막으로 출력한 영업 판(ver) — 출력 전 null(D25)';
comment on column public.it_sales_confirm_work.printed_by   is '마지막으로 출력한 사람(D25)';

notify pgrst, 'reload schema';
