# FIRSTOA ERP · IT 재고 리스트

(주)퍼스트전산 IT 자산 재고 관리 화면입니다.
**Next.js 15 (App Router) + Supabase (PostgreSQL)** 로 만들어졌고 **Vercel** 에 배포합니다.

기존 단일 HTML 프로토타입은 `legacy/it-inventory.html` 에 참고용으로 남겨두었습니다.
데이터 저장소가 브라우저 임시 저장소(`window.storage`)에서 Supabase 로 바뀌었습니다.

---

## 1. 구조

```
firsota-it/
├── app/
│   ├── layout.tsx          루트 레이아웃
│   ├── page.tsx            서버 컴포넌트 — Supabase 에서 재고 조회
│   ├── actions.ts          Server Actions — 등록/수정/삭제/초기화
│   └── globals.css         기존 디자인 그대로 옮긴 전역 스타일
├── components/
│   ├── Shell.tsx           사이드바 + 상단 네비 + 브레드크럼
│   ├── InventoryPage.tsx   화면 상태(필터·검색·모달·토스트) 관리
│   ├── StatsRow.tsx        상단 통계 카드 7종
│   ├── FilterPanel.tsx     검색창 + 칩 필터 7줄
│   ├── InventoryTable.tsx  재고 테이블
│   ├── AssetModal.tsx      재고입력 / 자산수정 모달
│   └── SetupGuide.tsx      Supabase 미연결 시 안내 화면
├── lib/
│   ├── types.ts            Asset 타입 + DB row 매핑
│   ├── filters.ts          필터링 로직
│   ├── seed.ts             샘플 데이터 21건
│   └── supabase/server.ts  서버 전용 Supabase 클라이언트
└── supabase/
    ├── schema.sql          테이블 · 인덱스 · RLS
    └── seed.sql            샘플 데이터 INSERT
```

### 보안 모델

- 브라우저는 Supabase 에 **직접 접근하지 않습니다.** 모든 읽기/쓰기는 서버(Server Component·Server Action)를 거칩니다.
- `it_assets` 테이블은 **RLS 활성화 + 정책 없음** 상태라 `anon` 키로는 아무것도 읽을 수 없습니다.
- 서버는 `service_role` 키로 RLS 를 우회합니다. 이 키는 `SUPABASE_SERVICE_ROLE_KEY` 환경변수로만 주입되며 클라이언트 번들에 포함되지 않습니다 (`lib/supabase/server.ts` 의 `import 'server-only'` 가 이를 강제).

> 지금은 로그인 기능이 없어 URL 을 아는 사람이면 누구나 접근할 수 있습니다.
> 사내 전용으로 쓰려면 Vercel 의 **Deployment Protection** 을 켜거나 Supabase Auth 를 붙이세요 (`supabase/schema.sql` 하단에 정책 예시 주석).

---

## 2. Supabase 연결

1. https://supabase.com/dashboard 로그인 → **New project**
   - Name: `firstoa-it-inventory`
   - Region: **Northeast Asia (Seoul)**
   - Database Password 는 따로 보관
2. 좌측 **SQL Editor** → **New query** → `supabase/schema.sql` 내용 붙여넣고 **Run**
3. 같은 방법으로 `supabase/seed.sql` 실행 (샘플 21건 입력)
4. 좌측 **Settings → API** 에서 세 값을 복사
   | 대시보드 항목 | 환경변수 |
   |---|---|
   | Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
   | Project API keys → `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | Project API keys → `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

---

## 3. 로컬 실행

```powershell
npm install
Copy-Item .env.local.example .env.local   # 그리고 값 채우기
npm run dev
```

http://localhost:3000 접속. 환경변수가 비어 있으면 재고 화면 대신 연결 안내 화면이 나옵니다.

---

## 4. GitHub 연결

```powershell
git init
git add .
git commit -m "IT 재고 리스트: Next.js + Supabase 전환"
git branch -M main
git remote add origin https://github.com/<사용자명>/firstoa-it-inventory.git
git push -u origin main
```

`.env.local` 은 `.gitignore` 에 있으므로 키가 커밋되지 않습니다.

---

## 5. Vercel 배포

1. https://vercel.com/new 로그인 → **Import Git Repository** → 위 저장소 선택
2. Framework Preset 이 **Next.js** 로 자동 인식되는지 확인 (다른 설정은 기본값)
3. **Environment Variables** 에 세 개를 모두 추가 — Production / Preview / Development 전부 체크

   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ```

4. **Deploy**

이후 `main` 에 push 하면 자동으로 재배포됩니다.
환경변수를 나중에 바꿨다면 **Deployments → 최신 배포 → Redeploy** 를 눌러야 반영됩니다.

---

## 6. 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm start` | 빌드 결과 실행 |
| `npm run typecheck` | 타입 검사 |
