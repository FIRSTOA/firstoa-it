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

// ── 반출 확인서(납품/교체/철수 공용 양식) OCR ──────────────────────────────

export type WithdrawalFormItem = {
  category: string; // 품목
  model: string; // 모델명
  serialNumber: string; // 기번
  assetId: string; // 자산번호
};

export type WithdrawalFormFields = {
  companyName: string; // 상호
  date: string; // 반출일/납품일/교체일 (YYYY-MM-DD, 못 읽으면 빈 문자열)
  requester: string; // 요청자/담당자
  reason: string; // 사유 및 특이사항
  items: WithdrawalFormItem[];
};

const EMPTY_WITHDRAWAL_RESULT: WithdrawalFormFields = {
  companyName: '',
  date: '',
  requester: '',
  reason: '',
  items: [],
};

const WITHDRAWAL_FORM_PROMPT = `이 이미지(또는 텍스트)는 "반출 확인서"라는 양식이에요(납품/교체/철수 공용 — 제목 윗줄의
구분 체크박스만 다름). 아래 JSON 형식으로만 답하세요. 확실하지 않은 값은 빈 문자열/빈 배열로
두세요. 설명 없이 JSON 객체 하나만 출력하세요.

{
  "companyName": "상호(거래처명)",
  "date": "반출일 또는 납품일/교체일을 YYYY-MM-DD로 변환(예: '2026년 10월 2일 금요일' → '2026-10-02')",
  "requester": "철수요청자 또는 담당자 이름",
  "reason": "철수사유 & 특이사항 칸의 원문",
  "items": [
    { "category": "품목(노트북/데스크탑/모니터/빔프로젝트/기타주변기기 중 가장 가까운 것)",
      "model": "모델명", "serialNumber": "기번(시리얼번호)", "assetId": "자산번호" }
  ]
}

품목/모델명/기번/자산번호는 표에 여러 칸(보통 2칸)이 있을 수 있어요 — 실제 값이 채워진 칸만
items 배열의 원소 하나로 만드세요(빈 칸은 포함하지 마세요).`;

async function callOcr(
  content: ({ type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | { type: 'text'; text: string })[],
): Promise<string> {
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
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OCR 요청 실패(${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.content ?? []).map((block: { type: string; text?: string }) => block.text ?? '').join('');
}

function parseWithdrawalFormJson(text: string): WithdrawalFormFields {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return EMPTY_WITHDRAWAL_RESULT;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map((it: Record<string, unknown>) => ({
            category: String(it?.category ?? '').trim(),
            model: String(it?.model ?? '').trim(),
            serialNumber: String(it?.serialNumber ?? '').trim(),
            assetId: String(it?.assetId ?? '').trim(),
          }))
          .filter((it: WithdrawalFormItem) => it.model || it.assetId || it.serialNumber)
      : [];
    return {
      companyName: String(parsed.companyName ?? '').trim(),
      date: String(parsed.date ?? '').trim(),
      requester: String(parsed.requester ?? '').trim(),
      reason: String(parsed.reason ?? '').trim(),
      items,
    };
  } catch {
    return EMPTY_WITHDRAWAL_RESULT;
  }
}

/** base64Image는 데이터 URL 접두어 없이 순수 base64여야 합니다. */
export async function extractWithdrawalFormFromImage(base64Image: string, mediaType: string): Promise<WithdrawalFormFields> {
  const text = await callOcr([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
    { type: 'text', text: WITHDRAWAL_FORM_PROMPT },
  ]);
  return parseWithdrawalFormJson(text);
}

/** 이미지 대신 사람이 직접 붙여넣은 텍스트에서 추출합니다(같은 양식을 텍스트로 옮겨 적은 경우). */
export async function extractWithdrawalFormFromText(rawText: string): Promise<WithdrawalFormFields> {
  const text = await callOcr([{ type: 'text', text: `${WITHDRAWAL_FORM_PROMPT}\n\n--- 원문 ---\n${rawText}` }]);
  return parseWithdrawalFormJson(text);
}
