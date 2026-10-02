'use server';

import { revalidatePath } from 'next/cache';
import type { ConfirmFormTab } from '@/lib/confirmForm';
import { dispatchInputToRow, rowToDispatch, type DispatchEntry, type DispatchEntryRow } from '@/lib/dispatch';
import { receivingInputToRow } from '@/lib/receiving';
import {
  extractWithdrawalFormFromImage,
  extractWithdrawalFormFromText,
  isOcrConfigured,
  type WithdrawalFormFields,
} from '@/lib/ocr';
import { CATEGORIES } from '@/lib/types';
import { createAdminClient, DISPATCH_TABLE, RECEIVING_TABLE } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };
export type OcrFormResult = { ok: true; fields: WithdrawalFormFields } | { ok: false; error: string };

const CONFIRM_FORM_REMARK = '확인서 붙여넣기로 등록';

/** 품목 OCR 값이 CATEGORIES와 정확히 안 맞을 수 있어서(예: "노트북PC") 느슨하게 매칭합니다. */
function matchCategory(raw: string): string {
  const found = CATEGORIES.find((c) => raw.includes(c) || c.includes(raw));
  return found ?? CATEGORIES[0];
}

export async function ocrScanConfirmFormImage(base64Image: string, mediaType: string): Promise<OcrFormResult> {
  if (!isOcrConfigured()) {
    return { ok: false, error: 'OCR 기능을 쓰려면 관리자가 ANTHROPIC_API_KEY를 설정해야 해요.' };
  }
  try {
    const fields = await extractWithdrawalFormFromImage(base64Image, mediaType);
    return { ok: true, fields };
  } catch (err) {
    console.error('[confirmForm] ocrScanConfirmFormImage 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'OCR 인식에 실패했어요.' };
  }
}

export async function ocrScanConfirmFormText(text: string): Promise<OcrFormResult> {
  if (!isOcrConfigured()) {
    return { ok: false, error: 'OCR 기능을 쓰려면 관리자가 ANTHROPIC_API_KEY를 설정해야 해요.' };
  }
  if (!text.trim()) return { ok: false, error: '텍스트를 입력해주세요.' };
  try {
    const fields = await extractWithdrawalFormFromText(text);
    return { ok: true, fields };
  } catch (err) {
    console.error('[confirmForm] ocrScanConfirmFormText 실패:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'OCR 인식에 실패했어요.' };
  }
}

/**
 * 확인서 내용을 등록합니다. 모든 탭(납품/교체/철수)에서 공통으로 출고/접수 대장
 * (it_dispatch_log, DISPATCH_TYPES에 이미 "납품"/"교체"/"반출"이 있음 — 철수는 그 "반출"에
 * 대응)에 건별로 기록을 남기고, **철수 탭만 추가로** 입고 대장에 렌탈입고예정 건을 만듭니다
 * (철수 = 임대 장비가 사무실로 돌아오는 것이므로).
 */
export async function registerConfirmForm(tab: ConfirmFormTab, fields: WithdrawalFormFields): Promise<ActionResult> {
  if (fields.items.length === 0) return { ok: false, error: '등록할 품목이 없어요.' };
  if (!fields.companyName.trim()) return { ok: false, error: '상호(거래처명)는 필수예요.' };

  const supabase = createAdminClient();
  const dispatchType = tab === '철수' ? '반출' : tab;

  const dispatchRows = fields.items.map((item) =>
    dispatchInputToRow({
      deliveryDate: fields.date,
      receivedDate: fields.date,
      receivedTime: '',
      startTime: '',
      endTime: '',
      status: '접수',
      receiver: '',
      processor: fields.requester,
      type: dispatchType,
      notes: fields.reason,
      company: fields.companyName,
      contact: '',
      item: item.category,
      directSpec: item.model,
      assetId: item.assetId,
      remarks: CONFIRM_FORM_REMARK,
      serialNumber: item.serialNumber,
    }),
  );

  const { error: dispatchError } = await supabase.from(DISPATCH_TABLE).insert(dispatchRows);
  if (dispatchError) {
    console.error('[confirmForm] registerConfirmForm 출고 대장 등록 실패:', dispatchError);
    return { ok: false, error: `출고 대장 등록에 실패했어요: ${dispatchError.message}` };
  }

  if (tab === '철수') {
    const receivingRows = fields.items.map((item) =>
      receivingInputToRow({
        kind: '렌탈입고예정',
        status: '입고대기',
        category: matchCategory(item.category),
        brand: '',
        model: item.model,
        cpu: '',
        spec: '',
        ram: '',
        storage: '',
        screen: '',
        vendor: fields.companyName,
        purchasePrice: '',
        purchaseUrl: '',
        expectedDate: fields.date,
        manager: fields.requester,
        notes: `확인서(철수) 붙여넣기로 등록 — ${fields.reason}`.trim(),
        assetId: item.assetId,
        serialNumber: item.serialNumber,
        location: '',
        quantity: 1,
      }),
    );
    const { error: receivingError } = await supabase.from(RECEIVING_TABLE).insert(receivingRows);
    if (receivingError) {
      console.error('[confirmForm] registerConfirmForm 입고 대장 등록 실패:', receivingError);
      return {
        ok: false,
        error: `출고 대장엔 등록됐지만 입고 대장(렌탈입고예정) 등록에 실패했어요: ${receivingError.message}`,
      };
    }
    revalidatePath('/receiving');
  }

  revalidatePath('/dispatch');
  revalidatePath('/confirm-form');
  return { ok: true };
}

/** 이 도구로 등록된 최근 건들만 — remarks 마커로 구분합니다(registerConfirmForm이 남김). */
export async function listRecentConfirmFormEntries(): Promise<DispatchEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(DISPATCH_TABLE)
    .select('*')
    .eq('remarks', CONFIRM_FORM_REMARK)
    .order('seq', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[confirmForm] listRecentConfirmFormEntries 실패:', error);
    return [];
  }
  return ((data ?? []) as DispatchEntryRow[]).map(rowToDispatch);
}
