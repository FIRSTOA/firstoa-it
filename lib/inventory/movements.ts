import 'server-only';
import { ASSET_MOVEMENTS_TABLE, createAdminClient, isSupabaseConfigured } from '@/lib/supabase/server';

export type AssetMovementInput = {
  assetNumber: string;
  category: string;
  fromLocation: string | null;
  toLocation: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  actor?: string;
  memo?: string;
};

/**
 * 자산 이동 이력을 Supabase asset_movements에 기록합니다.
 *
 * 구글시트가 실제 마스터 데이터라서, 이 로깅이 실패하거나 Supabase가 아직 설정 안 돼 있어도
 * 본 작업(자산 등록/수정/삭제)이 실패하면 안 됩니다 — 그래서 예외를 던지지 않고 콘솔에만
 * 남기고 조용히 넘어갑니다.
 */
export async function logAssetMovement(input: AssetMovementInput): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from(ASSET_MOVEMENTS_TABLE).insert({
      asset_number: input.assetNumber,
      category: input.category,
      from_location: input.fromLocation,
      to_location: input.toLocation,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      actor: input.actor ?? '',
      memo: input.memo ?? '',
    });
    if (error) {
      console.error('[asset_movements] 이력 기록 실패:', error.message);
    }
  } catch (err) {
    console.error('[asset_movements] 이력 기록 중 오류:', err);
  }
}
