'use server';

/**
 * 영업 확인서 상세 — 라이선스 키·계약관리 소프트웨어 대장 연결 액션(설계 §3-11, D28~D30).
 * 이름·인자는 lib/salesConfirms/types.ts "라이선스 키" 절 주석 그대로. 일은 lib/contracts/salesConfirmLink.ts 가 하고
 * 여기서는 결과 모양(LicenseActionResult)으로만 바꿈. 'use server' 파일이라 async 함수만 export.
 * - 키·대장 쓰기와 키 읽기는 전부 잠금 해제(계약관리 비밀번호, 쿠키 it_ct_unlock) 필요 → 아니면 { ok:false, needUnlock:true }.
 *   예외: getConfirmLicenseState 는 잠겨 있어도 ok(키 있음/없음·대장 상태만, 키 값 null).
 * - 서버가 확인: 확인서 id·④ id 모양, ④ 가 그 확인서의 것이고 지금 소프트웨어 품목 칸인지(다른 종류·영업에서 빠진 칸은 거절).
 * - 라이선스 키 값은 응답(잠금이 풀린 읽기 말고)·오류 문구·서버 로그에 없음. Supabase 오류는 code 만 로그(details 에 행 값이 있음).
 * - revalidatePath 안 부름: 계약관리 화면은 force-dynamic(열 때마다 새로 읽음)이고, 부르면 지금 보고 있는 상세 화면이 통째로 다시 그려짐.
 */
import { UserError, isMissingContractTable } from '@/lib/contracts/clients';
import { UnlockRequired } from '@/lib/contracts/secrets';
import { SalesWorkError } from '@/lib/salesConfirms/work';
import {
  LinkError,
  NeedClientError,
  NeedContractsSqlError,
  clientCandidatesForConfirm,
  getLicenseState,
  getPrintKeys,
  pushUnitToLedger,
  saveLineLicenseKey as saveLineLicenseKeyCore,
  saveUnitLicenseKey as saveUnitLicenseKeyCore,
} from '@/lib/contracts/salesConfirmLink';
import type {
  ConfirmLicenseState,
  LedgerClientCandidate,
  LedgerClientChoice,
  LicenseActionResult,
} from '@/lib/salesConfirms/types';

type Failure = Exclude<LicenseActionResult<unknown>, { ok: true }>;

const GENERIC = '처리하지 못했어요. 잠시 뒤 다시 해 주세요.';

function codeOf(e: unknown): string {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code?: unknown }).code ?? '') : '';
}

/** 던진 오류 → 화면 모양. 쉬운 말 오류는 그대로, 나머지는 일반 문구 + 서버 로그엔 단계·code 만 */
function failOf(stage: string, err: unknown): Failure {
  if (err instanceof UnlockRequired) return { ok: false, needUnlock: true, error: err.message };
  if (err instanceof NeedClientError) return { ok: false, needClient: true, candidates: err.candidates, error: err.message };
  if (err instanceof NeedContractsSqlError) return { ok: false, needContractsSql: true, error: err.message };
  // 쉬운 말 문구(값·원문 없음) — 계약관리(UserError)·확인서 칸(SalesWorkError: 칸 없음·SQL 블록 A 전·동시 수정)
  if (err instanceof LinkError || err instanceof UserError || err instanceof SalesWorkError) return { ok: false, error: err.message };
  if (isMissingContractTable(err)) {
    return { ok: false, error: '계약 관리 표가 아직 없어요 — supabase/contracts_schema.sql 을 먼저 실행해 주세요.' };
  }
  const code = codeOf(err);
  console.warn(`[sales-license] ${stage} 실패`, code || (err instanceof Error ? err.name : 'unknown'));
  return { ok: false, error: code ? `${GENERIC} [${code}]` : GENERIC };
}

async function run<T>(stage: string, fn: () => Promise<T>): Promise<LicenseActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return failOf(stage, err);
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** 고르기 값은 객체인지만 보고 넘김(종류별 검사는 lib 의 clientFromChoice) — 없으면 null */
function choiceOf(v: unknown): LedgerClientChoice | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as LedgerClientChoice) : null;
}

/** 상세를 열 때·새로 고칠 때 — 잠겨 있어도 ok(키 값만 null). 풀려 있으면 키 값까지 + view_bulk 기록 */
export async function getConfirmLicenseState(input: { confirmId: string }): Promise<LicenseActionResult<ConfirmLicenseState>> {
  const i = obj(input);
  return run('상태 읽기', () => getLicenseState(i.confirmId, { logView: true }));
}

/** 거래처 고르기 창 후보(이름이 맞는 거래처·새 거래처·미분류·나머지) — 잠금 해제 필요 */
export async function listLedgerClientCandidates(input: { confirmId: string }): Promise<LicenseActionResult<LedgerClientCandidate[]>> {
  const i = obj(input);
  return run('거래처 후보', () => clientCandidatesForConfirm(i.confirmId));
}

/** 칸 하나 키 저장(빈 값 = 지우기). 처음이면 대장 거래처·상품·좌석을 만든 뒤 — 거래처를 못 정했으면 needClient */
export async function saveUnitLicenseKey(input: {
  confirmId: string;
  slotKey: string;
  unitNo: number;
  unitId: string | null;
  key: string;
  client?: LedgerClientChoice;
  actor: string;
}): Promise<LicenseActionResult<ConfirmLicenseState>> {
  const i = obj(input);
  return run('키 저장', () =>
    saveUnitLicenseKeyCore({
      confirmId: i.confirmId,
      slotKey: i.slotKey,
      unitNo: i.unitNo,
      unitId: i.unitId,
      key: i.key,
      client: choiceOf(i.client),
      actor: i.actor,
    }),
  );
}

/** [같은 키를 모든 칸에] — 소프트웨어 품목 줄 칸마다 같은 값(빈 값 = 그 줄 키 지우기) */
export async function saveLineLicenseKey(input: {
  confirmId: string;
  itemIndex: number;
  key: string;
  client?: LedgerClientChoice;
  actor: string;
}): Promise<LicenseActionResult<ConfirmLicenseState>> {
  const i = obj(input);
  return run('줄 키 저장', () =>
    saveLineLicenseKeyCore({
      confirmId: i.confirmId,
      itemIndex: i.itemIndex,
      key: i.key,
      client: choiceOf(i.client),
      actor: i.actor,
    }),
  );
}

/** [대장에 올리기]·[다시 올리기] — 설치 PC·사용자·제품명을 대장에(대장에서 사람이 고친 칸은 안 덮음). unitIds 없으면 소프트웨어 칸 전부 */
export async function pushUnitsToLedger(input: {
  confirmId: string;
  unitIds?: string[];
  client?: LedgerClientChoice;
  actor: string;
}): Promise<LicenseActionResult<ConfirmLicenseState>> {
  const i = obj(input);
  return run('대장 반영', () =>
    pushUnitToLedger({
      confirmId: i.confirmId,
      unitIds: i.unitIds,
      client: choiceOf(i.client),
      actor: i.actor,
    }),
  );
}

/** 출력 창 — ④ id → 키(잠금 해제 필요, view_bulk 기록). 값은 출력 창 메모리에만 */
export async function getSalesPrintKeys(input: { confirmId: string }): Promise<LicenseActionResult<Record<string, string>>> {
  const i = obj(input);
  return run('출력용 키', () => getPrintKeys(i.confirmId));
}
