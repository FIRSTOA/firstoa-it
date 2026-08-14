/**
 * 출고/접수 대장 (구 "IT확인서리스트" 스프레드시트를 웹으로 옮긴 것).
 * 고객사 납품·교체·반출 접수 건을 기록합니다.
 */

// 실제 스프레드시트 처리여부 컬럼의 빈도수 기준 + 진행중 단계를 추가한 값
export const DISPATCH_STATUSES = ['접수', '준비중', '준비완료', '보류', '취소'] as const;
// 실제 스프레드시트 구분 컬럼 빈도수 기준
export const DISPATCH_TYPES = ['납품', '교체', '반출', '판매', '이전', '기타'] as const;

export type DispatchEntry = {
  id: string;
  seq: number;
  deliveryDate: string; // 납품/교체일 (YYYY-MM-DD)
  receivedDate: string; // 접수일 (YYYY-MM-DD)
  receivedTime: string; // 접수시간 (자유 입력, 예: 16:32)
  startTime: string; // 시작
  endTime: string; // 종료
  status: string; // 처리여부
  receiver: string; // 접수자
  processor: string; // 처리자
  type: string; // 구분
  notes: string; // 소모품/특이사항
  company: string; // 상호
  contact: string; // 연락처
  item: string; // 품목
  directSpec: string; // 직송(사양 메모)
  assetId: string; // 자산번호
  remarks: string; // 비고
  serialNumber: string; // 시리얼번호
};

export type DispatchEntryRow = {
  id: string;
  seq: number;
  delivery_date: string | null;
  received_date: string | null;
  received_time: string;
  start_time: string;
  end_time: string;
  status: string;
  receiver: string;
  processor: string;
  type: string;
  notes: string;
  company: string;
  contact: string;
  item: string;
  direct_spec: string;
  asset_id: string;
  remarks: string;
  serial_number: string;
};

export function rowToDispatch(row: DispatchEntryRow): DispatchEntry {
  return {
    id: row.id,
    seq: row.seq,
    deliveryDate: row.delivery_date ?? '',
    receivedDate: row.received_date ?? '',
    receivedTime: row.received_time,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    receiver: row.receiver,
    processor: row.processor,
    type: row.type,
    notes: row.notes,
    company: row.company,
    contact: row.contact,
    item: row.item,
    directSpec: row.direct_spec,
    assetId: row.asset_id,
    remarks: row.remarks,
    serialNumber: row.serial_number,
  };
}

export type DispatchInput = Omit<DispatchEntry, 'id' | 'seq'>;

export function dispatchInputToRow(entry: DispatchInput) {
  return {
    delivery_date: entry.deliveryDate || null,
    received_date: entry.receivedDate || null,
    received_time: entry.receivedTime,
    start_time: entry.startTime,
    end_time: entry.endTime,
    status: entry.status,
    receiver: entry.receiver,
    processor: entry.processor,
    type: entry.type,
    notes: entry.notes,
    company: entry.company,
    contact: entry.contact,
    item: entry.item,
    direct_spec: entry.directSpec,
    asset_id: entry.assetId,
    remarks: entry.remarks,
    serial_number: entry.serialNumber,
  };
}

export type DispatchFilters = {
  status: string | null;
  type: string | null;
};

export const EMPTY_DISPATCH_FILTERS: DispatchFilters = { status: null, type: null };

export function filterDispatchEntries(
  entries: DispatchEntry[],
  filters: DispatchFilters,
  searchTerm: string,
): DispatchEntry[] {
  const term = searchTerm.trim().toLowerCase();
  return entries.filter((e) => {
    if (filters.status && e.status !== filters.status) return false;
    if (filters.type && e.type !== filters.type) return false;
    if (term) {
      const hay = `${e.company} ${e.item} ${e.assetId} ${e.contact}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}
