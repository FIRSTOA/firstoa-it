'use client';

import { isSafeSpreadsheetUrl } from '@/lib/spreadsheetLink';

type Props = {
  url: string | null;
};

/** 상단 툴바의 "스프레드시트 열기" 버튼. 현재 화면은 그대로 두고 새 탭에서만 엽니다. */
export default function SpreadsheetLinkButton({ url }: Props) {
  const safeUrl = url && isSafeSpreadsheetUrl(url) ? url : null;

  if (!safeUrl) {
    return (
      <button type="button" className="btn btn-ghost" disabled title="스프레드시트 주소가 설정되지 않았어요.">
        📊 스프레드시트 열기
      </button>
    );
  }

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-ghost"
      style={{ textDecoration: 'none' }}
    >
      📊 스프레드시트 열기
    </a>
  );
}
