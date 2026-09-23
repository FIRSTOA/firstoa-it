import 'server-only';

/**
 * 사진(제품 라벨/시리얼 스티커 등)에서 모델명/스펙/자산번호/시리얼번호를 읽어내는 OCR.
 * 별도 OCR 라이브러리 없이 Claude의 이미지 인식(Anthropic Messages API, vision)을 그대로
 * 씁니다 — 단순 글자 인식보다 "이 중 어떤 숫자가 시리얼번호인지" 맥락까지 판단할 수 있어서
 * 더 정확합니다. ANTHROPIC_API_KEY가 없으면 조용히 "미설정"으로 꺼집니다(다른 선택적
 * 연동들과 동일한 패턴).
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

export function isOcrConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type OcrExtractedFields = {
  model: string;
  spec: string;
  assetId: string;
  serialNumber: string;
};

const EMPTY_RESULT: OcrExtractedFields = { model: '', spec: '', assetId: '', serialNumber: '' };

const PROMPT = `이 사진은 IT 장비(노트북/데스크탑/모니터 등)의 제품 라벨이나 본체, 또는 시리얼 번호
스티커예요. 사진에서 실제로 읽을 수 있는 정보만 뽑아서 아래 JSON 형식으로만 답하세요.
확실하지 않은 값은 빈 문자열로 두세요. 설명이나 다른 텍스트 없이 JSON 객체 하나만 출력하세요.

{
  "model": "모델명(제품명/모델번호)",
  "spec": "사양(CPU/메모리/저장용량 등 라벨에 보이는 스펙 요약)",
  "assetId": "자산번호(회사에서 붙인 자산 스티커 번호, 있다면)",
  "serialNumber": "제조사 시리얼번호(S/N)"
}`;

/** base64Image는 데이터 URL 접두어(data:image/...;base64,) 없이 순수 base64 문자열이어야 합니다. */
export async function extractSaleInfoFromImage(base64Image: string, mediaType: string): Promise<OcrExtractedFields> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('OCR 기능을 쓰려면 관리자가 ANTHROPIC_API_KEY를 설정해야 해요.');

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OCR 요청 실패(${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content ?? []).map((block: { type: string; text?: string }) => block.text ?? '').join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return EMPTY_RESULT;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      model: String(parsed.model ?? '').trim(),
      spec: String(parsed.spec ?? '').trim(),
      assetId: String(parsed.assetId ?? '').trim(),
      serialNumber: String(parsed.serialNumber ?? '').trim(),
    };
  } catch {
    return EMPTY_RESULT;
  }
}
