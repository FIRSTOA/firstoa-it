-- ==================================================================
-- 계약 관리 1단계 — 소프트웨어 계약 표 6개 (2026-11-20, 같은 날 D13 으로 고침)
--
-- 목적: /contracts 화면(소프트웨어 계약)이 쓰는 우리 기록.
--       거래처 목록 자체는 화면을 열 때마다 firstoa-works 에서 읽고(여기 저장 안 함),
--       이 표들에는 그 거래처에 사람이 붙인 정보만 담습니다.
--         ① it_contract_clients     계약 거래처(works 열쇠: 본 적 있는 assets.id · 거래처 코드 · 정규화 이름)
--         ② it_sw_contracts         거래처의 계약 상품(소프트웨어 한 종류)
--         ③ it_sw_seats             라이선스 한 개 = 사용자 배정 한 줄
--                                   (2차인증 mfa_note 는 가리지 않는 평문 칸 — 사용자 결정 D9)
--         ④ it_contract_secrets     비밀 칸 값(라이선스 키·마스터 계정·관리자 계정·결제 카드·기타)
--         ⑤ it_contract_secret_log  잠금 해제·비밀 칸 수정·인증 기록(값은 적지 않음)
--         ⑥ it_contract_settings    소프트웨어 탭 비밀번호 해시·쿠키 서명용 무작위 값(화면에서 처음 정함)
--       설계: docs/tasks/2026-11-20-contract-management.md §3-3 (맨 위 D1~D12 결정이 우선)
--
-- 비밀 값(D13 — 사용자 결정 "그냥 저장"): ④에 암호화 없이 그대로 저장합니다. 다른 IT 대장(임대리스트·청구)처럼
--          서버(관리자 키)만 읽을 수 있고, 화면에서는 소프트웨어 탭 비밀번호를 넣어야 보입니다.
--          Supabase 관리 화면에 들어갈 수 있는 사람은 ④ 값을 볼 수 있습니다(시트를 볼 수 있던 것과 비슷한 수준).
--          비밀번호는 ⑥에 PBKDF2 해시로만 저장. 비밀번호를 잊으면 ⑥의 'sw_password_hash' 줄을 지우고 화면에서 다시 정하면 됨
--          (④ 값은 그대로 — 암호화가 아니라 잃을 것 없음).
-- 이 파일을 예전 판(④ sealed 암호문 칸)으로 이미 실행했어도 다시 실행하면 맨 아래 "예전 판 고치기"가 칸 이름을 바꿉니다.
--
-- 실행 방법: Supabase SQL Editor 에서 한 번 실행 (New query 에 붙여넣고 Run).
-- 여러 번 실행해도 안전합니다 (create table if not exists / create index if not exists /
-- drop trigger if exists / create or replace). 기존 표는 건드리지 않습니다.
-- 이 표들이 없으면 앱은 works 거래처 목록만 보여 주고 "SQL 을 먼저 실행해 주세요" 안내.
-- 2단계(PC 유지보수 방문 기록 — it_pcm_visits 등)는 이 파일에 없습니다(따로 만듦).
--
-- 보안: 다른 it_* 대장과 같은 모델 — RLS 켜고 정책 없음 + anon·authenticated 권한 회수
--       → 서버(관리자 키)로만 접근. 브라우저가 직접 읽는 길은 없습니다.
--
-- 되돌리기(롤백): 아래를 이 순서로(비밀 표 먼저). 색인·트리거·제약도 같이 지워집니다.
--   !! 지우면 앱에 옮긴 비번·라이선스 키와 기록이 영구히 사라집니다.
--      데이터가 있으면 먼저 Table Editor 에서 표마다 CSV 로 내보내 두세요. !!
--   drop table if exists public.it_contract_settings;
--   drop table if exists public.it_contract_secret_log;
--   drop table if exists public.it_contract_secrets;
--   drop table if exists public.it_sw_seats;
--   drop table if exists public.it_sw_contracts;
--   drop table if exists public.it_contract_clients;
--   notify pgrst, 'reload schema';
-- (public.set_updated_at() 함수는 다른 표들도 쓰므로 지우지 않습니다.)
-- ==================================================================


-- ------------------------------------------------------------------
-- ① 계약 거래처 — 소프트웨어·PC유지보수 둘 다인 거래처도 한 행(연락처·메모 공유)
-- ------------------------------------------------------------------
create table if not exists public.it_contract_clients (
  id              uuid primary key default gen_random_uuid(),

  -- 표시 이름(처음엔 works 거래처명). works 이름이 바뀌어도 자동으로 안 바꿈(안내만).
  name            text not null
                  constraint it_contract_clients_name_not_blank check (btrim(name) <> ''),

  -- 정규화 이름(㈜·(주)·주식회사·(유)·유한회사·공백·기호 제거, 소문자 — lib/contracts/nameKey.ts).
  -- 같은 거래처가 두 행으로 생기지 않게 unique. 이름이 정규화 뒤 빈 글자가 되면 저장 거절.
  name_key        text not null
                  constraint it_contract_clients_name_key_key unique
                  constraint it_contract_clients_name_key_not_blank check (name_key <> ''),
  alias_keys      text[] not null default '{}',   -- 다른 표기(정규화 이름) — "같은 거래처로 합치기"로 더함

  -- works 거래처 코드(ecount_code 를 앱이 정리한 값: 10자리 또는 P번호). 화면·브라우저로 안 보냄.
  -- 개인 고객 주민번호 꼴(숫자 13자리, 6-7 하이픈 포함)은 앱이 버리지만, 혹시 들어오면 DB 도 거절.
  vendor_codes    text[] not null default '{}'
                  constraint it_contract_clients_vendor_codes_no_rrn
                  check (array_to_string(vendor_codes, ',') !~ '(^|,)[0-9]{6}-?[0-9]{7}(,|$)'),

  -- 저장할 때 이 거래처에 맞았던 works assets.id(= it_rental_list.sheet_row). 더하기만, 빼지 않음.
  seen_asset_ids  integer[] not null default '{}',

  not_in_works    boolean not null default false, -- works 에 없는 거래처(판매·직접 계약·시트 옮기기 "미분류")
  manual_status   text not null default ''         -- 사람이 정한 "계약 종료"/"숨김"(화면 계산보다 우선)
                  constraint it_contract_clients_manual_status_check
                  check (manual_status in ('', 'ended', 'hidden')),

  sales_owner     text not null default '',  -- 퍼스트 영업담당(시트 6번)
  it_owner        text not null default '',  -- 전산담당(시트 7번)
  key_person      text not null default '',  -- 키맨(평문 — works·임대리스트에도 보이는 정보)
  key_phone       text not null default '',
  memo            text not null default '',

  created_by      text not null default '',  -- 적은 사람(로그인 기능 전이라 직접 입력, 브라우저에 기억)
  updated_by      text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- vendor_codes·seen_asset_ids 색인(GIN)은 만들지 않음: 거래처 수백 곳이라 서버에서 한 번에 읽어 맞춤(설계 §3-3).


-- ------------------------------------------------------------------
-- ② 계약 상품 — 거래처의 소프트웨어 한 종류
-- ------------------------------------------------------------------
create table if not exists public.it_sw_contracts (
  id                uuid primary key default gen_random_uuid(),

  -- 거래처를 지우려면 상품부터 옮기거나 지워야 함(restrict). 상품 옮기기 = client_id 만 바꿈.
  client_id         uuid not null
                    constraint it_sw_contracts_client_id_fkey
                    references public.it_contract_clients(id) on delete restrict,

  product           text not null
                    constraint it_sw_contracts_product_not_blank check (btrim(product) <> ''),
  supplier          text not null default '',  -- 매입처
  license_type      text not null default 'unknown'
                    constraint it_sw_contracts_license_type_check
                    check (license_type in ('perpetual', 'subscription', 'free', 'unknown')),
  term              text not null default ''   -- 구독 단위
                    constraint it_sw_contracts_term_check
                    check (term in ('', 'monthly', 'yearly')),
  pay_cycle         text not null default ''   -- 결제 주기
                    constraint it_sw_contracts_pay_cycle_check
                    check (pay_cycle in ('', 'monthly', 'yearly', 'once')),
  license_type_raw  text not null default '',  -- 시트 원문("영구 라이선스 (일회성 구매)" 등)
  quantity          integer                    -- 비우면 좌석 수로 셈
                    constraint it_sw_contracts_quantity_check check (quantity >= 0),

  starts_on         date,                      -- 계약 전체 날짜
  renews_on         date,
  ends_on           date,

  cost_note         text not null default '',  -- 비용 원문(숫자로 안 바꿈)
  admin_portal      text not null default '',  -- 관리 콘솔 주소(계정·비번은 ④ 비밀 칸)
  setup_vendor      text not null default '',  -- 초기세팅업체
  status            text not null default '사용중'
                    constraint it_sw_contracts_status_check
                    check (status in ('사용중', '해지', '만료', '보류')),
  memo              text not null default '',

  source            text not null default 'app'
                    constraint it_sw_contracts_source_check
                    check (source in ('app', 'sheet_renew', 'sheet_perm')),
  -- 시트 옮기기 중복 방지 열쇠. 앱에서 만든 상품은 null(빈 글자 '' 금지 — 둘째 상품부터 겹치므로).
  -- 일반 unique(부분 인덱스 아님) → upsert onConflict 'source_key' 대상. null 끼리는 안 겹침.
  source_key        text
                    constraint it_sw_contracts_source_key_key unique
                    constraint it_sw_contracts_source_key_not_blank
                    check (source_key is null or btrim(source_key) <> ''),

  created_by        text not null default '',
  updated_by        text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists it_sw_contracts_client_id_idx on public.it_sw_contracts (client_id);
create index if not exists it_sw_contracts_renews_on_idx on public.it_sw_contracts (renews_on);
create index if not exists it_sw_contracts_ends_on_idx   on public.it_sw_contracts (ends_on);


-- ------------------------------------------------------------------
-- ③ 좌석 — 라이선스 한 개 = 사용자 배정 한 줄
-- ------------------------------------------------------------------
create table if not exists public.it_sw_seats (
  id              uuid primary key default gen_random_uuid(),

  -- 상품을 지우려면 좌석부터 지워야 함(restrict — 좌석 삭제는 비밀 확인을 거치는 서버 액션 하나로).
  contract_id     uuid not null
                  constraint it_sw_seats_contract_id_fkey
                  references public.it_sw_contracts(id) on delete restrict,

  user_name       text not null default '',
  dept            text not null default '',
  pc_asset_code   text not null default '',  -- 설치 PC 자산번호(앱이 대문자·공백 제거해 저장)
  mfa_note        text not null default '',  -- 2차인증 — 가리지 않는 평문 칸(D9, 시트 11번 원문 그대로)

  works_asset_id  integer,                   -- 이 라이선스의 works 임대 건(assets.id) — 사람이 연결(선택)
  works_seq       text not null default '',  -- 그 임대 건의 순(classification_number)

  installed_on    date,
  purchased_on    date,
  renews_on       date,
  ends_on         date,

  status          text not null default '사용중'
                  constraint it_sw_seats_status_check
                  check (status in ('사용중', '미배정', '회수', '해지', '만료')),
  memo            text not null default '',

  source          text not null default 'app'
                  constraint it_sw_seats_source_check
                  check (source in ('app', 'sheet_renew', 'sheet_perm')),
  -- 시트 옮기기 중복 방지 열쇠 'perm:<시트 행번호>' / 'renew:<시트 행번호>'. 앱에서 만든 좌석은 null('' 금지).
  source_key      text
                  constraint it_sw_seats_source_key_key unique
                  constraint it_sw_seats_source_key_not_blank
                  check (source_key is null or btrim(source_key) <> ''),
  -- 시트 원본 칸(머리줄 이름 → 값). 비밀 칸(라이선스 키·계정·카드)은 넣지 않음 — 앱이 빼고 저장.
  source_raw      jsonb not null default '{}'::jsonb
                  constraint it_sw_seats_source_raw_is_object
                  check (jsonb_typeof(source_raw) = 'object'),

  created_by      text not null default '',
  updated_by      text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists it_sw_seats_contract_id_idx    on public.it_sw_seats (contract_id);
create index if not exists it_sw_seats_pc_asset_code_idx  on public.it_sw_seats (pc_asset_code);  -- 자산 상세 "이 PC의 소프트웨어"(3단계)
create index if not exists it_sw_seats_works_asset_id_idx on public.it_sw_seats (works_asset_id);


-- ------------------------------------------------------------------
-- ④ 비밀 칸 값(D13 그대로 저장) — lib/contracts/secrets.ts 한 파일만 읽고 씀
--    한 줄 = (계약 상품 또는 좌석 하나) × (칸 하나). 2차인증은 여기 없음(D9 — ③ mfa_note).
-- ------------------------------------------------------------------
create table if not exists public.it_contract_secrets (
  id           uuid primary key default gen_random_uuid(),

  -- 둘 중 정확히 하나만 채움(아래 one_owner). 주인이 지워지면 비밀도 같이 지워짐(cascade).
  contract_id  uuid                          -- 계약 단위(관리 콘솔 계정·결제 카드 등 사람이 넣는 것)
               constraint it_contract_secrets_contract_id_fkey
               references public.it_sw_contracts(id) on delete cascade,
  seat_id      uuid                          -- 좌석 단위(시트에서 옮긴 것은 전부 여기)
               constraint it_contract_secrets_seat_id_fkey
               references public.it_sw_seats(id) on delete cascade,

  field        text not null
               constraint it_contract_secrets_field_check
               check (field in ('license_key', 'account', 'admin_account', 'card', 'other')),

  -- 값 그대로(D13). 빈 값은 저장하지 않음(지우기 = 줄 삭제).
  value_text   text not null
               constraint it_contract_secrets_value_not_blank check (value_text <> ''),

  updated_by   text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint it_contract_secrets_one_owner
    check (num_nonnulls(contract_id, seat_id) = 1),
  -- 일반 unique(부분 인덱스 아님) → upsert onConflict 'contract_id,field' / 'seat_id,field' 대상.
  -- 비어 있는 쪽(null)은 서로 안 겹치므로, 좌석 비밀끼리·계약 비밀끼리만 중복을 막음.
  -- 두 열쇠는 이 표의 주인별 조회(.in('seat_id', …))와 cascade 삭제 때 색인으로도 쓰임.
  constraint it_contract_secrets_contract_id_field_key unique (contract_id, field),
  constraint it_contract_secrets_seat_id_field_key     unique (seat_id, field)
);


-- ------------------------------------------------------------------
-- ⑤ 비밀 칸 열람·수정·인증 기록 — 값은 절대 적지 않음. 실패 횟수 제한도 이 표로 셈.
--    client_id / contract_id / seat_id 에 FK 를 걸지 않음: 거래처·상품·좌석이 지워져도 기록은 남아야 함.
-- ------------------------------------------------------------------
create table if not exists public.it_contract_secret_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  action       text not null
               constraint it_contract_secret_log_action_check
               check (action in ('unlock_ok', 'unlock_fail', 'lock', 'view', 'view_bulk', 'edit', 'delete', 'import')),
  actor        text not null default '',   -- 열 때 적은 이름
  client_id    uuid,                        -- FK 없음(위 설명)
  contract_id  uuid,
  seat_id      uuid,
  client_name  text not null default '',   -- 그때 거래처 이름(나중에 지워져도 읽히게)
  field        text not null default '',
  event_count  integer not null default 1  -- view_bulk·import 때 개수
               constraint it_contract_secret_log_event_count_check check (event_count >= 0),
  ip_hash      text not null default '',   -- IP 를 HMAC 한 앞 16자(원래 IP 는 저장 안 함)
  ua           text not null default '',   -- 짧은 기기 이름
  note         text not null default ''
);

create index if not exists it_contract_secret_log_at_idx         on public.it_contract_secret_log (at desc);
create index if not exists it_contract_secret_log_action_at_idx  on public.it_contract_secret_log (action, at desc);
create index if not exists it_contract_secret_log_ip_hash_at_idx on public.it_contract_secret_log (ip_hash, at desc);


-- ------------------------------------------------------------------
-- ⑥ 설정 — key 'sw_password_hash' = 소프트웨어 탭 비밀번호 PBKDF2 해시("pbkdf2-sha256$반복$salt$hash"),
--          key 'cookie_secret' = 잠금 해제 쿠키 서명·IP 해시용 무작위 값(앱이 처음 한 번 만듦).
--    비밀번호 평문은 어디에도 없음. 잊었으면: delete from public.it_contract_settings where key = 'sw_password_hash';
-- ------------------------------------------------------------------
create table if not exists public.it_contract_settings (
  key         text primary key,
  value       text not null,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now()
);


-- ------------------------------------------------------------------
-- 예전 판 고치기 — 이 파일의 예전 판(④ 칸 sealed = 암호문, key_version)을 이미 실행한 DB 만 해당.
-- 새로 실행하는 DB 에서는 아무 일도 안 함. 데이터가 없는 상태에서만 실행됨(앱 배포 전이라 비어 있음).
-- ------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'it_contract_secrets' and column_name = 'sealed') then
    if exists (select 1 from public.it_contract_secrets) then
      raise exception 'it_contract_secrets 에 예전 암호문이 있어요 — 자동으로 바꾸지 않습니다. 팀장에게 알려 주세요.';
    end if;
    alter table public.it_contract_secrets drop constraint if exists it_contract_secrets_sealed_format;
    alter table public.it_contract_secrets drop constraint if exists it_contract_secrets_key_version_check;
    alter table public.it_contract_secrets drop column if exists key_version;
    alter table public.it_contract_secrets rename column sealed to value_text;
    alter table public.it_contract_secrets
      add constraint it_contract_secrets_value_not_blank check (value_text <> '');
  end if;
end
$$;


-- ------------------------------------------------------------------
-- updated_at 자동 갱신(schema.sql 의 것과 내용이 똑같음 — 없을 때를 대비해 다시 만들어 둠)
-- ⑤ 기록 표는 updated_at 이 없음(잠금 해제 시도 줄의 note·action 만 앱이 고침).
-- ------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists it_contract_clients_set_updated_at on public.it_contract_clients;
create trigger it_contract_clients_set_updated_at
  before update on public.it_contract_clients
  for each row execute function public.set_updated_at();

drop trigger if exists it_sw_contracts_set_updated_at on public.it_sw_contracts;
create trigger it_sw_contracts_set_updated_at
  before update on public.it_sw_contracts
  for each row execute function public.set_updated_at();

drop trigger if exists it_sw_seats_set_updated_at on public.it_sw_seats;
create trigger it_sw_seats_set_updated_at
  before update on public.it_sw_seats
  for each row execute function public.set_updated_at();

drop trigger if exists it_contract_secrets_set_updated_at on public.it_contract_secrets;
create trigger it_contract_secrets_set_updated_at
  before update on public.it_contract_secrets
  for each row execute function public.set_updated_at();

drop trigger if exists it_contract_settings_set_updated_at on public.it_contract_settings;
create trigger it_contract_settings_set_updated_at
  before update on public.it_contract_settings
  for each row execute function public.set_updated_at();


-- ------------------------------------------------------------------
-- 보안: RLS 켜고 정책은 만들지 않음 + anon·authenticated 권한 회수 → 서버(관리자 키)로만 접근.
-- (Supabase 는 public 스키마의 새 표에 anon·authenticated 권한을 자동으로 주므로 명시적으로 회수)
-- ------------------------------------------------------------------
alter table public.it_contract_clients    enable row level security;
alter table public.it_sw_contracts        enable row level security;
alter table public.it_sw_seats            enable row level security;
alter table public.it_contract_secrets    enable row level security;
alter table public.it_contract_secret_log enable row level security;
alter table public.it_contract_settings   enable row level security;

revoke all on table
  public.it_contract_clients,
  public.it_sw_contracts,
  public.it_sw_seats,
  public.it_contract_secrets,
  public.it_contract_secret_log,
  public.it_contract_settings
from anon, authenticated;

-- ⑤의 번호(identity) 시퀀스도 같은 이유로 회수(시퀀스 이름은 DB 에서 직접 찾음).
do $$
declare
  seq_name text := pg_get_serial_sequence('public.it_contract_secret_log', 'id');
begin
  if seq_name is not null then
    execute format('revoke all on sequence %s from anon, authenticated', seq_name);
  end if;
end
$$;


-- 표 설명(Supabase Table Editor 에 보임)
comment on table public.it_contract_clients    is '계약 관리 — 계약 거래처(works 소프트웨어·PC유지보수 거래처에 사람이 붙인 정보)';
comment on table public.it_sw_contracts        is '계약 관리 — 거래처의 소프트웨어 계약 상품';
comment on table public.it_sw_seats            is '계약 관리 — 라이선스 한 개 = 사용자 배정 한 줄(mfa_note 는 평문)';
comment on table public.it_contract_secrets    is '계약 관리 — 비밀 칸 값(서버 전용, 화면은 소프트웨어 탭 비밀번호로). lib/contracts/secrets.ts 만 읽고 씀';
comment on table public.it_contract_secret_log is '계약 관리 — 잠금 해제·비밀 칸 수정·인증 기록(값 없음)';
comment on table public.it_contract_settings   is '계약 관리 — 소프트웨어 탭 비밀번호 해시·쿠키 서명 값(평문 비밀번호 없음)';

notify pgrst, 'reload schema';
