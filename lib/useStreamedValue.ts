'use client';

import { useEffect, useState } from 'react';

/**
 * 서버 페이지가 기다리지 않고 Promise 그대로 넘긴 값(구글시트 IT재고에서 뽑는 위치 목록 등)을
 * 받아, 화면은 먼저 그리고 값이 도착하면 채웁니다. 도착 전엔 initial.
 * 새로고침(router.refresh)으로 새 Promise가 오면, 도착할 때까지 이전 값을 그대로 보여 줍니다.
 * 실패는 서버 쪽에서 미리 catch해서 넘겨야 합니다(여기선 무시).
 */
export function useStreamedValue<T>(source: Promise<T> | T, initial: T): T {
  const [value, setValue] = useState<T>(() => (isThenable(source) ? initial : source));
  useEffect(() => {
    if (!isThenable(source)) {
      setValue(source);
      return;
    }
    let alive = true;
    source.then(
      (v) => {
        if (alive) setValue(v);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [source]);
  return value;
}

function isThenable<T>(v: Promise<T> | T): v is Promise<T> {
  return typeof (v as { then?: unknown } | null)?.then === 'function';
}
