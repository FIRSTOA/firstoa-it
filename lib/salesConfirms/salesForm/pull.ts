/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/pull.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob f4ca3d17b7eda3f5655282c976e1171e01b3846b — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * 철수(반출) 확인서 — 화면·서버·출력이 함께 쓰는 모양과 규칙
 *  구분 4가지: 추심 · 계약종료 · 현장/단기 종료 · 기타(일부반출·보관) — 카톡 '철수사유'로 자동
 *  여러 대 한 장 (반출 품목 표) · 마지막 카운터·파손 점검은 현장에서 종이에 직접
 *  카톡 선행방 '철수' 글(업체 통합검색 › 철수 양식)을 붙여 넣으면 칸이 채워짐 → parsePullKakao
 */
import { parseDay } from './swap';

export type PullType = '추심' | '계약종료' | '현장/단기 종료' | '기타';
export const PULL_TYPES: PullType[] = ['추심', '계약종료', '현장/단기 종료', '기타'];
export const PULL_TYPE_LABEL: Record<PullType, string> = { 추심: '추심', 계약종료: '계약종료', '현장/단기 종료': '현장/단기 종료', 기타: '기타 (일부반출·보관)' };

export type PullUnit = { no: string; item: string; model: string; sn: string; asset: string; rent: string; kindModel?: string };
export type PullDoc = {
  id: string;
  no: string; // R-261124-01
  ver: number;
  region: string;
  type: PullType;
  reason: string; // 카톡 철수사유 그대로 (예: 계약기간내해지(위약금O))
  reasonText: string; // 상세 사유
  leaseNo: string;
  company: string;
  pullDate: string; // 반출일 YYYY-MM-DD
  requester: string; // 철수요청 (영업)
  address: string;
  special: string;
  arrears: string; // 미수금
  penalty: string; // 위약금
  rent: string; // 기본 임대료 (합계)
  avgRent: string; // 연평균 임대료 (합계)
  baseColor: string; // 컬러 기본/초과
  baseMono: string; // 흑백 기본/초과
  start: string; // 임대시작일
  end: string; // 임대종료일
  units: PullUnit[];
  custRequester: string; // 철수 요청자 (고객) 성함/번호
  siteManager: string; // 현장 담당자
  contract: string; // 전자 · 수기 · 확인서 서명 필수 (철수는 보통 확인서 서명)
  shipType?: string; // 위탁 · 직송 (위탁사가 있을 때 — 현황표 납품담당)
  fault?: string; // 현황표용 책임 구분: 거래처사유 · 퍼스트사유 (확인서에는 안 나옴)
  leaseKind?: string; // 임대리스트 '일반/현장' (현황표 구분 계산용)
  /** 제목용 — 앞머리글(특이사항 머리) · 위탁사명(비우면 퍼스트) · 제목(비우면 자동) */
  head?: string;
  consign?: string;
  title?: string;
  savedBy?: string;
  savedAt?: string;
};

export const emptyUnit = (): PullUnit => ({ no: '', item: '', model: '', sn: '', asset: '', rent: '', kindModel: '' });
export function emptyPull(): PullDoc {
  return {
    id: '', no: '', ver: 0, region: '', type: '현장/단기 종료', reason: '', reasonText: '', leaseNo: '', company: '', pullDate: '', requester: '', address: '', special: '',
    arrears: '', penalty: '', rent: '', avgRent: '', baseColor: '', baseMono: '', start: '', end: '', units: [], custRequester: '', siteManager: '', contract: '확인서 서명 필수', head: '', consign: '', title: '', shipType: '', fault: '', leaseKind: '',
  };
}

/** 카톡 철수사유 → 확인서 구분 */
export function pullTypeOf(reason: string): PullType {
  const r = reason ?? '';
  if (/소송|추심/.test(r)) return '추심';
  if (/일부\s*반출|보관|기타/.test(r)) return '기타';
  if (/현장|단기/.test(r)) return '현장/단기 종료';
  if (/해지|종료|폐업|파산|부도|이전|이사|타사|미사용|사용\s*안/.test(r)) return '계약종료';
  return '계약종료';
}

const ASSET = /^[A-Z]{1,2}\d{3,6}$/i;
/** 자산번호 자리 값: 'X0000' 같은 번호 또는 '미부착' [IT 가림] */
export const isAssetToken = (x: string) => ASSET.test(x) || /^미부착$/.test(x);
export const isRealAsset = (x: string) => ASSET.test((x ?? '').trim());
/** 기기 줄: 'NT551XDA / X0000 / XXX000XX000000X / ₩100,000' · 'S27HG314EK / 27인치 / X0000 / 0XXX… / ₩8,000' [IT 가림] */
function parseUnitLine(s: string): PullUnit | null {
  const t = s.split('/').map((x) => x.trim()).filter(Boolean);
  if (t.length < 2) return null;
  const u = emptyUnit();
  const rent = t.find((x) => /^₩/.test(x));
  if (rent) u.rent = rent.replace(/\s/g, '');
  const inch = t.find((x) => /^\d{2}\s*인치$/.test(x));
  if (inch) u.kindModel = inch.replace(/\D/g, '');
  const rest = t.filter((x) => x !== rent && x !== inch);
  const ai = rest.findIndex((x, i) => i > 0 && isAssetToken(x));
  u.model = rest[0] ?? '';
  if (ai > 0) {
    u.asset = rest[ai];
    u.sn = rest.slice(ai + 1).join(' / ');
  } else u.sn = rest.slice(1).join(' / ');
  return u;
}

/**
 * 카톡 선행방 '철수' 글 → 철수 확인서 칸
 *  1 캘린더 앞머리글 · 2 날짜 · 3 요청자 · 4 철수사유(- 상세) · 5 업체명(순 ○○) · 6 담당자 · 7 주소 · 8 물품 (+ 기기 줄) · 9 특이사항
 */
export function parsePullKakao(text: string): { doc: Partial<PullDoc>; unknown: string[] } {
  const d: Partial<PullDoc> = {};
  const units: PullUnit[] = [];
  const unknown: string[] = [];
  let inItems = false;
  let tableHead = false; // '순 자산번호 시리얼번호(기번)' 머리줄 다음 줄들 = 기기 표
  let name = '';
  let model = ''; // '물품 : SL-X3220NR' (기기 표에 모델이 없을 때 채움)
  /** '11/26' · '26.11.26' · '2026년 11월 26일' → YYYY-MM-DD */
  const dayOf = (v: string) => {
    const a = parseDay(v);
    if (a) return a;
    const m = /(\d{1,2})\s*[/월.\-]\s*(\d{1,2})/.exec(v);
    if (!m) return '';
    const now = new Date(Date.now() + 9 * 3600_000);
    const mo = +m[1];
    const y = mo < now.getUTCMonth() + 1 - 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    return `${y}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  };
  // 카톡에서 기기 줄이 끊긴 경우: 'SL-X3220NR / X0000' + ' / 0X0XXXXX00000XX / ₩55,000' → 한 줄로 (2026-11-24 OO상사) [IT 가림]
  const lines: string[] = [];
  for (const l of String(text ?? '').split(/\r?\n/).map((x) => x.trim())) {
    if (/^\//.test(l) && lines.length && /\//.test(lines[lines.length - 1])) lines[lines.length - 1] = `${lines[lines.length - 1]} ${l}`;
    else lines.push(l);
  }
  for (const raw of lines) {
    if (!raw || /^철수$/.test(raw)) continue;
    // 기기 표: '순 자산번호 시리얼번호(기번)' / '0000 X0000 0X0XXXXX0000XXX' [IT 가림]
    if (/^순\s+.*(자산|시리얼|기번)/.test(raw)) {
      tableHead = true;
      continue;
    }
    const tb = /^(\d{2,6})\s+(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(raw);
    if (tableHead && tb && !/[:：]/.test(raw)) {
      units.push({ ...emptyUnit(), no: tb[1], asset: isAssetToken(tb[2]) ? tb[2] : '', sn: isAssetToken(tb[2]) ? tb[3] : `${tb[2]} ${tb[3]}`, model: (tb[4] ?? '').trim() });
      continue;
    }
    tableHead = tableHead && !!tb;
    // 항목 이름 안의 '/'·괄호 설명은 허용: '담당자 성함/번호' · '상호(사업자등록증 유/무)' · '캐린더 글머리에 중요내용 넣어줘야할사항'
    const m = /^(?:\d+\s*[.)]\s*)?([^:：]{1,40}?)\s*[:：]\s*(.*)$/.exec(raw);
    if (!m) {
      const u = inItems ? parseUnitLine(raw) : null;
      if (u) units.push(u);
      else if (!/^\d+\s*[.)]?\s*$/.test(raw)) unknown.push(raw);
      continue;
    }
    const key = m[1].replace(/\([^)]*\)/g, '').replace(/\s+/g, '');
    const v = m[2].trim();
    inItems = false;
    if (/앞머리|글머리|머리글|캘린더|캐린더/.test(key)) d.head = v; // 제목 맨 앞
    else if (/^날짜|반출일|철수일/.test(key)) d.pullDate = dayOf(v);
    else if (key === '요청자' || (/담당/.test(key) && /영업|요청/.test(key))) d.requester = v.split('/').map((x) => x.trim()).filter(Boolean).pop() ?? v;
    else if (/철수사유|교체\/?철수사유|^사유/.test(key)) {
      const [r, ...rest] = v.split(/\s+[-–]\s+/);
      d.reason = r.trim();
      d.type = pullTypeOf(r);
      if (rest.length) d.reasonText = rest.join(' - ').trim();
    } else if (/^업체명|^상호/.test(key)) {
      const sn = /\(\s*(?:순\s*)?(\d+)\s*\)\s*$/.exec(v);
      if (sn) d.leaseNo = sn[1];
      d.company = v.replace(/\(\s*(?:순\s*)?\d+\s*\)\s*$/, '').trim();
    } else if (key === '순번') d.leaseNo = v.split(/[,\s]/)[0];
    else if (/^담당자/.test(key)) d.custRequester = v;
    else if (/^성함|^이름/.test(key)) name = v;
    else if (/^연락처|^전화/.test(key)) d.custRequester = [name, v].filter(Boolean).join(' ');
    else if (/주소/.test(key)) d.address = v;
    else if (/^물품|^품목|^모델/.test(key)) {
      inItems = true;
      if (v) {
        const u = parseUnitLine(v);
        if (u) units.push(u);
        else model = v.replace(/\s*\d+\s*대\s*$/, '').trim();
      }
    } else if (/^특이사항|^기타/.test(key)) d.special = [d.special, v].filter(Boolean).join(' · ');
    else if (/장비소유주|유입경로|수리/.test(key)) {
      /* 철수 확인서에는 안 씀 */
    } else unknown.push(raw);
  }
  if (!d.custRequester && name) d.custRequester = name;
  // 미수금(미납금) · 위약금: 항목 줄이든 특이사항 글 안이든 '미납금: 978,000원' · '위약금 302,500원' (2026-11-24)
  const moneyOf = (re: RegExp) => {
    const m = re.exec(String(text ?? ''));
    return m ? String(Number(m[1].replace(/,/g, '')) * (/만/.test(m[2] ?? '') ? 10000 : 1)) : '';
  };
  const arrears = moneyOf(/미(?:납|수)\s*(?:금|액)\s*[:：]?\s*₩?\s*([\d,]+)\s*(만)?\s*원?/);
  const penalty = moneyOf(/위약금\s*[:：]?\s*₩?\s*([\d,]+)\s*(만)?\s*원?/);
  if (arrears && arrears !== '0') d.arrears = arrears;
  if (penalty && penalty !== '0') d.penalty = penalty;
  // '물품 : SL-X3220NR' — 기기 표에 모델이 비어 있으면 채움 · 기기 표가 없으면 그 모델로 한 대
  if (model) {
    if (units.length) units.forEach((u) => (u.model ||= model));
    else units.push({ ...emptyUnit(), model });
  }
  if (!d.leaseNo && units[0]?.no) d.leaseNo = units[0].no;
  if (units.length) d.units = units;
  return { doc: d, unknown };
}

/** 금액 합계 ('₩100,000' + '80,000원' …) → '₩180,000' (없으면 '') */
export function sumWon(xs: string[]): string {
  const n = xs.reduce((s, x) => s + (Number(String(x ?? '').replace(/[^\d]/g, '')) || 0), 0);
  return n ? `₩${n.toLocaleString()}` : '';
}
export const isMfpItem = (item: string) => /복합기|프린터/.test(item ?? '');
