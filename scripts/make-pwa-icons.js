/**
 * 홈 화면 앱(PWA) 아이콘 PNG 만들기 — public/icons/ 에 4개를 새로 씀.
 *
 *   node scripts/make-pwa-icons.js                      # 기본: 퍼스트전산 토끼 캐릭터 + 오른쪽 아래 "IT" 명찰
 *   node scripts/make-pwa-icons.js --badge ""           # 명찰 없이 토끼만
 *   node scripts/make-pwa-icons.js --image 다른그림.png  # 다른 캐릭터(정사각형, 배경 흰색 권장)
 *   node scripts/make-pwa-icons.js --text IT            # 그림 없이 글자 아이콘(예전 방식)
 *   --color #4f46e5  명찰·글자 아이콘 색 (lib/pwa.ts THEME_COLOR 와 맞출 것)
 *
 * 토끼 원본: 바탕화면 IT이슈컨텐츠제작/토끼캐릭터_퍼스트전산.jpg 의 첫 번째(노트북 든) 토끼를
 * 머리~어깨만 잘라 scripts/assets/rabbit-it.png 로 넣어 둠(노트북 로고는 안 들어가게 그 위에서 자름).
 * 아이폰은 SVG 아이콘을 홈 화면에 못 써서 PNG로 만듦. sharp 는 next 를 깔 때 같이 깔림.
 *
 *   apple-touch-icon.png   180  아이폰 — 꽉 찬 네모(모서리는 iOS가 알아서 둥글게 자름)
 *   icon-192.png           192  안드로이드·설치 창 — 둥근 네모
 *   icon-512.png           512  안드로이드 시작 화면 — 둥근 네모
 *   icon-maskable-512.png  512  안드로이드 런처 — 꽉 찬 네모, 그림은 조금 작게, 명찰 없음
 *                              (런처가 원·물방울 모양으로 잘라도 얼굴·귀가 안 잘리게 — 안전 영역은 지름 80% 원)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const TEXT = arg('text', null);
const IMAGE = arg('image', path.join(__dirname, 'assets', 'rabbit-it.png'));
const BADGE = arg('badge', 'IT');
const COLOR = arg('color', '#4f46e5');
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');

const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, radius: 0, maskable: false },
  { file: 'icon-192.png', size: 192, radius: 0.22, maskable: false },
  { file: 'icon-512.png', size: 512, radius: 0.22, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, maskable: true },
];

function escapeXml(s) {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** #rrggbb 를 조금 어둡게 — 위→아래 은은한 그라데이션용 */
function darker(hex, amount = 0.14) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - amount)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const FONT = 'Segoe UI, Malgun Gothic, Apple SD Gothic Neo, Arial, sans-serif';

/** 그림 모드 — 캐릭터를 아래쪽에 붙여(흉상처럼) 깔고, 가슴 가운데에 명찰 */
async function imageIcon({ size, radius, maskable }) {
  const src = sharp(IMAGE);
  // 원본 바탕색(왼쪽 위 점)으로 캔버스를 채워서 그림 가장자리가 티 나지 않게
  const { data } = await src.clone().extract({ left: 1, top: 1, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const bg = { r: data[0], g: data[1], b: data[2] };
  const scale = maskable ? 0.8 : 1; // maskable 은 원으로 잘려도 귀 끝이 안전 영역 안에 오게 조금 작게
  const art = Math.round(size * scale);
  const artBuf = await src.clone().resize(art, art).toBuffer();
  const layers = [{ input: artBuf, left: Math.round((size - art) / 2), top: size - art }];
  // 명찰: 오른쪽 아래 어깨 위(얼굴 안 가리게). 안드로이드 원형(maskable)은 원 안에 얼굴을 안 가리는 빈자리가 없어 토끼만.
  if (BADGE && !maskable) {
    const w = size * (BADGE.length <= 2 ? 0.3 : 0.42);
    const h = size * 0.15;
    const x = size * 0.95 - w;
    const y = size * 0.8;
    const fs = h * 0.66;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.3}" fill="${COLOR}" stroke="#ffffff" stroke-width="${size * 0.012}"/>
      <text x="${x + w / 2}" y="${y + h / 2 + fs * 0.35}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="800" font-size="${fs}">${escapeXml(BADGE)}</text>
    </svg>`;
    layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
  }
  let img = sharp({ create: { width: size, height: size, channels: 4, background: { ...bg, alpha: 1 } } }).composite(layers);
  if (radius > 0) {
    // 둥근 네모 모양으로 자름(안드로이드 설치 창·시작 화면)
    const flat = await img.png().toBuffer();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * radius}" fill="#fff"/></svg>`);
    img = sharp(flat).composite([{ input: mask, blend: 'dest-in' }]);
  } else {
    img = sharp(await img.png().toBuffer()).flatten({ background: bg }); // 아이폰은 투명이 있으면 검게 나옴
  }
  return img.png();
}

/** 글자 모드(예전) — 대표 색 바탕에 흰 글자 */
function textIcon({ size, radius, maskable }) {
  const scale = (maskable ? 0.3 : 0.44) * (TEXT.length <= 1 ? 1.2 : 1);
  const fontSize = size * scale;
  const baseline = size / 2 + fontSize * 0.35;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COLOR}"/><stop offset="1" stop-color="${darker(COLOR)}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${size * radius}" fill="url(#g)"/>
  <text x="50%" y="${baseline}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="800" font-size="${fontSize}" letter-spacing="${fontSize * 0.02}">${escapeXml(TEXT)}</text>
</svg>`;
  let img = sharp(Buffer.from(svg));
  if (radius === 0) img = img.flatten({ background: COLOR });
  return img.png();
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const icon of ICONS) {
    const out = path.join(OUT_DIR, icon.file);
    const img = TEXT ? textIcon(icon) : await imageIcon(icon);
    await img.toFile(out);
    console.log(`${icon.file}  ${icon.size}×${icon.size}`);
  }
  console.log(`→ ${path.relative(process.cwd(), OUT_DIR)}  (${TEXT ? `글자 "${TEXT}"` : `그림 ${path.basename(IMAGE)}${BADGE ? ` + 명찰 "${BADGE}"` : ''}`}, 색 ${COLOR})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
