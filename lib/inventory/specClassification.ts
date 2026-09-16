/**
 * 원본 Google Apps Script 대시보드(script.google.com)의 parseGubunAndSpec_ 를 그대로 포팅.
 * "구분"(예: "I7고사데") + "사양(PC라벨)" 원문(예: "I7/12/32/1024/2/3060")으로부터
 * cpuType/gen/tierGroup을 계산합니다. 데스크탑/노트북에만 적용합니다(원본도 그렇게 씀).
 *
 * 실제 노트북/데스크탑 시트 데이터로 검증 완료(각 94%, 94.5% 정상 분류 — 나머지는 원본
 * 대시보드에서도 "확인필요"로 표시될 애플 노트북/원문이 "확인필요"인 경우).
 */

const LOW_SPEC_MAX_GEN = 8;

const TIER_LABEL_MAP: Record<string, string> = {
  고사: '사무용',
  일사: '사무용',
  고설: '설계용',
  일설: '설계용',
};

export type GubunSpecResult = {
  cpuType?: string;
  gen?: number | null;
  tierGroup?: string;
  needsReview?: boolean;
  reason?: string;
  raw?: string;
};

export function parseGubunAndSpec_(
  gubunRaw: string | null | undefined,
  specRaw: string | null | undefined,
): GubunSpecResult {
  if (!gubunRaw) return { needsReview: true, reason: '구분값없음' };

  const v = String(gubunRaw).trim();

  if (v === '맥미니') {
    return { cpuType: 'MacMini', tierGroup: '사무용' };
  }

  if (v.indexOf('확인필요') !== -1) {
    return { raw: v, needsReview: true, reason: '원본확인필요' };
  }

  const m = v.match(/^([A-Za-z0-9]{2})(고사|일사|고설|일설)(데|노)$/);
  if (!m) {
    return { raw: v, needsReview: true, reason: '알수없는패턴' };
  }

  const cpuType = m[1].toUpperCase();
  const tierCode = m[2];
  let tierGroup = TIER_LABEL_MAP[tierCode];

  let gen: number | null = null;
  if (specRaw) {
    const parts = String(specRaw).split('/');
    const genVal = parseInt(parts[1], 10);
    if (!Number.isNaN(genVal)) gen = genVal;
  }

  if (cpuType.charAt(0) === 'I' && gen !== null && gen <= LOW_SPEC_MAX_GEN) {
    tierGroup = '저사양';
  }

  return { cpuType, gen, tierGroup };
}
