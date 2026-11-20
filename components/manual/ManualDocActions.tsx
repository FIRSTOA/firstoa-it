'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/** 설명서 위 오른쪽 버튼 — 링크 복사(카톡으로 보내기) · 새 탭으로 · 설명하는 실제 화면 열기 */
export default function ManualDocActions({ docKey, href }: { docKey: string; href: string }) {
  const path = `/manual/${docKey}`;
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  async function copy() {
    const url = `${window.location.origin}${path}`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // 오래된 브라우저·카톡 안 브라우저 — 숨긴 입력칸으로 복사
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopied(ok ? 'ok' : 'fail');
    if (!ok) window.prompt('이 주소를 복사해 주세요', url);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mn-doc-actions">
      <button type="button" className="btn btn-ghost mn-act" onClick={() => void copy()}>
        {copied === 'ok' ? '✓ 복사했어요' : '🔗 링크 복사'}
      </button>
      <a className="btn btn-ghost mn-act" href={path} target="_blank" rel="noopener noreferrer">
        ↗ 새 탭으로
      </a>
      <Link className="btn btn-primary mn-act" href={href}>
        화면 열기 →
      </Link>
    </div>
  );
}
