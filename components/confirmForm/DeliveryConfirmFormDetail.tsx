'use client';

import { useEffect, useState } from 'react';
import type { DeliveryConfirmForm } from '@/lib/deliveryConfirmForm';
import DeliveryConfirmFormDocument from './DeliveryConfirmFormDocument';

/**
 * "상세보기" 모달 — 화면 미리보기는 그냥 모달 안에 문서를 렌더링하고, "인쇄" 버튼을 누르면
 * PrintLabelsArea와 동일한 패턴(숨겨진 #print-confirm-form-root를 잠깐 마운트 → window.print()
 * → afterprint에 다시 해제)으로 그 문서만 인쇄되게 합니다.
 */
export default function DeliveryConfirmFormDetail({
  form,
  onClose,
}: {
  form: DeliveryConfirmForm | null;
  onClose: () => void;
}) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing || !form) return;
    const timer = setTimeout(() => window.print(), 50);
    const handleAfterPrint = () => setPrinting(false);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [printing, form]);

  if (!form) return null;

  return (
    <>
      <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ width: '820px', maxWidth: '95vw' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '10px' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setPrinting(true)}>
              🖨 인쇄
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              닫기
            </button>
          </div>
          <div style={{ maxHeight: '75vh', overflowY: 'auto', padding: '4px' }}>
            <DeliveryConfirmFormDocument form={form} />
          </div>
        </div>
      </div>
      {printing && (
        <div id="print-confirm-form-root">
          <DeliveryConfirmFormDocument form={form} />
        </div>
      )}
    </>
  );
}
