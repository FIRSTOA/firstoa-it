'use client';

import { useEffect } from 'react';
import type { Asset } from '@/lib/types';

/**
 * 화면엔 안 보이다가(globals.css의 @media print 규칙) 인쇄할 때만 전체 화면을 차지하는
 * 자산번호 라벨 그리드. InventoryPage가 printAssets를 세팅하면 마운트되고, DOM 반영 후
 * window.print()를 호출한 뒤 onDone으로 다시 null로 되돌립니다.
 */
export default function PrintLabelsArea({ items, onDone }: { items: Asset[]; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 50);
    const handleAfterPrint = () => onDone();
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="print-labels-root">
      {items.map((item, i) => (
        <div className="print-label" key={`${item.assetId}-${i}`}>
          <div className="print-label-id">{item.assetId || '-'}</div>
          <div className="print-label-sub">
            {item.model} · {item.category}
          </div>
        </div>
      ))}
    </div>
  );
}
