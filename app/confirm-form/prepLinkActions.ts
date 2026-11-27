'use server';

/**
 * 영업 확인서 ↔ 출고 준비 일정 연결 액션(4-1 — developer B). 설계 docs/tasks/2026-11-27-sales-confirm-prep-merge.md F2·F4·F8 · §4-A·§4-C.
 * 시그니처는 lib/salesConfirms/types.ts 맨 아래 4-1 절 주석 그대로. 판정·읽기·쓰기는 전부 lib/salesConfirms/prepLink.ts 가 하고
 * 여기는 입력 검사 + 오류를 쉬운 말로 바꾸기만.
 *   - 읽기(get·list)는 아무것도 안 씀(F4 — 화면 열기만으로는 안 씀).
 *   - 쓰기는 ③ it_sales_confirm_work 의 prep_event_id · link_source · updated_by 뿐(writeConfirmLink — 동시 수정 검사 그대로).
 *   - 네이버·카톡·시트·it_prep_* 표엔 안 씀.
 *   - 로그는 code 만(Supabase details 에 행 값이 들어감), payload·연락처는 응답에 없음(prepLink 가 만든 모양 그대로).
 * 'use server' 파일이라 async 함수만 export — 상수·타입은 lib/salesConfirms/ 에.
 */
import {
  MAX_CONFIRM_BADGES,
  MAX_EVENT_BADGES,
  MSG_LINK_CONFIRM_GONE,
  MSG_LINK_EVENT_GONE,
  MSG_LINK_FAIL,
  MSG_LINK_NO_TABLE,
  readConfirmPrepBadges,
  readEventConfirmBadges,
  readPrepLinkForConfirm,
  writeConfirmLink,
} from '@/lib/salesConfirms/prepLink';
import { isMissingSalesTable } from '@/lib/salesConfirms/listQuery';
import { logSalesFail } from '@/lib/salesConfirms/work';
import type {
  PrepConfirmBadge,
  PrepLinkReadResult,
  PrepLinkSaveResult,
  PrepLinkState,
} from '@/lib/salesConfirms/types';
import { isSupabaseConfigured } from '@/lib/supabase/server';

const NOT_CONFIGURED = 'Supabase 설정이 필요해요.';
const MSG_READ_FAIL = '출고 준비 연결을 읽지 못했어요 — 잠시 뒤 다시 해 주세요.';
const MSG_BADGE_FAIL = '확인서 정보를 못 읽었어요 — 잠시 뒤 다시 해 주세요.';
const MSG_BAD_INPUT = '요청 값이 올바르지 않아요 — 새로고침한 뒤 다시 해 주세요.';
/** 목록·일정 id 를 한 번에 이보다 많이 보내면 거절(정상 화면은 MAX 안 — 서버 액션은 누구나 부를 수 있으므로) */
const MAX_INPUT_IDS = 2000;

// ───────────────────────── 입력 검사 ─────────────────────────

/** 영업 확인서 id — 형식을 몰라서(16자 글자 실측) 길이만(salesDetailActions 와 같은 규칙) */
const isConfirmId = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
const isEventId = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
/** 화면이 본 ③ updated_at — DB 문자열 그대로(null = ③ 줄이 없었음). 길이만 막음 */
const isExpected = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 64);
const isActor = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;

/** 배열에서 쓸 수 있는 id 만, 겹침 없이, 최대 max 개. 배열이 아니거나 너무 길면 null */
function cleanIds(v: unknown, ok: (x: unknown) => x is string, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_INPUT_IDS) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (!ok(x)) continue;
    const id = x.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function readFail<T>(where: string, err: unknown, msg: string): PrepLinkReadResult<T> {
  if (isMissingSalesTable(err)) return { ok: false, missingTable: true, error: MSG_LINK_NO_TABLE };
  logSalesFail(where, err);
  return { ok: false, error: msg };
}

/** 연결이 바뀐 것만 서버 로그에(감사용 — id·값만, 이름·내용 없음. §4-G "서버 로그로 충분") */
function logLinkChange(confirmId: string, res: PrepLinkSaveResult) {
  if (!res.ok) return;
  console.log('[sales-confirms] 출고 준비 연결', JSON.stringify({ confirmId, eventId: res.prepEventId, source: res.linkSource }));
}

// ───────────────────────── 읽기(쓰기 0) ─────────────────────────

/** 확인서 하나의 연결 상태 + 후보(상세 출고 준비 상자 — 연결·풀기 뒤 다시 그리기용). 후보의 준비 기록·완료 보고까지 */
export async function getConfirmPrepLink(input: { confirmId: string }): Promise<PrepLinkReadResult<PrepLinkState>> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    const state = await readPrepLinkForConfirm(input.confirmId.trim(), { withRecords: true });
    if (!state) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
    return { ok: true, data: state };
  } catch (err) {
    return readFail('출고 준비 연결 읽기', err, MSG_READ_FAIL);
  }
}

/**
 * 목록 보이는 줄의 출고 준비 칸(확인서 id → 상태). 없는 id 는 빠짐, 최대 MAX_CONFIRM_BADGES(500).
 * 목록 60초 가져오기 고리에 넣지 말 것 — 목록 열 때·5분마다(§9-11).
 */
export async function listConfirmPrepBadges(input: { confirmIds: string[] }): Promise<PrepLinkReadResult<Record<string, PrepLinkState>>> {
  const ids = cleanIds(input?.confirmIds, isConfirmId, MAX_CONFIRM_BADGES);
  if (!ids) return { ok: false, error: MSG_BAD_INPUT };
  if (!ids.length) return { ok: true, data: {} };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    return { ok: true, data: await readConfirmPrepBadges(ids) };
  } catch (err) {
    return readFail('출고 준비 칸 읽기', err, MSG_BADGE_FAIL);
  }
}

/**
 * 출고 준비 리스트에 보이는 일정의 확인서 배지(일정 id → 배지). 없는 일정 id 는 빠짐, 최대 MAX_EVENT_BADGES(300).
 * listPrepEvents 모양은 안 바꿈(H14 — 홈도 씀). 확인서 표가 없으면 missingTable → 화면은 배지 없이 그대로(§4-G).
 */
export async function listEventConfirmBadges(input: { eventIds: string[] }): Promise<PrepLinkReadResult<Record<string, PrepConfirmBadge>>> {
  const ids = cleanIds(input?.eventIds, isEventId, MAX_EVENT_BADGES);
  if (!ids) return { ok: false, error: MSG_BAD_INPUT };
  if (!ids.length) return { ok: true, data: {} };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    return { ok: true, data: await readEventConfirmBadges(ids) };
  } catch (err) {
    return readFail('출고 준비 배지 읽기', err, MSG_BADGE_FAIL);
  }
}

// ───────────────────────── 쓰기(③ prep_event_id · link_source 만) ─────────────────────────

/** [연결]·[바꾸기]·자동 짝 [이걸로 확정] — 'manual'. expectedUpdatedAt = 화면이 본 ③ updated_at(③ 줄이 없었으면 null) */
export async function linkConfirmPrepEvent(input: {
  confirmId: string;
  eventId: string;
  expectedUpdatedAt: string | null;
  actor: string;
}): Promise<PrepLinkSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
  if (!isEventId(input?.eventId)) return { ok: false, error: MSG_LINK_EVENT_GONE };
  if (!isExpected(input?.expectedUpdatedAt) || !isActor(input?.actor)) return { ok: false, error: MSG_BAD_INPUT };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const confirmId = input.confirmId.trim();
  try {
    const res = await writeConfirmLink({
      confirmId,
      eventId: input.eventId.trim().toLowerCase(),
      source: 'manual',
      expectedUpdatedAt: input.expectedUpdatedAt,
      actor: input.actor,
    });
    logLinkChange(confirmId, res);
    return res;
  } catch (err) {
    // writeConfirmLink 는 던지지 않게 만들어져 있지만, 혹시 던지면 저장 안 된 것으로
    logSalesFail('출고 준비 연결', err);
    return { ok: false, error: MSG_LINK_FAIL };
  }
}

/** [풀기]·[출고 일정 없음으로 두기] — prep_event_id null + 'none'(자동 연결·"일정 없음" 알림 끔) */
export async function unlinkConfirmPrepEvent(input: {
  confirmId: string;
  expectedUpdatedAt: string | null;
  actor: string;
}): Promise<PrepLinkSaveResult> {
  return writeEmpty(input, 'none', '출고 준비 연결 풀기');
}

/** 'none' 되돌리기 = 다시 자동으로 찾기 — prep_event_id null + '' */
export async function resetConfirmPrepLink(input: {
  confirmId: string;
  expectedUpdatedAt: string | null;
  actor: string;
}): Promise<PrepLinkSaveResult> {
  return writeEmpty(input, '', '출고 준비 연결 되돌리기');
}

async function writeEmpty(
  input: { confirmId: string; expectedUpdatedAt: string | null; actor: string },
  source: 'none' | '',
  where: string,
): Promise<PrepLinkSaveResult> {
  if (!isConfirmId(input?.confirmId)) return { ok: false, error: MSG_LINK_CONFIRM_GONE };
  if (!isExpected(input?.expectedUpdatedAt) || !isActor(input?.actor)) return { ok: false, error: MSG_BAD_INPUT };
  if (!isSupabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const confirmId = input.confirmId.trim();
  try {
    const res = await writeConfirmLink({ confirmId, eventId: null, source, expectedUpdatedAt: input.expectedUpdatedAt, actor: input.actor });
    logLinkChange(confirmId, res);
    return res;
  } catch (err) {
    logSalesFail(where, err);
    return { ok: false, error: MSG_LINK_FAIL };
  }
}
