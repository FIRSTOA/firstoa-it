import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { APP_NAME, APP_SHORT_NAME, APPLE_TOUCH_ICON, THEME_COLOR } from '@/lib/pwa';
import './globals.css';

// 홈 화면 앱(PWA) — 설치 정보는 app/manifest.ts, 앱 이름·색은 lib/pwa.ts, 아이콘은 public/icons/.
export const metadata: Metadata = {
  title: 'IT 재고 리스트 · FIRSTOA ERP',
  description: '(주)퍼스트전산 IT 자산 재고 관리',
  applicationName: APP_NAME,
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: APPLE_TOUCH_ICON, sizes: '180x180', type: 'image/png' }],
  },
  // capable → Next 15는 mobile-web-app-capable 만 냄. 옛 아이폰용 apple-mobile-web-app-capable 은 아래 other 로.
  // 상태바는 꼭 'default' — 'black-translucent' 는 상태바가 화면 위를 덮어 메뉴 버튼이 가려짐.
  appleWebApp: { capable: true, title: APP_SHORT_NAME, statusBarStyle: 'default' },
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

// viewport-fit=cover: 노치·하단 홈바 쪽까지 화면을 쓰고, 가려지는 만큼은 globals.css 의 body safe-area 패딩으로 비킴.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: THEME_COLOR,
};

/**
 * 안드로이드 Chrome의 설치 신호(beforeinstallprompt)는 화면이 다 뜨기 전에 한 번만 올 수 있어
 * React보다 먼저 받아 둠 → components/InstallAppButton.tsx 가 window.__pwaInstallPrompt 로 꺼내 씀.
 */
const CAPTURE_INSTALL_PROMPT = `
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__pwaInstallPrompt = e;
  window.dispatchEvent(new Event('pwa-install-change'));
});
window.addEventListener('appinstalled', function () {
  window.__pwaInstallPrompt = null;
  window.__pwaInstalled = true;
  window.dispatchEvent(new Event('pwa-install-change'));
});`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Script id="pwa-install-capture" strategy="beforeInteractive">
          {CAPTURE_INSTALL_PROMPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
