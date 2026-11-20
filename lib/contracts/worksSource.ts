import 'server-only';

/**
 * 계약 관리 — 거래처 목록의 원본(설계 §3-1, D6): firstoa-works 에서 화면을 열 때마다 실시간으로 읽음(보관 안 함).
 * works 가 안 읽히면 it_rental_list 사본(읽기만)으로 대신, 둘 다 안 되면 none.
 * 읽기 실패가 우리 표에 쓰기를 일으키지 않음 — 이 파일은 읽기만 한다.
 * 거래처 코드(ecount_code)는 vendorCodeKey 로 정리한 값만 서버 안에서 쓰고 브라우저로 안 보냄(주민번호 꼴은 '').
 */
import { fetchWorksAssetsByItems, isWorksConfigured } from '@/lib/works/client';
import { RENTAL_TABLE, createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { vendorCodeKey } from './nameKey';
import { PCM_ITEMS, SW_ITEMS, type ListSource, type WorksLine } from './types';

export type ContractAssetLine = WorksLine & { vendorCodeKey: string };

export type ContractAssets = {
  lines: ContractAssetLine[];
  source: ListSource;
  ms: number;
  error: string | null;
};

const ITEMS = [...SW_ITEMS, ...PCM_ITEMS];

const WORKS_COLS =
  'id,classification_number,ecount_code,name,sales_location,asset_code,model_name,device_sn,item_category,rental_status,contract_date,end_date';

type WorksRow = {
  id: number;
  classification_number: string | number | null;
  ecount_code: string | null;
  name: string | null;
  sales_location: string | null;
  asset_code: string | null;
  model_name: string | null;
  device_sn: string | null;
  item_category: string | null;
  rental_status: string | null;
  contract_date: string | null;
  end_date: string | null;
};

const str = (v: string | number | null | undefined) => String(v ?? '').trim();

/** "2024. 12. 16" / "2024-12-16" / "2024-12-16T..." → "2024-12-16" (못 읽으면 원문) — worksSync 와 같은 규칙 */
function normalizeDate(v: string | null | undefined): string {
  const s = str(v);
  const m = s.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
}

function describeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError' || /timeout|aborted/i.test(raw))) return '시간이 너무 오래 걸렸어요(8초)';
  return raw;
}

async function readWorks(): Promise<ContractAssetLine[]> {
  if (!isWorksConfigured()) throw new Error('firstoa-works 접속 설정이 없어요');
  const rows = await fetchWorksAssetsByItems<WorksRow>(ITEMS, WORKS_COLS, { timeoutMs: 8000 });
  return rows.map((r) => ({
    assetId: r.id,
    seq: str(r.classification_number),
    vendorName: str(r.name),
    siteName: str(r.sales_location),
    assetCode: str(r.asset_code),
    modelName: str(r.model_name),
    serial: str(r.device_sn),
    item: str(r.item_category),
    status: str(r.rental_status),
    contractDate: normalizeDate(r.contract_date),
    endDate: normalizeDate(r.end_date),
    vendorCodeKey: vendorCodeKey(r.ecount_code),
  }));
}

type RentalRow = {
  sheet_row: number;
  seq: string | null;
  vendor_name: string | null;
  site_name: string | null;
  asset_code: string | null;
  model_name: string | null;
  serial_number: string | null;
  item: string | null;
  status: string | null;
  contract_date: string | null;
  end_date: string | null;
};

/** 임대리스트 사본 — sheet_row = works assets.id, seq = 순. 거래처 코드는 사본에 없음 */
async function readRentalCopy(): Promise<ContractAssetLine[]> {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 없어요');
  const supabase = createAdminClient();
  const out: ContractAssetLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(RENTAL_TABLE)
      .select('sheet_row, seq, vendor_name, site_name, asset_code, model_name, serial_number, item, status, contract_date, end_date')
      .in('item', ITEMS)
      .order('sheet_row', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as RentalRow[];
    for (const r of rows) {
      out.push({
        assetId: r.sheet_row,
        seq: str(r.seq),
        vendorName: str(r.vendor_name),
        siteName: str(r.site_name),
        assetCode: str(r.asset_code),
        modelName: str(r.model_name),
        serial: str(r.serial_number),
        item: str(r.item),
        status: str(r.status),
        contractDate: normalizeDate(r.contract_date),
        endDate: normalizeDate(r.end_date),
        vendorCodeKey: '',
      });
    }
    if (rows.length < 1000) return out;
  }
}

/**
 * 거래처 목록의 원본 줄 — works → 실패하면 임대리스트 사본 → 둘 다 실패면 none.
 * error: works 를 못 읽은 이유(사본으로 대신한 경우도 채움), works 가 0줄이면 품목 이름 확인 안내.
 * ms: works(또는 사본)를 읽는 데 걸린 시간.
 */
export async function loadContractAssets(): Promise<ContractAssets> {
  const t0 = Date.now();
  let worksError: string;
  try {
    const lines = await readWorks();
    return {
      lines,
      source: 'works',
      ms: Date.now() - t0,
      error: lines.length === 0 ? `works에서 품목 '${ITEMS.join("'·'")}' 줄을 못 찾았어요(품목 이름 확인)` : null,
    };
  } catch (e) {
    worksError = describeError(e);
  }
  const t1 = Date.now();
  try {
    const lines = await readRentalCopy();
    return { lines, source: 'rental_copy', ms: Date.now() - t1, error: `firstoa-works를 못 읽었어요 — ${worksError}` };
  } catch (e) {
    return {
      lines: [],
      source: 'none',
      ms: Date.now() - t0,
      error: `거래처 목록을 못 읽었어요 — works: ${worksError} / 임대리스트 사본: ${describeError(e)}`,
    };
  }
}
