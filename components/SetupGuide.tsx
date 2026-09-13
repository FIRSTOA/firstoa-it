type Props = {
  error?: string;
  schemaFile?: string;
  /** 지금 어느 데이터 소스가 활성인지에 맞춰 안내 문구를 바꿉니다 (lib/dataSource.ts). */
  source?: 'supabase' | 'sheets';
};

/**
 * 데이터 소스(Supabase 또는 구글시트) 환경변수가 없거나 조회에 실패했을 때 보여주는
 * 안내 화면입니다. 설정 전에도 앱이 죽지 않고 다음에 할 일을 알려주도록 합니다.
 */
export default function SetupGuide({ error, schemaFile = 'supabase/schema.sql', source = 'supabase' }: Props) {
  if (source === 'sheets') {
    return (
      <div className="app">
        <div className="panel setup" style={{ paddingBottom: '20px' }}>
          {error ? (
            <>
              <h2>⚠️ 구글시트 조회에 실패했어요</h2>
              <div className="setup-alert">{error}</div>
              <p>
                시트 이름/헤더가 예상과 다르거나, 서비스 계정에 이 시트 접근 권한이 없을 때 자주
                일어나요. 아래 준비 방법을 다시 확인해주세요.
              </p>
            </>
          ) : (
            <h2>🔌 구글시트 연결이 필요해요</h2>
          )}
          <p>아직 환경변수가 설정되지 않았거나 완전하지 않아요. 아래 순서대로 연결하세요.</p>
          <ol>
            <li>
              <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer">
                Google Cloud Console
              </a>{' '}
              에서 서비스 계정을 만들고 JSON 키를 다운로드합니다.
            </li>
            <li>
              재고 시트(데스크탑/노트북/모니터/빔프로젝트/기타주변기기 탭이 있는 문서)를 열어 "공유"에
              서비스 계정 이메일을 <b>편집자</b> 권한으로 추가합니다 (이제 앱이 직접 행을 쓰기 때문에
              뷰어 권한으로는 부족해요).
            </li>
            <li>
              프로젝트 루트에 <code>.env.local</code> 파일을 만들고 값을 채웁니다.
              <pre>{`GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@xxx.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
GOOGLE_INVENTORY_SHEET_ID=스프레드시트_URL의_ID_부분`}</pre>
              탭 이름이 데스크탑/노트북/모니터/빔프로젝트/기타주변기기와 다르면{' '}
              <code>GOOGLE_INVENTORY_SHEET_TAB_*</code> 변수로 개별 지정할 수 있어요 (자세한 건{' '}
              <code>.env.local.example</code> 참고).
            </li>
            <li>
              개발 서버를 다시 시작합니다: <code>npm run dev</code>
            </li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="panel setup" style={{ paddingBottom: '20px' }}>
        {error ? (
          <>
            <h2>⚠️ Supabase 조회에 실패했어요</h2>
            <div className="setup-alert">{error}</div>
            <p>
              대부분 테이블이 아직 없어서 생기는 오류예요. Supabase 대시보드의 <b>SQL Editor</b> 에서{' '}
              <code>{schemaFile}</code> 을 실행하세요.
            </p>
          </>
        ) : (
          <>
            <h2>🔌 Supabase 연결이 필요해요</h2>
            <p>
              아직 환경변수가 설정되지 않았어요. 아래 순서대로 연결하면 이 화면이 재고 리스트로 바뀝니다.
            </p>
            <ol>
              <li>
                <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
                  supabase.com/dashboard
                </a>{' '}
                에서 <b>New project</b> 로 프로젝트를 만듭니다. (Region: Northeast Asia · Seoul 권장)
              </li>
              <li>
                <b>SQL Editor</b> 에서 <code>supabase/schema.sql</code> 을 실행해 테이블을 만들고, 이어서{' '}
                <code>supabase/seed.sql</code> 로 샘플 21건을 넣습니다.
              </li>
              <li>
                <b>Settings → API</b> 에서 <code>Project URL</code>, <code>anon public</code>,{' '}
                <code>service_role</code> 값을 복사합니다.
              </li>
              <li>
                프로젝트 루트에 <code>.env.local</code> 파일을 만들고 값을 채웁니다.
                <pre>{`NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...`}</pre>
              </li>
              <li>
                개발 서버를 다시 시작합니다: <code>npm run dev</code>
              </li>
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
