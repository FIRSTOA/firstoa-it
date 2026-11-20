/**
 * works 줄 → 임시 거래처 묶기, 임시 거래처 → 우리 거래처 행 맞추기 — import 없는 순수 함수.
 * 설계: docs/tasks/2026-11-20-contract-management.md §3-2.
 * 줄에는 호출하는 쪽이 nameKey(vendorName)·vendorCodeKey 결과를 미리 넣어 줌(그래서 import 가 없음).
 */

export type GroupRow = {
  assetId: number;
  vendorName: string;
  nameKey: string; // nameKey(vendorName)
  codeKey: string; // vendorCodeKey(ecount_code) — 없으면 ''
};

export type WorksGroup<R extends GroupRow = GroupRow> = {
  /** 'code:<코드>' | 'name:<이름 키>' */
  key: string;
  name: string; // 가장 많이 나온 거래처명(같으면 먼저 나온 것)
  nameKeys: string[];
  codes: string[];
  assetIds: number[];
  rows: R[];
};

function mostCommonName(rows: GroupRow[]): string {
  const count = new Map<string, number>();
  for (const r of rows) {
    const n = r.vendorName.trim();
    if (n) count.set(n, (count.get(n) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [n, c] of count) {
    if (c > bestN) {
      best = n;
      bestN = c;
    }
  }
  return best;
}

/** 코드 있는 줄은 코드로, 코드 없는 줄은 이름 키로 묶고, 이름 키가 같은 코드 묶음이 있으면 거기에 합침. 이름도 코드도 없는 줄은 뺌 */
export function groupWorksRows<R extends GroupRow>(rows: R[]): WorksGroup<R>[] {
  const byCode = new Map<string, R[]>();
  const nameOnly: R[] = [];
  for (const r of rows) {
    if (r.codeKey) {
      const list = byCode.get(r.codeKey);
      if (list) list.push(r);
      else byCode.set(r.codeKey, [r]);
    } else if (r.nameKey) {
      nameOnly.push(r);
    }
  }
  const codeGroups = [...byCode.entries()].map(([code, rs]) => ({ code, rows: rs }));
  // 이름 키가 같은 코드 묶음을 찾을 때 "코드 줄"만 기준(이름 줄이 합쳐져도 기준이 안 흔들리게)
  const codeNameKeys = codeGroups.map((g) => new Set(g.rows.map((x) => x.nameKey)));
  const byName = new Map<string, R[]>();
  for (const r of nameOnly) {
    // 이름 키가 같은 코드 묶음이 여럿이면 줄이 가장 많은 것(같으면 먼저 만든 것)
    let target = -1;
    for (let i = 0; i < codeGroups.length; i++) {
      if (codeNameKeys[i].has(r.nameKey) && (target < 0 || codeGroups[i].rows.length > codeGroups[target].rows.length)) target = i;
    }
    if (target >= 0) codeGroups[target].rows.push(r);
    else {
      const list = byName.get(r.nameKey);
      if (list) list.push(r);
      else byName.set(r.nameKey, [r]);
    }
  }
  const make = (key: string, rs: R[]): WorksGroup<R> => ({
    key,
    name: mostCommonName(rs) || key.replace(/^(code|name):/, ''),
    nameKeys: [...new Set(rs.map((r) => r.nameKey).filter(Boolean))],
    codes: [...new Set(rs.map((r) => r.codeKey).filter(Boolean))],
    assetIds: rs.map((r) => r.assetId),
    rows: rs,
  });
  return [
    ...codeGroups.map((g) => make(`code:${g.code}`, g.rows)),
    ...[...byName.entries()].map(([k, rs]) => make(`name:${k}`, rs)),
  ];
}

export type SavedClientKeys = {
  id: string;
  name: string;
  nameKey: string;
  aliasKeys: string[];
  vendorCodes: string[];
  seenAssetIds: number[];
};

export type MatchMethod = 'asset' | 'code' | 'name' | 'new';

export type GroupMatch<R extends GroupRow = GroupRow, S extends SavedClientKeys = SavedClientKeys> = {
  group: WorksGroup<R>;
  client: S | null;
  by: MatchMethod;
  /** works 이름이 우리 이름과 달라졌을 때(줄 id·코드로 찾았는데 이름이 다름) */
  renamed: { from: string; to: string } | null;
  /** 같은 묶음이 다른 우리 행에도 맞을 때 그 행들 — "거래처가 둘로 나뉘어 있어요" */
  splitWith: S[];
};

/** 맞추기 순서: works 줄 id > 거래처 코드 > 이름(주 이름·다른 표기). 없으면 새 거래처 */
export function matchClients<R extends GroupRow, S extends SavedClientKeys>(
  groups: WorksGroup<R>[],
  saved: S[],
): GroupMatch<R, S>[] {
  return groups.map((group) => {
    const ids = new Set(group.assetIds);
    const codes = new Set(group.codes);
    const names = new Set(group.nameKeys);
    const byAsset: { c: S; n: number }[] = [];
    const byCode: S[] = [];
    const byName: S[] = [];
    for (const c of saved) {
      const n = c.seenAssetIds.filter((id) => ids.has(id)).length;
      if (n > 0) byAsset.push({ c, n });
      if (c.vendorCodes.some((x) => codes.has(x))) byCode.push(c);
      if (names.has(c.nameKey) || c.aliasKeys.some((k) => names.has(k))) byName.push(c);
    }
    let client: S | null = null;
    let by: MatchMethod = 'new';
    if (byAsset.length) {
      client = byAsset.reduce((a, b) => (b.n > a.n ? b : a)).c; // 겹치는 줄이 가장 많은 행(같으면 먼저)
      by = 'asset';
    } else if (byCode.length) {
      client = byCode[0];
      by = 'code';
    } else if (byName.length) {
      client = byName[0];
      by = 'name';
    }
    const all = new Map<string, S>();
    for (const c of [...byAsset.map((x) => x.c), ...byCode, ...byName]) all.set(c.id, c);
    const chosen = client;
    const splitWith = chosen ? [...all.values()].filter((c) => c.id !== chosen.id) : [];
    const renamed =
      chosen && (by === 'asset' || by === 'code') && group.name && !names.has(chosen.nameKey) && !chosen.aliasKeys.some((k) => names.has(k))
        ? { from: chosen.name, to: group.name }
        : null;
    return { group, client, by, renamed, splitWith };
  });
}
