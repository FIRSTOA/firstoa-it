import { NextRequest, NextResponse } from 'next/server';
import { extractSaleInfoFromImage, extractWithdrawalFormFromImage, isOcrConfigured } from '@/lib/ocr';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 사진 OCR 전용 API 라우트입니다. Server Action으로 큰 base64 문자열을 직접 넘기면
 * Next.js RSC 직렬화가 "Maximum array nesting exceeded" 에러를 던지는 걸 실측으로
 * 확인했습니다(리사이즈해도 문자열 자체가 길면 발생) — Route Handler는 이 제한이 없어서
 * 사진 업로드는 전부 여기로 옮겼습니다. 텍스트만 보내는 OCR(반출확인서 텍스트 붙여넣기)은
 * 문자열이 짧아 해당 없어서 그대로 Server Action에 둡니다.
 */
export async function POST(req: NextRequest) {
  if (!isOcrConfigured()) {
    return NextResponse.json({ ok: false, error: 'OCR 기능을 쓰려면 관리자가 ANTHROPIC_API_KEY를 설정해야 해요.' });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.base64 !== 'string' || typeof body.mediaType !== 'string') {
    return NextResponse.json({ ok: false, error: '잘못된 요청이에요.' }, { status: 400 });
  }

  try {
    if (body.kind === 'withdrawal-form') {
      const fields = await extractWithdrawalFormFromImage(body.base64, body.mediaType);
      return NextResponse.json({ ok: true, fields });
    }
    // 기본값('label'): 판매/실재고조사/입고 사진 일괄에서 쓰는 자산번호/시리얼/모델 인식
    const fields = await extractSaleInfoFromImage(body.base64, body.mediaType);
    return NextResponse.json({ ok: true, fields });
  } catch (err) {
    console.error('[api/ocr-image] 실패:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'OCR 인식에 실패했어요.' });
  }
}
