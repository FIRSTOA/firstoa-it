import 'server-only';
import { fetchAllWorksRows } from '@/lib/works/client';
import type { BillingLineInput } from '@/lib/billing';

/**
 * firstoa-works billings 테이블(약 159,000행)을 it_billing_lines 입력으로 변환합니다.
 * 자산 매칭은 엑셀 업로드 때 쓰는 느슨한 "거래처명+기간 추정"(app/billing/actions.ts의
 * matchRentalSheetRow) 대신, billings.asset_id가 곧 firstoa-works assets.id(=우리
 * it_rental_list.sheet_row)라 100% 정확하게 매칭됩니다 — readWorksAssetRows가 만든
 * assetCodeById 맵을 그대로 받아 씁니다.
 */

export const WORKS_BILLING_SOURCE_ID = 'works-asset';

type WorksBillingApiRow = {
  id: number;
  asset_id: number | null;
  billing_month: string | null; // 'YYYY-MM'
  amount: number | null;
  status: string | null;
};

const SELECT_COLS = ['id', 'asset_id', 'billing_month', 'amount', 'status'].join(',');

/** billed/prepaid/overdue/consumable/free → 확정, suspended/merged → 취소(합계에서 빠짐) */
function mapStatus(worksStatus: string): string {
  return worksStatus === 'suspended' || worksStatus === 'merged' ? '취소' : '확정';
}

function lastDayOfMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${yyyyMm}-${String(last).padStart(2, '0')}`;
}

export type WorksBillingLine = BillingLineInput & { worksId: number };

/** firstoa-works billings 전체를 읽어 it_billing_lines 입력 배열로 변환합니다. */
export async function readWorksBillingLines(
  assetCodeById: Map<number, string>,
  vendorNameById: Map<number, string>,
): Promise<WorksBillingLine[]> {
  const apiRows = await fetchAllWorksRows<WorksBillingApiRow>('billings', SELECT_COLS);

  const result: WorksBillingLine[] = [];
  for (const r of apiRows) {
    const month = (r.billing_month ?? '').trim();
    if (!month) continue;

    const worksAssetId = r.asset_id;
    const assetId = worksAssetId !== null ? assetCodeById.get(worksAssetId) || null : null;
    const vendorName = worksAssetId !== null ? vendorNameById.get(worksAssetId) || '' : '';
    const worksStatus = (r.status ?? '').trim();

    result.push({
      worksId: r.id,
      sourceInvoiceId: WORKS_BILLING_SOURCE_ID,
      sourceLineId: String(r.id),
      assetId: assetId || null,
      rentalSheetRow: worksAssetId,
      vendorName,
      billingDate: `${month}-01`,
      periodStart: `${month}-01`,
      periodEnd: lastDayOfMonth(month),
      amount: Number(r.amount) || 0,
      status: mapStatus(worksStatus),
      allocationStatus: assetId ? 'confirmed' : 'needs_review',
      note: `firstoa-works 원본상태: ${worksStatus || '(없음)'}`,
    });
  }
  return result;
}
