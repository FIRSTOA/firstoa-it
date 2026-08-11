-- ==================================================================
-- IT 재고 샘플 데이터 (기존 화면의 시드 21건)
--
-- schema.sql 을 먼저 실행한 뒤 SQL Editor 에서 실행하세요.
-- asset_id 가 겹치면 덮어씁니다 (여러 번 실행해도 중복 생기지 않음).
--
-- 앱의 '샘플 데이터로 초기화' 버튼도 같은 데이터를 사용합니다 (lib/seed.ts).
-- ==================================================================

insert into public.it_assets
  (asset_id, category, brand, model, cpu, ram, storage, spec, screen, location, status, history, is_new, malicious)
values
  ('P2300', '노트북',       '삼성',   'NT900X5J-K58M',       'I5',  '07',  '8/256',    '저사양',   '15.6인치', 'J2',   '상품화완료',   '2건', false, true ),
  ('P1660', '노트북',       'HP',     'EliteBook 840 G7',    'I5',  '10',  '8/256',    '사무용',   '14인치',   'J1',   '상품화완료',   '2건', false, false),
  ('P1024', '노트북',       'HP',     'EliteBook 840 G7',    'I5',  '10',  '8/256',    '사무용',   '14인치',   'J1',   '상품화완료',   '4건', false, true ),
  ('P1911', '노트북',       'HP',     'PROBOOK 440 G7',      'I5',  '10',  '8/256',    '사무용',   '14인치',   'J1',   '상품화완료',   '2건', false, true ),
  ('X5006', '노트북',       '레노버', 'IdeaPad3 15ITL3',     'I5',  '11',  '8/256',    '사무용',   '15.6인치', 'J2',   '상품화완료',   '',    false, false),
  ('X7368', '노트북',       '레노버', 'THINKPAD L15 GEN 2',  'I5',  '11',  '8/512',    '사무용',   '15.6인치', 'J2',   '상품화완료',   '1건', false, false),
  ('X5037', '노트북',       'LG',     '15ZD90Q-GX30K',       'I5',  '13',  '16/256',   '사무용',   '15.6인치', 'J3',   '상품화완료',   '',    false, false),
  ('P2028', '노트북',       '삼성',   'NT901X5T-K03/C',      'I7',  '08',  '16/256',   '저사양',   '15.6인치', 'J4',   '상품화완료',   '1건', false, true ),
  ('X7706', '노트북',       'MSI',    'GF63 Thin 10SCSR',    'I7',  '10',  '16/256',   '설계용',   '15.6인치', 'J2',   '상품화완료',   '',    false, false),
  ('A5422', '노트북',       '레노버', 'IdeaPad3 15ITL6',     'I7',  '11',  '16/256',   '사무용',   '15.6인치', 'J2',   '상품화완료',   '',    false, false),
  ('P1902', '노트북',       'HP',     'ZBook Power G8',      'I7',  '11',  '16/1024',  '설계용',   '15.6인치', 'J2',   '상품화완료',   '1건', false, false),
  ('X8849', '노트북',       '삼성',   'NT750XFT-A51A',       'I7',  '13',  '16/512',   '사무용',   '15.6인치', 'J4',   '상품화완료',   '2건', false, false),
  ('P1909', '노트북',       'APPLE',  'A2338',               'M2',  '08',  '16/512',   '확인필요', '13.3인치', 'J3',   '상품화완료',   '1건', false, false),
  ('P0156', '노트북',       'APPLE',  'MacBook Pro 16 (M3)', 'M3',  '12',  '18/512',   '확인필요', '16인치',   'J3',   '상품화완료',   '1건', false, true ),
  ('P2189', '노트북',       'LG',     '15Z90S-GP56ML',       'U5',  '125', '16/256',   '사무용',   '15.6인치', 'C1',   '상품화완료',   '1건', true,  false),
  ('P2274', '노트북',       '삼성',   'NT751XHD-KR515',      'U5',  '225', '16/512',   '사무용',   '15.6인치', 'C2',   '상품화완료',   '1건', true,  false),
  ('X8678', '노트북',       'LG',     '15ZD90T-GX56K',       'U5',  '225', '16/1024',  '사무용',   '15.6인치', 'J3',   '상품화완료',   '3건', false, false),
  ('P3041', '노트북',       '삼성',   'NT751XHD-KR735',      'U7',  '255', '32/512',   '사무용',   '15.6인치', 'C2',   '상품화완료',   '1건', true,  false),
  ('D2201', '데스크탑',     '삼성',   'DM500S8L',            'I5',  '8',   '256',      '사무용',   '-',        'B1',   '상품화준비중', '',    false, false),
  ('M1042', '모니터',       'LG',     '27UL500',             '미상', '-',  '-',        '사무용',   '27인치',   'B2',   '임대중',       '',    false, false),
  ('E3391', '기타주변기기', 'HP',     '무선마우스 M240',      '미상', '-',  '-',        '사무용',   '-',        '창고', '기타',         '',    false, false)
on conflict (asset_id) do update set
  category  = excluded.category,
  brand     = excluded.brand,
  model     = excluded.model,
  cpu       = excluded.cpu,
  ram       = excluded.ram,
  storage   = excluded.storage,
  spec      = excluded.spec,
  screen    = excluded.screen,
  location  = excluded.location,
  status    = excluded.status,
  history   = excluded.history,
  is_new    = excluded.is_new,
  malicious = excluded.malicious;
