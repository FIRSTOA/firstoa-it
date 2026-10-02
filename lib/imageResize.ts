/**
 * 사진 OCR(실재고 조사/판매/입고 사진 일괄/반출확인서)이 공유하는 클라이언트 전용 리사이즈
 * 유틸입니다. 휴대폰 원본 사진(수 MB)을 그대로 보내면 Server Action 요청 크기 제한에
 * 걸려서(실측: "Body exceeded 1 MB limit") 캔버스로 먼저 줄입니다 — 긴 변 1600px,
 * JPEG 0.8 품질이면 글자 인식에는 충분하고 대부분 수백 KB로 줄어듭니다.
 */
export function resizeImageFile(file: File, maxDim = 1600, quality = 0.8): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('이미지를 처리할 수 없어요.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const comma = dataUrl.indexOf(',');
      resolve({ base64: dataUrl.slice(comma + 1), mediaType: 'image/jpeg' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지를 읽지 못했어요.'));
    };
    img.src = objectUrl;
  });
}
