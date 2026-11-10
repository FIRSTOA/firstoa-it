const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1) X8420 자산 상세 — 임대·청구 섹션
  await page.goto('https://firstoa-it.vercel.app/', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="검색"], input[type="text"]', 'X8420').catch(() => {});
  // 검색창이 여러 개일 수 있어 첫 번째 text input에 입력 시도 후, 자산번호 버튼을 직접 찾음
  await page.waitForTimeout(800);
  const assetBtn = page.locator('.asset-id', { hasText: 'X8420' }).first();
  const count = await assetBtn.count();
  console.log('X8420 asset-id elements found on /:', count);
  if (count > 0) {
    await assetBtn.click();
    await page.waitForTimeout(500);
    await page.waitForTimeout(1500); // 임대·청구 섹션 서버 액션 로딩 대기
    const sectionText = await page.locator('.modal-overlay.open .modal').innerText().catch((e) => 'ERR:' + e.message);
    console.log('--- Modal full text (first 2000 chars) ---');
    console.log(sectionText.slice(0, 2000));
  }
  console.log('Page errors after asset detail:', errors);

  // 2) /rentals 종료거래처 탭에서 X8420 검색 → 자산코드 클릭 → 새 탭에서 상세 자동 오픈
  const page2 = await browser.newPage();
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push(String(e)));
  await page2.goto('https://firstoa-it.vercel.app/rentals', { waitUntil: 'networkidle' });
  await page2.click('button:has-text("종료거래처")');
  await page2.waitForTimeout(500);
  const searchInputs = await page2.locator('input[type="text"]').count();
  console.log('search input count on /rentals:', searchInputs);
  await page2.locator('input[type="text"]').first().fill('X8420');
  await page2.waitForTimeout(1500);
  const rowsText = await page2.locator('table').innerText().catch((e) => 'ERR:' + e.message);
  console.log('--- /rentals table text (first 1000 chars) ---');
  console.log(rowsText.slice(0, 1000));
  const link = page2.locator('a.asset-id', { hasText: 'X8420' }).first();
  const linkCount = await link.count();
  console.log('/rentals 종료거래처에서 X8420 링크 개수:', linkCount);
  if (linkCount > 0) {
    const href = await link.getAttribute('href');
    console.log('link href:', href);
  }
  console.log('Page errors on /rentals:', errors2);

  // 3) /billing 페이지 로드 확인
  const page3 = await browser.newPage();
  const errors3 = [];
  page3.on('pageerror', (e) => errors3.push(String(e)));
  await page3.goto('https://firstoa-it.vercel.app/billing', { waitUntil: 'networkidle' });
  const heading = await page3.locator('h1, .page-title, header').first().innerText().catch(() => '(no heading found)');
  const bodyText = await page3.innerText('body').catch(() => '');
  console.log('billing page has "청구리스트" text:', bodyText.includes('청구리스트'));
  console.log('billing page has "청구 명세 추가" button:', bodyText.includes('청구 명세 추가'));
  console.log('Page errors on /billing:', errors3);

  await browser.close();
})();
