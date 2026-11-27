'use server';

import { findAsRecords, isAsSheetConfigured, type AsRecord } from '@/lib/as/sheet';
import { computeRentalTerm, groupRentalRows, rowToBillingLine, sumConfirmedBilling, type BillingLineRow } from '@/lib/billing';
import { assignedRentalRowsForAsset } from '@/lib/billingAllocation';
import { parseKoreanWon } from '@/lib/currency';
import { getAssetFromSheets, isInventorySheetConfigured, listAllAssets } from '@/lib/inventory/sheets';
import { inventoryReadWarning } from '@/lib/inventory/tabRead';
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
  contractDate: string; // 시작(첫계약일 우선)
  endDate: string; // 끝(임대종료 건은 입력일), 진행중이면 ''
  status: string;
  months: number; // 계약 기준 개월수
  baseAmount: number | null; // 기본금액(월)
  contractTotal: number | null; // 개월수 × 기본금액
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
  contractTotal: number;
  asRecords: AsRecord[];
  asError: string;
  /** IT재고 시트를 (일부) 못 읽어 asset 이 비었을 수 있을 때 쉬운 말 한 줄('' = 문제 없음) */
  inventoryWarning: string;
};

export type LifecycleResult = { ok: true; data: AssetLifecycle } | { ok: false; error: string };

// PostgREST or() 필터에 그대로 넣어도 안전한 값만(자산번호/시리얼은 영숫자·하이픈 정도).
const SAFE_KEY = /^[A-Za-z0-9._-]+$/;

export async function getAssetLifecycle(rawQuery: string): Promise<LifecycleResult> {
  const query = rawQuery.trim().toUpperCase();
  if (!query) return { ok: false, error: '자산번호나 시리얼번호를 입력해주세요.' };
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 설정이 필요해요.' };

  const supabase = createAdminClient();

  // 1) IT재고 시트 — 자산번호로 먼저, 없으면 시리얼로(5탭 한 번에 읽기 1회).
  // 못 읽었으면 "IT재고에 없는 자산"으로 보이지 않게 inventoryWarning 으로 알림(예전엔 로그만 남기고 없는 것처럼 보였음).
  let asset: Asset | null = null;
  let inventoryWarning = '';
  if (isInventorySheetConfigured()) {
    try {
      asset = await getAssetFromSheets(query);
      if (!asset) {
        const read = await listAllAssets();
        asset = read.assets.find((a) => a.serialNo.trim().toUpperCase() === query) ?? null;
        if (!asset) inventoryWarning = inventoryReadWarning(read.failed, '그 탭에 있는 자산이면 현재 위치·상태가 안 보일 수 있어요.');
      }
    } catch (err) {
      console.error('[lifecycle] IT재고 조회 실패:', err instanceof Error ? err.message : err);
      inventoryWarning = 'IT재고 시트를 못 읽었어요(구글시트 읽기 한도일 수 있어요) — 1분쯤 뒤 다시 조회해 주세요. 현재 위치·상태가 안 보일 수 있어요.';
    }
  }

  // 2) 임대리스트(firstoa-works 사본) — 자산번호 또는 시리얼.
  const lookupKeys = [query, asset?.assetId?.toUpperCase() ?? ''].filter((k) => k && SAFE_KEY.test(k));
  // 자산번호를 직접 지정한 임대 건(works 자산번호가 빈 건)도 포함 — 정수 행 번호만 필터에 넣음
  const assignedRows = (
    await Promise.all([...new Set(lookupKeys)].map((k) => assignedRentalRowsForAsset(k)))
  )
    .flat()
    .filter((n) => Number.isInteger(n));
  const orFilter = [
    ...[...new Set(lookupKeys)].flatMap((k) => [`asset_code.eq.${k}`, `serial_number.eq.${k}`]),
    ...(assignedRows.length > 0 ? [`sheet_row.in.(${[...new Set(assignedRows)].join(',')})`] : []),
  ].join(',');
  const rentalRes = orFilter
    ? await supabase
        .from(RENTAL_TABLE)
        .select('*')
        .or(orFilter)
        .order('contract_date', { ascending: true })
    : { data: [], error: null };
  if (rentalRes.error) return { ok: false, error: `임대리스트 조회 실패: ${rentalRes.error.message}` };
  const rentalRows = (rentalRes.data ?? []) as Record<string, unknown>[];

  const assetCode = (asset?.assetId || String(rentalRows.find((r) => r.asset_code)?.asset_code ?? '') || query).toUpperCase();
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

  // 임대 건 — firstoa-works 중복 행은 거래처+현장+계약일로 묶고, 계약 기준 기간·금액을 계산합니다.
  const grouped = groupRentalRows(rentalRows);
  const rentalsOut: LifecycleRental[] = grouped.map((g) => {
    const term = computeRentalTerm(g);
    const lines = billingLines.filter((l) => l.rentalSheetRow !== null && g.sheetRows.includes(l.rentalSheetRow));
    const billed = lines.filter((l) => l.status !== '취소' && l.allocationStatus === 'confirmed' && l.amount !== 0);
    const months = [...new Set(billed.map((l) => l.billingDate.slice(0, 7)).filter(Boolean))].sort();
    return {
      vendorName: g.vendorName,
      siteName: g.siteName,
      contractDate: term.start,
      endDate: term.end,
      status: g.status,
      months: term.months,
      baseAmount: term.baseAmount,
      contractTotal: term.total,
      firstBilled: months[0] ?? '',
      lastBilled: months[months.length - 1] ?? '',
      billedMonths: months.length,
      billedTotal: sumConfirmedBilling(lines),
    };
  });
  const allRows = new Set(grouped.flatMap((g) => g.sheetRows));
  const unassigned = billingLines.filter((l) => l.rentalSheetRow === null || !allRows.has(l.rentalSheetRow));
  const unassignedTotal = sumConfirmedBilling(unassigned);
  if (unassignedTotal !== 0) {
    rentalsOut.push({
      vendorName: '임대 건 미지정',
      siteName: '수기 입력 등',
      contractDate: '',
      endDate: '',
      status: '',
      months: 0,
      baseAmount: null,
      contractTotal: null,
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
      contractTotal: rentalsOut.reduce((sum, r) => sum + (r.contractTotal ?? 0), 0),
      asRecords,
      asError,
      inventoryWarning,
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
