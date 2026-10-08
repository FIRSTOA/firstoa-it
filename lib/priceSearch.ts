import 'server-only';

/**
 * 소모품 가격표의 "인터넷가격" 자동 조회 — Claude의 웹 검색 도구(web_search_20250305)로
 * 실시간 최저가를 찾습니다. 별도 검색 API 키 없이 기존 ANTHROPIC_API_KEY만으로 동작합니다
 * (실제로 11번가/다나와/G마켓 등에서 결과를 가져오는 것까지 확인함).
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

export function isPriceSearchConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type PriceSearchResult = { price: string; source: string };

function buildPrompt(item: string, model: string, manufacturer: string): string {
  const query = [manufacturer, model, item].filter(Boolean).join(' ');
  return `네이버쇼핑/쿠팡/다나와/11번가 등에서 "${query}"의 현재 최저 판매가격을 검색해서, 아래 JSON
형식으로만 답하세요. 설명 없이 JSON 객체 하나만 출력하세요. 못 찾으면 price를 빈 문자열로 두세요.

{ "price": "숫자,콤마,원 형식(예: 22,000원)", "source": "가격을 찾은 사이트 이름(예: 쿠팡)" }`;
}

export async function searchInternetPrice(item: string, model: string, manufacturer: string): Promise<PriceSearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('가격 조회를 쓰려면 관리자가 ANTHROPIC_API_KEY를 설정해야 해요.');

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
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: buildPrompt(item, model, manufacturer) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`가격 조회 요청 실패(${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = (data.content ?? []) as { type: string; text?: string }[];
  const textBlocks = content.filter((b) => b.type === 'text').map((b) => b.text ?? '');
  const lastText = textBlocks[textBlocks.length - 1] ?? '';
  const jsonMatch = lastText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { price: '', source: '' };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { price: String(parsed.price ?? '').trim(), source: String(parsed.source ?? '').trim() };
  } catch {
    return { price: '', source: '' };
  }
}
