'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildReplyMessage,
  evaluateInquiry,
  parseInquiryText,
  type InquiryResult,
} from '@/lib/inventoryInquiry';
import type { Asset } from '@/lib/types';

type Props = {
  open: boolean;
  items: Asset[];
  onClose: () => void;
  onApplyFilter: (result: InquiryResult) => void;
};

export default function StockInquiryModal({ open, items, onClose, onApplyFilter }: Props) {
  const [text, setText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setReplyText('');
      setCopied(false);
    }
  }, [open]);

  const results = useMemo(() => evaluateInquiry(items, parseInquiryText(text)), [items, text]);

  useEffect(() => {
    if (results.length > 0) setReplyText(buildReplyMessage(results));
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(replyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 접근이 막힌 환경 — 사용자가 직접 텍스트를 선택해서 복사하면 됩니다.
    }
  }

  function conditionLabel(r: InquiryResult): string {
    const parts: string[] = [];
    if (r.cpuType) parts.push(r.cpuType);
    if (r.spec) parts.push(r.spec);
    if (r.screenInch !== null) parts.push(`${r.screenInch}인치`);
    return parts.length > 0 ? parts.join(' / ') : '-';
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '680px' }}>
        <h2>📋 재고 문의</h2>
        <div className="sub">
          타부서에서 온 재고 문의 문구를 그대로 붙여넣으면, 품목/사양/수량을 읽어서 지금 보유 중인
          내부재고(상품화준비중+상품화완료)와 대조해줘요.
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'예)\nI5 일반사무용 데스크탑 3대\n27인치 모니터 17대'}
          style={{ width: '100%', minHeight: '140px', marginTop: '12px', fontFamily: 'inherit', fontSize: '13px' }}
        />

        {results.length === 0 && text.trim() && (
          <div className="loading-note">"OO대" 형식의 요청 줄을 찾지 못했어요. 문구를 확인해주세요.</div>
        )}

        {results.length > 0 && (
          <>
            <div style={{ overflowX: 'auto', marginTop: '14px' }}>
              <table>
                <thead>
                  <tr>
                    <th>요청 내용</th>
                    <th>조건</th>
                    <th style={{ width: '70px' }}>요청</th>
                    <th style={{ width: '70px' }}>보유</th>
                    <th style={{ width: '90px' }}>결과</th>
                    <th style={{ width: '90px' }} />
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td>{r.raw}</td>
                      <td style={{ fontSize: '12px', color: 'var(--ink-500)' }}>
                        {r.category || '(품목 인식 안 됨)'}
                        {conditionLabel(r) !== '-' ? ` · ${conditionLabel(r)}` : ''}
                      </td>
                      <td>{r.quantity}대</td>
                      <td>{r.available}대</td>
                      <td>
                        {r.shortage > 0 ? (
                          <span className="badge badge-악성">{r.shortage}대 부족</span>
                        ) : (
                          <span className="badge badge-상품화완료">충분</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="chip"
                          disabled={!r.category}
                          onClick={() => onApplyFilter(r)}
                        >
                          매칭 보기
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="form-field" style={{ marginTop: '16px' }}>
              <label>답변 문구 (수정 가능)</label>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                style={{ width: '100%', minHeight: '140px', fontFamily: 'inherit', fontSize: '13px' }}
              />
            </div>
          </>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
          {results.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={handleCopy}>
              {copied ? '복사했어요!' : '답변 문구 복사'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
