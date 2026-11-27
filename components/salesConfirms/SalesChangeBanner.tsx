'use client';

interface Props {
  change: { fromVer: number; toVer: number };
  versionCount: number;
  /** 무엇이 바뀌었는지 쉬운 말 목록(서버가 마지막 확인 판과 지금 판을 비교해 줄 때) — 없으면 "영업 원본에서 확인" 안내만 */
  changes?: string[];
  busy: boolean;
  onAck: () => void;
  /**
   * [영업 원본 보기] — 출력 창을 '영업 원본 그대로' 모드로 엶(E22).
   * 예전 docUrl 링크는 영업 b33a4c3 부터 키가 있어야 열리는 export 주소라 쓰지 않음(키를 주소에 붙이지 않음).
   */
  onViewOriginal?: () => void;
}

/** "영업에서 수정됨" 띠 — 무엇이 바뀌었나 + [영업 원본 보기] + [확인함](seen_ver 갱신) */
export default function SalesChangeBanner({ change, versionCount, changes, busy, onAck, onViewOriginal }: Props) {
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
              마지막으로 확인한 뒤 영업이 고쳤어요(받아 둔 버전 {versionCount}개). 아래 내용을 보고 {onViewOriginal ? '필요하면 영업 원본도 본 뒤 ' : ''}[확인함]을 눌러 주세요.
            </span>
          )}
        </div>
      </div>
      <span className="sc-change-btns">
        {onViewOriginal && (
          <button type="button" className="btn btn-ghost sc-btn" onClick={onViewOriginal}>
            영업 원본 보기
          </button>
        )}
        <button type="button" className="btn btn-primary sc-btn" disabled={busy} onClick={onAck}>
          {busy ? '저장 중…' : '확인함'}
        </button>
      </span>
    </div>
  );
}
