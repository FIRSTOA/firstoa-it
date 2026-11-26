'use client';

import { safeDocUrl } from '@/lib/salesConfirms/types';

interface Props {
  change: { fromVer: number; toVer: number };
  versionCount: number;
  docUrl: string | null;
  /** 무엇이 바뀌었는지 쉬운 말 목록(서버가 마지막 확인 판과 지금 판을 비교해 줄 때) — 없으면 "영업 원본에서 확인" 안내만 */
  changes?: string[];
  busy: boolean;
  onAck: () => void;
}

/** "영업에서 수정됨" 띠 — 무엇이 바뀌었나 + [확인함](seen_ver 갱신) */
export default function SalesChangeBanner({ change, versionCount, docUrl, changes, busy, onAck }: Props) {
  const url = safeDocUrl(docUrl);
  return (
    <div className="ct-band warn sc-change-band" role="status">
      <div>
        <b>
          영업에서 수정됨 (v{change.fromVer} → v{change.toVer})
        </b>
        <div className="sc-change-body">
          {changes && changes.length > 0 ? (
            <ul className="sc-change-list">
              {changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <span>
              마지막으로 확인한 뒤 영업이 고쳤어요(받아 둔 버전 {versionCount}개). 아래 내용을 보고 {url ? '필요하면 영업 원본도 열어 본 뒤 ' : ''}[확인함]을 눌러 주세요.
            </span>
          )}
        </div>
      </div>
      <span className="sc-change-btns">
        {url && (
          <a className="btn btn-ghost sc-btn" href={url} target="_blank" rel="noopener noreferrer">
            영업 원본 열기 ↗
          </a>
        )}
        <button type="button" className="btn btn-primary sc-btn" disabled={busy} onClick={onAck}>
          {busy ? '저장 중…' : '확인함'}
        </button>
      </span>
    </div>
  );
}
