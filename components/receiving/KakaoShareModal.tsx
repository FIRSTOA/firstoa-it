'use client';

import { useEffect, useState } from 'react';
import { buildApprovalRequestText, buildOrderRequestText, type PurchaseMessageData } from '@/lib/kakaoTemplates';
import type { PurchaseLineItem } from './PurchaseEntryModal';

type Template = 'approval' | 'order';

type Props = {
  open: boolean;
  onClose: () => void;
  vendor: string;
  department: string;
  manager: string;
  expectedDate: string;
  priceCompared: string;
  deliveryPlace: string;
  lines: PurchaseLineItem[];
};

/**
 * 구매입력 내용을 정해진 양식으로 카톡에 보낼 수 있게 해줍니다. 웹사이트가 카카오톡 특정
 * 대화방에 자동으로 메시지를 꽂아넣는 API는 없어서(카카오 개발자 앱+키 등록이 필요한
 * "공유 API"뿐), 완성된 문구를 복사하거나 Web Share API(`navigator.share`)로 시스템
 * 공유창(모바일에서 카톡이 그 안에 하나로 뜸)을 여는 방식으로 만들었습니다. 이미지도
 * 첨부하면 같이 공유됩니다(지원하는 브라우저에서만).
 */
export default function KakaoShareModal({
  open,
  onClose,
  vendor,
  department,
  manager,
  expectedDate,
  priceCompared,
  deliveryPlace,
  lines,
}: Props) {
  const [lineIndex, setLineIndex] = useState(0);
  const [template, setTemplate] = useState<Template>('approval');
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [notice, setNotice] = useState('');

  const line = lines[lineIndex] ?? lines[0];

  useEffect(() => {
    if (open) {
      setLineIndex(0);
      setTemplate('approval');
      setImageFile(null);
      setNotice('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || !line) return;
    const data: PurchaseMessageData = {
      vendor,
      department,
      manager,
      expectedDate,
      priceCompared,
      deliveryPlace,
      category: line.category,
      model: line.model,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      currentStock: line.currentStock,
      safetyStock: line.safetyStock,
    };
    setText(template === 'approval' ? buildApprovalRequestText(data) : buildOrderRequestText(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template, lineIndex, vendor, department, manager, expectedDate, priceCompared, deliveryPlace]);

  if (!open) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('복사했어요 — 카톡에 붙여넣어 주세요.');
    } catch {
      setNotice('복사에 실패했어요. 직접 선택해서 복사해주세요.');
    }
  }

  async function handleShare() {
    type NavigatorShare = Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    const nav = navigator as NavigatorShare;

    if (!nav.share) {
      await handleCopy();
      setNotice('이 브라우저는 공유하기를 지원하지 않아 텍스트를 복사했어요. 카톡에 붙여넣어 주세요.');
      return;
    }

    const shareData: ShareData = {
      title: template === 'approval' ? '매입승인요청' : '발주요청',
      text,
    };
    if (imageFile && nav.canShare?.({ files: [imageFile] })) {
      shareData.files = [imageFile];
    }

    try {
      await nav.share(shareData);
      setNotice('');
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setNotice('공유에 실패했어요 — 복사해서 보내주세요.');
      }
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '520px' }}>
        <h2>📤 카톡으로 보내기</h2>
        <div className="sub">양식을 골라 내용을 확인하고 복사하거나 공유해요.</div>

        <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}>
          <button
            type="button"
            className={`chip${template === 'approval' ? ' active' : ''}`}
            onClick={() => setTemplate('approval')}
          >
            매입승인요청
          </button>
          <button
            type="button"
            className={`chip${template === 'order' ? ' active' : ''}`}
            onClick={() => setTemplate('order')}
          >
            발주서(매입처용)
          </button>
        </div>

        {lines.length > 1 && (
          <div className="form-field" style={{ marginBottom: '10px' }}>
            <label>품목 선택</label>
            <select value={lineIndex} onChange={(e) => setLineIndex(Number(e.target.value))}>
              {lines.map((l, i) => (
                <option key={i} value={i}>
                  {i + 1}. {l.model || '(품목명 없음)'}
                </option>
              ))}
            </select>
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          style={{
            width: '100%',
            fontFamily: 'inherit',
            fontSize: '13px',
            padding: '10px',
            border: '1px solid var(--ink-200)',
            borderRadius: '8px',
            resize: 'vertical',
          }}
        />

        <div className="form-field" style={{ marginTop: '10px' }}>
          <label>이미지 첨부(선택)</label>
          <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
          {imageFile && (
            <div style={{ fontSize: '11px', color: 'var(--ink-400)', marginTop: '4px' }}>{imageFile.name}</div>
          )}
        </div>

        {notice && (
          <div style={{ fontSize: '12px', color: 'var(--indigo-600)', marginTop: '10px' }}>{notice}</div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleCopy}>
            복사하기
          </button>
          <button type="button" className="btn btn-primary" onClick={handleShare}>
            공유하기
          </button>
        </div>
      </div>
    </div>
  );
}
