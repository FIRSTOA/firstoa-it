/**
 * 재고현황판의 특정 영역을 이미지로 캡처해서 클립보드에 복사합니다(카카오톡 등에 바로
 * 붙여넣기용). html2canvas를 클릭 시점에만 동적 import해서(코드 스플릿) 평소 번들 크기에는
 * 영향이 없게 합니다. 클립보드 이미지 쓰기(ClipboardItem)를 지원 안 하는 브라우저는
 * 파일 다운로드로 대체합니다.
 */
export async function copyElementAsImage(
  el: HTMLElement,
  downloadName = '재고현황판',
): Promise<{ ok: true; downloaded: boolean } | { ok: false; error: string }> {
  let canvas: HTMLCanvasElement;
  try {
    const html2canvas = (await import('html2canvas')).default;
    canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      // "이미지 복사" 버튼처럼 캡처에 안 넣고 싶은 UI 조작 요소는 이 클래스를 붙여서 빼요.
      ignoreElements: (node) => node.classList.contains('no-capture'),
    });
  } catch (err) {
    console.error('[captureImage] html2canvas 렌더링 실패:', err);
    return { ok: false, error: '이미지를 만들지 못했어요.' };
  }

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  if (!blob) return { ok: false, error: '이미지를 만들지 못했어요.' };

  try {
    if (typeof window !== 'undefined' && navigator.clipboard && 'write' in navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return { ok: true, downloaded: false };
    }
  } catch (err) {
    console.error('[captureImage] 클립보드 복사 실패 — 다운로드로 대체:', err);
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${downloadName}-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, downloaded: true };
}
