import 'server-only';
import {
  buildConfirmationMapFromRows,
  readAllStocktakePages,
  STOCKTAKE_CONFIRMATION_COLUMNS,
  type StocktakeConfirmation,
  type StocktakeConfirmationSourceRow,
} from '@/lib/stocktake';
import { createAdminClient, isSupabaseConfigured, STOCKTAKE_TABLE } from '@/lib/supabase/server';

/**
 * 실재고조사(/stocktake) 결과로 "실재고체크완료" 배지(IT재고 리스트)와 "1차 수량 체크"
 * (재고 현황판)가 공유하는 조회표. 조사 세션은 DATA_SOURCE(시트/Supabase) 설정과 무관하게
 * 항상 Supabase에 있으므로, Supabase가 설정돼 있을 때만 시도합니다.
 *
 * 조사 기록은 페이지로 끝까지 읽음 — 예전 select('*') 는 순서 없이 1000줄에서 잘려서, 기록이 1000건을 넘으면
 * (2026-11-27 834건, 하루 약 14건) 무작위로 일부 조사의 확인 기록이 빠져 배지·2차 검증이 사라졌을 것.
 * 칸은 쓰는 것만, 순번 오름차순(읽는 사이 새 줄이 생겨도 안 밀림).
 * 못 읽으면 예전처럼 빈 표(화면 전체를 죽이지 않음) — 대신 서버 로그에 남김(예전엔 아무 기록 없이 비었음).
 */
export async function loadStocktakeConfirmations(): Promise<Record<string, StocktakeConfirmation>> {
  if (!isSupabaseConfigured()) return {};
  const supabase = createAdminClient();
  const { rows, error } = await readAllStocktakePages<StocktakeConfirmationSourceRow>((from, to) =>
    supabase
      .from(STOCKTAKE_TABLE)
      .select(STOCKTAKE_CONFIRMATION_COLUMNS)
      .order('seq', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
      .returns<StocktakeConfirmationSourceRow[]>(),
  );
  if (error) {
    console.error('[stocktake] 실재고체크 조회표 읽기 실패:', error.code ?? '-', error.message);
    return {};
  }
  return buildConfirmationMapFromRows(rows);
}
