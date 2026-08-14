/**
 * Supabase 환경변수가 없거나 조회에 실패했을 때 보여주는 안내 화면입니다.
 * 설정 전에도 앱이 죽지 않고 다음에 할 일을 알려주도록 합니다.
 */
export default function SetupGuide({ error, schemaFile = 'supabase/schema.sql' }: { error?: string; schemaFile?: string }) {
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
