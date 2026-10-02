/**
 * app/api/ocr-image의 클라이언트 쪽 호출 헬퍼 — 사진 OCR을 쓰는 모든 화면(판매/실재고조사/
 * 입고 사진 일괄/반출확인서)이 공유합니다. Server Action이 아니라 fetch인 이유는
 * app/api/ocr-image/route.ts 주석 참고. 타입은 lib/ocr.ts(server-only) 걸 type-only로만
 * 가져옵니다 — `import type`은 번들에서 완전히 지워져서 server-only 가드에 안 걸립니다.
 */
import type { OcrExtractedFields, WithdrawalFormFields } from './ocr';

export type LabelOcrResult = { ok: true; fields: OcrExtractedFields } | { ok: false; error: string };
export type WithdrawalFormOcrResult = { ok: true; fields: WithdrawalFormFields } | { ok: false; error: string };

async function postOcrImage(base64: string, mediaType: string, kind?: 'withdrawal-form') {
  try {
    const res = await fetch('/api/ocr-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, mediaType, kind }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: '네트워크 오류로 사진을 보내지 못했어요.' };
  }
}

export async function scanLabelImage(base64: string, mediaType: string): Promise<LabelOcrResult> {
  return postOcrImage(base64, mediaType);
}

export async function scanWithdrawalFormImage(base64: string, mediaType: string): Promise<WithdrawalFormOcrResult> {
  return postOcrImage(base64, mediaType, 'withdrawal-form');
}
