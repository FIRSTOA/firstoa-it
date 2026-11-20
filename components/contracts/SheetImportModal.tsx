'use client';

import { useEffect, useMemo, useState } from 'react';
import { applySheetImport, previewSheetImport } from '@/app/contracts/importActions';
import {
  SECRET_FIELDS,
  SECRET_FIELD_LABEL,
  type ClientSummary,
  type ImportChoice,
  type ImportCounts,
  type ImportGroup,
  type ImportPlan,
  type ImportPreview,
  type ImportRowDetail,
  type ImportRowEdit,
  type ImportResult,
  type ImportTabResult,
  type SecretField,
} from '@/lib/contracts/types';
import { useContractsCtx } from './UnlockDialog';

type Phase = 'loading' | 'error' | 'groups' | 'names' | 'confirm' | 'applying' | 'result';
type Mode = '' | 'client' | 'new' | 'unsorted' | 'skip';

const rowKey = (tab: 'renew' | 'perm', row: number) => `${tab}:${row}`;

/** 줄 수정 폼에서 다루는 글자 칸(날짜는 'YYYY-MM-DD' 또는 빈 값) */
type RowForm = {
  product: string;
  supplier: string;
  userName: string;
  dept: string;
  pcAssetCode: string;
  mfaNote: string;
  purchasedOn: string;
  renewsOn: string;
  endsOn: string;
};

function rowFormOf(d: ImportRowDetail, e: ImportRowEdit | undefined): RowForm {
  const pick = <K extends 'product' | 'supplier' | 'userName' | 'dept' | 'pcAssetCode' | 'mfaNote'>(k: K): string => (e?.[k] !== undefined ? (e[k] as string) : d[k]);
  const date = (k: 'purchasedOn' | 'renewsOn' | 'endsOn'): string => (e?.[k] !== undefined ? (e[k] ?? '') : (d[k] ?? ''));
  return {
    product: pick('product'),
    supplier: pick('supplier'),
    userName: pick('userName'),
    dept: pick('dept'),
    pcAssetCode: pick('pcAssetCode'),
    mfaNote: pick('mfaNote'),
    purchasedOn: date('purchasedOn'),
    renewsOn: date('renewsOn'),
    endsOn: date('endsOn'),
  };
}

/** 시트 값과 다른 칸만 골라 rowEdits 한 줄로. 하나도 안 다르면 null */
function diffEdit(tab: 'renew' | 'perm', d: ImportRowDetail, f: RowForm): ImportRowEdit | null {
  const out: ImportRowEdit = { tab, row: d.row };
  let n = 0;
  for (const k of ['product', 'supplier', 'userName', 'dept', 'pcAssetCode', 'mfaNote'] as const) {
    if (f[k] !== d[k]) {
      out[k] = f[k];
      n += 1;
    }
  }
  for (const k of ['purchasedOn', 'renewsOn', 'endsOn'] as const) {
    if (f[k] !== (d[k] ?? '')) {
      out[k] = f[k] ? f[k] : null;
      n += 1;
    }
  }
  return n > 0 ? out : null;
}
type Pick = { mode: Mode; clientKey: string; newName: string };

const TAB_LABEL = { renew: '갱신형', perm: '비갱신형' } as const;
const MATCH_LABEL = {
  exact: { cls: 'badge-상품화완료', label: '자동 맞춤' },
  similar: { cls: 'badge-상품화준비중', label: '확인 필요' },
  none: { cls: 'badge-미정', label: 'works에 없음' },
} as const;

const fieldsIn = (a: Partial<Record<SecretField, unknown>>, b: Partial<Record<SecretField, unknown>>): SecretField[] =>
  SECRET_FIELDS.filter((f) => a[f] !== undefined || b[f] !== undefined);

function sumValues(o: Partial<Record<SecretField, number>>): number {
  return Object.values(o).reduce<number>((s, n) => s + (n ?? 0), 0);
}

function defaultPick(g: ImportGroup): Pick {
  if (g.match === 'exact' && g.candidates.length > 0) return { mode: 'client', clientKey: g.candidates[0].key, newName: '' };
  if (g.match === 'none') {
    return g.sheetName ? { mode: 'new', clientKey: '', newName: g.sheetName } : { mode: 'unsorted', clientKey: '', newName: '' };
  }
  return { mode: '', clientKey: '', newName: g.sheetName }; // 확인 필요 — 사람이 고를 때까지 비워 둠
}

const pickValue = (p: Pick): string => (p.mode === 'client' ? `c:${p.clientKey}` : p.mode === 'new' ? 'n' : p.mode === 'unsorted' ? 'u' : p.mode === 'skip' ? 's' : '');

type Props = {
  open: boolean;
  /** works 에서 읽은 거래처(고르는 목록) */
  clients: ClientSummary[];
  onClose: () => void;
  /** 옮긴 뒤 목록을 다시 읽게 */
  onDone: () => void;
};

export default function SheetImportModal({ open, clients, onClose, onDone }: Props) {
  const { onNeedUnlock } = useContractsCtx();
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [prodRen, setProdRen] = useState<Record<string, string>>({});
  const [supRen, setSupRen] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [applyError, setApplyError] = useState('');
  // 줄 하나씩 빼기·고치기 — 키는 "탭:시트 행 번호"
  const [excluded, setExcluded] = useState<Record<string, true>>({});
  const [edits, setEdits] = useState<Record<string, ImportRowEdit>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [editKey, setEditKey] = useState<string | null>(null);
  const [rowForm, setRowForm] = useState<RowForm | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const upd = () => setMobile(mq.matches);
    upd();
    mq.addEventListener('change', upd);
    return () => mq.removeEventListener('change', upd);
  }, []);

  async function loadPreview() {
    setPhase('loading');
    setError('');
    setApplyError('');
    setResult(null);
    try {
      const r = await previewSheetImport();
      if (!r.ok) {
        setError(r.error);
        if (r.needUnlock) onNeedUnlock();
        setPhase('error');
        return;
      }
      const p = r.preview;
      setPreview(p);
      const next: Record<string, Pick> = {};
      for (const g of p.groups) next[g.groupKey] = defaultPick(g);
      setPicks(next);
      setExcluded({});
      setEdits({});
      setOpenGroups({});
      setEditKey(null);
      setRowForm(null);
      const pr: Record<string, string> = {};
      for (const n of p.productNames) pr[n.name] = n.name;
      setProdRen(pr);
      const sr: Record<string, string> = {};
      for (const n of p.supplierNames) sr[n.name] = n.name;
      setSupRen(sr);
      setPhase('groups');
    } catch {
      setError('시트를 읽지 못했어요. 잠시 뒤 다시 해 주세요.');
      setPhase('error');
    }
  }

  useEffect(() => {
    if (open && !mobile) void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mobile]);

  const groups = preview?.groups ?? [];
  const unresolved = groups.filter((g) => {
    const p = picks[g.groupKey];
    if (!p || p.mode === '') return true;
    if (p.mode === 'client' && !p.clientKey) return true;
    if (p.mode === 'new' && !p.newName.trim()) return true;
    return false;
  });

  const workClients = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name, 'ko')), [clients]);

  const plan = useMemo<ImportPlan | null>(() => {
    if (!preview) return null;
    const choices: ImportChoice[] = preview.groups.map((g): ImportChoice => {
      const p = picks[g.groupKey] ?? { mode: '', clientKey: '', newName: '' };
      return {
        groupKey: g.groupKey,
        target:
          p.mode === 'client'
            ? { clientKey: p.clientKey }
            : p.mode === 'new'
              ? { newName: p.newName.trim() }
              : p.mode === 'skip'
                ? 'skip'
                : 'unsorted',
      };
    });
    const diff = (m: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (v.trim() && v.trim() !== k) out[k] = v.trim();
      return out;
    };
    // 옮기지 않는 묶음의 줄은 따로 뺄 필요 없음 — 줄 하나씩 뺀 것과 고친 것만 보냄
    const skipGroups = new Set(preview.groups.filter((g) => picks[g.groupKey]?.mode === 'skip').map((g) => g.groupKey));
    const excludeRows: ImportPlan['excludeRows'] = [];
    const rowEdits: ImportRowEdit[] = [];
    for (const g of preview.groups) {
      if (skipGroups.has(g.groupKey)) continue;
      for (const d of g.rowsDetail) {
        const k = rowKey(g.tab, d.row);
        if (excluded[k]) excludeRows.push({ tab: g.tab, row: d.row });
        else if (edits[k]) rowEdits.push(edits[k]);
      }
    }
    return { fingerprint: preview.fingerprint, choices, productRenames: diff(prodRen), supplierRenames: diff(supRen), excludeRows, rowEdits };
  }, [preview, picks, prodRen, supRen, excluded, edits]);

  const totalSeats = preview ? preview.counts.renew.seats + preview.counts.perm.seats : 0;
  const totalSecrets = preview ? sumValues(preview.counts.renew.secrets) + sumValues(preview.counts.perm.secrets) : 0;

  // 뺀 것 세기(확인 단계 문구용): 옮기지 않는 묶음의 줄 + 줄 하나씩 뺀 줄
  const skipStats = useMemo(() => {
    let skippedGroups = 0;
    let skippedRows = 0;
    let skippedSecrets = 0;
    let edited = 0;
    for (const g of preview?.groups ?? []) {
      const skipAll = picks[g.groupKey]?.mode === 'skip';
      if (skipAll) skippedGroups += 1;
      for (const d of g.rowsDetail) {
        const k = rowKey(g.tab, d.row);
        if (skipAll || excluded[k]) {
          skippedRows += 1;
          skippedSecrets += d.secretFields.length;
        } else if (edits[k]) edited += 1;
      }
    }
    return { skippedGroups, skippedRows, skippedSecrets, edited };
  }, [preview, picks, excluded, edits]);

  async function apply() {
    if (!plan || phase === 'applying') return;
    setPhase('applying');
    setApplyError('');
    try {
      const r = await applySheetImport(plan);
      if (r.ok) {
        setResult(r.result);
        setPhase('result');
        onDone();
        return;
      }
      setApplyError(r.error);
      if (r.needUnlock) onNeedUnlock();
      setPhase('confirm');
    } catch {
      setApplyError('옮기는 도중 연결이 끊겼어요. 반영됐는지 알 수 없으니 "미리보기 다시"로 숫자를 확인해 주세요.');
      setPhase('confirm');
    }
  }

  function setPick(key: string, v: Partial<Pick>) {
    setPicks((m) => ({ ...m, [key]: { ...(m[key] ?? { mode: '', clientKey: '', newName: '' }), ...v } }));
  }

  function onSelect(g: ImportGroup, value: string) {
    if (value.startsWith('c:')) setPick(g.groupKey, { mode: 'client', clientKey: value.slice(2) });
    else if (value === 'n') setPick(g.groupKey, { mode: 'new', clientKey: '', newName: picks[g.groupKey]?.newName || g.sheetName });
    else if (value === 'u') setPick(g.groupKey, { mode: 'unsorted', clientKey: '' });
    else if (value === 's') setPick(g.groupKey, { mode: 'skip', clientKey: '' });
    else setPick(g.groupKey, { mode: '', clientKey: '' });
  }

  const busy = phase === 'applying';

  function setRowForm1<K extends keyof RowForm>(k: K, v: string) {
    setRowForm((f) => (f ? { ...f, [k]: v } : f));
  }

  /** 묶음 안 줄 목록 — ☑ 풀면 그 줄은 안 옮김, [수정]은 이 줄만 고쳐서 옮김(시트는 안 바뀜) */
  function renderRows(g: ImportGroup, groupSkipped: boolean) {
    const editing = g.rowsDetail.find((d) => rowKey(g.tab, d.row) === editKey) ?? null;
    return (
      <div className="ct-rows">
        <table className="m-cards ct-rows-table">
          <thead>
            <tr>
              <th data-m="check" data-label="옮김">옮김</th>
              <th data-m="title" data-label="행">행</th>
              <th data-m="badge" data-label="표시">표시</th>
              <th data-m="inline" data-label="상품">상품</th>
              <th data-m="inline" data-label="사용자">사용자 · 부서</th>
              <th data-m="inline" data-label="PC">설치 PC</th>
              <th data-m="sub" data-label="날짜">날짜</th>
              <th data-m="full" data-label="비밀 칸">비밀 칸</th>
              <th data-m="actions"></th>
            </tr>
          </thead>
          <tbody>
            {g.rowsDetail.map((d) => {
              const k = rowKey(g.tab, d.row);
              const off = groupSkipped || !!excluded[k];
              const ed = edits[k];
              return (
                <tr key={k} className={off ? 'ct-row-off' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!off}
                      disabled={groupSkipped || busy}
                      aria-label={`${d.row}행 옮기기`}
                      onChange={(e) =>
                        setExcluded((m) => {
                          const next = { ...m };
                          if (e.target.checked) delete next[k];
                          else next[k] = true;
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>{d.row}행</td>
                  <td>
                    {off ? <span className="badge badge-미정">안 옮겨요</span> : null}
                    {!off && d.alreadyImported ? <span className="badge badge-임대중">이미 옮김</span> : null}
                    {ed && !off ? <span className="badge badge-판매">수정됨</span> : null}
                  </td>
                  <td>{(ed?.product ?? d.product) || '-'}</td>
                  <td>{[ed?.userName ?? d.userName, ed?.dept ?? d.dept].filter(Boolean).join(' · ') || '-'}</td>
                  <td>{(ed?.pcAssetCode ?? d.pcAssetCode) || '-'}</td>
                  <td>{d.dateRaw || '-'}</td>
                  <td>
                    {d.secretFields.length > 0 ? (
                      <span className="ct-secret-tags">
                        {d.secretFields.map((f) => (
                          <span key={f} className="badge badge-기타">
                            🔒 {SECRET_FIELD_LABEL[f]}
                          </span>
                        ))}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost ct-small"
                        disabled={off || busy || d.alreadyImported}
                        title={d.alreadyImported ? '이미 옮긴 줄은 옮긴 뒤 화면(거래처 창)에서 고쳐요' : undefined}
                        onClick={() => {
                          setEditKey(k);
                          setRowForm(rowFormOf(d, ed));
                        }}
                      >
                        {d.alreadyImported ? '화면에서 수정' : '수정'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {editing && rowForm && (
          <div className="ct-card ct-card-edit">
            <div className="ct-card-title">{editing.row}행 고쳐서 옮기기</div>
            <div className="ct-muted">여기서 고친 값만 앱에 들어가요. 시트는 그대로예요. 비밀 칸은 옮긴 뒤 화면에서 고쳐요.</div>
            <div className="form-grid">
              <div className="form-field">
                <label>상품명</label>
                <input value={rowForm.product} onChange={(e) => setRowForm1('product', e.target.value)} />
              </div>
              <div className="form-field">
                <label>매입처</label>
                <input value={rowForm.supplier} onChange={(e) => setRowForm1('supplier', e.target.value)} />
              </div>
              <div className="form-field">
                <label>사용자</label>
                <input value={rowForm.userName} onChange={(e) => setRowForm1('userName', e.target.value)} />
              </div>
              <div className="form-field">
                <label>부서</label>
                <input value={rowForm.dept} onChange={(e) => setRowForm1('dept', e.target.value)} />
              </div>
              <div className="form-field">
                <label>설치 PC 자산번호</label>
                <input value={rowForm.pcAssetCode} onChange={(e) => setRowForm1('pcAssetCode', e.target.value)} />
              </div>
              <div className="form-field">
                <label>2차인증 메모</label>
                <input value={rowForm.mfaNote} onChange={(e) => setRowForm1('mfaNote', e.target.value)} />
              </div>
              <div className="form-field">
                <label>구매일</label>
                <input type="date" value={rowForm.purchasedOn} onChange={(e) => setRowForm1('purchasedOn', e.target.value)} />
              </div>
              <div className="form-field">
                <label>다음 갱신일</label>
                <input type="date" value={rowForm.renewsOn} onChange={(e) => setRowForm1('renewsOn', e.target.value)} />
              </div>
              <div className="form-field">
                <label>종료일</label>
                <input type="date" value={rowForm.endsOn} onChange={(e) => setRowForm1('endsOn', e.target.value)} />
              </div>
            </div>
            <div className="ct-btnrow">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const k = rowKey(g.tab, editing.row);
                  const e = diffEdit(g.tab, editing, rowForm);
                  setEdits((m) => {
                    const next = { ...m };
                    if (e) next[k] = e;
                    else delete next[k];
                    return next;
                  });
                  setEditKey(null);
                  setRowForm(null);
                }}
              >
                저장
              </button>
              {edits[rowKey(g.tab, editing.row)] && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    const k = rowKey(g.tab, editing.row);
                    setEdits((m) => {
                      const next = { ...m };
                      delete next[k];
                      return next;
                    });
                    setEditKey(null);
                    setRowForm(null);
                  }}
                >
                  시트 값으로 되돌리기
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditKey(null);
                  setRowForm(null);
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function countsTable(c: { renew: ImportCounts; perm: ImportCounts }) {
    const fields = fieldsIn(c.renew.secrets, c.perm.secrets);
    return (
      <table className="ct-numtable">
        <thead>
          <tr>
            <th></th>
            <th>{TAB_LABEL.renew}</th>
            <th>{TAB_LABEL.perm}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>읽은 줄</td>
            <td>{c.renew.sheetRows}</td>
            <td>{c.perm.sheetRows}</td>
          </tr>
          <tr>
            <td>빈 줄 (뺌)</td>
            <td>{c.renew.blankRows}</td>
            <td>{c.perm.blankRows}</td>
          </tr>
          <tr>
            <td>옮길 좌석</td>
            <td>{c.renew.seats}</td>
            <td>{c.perm.seats}</td>
          </tr>
          {fields.map((f) => (
            <tr key={f}>
              <td>🔒 {SECRET_FIELD_LABEL[f]}</td>
              <td>{c.renew.secrets[f] ?? 0}</td>
              <td>{c.perm.secrets[f] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function resultTable(r: ImportResult) {
    const tabs: { key: 'renew' | 'perm'; t: ImportTabResult }[] = [
      { key: 'renew', t: r.renew },
      { key: 'perm', t: r.perm },
    ];
    const fields = SECRET_FIELDS.filter((f) => tabs.some((x) => x.t.secrets[f] !== undefined));
    return (
      <table className="ct-numtable">
        <thead>
          <tr>
            <th></th>
            <th>{TAB_LABEL.renew}</th>
            <th>{TAB_LABEL.perm}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>시트 줄 (빈 줄 뺀)</td>
            <td>{r.renew.sheetRows}</td>
            <td>{r.perm.sheetRows}</td>
          </tr>
          <tr>
            <td>좌석 · 새로 옮김</td>
            <td>{r.renew.seatsInserted}</td>
            <td>{r.perm.seatsInserted}</td>
          </tr>
          <tr>
            <td>좌석 · 이미 있었음</td>
            <td>{r.renew.seatsExisting}</td>
            <td>{r.perm.seatsExisting}</td>
          </tr>
          {fields.map((f) => (
            <tr key={f}>
              <td>🔒 {SECRET_FIELD_LABEL[f]}</td>
              {tabs.map(({ key, t }) => {
                const s = t.secrets[f];
                if (!s) return <td key={key}>-</td>;
                const ok = s.verified === s.inserted + s.existing && s.sheet === s.inserted + s.existing;
                return (
                  <td key={key} className={ok ? 'ct-ok' : 'ct-bad'}>
                    <div>시트 {s.sheet}</div>
                    <div>
                      저장 새로 {s.inserted} · 이미 {s.existing}
                    </div>
                    <div>
                      저장 확인 {s.verified} {ok ? '✓' : '✗'}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td>
              <b>빠진 것</b>
            </td>
            <td className={r.renew.missing.length === 0 ? 'ct-ok' : 'ct-bad'}>
              <b>{r.renew.missing.length}</b>
            </td>
            <td className={r.perm.missing.length === 0 ? 'ct-ok' : 'ct-bad'}>
              <b>{r.perm.missing.length}</b>
            </td>
          </tr>
          <tr className="ct-skip-row">
            <td>
              <b>뺀 줄</b>
              <div className="ct-muted">내가 뺀 것 — 시트에는 그대로 있어요</div>
            </td>
            <td>{r.renew.skippedRows}</td>
            <td>{r.perm.skippedRows}</td>
          </tr>
          <tr className="ct-skip-row">
            <td>
              <b>뺀 묶음</b>
            </td>
            <td colSpan={2}>{r.skippedGroups}개 묶음은 옮기지 않았어요</td>
          </tr>
        </tbody>
      </table>
    );
  }

  const resultOk = (r: ImportResult) => {
    for (const t of [r.renew, r.perm]) {
      if (t.missing.length > 0) return false;
      for (const s of Object.values(t.secrets)) {
        if (s && (s.verified !== s.inserted + s.existing || s.sheet !== s.inserted + s.existing)) return false;
      }
    }
    return true;
  };

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal ct-modal">
        <div className="ct-modal-head">
          <h2>📥 시트에서 옮기기</h2>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="닫기">
            ×
          </button>
        </div>

        {mobile ? (
          <div className="empty-state">
            <div>💻</div>시트 옮기기는 PC에서 해 주세요. 한 번만 하는 큰 작업이라 핸드폰에서는 막아 뒀어요.
          </div>
        ) : (
          <>
            <div className="ct-steps" aria-label="진행 단계">
              <span className={phase === 'groups' || phase === 'loading' || phase === 'error' ? 'on' : ''}>① 거래처 고르기</span>
              <span className={phase === 'names' ? 'on' : ''}>② 이름 정리</span>
              <span className={phase === 'confirm' || phase === 'applying' ? 'on' : ''}>③ 옮기기</span>
              <span className={phase === 'result' ? 'on' : ''}>결과</span>
            </div>

            {phase === 'loading' && (
              <div className="empty-state">
                <div>⏳</div>시트를 읽는 중…
              </div>
            )}

            {phase === 'error' && (
              <div className="empty-state">
                <div>⚠️</div>
                {error}
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => void loadPreview()}>
                    다시 읽기
                  </button>
                </div>
              </div>
            )}

            {preview && phase === 'groups' && (
              <>
                <div className="ct-note">
                  시트를 읽었을 뿐 아직 아무것도 옮기지 않았어요. 아래 숫자가 시트와 맞는지 확인하고, 시트 업체마다 어느 거래처로 옮길지 골라 주세요. 옮기고 싶지 않은 업체는 [옮기지 않기](시트에만 남아요), 일부 줄만 빼거나 고치려면 [줄 n개 보기]를 눌러 주세요. 모르면 [미분류로]를 고르면 나중에 옮길 수 있어요.
                </div>
                {countsTable(preview.counts)}
                {preview.warnings.length > 0 && (
                  <div className="ct-band warn ct-warnlist">
                    <div>
                      {preview.warnings.map((w, i) => (
                        <div key={i}>⚠ {w}</div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="ct-section-title">
                  <span>시트 업체 {groups.length}묶음 {unresolved.length > 0 ? `· 아직 안 고른 곳 ${unresolved.length}` : '· 모두 골랐어요'}</span>
                </div>
                {groups.length === 0 && (
                  <div className="empty-state">
                    <div>📋</div>옮길 줄이 없어요. 시트에 값이 든 줄이 없거나 모두 옮겨져 있어요.
                  </div>
                )}
                {groups.map((g) => {
                  const p = picks[g.groupKey] ?? { mode: '' as Mode, clientKey: '', newName: '' };
                  const m = MATCH_LABEL[g.match];
                  const candKeys = new Set(g.candidates.map((x) => x.key));
                  const secretText = SECRET_FIELDS.filter((f) => (g.secretCounts[f] ?? 0) > 0)
                    .map((f) => `${SECRET_FIELD_LABEL[f]} ${g.secretCounts[f]}`)
                    .join(' · ');
                  return (
                    <div key={g.groupKey} className={`ct-group${p.mode === '' ? ' ct-group-todo' : ''}${p.mode === 'skip' ? ' ct-group-skip' : ''}`}>
                      <div className="ct-group-head">
                        <b>{g.sheetName || '(업체 이름 없음)'}</b>
                        <span className="badge badge-기타">{TAB_LABEL[g.tab]}</span>
                        <span className={`badge ${m.cls}`}>{m.label}</span>
                        {g.alreadyImported > 0 && <span className="ct-muted">이미 옮긴 {g.alreadyImported}줄</span>}
                      </div>
                      <div className="ct-muted">
                        {g.rows}줄 · {g.products.map((x) => `${x.name} ${x.rows}`).join(' · ') || '상품 없음'}
                        {secretText ? ` · 🔒 ${secretText}` : ''}
                      </div>
                      {g.domainHint && (
                        <div className="ct-muted">
                          계정 도메인 @{g.domainHint}
                          {g.guessedBy === 'domain' ? ' 로 짐작한 업체예요' : ''}
                        </div>
                      )}
                      <div className="ct-inline-form">
                        <select value={pickValue(p)} onChange={(e) => onSelect(g, e.target.value)} aria-label={`${g.sheetName || '업체 이름 없음'} 옮길 곳`}>
                          <option value="">옮길 곳을 고르세요</option>
                          {g.candidates.length > 0 && (
                            <optgroup label="추천">
                              {g.candidates.map((x) => (
                                <option key={x.key} value={`c:${x.key}`}>
                                  {x.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="works 거래처 전체">
                            {workClients
                              .filter((x) => !candKeys.has(x.key))
                              .map((x) => (
                                <option key={x.key} value={`c:${x.key}`}>
                                  {x.name}
                                </option>
                              ))}
                          </optgroup>
                          <option value="n">＋ 새 거래처로 (works에 없음)</option>
                          <option value="u">미분류로 (나중에 옮기기)</option>
                          <option value="s" style={{ color: 'var(--red-600)' }}>
                            옮기지 않기 (시트에만 둠)
                          </option>
                        </select>
                        {p.mode === 'new' && (
                          <input
                            value={p.newName}
                            onChange={(e) => setPick(g.groupKey, { newName: e.target.value })}
                            placeholder="새 거래처 이름"
                            aria-label="새 거래처 이름"
                          />
                        )}
                      </div>
                      {p.mode === 'skip' && <div className="ct-warn">이 묶음은 옮기지 않아요. 시트에는 그대로 있어요.</div>}
                      {g.rowsDetail.length > 0 && (
                        <>
                          <button
                            type="button"
                            className="ct-rows-toggle"
                            aria-expanded={!!openGroups[g.groupKey]}
                            onClick={() => setOpenGroups((o) => ({ ...o, [g.groupKey]: !o[g.groupKey] }))}
                          >
                            {openGroups[g.groupKey] ? '▾' : '▸'} 줄 {g.rowsDetail.length}개 보기
                            {g.rowsDetail.some((d) => excluded[rowKey(g.tab, d.row)]) || g.rowsDetail.some((d) => edits[rowKey(g.tab, d.row)])
                              ? ` (뺀 줄 ${g.rowsDetail.filter((d) => excluded[rowKey(g.tab, d.row)]).length} · 고친 줄 ${g.rowsDetail.filter((d) => edits[rowKey(g.tab, d.row)]).length})`
                              : ''}
                          </button>
                          {openGroups[g.groupKey] && renderRows(g, p.mode === 'skip')}
                        </>
                      )}
                    </div>
                  );
                })}
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={onClose}>
                    닫기
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={unresolved.length > 0}
                    onClick={() => setPhase(preview.productNames.length + preview.supplierNames.length > 0 ? 'names' : 'confirm')}
                  >
                    다음 {unresolved.length > 0 ? `(안 고른 ${unresolved.length}곳)` : ''}
                  </button>
                </div>
              </>
            )}

            {preview && phase === 'names' && (
              <>
                <div className="ct-note">시트에 오타나 다르게 적힌 이름이 있으면 하나로 맞춰 주세요. 바꾸지 않으면 시트에 적힌 그대로 옮겨져요.</div>
                {preview.productNames.length > 0 && (
                  <>
                    <div className="ct-section-title">
                      <span>상품 이름</span>
                    </div>
                    <datalist id="ct-product-names">
                      {preview.productNames.map((n) => (
                        <option key={n.name} value={n.name} />
                      ))}
                    </datalist>
                    {preview.productNames.map((n) => (
                      <div key={n.name} className="ct-rename">
                        <div className="ct-rename-from">
                          {n.name} <span className="ct-muted">{n.rows}줄</span>
                        </div>
                        <input
                          list="ct-product-names"
                          value={prodRen[n.name] ?? n.name}
                          onChange={(e) => setProdRen((m) => ({ ...m, [n.name]: e.target.value }))}
                          aria-label={`${n.name} 합칠 이름`}
                        />
                      </div>
                    ))}
                  </>
                )}
                {preview.supplierNames.length > 0 && (
                  <>
                    <div className="ct-section-title">
                      <span>매입처 이름</span>
                    </div>
                    <datalist id="ct-supplier-names">
                      {preview.supplierNames.map((n) => (
                        <option key={n.name} value={n.name} />
                      ))}
                    </datalist>
                    {preview.supplierNames.map((n) => (
                      <div key={n.name} className="ct-rename">
                        <div className="ct-rename-from">
                          {n.name} <span className="ct-muted">{n.rows}줄</span>
                        </div>
                        <input
                          list="ct-supplier-names"
                          value={supRen[n.name] ?? n.name}
                          onChange={(e) => setSupRen((m) => ({ ...m, [n.name]: e.target.value }))}
                          aria-label={`${n.name} 합칠 이름`}
                        />
                      </div>
                    ))}
                  </>
                )}
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={() => setPhase('groups')}>
                    이전
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => setPhase('confirm')}>
                    다음
                  </button>
                </div>
              </>
            )}

            {preview && (phase === 'confirm' || phase === 'applying') && plan && (
              <>
                <div className="ct-confirm">
                  좌석 {Math.max(0, totalSeats - skipStats.skippedRows)}개 · 비밀 칸 {Math.max(0, totalSecrets - skipStats.skippedSecrets)}개를 옮길까요?
                  <div className="ct-muted" style={{ fontSize: '12.5px', marginTop: '4px' }}>
                    (뺀 줄 {skipStats.skippedRows}개 · 묶음 {skipStats.skippedGroups}개는 안 옮겨요 · 고친 줄 {skipStats.edited}개)
                  </div>
                </div>
                <ul className="ct-confirm-list">
                  <li>
                    기존 거래처로 {plan.choices.filter((c) => typeof c.target === 'object' && 'clientKey' in c.target).length}묶음 · 새 거래처로{' '}
                    {plan.choices.filter((c) => typeof c.target === 'object' && 'newName' in c.target).length}묶음 · 미분류로{' '}
                    {plan.choices.filter((c) => c.target === 'unsorted').length}묶음 · 옮기지 않기 {skipStats.skippedGroups}묶음
                  </li>
                  <li>
                    이름 합치기: 상품 {Object.keys(plan.productRenames).length}개 · 매입처 {Object.keys(plan.supplierRenames).length}개
                  </li>
                  <li>이미 옮긴 것은 다시 만들지 않고, 앱에서 고친 값은 덮어쓰지 않아요. 옮긴 뒤 저장된 값이 시트와 같은지 다시 읽어 확인해요.</li>
                </ul>
                {applyError && (
                  <div className="ct-error" role="alert">
                    {applyError}
                  </div>
                )}
                {busy && <div className="ct-band muted">옮기는 중이에요… 창을 닫거나 새로 고침하지 마세요.</div>}
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void loadPreview()}>
                    미리보기 다시
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPhase('groups')}>
                    이전
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy || unresolved.length > 0} onClick={() => void apply()}>
                    {busy ? '옮기는 중…' : '옮기기 시작'}
                  </button>
                </div>
              </>
            )}

            {phase === 'result' && result && (
              <>
                <div className={`ct-band ${resultOk(result) ? 'good' : 'bad'}`}>
                  {resultOk(result)
                    ? '시트의 값을 모두 옮겼고, 저장된 값이 시트와 같은지도 확인했어요. 빠진 것 0.'
                    : '확인이 필요한 것이 있어요. 아래 빨간 칸과 빠진 것 목록을 보세요.'}
                </div>
                <div className="ct-muted" style={{ marginBottom: '8px' }}>
                  새 거래처 {result.clientsCreated}곳 · 새 계약 상품 {result.contractsCreated}개 · 미분류로 들어간 묶음 {result.unsortedGroups}개
                </div>
                {resultTable(result)}
                {([['renew', result.renew], ['perm', result.perm]] as const).map(([k, t]) =>
                  t.missing.length > 0 ? (
                    <div key={k} className="ct-band bad ct-warnlist">
                      <div>
                        <b>{TAB_LABEL[k]} 빠진 것 {t.missing.length}개</b> (시트 행 번호 · 칸, 값은 안 보여요)
                        <div className="ct-missing">
                          {t.missing.slice(0, 100).map((m, i) => (
                            <span key={i}>
                              {m.row}행 {m.field === 'seat' ? '좌석' : SECRET_FIELD_LABEL[m.field]}
                            </span>
                          ))}
                          {t.missing.length > 100 && <span>… 외 {t.missing.length - 100}개</span>}
                        </div>
                      </div>
                    </div>
                  ) : null,
                )}
                <div className="ct-note">
                  같은 선택으로 한 번 더 눌러도 &quot;새로 옮김&quot;은 0이어야 정상이에요. 0이 아니면 알려 주세요.
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={() => void apply()}>
                    한 번 더 옮겨 보기
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void loadPreview()}>
                    미리보기 다시
                  </button>
                  <button type="button" className="btn btn-primary" onClick={onClose}>
                    닫기
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
