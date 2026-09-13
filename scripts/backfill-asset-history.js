/**
 * asset_history 백필 스크립트
 *
 * 지금 it_assets 에 들어있는 자산번호 각각에 대해, 원본 구글시트 엑셀 내보내기
 * (IT팀_재고관리.xlsx)의 노트북/데스크탑/모니터/기타주변기기 시트에서 같은
 * 자산번호+품목의 "비고" 원문을 찾아 "YY.MM.DD 내용" 패턴으로 분리한 뒤
 * asset_history 테이블에 채워 넣습니다.
 *
 * 범위: 지금 it_assets 에 이미 있는 자산번호만 대상으로 합니다. xlsx 전체
 * (~2,700행)를 it_assets 에 새로 적재하는 건 이 스크립트의 역할이 아닙니다.
 *
 * 실행:
 *   node --env-file=.env.local scripts/backfill-asset-history.js "<xlsx 경로>"
 *
 * 여러 번 실행해도 안전합니다 — 원본에서 비고를 찾은 자산번호만, 기존
 * asset_history 행을 지우고 새로 채웁니다 (못 찾은 자산의 기존 이력은 건드리지 않음).
 */

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const SHEET_NAMES = ['노트북', '데스크탑', '모니터', '기타주변기기'];
// "26.05.06 고태훈프로 사용" 처럼 YY.MM.DD 로 시작하는 조각만 날짜로 인식합니다.
const DATE_SEGMENT = /^\s*(\d{2})\.(\d{2})\.(\d{2})[.\s]*([\s\S]*)$/;

function parseSegments(rawRemark) {
  return rawRemark
    .split('/')
    .map((s) => s.replace(/\t/g, ' ').trim())
    .filter((s) => s && s !== '*') // 빈 조각 / 악성 표시(*)는 버림 — malicious 컬럼에 이미 반영됨
    .map((seg) => {
      const match = seg.match(DATE_SEGMENT);
      if (match) {
        const [, yy, mm, dd, rest] = match;
        const month = Number(mm);
        const day = Number(dd);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return { event_date: `20${yy}-${mm}-${dd}`, content: rest.trim(), raw_text: seg };
        }
      }
      // 날짜 패턴이 없는 조각(예: "하드미포함 가격", "새기기")도 내용은 보존합니다.
      return { event_date: null, content: seg, raw_text: seg };
    });
}

async function main() {
  const xlsxPath = process.argv[2];
  if (!xlsxPath) {
    console.error('사용법: node --env-file=.env.local scripts/backfill-asset-history.js "<xlsx 경로>"');
    process.exit(1);
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요해요.');
    console.error('(.env.local 을 --env-file 로 넘겼는지 확인하세요.)');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const workbook = XLSX.readFile(xlsxPath);

  // "<품목>|<자산번호>" -> 비고 원문
  const remarkMap = new Map();
  for (const sheetName of SHEET_NAMES) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      console.warn(`[경고] "${sheetName}" 시트를 워크북에서 찾지 못했어요. 건너뜁니다.`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const header = rows[0] || [];
    const assetIdCol = header.findIndex((h) => typeof h === 'string' && h.includes('자산번호'));
    const remarkCol = header.findIndex((h) => typeof h === 'string' && h.includes('비고'));
    if (assetIdCol === -1 || remarkCol === -1) {
      console.warn(`[경고] "${sheetName}" 시트에서 자산번호/비고 헤더를 못 찾았어요. 건너뜁니다.`);
      continue;
    }
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const assetId = row[assetIdCol];
      const remark = row[remarkCol];
      if (!assetId || !remark) continue;
      remarkMap.set(`${sheetName}|${String(assetId).trim()}`, String(remark));
    }
  }

  const { data: assets, error: fetchError } = await supabase
    .from('it_assets')
    .select('asset_id, category');
  if (fetchError) {
    console.error('it_assets 조회 실패:', fetchError.message);
    process.exit(1);
  }

  let matched = 0;
  let unmatched = 0;
  let historyRows = 0;

  for (const asset of assets) {
    const remark = remarkMap.get(`${asset.category}|${asset.asset_id}`);
    if (!remark) {
      unmatched += 1;
      continue;
    }
    matched += 1;

    const segments = parseSegments(remark);
    if (segments.length === 0) continue;

    const { error: deleteError } = await supabase
      .from('asset_history')
      .delete()
      .eq('asset_id', asset.asset_id);
    if (deleteError) {
      console.error(`[${asset.asset_id}] 기존 이력 삭제 실패: ${deleteError.message}`);
      continue;
    }

    const { error: insertError } = await supabase
      .from('asset_history')
      .insert(segments.map((s) => ({ asset_id: asset.asset_id, ...s })));
    if (insertError) {
      console.error(`[${asset.asset_id}] 이력 삽입 실패: ${insertError.message}`);
      continue;
    }
    historyRows += segments.length;
  }

  console.log('--- asset_history 백필 완료 ---');
  console.log(`it_assets 전체: ${assets.length}건`);
  console.log(`원본 xlsx에서 비고 찾음: ${matched}건`);
  console.log(`원본 xlsx에서 못 찾음(건드리지 않음): ${unmatched}건`);
  console.log(`삽입된 asset_history 행: ${historyRows}건`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
