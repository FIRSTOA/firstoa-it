'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { acknowledgeSalesConfirmChange } from '@/app/confirm-form/salesActions';
import {
  ackSnapshot,
  ackUnitDiffs,
  addSalesUnit,
  applyLineValues,
  deleteOrphanUnit,
  lookupSalesUnitAsset,
  moveOrphanUnit,
  openSalesConfirm,
  removeAddedSalesUnit,
  saveSalesUnit,
  saveSalesWork,
} from '@/app/confirm-form/salesDetailActions';
import { getConfirmLicenseState, pushUnitsToLedger, saveLineLicenseKey, saveUnitLicenseKey } from '@/app/confirm-form/salesLicenseActions';
import { ITEM_KIND_RULES, checkGroupFor } from '@/lib/salesConfirms/itemKind';
import { addLineAllowed, unackedDiffsFor, unitHasContent } from '@/lib/salesConfirms/slots';
import { lineMakerState } from '@/lib/salesConfirms/specLine';
import {
  CHECK_GROUP_PER_CONFIRM,
  SALES_CONFIRM_STATUSES,
  SALES_SPEC_KEYS,
  confirmFormViewHref,
  isOtherSalesType,
  type ConfirmLicenseState,
  type DiffItem,
  type LedgerClientCandidate,
  type LedgerClientChoice,
  type LicenseActionResult,
  type SalesConfirmDetailData,
  type SalesConfirmItem,
  type SalesConfirmStatus,
  type SalesPrintMode,
  type SalesSlot,
  type SalesSlotLine,
  type SalesSpec,
  type SalesUnitRow,
  type SalesUnitSaveResult,
} from '@/lib/salesConfirms/types';
import ChecklistPanel from './ChecklistPanel';
import DiffConfirmDialog from './DiffConfirmDialog';
import {
  minutesText,
  slotDomId,
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
import PrepLinkPanel from './PrepLinkPanel';
import SalesChangeBanner from './SalesChangeBanner';
import SalesPrintDialog, { syncSalesConfirmOne } from './SalesPrintDialog';
import { useSalesActor, useSalesToast } from './salesUi';
import SlotLineBlock from './SlotLineBlock';
import type { LicenseProps } from './SlotTableRows';
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
  /** 출력 창 — null = 닫힘, 'fill' = 🖨 확인서 출력, 'original' = 영업 원본 보기(E22) */
  const [printMode, setPrintMode] = useState<SalesPrintMode | null>(null);
  const printOpenRef = useRef(false);
  printOpenRef.current = printMode !== null;
  const [bulk, setBulk] = useState<{ mode: LineBulkMode; itemIndex: number } | null>(null);
  /** 영업이 고쳤는데 입력 중이라 다시 읽지 않고 기다리는 중 → "영업이 방금 고쳤어요 [새로 보기]" 띠 */
  const [salesPending, setSalesPending] = useState(false);

  const c = data.confirm;
  /**
   * 따로 보는 종류(철수·이전·판매 — 2026-11-27 사용자 "별도의 항목으로만 우선 보이게"): 출고 준비 대상이 아님 →
   * 기기 칸 카드·체크리스트·출고 준비 후보·🖨 확인서 출력 없음. 영업 값 보기 + 영업 원본 보기(영업 실시간 HTML)만. 1분 동기화는 그대로.
   */
  const isOther = isOtherSalesType(c.type) || !!c.otherRenderer;
  /** 영업에서 지운 확인서(normalize salesDeleted — 설계 E26·E27). 입력·저장은 막지 않음 */
  const salesDeleted = c.salesDeleted === true;
  const isSwap = !isOther && (c.renderer === 'swap' || c.type === '교체');
  const hasSoftware = !isOther && data.lines.some((l) => l.kind === 'software');
  const schemaOk = data.schemaReady && !sqlNeeded;
  const unitsDisabled = !schemaOk;

  // ───── 다시 읽기(읽은 새 데이터를 돌려줌 — 출력 창이 새 판으로 그릴 때 씀) ─────
  const reload = useCallback(
    async (quiet = false): Promise<SalesConfirmDetailData | null> => {
      setReloading(true);
      try {
        const res = await openSalesConfirm({ id: confirmId, actor: actorRef.current });
        if (res.ok) {
          setData(res.data);
          setSalesPending(false); // 새로 읽었으니 영업 최신 판이 들어옴
          return res.data;
        }
        if (!quiet) toast.warn(`다시 읽지 못했어요 — ${res.error}`);
        return null;
      } catch (e) {
        if (!quiet) toast.warn(`다시 읽지 못했어요 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
        return null;
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

  // 저장·확인 뒤 돌아온 칸을 붙임 — "요청과 다름"은 서버와 같은 순수 함수로 그 칸만 다시 계산(저장은 더는 확인을 겸하지 않음, 2026-11-27)
  const applyUnits = useCallback((units: SalesUnitRow[]) => {
    setData((d) => ({
      ...d,
      lines: d.lines.map((l) => ({
        ...l,
        slots: l.slots.map((s) => {
          const u = units.find((x) => x.slotKey === s.slotKey && x.unitNo === s.unitNo);
          return u ? { ...s, unit: u, unackedDiffs: unackedDiffsFor(l.kind, l.item, u) } : s;
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

  // 칸의 "요청과 다름" [확인] — 인쇄 전에 미리 확인하고 싶을 때(안 눌러도 인쇄 때 한 번에 물음)
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
    (itemIndex: number, values: { specOverride?: SalesSpec; actualModel?: string; actualMaker?: string }, doneText = '모든 칸에 적용했어요.'): Promise<boolean> =>
      serial(async () => {
        const r = await runUnitAction((acks, who) => applyLineValues({ confirmId, itemIndex, values, acks, actor: who }), modelLabelOf(itemIndex));
        if (r.ok) {
          await reload(true); // 칸 행이 새로 만들어졌을 수 있어서
          toast.show(doneText);
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

  // ───── `＋ 줄 추가` · `✕ 줄 빼기` (2026-11-27 사용자 결정 — 영업 수량보다 더 내보내는 기기) ─────
  const [addingLine, setAddingLine] = useState<number | null>(null);
  function addLine(line: SalesSlotLine) {
    if (addingLine !== null) return;
    setAddingLine(line.itemIndex);
    // 품목 한 칸 제조사가 모든 줄에 같게 적혀 있으면 새 줄에도 같은 제조사(안 하면 새 줄만 종이에 영업 요청 제조사로 나감)
    const maker = lineMakerState(line.slots.map((s) => s.unit));
    void serial(async () => {
      try {
        const r = await runUnitAction(
          (_acks, who) => addSalesUnit({ confirmId, itemIndex: line.itemIndex, actor: who }),
          modelLabelOf(line.itemIndex),
        );
        if (!r.ok) return;
        const fresh = await reload(true);
        // 새 칸(그 줄의 마지막 추가 칸)
        const added = fresh?.lines.find((l) => l.itemIndex === line.itemIndex)?.slots.filter((s) => s.added) ?? [];
        const last = added[added.length - 1];
        if (last && maker.values.length === 1 && maker.blank === 0 && !(last.unit?.actualMaker ?? '').trim()) {
          // 저장 줄 안이라 saveUnit(줄 세우기)을 부르면 서로 기다림 — 같은 저장 길(runUnitAction)을 바로 부름
          await runUnitAction(
            (acks, who) =>
              saveSalesUnit({
                confirmId,
                slotKey: last.slotKey,
                unitNo: last.unitNo,
                unitId: last.unit?.id ?? null,
                expectedUpdatedAt: last.unit?.updatedAt ?? null,
                patch: { actualMaker: maker.value },
                acks,
                actor: who,
              }),
            modelLabelOf(line.itemIndex),
          );
        }
        toast.show('줄을 하나 더했어요 — 자산번호를 적어 주세요.');
        // 새 칸으로 — 그려진 뒤에
        if (last) window.setTimeout(() => scrollToSlot(line.itemIndex, last.unitNo), 60);
      } finally {
        setAddingLine(null);
      }
    });
  }
  function removeLine(line: SalesSlotLine, slot: SalesSlot) {
    const u = slot.unit;
    if (!u || !slot.added) return;
    // 제조사는 품목 한 칸(줄 추가 때 저절로 따라 적힘)이라 줄에 적은 값으로 안 셈
    if (unitHasContent({ ...u, actualMaker: '' })) {
      const what = u.assetId ? `자산번호 ${u.assetId} 등 ` : '';
      if (!window.confirm(`${line.item.cat || '기타'} ${slot.unitNo}번(추가한 줄)에 적은 ${what}값도 같이 지워져요. 이 줄을 뺄까요?`)) return;
    }
    void serial(async () => {
      // 저장 줄 뒤에서 — 방금 저장한 값의 updated_at 으로
      const cur = findSlot(dataRef.current, { itemIndex: line.itemIndex, slotKey: slot.slotKey, unitNo: slot.unitNo })?.unit ?? u;
      const r = await runUnitAction(
        (_acks, who) => removeAddedSalesUnit({ confirmId, unitId: cur.id, expectedUpdatedAt: cur.updatedAt, actor: who }),
        modelLabelOf(line.itemIndex),
      );
      if (r.ok) {
        await reload(true);
        toast.show('줄을 뺐어요.');
      }
    });
  }

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

  /** 소프트웨어 표 줄의 라이선스 키·대장(예전 SoftwareSlotCard 에 넘기던 것 그대로) */
  const licenseProps = useMemo(
    (): LicenseProps => ({
      stateFor: (unitId) => (unitId ? lic.state?.units.find((u) => u.unitId === unitId) : undefined),
      clientName: lic.state?.clientName ?? null,
      unlocked: lic.state ? lic.state.unlocked : null,
      loading: lic.loading,
      error: lic.error,
      needSql: sqlB,
      onUnlock: () => void askUnlock(),
      onRetry: () => void loadLicense(),
      onSaveKey: saveKey,
      onPushLedger: pushLedger,
    }),
    [lic, sqlB, askUnlock, loadLicense, saveKey, pushLedger],
  );

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
        out.push({
          slotKey: s.slotKey,
          unitNo: s.unitNo,
          label: `${l.itemIndex + 1}번 품목 ${l.item.cat || '기타'} · ${s.unitNo}번 칸${s.added ? ' (추가한 줄)' : ''}`,
        });
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

  // 영업에서 지운 확인서 띠의 [처리여부를 '취소'로] — 처리여부 저장(saveWork: 동시 수정 검사·workUpdatedAt 갱신)과 같은 길. 자동으로는 안 바꿈(E27)
  const [cancelBusy, setCancelBusy] = useState(false);
  async function cancelDeleted() {
    if (cancelBusy || status === '취소') return;
    setCancelBusy(true);
    try {
      const ok = await saveWork({ status: '취소' }, { refresh: true });
      if (ok) toast.show("처리여부를 '취소'로 바꿨어요.");
    } finally {
      setCancelBusy(false);
    }
  }
  const deletedMeta = salesDeleted
    ? [c.deletedAt ? fmtDateTime(c.deletedAt) : '', (c.deletedBy ?? '').trim()].filter((v) => v && v !== '-').join(' · ')
    : '';
  const dateLabel = !isOther ? '납품/교체일' : ['판매', '철수', '이전'].includes(c.type.trim()) ? `${c.type.trim()}일` : '날짜';
  function toggleProcessor(name: string) {
    const list = data.work.processors.includes(name) ? data.work.processors.filter((p) => p !== name) : [...data.work.processors, name];
    void saveWork({ processors: list });
  }

  const [noteDraft, setNoteDraft] = useState(data.work.note);
  const noteDraftRef = useRef(noteDraft);
  noteDraftRef.current = noteDraft;
  const noteBase = useRef(data.work.note);
  useEffect(() => {
    if (noteDraft === noteBase.current) setNoteDraft(data.work.note);
    noteBase.current = data.work.note;
    // 서버 값이 바뀌었을 때만 따라감
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.work.note]);

  // ───── 영업 내용 동기화(E1) — 이 확인서 한 건만: 처음 그린 뒤 1번 · 화면이 보이는 동안 60초마다 · 탭으로 돌아왔을 때(60초 지났으면) ─────
  // 바뀌면 입력 중이 아닐 때 바로 다시 읽음("영업에서 수정됨" 띠가 뜸), 입력 중이면 [새로 보기] 띠만(적던 값은 그대로).
  // 출력 창이 열려 있는 동안은 출력 창이 스스로 받으므로 쉼. 오류는 조용히 다음 차례 — 3번 연달아면 회색 한 줄.
  /** 기기 칸 카드가 알려 주는 "저장값과 다른 초안이 있는 칸"(slotDomId) */
  const dirtySlots = useRef(new Set<string>());
  const onDirtyChange = useCallback((key: string, dirty: boolean) => {
    if (dirty) dirtySlots.current.add(key);
    else dirtySlots.current.delete(key);
  }, []);
  const isEditing = useCallback(
    () => dirtySlots.current.size > 0 || noteDraftRef.current.trim() !== noteBase.current.trim(),
    [],
  );
  const [salesMissing, setSalesMissing] = useState(false);
  const [syncProblem, setSyncProblem] = useState('');
  const syncBusy = useRef(false);
  const lastSyncAt = useRef(0);
  const syncFails = useRef(0);

  const syncFromSales = useCallback(async () => {
    if (syncBusy.current || printOpenRef.current) return;
    syncBusy.current = true;
    lastSyncAt.current = Date.now();
    try {
      const r = await syncSalesConfirmOne(confirmId, 'detail', 20_000);
      if (r.kind === 'skipped') return; // 방금 누가 받음 — 다음 차례에
      if (r.kind === 'fail') {
        syncFails.current += 1;
        if (syncFails.current >= 3) setSyncProblem(r.error);
        return;
      }
      syncFails.current = 0;
      setSyncProblem('');
      setSalesMissing(r.notFound);
      if (r.changed > 0) {
        if (isEditing()) {
          setSalesPending(true);
        } else {
          // 저장 줄 뒤에 세움 — 저장 중에 옛 값으로 덮어 가짜 충돌이 나지 않게.
          // 다시 읽기에 실패하면 다음 차례엔 "바뀐 것 없음"이라 조용히 묻히므로 [새로 보기] 띠로 남김
          const fresh = await serial(() => reload(true));
          if (!fresh) setSalesPending(true);
        }
      }
    } finally {
      syncBusy.current = false;
    }
  }, [confirmId, isEditing, reload, serial]);
  const syncRef = useRef(syncFromSales);
  syncRef.current = syncFromSales;

  useEffect(() => {
    const SYNC_MS = 60_000;
    void syncRef.current();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncRef.current();
    }, SYNC_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncAt.current >= SYNC_MS) void syncRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  async function showSalesUpdate() {
    const fresh = await serial(() => reload());
    if (fresh) toast.show('영업이 고친 내용을 불러왔어요.');
  }

  // 출력 창이 열 때 영업에서 새 판을 받았으면 — 입력 중이어도 새로 읽음(카드의 적던 칸은 그대로 남음)
  const reloadForPrint = useCallback(() => serial(() => reload(true)), [reload, serial]);

  // 교체: 현장상주 칸 = 교체 요청자(고객), 계약담당은 결제담당과 같은 값이 와서 같으면 숨김
  const contactRows: [string, string][] = [
    ['대표번호', c.contacts.phone],
    ['IT담당', c.contacts.manager],
    ...(isSwap && c.contacts.contractor.trim() === c.contacts.payer.trim() ? [] : [['계약담당', c.contacts.contractor] as [string, string]]),
    [isSwap ? '교체 요청자' : '현장 상주', c.contacts.resident],
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
            <button type="button" className="btn btn-ghost sc-btn" onClick={() => setPrintMode('original')}>
              영업 원본 보기
            </button>
            {!isOther && (
              <>
                <button type="button" className="btn btn-primary sc-pc-only" onClick={() => setPrintMode('fill')}>
                  🖨 확인서 출력
                </button>
                <span className="sc-phone-only sc-muted">출력은 PC에서 해 주세요.</span>
              </>
            )}
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
          <span className="sc-pill sc-pill-indigo">
            {dateLabel} {fmtDate(c.deliveryDate)}
          </span>
          {salesDeleted && <span className="sc-pill sc-pill-red">영업에서 지움</span>}
          {isOther && <span className="sc-pill sc-pill-gray">출고 준비 대상 아님</span>}
          {!isOther && total > 0 && (
            <span className={`sc-prog${filled >= total ? ' done' : filled > 0 ? ' part' : ''}`}>
              자산 {filled}/{total}
            </span>
          )}
          {keyStat && keyStat.slots > 0 && (
            <span className={`sc-prog${keyStat.have >= keyStat.slots ? ' done' : keyStat.have > 0 ? ' part' : ''}`}>
              키 {keyStat.have}/{keyStat.slots}
            </span>
          )}
          {!isOther && printedVer !== null && printedVer !== undefined && (
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
      {salesDeleted && (
        <div className="ct-band bad sc-del-band" role="alert">
          <span>
            <b>영업에서 이 확인서를 지웠어요</b>
            {deletedMeta ? `(${deletedMeta})` : ''} — 출고를 멈출지 영업에 확인하세요.
          </span>
          {status === '취소' ? (
            <span className="sc-del-done">취소로 바꿔 두었어요</span>
          ) : (
            <button type="button" className="btn btn-ghost sc-btn sc-del-btn" disabled={cancelBusy} onClick={() => void cancelDeleted()}>
              {cancelBusy ? '바꾸는 중…' : "처리여부를 '취소'로"}
            </button>
          )}
        </div>
      )}
      {data.directShip && (
        <div className="ct-band muted sc-direct-band" role="note">
          <span>
            <b>직송</b> — 매입처 {data.consignName || '(이름 없음)'} (우리 출고 준비 없음)
          </span>
        </div>
      )}
      {isOther && (
        <div className="ct-band muted" role="note">
          <span>철수·이전·판매 확인서는 지금은 보기만 해요(출고 준비 대상이 아니에요).</span>
        </div>
      )}
      {(data.notices ?? []).map((n, i) => (
        <div key={i} className="ct-band warn" role="alert">
          <span>{n}</span>
        </div>
      ))}
      {!isOther && !data.schemaReady && (
        <div className="ct-band warn" role="alert">
          <span>
            <b>SQL 실행 필요</b> — 기기 칸 저장에 쓰는 표 칸이 아직 없어요. 영업 확인서 SQL(supabase/sales_confirms_schema.sql 맨 끝 블록)을 실행하기 전에는 아래 칸을 고칠 수 없어요(보기만 돼요).
          </span>
        </div>
      )}
      {!isOther && data.schemaReady && sqlNeeded && (
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
      {salesPending && (
        <div className="ct-band warn" role="status">
          <span>영업이 방금 이 확인서를 고쳤어요. 적던 값은 그대로 있어요 — 다 적었으면 [새로 보기]를 눌러 주세요.</span>
          <button type="button" className="btn btn-primary sc-btn" disabled={reloading} onClick={() => void showSalesUpdate()}>
            새로 보기
          </button>
        </div>
      )}
      {data.salesChanged && (
        <SalesChangeBanner
          change={data.salesChanged}
          versionCount={data.versionCount}
          changes={data.changes}
          busy={ackBusy}
          onAck={() => void ackChange()}
          onViewOriginal={() => setPrintMode('original')}
        />
      )}
      {salesMissing && (
        <div className="ct-band muted sc-sync-line" role="status">
          <span>영업 웹앱에서 이 확인서를 못 찾았어요(종류가 바뀌었을 수 있어요). 아래는 마지막으로 받은 내용이에요.</span>
        </div>
      )}
      {syncProblem && !salesMissing && (
        <div className="ct-band muted sc-sync-line" role="status">
          <span>영업 웹앱에서 새 내용을 받지 못하고 있어요({syncProblem.replace(/[.。]\s*$/, '')}). 1분마다 다시 해 볼게요.</span>
        </div>
      )}
      {!isOther && recheckSlots > 0 && (
        <div className="ct-band warn" role="status">
          <span>
            영업 요청과 다른 칸이 {recheckSlots}개 있어요(노란 칸). 저장은 됐어요 — [🖨 확인서 출력]에서 [인쇄]를 누를 때 한 번에 확인해요.
          </span>
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
        {/* 따로 보는 종류: 처리자 명단을 안 읽고(work.ts) 출고 준비 시각도 없음 — 처리자는 목록에서 바꿈 */}
        {!isOther && (
          <>
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
            {/* 시작·끝·출고 시각 칸은 화면에서 뺌(2026-11-27 사용자) — 처리여부를 바꾸면 서버가 빈 시각을 저절로 적음(saveSalesWork) */}
          </>
        )}
        {isOther && data.work.processors.length > 0 && <div className="sc-muted">처리자: {data.work.processors.join(', ')} (목록에서 바꿔요)</div>}
      </section>

      {/* ── 품목별 카드(따로 보는 종류는 영업 품목 보기만) ── */}
      {isOther ? (
        <OtherItemsPanel items={c.items} />
      ) : data.lines.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <div>📦</div>
            <div>영업이 적은 품목이 없어요.</div>
          </div>
        </div>
      ) : (
        data.lines.map((line) => {
          const item = line.item;
          const firstSnap = line.slots.find((s) => s.unit?.itemSnapshot)?.unit?.itemSnapshot ?? null;
          const snapText = (it: { cat: string; maker: string; model: string } | null) => (it ? [it.cat, it.maker, it.model].filter(Boolean).join(' ') || '(비어 있음)' : '');
          const lineCount = line.slots.length;
          return (
            <section key={line.itemIndex} className="panel sc-lb">
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
              {isSwap && c.replaceInfo && line.itemIndex === data.lines[0]?.itemIndex && <SwapBeforeBox before={c.replaceInfo.before} />}
              {/* 예전 방식 모양 — 왼쪽 작성시(요청) · 오른쪽 출고시(제조사 한 칸 + 표). 한 줄 = ④ 한 행, 저장 길은 그대로 */}
              <SlotLineBlock
                line={line}
                isSwap={isSwap}
                disabled={unitsDisabled}
                addable={addLineAllowed(c, line.kind)}
                adding={addingLine === line.itemIndex}
                addBusy={addingLine !== null}
                onAddLine={() => addLine(line)}
                onRemoveAdded={(slot) => removeLine(line, slot)}
                saveUnit={saveUnit}
                lookupAsset={lookupAsset}
                onRecheck={recheck}
                onApplyMaker={(maker) =>
                  applyLine(
                    line.itemIndex,
                    { actualMaker: maker },
                    maker ? `제조사 '${maker}'를 이 품목 ${lineCount}줄 모두에 적었어요.` : '제조사를 지웠어요 — 종이엔 영업 요청 제조사가 나가요.',
                  )
                }
                onBulk={(mode) => setBulk({ mode, itemIndex: line.itemIndex })}
                bulkKeyDisabled={sqlB}
                checkItems={checkItemsFor(line)}
                dupAssets={dupAssets}
                assetElsewhere={data.assetElsewhere}
                onDirtyChange={onDirtyChange}
                license={licenseProps}
              />
            </section>
          );
        })
      )}

      {!isOther && <OrphanPanel orphans={data.orphans} targets={orphanTargets} disabled={unitsDisabled} onMove={moveOrphan} onDelete={removeOrphan} />}

      {/* ── 건 단위 ── */}
      <section className="panel sc-whole">
        {!(isOther && c.supplies.length === 0) && <div className="sc-sec-title">소모품</div>}
        {c.supplies.length === 0 ? (
          isOther ? null : <div className="detail-empty">소모품이 없어요.</div>
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

        {/* 교체 건은 교체 전 기기를 품목 칸 위 회색 상자로 보여 줌 — 여기선 그 밖(품목이 없거나 교체가 아닌데 값이 온 것)만 */}
        {hasReplace && c.replaceInfo && !(isSwap && data.lines.length > 0) && (
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

        {!isOther && confirmChecks.length > 0 && (
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

      <PrepLinkPanel
        confirmId={confirmId}
        link={data.prepLink}
        getWorkUpdatedAt={() => dataRef.current.work.updatedAt}
        ensureActor={ensureActor}
        onSaved={(at) => setData((d) => ({ ...d, work: { ...d.work, updatedAt: at } }))}
        onReload={() => void reload(true)}
        serial={serial}
        toast={toast}
        people={data.people}
      />

      {/* ── 핸드폰 아래 고정 막대 ── */}
      <div className="sc-fixbar">
        <select className={`sc-status ${statusClass(status)}`} value={status} aria-label="처리여부" onChange={(e) => void setStatus(e.target.value as SalesConfirmStatus)}>
          {SALES_CONFIRM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {!isOther && (
          <button type="button" className="btn btn-primary" onClick={goNextEmpty}>
            다음 빈 칸 ↓
          </button>
        )}
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
      {printMode && (
        <SalesPrintDialog
          detail={data}
          initialMode={printMode}
          license={lic.state}
          hasSoftware={hasSoftware}
          onUnlock={askUnlock}
          actor={actor}
          ensureActor={ensureActor}
          onClose={() => setPrintMode(null)}
          onWarn={toast.warn}
          onSalesChanged={reloadForPrint}
          onUnitsAcked={applyUnits}
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

/** 따로 보는 종류(철수·이전·판매)의 영업 품목 — 보기만(기기 칸·출고 값 없음) */
function OtherItemsPanel({ items }: { items: SalesConfirmItem[] }) {
  return (
    <section className="panel sc-whole">
      <div className="sc-sec-title">품목 (영업이 적은 것 — 보기만)</div>
      {items.length === 0 ? (
        <div className="detail-empty">영업이 적은 품목이 없어요.</div>
      ) : (
        <div className="sc-scroll">
          <table className="m-cards sc-mini">
            <thead>
              <tr>
                <th data-m="title">품목</th>
                <th data-m="badge">수량</th>
                <th data-m="inline" data-label="제조사·모델">
                  제조사·모델
                </th>
                <th data-m="inline" data-label="상태">
                  상태
                </th>
                <th data-m="sub" data-label="사양">
                  사양
                </th>
                <th data-m="full" data-label="설치장소·요청">
                  설치장소·요청
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const spec = [
                  ...SALES_SPEC_KEYS.filter((k) => (it.spec[k] ?? '').trim()).map((k) => `${k} ${it.spec[k] ?? ''}`),
                  ...Object.entries(it.specExtra ?? {}).map(([k, v]) => `${k} ${v}`),
                ].join(' · ');
                return (
                  <tr key={i}>
                    <td>{it.cat || '기타'}</td>
                    <td>{it.qty}</td>
                    <td>{[it.maker, it.model].filter(Boolean).join(' ') || '-'}</td>
                    <td>{it.state || '-'}</td>
                    <td>{spec || '-'}</td>
                    <td>{it.place || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

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

/** 교체 전 기기 칸 — 영업 export before {item, model, maker, sn, asset, spec(하드웨어), sw} 의 값 이름표 */
const SWAP_BEFORE_FIELDS: [string, string][] = [
  ['item', '품목'],
  ['maker', '제조사'],
  ['model', '모델명'],
  ['asset', '자산번호'],
  ['sn', '기번(S/N)'],
  ['spec', '하드웨어'],
  ['sw', '소프트웨어'],
];

/** 교체 전(회수할) 기기 — 영업이 임대리스트에서 채운 값, 보기만(IT 입력 칸은 이번엔 안 만듦 — E19) */
function SwapBeforeBox({ before }: { before: unknown }) {
  const isObj = !!before && typeof before === 'object' && !Array.isArray(before);
  const o = isObj ? (before as Record<string, unknown>) : null;
  const rows = o
    ? SWAP_BEFORE_FIELDS.map(([k, label]): [string, string] => {
        const v = o[k];
        return [label, typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''];
      }).filter(([, v]) => v)
    : [];
  return (
    <div className="sc-before-box">
      <div className="sc-before-title">교체 전 기기 (회수 — 영업이 적은 값, 보기만)</div>
      {o ? (
        rows.length > 0 ? (
          <div className="sc-before-grid">
            {rows.map(([label, v]) => (
              <div key={label} className="sc-before-cell">
                <span className="detail-label">{label}</span>
                <span className="sc-before-val">{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="detail-empty">영업이 교체 전 기기를 적지 않았어요.</div>
        )
      ) : (
        <UnknownValue value={before} />
      )}
    </div>
  );
}

