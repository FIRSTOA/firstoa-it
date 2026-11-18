/**
 * 메뉴·제목은 먼저 띄우고, 구글시트처럼 느린 데이터를 기다리는 동안 본문 자리에 보여 주는 표시.
 * 페이지에서 <Suspense fallback={<PageLoading />}>로 씁니다.
 */
export default function PageLoading({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="nav-spinner" aria-hidden />
      {label}
    </div>
  );
}
