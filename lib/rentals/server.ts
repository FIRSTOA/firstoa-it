import 'server-only';
import { createAdminClient, isSupabaseConfigured, RENTAL_TABLE } from '@/lib/supabase/server';

/**
 * 재고입력(AssetModal.tsx)에서 자산번호를 입력하면 기존 임대리스트에서 모델명/시리얼을
 * 찾아 자동으로 채워주는 단건 조회입니다. 예전엔 구글시트를 실시간으로 조회했지만(캐시+인덱스
 * 빌드 로직 포함), 임대리스트 원천이 firstoa-works로 바뀌면서 매번 외부 API를 부를 필요 없이
 * 이미 동기화돼 있는 로컬 Supabase(it_rental_list, /rentals의 "firstoa-works 대조/반영"으로
 * 채워짐)를 그대로 조회하면 됩니다 — 캐시도 필요 없어져서 코드가 단순해졌습니다.
 *
 * 주의: 배포 직후 /rentals에서 "firstoa-works 반영"을 최소 1회 실행하기 전까지는
 * it_rental_list가 비어있어 이 조회가 전부 "못 찾음"으로 나옵니다.
 */

export type RentalLookupResult = {
  assetId: string;
  model: string | null;
  serialNo: string | null;
  /** 사양이 단일 컬럼이 아니라 기종+옵션1~4에 나뉘어 있어, 표시용으로 합쳐서 반환 */
  specHint: string | null;
};

/**
 * 자산번호로 임대리스트에서 모델명/시리얼/사양힌트를 찾습니다. 같은 자산번호가 여러 임대
 * 건으로 쌓여 있으면 계약일이 가장 최근인 건을 씁니다. 설정이 안 돼 있거나, 조회 중 오류가
 * 나거나, 못 찾으면 null을 반환합니다(자산 등록 폼 입력을 막지 않기 위해 항상 조용히 실패).
 */
export async function lookupRentalByAssetId(assetId: string): Promise<RentalLookupResult | null> {
  const trimmed = assetId.trim();
  if (!trimmed || !isSupabaseConfigured()) return null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from(RENTAL_TABLE)
      .select('model_name, serial_number, option1, option2, option3, option4')
      .eq('asset_code', trimmed)
      .order('contract_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;

    const model = String(data.model_name ?? '').trim() || null;
    const serialNo = String(data.serial_number ?? '').trim() || null;
    const specHint =
      [data.option1, data.option2, data.option3, data.option4]
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
        .join(' / ') || null;

    return { assetId: trimmed, model, serialNo, specHint };
  } catch (err) {
    console.error('[rentals] 임대리스트 조회 실패:', err);
    return null;
  }
}
