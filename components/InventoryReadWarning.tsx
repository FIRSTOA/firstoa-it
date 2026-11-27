'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { failedEveryTab, inventoryReadWarning } from '@/lib/inventory/tabRead';
import type { TabReadFailure } from '@/lib/stocktake';
import { useStreamedValue } from '@/lib/useStreamedValue';

const NONE: TabReadFailure[] = [];

/**
 * IT재고 시트 탭을 못 읽었을 때 화면 위 띠(일부 = 주황, 다섯 탭 전부 = 빨강). 다 읽었으면 아무것도 안 그림.
 * failed 는 값 그대로 또는 Promise(입고·판매처럼 시트를 기다리지 않고 먼저 그리는 화면 — 도착하면 채움).
 * [다시 읽기] = router.refresh(서버가 시트를 한 번 더 읽음) — 홈 화면 앱(주소창 없음)에서도 새로고침할 수 있게.
 */
export default function InventoryReadWarning({
  failed: source,
  consequence,
}: {
  failed: Promise<TabReadFailure[]> | TabReadFailure[];
  /** 이 화면에서 뭐가 모자랄 수 있는지 한 문장(예: "현황판의 대수가 모자랄 수 있어요.") */
  consequence?: string;
}) {
  const failed = useStreamedValue(source, NONE);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (failed.length === 0) return null;
  return (
    <div className={`ct-band inv-read-warn ${failedEveryTab(failed) ? 'bad' : 'warn'}`} role="alert">
      <span>⚠️ {inventoryReadWarning(failed, consequence)}</span>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? '읽는 중…' : '🔄 다시 읽기'}
      </button>
    </div>
  );
}
