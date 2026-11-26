'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { acknowledgeSalesConfirmChange } from '@/app/confirm-form/salesActions';
import {
  ackSnapshot,
  ackUnitDiffs,
  applyLineValues,
  deleteOrphanUnit,
  lookupSalesUnitAsset,
  moveOrphanUnit,
  openSalesConfirm,
  saveSalesUnit,
  saveSalesWork,
} from '@/app/confirm-form/salesDetailActions';
import { getConfirmLicenseState, pushUnitsToLedger, saveLineLicenseKey, saveUnitLicenseKey } from '@/app/confirm-form/salesLicenseActions';
import { ITEM_KIND_LABEL, ITEM_KIND_RULES, checkGroupFor, type ItemKind } from '@/lib/salesConfirms/itemKind';
import { hasSpec } from '@/lib/salesConfirms/salesForm/confirm';
import {
  CHECK_GROUP_PER_CONFIRM,
  SALES_CONFIRM_STATUSES,
  SALES_SPEC_KEYS,
  confirmFormViewHref,
  safeDocUrl,
  type ConfirmLicenseState,
  type DiffItem,
  type LedgerClientCandidate,
  type LedgerClientChoice,
  type LicenseActionResult,
  type SalesConfirmDetailData,
  type SalesConfirmStatus,
  type SalesSlot,
  type SalesSlotLine,
  type SalesSpec,
  type SalesUnitRow,
  type SalesUnitSaveResult,
} from '@/lib/salesConfirms/types';
import ChecklistPanel from './ChecklistPanel';
import DeviceSlotCard from './DeviceSlotCard';
import DiffConfirmDialog from './DiffConfirmDialog';
import {
  fromKstInput,
  minutesText,
  slotDomId,
  toKstInput,
  unitFilled,
  type LookupAsset,
  type SaveUnit,
  type SaveUnitResult,
  type SlotRef,
} from './detailShared';
import { fmtDate, fmtDateTime, statusClass } from './format';
import LedgerClientDialog from './LedgerClientDialog';
import LicenseUnlockDialog from './LicenseUnlockDialog';
import LineBulkDialog, { type LineBulkMode } from './LineBulkDialog';
import OrphanPanel, { type OrphanTarget } from './OrphanPanel';
import PrepHintBox from './PrepHintBox';
import SalesChangeBanner from './SalesChangeBanner';
import SalesPrintDialog from './SalesPrintDialog';
import { useSalesActor, useSalesToast } from './salesUi';
import SoftwareSlotCard from './SoftwareSlotCard';
import UnknownValue from './UnknownValue';
import { isBlank } from './unknownValueHelpers';

export type SalesConfirmDetailInitial =
  | { ok: true; data: SalesConfirmDetailData }
  | { ok: false; notFound?: true; error: string };

/**
 * 영업 확인서 상세(/confirm-form/[id]) — page.tsx 가 openSalesConfirm 결과를 initial 로 건넴.
 * 읽지 못했거나 없는 확인서면 이유와 [목록으로]만 보임.
 */
export default function SalesConfirmDetail({ initial }: { initial: SalesConfirmDetailInitial }) {
  if (!initial.ok) return <DetailProblem notFound={!!initial.notFound} error={initial.error} />;
  return <DetailBody initial={initial.data} />;
}

function DetailProblem({ notFound, error }: { notFound: boolean; error: string }) {
  const router = useRouter();
  return (
    <div className="app sc-page">
      <div className="panel sc-error" role={notFound ? undefined : 'alert'}>
        <div className="empty-state">
          <div>{notFound ? '🔍' : '⚠️'}</div>
          <div>{notFound ? '확인서를 못 찾았어요.' : '확인서를 열지 못했어요.'}</div>
          <div className="sc-error-why">
            {notFound ? '주소가 잘못됐거나, 영업 웹앱에서 아직 가져오지 못한 확인서예요. 목록에서 다시 골라 주세요.' : error}
          </div>
          <div className="sc-problem-btns">
            {!notFound && (
              <button type="button" className="btn btn-primary" onClick={() => router.refresh()}>
                다시 시도
              </button>
            )}
            <Link href={confirmFormViewHref('sales')} className="btn btn-ghost">
              ← 목록으로
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 본문 ─────────────────────────

type WorkPatch = {
  status?: SalesConfirmStatus;
  processors?: string[];
  startedAt?: string;
  finishedAt?: string;
  shippedAt?: string;
  note?: string;
  checks?: { label: string; on: boolean }[];
};

function findSlot(d: SalesConfirmDetailData, ref: SlotRef): SalesSlot | undefined {
  return d.lines.find((l) => l.itemIndex === ref.itemIndex)?.slots.find((s) => s.slotKey === ref.slotKey && s.unitNo === ref.unitNo);
}

function DetailBody({ initial }: { initial: SalesConfirmDetailData }) {
  const [data, setData] = useState(initial);
  const dataRef = useRef(data);
  dataRef.current = data;
  const confirmId = initial.confirm.id;
  const { actor, actorRef, ensureActor, changeName, nameDialog } = useSalesActor();
  const { show: toastShow, warn: toastWarn, node: toastNode } = useSalesToast();
  const toast = useMemo(() => ({ show: toastShow, warn: toastWarn }), [toastShow, toastWarn]);
  const [reloading, setReloading] = useState(false);
  const [sqlNeeded, setSqlNeeded] = useState(false);
  const [sqlB, setSqlB] = useState(false);
  const [ackBusy, setAckBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [bulk, setBulk] = useState<{ mode: LineBulkMode; itemIndex: number } | null>(null);

  const c = data.confirm;
  const docUrl = safeDocUrl(data.docUrl);
  const hasSoftware = data.lines.some((l) => l.kind === 'software');
  const schemaOk = data.schemaReady && !sqlNeeded;
  const unitsDisabled = !schemaOk;

  // ───── 다시 읽기 ─────
  const reload = useCallback(
    async (quiet = false) => {
      setReloading(true);
      try {
        const res = await openSalesConfirm({ id: confirmId, actor: actorRef.current });
        if (res.ok) setData(res.data);
        else if (!quiet) toast.warn(`다시 읽지 못했어요 — ${res.error}`);
      } catch (e) {
        if (!quiet) toast.warn(`다시 읽지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
      } finally {
        setReloading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirmId],
  );

  // 서버 page 는 이름을 모르고 열어서(이름이 비면 서버가 이름 없이 열람 표시만) — 이름을 알게 되면 한 번 다시 읽어 "처음 연 사람"을 남김
  const openedRef = useRef(false);
  useEffect(() => {
    if (actor && !openedRef.current) {
      openedRef.current = true;
      void reload(true);
    }
  }, [actor, reload]);

  // ───── 저장 줄 세우기(한 번에 하나씩 — 같은 칸을 연달아 고쳐도 updated_at 이 안 어긋나게) ─────
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const serial = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.current.then(fn, fn);
    chain.current = p.catch(() => undefined);
    return p;
  }, []);

  // ───── 차이 확인 창 ─────
  const [ackReq, setAckReq] = useState<{ items: DiffItem[]; modelLabel: string; resolve: (v: boolean) => void } | null>(null);
  const askAck = useCallback((items: DiffItem[], modelLabel: string) => {
    return new Promise<boolean>((resolve) => setAckReq({ items, modelLabel, resolve }));
  }, []);

  const applyUnits = useCallback((units: SalesUnitRow[]) => {
    setData((d) => ({
      ...d,
      lines: d.lines.map((l) => ({
        ...l,
        slots: l.slots.map((s) => {
          const u = units.find((x) => x.slotKey === s.slotKey && x.unitNo === s.unitNo);
          return u ? { ...s, unit: u, unackedDiffs: [] } : s;
        }),
      })),
      orphans: d.orphans.map((o) => units.find((x) => x.id === o.id) ?? o),
    }));
  }, []);

  /** 저장 한 번 + 차이 확인(needAck → 창 → [맞아요] 면 같은 저장을 acks 와 함께 다시) + 충돌·SQL 전 처리 */
  const runUnitAction = useCallback(
    async (
      exec: (acks: DiffItem[], who: string) => Promise<SalesUnitSaveResult>,
      modelLabel: string,
      initialAcks: DiffItem[] = [],
    ): Promise<SaveUnitResult> => {
      const who = await ensureActor();
      if (!who) return { ok: false };
      let acks = initialAcks;
      for (let attempt = 0; attempt < 3; attempt++) {
        let res: SalesUnitSaveResult;
        try {
          res = await exec(acks, who);
        } catch (e) {
          toast.warn(`저장하지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
          return { ok: false };
        }
        if (res.ok) {
          applyUnits(res.units);
          return { ok: true };
        }
        if ('needAck' in res) {
          const yes = await askAck(res.needAck, modelLabel);
          if (!yes) return { ok: false, redo: res.needAck };
          acks = res.needAck;
          continue;
        }
        if ('conflict' in res) {
          toast.warn('다른 사람이 방금 고쳤어요 — 새로 불러왔어요. 다시 한 번 적어 주세요.');
          await reload(true);
          return { ok: false };
        }
        if ('needSql' in res) {
          setSqlNeeded(true);
          toast.warn(res.error || 'SQL 실행이 필요해요.');
          return { ok: false };
        }
        toast.warn(`저장하지 못했어요 — ${res.error}`);
        return { ok: false };
      }
      return { ok: false };
    },
    [applyUnits, askAck, ensureActor, reload, toast],
  );

  const modelLabelOf = useCallback((itemIndex: number) => (dataRef.current.lines.find((l) => l.itemIndex === itemIndex)?.kind === 'software' ? '제품명' : '모델명'), []);

  const saveUnit: SaveUnit = useCallback(
    (ref, patch) =>
      serial(() =>
        runUnitAction((acks, who) => {
          const cur = findSlot(dataRef.current, ref)?.unit ?? null;
          return saveSalesUnit({
            confirmId,
            slotKey: ref.slotKey,
            unitNo: ref.unitNo,
            unitId: cur?.id ?? null,
            expectedUpdatedAt: cur?.updatedAt ?? null,
            patch,
            acks,
            actor: who,
          });
        }, modelLabelOf(ref.itemIndex)),
      ),
    [confirmId, modelLabelOf, runUnitAction, serial],
  );

  const lookupAsset: LookupAsset = useCallback(
    async (assetId, hint) => {
      try {
        return await lookupSalesUnitAsset({ assetId, hint: hint || undefined, confirmId });
      } catch {
        return { ok: false, error: 'IT재고를 읽지 못했어요. 직접 적어 주세요.' };
      }
    },
    [confirmId],
  );

  // "다시 확인 필요" [확인]
  const recheck = useCallback(
    (slot: SalesSlot) => {
      const unit = slot.unit;
      if (!unit || slot.unackedDiffs.length === 0) return;
      const items = slot.unackedDiffs;
      const itemIndex = dataRef.current.lines.find((l) => l.slots.includes(slot))?.itemIndex ?? 0;
      void serial(async () => {
        const yes = await askAck(items, modelLabelOf(itemIndex));
        if (!yes) return;
        const r = await runUnitAction((acks, who) => ackUnitDiffs({ confirmId, unitId: unit.id, acks, actor: who }), modelLabelOf(itemIndex), items);
        if (r.ok) toast.show('확인했어요.');
      });
    },
    [askAck, confirmId, modelLabelOf, runUnitAction, serial, toast],
  );

  // 품목이 바뀌었어요 [확인함] — 그 줄의 칸 기록을 새 영업 품목 기준으로(서버가 스냅숏을 갱신)
  // (서버 액션 ackSnapshot 과 이름이 겹치면 자기 자신을 부르게 되므로 onAckSnapshot)
  const onAckSnapshot = useCallback(
    (line: SalesSlotLine) => {
      void serial(async () => {
        const r = await runUnitAction((_acks, who) => ackSnapshot({ confirmId, itemIndex: line.itemIndex, actor: who }), modelLabelOf(line.itemIndex));
        if (r.ok) {
          await reload(true);
          toast.show('확인했어요.');
        }
      });
    },
    [confirmId, modelLabelOf, reload, runUnitAction, serial, toast],
  );

  const applyLine = useCallback(
    (itemIndex: number, values: { specOverride?: SalesSpec; actualModel?: string; actualMaker?: string }): Promise<boolean> =>
      serial(async () => {
        const r = await runUnitAction((acks, who) => applyLineValues({ confirmId, itemIndex, values, acks, actor: who }), modelLabelOf(itemIndex));
        if (r.ok) {
          await reload(true); // 칸 행이 새로 만들어졌을 수 있어서
          toast.show('모든 칸에 적용했어요.');
        }
        return r.ok;
      }),
    [confirmId, modelLabelOf, reload, runUnitAction, serial, toast],
  );

  // ───── 영업에서 빠진 칸 ─────
  const moveOrphan = useCallback(
    (u: SalesUnitRow, to: OrphanTarget): Promise<boolean> =>
      serial(async () => {
        const r = await runUnitAction((_acks, a) => moveOrphanUnit({ confirmId, unitId: u.id, toSlotKey: to.slotKey, toUnitNo: to.unitNo, actor: a }), '모델명');
        if (r.ok) {
          await reload(true);
          toast.show('옮겼어요.');
        }
        return r.ok;
      }),
    [confirmId, reload, runUnitAction, serial, toast],
  );
  const removeOrphan = useCallback(
    (u: SalesUnitRow): Promise<boolean> =>
      serial(async () => {
        const r = await runUnitAction((_acks, a) => deleteOrphanUnit({ confirmId, unitId: u.id, actor: a }), '모델명');
        if (r.ok) {
          await reload(true);
          toast.show('지웠어요.');
        }
        return r.ok;
      }),
    [confirmId, reload, runUnitAction, serial, toast],
  );

  // ───── 처리 상태·처리자·시각·비고·건 단위 체크 (③) ─────
  const saveWork = useCallback(
    (patch: WorkPatch, opts?: { refresh?: boolean }): Promise<boolean> =>
      serial(async () => {
        const who = await ensureActor();
        if (!who) return false;
        const cur = dataRef.current.work;
        try {
          const res = await saveSalesWork({ confirmId, expectedUpdatedAt: cur.updatedAt, patch, actor: who });
          if (res.ok) {
            const at = new Date().toISOString();
            setData((d) => {
              const checks = { ...d.work.checks };
              for (const ck of patch.checks ?? []) {
                if (ck.on) checks[ck.label] = { at, by: who };
                else delete checks[ck.label];
              }
              return {
                ...d,
                work: {
                  ...d.work,
                  ...(patch.status !== undefined ? { status: patch.status } : {}),
                  ...(patch.processors !== undefined ? { processors: patch.processors } : {}),
                  ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
                  ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
                  ...(patch.shippedAt !== undefined ? { shippedAt: patch.shippedAt } : {}),
                  ...(patch.note !== undefined ? { note: patch.note } : {}),
                  checks,
                  updatedAt: res.workUpdatedAt,
                },
              };
            });
            if (opts?.refresh) await reload(true);
            return true;
          }
          if (res.conflict) {
            toast.warn('다른 사람이 방금 고쳤어요 — 새로 불러왔어요. 다시 한 번 해 주세요.');
            await reload(true);
          } else {
            toast.warn(`저장하지 못했어요 — ${res.error}`);
          }
          return false;
        } catch (e) {
          toast.warn(`저장하지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
          return false;
        }
      }),
    [confirmId, ensureActor, reload, serial, toast],
  );

  async function ackChange() {
    const who = await ensureActor();
    if (!who) return;
    setAckBusy(true);
    try {
      const res = await acknowledgeSalesConfirmChange({ id: confirmId, ver: c.ver, payloadHash: data.payloadHash, actor: who });
      if (res.ok) setData((d) => ({ ...d, salesChanged: null, work: { ...d.work, updatedAt: res.workUpdatedAt } }));
      else if (res.conflict) {
        toast.warn('다른 사람이 방금 고쳤어요 — 새로 불러왔어요.');
        await reload(true);
      } else toast.warn(`확인함으로 바꾸지 못했어요 — ${res.error}`);
    } catch (e) {
      toast.warn(`확인함으로 바꾸지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setAckBusy(false);
    }
  }

  // ───── 라이선스 키(잠금·대장) ─────
  const [lic, setLic] = useState<{ state: ConfirmLicenseState | null; loading: boolean; error: string }>({
    state: null,
    loading: hasSoftware,
    error: '',
  });
  const loadLicense = useCallback(async () => {
    setLic((l) => ({ ...l, loading: true, error: '' }));
    try {
      const res = await getConfirmLicenseState({ confirmId });
      if (res.ok) {
        setLic({ state: res.data, loading: false, error: '' });
        if (res.data.needContractsSql) setSqlB(true);
      } else {
        if ('needContractsSql' in res) setSqlB(true);
        setLic({ state: null, loading: false, error: res.error });
      }
    } catch {
      setLic({ state: null, loading: false, error: '키 상태를 읽지 못했어요.' });
    }
  }, [confirmId]);
  useEffect(() => {
    if (hasSoftware) void loadLicense();
  }, [hasSoftware, loadLicense]);

  const [unlockReq, setUnlockReq] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const unlockPromise = useRef<Promise<boolean> | null>(null);
  const askUnlock = useCallback((): Promise<boolean> => {
    if (unlockPromise.current) return unlockPromise.current;
    const p = new Promise<boolean>((resolve) =>
      setUnlockReq({
        resolve: (ok) => {
          unlockPromise.current = null;
          resolve(ok);
        },
      }),
    );
    unlockPromise.current = p;
    return p;
  }, []);

  const [clientReq, setClientReq] = useState<{ candidates: LedgerClientCandidate[]; resolve: (c: LedgerClientChoice | null) => void } | null>(null);
  const askClient = useCallback((candidates: LedgerClientCandidate[]) => {
    return new Promise<LedgerClientChoice | null>((resolve) => setClientReq({ candidates, resolve }));
  }, []);

  /** 키·대장 쓰기 — 잠겨 있으면 비밀번호 창, 거래처가 아직 없으면 거래처 고르기 창을 거쳐 같은 일을 다시 */
  const runLicense = useCallback(
    async (exec: (client: LedgerClientChoice | undefined) => Promise<LicenseActionResult<ConfirmLicenseState>>): Promise<ConfirmLicenseState | null> => {
      let client: LedgerClientChoice | undefined;
      for (let i = 0; i < 5; i++) {
        let res: LicenseActionResult<ConfirmLicenseState>;
        try {
          res = await exec(client);
        } catch {
          toast.warn('저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
          return null;
        }
        if (res.ok) {
          setLic({ state: res.data, loading: false, error: '' });
          return res.data;
        }
        if ('needUnlock' in res) {
          const ok = await askUnlock();
          if (!ok) {
            toast.warn('비밀번호를 풀지 않아서 저장하지 않았어요.');
            return null;
          }
          continue;
        }
        if ('needClient' in res) {
          const choice = await askClient(res.candidates);
          if (!choice) {
            toast.warn('거래처를 정하지 않아서 키는 저장하지 않았어요.');
            return null;
          }
          client = choice;
          continue;
        }
        if ('needContractsSql' in res) {
          setSqlB(true);
          toast.warn(res.error || '계약관리 SQL 을 먼저 실행해 주세요.');
          return null;
        }
        toast.warn(res.error || '저장하지 못했어요.');
        return null;
      }
      return null;
    },
    [askClient, askUnlock, toast],
  );

  const saveKey = useCallback(
    (ref: SlotRef, key: string): Promise<boolean> =>
      serial(async () => {
        const who = await ensureActor();
        if (!who) return false;
        const cur = findSlot(dataRef.current, ref)?.unit ?? null;
        const st = await runLicense((client) =>
          saveUnitLicenseKey({ confirmId, slotKey: ref.slotKey, unitNo: ref.unitNo, unitId: cur?.id ?? null, key, client, actor: who }),
        );
        if (!st) return false;
        // 서버가 ④ extra.ledgerPushed 를 쓰며 ④ updated_at 이 바뀜 → 다시 읽어야 다음 칸 저장이 가짜 충돌이 안 남(새 칸 행도 붙음)
        await reload(true);
        toast.show(key ? '키를 저장했어요.' : '키를 지웠어요.');
        return true;
      }),
    [confirmId, ensureActor, reload, runLicense, serial, toast],
  );

  const saveLineKey = useCallback(
    (itemIndex: number, key: string): Promise<boolean> =>
      serial(async () => {
        const who = await ensureActor();
        if (!who) return false;
        const st = await runLicense((client) => saveLineLicenseKey({ confirmId, itemIndex, key, client, actor: who }));
        if (!st) return false;
        await reload(true);
        toast.show('모든 칸에 같은 키를 저장했어요.');
        return true;
      }),
    [confirmId, ensureActor, reload, runLicense, serial, toast],
  );

  const pushLedger = useCallback(
    (unitId: string) => {
      void serial(async () => {
        const who = await ensureActor();
        if (!who) return;
        const st = await runLicense((client) => pushUnitsToLedger({ confirmId, unitIds: [unitId], client, actor: who }));
        if (st) {
          await reload(true); // ④ updated_at 이 바뀌었으니 다시 읽음
          toast.show('대장에 올렸어요.');
        }
      });
    },
    [confirmId, ensureActor, reload, runLicense, serial, toast],
  );

  function onUnlockDone(ok: boolean) {
    unlockReq?.resolve(ok);
    setUnlockReq(null);
    if (ok) void loadLicense();
  }

  // ───── 화면용 계산 ─────
  const region = c.region.trim() || data.regionGuess || '';
  const regionGuessed = !c.region.trim() && !!data.regionGuess;

  const localProg = useMemo(() => {
    let f = 0;
    let t = 0;
    for (const l of data.lines) {
      if (!ITEM_KIND_RULES[l.kind].countsProgress) continue;
      for (const s of l.slots) {
        t += 1;
        if (unitFilled(l.kind, s.unit)) f += 1;
      }
    }
    return { filled: f, total: t };
  }, [data.lines]);
  // 서버가 센 값이 있으면 그것(저장할 때마다 화면 쪽 계산이 앞서 가므로 다시 읽을 때 맞춰짐)
  const { filled, total } = data.progress ?? localProg;

  const recheckSlots = useMemo(() => {
    let slots = 0;
    for (const l of data.lines) for (const s of l.slots) if (s.unackedDiffs.length > 0) slots += 1;
    return slots;
  }, [data.lines]);

  const dupAssets = useMemo(() => {
    const count = new Map<string, number>();
    for (const l of data.lines) {
      if (l.kind === 'software' || l.kind === 'maintenance') continue;
      for (const s of l.slots) {
        const a = s.unit?.assetId.trim().toUpperCase();
        if (a) count.set(a, (count.get(a) ?? 0) + 1);
      }
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([a]) => a));
  }, [data.lines]);

  const orphanTargets = useMemo((): OrphanTarget[] => {
    const out: OrphanTarget[] = [];
    for (const l of data.lines) {
      for (const s of l.slots) {
        if (s.unit && (s.unit.assetId || s.unit.serial || s.unit.actualModel || s.unit.note)) continue;
        out.push({ slotKey: s.slotKey, unitNo: s.unitNo, label: `${l.itemIndex + 1}번 품목 ${l.item.cat || '기타'} · ${s.unitNo}번 칸` });
      }
    }
    return out;
  }, [data.lines]);

  const keyStat = useMemo(() => {
    if (!lic.state) return null;
    const ids = new Set(data.lines.filter((l) => l.kind === 'software').flatMap((l) => l.slots.map((s) => s.unit?.id).filter(Boolean)));
    const have = lic.state.units.filter((u) => u.hasKey && ids.has(u.unitId)).length;
    const slots = data.lines.filter((l) => l.kind === 'software').reduce((n, l) => n + l.slots.length, 0);
    return { have, slots };
  }, [lic.state, data.lines]);

  const printedAt = data.work.printedAt;
  const printedVer = data.work.printedVer;
  const printStale = useMemo(() => {
    if (printedVer === null || printedVer === undefined) return false;
    if (c.ver > printedVer) return true;
    const t = printedAt ? Date.parse(printedAt) : NaN;
    if (!Number.isFinite(t)) return false;
    return data.lines.some((l) => l.slots.some((s) => s.unit && Date.parse(s.unit.updatedAt) > t + 2000));
  }, [c.ver, printedAt, printedVer, data.lines]);

  const confirmChecks = data.checklist.filter((i) => i.grp === CHECK_GROUP_PER_CONFIRM);
  const checkItemsFor = (line: SalesSlotLine): { label: string }[] => {
    const g = checkGroupFor(line.kind, line.item.cat);
    return g ? data.checklist.filter((i) => i.grp === g) : [];
  };

  function scrollToSlot(itemIndex: number, unitNo: number) {
    const el = document.getElementById(slotDomId(itemIndex, unitNo));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.querySelector<HTMLElement>('input:not([disabled])')?.focus({ preventScroll: true });
  }
  function goNextEmpty() {
    for (const l of data.lines) {
      if (!ITEM_KIND_RULES[l.kind].countsProgress) continue;
      for (const s of l.slots) {
        if (!unitFilled(l.kind, s.unit)) {
          scrollToSlot(l.itemIndex, s.unitNo);
          return;
        }
      }
    }
    toast.show('비어 있는 칸이 없어요.');
  }
  function goRecheck() {
    for (const l of data.lines) {
      for (const s of l.slots) {
        if (s.unackedDiffs.length > 0) {
          scrollToSlot(l.itemIndex, s.unitNo);
          return;
        }
      }
    }
  }

  // ───── 상태·시각 ─────
  const status = data.work.status;
  const processorOptions = [...data.people, ...data.work.processors.filter((p) => !data.people.includes(p))];

  async function setStatus(s: SalesConfirmStatus) {
    if (s === status) return;
    await saveWork({ status: s }, { refresh: true });
  }
  async function stamp(which: 'startedAt' | 'finishedAt') {
    const now = new Date().toISOString();
    const patch: WorkPatch = which === 'startedAt' ? { startedAt: now } : { finishedAt: now };
    if (which === 'startedAt' && status === '접수') patch.status = '준비중';
    if (which === 'finishedAt' && (status === '접수' || status === '준비중')) patch.status = '준비완료';
    await saveWork(patch);
  }
  async function editTime(which: 'startedAt' | 'finishedAt' | 'shippedAt', v: string) {
    const iso = fromKstInput(v);
    if (!iso) return; // 지운 값은 보내지 않음(그대로)
    const cur = data.work[which];
    if (cur && Date.parse(cur) === Date.parse(iso)) return;
    await saveWork({ [which]: iso } as WorkPatch);
  }
  function toggleProcessor(name: string) {
    const list = data.work.processors.includes(name) ? data.work.processors.filter((p) => p !== name) : [...data.work.processors, name];
    void saveWork({ processors: list });
  }

  const [noteDraft, setNoteDraft] = useState(data.work.note);
  const noteBase = useRef(data.work.note);
  useEffect(() => {
    if (noteDraft === noteBase.current) setNoteDraft(data.work.note);
    noteBase.current = data.work.note;
    // 서버 값이 바뀌었을 때만 따라감
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.work.note]);

  const contactRows: [string, string][] = [
    ['대표번호', c.contacts.phone],
    ['IT담당', c.contacts.manager],
    ['계약담당', c.contacts.contractor],
    ['현장 상주', c.contacts.resident],
    ['결제담당', c.contacts.payer],
  ];
  const hasReplace = !!c.replaceInfo && (!isBlank(c.replaceInfo.before) || !isBlank(c.replaceInfo.after));
  const bulkLine = bulk ? data.lines.find((l) => l.itemIndex === bulk.itemIndex) : undefined;

  const licenseHead = (() => {
    if (!hasSoftware) return null;
    if (sqlB) return <span className="sc-pill sc-pill-amber">계약관리 SQL 실행 필요</span>;
    if (lic.loading) return <span className="sc-muted">키 상태 읽는 중…</span>;
    if (!lic.state) {
      return (
        <span className="sc-lock-head">
          <span className="sc-pill sc-pill-gray">키 상태를 못 읽었어요</span>
          <button type="button" className="sc-link" onClick={() => void loadLicense()}>
            다시 읽기
          </button>
        </span>
      );
    }
    if (lic.state.unlocked) {
      const left = minutesText(lic.state.unlockMinutesLeft);
      return <span className="sc-pill sc-pill-new">🔓 라이선스 키 열림{left ? ` (${left} 남음)` : ''}</span>;
    }
    return (
      <span className="sc-lock-head">
        <span className="sc-pill sc-pill-gray">🔒 라이선스 키 잠김</span>
        <button type="button" className="sc-link" onClick={() => void askUnlock()}>
          열기
        </button>
      </span>
    );
  })();

  return (
    <div className={`app sc-page sc-detail${reloading ? ' ct-refreshing' : ''}`}>
      {/* ── 머리 ── */}
      <section className="panel sc-dh">
        <div className="sc-dh-top">
          <Link href={confirmFormViewHref('sales')} className="btn btn-ghost sc-btn">
            ← 목록
          </Link>
          <span className="sc-dh-top-right">
            {docUrl && (
              <a className="btn btn-ghost sc-btn" href={docUrl} target="_blank" rel="noopener noreferrer">
                영업 원본 열기 ↗
              </a>
            )}
            <button type="button" className="btn btn-primary sc-pc-only" onClick={() => setPrintOpen(true)}>
              🖨 확인서 출력
            </button>
            <span className="sc-phone-only sc-muted">출력은 PC에서 해 주세요.</span>
          </span>
        </div>

        <div className={`sc-region-band${region ? '' : ' none'}`}>
          <span className="sc-region-big">{region || '지역 없음'}</span>
          {regionGuessed && <span className="sc-region-guess">주소로 추정한 지역(영업이 비워 뒀어요)</span>}
        </div>

        <div className="sc-dh-title">
          <div>
            <h2>{c.company || '(상호 없음)'}</h2>
            <div className="sc-dh-sub">
              {c.docNo || '-'} · 영업 v{c.ver} · {c.type || '-'}
              {c.term ? ` · ${c.term}` : ''}
            </div>
          </div>
          <span className={`sc-status-tag ${statusClass(status)}`}>{status}</span>
        </div>

        <div className="sc-dh-badges">
          <span className="sc-pill sc-pill-indigo">납품/교체일 {fmtDate(c.deliveryDate)}</span>
          {total > 0 && (
            <span className={`sc-prog${filled >= total ? ' done' : filled > 0 ? ' part' : ''}`}>
              자산 {filled}/{total}
            </span>
          )}
          {keyStat && keyStat.slots > 0 && (
            <span className={`sc-prog${keyStat.have >= keyStat.slots ? ' done' : keyStat.have > 0 ? ' part' : ''}`}>
              키 {keyStat.have}/{keyStat.slots}
            </span>
          )}
          {printedVer !== null && printedVer !== undefined && (
            <span className={`sc-pill ${printStale ? 'sc-pill-amber' : 'sc-pill-indigo'}`}>
              {printStale
                ? `v${printedVer} 출력 뒤 바뀌었어요 — 다시 뽑기`
                : `v${printedVer} 출력함 ${fmtDateTime(printedAt)}${data.work.printedBy ? ` · ${data.work.printedBy}` : ''}`}
            </span>
          )}
          {licenseHead}
        </div>

        <div className="sc-dh-grid">
          <Info label="접수자" value={c.savedBy} />
          <Info label="영업담당" value={c.salesRep} />
          <Info label="유입담당" value={c.inflow} />
          {c.leaseNo && <Info label="임대 번호" value={c.leaseNo} />}
          <Info label="주소" value={c.address} wide />
          {contactRows.map(([k, v]) => (
            <Info key={k} label={k} value={v} tel />
          ))}
          {c.reason && <Info label="사유" value={c.reason} wide />}
        </div>
        <div className="sc-dh-foot sc-muted">
          처음 받은 때 {fmtDateTime(data.firstSeenAt)}
          {data.changedAt ? ` · 영업이 고친 때 ${fmtDateTime(data.changedAt)}` : ''} · 마지막으로 받은 때 {fmtDateTime(data.fetchedAt)} · 받아 둔 버전 {data.versionCount}개 · 이름:{' '}
          <b>{actor || '아직 없어요'}</b>{' '}
          <button type="button" className="sc-link" onClick={changeName}>
            {actor ? '바꾸기' : '적기'}
          </button>
        </div>
      </section>

      {/* ── 띠들 ── */}
      {(data.notices ?? []).map((n, i) => (
        <div key={i} className="ct-band warn" role="alert">
          <span>{n}</span>
        </div>
      ))}
      {!data.schemaReady && (
        <div className="ct-band warn" role="alert">
          <span>
            <b>SQL 실행 필요</b> — 기기 칸 저장에 쓰는 표 칸이 아직 없어요. 영업 확인서 SQL(supabase/sales_confirms_schema.sql 맨 끝 블록)을 실행하기 전에는 아래 칸을 고칠 수 없어요(보기만 돼요).
          </span>
        </div>
      )}
      {data.schemaReady && sqlNeeded && (
        <div className="ct-band warn" role="alert">
          <span>
            <b>SQL 실행 필요</b> — 저장하려고 했더니 표 칸이 아직 없다고 해요. SQL 실행 뒤 이 화면을 새로고침해 주세요.
          </span>
        </div>
      )}
      {sqlB && hasSoftware && (
        <div className="ct-band warn" role="alert">
          <span>
            <b>계약관리 SQL 실행 필요</b> — 라이선스 키를 계약관리 대장에 쌓는 표 설정이 아직 안 됐어요. 키 저장만 막혀 있고 나머지는 그대로 적을 수 있어요.
          </span>
        </div>
      )}
      {data.salesChanged && (
        <SalesChangeBanner
          change={data.salesChanged}
          versionCount={data.versionCount}
          docUrl={data.docUrl}
          changes={data.changes}
          busy={ackBusy}
          onAck={() => void ackChange()}
        />
      )}
      {c.type !== '납품' && c.type && (
        <div className="ct-band muted">
          <span>{c.type} 확인서예요. 칸 입력은 지금 되지만, 종이 출력은 영업 최신 양식을 받은 뒤에 열려요.</span>
        </div>
      )}
      {recheckSlots > 0 && (
        <div className="ct-band warn" role="status">
          <span>영업 요청이 바뀌어 다시 확인할 칸이 {recheckSlots}개 있어요. 칸의 [확인]을 눌러 주세요(값은 안 바뀌어요).</span>
          <button type="button" className="btn btn-ghost sc-btn" onClick={goRecheck}>
            첫 칸으로 →
          </button>
        </div>
      )}

      {/* ── 처리 상태 ── */}
      <section className="panel sc-work">
        <div className="sc-sec-title">처리 상태</div>
        <div className="chip-group sc-status-chips" role="group" aria-label="처리여부">
          {SALES_CONFIRM_STATUSES.map((s) => (
            <button key={s} type="button" className={`chip${status === s ? ' active' : ''}`} aria-pressed={status === s} onClick={() => void setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="sc-work-row">
          <span className="filter-label">처리자</span>
          <div className="chip-group">
            {processorOptions.length === 0 ? (
              <span className="sc-muted">명단이 비어 있어요. 출고 준비의 [담당자 관리]에서 먼저 넣어 주세요.</span>
            ) : (
              processorOptions.map((p) => (
                <button key={p} type="button" className={`chip${data.work.processors.includes(p) ? ' active' : ''}`} aria-pressed={data.work.processors.includes(p)} onClick={() => toggleProcessor(p)}>
                  {p}
                </button>
              ))
            )}
          </div>
        </div>
        <div className="sc-times">
          <TimeField label="시작" iso={data.work.startedAt} onNow={() => void stamp('startedAt')} onEdit={(v) => void editTime('startedAt', v)} />
          <TimeField label="끝" iso={data.work.finishedAt} onNow={() => void stamp('finishedAt')} onEdit={(v) => void editTime('finishedAt', v)} />
          <TimeField label="출고" iso={data.work.shippedAt} onEdit={(v) => void editTime('shippedAt', v)} />
        </div>
      </section>

      {/* ── 품목별 카드 ── */}
      {data.lines.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <div>📦</div>
            <div>영업이 적은 품목이 없어요.</div>
          </div>
        </div>
      ) : (
        data.lines.map((line) => {
          const item = line.item;
          const kind: ItemKind = line.kind;
          const specChips: [string, string][] = [
            ...SALES_SPEC_KEYS.filter((k) => (item.spec[k] ?? '').trim()).map((k): [string, string] => [k, item.spec[k] ?? '']),
            ...Object.entries(item.specExtra ?? {}),
          ];
          const firstSnap = line.slots.find((s) => s.unit?.itemSnapshot)?.unit?.itemSnapshot ?? null;
          const snapText = (it: { cat: string; maker: string; model: string } | null) => (it ? [it.cat, it.maker, it.model].filter(Boolean).join(' ') || '(비어 있음)' : '');
          return (
            <section key={line.itemIndex} className="panel sc-line">
              <div className="sc-line-head">
                <div className="sc-line-title">
                  <span className="sc-line-no">{line.itemIndex + 1}</span>
                  <b>{item.cat || '기타'}</b>
                  <span>{[item.maker, item.model].filter(Boolean).join(' ') || '(모델 미정)'}</span>
                  {item.state && <span className="sc-pill sc-pill-gray">{item.state}</span>}
                  <span className="sc-pill sc-pill-indigo">수량 {item.qty}</span>
                  <span className="sc-pill sc-pill-gray">{ITEM_KIND_LABEL[kind]}</span>
                </div>
                <div className="sc-line-btns">
                  {kind === 'device' && hasSpec(item.cat) && line.slots.length > 0 && (
                    <button type="button" className="btn btn-ghost sc-btn" disabled={unitsDisabled} onClick={() => setBulk({ mode: 'spec', itemIndex: line.itemIndex })}>
                      이 품목 사양 한꺼번에
                    </button>
                  )}
                  {kind === 'software' && (
                    <>
                      <button type="button" className="btn btn-ghost sc-btn" disabled={unitsDisabled} onClick={() => setBulk({ mode: 'software', itemIndex: line.itemIndex })}>
                        제품명 한꺼번에
                      </button>
                      <button type="button" className="btn btn-ghost sc-btn" disabled={unitsDisabled || sqlB} onClick={() => setBulk({ mode: 'key', itemIndex: line.itemIndex })}>
                        같은 키를 모든 칸에
                      </button>
                    </>
                  )}
                </div>
              </div>
              {(specChips.length > 0 || item.place) && (
                <div className="sc-line-req">
                  <span className="sc-muted">영업 요청</span>
                  {specChips.length > 0 && (
                    <span className="sc-specs">
                      {specChips.map(([k, v]) => (
                        <span key={k} className="sc-spec">
                          <b>{k}</b> {v}
                        </span>
                      ))}
                    </span>
                  )}
                  {item.place && <span className="sc-line-place">설치장소·요청: {item.place}</span>}
                </div>
              )}
              {line.snapshotChanged && (
                <div className="ct-band warn sc-snap-band" role="status">
                  <span>
                    영업 품목이 바뀌었어요{firstSnap ? `: 전 ${snapText(firstSnap)} → 지금 ${snapText(item)}` : ''}. 적어 둔 출고 값은 그대로예요. 확인하고 [확인함]을 눌러 주세요.
                  </span>
                  <button type="button" className="btn btn-ghost sc-btn" disabled={unitsDisabled} onClick={() => onAckSnapshot(line)}>
                    확인함
                  </button>
                </div>
              )}
              {line.slots.length === 0 ? (
                <div className="detail-empty sc-line-empty">수량이 0이라 기기 칸이 없어요.</div>
              ) : (
                <div className="sc-slots">
                  {line.slots.map((slot) =>
                    kind === 'software' ? (
                      <SoftwareSlotCard
                        key={`${slot.slotKey}-${slot.unitNo}`}
                        line={line}
                        slot={slot}
                        disabled={unitsDisabled}
                        saveUnit={saveUnit}
                        onRecheck={recheck}
                        licState={lic.state?.units.find((u) => u.unitId === slot.unit?.id)}
                        clientName={lic.state?.clientName ?? null}
                        unlocked={lic.state ? lic.state.unlocked : null}
                        licLoading={lic.loading}
                        licError={lic.error}
                        needContractsSql={sqlB}
                        onUnlock={() => void askUnlock()}
                        onRetryLicense={() => void loadLicense()}
                        onSaveKey={(s, key) => saveKey({ itemIndex: line.itemIndex, slotKey: s.slotKey, unitNo: s.unitNo }, key)}
                        onPushLedger={pushLedger}
                      />
                    ) : (
                      <DeviceSlotCard
                        key={`${slot.slotKey}-${slot.unitNo}`}
                        line={line}
                        slot={slot}
                        kind={kind}
                        disabled={unitsDisabled}
                        saveUnit={saveUnit}
                        lookupAsset={lookupAsset}
                        onRecheck={recheck}
                        checkItems={checkItemsFor(line)}
                        dupAsset={!!slot.unit && dupAssets.has(slot.unit.assetId.trim().toUpperCase())}
                        assetElsewhere={data.assetElsewhere}
                      />
                    ),
                  )}
                </div>
              )}
            </section>
          );
        })
      )}

      <OrphanPanel orphans={data.orphans} targets={orphanTargets} disabled={unitsDisabled} onMove={moveOrphan} onDelete={removeOrphan} />

      {/* ── 건 단위 ── */}
      <section className="panel sc-whole">
        <div className="sc-sec-title">소모품</div>
        {c.supplies.length === 0 ? (
          <div className="detail-empty">소모품이 없어요.</div>
        ) : (
          <div className="sc-scroll">
            <table className="m-cards sc-mini">
              <thead>
                <tr>
                  <th data-m="title">이름</th>
                  <th data-m="badge">수량</th>
                  <th data-m="inline" data-label="">
                    무상/청구
                  </th>
                  <th data-m="full" data-label="메모">
                    메모
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.supplies.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name || '-'}</td>
                    <td>{s.qty}</td>
                    <td>{s.charge || '-'}</td>
                    <td>{s.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="sc-sec-title">특이사항 (영업이 적은 것)</div>
        {c.special.trim() ? <div className="sc-pre">{c.special}</div> : <div className="detail-empty">적힌 특이사항이 없어요.</div>}

        {hasReplace && c.replaceInfo && (
          <>
            <div className="sc-sec-title">교체 내용 (회수할 기존 기기 — 보기만)</div>
            <div className="sc-replace">
              <div>
                <div className="detail-label">교체 전</div>
                <UnknownValue value={c.replaceInfo.before} />
              </div>
              <div>
                <div className="detail-label">교체 후</div>
                <UnknownValue value={c.replaceInfo.after} />
              </div>
            </div>
          </>
        )}

        {confirmChecks.length > 0 && (
          <>
            <div className="sc-sec-title">기타 출고 체크 (건 전체)</div>
            <ChecklistPanel
              items={confirmChecks}
              checks={data.work.checks}
              title="랜선·공유기 등"
              defaultOpen
              onToggle={(label, on) => saveWork({ checks: [{ label, on }] })}
            />
          </>
        )}

        <div className="sc-sec-title">비고 (IT 메모)</div>
        <textarea
          className="sc-in sc-note-area"
          rows={2}
          value={noteDraft}
          placeholder="이 건에 대해 남길 말"
          aria-label="비고"
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => {
            if (noteDraft.trim() !== noteBase.current.trim()) void saveWork({ note: noteDraft.trim() });
          }}
        />
      </section>

      <PrepHintBox hints={data.prepHints} />

      {/* ── 핸드폰 아래 고정 막대 ── */}
      <div className="sc-fixbar">
        <select className={`sc-status ${statusClass(status)}`} value={status} aria-label="처리여부" onChange={(e) => void setStatus(e.target.value as SalesConfirmStatus)}>
          {SALES_CONFIRM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={goNextEmpty}>
          다음 빈 칸 ↓
        </button>
      </div>

      {/* ── 창들 ── */}
      {ackReq && (
        <DiffConfirmDialog
          items={ackReq.items}
          modelLabel={ackReq.modelLabel}
          onConfirm={() => {
            ackReq.resolve(true);
            setAckReq(null);
          }}
          onRedo={() => {
            ackReq.resolve(false);
            setAckReq(null);
          }}
        />
      )}
      {clientReq && (
        <LedgerClientDialog
          company={c.company}
          candidates={clientReq.candidates}
          onPick={(choice) => {
            clientReq.resolve(choice);
            setClientReq(null);
          }}
          onCancel={() => {
            clientReq.resolve(null);
            setClientReq(null);
          }}
        />
      )}
      {unlockReq && <LicenseUnlockDialog onDone={onUnlockDone} />}
      {bulk && bulkLine && (
        <LineBulkDialog
          mode={bulk.mode}
          line={bulkLine}
          onClose={() => setBulk(null)}
          onApplyValues={(values) => applyLine(bulk.itemIndex, values)}
          onApplyKey={(key) => saveLineKey(bulk.itemIndex, key)}
        />
      )}
      {printOpen && (
        <SalesPrintDialog
          detail={data}
          license={lic.state}
          hasSoftware={hasSoftware}
          onUnlock={askUnlock}
          actor={actor}
          ensureActor={ensureActor}
          onClose={() => setPrintOpen(false)}
          onWarn={toast.warn}
          onPrinted={(info) =>
            setData((d) => ({
              ...d,
              work: { ...d.work, printedAt: info.at, printedVer: info.ver, printedBy: info.by, updatedAt: info.workUpdatedAt },
            }))
          }
        />
      )}
      {nameDialog}
      {toastNode}
    </div>
  );
}

// ───────────────────────── 작은 부품 ─────────────────────────

function Info({ label, value, wide, tel }: { label: string; value: string; wide?: boolean; tel?: boolean }) {
  const v = (value ?? '').trim();
  let body: ReactNode = v || '-';
  if (tel && v) {
    // "IT담당 홍길동 010-1234-5678" 처럼 이름이 같이 올 수 있어 첫 전화번호 꼴만 링크로
    const m = v.match(/\+?\d[\d\s-]{6,}\d/);
    const num = m ? m[0].replace(/[^\d+]/g, '') : '';
    body =
      num.length >= 8 ? (
        <a className="sc-tel" href={`tel:${num}`}>
          {v}
        </a>
      ) : (
        v
      );
  }
  return (
    <div className={`sc-info${wide ? ' wide' : ''}${v ? '' : ' empty'}`}>
      <span className="detail-label">{label}</span>
      <span className="detail-value">{body}</span>
    </div>
  );
}

function TimeField({ label, iso, onNow, onEdit }: { label: string; iso: string | null; onNow?: () => void; onEdit: (v: string) => void }) {
  const [v, setV] = useState(toKstInput(iso));
  useEffect(() => setV(toKstInput(iso)), [iso]);
  return (
    <div className="sc-time">
      <label>{label}</label>
      <input type="datetime-local" className="sc-in" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onEdit(v)} />
      {onNow && (
        <button type="button" className="btn btn-ghost sc-btn" onClick={onNow}>
          지금
        </button>
      )}
    </div>
  );
}
