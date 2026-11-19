'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_SHORT_NAME } from '@/lib/pwa';

/** 안드로이드 Chrome 설치 신호 — app/layout.tsx 의 스크립트가 React보다 먼저 받아 window 에 둠 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

declare global {
  interface Window {
    __pwaInstallPrompt?: InstallPromptEvent | null;
    __pwaInstalled?: boolean;
  }
}

type Env =
  | 'ios-safari' // 공유 → 홈 화면에 추가
  | 'ios-other' // 아이폰 Chrome·카카오톡 안 등 → Safari로 열라고
  | 'android' // Chrome인데 설치 신호가 아직 없음(이미 설치했거나 조건 미달) → 메뉴로
  | 'android-inapp' // 카카오톡·네이버 앱 안 → Chrome으로 열라고
  | 'samsung'
  | 'desktop'; // PC → 핸드폰에서 열라고

const IN_APP_BROWSER = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i;

function detectEnv(): Env {
  const ua = navigator.userAgent;
  // 아이패드는 '데스크탑 사이트'로 Mac처럼 보이므로 터치로 구분
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const inApp = IN_APP_BROWSER.test(ua);
  if (isIOS) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|Whale|YaBrowser/i.test(ua);
    return !inApp && !otherBrowser && /Safari\//.test(ua) ? 'ios-safari' : 'ios-other';
  }
  if (/Android/i.test(ua)) {
    if (inApp) return 'android-inapp';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    return 'android';
  }
  return 'desktop';
}

/** 홈 화면 앱으로 켜져 있는지 — 그러면 버튼을 숨김 */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** 사이드바 맨 아래 "📱 핸드폰에 앱처럼 설치하기" — 안드로이드는 한 번에 설치, 아이폰·그 밖은 안내창 */
export default function InstallAppButton() {
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [env, setEnv] = useState<Env>('desktop');
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    setEnv(detectEnv());
    const sync = () => {
      setPromptEvent(window.__pwaInstallPrompt ?? null);
      setHidden(isStandalone() || window.__pwaInstalled === true);
    };
    sync();
    window.addEventListener('pwa-install-change', sync);
    return () => window.removeEventListener('pwa-install-change', sync);
  }, []);

  useEffect(() => {
    if (!guideOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setGuideOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guideOpen]);

  /** Chrome 설치 창 띄우기 — 신호는 한 번만 쓸 수 있음. 실패하면 false */
  async function promptInstall(): Promise<boolean> {
    const ev = promptEvent;
    if (!ev) return false;
    window.__pwaInstallPrompt = null;
    setPromptEvent(null);
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === 'accepted') setHidden(true);
      return true;
    } catch {
      return false;
    }
  }

  async function onClick() {
    // 핸드폰(안드로이드)에서 설치 신호가 있으면 안내 없이 바로 설치 창
    if (env !== 'desktop' && promptEvent && (await promptInstall())) return;
    setGuideOpen(true);
  }

  if (!mounted || hidden) return null;

  return (
    <>
      <button type="button" className="install-app-btn" onClick={onClick}>
        📱 핸드폰에 앱처럼 설치하기
      </button>
      {guideOpen &&
        createPortal(
          <div className="modal-overlay open install-guide-overlay" onClick={() => setGuideOpen(false)}>
            <div className="modal install-guide" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
              <Guide env={env} />
              <div className="modal-footer">
                {env === 'desktop' && promptEvent && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={async () => {
                      setGuideOpen(false);
                      await promptInstall();
                    }}
                  >
                    이 PC에 설치
                  </button>
                )}
                <button type="button" className="btn btn-primary" onClick={() => setGuideOpen(false)}>
                  확인
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Guide({ env }: { env: Env }) {
  switch (env) {
    case 'ios-safari':
      return (
        <>
          <h2>아이폰 홈 화면에 설치하기</h2>
          <div className="sub">아이폰은 버튼 한 번으로 설치가 안 돼서, Safari 메뉴로 추가해야 해요.</div>
          <ol className="install-steps">
            <li>
              화면 아래쪽 <b>공유 버튼</b> <ShareIcon /> 을 누르세요.
              <span className="hint">안 보이면 오른쪽 아래 ⋯ 를 먼저 누르세요. 아이패드는 위쪽 오른쪽.</span>
            </li>
            <li>
              목록을 내려 <b>홈 화면에 추가</b> 를 누르세요.
            </li>
            <li>
              오른쪽 위 <b>추가</b> 를 누르면 끝.
              <span className="hint">&lsquo;웹 앱으로 열기&rsquo;가 보이면 켜 둔 채로 두세요.</span>
            </li>
          </ol>
          <InstalledNote />
        </>
      );
    case 'ios-other':
      return (
        <>
          <h2>Safari로 열어 주세요</h2>
          <div className="sub">아이폰은 Safari에서만 홈 화면에 앱으로 설치할 수 있어요.</div>
          <ol className="install-steps">
            <li>
              아래 주소를 복사해서 <b>Safari</b> 주소창에 붙여 넣으세요.
              <span className="hint">카카오톡 안에서 열렸다면 아래 메뉴(⋯ 또는 공유)의 &lsquo;Safari로 열기&rsquo;도 돼요.</span>
              <UrlBox />
            </li>
            <li>
              Safari에서 왼쪽 메뉴(☰)의 <b>📱 핸드폰에 앱처럼 설치하기</b> 를 다시 누르세요.
            </li>
          </ol>
        </>
      );
    case 'android-inapp':
      return (
        <>
          <h2>Chrome으로 열어 주세요</h2>
          <div className="sub">카카오톡·네이버 앱 안의 화면에서는 설치가 안 돼요.</div>
          <ol className="install-steps">
            <li>
              메뉴 <b>⋮</b> → <b>다른 브라우저로 열기</b> → <b>Chrome</b>.
              <span className="hint">메뉴가 없으면 아래 주소를 복사해 Chrome에 붙여 넣으세요.</span>
              <UrlBox />
            </li>
            <li>
              Chrome에서 왼쪽 메뉴(☰)의 <b>📱 핸드폰에 앱처럼 설치하기</b> 를 다시 누르세요.
            </li>
          </ol>
        </>
      );
    case 'samsung':
      return (
        <>
          <h2>삼성 인터넷에서 설치하기</h2>
          <ol className="install-steps">
            <li>
              아래쪽 <b>≡</b> 메뉴 → <b>현재 페이지 추가</b>(또는 &lsquo;페이지 추가&rsquo;) → <b>홈 화면</b>.
            </li>
            <li>
              <b>추가</b> 를 누르면 홈 화면에 아이콘이 생겨요.
            </li>
          </ol>
          <InstalledNote />
        </>
      );
    case 'android':
      return (
        <>
          <h2>안드로이드 홈 화면에 설치하기</h2>
          <ol className="install-steps">
            <li>
              Chrome 오른쪽 위 <b>⋮</b> 메뉴 → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>.
            </li>
            <li>
              <b>설치</b> 를 누르면 홈 화면에 아이콘이 생겨요.
            </li>
          </ol>
          <InstalledNote />
        </>
      );
    default:
      return (
        <>
          <h2>핸드폰에 앱처럼 설치하기</h2>
          <div className="sub">설치는 핸드폰에서 해요. 핸드폰으로 아래 주소를 여세요.</div>
          <UrlBox />
          <ol className="install-steps">
            <li>
              안드로이드는 <b>Chrome</b>, 아이폰은 <b>Safari</b> 로 여세요.
            </li>
            <li>
              왼쪽 위 <b>☰</b> 메뉴를 열고 맨 아래 <b>📱 핸드폰에 앱처럼 설치하기</b> 를 누르세요.
            </li>
          </ol>
        </>
      );
  }
}

function InstalledNote() {
  return (
    <div className="install-note">
      이미 설치했다면 홈 화면의 <b>{APP_SHORT_NAME}</b> 아이콘으로 여세요. 그 화면에선 이 버튼이 안 보여요.
    </div>
  );
}

/** 이 사이트 주소 + 복사 버튼 (복사가 막힌 브라우저에선 칸을 길게 눌러 복사) */
function UrlBox() {
  const url = `${window.location.origin}/`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="install-url">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="이 사이트 주소" />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            /* 복사 권한 없음 — 칸을 길게 눌러 복사 */
          }
        }}
      >
        {copied ? '복사됨 ✓' : '복사'}
      </button>
    </div>
  );
}

/** iOS 공유 버튼 모양(네모 + 위 화살표) */
function ShareIcon() {
  return (
    <svg className="install-share-icon" viewBox="0 0 24 24" width="17" height="17" aria-label="공유" role="img">
      <path
        d="M12 3v12M7.5 7.5 12 3l4.5 4.5M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
