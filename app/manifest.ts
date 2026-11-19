import type { MetadataRoute } from 'next';
import { APP_NAME, APP_SHORT_NAME, BACKGROUND_COLOR, THEME_COLOR } from '@/lib/pwa';

/**
 * 홈 화면 앱 설치 정보 — Next가 /manifest.webmanifest 로 내보내고 <link rel="manifest">도 자동으로 붙임.
 * 서비스워커(오프라인 캐시)는 일부러 없음: 있으면 배포해도 옛 화면이 계속 뜸. 설치 조건엔 필요 없음.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: '(주)퍼스트전산 IT 자산 재고 관리',
    id: '/',
    // 홈 화면 아이콘으로 켜면 홈 대시보드부터(id 는 '/' 그대로 — 이미 설치한 폰도 같은 앱으로 인식)
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    lang: 'ko',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
