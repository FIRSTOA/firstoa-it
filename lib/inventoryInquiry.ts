/**
 * 재고 문의 파싱 — 타부서가 보내는 "📌 재고 문의드립니다" 형식 텍스트를 붙여넣으면, 줄마다
 * 품목/CPU종류/사양/화면크기/요청수량을 최대한 뽑아내고, 지금 보유 중인(내부재고 = 상품화
 * 준비중+상품화완료) 자산과 대조해서 충분한지/부족한지 계산합니다.
 *
 * 카톡 붙여넣기 파서(lib/receivingParser.ts)와 같은 철학 — 확실한 것만 정규식으로 뽑고,
 * 못 알아본 부분이 있어도 예외를 던지지 않습니다. 하위 설명 줄("ㄴ 사양: ...")과 헤더
 * 필드 줄("-거래처명 : ...")은 건너뛰고, "OO대"가 있는 줄만 요청 항목으로 봅니다.
 */
import { INTERNAL_STOCK_STATUSES } from './filters';
import type { Asset } from './types';

export type InquiryLine = {
  raw: string;
  category: string; // '' = 인식 못함
  cpuType: string; // '' = 조건 없음 (I5/I7/I9/I3/U5/U7/A5/A7/A9/M1/M2/M3)
  spec: string; // '' = 조건 없음 (사무용/설계용/저사양)
  screenInch: number | null; // 모니터류 화면크기 요청(인치)
  quantity: number;
};

const CATEGORY_PATTERNS: [RegExp, string][] = [
  [/데스크(탑|톱)/, '데스크탑'],
  [/노트북/, '노트북'],
  [/모니터/, '모니터'],
  [/빔프로젝/, '빔프로젝트'],
  [/주변기기/, '기타주변기기'],
];

function detectCategory(line: string): string {
  for (const [re, cat] of CATEGORY_PATTERNS) {
    if (re.test(line)) return cat;
  }
  return '';
}

function detectCpuType(line: string): string {
  const m = line.match(/\b(I[3579]|U[3579]|A[3579]|M[123])\b/i);
  return m ? m[1].toUpperCase() : '';
}

function detectSpec(line: string): string {
  if (line.includes('사무용')) return '사무용';
  if (line.includes('설계용')) return '설계용';
  if (line.includes('저사양')) return '저사양';
  return '';
}

function detectScreenInch(line: string): number | null {
  const m = line.match(/(\d+(?:\.\d+)?)\s*인치/);
  return m ? parseFloat(m[1]) : null;
}

function detectQuantity(line: string): number | null {
  const m = line.match(/(\d+)\s*대/);
  return m ? parseInt(m[1], 10) : null;
}

export function parseInquiryText(text: string): InquiryLine[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: InquiryLine[] = [];
  for (const line of lines) {
    if (line.startsWith('ㄴ')) continue; // 하위 사양 설명 줄 — 메인 줄에 이미 정보가 있다고 보고 건너뜀
    if (line.startsWith('-') || line.startsWith('•') || line.startsWith('📌')) continue; // 헤더 필드 줄
    const quantity = detectQuantity(line);
    if (quantity === null) continue;
    results.push({
      raw: line,
      category: detectCategory(line),
      cpuType: detectCpuType(line),
      spec: detectSpec(line),
      screenInch: detectScreenInch(line),
      quantity,
    });
  }
  return results;
}

/** 요청 조건에 맞는 "내부재고"(상품화준비중+상품화완료) 보유 대수를 셉니다. */
export function countAvailable(items: Asset[], line: InquiryLine): number {
  return items.filter((it) => {
    if (!INTERNAL_STOCK_STATUSES.includes(it.status)) return false;
    if (line.category && it.category !== line.category) return false;
    if (line.cpuType && it.cpuType !== line.cpuType) return false;
    if (line.spec && it.spec !== line.spec) return false;
    if (line.screenInch !== null) {
      const num = parseFloat(it.screen);
      if (Number.isNaN(num) || Math.abs(num - line.screenInch) > 0.1) return false;
    }
    return true;
  }).length;
}

export type InquiryResult = InquiryLine & { available: number; shortage: number };

export function evaluateInquiry(items: Asset[], lines: InquiryLine[]): InquiryResult[] {
  return lines.map((line) => {
    const available = countAvailable(items, line);
    return { ...line, available, shortage: Math.max(0, line.quantity - available) };
  });
}

export function buildReplyMessage(results: InquiryResult[]): string {
  if (results.length === 0) return '';
  const rows = results.map(
    (r, i) => `${i + 1}. ${r.raw} 요청 → 보유 ${r.available}대 (${r.shortage > 0 ? `${r.shortage}대 부족` : '충분'})`,
  );
  return ['재고 확인 결과 안내드립니다.', '', ...rows].join('\n');
}
