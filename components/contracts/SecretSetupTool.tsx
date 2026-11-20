'use client';

import { useState, type CSSProperties } from 'react';

/*
 * 계약 관리 비밀 칸 설정 도구(/contracts/setup) — 모든 계산은 이 브라우저 안에서만(Web Crypto), 서버로 아무것도 안 보냄.
 * 만드는 값의 형식은 lib/contracts/crypto.ts 와 반드시 같아야 함:
 *   CONTRACT_SECRET_KEY    = 무작위 32바이트 → 표준 base64(패딩 포함 44자)
 *   CONTRACT_PASSWORD_HASH = pbkdf2-sha256$600000$<salt 16바이트 base64url>$<hash 32바이트 base64url>
 *                            (비밀번호는 NFC 로 정리한 UTF-8, PRF HMAC-SHA-256, base64url 은 패딩 없음)
 * 만든 값은 화면 상태에만 있고 저장·전송하지 않음(console 에도 안 찍음).
 */

const PBKDF2_PREFIX = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const MIN_PASSWORD = 8;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function toB64url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function subtleOrNull(): SubtleCrypto | null {
  return typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle ? globalThis.crypto.subtle : null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function nowKst(): string {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

const valueBox: CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  userSelect: 'all',
  fontSize: '14px',
  margin: '8px 0',
};
const okBox: CSSProperties = {
  background: 'var(--green-50)',
  border: '1px solid var(--green-100)',
  color: 'var(--green-600)',
  borderRadius: '10px',
  padding: '12px 14px',
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.6,
  marginBottom: '14px',
};
const warnBox: CSSProperties = {
  background: 'var(--amber-50)',
  border: '1px solid var(--amber-100)',
  color: 'var(--amber-600)',
  borderRadius: '10px',
  padding: '12px 14px',
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.6,
  marginBottom: '14px',
};
const row: CSSProperties = { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 14px' };

type Props = { keyConfigured: boolean; hashConfigured: boolean };

export default function SecretSetupTool({ keyConfigured, hashConfigured }: Props) {
  const both = keyConfigured && hashConfigured;
  const [secretKey, setSecretKey] = useState('');
  const [passwordHash, setPasswordHash] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'key' | 'hash' | null>(null);
  const [printNote, setPrintNote] = useState('');

  function makeKey() {
    setError('');
    const subtle = subtleOrNull();
    if (!subtle) {
      setError('이 브라우저(또는 https 가 아닌 주소)에서는 만들 수 없어요. 배포된 https 주소를 Chrome·Edge·Safari 로 열어 주세요.');
      return;
    }
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    setSecretKey(toB64(bytes));
    setCopied(null);
  }

  async function makeHash() {
    setError('');
    const subtle = subtleOrNull();
    if (!subtle) {
      setError('이 브라우저(또는 https 가 아닌 주소)에서는 만들 수 없어요. 배포된 https 주소를 Chrome·Edge·Safari 로 열어 주세요.');
      return;
    }
    if (pw1.length < MIN_PASSWORD) {
      setError(`비밀번호는 ${MIN_PASSWORD}자 이상으로 정해 주세요(글자·숫자를 섞어 10자 넘게 권해요).`);
      return;
    }
    if (pw1 !== pw2) {
      setError('두 번 넣은 비밀번호가 서로 달라요. 다시 넣어 주세요.');
      return;
    }
    setBusy(true);
    try {
      const salt = new Uint8Array(SALT_BYTES);
      globalThis.crypto.getRandomValues(salt);
      const material = await subtle.importKey('raw', new TextEncoder().encode(pw1.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, material, HASH_BITS);
      setPasswordHash(`${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toB64url(salt)}$${toB64url(new Uint8Array(bits))}`);
      setCopied(null);
      // 비밀번호 글자는 화면에 남기지 않음
      setPw1('');
      setPw2('');
      setShowPw(false);
    } catch {
      setError('해시를 만들지 못했어요. 브라우저를 최신으로 바꾸거나 다른 브라우저로 해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(which: 'key' | 'hash') {
    const text = which === 'key' ? secretKey : passwordHash;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setError('복사가 막혔어요. 글자 상자를 눌러 전체 선택한 뒤 직접 복사해 주세요.');
    }
  }

  function openPrint() {
    setPrintNote('');
    if (!secretKey && !passwordHash) return;
    const w = window.open('', '_blank', 'width=760,height=900');
    if (!w) {
      setPrintNote('새 창이 막혔어요. 주소창 오른쪽의 팝업 차단을 풀고 다시 눌러 주세요.');
      return;
    }
    const block = (title: string, name: string, value: string, note: string) => `
      <section>
        <h2>${escapeHtml(title)}</h2>
        <div class="name">Vercel 이름: <b>${escapeHtml(name)}</b></div>
        <div class="value">${escapeHtml(value)}</div>
        <p>${escapeHtml(note)}</p>
      </section>`;
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>계약 관리 비밀 칸 설정 — 보관용</title>
      <style>
        body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#0f172a;margin:32px;line-height:1.6;}
        h1{font-size:20px;margin:0 0 4px;} h2{font-size:16px;margin:0 0 6px;}
        .meta{color:#475569;font-size:13px;margin-bottom:20px;}
        section{border:2px solid #0f172a;border-radius:10px;padding:14px 16px;margin-bottom:18px;page-break-inside:avoid;}
        .name{font-size:13px;margin-bottom:6px;}
        .value{font-family:Consolas,'Cascadia Mono',monospace;font-size:17px;letter-spacing:.04em;word-break:break-all;
               border:1px dashed #64748b;border-radius:6px;padding:10px 12px;background:#f8fafc;}
        p{font-size:12.5px;color:#334155;margin:8px 0 0;}
        ul{font-size:12.5px;color:#334155;padding-left:18px;}
      </style></head><body>
      <h1>퍼스트전산 IT — 계약 관리 비밀 칸 설정 (보관용)</h1>
      <div class="meta">만든 때: ${escapeHtml(nowKst())} · 이 종이는 회사 금고 등 잠기는 곳에 보관하세요.</div>
      ${secretKey ? block('암호화 열쇠', 'CONTRACT_SECRET_KEY', secretKey, '이 열쇠를 잃으면 앱에 저장한 비번·라이선스 키를 아무도 풀 수 없어요. 사진을 찍어 카톡·메일로 보내지 마세요.') : ''}
      ${passwordHash ? block('인증 비밀번호 해시', 'CONTRACT_PASSWORD_HASH', passwordHash, '비밀번호 자체가 아니에요. 비밀번호를 잊으면 설정 화면에서 새로 만들어 바꾸면 돼요(저장된 값은 그대로).') : ''}
      <ul>
        <li>넣는 곳: Vercel → 이 앱 프로젝트 → Settings → Environment Variables (Production 만)</li>
        <li>넣은 뒤 Deployments 에서 다시 배포(Redeploy)해야 적용돼요.</li>
      </ul>
      </body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="setup">
      <p>
        계약 관리의 비번·라이선스 키는 <b>암호화 열쇠</b>로 잠가 저장하고, <b>인증 비밀번호</b>를 넣어야 볼 수 있어요. 이 화면은 그 두 값을
        만드는 곳이에요. 계산은 <b>이 브라우저 안에서만</b> 하고 서버로 아무것도 보내지 않아요.
      </p>

      {both ? (
        <div style={okBox}>
          ✓ 설정됨 — 열쇠와 비밀번호가 모두 들어가 있어요. 비밀번호를 바꿀 때만 아래 ②를 쓰세요.
        </div>
      ) : (
        <div style={warnBox}>
          아직 설정 전이에요 — 암호화 열쇠 {keyConfigured ? '✓ 있음' : '✗ 없음'} · 인증 비밀번호 {hashConfigured ? '✓ 있음' : '✗ 없음'}.
          아래 순서대로 만들어 Vercel 에 넣고 다시 배포하면 켜져요.
        </div>
      )}

      {error && <div className="setup-alert">{error}</div>}

      <section className="panel" style={{ paddingBottom: '14px' }}>
        <h2>① 암호화 열쇠 (CONTRACT_SECRET_KEY)</h2>
        {keyConfigured ? (
          <p style={{ marginBottom: 0 }}>
            ✓ 이미 들어가 있어요. <b>새로 만들어 바꾸지 마세요</b> — 열쇠를 바꾸면 지금까지 저장한 비번·키를 아무도 풀 수 없게 돼요.
          </p>
        ) : (
          <>
            <p>버튼을 누르면 무작위 열쇠(44글자)가 만들어져요. 이 화면을 닫으면 다시 볼 수 없으니 바로 Vercel 에 넣어 주세요.</p>
            <div style={row}>
              <button type="button" className="btn btn-primary" onClick={makeKey}>
                {secretKey ? '열쇠 다시 만들기' : '열쇠 만들기'}
              </button>
              {secretKey && (
                <button type="button" className="btn btn-ghost" onClick={() => copy('key')}>
                  {copied === 'key' ? '✓ 복사했어요' : '복사'}
                </button>
              )}
            </div>
            {secretKey && (
              <>
                <pre style={valueBox}>{secretKey}</pre>
                <p style={{ marginBottom: 0 }}>
                  ⚠️ 이 열쇠는 클로드·카톡·메일로 보내지 마세요. Vercel 에 이미 넣은 뒤에 &quot;다시 만들기&quot;를 누르면 안 돼요.
                </p>
              </>
            )}
          </>
        )}
      </section>

      <section className="panel" style={{ paddingBottom: '14px' }}>
        <h2>{hashConfigured ? '② 인증 비밀번호 바꾸기 — 새 해시 만들기' : '② 인증 비밀번호 정하기 (CONTRACT_PASSWORD_HASH)'}</h2>
        <p>
          팀이 같이 쓸 비밀번호를 두 번 넣으면 &quot;해시&quot;(비밀번호를 거꾸로 알아낼 수 없게 바꾼 글자)가 만들어져요. Vercel 에는 이 해시만 넣어요.
          {hashConfigured && ' 바꾸고 다시 배포하면 지금 열려 있는 화면은 모두 잠겨요.'}
        </p>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="ct-setup-pw1">새 비밀번호 ({MIN_PASSWORD}자 이상)</label>
            <input
              id="ct-setup-pw1"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="form-field">
            <label htmlFor="ct-setup-pw2">한 번 더</label>
            <input
              id="ct-setup-pw2"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void makeHash();
              }}
              disabled={busy}
            />
          </div>
        </div>
        <div style={row}>
          <label className="toggle">
            <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> 글자 보이기
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void makeHash()} disabled={busy || !pw1 || !pw2}>
            {busy ? '만드는 중… (몇 초 걸려요)' : '해시 만들기'}
          </button>
          {passwordHash && (
            <button type="button" className="btn btn-ghost" onClick={() => copy('hash')}>
              {copied === 'hash' ? '✓ 복사했어요' : '복사'}
            </button>
          )}
        </div>
        {passwordHash && (
          <>
            <pre style={valueBox}>{passwordHash}</pre>
            <p style={{ marginBottom: 0 }}>
              해시는 비밀번호가 아니라서 클로드에게 넘겨도 괜찮아요. <b>비밀번호 자체는 채팅·카톡에 적지 마세요.</b>
            </p>
          </>
        )}
      </section>

      <section className="panel" style={{ paddingBottom: '14px' }}>
        <h2>③ 인쇄용 보기</h2>
        <p>
          <b>열쇠 백업 — 권장, 나중에 해도 돼요.</b> 암호화 열쇠를 잃으면 앱에 저장한 비번·키를 아무도 못 풀어요. 이 화면에서 만든 값을 종이로
          뽑아 회사 금고에 두면 안전해요.
        </p>
        <div style={row}>
          <button type="button" className="btn btn-ghost" onClick={openPrint} disabled={!secretKey && !passwordHash}>
            🖨️ 인쇄용 보기
          </button>
          {!secretKey && !passwordHash && <span className="loading-note" style={{ margin: 0 }}>①이나 ②에서 값을 만들면 눌러져요.</span>}
        </div>
        {printNote && <div className="setup-alert">{printNote}</div>}
      </section>

      <section className="panel" style={{ paddingBottom: '14px' }}>
        <h2>④ Vercel 에 넣고 다시 배포하기</h2>
        <ol>
          <li>
            vercel.com 에 로그인 → 이 앱 프로젝트를 누름 → 위쪽 <b>Settings</b> → 왼쪽 <b>Environment Variables</b>.
          </li>
          <li>
            Key 에 <code>CONTRACT_SECRET_KEY</code>, Value 에 ①의 열쇠를 붙여 넣음. Environments 는 <b>Production 만</b> 체크(Preview·Development 는
            끔). <b>Sensitive</b> 는 켜지 않는 걸 권해요 — 켜면 Vercel 에서도 값을 다시 볼 수 없어 백업 역할을 못 해요. <b>Save</b>.
          </li>
          <li>
            같은 방법으로 <code>CONTRACT_PASSWORD_HASH</code> 에 ②의 해시를 넣고 Save. (비밀번호를 바꿀 때는 있던 줄의 <b>Edit</b> 로 값만 바꿈)
          </li>
          <li>
            위쪽 <b>Deployments</b> → 맨 위(가장 최근) 배포 오른쪽 <b>⋯</b> → <b>Redeploy</b>. 2~3분 기다리면 적용돼요.
          </li>
          <li>
            계약 관리 화면에서 🔒 를 눌러 방금 정한 비밀번호로 열리는지 확인해요. 이 화면을 새로 고치면 위에 &quot;✓ 설정됨&quot;이 떠요.
          </li>
        </ol>
        <p style={{ marginTop: '10px', marginBottom: 0 }}>
          비밀번호를 잊어도 저장된 비번·키는 안전해요 — ②에서 새 해시를 만들어 바꾸면 끝이에요. 반대로 <b>열쇠(①)는 바꾸거나 잃으면 안 돼요.</b>
        </p>
      </section>
    </div>
  );
}
