/**
 * 계약 관리(/contracts) — 화면·서버가 주고받는 모양.
 * 설계: docs/tasks/2026-11-20-contract-management.md §3-7 (D9: 2차인증 평문 / **D13: 소프트웨어 탭 전체를 비밀번호 하나로 잠금,
 *   열면 비밀 칸 값도 그냥 보임, 비밀 칸은 암호화 없이 서버 전용 표에 저장, 비밀번호는 화면에서 정함(DB 해시)**).
 * server-only 아님 — 클라이언트 컴포넌트도 import. works 거래처 코드는 어느 모양에도 싣지 않는다.
 * 비밀 값(secrets)은 ClientDetail 안에만 — 서버가 잠금 해제를 확인한 뒤에만 채움.
 * 바꿀 필요가 생기면 직원은 고치지 말고 팀장에게 보고.
 */

export const SW_ITEMS = ['소프트웨어'] as const;
export const PCM_ITEMS = ['PC유지보수'] as const; // 복합기유지보수는 CS팀 몫 — 넣지 않음

export type ContractTab = 'sw' | 'pcm';
export type ClientState = 'active' | 'ended' | 'manual';
export type EndedReason = 'rental_ended' | 'not_in_works' | 'manual' | null;
export type MatchedBy = 'asset' | 'code' | 'name' | 'new';
export type ListSource = 'works' | 'rental_copy' | 'none';
/** 암호화해 저장하는 칸. 2차인증(mfa)은 사용자 결정(D9)으로 평문 — 여기 없음. */
export type SecretField = 'license_key' | 'account' | 'admin_account' | 'card' | 'other';
export const SECRET_FIELDS: readonly SecretField[] = ['license_key', 'account', 'admin_account', 'card', 'other'];
export const SECRET_FIELD_LABEL: Record<SecretField, string> = {
  license_key: '라이선스 키/ID',
  account: '마스터 아이디·비번',
  admin_account: '관리자 계정',
  card: '결제 카드',
  other: '기타 비밀',
};
export type LicenseType = 'perpetual' | 'subscription' | 'free' | 'unknown';
export type RenewalState = 'expired' | 'due30' | 'ok' | 'nodate';

/** works assets 한 줄(품목 필터 후) — 거래처 코드는 안 실음 */
export type WorksLine = {
  assetId: number;
  seq: string;
  vendorName: string;
  siteName: string;
  assetCode: string;
  modelName: string;
  serial: string;
  item: string;
  status: string;
  contractDate: string;
  endDate: string;
};

export type ClientSummary = {
  key: string; // 저장된 거래처 = id, 아직 없음 = 'new:<열쇠>'
  id: string | null;
  name: string;
  worksName: string;
  matchedBy: MatchedBy;
  state: ClientState;
  endedReason: EndedReason;
  needsDetail: boolean;
  activeLines: number;
  endedLines: number;
  firstContract: string;
  lastContract: string;
  sites: string[];
  notice: string | null; // "works 이름이 바뀌었어요: 옛 → 새" / "거래처가 둘로 나뉘어 있어요"
  products: { name: string; count: number }[]; // SW
  licenseCount: number; // SW
  nextDate: string | null; // SW
  renewal: RenewalState; // SW
  salesOwner: string;
  itOwner: string;
  searchText: string; // 상품·사용자·PC 자산번호(소문자) — 비밀 없음
};

export type ContractsOverview = {
  tab: ContractTab;
  clients: ClientSummary[];
  source: ListSource;
  sourceMs: number;
  sourceError: string | null;
  readAt: string;
  tablesMissing: boolean;
};

export type SwSeat = {
  id: string;
  userName: string;
  dept: string;
  pcAssetCode: string;
  mfaNote: string; // 2차인증(평문, D9)
  worksAssetId: number | null;
  worksSeq: string;
  installedOn: string | null;
  purchasedOn: string | null;
  renewsOn: string | null;
  endsOn: string | null;
  status: string;
  memo: string;
  secrets: Partial<Record<SecretField, string>>; // 잠금 해제 상태에서 서버가 채운 값(빈 칸은 키 없음)
  sourceRaw: Record<string, string> | null;
  updatedAt: string;
};

export type SwContract = {
  id: string;
  product: string;
  supplier: string;
  licenseType: LicenseType;
  term: '' | 'monthly' | 'yearly';
  payCycle: '' | 'monthly' | 'yearly' | 'once';
  licenseTypeRaw: string;
  quantity: number | null;
  startsOn: string | null;
  renewsOn: string | null;
  endsOn: string | null;
  costNote: string;
  adminPortal: string;
  setupVendor: string;
  status: string;
  memo: string;
  source: string;
  secrets: Partial<Record<SecretField, string>>; // 계약 단위 비밀(관리 콘솔 계정·결제 카드 등)
  seats: SwSeat[];
  nextDate: string | null;
  renewal: RenewalState;
};

export type ClientDetail = {
  client: ClientSummary & {
    memo: string;
    keyPerson: string;
    keyPhone: string;
    aliasKeys: string[];
    manualStatus: '' | 'ended' | 'hidden';
    notInWorks: boolean;
  };
  lines: WorksLine[];
  source: ListSource;
  contracts: SwContract[];
};

/** 소프트웨어 탭 잠금 상태 (D13) */
export type UnlockState = {
  passwordSet: boolean; // false = 아직 비밀번호를 안 정함 → 처음 정하기 화면
  unlocked: boolean;
  expiresAt: string | null;
  lockedUntil: string | null; // 틀린 시도가 많아 잠긴 경우 풀리는 시각
};
export const UNLOCK_HOURS = 2;
export type SecretOwner = { contractId: string } | { seatId: string };
export type SecretLogRow = {
  at: string;
  action: string;
  actor: string;
  clientName: string;
  field: string;
  count: number;
  ua: string;
  note: string;
};

// ── 시트 → 앱 옮기기 (한 번) ──────────────────────────────────────────
export type ImportMatch = 'exact' | 'similar' | 'none';
export type ImportGroup = {
  groupKey: string;
  tab: 'renew' | 'perm';
  sheetName: string;
  guessedBy: 'name' | 'domain' | 'none';
  domainHint: string;
  rows: number;
  products: { name: string; rows: number }[];
  secretCounts: Partial<Record<SecretField, number>>;
  match: ImportMatch;
  candidates: { key: string; name: string }[];
  alreadyImported: number;
  /** 줄마다 빼기용(비밀 값 없음 — 어떤 비밀 칸이 있는지 이름만). row = 시트 행 번호 */
  rowsDetail: ImportRowDetail[];
};
/** 미리보기 한 줄 — 수정 가능한 일반 칸(비밀 값 없음, 비밀 칸은 옮긴 뒤 화면에서 수정) */
export type ImportRowDetail = {
  row: number;
  product: string;
  supplier: string;
  userName: string;
  dept: string;
  pcAssetCode: string;
  mfaNote: string;
  purchasedOn: string | null; // YYYY-MM-DD(못 읽었으면 null — 원문은 dateRaw)
  renewsOn: string | null;
  endsOn: string | null;
  dateRaw: string; // 날짜 칸 원문 요약(표시용)
  secretFields: SecretField[];
  alreadyImported: boolean;
};
/** 줄 하나 고쳐서 옮기기 — 넣은 칸만 바꿈(빈 글자 = 비우기, 안 넣으면 시트 값 그대로) */
export type ImportRowEdit = {
  tab: 'renew' | 'perm';
  row: number;
  product?: string;
  supplier?: string;
  userName?: string;
  dept?: string;
  pcAssetCode?: string;
  mfaNote?: string;
  purchasedOn?: string | null;
  renewsOn?: string | null;
  endsOn?: string | null;
};
export type ImportCounts = {
  // 탭별
  sheetRows: number;
  blankRows: number;
  seats: number;
  secrets: Partial<Record<SecretField, number>>; // 시트에서 값이 있는 칸 수
};
export type ImportPreview = {
  fingerprint: string;
  groups: ImportGroup[];
  counts: { renew: ImportCounts; perm: ImportCounts };
  productNames: { name: string; rows: number }[];
  supplierNames: { name: string; rows: number }[];
  warnings: string[];
};
/** 'skip' = 이 묶음은 옮기지 않음(시트는 그대로) */
export type ImportChoice = {
  groupKey: string;
  target: { clientKey: string } | { newName: string } | 'unsorted' | 'skip';
};
export type ImportPlan = {
  fingerprint: string;
  choices: ImportChoice[];
  productRenames: Record<string, string>;
  supplierRenames: Record<string, string>;
  /** 줄 하나씩 빼기 — 시트 행 번호 */
  excludeRows: { tab: 'renew' | 'perm'; row: number }[];
  /** 줄 하나씩 고치기(상품명·매입처를 고치면 그 줄은 고친 이름의 계약 상품으로 들어감 — 이름 정리표보다 우선) */
  rowEdits: ImportRowEdit[];
};
export type ImportTabResult = {
  sheetRows: number;
  seatsInserted: number;
  seatsExisting: number;
  secrets: Partial<Record<SecretField, { sheet: number; inserted: number; existing: number; verified: number }>>;
  missing: { row: number; field: SecretField | 'seat' }[]; // 값 없이 위치만 — 뺀 줄은 여기 안 셈
  skippedRows: number; // 사람이 뺀 줄(묶음째 + 줄 하나씩)
};
export type ImportResult = {
  clientsCreated: number;
  contractsCreated: number;
  unsortedGroups: number;
  skippedGroups: number;
  renew: ImportTabResult;
  perm: ImportTabResult;
};

/** 서버 액션 공통 반환 */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; needUnlock?: boolean };

// ── 입력 모양 (화면 → 서버 액션) ─────────────────────────────────────
export const SW_CONTRACT_STATUSES = ['사용중', '해지', '만료', '보류'] as const;
export const SW_SEAT_STATUSES = ['사용중', '미배정', '회수', '해지', '만료'] as const;

/** key 가 'new:…' 이면 서버가 거래처를 만들고 그때 맞은 works 줄 id·코드를 더함 */
export type ClientInput = {
  key: string;
  name: string;
  keyPerson: string;
  keyPhone: string;
  salesOwner: string;
  itOwner: string;
  memo: string;
  manualStatus: '' | 'ended' | 'hidden';
};
/** id null = 새로. clientKey 가 'new:…' 이면 서버가 거래처부터 만듦 */
export type SwContractInput = {
  id: string | null;
  clientKey: string;
  product: string;
  supplier: string;
  licenseType: LicenseType;
  term: '' | 'monthly' | 'yearly';
  payCycle: '' | 'monthly' | 'yearly' | 'once';
  quantity: number | null;
  startsOn: string | null;
  renewsOn: string | null;
  endsOn: string | null;
  costNote: string;
  adminPortal: string;
  setupVendor: string;
  status: (typeof SW_CONTRACT_STATUSES)[number];
  memo: string;
};
/** 비밀 칸은 여기 없음 — saveSecret 으로만 */
export type SwSeatInput = {
  id: string | null;
  contractId: string;
  userName: string;
  dept: string;
  pcAssetCode: string;
  mfaNote: string;
  worksAssetId: number | null;
  worksSeq: string;
  installedOn: string | null;
  purchasedOn: string | null;
  renewsOn: string | null;
  endsOn: string | null;
  status: (typeof SW_SEAT_STATUSES)[number];
  memo: string;
};

export type UnlockResult =
  | { ok: true; state: UnlockState }
  | { ok: false; error: string; remaining?: number; lockedUntil?: string | null };

/*
 * 서버 액션 이름·인자 (고정 — 화면은 이것만 부름)
 * app/contracts/actions.ts (개발 B) — D13: 'sw' 개요·상세·모든 쓰기는 서버에서 잠금 해제 확인(아니면 needUnlock:true)
 *   getContractsOverview(tab: ContractTab): ActionResult<{ overview: ContractsOverview }>
 *   getClientDetail(key: string): ActionResult<{ detail: ClientDetail }>
 *   saveClient(input: ClientInput, actor: string): ActionResult<{ id: string }>
 *   addClientAlias(clientId: string, otherKey: string, actor: string): ActionResult
 *   createManualClient(name: string, actor: string): ActionResult<{ id: string }>   // works에 없는 거래처
 *   deleteClient(id: string, actor: string): ActionResult                          // 계약 상품 0개일 때만
 *   saveSwContract(input: SwContractInput, actor: string): ActionResult<{ id: string; clientId: string }>
 *   deleteSwContract(id: string): ActionResult                                     // 좌석 0개일 때만("이 상품 지우기" = deleteSwSeats(전부) → deleteSwContract)
 *   moveSwContract(contractId: string, clientKey: string, actor: string): ActionResult<{ clientId: string }>
 *   saveSwSeat(input: SwSeatInput, actor: string): ActionResult<{ id: string }>
 *   addSwSeats(contractId: string, count: number, actor: string): ActionResult<{ ids: string[] }>  // 최대 200
 *   renewSwContract(id: string, actor: string): ActionResult<{ renewsOn: string | null }>
 * app/contracts/secretActions.ts (개발 A) — D13: 비밀번호 하나로 소프트웨어 탭 전체 잠금(2시간 쿠키)
 *   getUnlockState(): Promise<UnlockState>
 *   setFirstPassword(password: string, name?: string): Promise<UnlockResult>   // 아직 안 정했을 때만(4자 이상) → 바로 열림
 *   unlockSecrets(password: string, name?: string): Promise<UnlockResult>      // 틀린 시도 같은 기기 15분 5회 / 전체 30회 → 15분 잠금
 *   lockSecrets(): ActionResult
 *   changePassword(current: string, next: string): ActionResult               // 열람 중 + 지금 비밀번호 확인 → 다른 기기 쿠키 무효, 이 기기는 다시 열림
 *   saveSecret(owner: SecretOwner, field: SecretField, value: string): ActionResult   // 열람 중, 빈 값 = 삭제
 *   deleteSwSeat(id: string): ActionResult                                    // 열람 중
 *   deleteSwSeats(ids: string[]): ActionResult<{ deleted: number }>          // 열람 중, 여러 좌석 한꺼번에(최대 500, 비밀 칸 함께) — "선택한 좌석 지우기"·"이 상품 지우기"
 *   listSecretLog(limit?: number): ActionResult<{ rows: SecretLogRow[]; failed24h: number }>  // 열람 중
 *   (revealSecret / revealContractSecrets 는 없앰 — 열면 getClientDetail 이 값을 같이 줌)
 * app/contracts/importActions.ts (개발 C) — 둘 다 열람 중이어야
 *   previewSheetImport(): ActionResult<{ preview: ImportPreview }>
 *   applySheetImport(plan: ImportPlan): ActionResult<{ result: ImportResult }>   // 'skip' 묶음·excludeRows 줄은 안 옮김, rowEdits 반영
 * (모두 Promise 로 감싸서 반환)
 */
