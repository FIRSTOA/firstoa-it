import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey || '',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [
        {
          role: 'user',
          content:
            '네이버쇼핑이나 쿠팡 등에서 "ipTIME N604SR" 공유기의 현재 최저 판매가격을 검색해서, ' +
            '아래 JSON 형식으로만 답하세요. 설명 없이 JSON 객체 하나만 출력하세요.\n' +
            '{ "price": "숫자,콤마,원 형식(예: 22,000원)", "source": "가격을 찾은 사이트 이름" }',
        },
      ],
    }),
  });
  const data = await res.json();
  return NextResponse.json({ status: res.status, data });
}
