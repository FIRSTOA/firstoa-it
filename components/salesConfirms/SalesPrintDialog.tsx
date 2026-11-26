'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { markSalesConfirmPrinted } from '@/app/confirm-form/salesDetailActions';
import { getSalesPrintKeys } from '@/app/confirm-form/salesLicenseActions';
import {
  SALES_PRINT_MSG_OVERFLOW,
  SALES_PRINT_MSG_PRINT,
  SALES_PRINT_MSG_SIZE,
  SALES_PRINT_MSG_SOURCE,
  buildSalesPrintHtml,
  overflowLeftNote,
} from '@/lib/salesConfirms/printFill';
import type { ConfirmLicenseState, SalesConfirmDetailData, SalesPrintOptions, SalesPrintResult } from '@/lib/salesConfirms/types';

/*
 * 출력 창 ↔ 미리보기(iframe) 신호 — 이름은 printFill.ts 의 SALES_PRINT_MSG_* 한 곳(양식 안 P6 스크립트도 같은 값).
 * iframe 은 sandbox(같은 출처 권한 없음)라 부모가 안을 직접 못 만지고 postMessage 로만 주고받음.
 *   부모 → iframe : { source, type: PRINT }                         → window.print()
 *   iframe → 부모 : { source, type: OVERFLOW, items: number[], pages: number[] } → 넘친 품목·장
 *   iframe → 부모 : { source, type: SIZE, height: number }          → 문서 전체 높이(px)
 */

/**
 * 미리보기 iframe 권한 — 스크립트(인쇄·넘침 신호)와 인쇄 창만.
 * "같은 출처 허용" 값은 절대 넣지 말 것: 넣으면 영업이 적은 글자가 앱의 쿠키·서버 액션에 손댈 수 있음.
 */
const FRAME_SANDBOX = 'allow-scripts allow-modals';
const OPTIONS_KEY = 'firstoa-it.sales-print-options';
/** A4 = 210×297mm = 794×1123px(96dpi) */
const PAGE_W = 794;
const PAGE_H = 1123;

type StoredOptions = Pick<SalesPrintOptions, 'withBack' | 'attach'>;
const DEFAULT_OPTIONS: StoredOptions = { withBack: true, attach: 'auto' };

function readOptions(): StoredOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (!raw) return DEFAULT_OPTIONS;
    const j = JSON.parse(raw) as Partial<StoredOptions>;
    return { withBack: j.withBack !== false, attach: j.attach === 'always' ? 'always' : 'auto' };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

interface Props {
  detail: SalesConfirmDetailData;
  /** 라이선스 상태(없으면 못 읽음) — 키가 몇 개 있는지·잠금이 풀렸는지 */
  license: ConfirmLicenseState | null;
  hasSoftware: boolean;
  /** 비밀번호 창을 띄워 풀렸는지 돌려줌(풀리면 부모가 license 도 다시 읽음) */
  onUnlock: () => Promise<boolean>;
  actor: string;
  ensureActor: () => Promise<string | null>;
  onClose: () => void;
  /** 출력 기록을 남김 — 화면의 "출력함" 표시·workUpdatedAt 을 맞추는 데 씀 */
  onPrinted: (info: { workUpdatedAt: string; ver: number; by: string; at: string }) => void;
  onWarn: (msg: string) => void;
}

type KeyChoice = null | 'shown' | 'blank';

/**
 * 출력 창 — 영업 양식 그대로 한 장씩 미리보고 인쇄. 위: 알림 · 라이선스 키 고르기 상자 · 옵션.
 * 미리보기 = <iframe srcDoc sandbox="allow-scripts allow-modals">(같은 출처 권한 없음 — 영업이 적은 글자가 앱을 못 만지게).
 * 화면 맞춤은 iframe 바깥 transform: scale. [인쇄] = iframe 에 신호 + markSalesConfirmPrinted.
 */
export default function SalesPrintDialog({ detail, license, hasSoftware, onUnlock, actor, ensureActor, onClose, onPrinted, onWarn }: Props) {
  const confirmId = detail.confirm.id;
  const [options, setOptions] = useState<StoredOptions>(DEFAULT_OPTIONS);
  const [keyChoice, setKeyChoice] = useState<KeyChoice>(null);
  const [licenseKeys, setLicenseKeys] = useState<Record<string, string>>({});
  const [keysBusy, setKeysBusy] = useState(false);
  const [keysError, setKeysError] = useState('');
  const [overflow, setOverflow] = useState<number[]>([]);
  const overflowRef = useRef<number[]>([]);
  const [leftPages, setLeftPages] = useState<number[]>([]);
  const [docHeight, setDocHeight] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [scale, setScale] = useState(1);
  const nowIso = useRef(new Date().toISOString()).current;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const keyCount = license ? license.units.filter((u) => u.hasKey).length : 0;
  const keyUnknown = hasSoftware && license === null;
  const needChoice = hasSoftware && (keyUnknown || keyCount > 0);

  // 옵션 기억(브라우저 저장소가 막혀도 이번엔 동작)
  useEffect(() => setOptions(readOptions()), []);
  function changeOptions(next: StoredOptions) {
    setOptions(next);
    overflowRef.current = [];
    setOverflow([]);
    setLeftPages([]);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // 기억 못 해도 됨
    }
  }

  // 키 읽기(잠금이 풀려 있어야 함) — 읽으면 계약관리 기록에 view_bulk 가 남음(서버)
  const loadKeys = useCallback(async (): Promise<boolean> => {
    setKeysBusy(true);
    setKeysError('');
    try {
      const res = await getSalesPrintKeys({ confirmId });
      if (res.ok) {
        setLicenseKeys(res.data);
        setKeyChoice('shown');
        return true;
      }
      if ('needUnlock' in res) {
        setKeysError('잠금이 풀려 있지 않아요. 비밀번호를 넣어 주세요.');
      } else {
        setKeysError(res.error || '키를 읽지 못했어요.');
      }
      return false;
    } catch {
      setKeysError('키를 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
      return false;
    } finally {
      setKeysBusy(false);
    }
  }, [confirmId]);

  // 열 때 이미 풀려 있으면 바로 키까지
  useEffect(() => {
    if (needChoice && license?.unlocked) void loadKeys();
    // 열 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unlockAndLoad() {
    const ok = await onUnlock();
    if (ok) await loadKeys();
  }

  const printOptions: SalesPrintOptions = useMemo(
    () => ({ withBack: options.withBack, attach: options.attach, keys: keyChoice === 'shown' ? 'shown' : 'blank' }),
    [options, keyChoice],
  );

  const built = useMemo((): { ok: true; r: SalesPrintResult } | { ok: false; error: string } => {
    try {
      const r = buildSalesPrintHtml({
        detail,
        licenseKeys: keyChoice === 'shown' ? licenseKeys : {},
        options: printOptions,
        overflowItems: overflow,
        nowIso,
        origin: typeof window === 'undefined' ? '' : window.location.origin,
        actor,
      });
      return { ok: true, r };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '알 수 없는 오류' };
    }
  }, [detail, licenseKeys, keyChoice, printOptions, overflow, nowIso, actor]);

  // 미리보기 안(양식 스크립트)이 보내는 신호
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d: unknown = e.data;
      if (!d || typeof d !== 'object') return;
      const m = d as Record<string, unknown>;
      const type = String(m.type ?? '');
      if (type === SALES_PRINT_MSG_OVERFLOW) {
        const nums = (raw: unknown): number[] =>
          Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0) : [];
        const items = nums(m.items);
        const pages = nums(m.pages);
        const prev = overflowRef.current;
        const merged = [...new Set([...prev, ...items])].sort((a, b) => a - b);
        if (merged.length > prev.length) {
          // 새로 명세로 돌릴 품목이 있음 → 다시 그림(늘지 않으면 다시 안 그려 무한 반복 방지)
          overflowRef.current = merged;
          setOverflow(merged);
          setLeftPages([]);
        } else {
          // 명세로 돌려도 넘침이 남음(소모품·특이사항이 길 때 등)
          setLeftPages(pages);
        }
      } else if (type === SALES_PRINT_MSG_SIZE) {
        const h = Number(m.height);
        if (Number.isFinite(h) && h > 200 && h < 40000) setDocHeight(Math.ceil(h));
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 창 폭에 맞춰 종이를 줄임
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.3, Math.min(1, (el.clientWidth - 24) / PAGE_W)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !printing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, printing]);

  const blocked = built.ok ? built.r.blocked : null;
  const html = built.ok ? built.r.html : '';
  const keyGate = needChoice && keyChoice === null;
  const canPrint = built.ok && !blocked && !!html && !keyGate && !keysBusy && !printing;

  async function print() {
    if (!canPrint) return;
    const who = await ensureActor();
    if (!who) return;
    setPrinting(true);
    // 인쇄 창은 미리보기 안 스크립트가 띄움(부모는 신호만)
    frameRef.current?.contentWindow?.postMessage({ source: SALES_PRINT_MSG_SOURCE, type: SALES_PRINT_MSG_PRINT }, '*');
    try {
      const res = await markSalesConfirmPrinted({ confirmId, ver: detail.confirm.ver, actor: who });
      if (res.ok) onPrinted({ workUpdatedAt: res.workUpdatedAt, ver: detail.confirm.ver, by: who, at: new Date().toISOString() });
      else onWarn(`인쇄 창은 띄웠지만 "출력함" 기록을 남기지 못했어요 — ${res.error}`);
    } catch (e) {
      onWarn(`인쇄 창은 띄웠지만 "출력함" 기록을 남기지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setPrinting(false);
    }
  }

  // 알림은 printFill 의 notes 한 곳(넘침 문구도) + 명세로 돌려도 남은 넘침(주황)
  const leftNote = overflowLeftNote(leftPages);
  const notes = [...(built.ok ? built.r.notes : []), ...(leftNote ? [leftNote] : [])];
  const attached = built.ok && built.r.attached;
  const frameH = docHeight ?? PAGE_H * 3;

  return (
    <div className="modal-overlay open sc-print-overlay">
      <div className="sc-print" role="dialog" aria-modal="true" aria-label="확인서 출력">
        <div className="sc-print-head">
          <h2>🖨 확인서 출력</h2>
          <span className="sc-muted">영업 웹앱 확인서와 같은 종이에 IT가 적은 값을 덧붙여 보여 줘요.</span>
          <span className="sc-print-head-btns">
            <button type="button" className="btn btn-ghost" disabled={printing} onClick={onClose}>
              닫기
            </button>
            <button type="button" className="btn btn-primary" disabled={!canPrint} onClick={() => void print()}>
              {printing ? '인쇄 창 여는 중…' : '인쇄'}
            </button>
          </span>
        </div>

        <div className="sc-print-body">
          <div className="sc-print-side">
            {keyGate && (
              <div className="ct-band warn sc-key-box" role="alert">
                <div>
                  <b>
                    {keyUnknown ? '라이선스 키가 있는지 읽지 못했어요' : `라이선스 키 ${keyCount}개가 잠겨 있어요`}
                  </b>
                  <div className="sc-key-box-sub">종이에 키까지 찍을지 골라야 [인쇄]가 켜져요.</div>
                  {keysError && <div className="sc-key-box-err">{keysError}</div>}
                </div>
                <div className="sc-key-box-btns">
                  <button type="button" className="btn btn-primary sc-btn" disabled={keysBusy} onClick={() => void unlockAndLoad()}>
                    {keysBusy ? '읽는 중…' : '🔓 비밀번호 넣고 키까지 찍기'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost sc-btn"
                    disabled={keysBusy}
                    onClick={() => {
                      setKeysError('');
                      setKeyChoice('blank');
                    }}
                  >
                    키 없이 찍기
                  </button>
                </div>
              </div>
            )}
            {needChoice && keyChoice === 'shown' && (
              <div className="ct-band good sc-key-box">
                <span>🔓 라이선스 키까지 찍어요. 키는 이 창을 닫으면 사라지고 어디에도 저장되지 않아요.</span>
                <button type="button" className="btn btn-ghost sc-btn" onClick={() => setKeyChoice('blank')}>
                  키 없이 찍기로 바꾸기
                </button>
              </div>
            )}
            {needChoice && keyChoice === 'blank' && (
              <div className="ct-band muted sc-key-box">
                <span>키 없이 찍어요 — 키 자리는 밑줄 빈칸으로 나가요.</span>
                {!keysBusy && (
                  <button type="button" className="btn btn-ghost sc-btn" onClick={() => void unlockAndLoad()}>
                    키까지 찍기로 바꾸기
                  </button>
                )}
              </div>
            )}

            <div className="sc-print-opts">
              <div className="sc-sec-title">인쇄 설정</div>
              <label className="toggle">
                <input type="checkbox" checked={options.withBack} onChange={(e) => changeOptions({ ...options, withBack: e.target.checked })} />
                2면(출고·설치 확인) 포함
              </label>
              <div className="sc-print-attach">
                <span className="filter-label">출고 명세 장</span>
                <div className="chip-group">
                  <button type="button" className={`chip${options.attach === 'auto' ? ' active' : ''}`} onClick={() => changeOptions({ ...options, attach: 'auto' })}>
                    자동 (칸에 안 들어갈 때만)
                  </button>
                  <button type="button" className={`chip${options.attach === 'always' ? ' active' : ''}`} onClick={() => changeOptions({ ...options, attach: 'always' })}>
                    항상 붙이기
                  </button>
                </div>
              </div>
              {attached && <div className="sc-muted">출고 명세(대수별) 장이 붙어 있어요.</div>}
            </div>

            {notes.length > 0 && (
              <div className="sc-print-notes">
                <div className="sc-sec-title">출력 전에 볼 것</div>
                <ul>
                  {notes.map((n, i) => (
                    <li key={i} className={n.tone === 'warn' ? 'warn' : 'info'}>
                      {n.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="sc-print-area" ref={areaRef}>
            {!built.ok ? (
              <div className="ct-band bad" role="alert">
                <span>출력 화면을 만들지 못했어요 — {built.error}</span>
              </div>
            ) : blocked ? (
              <div className="ct-band warn" role="status">
                <span>{blocked}</span>
              </div>
            ) : !html ? (
              <div className="empty-state">
                <div>📄</div>
                <div>그릴 내용이 없어요.</div>
              </div>
            ) : (
              <div className="sc-print-paper" style={{ width: PAGE_W * scale, height: frameH * scale }}>
                <iframe
                  ref={frameRef}
                  title="확인서 미리보기"
                  className="sc-print-frame"
                  sandbox={FRAME_SANDBOX}
                  srcDoc={html}
                  style={{ width: PAGE_W, height: frameH, transform: `scale(${scale})` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
