import type { SaleInput } from './sales';

/**
 * 판매 등록용 붙여넣기 파서. 실제 사용 문구가 "라벨: 값" 형식(업체명/주소/담당자/모델명/매입가)
 * + 모델명 바로 아래 괄호로 감싼 스펙 줄인 형태라서, 카톡 입고 안내(lib/receivingParser.ts)와는
 * 다른 전용 파서로 만듭니다. 형식이 완전히 같지 않아도 죽지 않도록, 알아본 라벨만 채우고
 * 나머지는 비고에 원문 그대로 보존합니다.
 *
 * 예시:
 *   업체명 : 영인에너지솔루션-상대원 본사
 *   주소 : 경기 성남시 중원구 둔촌대로 474, 113호 영인에너지솔루션
 *   담당자 : 김한솔 070-5090-3106
 *   모델명: LG그램 15Z90T-GP7DL 노트북 2대
 *   (울트라7(S2)-255H/32GB/512GB/내장/15.6인치/윈11프로)
 *   > 매입가: 대당 220만원
 */

export type ParsedSaleGroup = {
  purchaseVendor: string;
  purchasePrice: string;
  salePrice: string;
  model: string;
  spec: string;
  destination: string;
  saleDate: string;
  notes: string;
  quantity: number;
};

const QUANTITY_RE = /(\d+)\s*대/;

function extractLabelValue(line: string, label: string): string | null {
  const m = line.match(new RegExp(`^${label}\\s*[:：]\\s*(.*)$`));
  return m ? m[1].trim() : null;
}

function extractLabeledPrice(line: string, label: string): string | null {
  if (!line.includes(label)) return null;
  const m = line.match(new RegExp(`${label}\\s*[:：]?\\s*(?:대당)?\\s*(.+)$`));
  return (m ? m[1] : line).trim();
}

function blankGroup(destination: string): ParsedSaleGroup {
  return {
    purchaseVendor: '',
    purchasePrice: '',
    salePrice: '',
    model: '',
    spec: '',
    destination,
    saleDate: '',
    notes: '',
    quantity: 1,
  };
}

export function parseSalesPaste(text: string): ParsedSaleGroup[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const groups: ParsedSaleGroup[] = [];
  const sharedNotes: string[] = [];
  let destination = '';
  let current: ParsedSaleGroup | null = null;

  function pushCurrent() {
    if (current) groups.push(current);
    current = null;
  }

  for (const line of lines) {
    const company = extractLabelValue(line, '업체명') ?? extractLabelValue(line, '거래처명');
    if (company !== null) {
      destination = company;
      continue;
    }

    const address = extractLabelValue(line, '주소');
    if (address !== null) {
      sharedNotes.push(`주소: ${address}`);
      continue;
    }

    const contact = extractLabelValue(line, '담당자');
    if (contact !== null) {
      sharedNotes.push(`담당자: ${contact}`);
      continue;
    }

    const modelLine = extractLabelValue(line, '모델명');
    if (modelLine !== null) {
      pushCurrent();
      const qtyMatch = modelLine.match(QUANTITY_RE);
      current = blankGroup(destination);
      current.quantity = qtyMatch ? Number(qtyMatch[1]) : 1;
      current.model = (qtyMatch ? modelLine.slice(0, qtyMatch.index) : modelLine).trim();
      continue;
    }

    // 모델명 바로 아래 괄호로 감싼 스펙 줄: "(울트라7(S2)-255H/32GB/512GB/내장/15.6인치/윈11프로)"
    if (current && !current.spec && line.startsWith('(') && line.endsWith(')')) {
      current.spec = line.slice(1, -1).trim();
      continue;
    }

    const purchasePrice = extractLabeledPrice(line, '매입가');
    if (purchasePrice !== null) {
      if (current) current.purchasePrice = purchasePrice;
      continue;
    }

    const salePrice = extractLabeledPrice(line, '판매금액') ?? extractLabeledPrice(line, '판매가');
    if (salePrice !== null) {
      if (current) current.salePrice = salePrice;
      continue;
    }

    if (current) current.notes = current.notes ? `${current.notes}\n${line}` : line;
    else sharedNotes.push(line);
  }
  pushCurrent();

  if (groups.length === 0) {
    const fallback = blankGroup(destination);
    fallback.notes = text.trim();
    groups.push(fallback);
  } else if (sharedNotes.length > 0) {
    const prefix = sharedNotes.join('\n');
    for (const g of groups) {
      g.notes = g.notes ? `${prefix}\n${g.notes}` : prefix;
    }
  }

  return groups;
}

/** 파싱된 그룹 하나를 실제 등록 행(SaleInput[])으로 펼칩니다 — 1행 = 1대 기준. */
export function expandParsedSaleGroup(group: ParsedSaleGroup): SaleInput[] {
  const base: Omit<SaleInput, 'assetId' | 'serialNumber'> = {
    purchaseVendor: group.purchaseVendor,
    purchasePrice: group.purchasePrice,
    salePrice: group.salePrice,
    model: group.model,
    spec: group.spec,
    destination: group.destination,
    saleDate: group.saleDate,
    notes: group.notes,
  };
  const count = Math.max(Math.trunc(group.quantity) || 1, 1);
  return Array.from({ length: count }, () => ({ ...base, assetId: '', serialNumber: '' }));
}
