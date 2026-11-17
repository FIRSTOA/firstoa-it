/**
 * 출고 준비 리스트 — 순수 타입/헬퍼(클라이언트·서버 공용).
 * 원본: first-as-search backoffice (fetchImportantEvents · setPrepStart · PrepReportModal buildMessage).
 * 원본은 복합기 준비용이라 IT 일정을 "빼고", 여기는 반대로 IT 일정"만" 보여줍니다.
 */

export type PrepEntry = {
  overhaul_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  handed_off?: boolean | null;
};
export type PrepChecks = Record<string, PrepEntry>;
export type PrepStage = 'overhaul' | 'start' | 'complete';

export const KAKAO_ROOM = '! IT 출고';

export const IT_KEYWORDS = /(모니터|노트북|데스크탑|데스크톱|nas|나스|맥북|갤럭시북)/i;
// 제목에 "IT"가 독립 토큰으로 있으면(예: "★IT/위탁납품/...") IT 일정 — 통합캘린더 IT 필터와 같은 기준
const IT_TOKEN = /(^|[^A-Za-z])IT([^A-Za-z]|$)/;
const LEAVE_KEYWORDS = /(연차|반차|월차|휴가|경조사|교육)/;
const DIRECT_DELIVERY_KEYWORDS = ['직송', '고인돌', '신성씨앤에스', '이엠데이타', '후지필름', '네오정보'];

/**
 * IT 출고 준비 대상인지 — **제목**에 IT 표시/키워드가 있고, 휴가·직송이 아닌 일정.
 * 메모(물품 줄)는 보지 않습니다: 같은 현장의 복합기 일정 메모에 노트북이 같이 적혀 있어
 * 한 현장이 두 번 뜨던 문제(광명엔지니어링) 때문.
 */
export function isItPrepTarget(title: string, _description: string): boolean {
  void _description;
  if (LEAVE_KEYWORDS.test(title)) return false;
  if (DIRECT_DELIVERY_KEYWORDS.some((k) => title.includes(k))) return false;
  return IT_TOKEN.test(title) || IT_KEYWORDS.test(title);
}

const KIND_SEG = /(납품|교체|철수|회수)(\([^)]*\))?\s*$/;
const ITEM_NOISE = /^(소모품|전자|확인서\S*|확인서서명필수)$/;

/**
 * 네이버 일정 제목 구조 — "…-IT/납품(현장)/퍼스트/운영팀/증설/거래처-현장/품목 2대, 소모품/확인서서명필수".
 * 구분(납품/교체/철수) 칸에서 4칸 뒤가 거래처, 5칸 뒤가 품목입니다.
 */
export function parseEventTitle(title: string): { company: string; items: string[] } {
  const parts = title.split('/').map((p) => p.trim());
  const k = parts.findIndex((p) => KIND_SEG.test(p));
  if (k < 0 || !parts[k + 4]) return { company: '', items: [] };
  const items = (parts[k + 5] ?? '')
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !ITEM_NOISE.test(s));
  return { company: parts[k + 4], items };
}

/** 일정 설명의 "물품 : A 2대, B 1대" 줄을 쉼표로 나눔. */
export function parseItemsFromMemo(memo: string): string[] {
  const m = memo.match(/물품\s*[:：]\s*([^\r\n]+)/);
  if (!m) return [];
  return m[1]
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 품목 텍스트들의 "N대" 합 — 완료 보고 기기 줄 수 미리 채우기용(없으면 1). */
export function countUnits(items: string[]): number {
  let n = 0;
  for (const it of items) {
    const m = it.match(/(\d+)\s*대/);
    n += m ? Number(m[1]) : 0;
  }
  return Math.max(1, Math.min(n || 1, 50));
}

/** 일정 제목에서 업체명 추정 — "★IT/납품/업체명/..." 같은 슬래시 구분 제목의 가장 그럴듯한 칸. */
export function guessCompany(title: string): string {
  const parsed = parseEventTitle(title).company;
  if (parsed) return parsed;
  const cleaned = title.replace(/^[^가-힣A-Za-z0-9(]+/, '');
  const parts = cleaned.split('/').map((p) => p.trim()).filter(Boolean);
  const skip = /^(IT|납품|교체|철수|위탁납품|일반|현장|익일|당일|오전|오후|\S*(준비중|완료|오버홀))/;
  return parts.find((p) => !skip.test(p) && !IT_KEYWORDS.test(p)) ?? parts[0] ?? title;
}

export function isPrepDone(e: PrepEntry | undefined): boolean {
  return !!e && !!e.completed_at && !e.handed_off;
}
export function isPrepInProgress(e: PrepEntry | undefined): boolean {
  return !!e && !!e.started_at && !e.completed_at;
}
export function isPrepOverhaul(e: PrepEntry | undefined): boolean {
  return !!e && !!e.overhaul_at;
}

/**
 * 담당자 한 명의 단계를 켜고/끕니다. 준비중을 켜면 다른 진행자는 자동 인수(handed_off) 처리.
 */
export function applyPrepStage(checks: PrepChecks, person: string, stage: PrepStage, on: boolean, nowIso: string): PrepChecks {
  const next: PrepChecks = { ...checks };
  const cur = { ...(checks[person] ?? {}) };
  if (stage === 'overhaul') {
    next[person] = { ...cur, overhaul_at: on ? nowIso : null };
  } else if (stage === 'start') {
    if (on) {
      for (const [name, e] of Object.entries(checks)) {
        if (name !== person && e?.started_at && !e.completed_at) {
          next[name] = { ...e, completed_at: nowIso, handed_off: true };
        }
      }
      next[person] = { ...cur, started_at: nowIso, completed_at: null, handed_off: false };
    } else {
      next[person] = { ...cur, started_at: null };
    }
  } else {
    next[person] = { ...cur, completed_at: on ? nowIso : null, handed_off: false };
  }
  return next;
}

/** 네이버 제목에 붙일 태그 — 사람당 하나, 완료 > 준비중 > 오버홀. */
export function prepTitleTags(checks: PrepChecks): string[] {
  return Object.entries(checks)
    .map(([name, e]) =>
      isPrepDone(e) ? `${name}완료` : isPrepInProgress(e) ? `${name}준비중` : isPrepOverhaul(e) ? `${name}오버홀` : null,
    )
    .filter((t): t is string => !!t);
}

export const APPEARANCE_GRADES = ['A', 'B', 'C'] as const;

export type PrepUnit = {
  serial: string;
  assetId: string;
  grade: string;
  /** 자산번호로 자동 조회(IT재고 → 임대리스트) */
  model?: string;
  gubun?: string; // 구분값(예: I7고설노)
  spec?: string; // CPU/RAM/SSD/HDD/VGA
  category?: string; // 데스크탑이면 외관 등급 안 받음
};
export type PrepPhoto = { path: string; url: string; at: string };

export type PrepReport = {
  id: string;
  eventId: string;
  company: string;
  model: string;
  author: string;
  units: PrepUnit[];
  photos: PrepPhoto[];
  checkedItems: string[];
  note: string;
  message: string;
  sentAt: string | null;
  stockApplied: string[];
};

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export function shortDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y) return ymd;
  return `${m}/${d}(${DAYS[new Date(y, m - 1, d).getDay()]})`;
}

/** 카톡 보고 문구 — 원본 buildMessage 형식(소요시간 제외). */
export function buildPrepMessage(input: {
  date: string;
  kind: string;
  company: string;
  model: string;
  units: PrepUnit[];
  checked: number;
  totalItems: number;
  author: string;
  photoCount: number;
  albumUrl: string;
  note?: string;
}): string {
  const lines = [
    `[출고준비 완료] ${shortDateLabel(input.date)} ${input.kind || '납품'}`,
    `업체명 : ${input.company || '-'}`,
    `모델명 : ${input.model || '-'}`,
    `기기 : ${input.units.length}대 (자산번호 / 모델 / 구분 / 사양 / 시리얼)`,
    ...input.units.map(
      (u, i) =>
        [`${i + 1}) ${u.assetId || '-'}`, u.model || '-', u.gubun || '-', u.spec || '-', u.serial || '-'].join(' / '),
    ),
    `체크리스트 : ${input.checked}/${input.totalItems}`,
    `작성자 : ${input.author || '-'}`,
  ];
  if (input.note?.trim()) lines.push(`비고 : ${input.note.trim()}`);
  if (input.photoCount > 0) {
    lines.push('', `📷 사진 ${input.photoCount}장 모아보기:`, input.albumUrl);
  }
  return lines.join('\n');
}

/** 제목으로 일정 종류(납품/교체/철수) 추정. */
export function eventKindOf(title: string): string {
  if (title.includes('철수')) return '철수';
  if (title.includes('교체')) return '교체';
  return '납품';
}
