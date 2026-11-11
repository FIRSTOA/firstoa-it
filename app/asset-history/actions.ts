'use server';

import { findAsRecords, isAsSheetConfigured, type AsRecord } from '@/lib/as/sheet';
import { rowToBillingLine, sumConfirmedBilling, type BillingLineRow } from '@/lib/billing';
import { parseKoreanWon } from '@/lib/currency';
import { getAssetFromSheets, isInventorySheetConfigured, listAllAssets } from '@/lib/inventory/sheets';
import { rowToReceiving, type ReceivingRow } from '@/lib/receiving';
import {
  ASSET_PURCHASE_INFO_TABLE,
  BILLING_LINES_TABLE,
  RECEIVING_TABLE,
  RENTAL_TABLE,
  createAdminClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import type { Asset } from '@/lib/types';

export type LifecycleRental = {
  vendorName: string;
  siteName: string;
  contractDate: string;
  endDate: string;
  status: string;
  firstBilled: string; // 첫 청구월 YYYY-MM
  lastBilled: string; // 마지막 청구월 YYYY-MM
  billedMonths: number;
  billedTotal: number;
};

export type AssetLifecycle = {
  query: string;
  assetCode: string;
  serials: string[];
  asset: Pick<Asset, 'category' | 'brand' | 'model' | 'location' | 'status' | 'serialNo'> | null;
  receivedDate: string; // 입고일
  receivedSource: string; // 입고일 출처 설명
  purchaseVendor: string;
  purchasePrice: number | null;
  rentals: LifecycleRental[];
  billedTotal: number;
  asRecords: AsRecord[];
  asError: string;
};

export type LifecycleResult = { ok: true; data: AssetLifecycle } | { ok: false; error: string };

// PostgREST or() 필터에 그대로 넣어도 안전한 값만(자산번호/시리얼은 영숫자·하이픈 정도).
const SAFE_KEY = /^[A-Za-z0-9._-]+$/;

export async function getAssetLifecycle(rawQuery: string): Promise<LifecycleResult> {
  const query = rawQuery.trim().toUpperCase();
  if (!query) return { ok: false, error: '자산번호나 시리얼번호를 입력해주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 설정이 필요해요.' };

  const supabase = createAdminClient();

  // 1) IT재고 시트 — 자산번호로 먼저, 없으면 시리얼로.
  let asset: Asset | null = null;
  if (isInventorySheetConfigured()) {
    try {
      asset = await getAssetFromSheets(query);
      if (!asset) {
        const all = await listAllAssets();
        asset = all.find((a) => a.serialNo.trim().toUpperCase() === query) ?? null;
      }
    } catch (err) {
      console.error('[lifecycle] IT재고 조회 실패:', err);
    }
  }

  // 2) 임대리스트(firstoa-works 사본) — 자산번호 또는 시리얼.
  const lookupKeys = [query, asset?.assetId?.toUpperCase() ?? ''].filter((k) => k && SAFE_KEY.test(k));
  const orFilter = [...new Set(lookupKeys)]
    .flatMap((k) => [`asset_code.eq.${k}`, `serial_number.eq.${k}`])
    .join(',');
  const rentalRes = orFilter
    ? await supabase
        .from(RENTAL_TABLE)
        .select('sheet_row, asset_code, serial_number, vendor_name, site_name, contract_date, end_date, status')
        .or(orFilter)
        .order('contract_date', { ascending: true })
    : { data: [], error: null };
  if (rentalRes.error) return { ok: false, error: `임대리스트 조회 실패: ${rentalRes.error.message}` };
  const rentalRows = rentalRes.data ?? [];

  const assetCode = (asset?.assetId || rentalRows.find((r) => r.asset_code)?.asset_code || query).toUpperCase();
  const serials = [
    ...new Set(
      [asset?.serialNo ?? '', ...rentalRows.map((r) => String(r.serial_number ?? ''))]
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];

  // 3) 청구·입고·매입 — 자산번호 기준.
  const [billingRes, receivingRes, purchaseRes] = await Promise.all([
    supabase.from(BILLING_LINES_TABLE).select('*').eq('asset_id', assetCode).order('billing_date', { ascending: true }),
    supabase.from(RECEIVING_TABLE).select('*').eq('asset_id', assetCode).order('created_at', { ascending: true }),
    supabase.from(ASSET_PURCHASE_INFO_TABLE).select('*').eq('asset_id', assetCode).maybeSingle(),
  ]);
  const billingLines = ((billingRes.data ?? []) as BillingLineRow[]).map(rowToBillingLine);
  const receivings = ((receivingRes.data ?? []) as ReceivingRow[]).map(rowToReceiving);

  // 임대 건 — firstoa-works에 같은 임대가 중복 행으로 있는 경우가 있어 거래처+현장+계약일로 묶습니다.
  const rentalMap = new Map<string, LifecycleRental & { rows: Set<number> }>();
  for (const r of rentalRows) {
    const key = `${r.vendor_name}|${r.site_name}|${r.contract_date}`;
    const entry =
      rentalMap.get(key) ??
      {
        vendorName: String(r.vendor_name ?? ''),
        siteName: String(r.site_name ?? ''),
        contractDate: String(r.contract_date ?? ''),
        endDate: String(r.end_date ?? ''),
        status: String(r.status ?? ''),
        firstBilled: '',
        lastBilled: '',
        billedMonths: 0,
        billedTotal: 0,
        rows: new Set<number>(),
      };
    entry.rows.add(r.sheet_row as number);
    if (!entry.endDate && r.end_date) entry.endDate = String(r.end_date);
    rentalMap.set(key, entry);
  }
  const rentals = [...rentalMap.values()];
  for (const rental of rentals) {
    const lines = billingLines.filter((l) => l.rentalSheetRow !== null && rental.rows.has(l.rentalSheetRow));
    const billed = lines.filter((l) => l.status !== '취소' && l.allocationStatus === 'confirmed' && l.amount !== 0);
    const months = [...new Set(billed.map((l) => l.billingDate.slice(0, 7)).filter(Boolean))].sort();
    rental.billedTotal = sumConfirmedBilling(lines);
    rental.billedMonths = months.length;
    rental.firstBilled = months[0] ?? '';
    rental.lastBilled = months[months.length - 1] ?? '';
  }
  // 특정 임대 건에 안 묶인 청구(수기 입력 등)
  const allRows = new Set(rentals.flatMap((r) => [...r.rows]));
  const unassigned = billingLines.filter((l) => l.rentalSheetRow === null || !allRows.has(l.rentalSheetRow));
  const unassignedTotal = sumConfirmedBilling(unassigned);
  const rentalsOut: LifecycleRental[] = rentals.map(({ rows: _rows, ...rest }) => rest);
  if (unassignedTotal !== 0) {
    rentalsOut.push({
      vendorName: '임대 건 미지정',
      siteName: '수기 입력 등',
      contractDate: '',
      endDate: '',
      status: '',
      firstBilled: '',
      lastBilled: '',
      billedMonths: 0,
      billedTotal: unassignedTotal,
    });
  }

  // 입고일 — 입고 대장의 입고완료 기록 우선, 없으면 예상입고일.
  const completed = receivings.find((r) => r.status === '입고완료' && r.completedAt);
  const expected = receivings.find((r) => r.expectedDate);
  const receivedDate = completed?.completedAt?.slice(0, 10) ?? expected?.expectedDate ?? '';
  const receivedSource = completed ? '입고 대장(입고완료)' : expected ? '입고 대장(예상입고일)' : '';

  // 매입처·매입금액 — 구매단가 입력값 → IT재고 시트 → 입고 대장 순.
  const purchase = purchaseRes.data as { purchase_price: number | null; purchase_vendor: string } | null;
  const receivingWithPrice = receivings.find((r) => r.purchasePrice || r.vendor);
  const sheetPrice = asset?.purchasePrice ? parseKoreanWon(asset.purchasePrice) : null;
  const receivingPrice = receivingWithPrice?.purchasePrice ? parseKoreanWon(receivingWithPrice.purchasePrice) : null;
  const purchasePrice =
    purchase?.purchase_price !== null && purchase?.purchase_price !== undefined
      ? Number(purchase.purchase_price)
      : (sheetPrice ?? receivingPrice ?? null);
  const purchaseVendor = purchase?.purchase_vendor || asset?.vendor || receivingWithPrice?.vendor || '';

  // 4) AS 접수 — 구글시트.
  let asRecords: AsRecord[] = [];
  let asError = '';
  if (isAsSheetConfigured()) {
    try {
      asRecords = await findAsRecords([assetCode, ...serials]);
    } catch (err) {
      asError = err instanceof Error ? err.message : 'AS접수 시트를 읽지 못했어요.';
    }
  } else {
    asError = '구글 서비스계정 설정이 없어 AS접수 시트를 못 읽어요.';
  }

  return {
    ok: true,
    data: {
      query,
      assetCode,
      serials,
      asset: asset
        ? {
            category: asset.category,
            brand: asset.brand,
            model: asset.model,
            location: asset.location,
            status: asset.status,
            serialNo: asset.serialNo,
          }
        : null,
      receivedDate,
      receivedSource,
      purchaseVendor,
      purchasePrice,
      rentals: rentalsOut,
      billedTotal: sumConfirmedBilling(billingLines),
      asRecords,
      asError,
    },
  };
}

/** 자산 상세 팝업용 — AS 접수 건만. */
export async function getAssetAsRecords(assetId: string, serialNo: string): Promise<AsRecord[]> {
  if (!isAsSheetConfigured()) return [];
  try {
    return await findAsRecords([assetId, serialNo]);
  } catch (err) {
    console.error('[as] AS접수 시트 조회 실패:', err);
    return [];
  }
}
