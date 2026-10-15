'use server';

import { revalidatePath } from 'next/cache';
import type { ConfirmFormTab } from '@/lib/confirmForm';
import {
  deliveryConfirmFormInputToRow,
  rowToDeliveryConfirmForm,
  type DeliveryConfirmForm,
  type DeliveryConfirmFormInput,
  type DeliveryConfirmFormRow,
} from '@/lib/deliveryConfirmForm';
import { dispatchInputToRow, rowToDispatch, type DispatchEntry, type DispatchEntryRow } from '@/lib/dispatch';
import { receivingInputToRow } from '@/lib/receiving';
import { extractWithdrawalFormFromText, isOcrConfigured, type WithdrawalFormFields } from '@/lib/ocr';
import { CATEGORIES } from '@/lib/types';
import {
  createAdminClient,
  DELIVERY_CONFIRM_FORM_TABLE,
  DISPATCH_TABLE,
  RECEIVING_TABLE,
} from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };
export type OcrFormResult = { ok: true; fields: WithdrawalFormFields } | { ok: false; error: string };

const CONFIRM_FORM_REMARK = '확인서 붙여넣기로 등록';

/** 품목 OCR 값이 CATEGORIES와 정확히 안 맞을 수 있어서(예: "노트북PC") 느슨하게 매칭합니다. */
function matchCategory(raw: string): string {
  const found = CATEGORIES.find((c) => raw.includes(c) || c.includes(raw));
  return found ?? CATEGORIES[0];
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
 *
 * 텍스트/사진 인식이 완벽하지 않을 수 있어서, 원문(rawText — 텍스트 붙여넣기 경로일 때만
 * 값이 있음)과 함께 it_delivery_confirm_forms에도 그대로 저장합니다 — 그래야 나중에(준비
 * 중에) 비어있던 자산번호를 채워 넣고 "상세보기"에서 다시 출력할 수 있습니다(정식
 * 납품확인서와 같은 저장/재출력 구조를 재사용 — registerDeliveryConfirmForm 참고).
 */
export async function registerConfirmForm(
  tab: ConfirmFormTab,
  fields: WithdrawalFormFields,
  rawText = '',
): Promise<ActionResult> {
  if (fields.items.length === 0) return { ok: false, error: '등록할 품목이 없어요.' };
  if (!fields.companyName.trim()) return { ok: false, error: '상호(거래처명)는 필수예요.' };

  const supabase = createAdminClient();
  const dispatchType = tab === '철수' ? '반출' : tab;

  const { data: formData, error: formError } = await supabase
    .from(DELIVERY_CONFIRM_FORM_TABLE)
    .insert(
      deliveryConfirmFormInputToRow({
        company: fields.companyName,
        orderDate: '',
        deliveryDate: fields.date,
        department: '',
        inflowType: '',
        salesManager: '',
        requestManager: fields.requester,
        siteAddress: '',
        specialNotes: fields.reason,
        businessType: '',
        consumables: '',
        contractPeriod: '',
        deposit: '',
        paymentNotes: '',
        items: fields.items.map((item) => ({
          category: item.category,
          model: item.model,
          manufacturer: '',
          hardwareSpec: '',
          unitPrice: '',
          quantity: 1,
          units: [{ assetId: item.assetId, serialNumber: item.serialNumber }],
        })),
        rawText,
      }),
    )
    .select('id')
    .single();
  if (formError || !formData) {
    console.error('[confirmForm] registerConfirmForm 원본 저장 실패:', formError);
    return { ok: false, error: `확인서 저장에 실패했어요: ${formError?.message ?? '알 수 없는 오류'}` };
  }
  const formId = (formData as { id: string }).id;

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
      deliveryFormId: formId,
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

/**
 * 이 도구로 등록된 건 전체 — remarks 마커로 구분합니다(registerConfirmForm이 남김).
 * IT확인서리스트처럼 계속 쌓이는 전체 이력이라 개수를 임의로 자르지 않습니다(/dispatch와
 * 동일한 방식 — 그 페이지도 별도 limit 없음).
 */
export async function listRecentConfirmFormEntries(): Promise<DispatchEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(DISPATCH_TABLE)
    .select('*')
    .eq('remarks', CONFIRM_FORM_REMARK)
    .order('seq', { ascending: false });
  if (error) {
    console.error('[confirmForm] listRecentConfirmFormEntries 실패:', error);
    return [];
  }
  return ((data ?? []) as DispatchEntryRow[]).map(rowToDispatch);
}

/**
 * 정식 납품 확인서 등록 — 구 "확인서리스트" 구글시트의 업체명+날짜별 개별 탭을
 * 대체합니다(새 탭을 만들지 않고 it_delivery_confirm_forms에 쌓아두고, 상세보기에서
 * 원본과 같은 레이아웃으로 보여줌). 등록 즉시 각 유닛(자산번호 단위)을 기존 출고/접수
 * 대장(it_dispatch_log)에도 펼쳐 써서, /dispatch 쪽 집계·검색에 그대로 잡히게 합니다
 * (registerConfirmForm의 변환 패턴과 동일).
 */
/** 정식 납품확인서 품목(카드별 units)을 출고/접수 대장 행으로 펼칩니다 — register/update 공용. */
function buildDispatchRowsFromDeliveryForm(input: DeliveryConfirmFormInput, formId: string) {
  return input.items.flatMap((item) =>
    item.units.map((unit) =>
      dispatchInputToRow({
        deliveryDate: input.deliveryDate,
        receivedDate: input.deliveryDate,
        receivedTime: '',
        startTime: '',
        endTime: '',
        status: '접수',
        receiver: '',
        processor: input.requestManager,
        type: '납품',
        notes: item.hardwareSpec,
        company: input.company,
        contact: '',
        item: item.category,
        directSpec: item.model,
        assetId: unit.assetId,
        remarks: CONFIRM_FORM_REMARK,
        serialNumber: unit.serialNumber,
        deliveryFormId: formId,
      }),
    ),
  );
}

export type RegisterDeliveryFormResult = { ok: true; id: string; warning?: string } | { ok: false; error: string };

export async function registerDeliveryConfirmForm(
  input: DeliveryConfirmFormInput,
): Promise<RegisterDeliveryFormResult> {
  if (!input.company.trim()) return { ok: false, error: '상호는 필수예요.' };
  if (input.items.length === 0) return { ok: false, error: '품목을 1개 이상 추가해주세요.' };
  for (const item of input.items) {
    if (!item.model.trim()) return { ok: false, error: '품목명을 입력해주세요.' };
    if (item.units.length !== item.quantity) {
      return { ok: false, error: `"${item.model}"의 수량과 자산번호 입력 줄 수가 안 맞아요.` };
    }
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(DELIVERY_CONFIRM_FORM_TABLE)
    .insert(deliveryConfirmFormInputToRow(input))
    .select('id')
    .single();
  if (error || !data) {
    console.error('[confirmForm] registerDeliveryConfirmForm 저장 실패:', error);
    return { ok: false, error: `확인서 저장에 실패했어요: ${error?.message ?? '알 수 없는 오류'}` };
  }
  const formId = (data as { id: string }).id;

  const dispatchRows = buildDispatchRowsFromDeliveryForm(input, formId);

  if (dispatchRows.length > 0) {
    const { error: dispatchError } = await supabase.from(DISPATCH_TABLE).insert(dispatchRows);
    if (dispatchError) {
      console.error('[confirmForm] registerDeliveryConfirmForm 출고 대장 등록 실패:', dispatchError);
      return {
        ok: true,
        id: formId,
        warning: `확인서는 저장됐지만 출고/접수 대장 반영에는 실패했어요: ${dispatchError.message}`,
      };
    }
  }

  revalidatePath('/confirm-form');
  revalidatePath('/dispatch');
  return { ok: true, id: formId };
}

/** 등록내역 리스트에서 "상세보기" 매핑용 가벼운 조회(최근 100건). */
export async function listDeliveryConfirmForms(): Promise<DeliveryConfirmForm[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(DELIVERY_CONFIRM_FORM_TABLE)
    .select('*')
    .order('seq', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[confirmForm] listDeliveryConfirmForms 실패:', error);
    return [];
  }
  return ((data ?? []) as DeliveryConfirmFormRow[]).map(rowToDeliveryConfirmForm);
}

/** 상세보기/인쇄용 전체 데이터 조회. */
export async function getDeliveryConfirmForm(id: string): Promise<DeliveryConfirmForm | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from(DELIVERY_CONFIRM_FORM_TABLE).select('*').eq('id', id).single();
  if (error || !data) {
    console.error('[confirmForm] getDeliveryConfirmForm 실패:', error);
    return null;
  }
  return rowToDeliveryConfirmForm(data as DeliveryConfirmFormRow);
}

/**
 * 저장된 확인서를 고칩니다 — 주로 등록 당시 비어있던 자산번호를 "준비중"에 채워 넣고
 * 상세보기에서 다시 출력하려는 용도입니다. 품목/수량이 바뀔 수 있어서, 연결된 출고/접수
 * 대장 행은 지우고 새로 펼쳐 씁니다(부분 동기화보다 통째로 다시 만드는 쪽이 안전).
 */
export async function updateDeliveryConfirmForm(
  id: string,
  input: DeliveryConfirmFormInput,
): Promise<ActionResult> {
  if (!input.company.trim()) return { ok: false, error: '상호는 필수예요.' };
  if (input.items.length === 0) return { ok: false, error: '품목을 1개 이상 추가해주세요.' };
  for (const item of input.items) {
    if (!item.model.trim()) return { ok: false, error: '품목명을 입력해주세요.' };
    if (item.units.length !== item.quantity) {
      return { ok: false, error: `"${item.model}"의 수량과 자산번호 입력 줄 수가 안 맞아요.` };
    }
  }

  const supabase = createAdminClient();
  const { error: updateError } = await supabase
    .from(DELIVERY_CONFIRM_FORM_TABLE)
    .update(deliveryConfirmFormInputToRow(input))
    .eq('id', id);
  if (updateError) {
    console.error('[confirmForm] updateDeliveryConfirmForm 저장 실패:', updateError);
    return { ok: false, error: `확인서 저장에 실패했어요: ${updateError.message}` };
  }

  const { error: deleteOldError } = await supabase.from(DISPATCH_TABLE).delete().eq('delivery_form_id', id);
  if (deleteOldError) {
    console.error('[confirmForm] updateDeliveryConfirmForm 기존 출고기록 삭제 실패:', deleteOldError);
    return { ok: false, error: `확인서는 저장됐지만 출고/접수 대장 재반영에 실패했어요: ${deleteOldError.message}` };
  }

  const dispatchRows = buildDispatchRowsFromDeliveryForm(input, id);
  if (dispatchRows.length > 0) {
    const { error: insertError } = await supabase.from(DISPATCH_TABLE).insert(dispatchRows);
    if (insertError) {
      console.error('[confirmForm] updateDeliveryConfirmForm 출고기록 재생성 실패:', insertError);
      return { ok: false, error: `확인서는 저장됐지만 출고/접수 대장 재반영에 실패했어요: ${insertError.message}` };
    }
  }

  revalidatePath('/confirm-form');
  revalidatePath('/dispatch');
  return { ok: true };
}

/** 확인서와 거기서 만들어진 출고/접수 대장 행을 전부 지웁니다(테스트 데이터 정리용). */
export async function deleteDeliveryConfirmForm(id: string): Promise<ActionResult> {
  const supabase = createAdminClient();
  await supabase.from(DISPATCH_TABLE).delete().eq('delivery_form_id', id);
  const { error } = await supabase.from(DELIVERY_CONFIRM_FORM_TABLE).delete().eq('id', id);
  if (error) {
    console.error('[confirmForm] deleteDeliveryConfirmForm 실패:', error);
    return { ok: false, error: `삭제에 실패했어요: ${error.message}` };
  }
  revalidatePath('/confirm-form');
  revalidatePath('/dispatch');
  return { ok: true };
}
