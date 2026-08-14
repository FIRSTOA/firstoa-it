'use client';

import { useRef, useTransition, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { bulkUpsertAssets } from '@/app/actions';
import { assetToExcelRow, EXCEL_HEADERS, parseExcelRows } from '@/lib/excel';
import type { Asset } from '@/lib/types';

type Props = {
  items: Asset[];
  disabled: boolean;
  onToast: (msg: string) => void;
};

export default function ExcelActions({ items, disabled, onToast }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleDownload() {
    const rows = items.map(assetToExcelRow);
    const sheet = XLSX.utils.json_to_sheet(rows, { header: [...EXCEL_HEADERS] });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'IT재고');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `IT재고_${stamp}.xlsx`);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 다시 선택해도 onChange가 발생하도록 초기화
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    const { valid, errors } = parseExcelRows(rawRows);
    if (valid.length === 0) {
      onToast(errors.length ? `가져올 수 있는 행이 없어요 (${errors.length}건 형식 오류)` : '엑셀에 데이터가 없어요.');
      return;
    }

    startTransition(async () => {
      const result = await bulkUpsertAssets(valid);
      if (!result.ok) {
        onToast(result.error);
        return;
      }
      onToast(
        errors.length
          ? `${result.count}건 반영했어요. (${errors.length}건은 형식 오류로 건너뜀)`
          : `${result.count}건 반영했어요.`,
      );
    });
  }

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={handleDownload} disabled={disabled}>
        ⬇ 엑셀 다운로드
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={disabled || pending}
        onClick={() => fileInputRef.current?.click()}
      >
        {pending ? '업로드 중…' : '⬆ 엑셀 업로드'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  );
}
