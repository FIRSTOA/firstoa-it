/**
 * 구글시트에는 "상태" 컬럼이 따로 없고, "위치" 컬럼 값(예: '임대중', 'J2', '오버홀대기',
 * '판매', '폐기', 사람 이름 등 자유 텍스트)으로부터 상태를 판정합니다.
 *
 * 이 파일은 원본 앱스크립트의 parseLocationStatus_/isMonitorLike_ 를 그대로 이식한 것으로,
 * 서버(lib/inventory/sheets.ts)와 클라이언트(AssetModal의 실시간 미리보기)가 같이 씁니다.
 * server-only 가 아닙니다 — Google API 호출이 없는 순수 문자열 로직이라 브라우저에서도 돌아갑니다.
 */

export function isMonitorLike_(category: string): boolean {
  return category === '모니터' || category === '빔프로젝트';
}

export type LocationStatus = {
  status: string;
  statusRaw?: string;
  locationCode?: string;
};

export function parseLocationStatus_(
  raw: string | null | undefined,
  category: string,
  bigoRaw: string | null | undefined,
): LocationStatus {
  if (!raw) return { status: '미정' };
  const v = String(raw).trim();
  if (v === '임대중') return { status: '임대중' };

  if (isMonitorLike_(category)) {
    if (bigoRaw && /파손|스크래치|스크레치|기스/.test(String(bigoRaw))) {
      return { status: '기타', statusRaw: v };
    }
    if (/^K/i.test(v) || /IT/i.test(v)) {
      return { status: '기타', statusRaw: v };
    }
    if (/^[A-FIL]\d+$/i.test(v)) {
      return { status: '상품화완료', locationCode: v.toUpperCase() };
    }
    if (/수리/i.test(v)) {
      return { status: '수리중' };
    }
    if (/오버홀|PM/i.test(v)) {
      return { status: '상품화준비중' };
    }
    return { status: '기타', statusRaw: v };
  }

  if (/^[A-Za-z]\d+$/.test(v)) {
    return { status: '상품화완료', locationCode: v.toUpperCase() };
  }
  if (/수리/i.test(v)) {
    return { status: '수리중' };
  }
  if (/오버홀|PM/i.test(v)) {
    return { status: '상품화준비중' };
  }
  return { status: '기타', statusRaw: v };
}

/** 비고 첫 세그먼트가 "새기기"인지 (원본 checkIsNewDevice_ 이식) */
export function deriveIsNew(remark: string | null | undefined): boolean {
  if (!remark) return false;
  const first = String(remark).split('/')[0]?.trim();
  return first === '새기기';
}

/** 비고에 "/*"가 포함되면 악성(불량) 표시 (원본 checkIsMalignant_ 이식) */
export function deriveMalicious(remark: string | null | undefined): boolean {
  if (!remark) return false;
  return String(remark).includes('/*');
}
