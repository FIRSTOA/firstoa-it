'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadStocktakeLocations } from '@/app/stocktake/actions';

export type StocktakeLocationsState = {
  /** 조사 대상 선반(선반 열쇠 shelfKeyOf — "B1수리중"은 "B1"에 포함) — 조사 시작·남은 위치·다음 후보 */
  shelves: string[];
  /** 시트에 있는 위치 이름 그대로 — "✎ 위치 수정"에서 사람이 고르는 목록 */
  names: string[];
  loading: boolean;
  /** 한 번이라도 답을 받았는지(성공·실패 상관없이) — 받기 전엔 "남은 위치 없음"으로 보이면 안 됨 */
  loaded: boolean;
  /** 못 읽은 게 있을 때 사람에게 보여 줄 문구('' = 없음) — 옆에 [다시 읽기]를 같이 보여 줄 것 */
  notice: string;
  reload: () => void;
};

/**
 * 조사 대상 선반 위치(IT재고 시트 5탭에서 뽑음)를 enabled 일 때 한 번 읽습니다(reload 로 다시).
 *
 * 예전엔 page 가 그릴 때마다 읽었는데, 조사 화면은 [확인] 한 번마다 서버 액션의 revalidatePath 로 page 가
 * 다시 그려져 시트를 5번씩 또 읽었음 → 구글 읽기 한도(서비스계정 분당 60회)를 다 쓰면 못 읽은 탭이 빈 목록이
 * 되어 [조사 종료] 직후 "남은 위치가 안 뜸"(2026-11-27 신고). 그래서 page 에선 안 읽고 화면이 필요할 때만.
 * 다시 읽기가 일부만 성공하면 이미 아는 위치는 지우지 않음(합침) — 못 읽은 탭 때문에 위치가 사라지지 않게.
 */
export function useStocktakeLocations(enabled: boolean): StocktakeLocationsState {
  const [shelves, setShelves] = useState<string[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    loadStocktakeLocations()
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setNotice(res.error);
          return;
        }
        setNotice(res.warning);
        const merge = (prev: string[], next: string[]) => (res.warning ? Array.from(new Set([...prev, ...next])).sort() : next);
        setShelves((prev) => merge(prev, res.shelves));
        setNames((prev) => merge(prev, res.names));
      })
      .catch((err: unknown) => {
        console.error('[stocktake] 위치 목록 요청 실패:', err);
        if (alive) setNotice('위치 목록을 못 읽었어요(연결이 끊겼을 수 있어요). [다시 읽기]를 눌러 주세요.');
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { shelves, names, loading, loaded, notice, reload };
}
