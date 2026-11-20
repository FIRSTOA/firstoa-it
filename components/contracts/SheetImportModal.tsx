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
  type ImportResult,
  type ImportTabResult,
  type SecretField,
} from '@/lib/contracts/types';
import { useContractsCtx } from './UnlockDialog';

type Phase = 'loading' | 'error' | 'groups' | 'names' | 'confirm' | 'applying' | 'result';
type Mode = '' | 'client' | 'new' | 'unsorted';
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

const pickValue = (p: Pick): string => (p.mode === 'client' ? `c:${p.clientKey}` : p.mode === 'new' ? 'n' : p.mode === 'unsorted' ? 'u' : '');

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
        target: p.mode === 'client' ? { clientKey: p.clientKey } : p.mode === 'new' ? { newName: p.newName.trim() } : 'unsorted',
      };
    });
    const diff = (m: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (v.trim() && v.trim() !== k) out[k] = v.trim();
      return out;
    };
    return { fingerprint: preview.fingerprint, choices, productRenames: diff(prodRen), supplierRenames: diff(supRen) };
  }, [preview, picks, prodRen, supRen]);

  const totalSeats = preview ? preview.counts.renew.seats + preview.counts.perm.seats : 0;
  const totalSecrets = preview ? sumValues(preview.counts.renew.secrets) + sumValues(preview.counts.perm.secrets) : 0;

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
    else setPick(g.groupKey, { mode: '', clientKey: '' });
  }

  const busy = phase === 'applying';

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
                  시트를 읽었을 뿐 아직 아무것도 옮기지 않았어요. 아래 숫자가 시트와 맞는지 확인하고, 시트 업체마다 어느 거래처로 옮길지 골라 주세요. 건너뛰는 선택은 없어요. 모르면 [미분류로]를 고르면 나중에 옮길 수 있어요.
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
                    <div key={g.groupKey} className={`ct-group${p.mode === '' ? ' ct-group-todo' : ''}`}>
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
                  좌석 {totalSeats}개 · 비밀 칸 {totalSecrets}개를 옮길까요?
                </div>
                <ul className="ct-confirm-list">
                  <li>
                    기존 거래처로 {plan.choices.filter((c) => typeof c.target === 'object' && 'clientKey' in c.target).length}묶음 · 새 거래처로{' '}
                    {plan.choices.filter((c) => typeof c.target === 'object' && 'newName' in c.target).length}묶음 · 미분류로{' '}
                    {plan.choices.filter((c) => c.target === 'unsorted').length}묶음
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
