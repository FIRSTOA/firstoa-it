'use client';

import { useRef, useTransition, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { bulkUpsertAssets } from '@/app/actions';
import {
  assetToExcelRow,
  buildTemplateExampleRows,
  EXCEL_COLUMN_GUIDE,
  EXCEL_HEADERS,
  parseExcelRows,
} from '@/lib/excel';
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

  /**
   * 업로드용 빈 템플릿 — 지금 가진 실제 데이터가 아니라 형식 안내용입니다. 나중에 데이터
   * 소스를 다른 시스템으로 전환할 때 이 형식 그대로 일괄 업로드에 쓸 수 있도록, 미리
   * 데이터를 이 형식으로 준비해둘 수 있게 하는 용도입니다.
   */
  function handleDownloadTemplate() {
    const workbook = XLSX.utils.book_new();

    const exampleSheet = XLSX.utils.json_to_sheet(buildTemplateExampleRows(), { header: [...EXCEL_HEADERS] });
    XLSX.utils.book_append_sheet(workbook, exampleSheet, 'IT재고_템플릿');

    const guideRows = EXCEL_COLUMN_GUIDE.map((g) => ({
      컬럼명: g.column,
      필수여부: g.required ? '필수' : '선택',
      작성방법: g.description,
    }));
    const guideSheet = XLSX.utils.json_to_sheet(guideRows, { header: ['컬럼명', '필수여부', '작성방법'] });
    XLSX.utils.book_append_sheet(workbook, guideSheet, '작성법');

    XLSX.writeFile(workbook, 'IT재고_업로드템플릿.xlsx');
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
        onClick={handleDownloadTemplate}
        disabled={disabled}
        title="업로드할 때 쓰는 형식 안내 + 품목별 예시 행이 담긴 빈 템플릿이에요."
      >
        📄 템플릿 다운로드
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
