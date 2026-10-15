import 'server-only';
import {
  buildLatestConfirmationMap,
  rowToStocktakeSession,
  type StocktakeConfirmation,
  type StocktakeSessionRow,
} from '@/lib/stocktake';
import { createAdminClient, isSupabaseConfigured, STOCKTAKE_TABLE } from '@/lib/supabase/server';

/**
 * 실재고조사(/stocktake) 결과로 "실재고체크완료" 배지(IT재고 리스트)와 "1차 수량 체크"
 * (재고 현황판)가 공유하는 조회표. 조사 세션은 DATA_SOURCE(시트/Supabase) 설정과 무관하게
 * 항상 Supabase에 있으므로, Supabase가 설정돼 있을 때만 시도합니다.
 */
export async function loadStocktakeConfirmations(): Promise<Record<string, StocktakeConfirmation>> {
  if (!isSupabaseConfigured()) return {};
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(STOCKTAKE_TABLE).select('*');
  if (error || !data) return {};
  const sessions = (data as StocktakeSessionRow[]).map(rowToStocktakeSession);
  return buildLatestConfirmationMap(sessions);
}
