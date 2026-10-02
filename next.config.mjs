/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // 기본 1MB라 사진 OCR(실재고 조사/판매/입고/반출확인서)이 전부 바로 막혔음(실측: "Body
    // exceeded 1 MB limit"). 클라이언트에서 lib/imageResize.ts로 먼저 줄여 보내지만, 여유를
    // 두기 위해 서버 쪽 한도도 같이 올려둠.
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
