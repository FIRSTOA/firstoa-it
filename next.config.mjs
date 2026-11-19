/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 홈 화면 앱(PWA) — Next 15.2+는 일반 브라우저에 메타데이터를 <body>로 늦게 흘려보내는데(streaming metadata),
  // 그러면 Chrome이 <link rel="manifest">를 무시해 설치가 안 되고 아이폰 apple-* 태그도 못 읽음.
  // 모든 브라우저를 "HTML 제한 봇"으로 쳐서 메타데이터를 <head>에 바로 넣게 함. 이 설정은 메타데이터 위치만
  // 바꾸고 화면의 Suspense 스트리밍(틀 먼저 띄우기)은 그대로. 우리 메타데이터는 고정값이라 기다릴 것도 없음.
  htmlLimitedBots: /.*/,
  experimental: {
    // 기본 1MB라 사진 OCR(실재고 조사/판매/입고/반출확인서)이 전부 바로 막혔음(실측: "Body
    // exceeded 1 MB limit"). 클라이언트에서 lib/imageResize.ts로 먼저 줄여 보내지만, 여유를
    // 두기 위해 서버 쪽 한도도 같이 올려둠.
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
