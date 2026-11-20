'use server';

import { requireUnlock, UnlockRequired } from '@/lib/contracts/secrets';
import { previewImport, applyImport } from '@/lib/contracts/sheetImport';
import type { ActionResult, ImportPlan, ImportPreview, ImportResult } from '@/lib/contracts/types';

const LOCKED = { ok: false as const, error: '비밀번호를 먼저 넣어 주세요(열람 중일 때만 옮길 수 있어요).', needUnlock: true };

/** 시트 옮기기 미리보기 — 쓰기 없음, 비밀 값은 응답에 없음(개수만). 열람 중이어야 함 */
export async function previewSheetImport(): Promise<ActionResult<{ preview: ImportPreview }>> {
  try {
    await requireUnlock();
  } catch (e) {
    if (e instanceof UnlockRequired) return LOCKED;
    return { ok: false, error: '인증 확인에 실패했어요.' };
  }
  return previewImport();
}

/** 시트 옮기기 반영 — 시트를 다시 읽어 지문이 같을 때만. 열람 중이어야 함 */
export async function applySheetImport(plan: ImportPlan): Promise<ActionResult<{ result: ImportResult }>> {
  let actor: string;
  try {
    actor = (await requireUnlock()).name;
  } catch (e) {
    if (e instanceof UnlockRequired) return LOCKED;
    return { ok: false, error: '인증 확인에 실패했어요.' };
  }
  return applyImport(plan, actor);
}
