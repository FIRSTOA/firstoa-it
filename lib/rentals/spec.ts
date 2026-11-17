import { CATEGORIES } from '@/lib/types';

/** 임대리스트 한 건 — 입고 등록의 자산번호 검색 결과로 씁니다. */
export type RentalAssetHit = {
  assetId: string;
  vendorName: string;
  siteName: string;
  status: string;
  contractDate: string;
  item: string;
  manufacturer: string;
  model: string;
  serialNo: string;
  /** 옵션1~4 원문(CPU / 램·SSD / 그래픽 / 윈도우) */
  options: string[];
  category: string; // CATEGORIES 중 하나로 추정, 못 정하면 ''
  cpu: string;
  ram: string;
  storage: string;
};

/** 임대리스트 품목명 → IT재고 품목(CATEGORIES). 못 정하면 ''. */
export function rentalItemToCategory(item: string, model = ''): string {
  const t = `${item} ${model}`.toUpperCase();
  if (/노트북|맥북|NOTEBOOK|LAPTOP/.test(t)) return '노트북';
  if (/데스크|DESKTOP|본체|조립PC|미니PC/.test(t)) return '데스크탑';
  if (/모니터|MONITOR/.test(t)) return '모니터';
  if (/빔|프로젝터|PROJECTOR|스크린/.test(t)) return '빔프로젝트';
  const exact = CATEGORIES.find((c) => item.trim() === c);
  return exact ?? '';
}

/**
 * 옵션2(램/SSD) 원문에서 RAM·저장용량을 최대한 뽑습니다. 예: "16G/512G", "램16 / SSD 256",
 * "8GB, 256GB SSD". 확실하지 않으면 빈 값으로 두고 원문은 사양 힌트로 보여줍니다.
 */
export function parseRamStorage(option2: string): { ram: string; storage: string } {
  const text = option2.toUpperCase();
  let ram = '';
  let storage = '';
  const ramTagged = text.match(/(?:램|RAM|메모리)\s*:?\s*(\d{1,3})/);
  const ssdTagged = text.match(/(?:SSD|HDD|NVME)\s*:?\s*(\d+(?:\.\d+)?)\s*(T|TB)?/) ?? text.match(/(\d+(?:\.\d+)?)\s*(T|TB|G|GB)?\s*(?:SSD|HDD|NVME)/);
  if (ramTagged) ram = ramTagged[1];
  if (ssdTagged) storage = ssdTagged[2]?.startsWith('T') ? String(Number(ssdTagged[1]) * 1000) : ssdTagged[1];
  if (!ram || !storage) {
    const nums = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(TB|T|GB|G)?/g)].map((m) => ({
      n: Number(m[1]),
      tb: (m[2] ?? '').startsWith('T'),
    }));
    for (const { n, tb } of nums) {
      if (!ram && !tb && n > 0 && n <= 128) ram = String(n);
      else if (!storage && (tb || n >= 120)) storage = String(tb ? n * 1000 : n);
    }
  }
  return { ram, storage };
}

export function rentalRowToHit(row: Record<string, unknown>): RentalAssetHit {
  const s = (v: unknown) => String(v ?? '').trim();
  const options = [row.option1, row.option2, row.option3, row.option4].map(s);
  const { ram, storage } = parseRamStorage(options[1]);
  return {
    assetId: s(row.asset_code).toUpperCase(),
    vendorName: s(row.vendor_name),
    siteName: s(row.site_name),
    status: s(row.status),
    contractDate: s(row.contract_date),
    item: s(row.item),
    manufacturer: s(row.manufacturer),
    model: s(row.model_name),
    serialNo: s(row.serial_number),
    options,
    category: rentalItemToCategory(s(row.item), s(row.model_name)),
    cpu: options[0],
    ram,
    storage,
  };
}
