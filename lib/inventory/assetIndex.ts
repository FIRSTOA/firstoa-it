import 'server-only';
import { unstable_cache } from 'next/cache';
import type { Asset } from '@/lib/types';
import { listAllAssets } from './sheets';
import { isQuotaFailure } from './tabRead';

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

/**
 * 5탭 한 번에 읽기(listAllAssets — 구글 읽기 1회, 예전엔 탭마다 1회). 못 읽은 탭이 전부 읽기 한도(429)면
 * 4초·8초 뒤 두 번까지 다시(예전 탭별 재시도와 같은 간격), 그래도 못 읽었거나 다른 이유면 throw(빈 결과를 캐시하지 않게).
 */
async function readAllTabs(): Promise<Asset[]> {
  for (let attempt = 0; ; attempt++) {
    const read = await listAllAssets();
    if (read.failed.length === 0) return read.assets;
    if (attempt < 2 && read.failed.every(isQuotaFailure)) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    throw new Error(`IT재고 ${read.failed.map((f) => f.tab).join('·')} 탭을 못 읽었어요: ${read.failed[0].message}`);
  }
}

async function buildIndex(): Promise<Record<string, AssetBrief[]>> {
  const out: Record<string, AssetBrief[]> = {};
  for (const a of await readAllTabs()) {
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
