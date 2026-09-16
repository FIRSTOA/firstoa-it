import { CATEGORIES } from './types';
import type { ReceivingInput } from './receiving';

/**
 * 카톡으로 오는 입고 안내 문구를 붙여넣기 한 번으로 등록할 수 있게 파싱합니다. 문구 형식이
 * 매번 완전히 똑같지 않을 수 있어서, "확실한 것"(수량/품목/매입가/담당자/자산번호 목록)만
 * 정규식으로 뽑고 나머지는 전부 비고에 원문 그대로 보존합니다 — 억지로 브랜드/모델을 잘라내다
 * 잘못 나누는 것보다, 미리보기에서 사람이 한 번 더 보고 고치는 쪽이 안전합니다.
 */

export type ParsedReceivingGroup = {
  kind: string;
  category: string;
  model: string;
  vendor: string;
  purchasePrice: string;
  manager: string;
  notes: string;
  quantity: number;
  /** 채워져 있으면 quantity 대신 이 자산번호들로 한 건씩 생성됩니다. */
  assetIds: string[];
};

const QUANTITY_RE = /(\d+)\s*대/;
const VENDOR_RE = /(\S+?)에서/;
const ASSET_ID_TOKEN_RE = /^[A-Za-z]{1,3}\d{1,6}$/;

function stripLeadingBullet(line: string): string {
  return line.replace(/^[-•]\s*/, '');
}

function stripQuotePrefix(line: string): string {
  return line.replace(/^[>※]\s*/, '');
}

function extractCategory(line: string): { category: string; rest: string } {
  for (const c of CATEGORIES) {
    if (line.includes(c)) {
      return { category: c, rest: line.replace(c, ' ') };
    }
  }
  return { category: '', rest: line };
}

/** "삼성 LS24D304GAKXKR_24인치 모니터 10대" 같은 품목 줄인지 확인하고 수량/품목/모델을 뽑습니다. */
function parseItemLine(rawLine: string): { category: string; model: string; quantity: number } | null {
  const line = stripLeadingBullet(rawLine).trim();
  const qtyMatch = line.match(QUANTITY_RE);
  if (!qtyMatch || qtyMatch.index === undefined) return null;
  const quantity = Number(qtyMatch[1]);
  const before = line
    .slice(0, qtyMatch.index)
    .replace(/[-–—]\s*$/, '')
    .trim();
  const { category, rest } = extractCategory(before);
  const model = rest.replace(/\s+/g, ' ').trim();
  return { category, model, quantity };
}

/** "X8783, X0024, ..." 처럼 자산번호만 콤마로 나열된 줄인지 확인합니다. */
function isAssetIdListLine(line: string): boolean {
  const tokens = line
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => ASSET_ID_TOKEN_RE.test(t));
}

function extractPurchasePrice(line: string): string {
  const match = line.match(/매입가\s*[:：]?\s*(?:대당)?\s*(.+)$/);
  return (match ? match[1] : line).trim();
}

export function parseReceivingPaste(text: string, defaultKind: string): ParsedReceivingGroup[] {
  const lines = text.split('\n');
  const headingIndex = lines.findIndex((l) => l.trim() !== '');

  let kind = defaultKind;
  let vendor = '';
  if (headingIndex >= 0) {
    const heading = lines[headingIndex];
    const vendorMatch = heading.match(VENDOR_RE);
    if (vendorMatch) vendor = vendorMatch[1];
    if (heading.includes('렌탈')) kind = '렌탈입고예정';
  }

  const groups: ParsedReceivingGroup[] = [];
  let current: ParsedReceivingGroup | null = null;

  function pushCurrent() {
    if (current) groups.push(current);
    current = null;
  }

  function appendNote(line: string) {
    const clean = stripQuotePrefix(line);
    if (!clean) return;
    if (current) current.notes = current.notes ? `${current.notes}\n${clean}` : clean;
  }

  for (let i = 0; i < lines.length; i++) {
    if (i === headingIndex) continue;
    const line = lines[i].trim();
    if (!line) continue;

    if (current && current.assetIds.length === 0 && isAssetIdListLine(line)) {
      current.assetIds = line
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      continue;
    }

    const item = parseItemLine(line);
    if (item) {
      pushCurrent();
      current = {
        kind,
        category: item.category,
        model: item.model,
        vendor,
        purchasePrice: '',
        manager: '',
        notes: '',
        quantity: item.quantity,
        assetIds: [],
      };
      continue;
    }

    if (line.includes('매입가')) {
      if (current) current.purchasePrice = extractPurchasePrice(line);
      continue;
    }

    if (line.startsWith('@')) {
      if (current) current.manager = line.slice(1).trim();
      continue;
    }

    appendNote(line);
  }
  pushCurrent();

  if (groups.length === 0) {
    // 형식을 하나도 못 알아본 경우 — 원문을 통째로 비고에 담아 최소 1건은 만들어서
    // 데이터를 잃지 않게 합니다. 미리보기에서 사람이 나머지를 채우면 됩니다.
    groups.push({
      kind,
      category: '',
      model: '',
      vendor,
      purchasePrice: '',
      manager: '',
      notes: text.trim(),
      quantity: 1,
      assetIds: [],
    });
  }

  return groups;
}

/** 파싱된 그룹 하나를 실제 등록 행(ReceivingInput[])으로 펼칩니다. */
export function expandParsedGroup(group: ParsedReceivingGroup): ReceivingInput[] {
  const base: Omit<ReceivingInput, 'assetId'> = {
    kind: group.kind,
    status: '입고대기',
    category: group.category,
    brand: '',
    model: group.model,
    cpu: '',
    spec: '',
    ram: '',
    storage: '',
    screen: '',
    vendor: group.vendor,
    purchasePrice: group.purchasePrice,
    expectedDate: '',
    manager: group.manager,
    notes: group.notes,
    serialNumber: '',
    location: '',
  };

  if (group.assetIds.length > 0) {
    return group.assetIds.map((assetId) => ({ ...base, assetId }));
  }

  const count = Math.max(Math.trunc(group.quantity) || 1, 1);
  return Array.from({ length: count }, () => ({ ...base, assetId: '' }));
}
