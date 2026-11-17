import 'server-only';
import { unstable_cache } from 'next/cache';
import { CATEGORIES } from '@/lib/types';
import { listAssetsFromSheet } from './sheets';

/**
 * 자산번호 → 핵심 정보(시리얼·모델·사양·구분) 색인. IT재고 5개 탭을 매번 읽으면 구글시트
 * 분당 읽기 한도에 걸려 조회가 가끔 실패해서(출고 준비 완료 보고), 서버 인스턴스끼리 공유되는
 * 캐시(5분)에 작게 담아 둡니다. 한 탭이라도 못 읽으면 캐시하지 않습니다(빈 결과가 굳지 않게).
 */
export type AssetBrief = {
  assetId: string;
  category: string;
  brand: string;
  model: string;
  serialNo: string;
  specLabel: string; // 합쳐진 사양(예: I7/12/16/512/X/4050)
  gubun: string; // 구분(예: I5고사노)
};

function isQuota(err: unknown): boolean {
  const e = err as { code?: number; status?: number; message?: string };
  return e?.code === 429 || e?.status === 429 || /quota/i.test(e?.message ?? '');
}

async function readTab(category: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await listAssetsFromSheet(category);
    } catch (err) {
      if (attempt < 2 && isQuota(err)) {
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

async function buildIndex(): Promise<Record<string, AssetBrief[]>> {
  const lists = await Promise.all(CATEGORIES.map(readTab));
  const out: Record<string, AssetBrief[]> = {};
  for (const a of lists.flat()) {
    const id = a.assetId.trim().toUpperCase();
    if (!id) continue;
    (out[id] ??= []).push({
      assetId: id,
      category: a.category,
      brand: a.brand,
      model: a.model,
      serialNo: a.serialNo,
      specLabel: a.specLabel ?? '',
      gubun: a.gubunCode || '',
    });
  }
  return out;
}

const cachedIndex = unstable_cache(buildIndex, ['it-asset-brief-index-v2'], { revalidate: 300 });

let memo: { at: number; index: Record<string, AssetBrief[]> } | null = null;

/**
 * 같은 자산번호가 여러 탭(예: P1024 노트북·모니터)에 있으면 전부 돌려줍니다.
 * hint(일정 품목 글자)에 맞는 품목을 맨 앞에, 그 외엔 노트북·데스크탑 먼저.
 */
export async function findAssetBriefs(assetId: string, hint = ''): Promise<AssetBrief[]> {
  const key = assetId.trim().toUpperCase();
  if (!key) return [];
  if (!memo || Date.now() - memo.at > 300_000) {
    memo = { at: Date.now(), index: await cachedIndex() };
  }
  const list = [...(memo.index[key] ?? [])];
  const score = (c: string) => {
    const hinted =
      (c === '노트북' && /노트북|사노|설노|맥북|갤럭시북|그램/.test(hint)) ||
      (c === '데스크탑' && /데스크|사데|설데|PC/i.test(hint)) ||
      (c === '모니터' && /모니터/.test(hint)) ||
      (c === '빔프로젝트' && /빔|프로젝터/.test(hint));
    return (hinted ? 0 : 10) + ['노트북', '데스크탑', '모니터', '빔프로젝트', '기타주변기기'].indexOf(c);
  };
  return list.sort((a, b) => score(a.category) - score(b.category));
}
