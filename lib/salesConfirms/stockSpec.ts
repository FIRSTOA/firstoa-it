/**
 * IT재고 사양 글자(한 칸 — 예 "I7/12/16/512/X/4050", "A5/56/16/512/2/내장") → 출고사양 칸별 값 (순수 함수 — import type 만).
 * 2026-11-27 사용자: "자산번호를 넣으면 CPU·RAM·SSD 등도 자동으로 들어가야" — 확인서 기기 칸 자동 채우기에 씀(빈 칸만).
 *
 * IT재고 시트 '사양' 칸 차례 = CPU / 세대 / RAM / SSD / HDD / 그래픽 (임대리스트 대신 쓸 때도 같은 꼴 — app/shipment-prep/reportActions.ts lookupUnitByAsset).
 * 자신 없으면 비움: 조각이 6개(세대 있음) 또는 5개(세대 없음)이고, 첫 조각이 CPU 꼴(영문+숫자)일 때만 읽음. 그 밖 = {}(옆에 "IT재고: …" 보이기만).
 * 단위: RAM = GB, SSD = 10 미만이면 TB(1 → 1TB) 아니면 GB, HDD = 100 미만이면 TB(2 → 2TB) 아니면 GB, X·없음·- = 'X'.
 * OS·인치는 IT재고 사양 칸에 없어서 안 채움.
 */
import type { SalesSpec } from './types';

const CPU_RE = /^[A-Za-z]{1,4}\d{1,2}[A-Za-z]{0,2}$/; // I5 · I7 · A5 · R7 · M1 · I5U …
const NONE_RE = /^(x|없음|무|-+|none)$/i;
const NUM_RE = /^(\d+(?:\.\d+)?)\s*(gb|g|tb|t)?$/i;

function capacity(raw: string, smallIsTb: number): string {
  const t = raw.trim();
  if (!t) return '';
  if (NONE_RE.test(t)) return 'X';
  const m = NUM_RE.exec(t);
  if (!m) return t; // 숫자 꼴이 아니면 글자 그대로(예: "256*2")
  const n = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'tb' || unit === 't') return `${n}TB`;
  if (unit === 'gb' || unit === 'g') return `${n}GB`;
  return n < smallIsTb ? `${n}TB` : `${n}GB`;
}

export function specFromStockLabel(label: string | null | undefined): SalesSpec {
  const parts = String(label ?? '')
    .split('/')
    .map((p) => p.trim());
  if (parts.length !== 6 && parts.length !== 5) return {};
  if (!CPU_RE.test(parts[0])) return {};
  const hasGen = parts.length === 6;
  const [cpuRaw, genRaw] = [parts[0], hasGen ? parts[1] : ''];
  const [ram, ssd, hdd, gpu] = hasGen ? parts.slice(2) : parts.slice(1);
  // 세대는 숫자일 때만 CPU 에 붙임("A5-56", "I7-12")
  if (hasGen && genRaw && !/^\d{1,3}$/.test(genRaw)) return {};
  // 모호함 막기: SSD 자리가 단위 없는 64 미만 숫자면(예: 세대는 있고 그래픽이 빠진 "I7/12/16/512/X" 를 세대 없는 꼴로 읽은 것) 안 채움
  const ssdM = /^(\d+(?:\.\d+)?)$/.exec((ssd ?? '').trim());
  if (ssdM && Number(ssdM[1]) >= 10 && Number(ssdM[1]) < 64) return {};
  const out: SalesSpec = {};
  out.CPU = hasGen && genRaw ? `${cpuRaw.toUpperCase()}-${genRaw}` : cpuRaw.toUpperCase();
  const ramM = NUM_RE.exec(ram ?? '');
  if (ramM) out.RAM = `${Number(ramM[1])}GB`;
  const s = capacity(ssd ?? '', 10);
  if (s) out.SSD = s;
  const h = capacity(hdd ?? '', 100);
  if (h) out.HDD = h;
  const g = (gpu ?? '').trim();
  if (g) out['그래픽'] = NONE_RE.test(g) ? 'X' : g;
  return out;
}
