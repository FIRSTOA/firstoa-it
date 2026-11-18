'use client';

import { useRef, useState } from 'react';

/**
 * 사진 넣는 칸 — 서비스접수 화면처럼 "＋ 버튼만 파일 선택"이고, 나머지 빈 곳은 클릭하면
 * 포커스만 잡혀서 Ctrl+V로 붙여넣을 수 있어요(예전엔 칸 전체가 파일 열기라 붙여넣기 전에
 * 파일 창이 먼저 떠버렸음). 드래그해서 놓는 것도 그대로 됩니다.
 */
export default function PasteDropZone({
  onFiles,
  multiple = false,
  disabled = false,
  status,
  children,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  /** 처리 중 안내(예: "인식 중… 3/10") — 있으면 힌트 대신 보여줘요 */
  status?: string;
  /** 미리보기 등 ＋ 버튼 옆에 둘 내용 */
  children?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function pick(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0 || disabled) return;
    onFiles(multiple ? files : files.slice(0, 1));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    pick(files);
  }

  const active = focused || dragOver;

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label="사진 붙여넣기 칸 — 클릭 후 Ctrl+V"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPaste={handlePaste}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        pick(e.dataTransfer.files);
      }}
      style={{
        border: `2px ${active ? 'solid' : 'dashed'} ${active ? 'var(--indigo-600)' : 'var(--ink-200)'}`,
        borderRadius: 12,
        padding: 12,
        minHeight: 110,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: 'text',
        outline: 'none',
        boxShadow: focused ? '0 0 0 3px rgba(79, 70, 229, 0.15)' : 'none',
        background: dragOver ? 'var(--indigo-50, #eef2ff)' : 'transparent',
        transition: 'border-color .15s, box-shadow .15s',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <button
          type="button"
          title="파일 선택"
          aria-label="파일 선택"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          style={{
            width: 56,
            height: 56,
            flex: '0 0 auto',
            border: '1.5px dashed var(--ink-300, #cbd5e1)',
            borderRadius: 10,
            background: '#fff',
            color: 'var(--ink-500)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
            <path d="M16 5h6M19 2v6" />
          </svg>
        </button>
        {children}
      </div>
      <div style={{ fontSize: 12, color: status ? 'var(--indigo-600)' : focused ? 'var(--indigo-600)' : 'var(--ink-500)', marginTop: 'auto' }}>
        {status
          ? status
          : focused
            ? '붙여넣기 준비됐어요 — Ctrl+V 하세요 (＋ 버튼은 파일 선택, 사진을 끌어다 놓아도 돼요)'
            : '빈 곳을 클릭한 뒤 Ctrl+V로 붙여넣기 · ＋ 버튼은 파일 선택 · 사진을 끌어다 놓아도 돼요'}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
