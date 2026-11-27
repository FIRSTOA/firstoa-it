/* eslint-disable */
// =====================================================================================
// [영업 웹앱 사본 — 고치지 말 것]
// 출처: GitHub FIRSTOA/firstoa-smart-sales-os  lib/inkjet.ts
//       커밋 b33a4c34a8b0161a54f4a2fa4e2b9f5299edf5be — blob 40feb69b10c2d1b10963bbc7ac4af005cfa1b1a8 — 2026-11-27 받음(읽기만)
// 설계: docs/tasks/2026-11-27-sales-export-b33a4c3.md §3-D (E6·E11·E12) — 영업 새 판 받는 법도 거기.
// 본문은 글자 그대로(종이에 직접 안 쓰여도 렌더러 import 로 이어져 같이 받음 — E12).
// =====================================================================================
/**
 * 잉크젯(무한잉크) 기기 → 품목 '무한프린터' (사용자 2026-11-25: "잉크젯은 무한프린터로 다 분류")
 *  - 글자: 무한 · 잉크젯 · 오피스젯 · OfficeJet · 에코탱크 · EcoTank · 정품무한
 *  - HP 잉크젯 모델 번호: 7720 · 7740 · 8210 · 8710 · 9010 · 9020 · 9730 … (HP + 7000~9999 네 자리, 'HP9010' · 'HP-9010' · 'HP 9010')
 *  - 엡손 L6190 · L15160 · WF-C5790 · 브라더 MFC-J / DCP-T · 캐논 G6090 등
 *  레이저 HP(M479 · E87650 · MFP 4303)와는 안 겹치게 숫자 앞 글자를 봄
 */
export function isInkjet(text: string): boolean {
  const s = String(text ?? '');
  if (/무한|잉크젯|오피스젯|officejet|에코\s*탱크|eco\s*tank/i.test(s)) return true;
  if (/\bHP\s*-?\s*(?:OJ\s*-?\s*)?[789]\d{3}(?![\d])/i.test(s)) return true; // HP9010 · HP-9010 · HP OJ 9020
  if (/\b(?:L\d{4,5}|WF-?[A-Z]?\d{3,4}|G[5-7]\d{3})\b/i.test(s) && /엡손|epson|캐논|canon|\bL\d{4,5}\b|WF-/i.test(s)) return true;
  if (/\b(?:MFC|DCP)-?[JT]\d{3,4}/i.test(s)) return true; // 브라더 잉크젯
  return false;
}
