/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/move.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 2d70fe3d8db9ebeff0db495c7ae6f9c4dd366fc3 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * 이전 확인서 — 기기를 같은 거래처의 다른 주소로 옮김 (유상/무상)
 *  카톡 선행방 '이전' 글(업체 통합검색 › 이전 양식)을 붙여 넣으면 칸이 채워짐 → parseMoveKakao
 *  기기 줄의 자산번호(없으면 기번·순번)로 임대리스트에서 품목·지역·한조를 채움
 */
import { parseDay } from './swap';
import { emptyUnit, isAssetToken, type PullUnit } from './pull';

export type MoveDoc = {
  id: string;
  no: string; // M-261127-01
  ver: number;
  region: string;
  leaseNo: string;
  company: string;
  moveDate: string; // 이전일 YYYY-MM-DD
  requester: string; // 요청자 (영업)
  hanjo: string;
  industry: string;
  delivery: string; // 배송담당 (퍼스트 · 위탁사)
  fromAddr: string; // 이전 전 주소
  toAddr: string; // 이전 후 주소
  addrNote: string; // 주소 특이사항
  paid: '유상' | '무상';
  cost: string; // 이전 설치비
  billing: string; // 청구 방법
  units: PullUnit[];
  custRequester: string; // 요청 담당자 (고객) 성함/번호
  siteFrom: string; // 현장 담당자 (전 사업장)
  siteTo: string; // 현장 담당자 (후 사업장)
  special: string;
  contract: string; // 전자 · 수기 · 확인서 서명 필수
  leaseKind?: string; // 임대리스트 일반/현장 (현황표)
  shipType?: string; // 위탁 · 직송 (위탁사가 있을 때 — 현황표 납품담당)
  leasePeriod?: string; // 임대리스트 계약기간 (현장 단기/장기 가름)
  head?: string;
  consign?: string;
  title?: string;
  savedBy?: string;
  savedAt?: string;
};

export function emptyMove(): MoveDoc {
  return {
    id: '', no: '', ver: 0, region: '', leaseNo: '', company: '', moveDate: '', requester: '', hanjo: '', industry: '', delivery: '퍼스트',
    fromAddr: '', toAddr: '', addrNote: '', paid: '무상', cost: '', billing: '', units: [], custRequester: '', siteFrom: '', siteTo: '', special: '',
    contract: '확인서 서명 필수', leaseKind: '', leasePeriod: '', head: '', consign: '', title: '', shipType: '',
  };
}

/** 기기 줄: 'X4220RX / X0000 / 00X0XXXX000000X' · '모델 / 미부착 / 기번' [IT 가림] */
function parseUnitLine(s: string): PullUnit | null {
  const t = s.split('/').map((x) => x.trim()).filter(Boolean);
  if (t.length < 2) return null;
  const u = emptyUnit();
  u.model = t[0];
  const ai = t.findIndex((x, i) => i > 0 && isAssetToken(x));
  if (ai > 0) {
    u.asset = t[ai];
    u.sn = t.slice(ai + 1).join(' / ');
  } else u.sn = t.slice(1).join(' / ');
  return u;
}

/**
 * 카톡 선행방 '이전' 글 → 이전 확인서 칸
 *  1 캘린더 앞머리글 · 2 날짜 · 3 요청자 · 4 유상/무상(비용) · 5 순번 · 6 업체명 · 7 담당자 성함/번호
 *  8 이전 전 주소 · 9 이전 후 주소 · 10 물품 (+ 기기 줄) · 11 기본료 · 12 기본매수 · 13 장비소유주 · 14 특이사항
 */
export function parseMoveKakao(text: string): { doc: Partial<MoveDoc>; unknown: string[] } {
  const d: Partial<MoveDoc> = {};
  const units: PullUnit[] = [];
  const unknown: string[] = [];
  let inItems = false;
  let name = ''; // '성함' 줄 — 아래 '연락처'와 합침
  /** '10만원' → '100000' · '100,000원' → '100000' */
  const money = (s: string) => {
    const t = String(s ?? '').replace(/\s/g, '');
    const man = /([\d,.]+)만/.exec(t);
    if (man) return String(Math.round(Number(man[1].replace(/,/g, '')) * 10000));
    return /[\d,]+/.exec(t)?.[0]?.replace(/,/g, '') ?? '';
  };
  for (const raw of String(text ?? '').split(/\r?\n/).map((l) => l.trim())) {
    if (!raw || /^이전$/.test(raw)) continue;
    // 머리 줄: '유상이전 (10만원)' · '무상 이전'
    const hd = /^(유상|무상)\s*이전\s*(?:\(([^)]*)\))?/.exec(raw);
    if (hd) {
      d.paid = hd[1] as MoveDoc['paid'];
      if (hd[2]) d.cost = money(hd[2]);
      continue;
    }
    if (/^\(/.test(raw)) continue; // '(고장교체시에는 …)' 같은 설명 줄
    // 항목 이름은 괄호 설명을 빼고 봄: '상호(사업자등록증 유/무)' → 상호 · '날짜(랜선/팩스선 유무)' → 날짜
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
    if (/앞머리|글머리|머리글|캘린더|캐린더/.test(key)) d.head = v;
    else if (/^날짜|이전일/.test(key)) d.moveDate = parseDay(v);
    else if (key === '요청자' || (/담당/.test(key) && /영업|요청/.test(key))) d.requester = v;
    else if (/유상|무상/.test(key)) {
      d.paid = /유상/.test(v) ? '유상' : '무상';
      const c = /\(([^)]*)\)/.exec(v)?.[1]?.trim();
      if (c) d.cost = money(c);
    } else if (key === '순번') d.leaseNo = v.split(/[,\s]/)[0];
    else if (/^업체명|^상호/.test(key)) {
      // 'OO상사 ( 000 )' · '…(순 000)' → 순번 [IT 가림]
      const sn = /\(\s*(?:순\s*)?(\d+)\s*\)\s*$/.exec(v);
      if (sn) d.leaseNo = d.leaseNo || sn[1];
      d.company = v.replace(/\(\s*(?:순\s*)?\d+\s*\)\s*$/, '').trim();
    } else if (/^담당자/.test(key)) d.custRequester = v;
    else if (/^성함|^이름/.test(key)) name = v;
    else if (/^연락처|^전화|^번호/.test(key)) d.custRequester = [name, v].filter(Boolean).join(' ');
    else if (/이전전주소|^현주소|^전주소|^주소$/.test(key)) d.fromAddr = v;
    else if (/이전후주소|^후주소|^새주소|^신규/.test(key)) d.toAddr = v;
    else if (/^물품|^품목/.test(key)) {
      inItems = true;
      // '물품 : ApeosPort-C2560' 처럼 한 줄에 모델만 적은 경우
      for (const x of v.split(/,|\/(?=\s*[A-Za-z가-힣])/).map((y) => y.trim()).filter(Boolean)) {
        const u = parseUnitLine(x) ?? { ...emptyUnit(), model: x.replace(/\s*\d+\s*대$/, '').trim() };
        if (u.model) units.push(u);
      }
    } else if (/^특이사항/.test(key)) d.special = v;
    else if (/기본료|기본매수|장비소유주|유입경로|교체|철수사유|수리/.test(key)) {
      /* 이전 확인서에는 안 씀 */
    } else unknown.push(raw);
  }
  if (!d.custRequester && name) d.custRequester = name;
  if (units.length) d.units = units;
  return { doc: d, unknown };
}

/** 주소 → '서울 송파구' (시·도 + 시·군·구) — 제목용 */
export function shortAddr(a: string): string {
  const t = (a ?? '').replace(/특별시|광역시|특별자치시|특별자치도/g, '').trim().split(/\s+/);
  return t.slice(0, 2).join(' ');
}
