'use client';

import { useEffect, useState } from 'react';
import { getDeliveryConfirmForm } from '@/app/confirmForm/actions';
import type { DeliveryConfirmForm } from '@/lib/deliveryConfirmForm';
import DeliveryConfirmFormDocument from './DeliveryConfirmFormDocument';
import DeliveryConfirmFormEditor from './DeliveryConfirmFormEditor';

/**
 * "상세보기" 모달 — 화면 미리보기는 그냥 모달 안에 문서를 렌더링하고, "인쇄" 버튼을 누르면
 * PrintLabelsArea와 동일한 패턴(숨겨진 #print-confirm-form-root를 잠깐 마운트 → window.print()
 * → afterprint에 다시 해제)으로 그 문서만 인쇄되게 합니다. "✎ 수정"을 누르면 같은 모달 안에서
 * 편집 폼으로 바뀝니다 — 등록 당시 비어있던 자산번호를 준비하면서 채워 넣고, 다시 저장한 뒤
 * 바로 재출력(인쇄)할 수 있게 하기 위함입니다.
 */
export default function DeliveryConfirmFormDetail({
  form,
  onClose,
  onChanged,
  onToast,
}: {
  form: DeliveryConfirmForm | null;
  onClose: () => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(form);

  useEffect(() => {
    setCurrent(form);
    setEditing(false);
  }, [form]);

  useEffect(() => {
    if (!printing || !current) return;
    const timer = setTimeout(() => window.print(), 50);
    const handleAfterPrint = () => setPrinting(false);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [printing, current]);

  if (!current) return null;

  async function handleSaved(msg: string) {
    if (!current) return;
    const fresh = await getDeliveryConfirmForm(current.id);
    if (fresh) setCurrent(fresh);
    setEditing(false);
    onToast(msg);
    onChanged();
  }

  return (
    <>
      <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ width: '820px', maxWidth: '95vw' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '10px' }}>
            {!editing && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
                  ✎ 수정
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setPrinting(true)}>
                  🖨 인쇄
                </button>
              </>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              닫기
            </button>
          </div>
          <div style={{ maxHeight: '75vh', overflowY: 'auto', padding: '4px' }}>
            {editing ? (
              <DeliveryConfirmFormEditor editing={current} onRegistered={handleSaved} />
            ) : (
              <DeliveryConfirmFormDocument form={current} />
            )}
          </div>
        </div>
      </div>
      {printing && (
        <div id="print-confirm-form-root">
          <DeliveryConfirmFormDocument form={current} />
        </div>
      )}
    </>
  );
}
