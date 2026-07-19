#!/usr/bin/env node
/**
 * Bug-027 (2026-07-20 E2E)：生成 1200×630 PNG og-image
 *
 * 设计：深色背景 + 大字标题 + 副标题（无外部依赖，纯 Node zlib）
 * 输出：public/og-image.png（PNG 8-bit RGB）
 */
const fs = require('node:fs');
const zlib = require('node:zlib');

const W = 1200;
const H = 630;
const BG = [10, 10, 10]; // #0a0a0a
const ACCENT = [222, 219, 200]; // #DEDBC8

/**
 * 5x7 bitmap font（仅大写字母 + 数字 + 空格 + 冒号 + 感叹号）
 * 复用 Pattern: 5 columns × 7 rows, 1 bit per pixel
 */
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  I: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x1f],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  E: [0x1f, 0x01, 0x01, 0x0f, 0x01, 0x01, 0x1f],
  R: [0x1f, 0x11, 0x11, 0x0f, 0x05, 0x09, 0x11],
  V: [0x11, 0x11, 0x11, 0x11, 0x0a, 0x0a, 0x04],
  B: [0x1f, 0x11, 0x11, 0x0f, 0x11, 0x11, 0x1f],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f],
  D: [0x0f, 0x09, 0x11, 0x11, 0x11, 0x09, 0x0f],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1f, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x01],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  S: [0x0e, 0x11, 0x01, 0x0e, 0x10, 0x11, 0x0e],
  L: [0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x1f],
  F: [0x1f, 0x01, 0x01, 0x0f, 0x01, 0x01, 0x01],
  C: [0x0e, 0x11, 0x01, 0x01, 0x01, 0x11, 0x0e],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  G: [0x0e, 0x11, 0x01, 0x1d, 0x11, 0x11, 0x0e],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  ':': [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x10, 0x08, 0x04, 0x02, 0x1f],
  3: [0x1f, 0x08, 0x04, 0x08, 0x10, 0x11, 0x0e],
  '+': [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  '*': [0x00, 0x0a, 0x04, 0x1f, 0x04, 0x0a, 0x00],
};

const scale = 4;
const charW = 5 * scale + scale; // 24px
const charH = 7 * scale; // 28px

function drawText(buf, text, x0, y0, color) {
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (!glyph) {
      x += charW;
      continue;
    }
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[r] & (1 << (4 - c))) {
          // 填充 scale×scale 块
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = x + c * scale + dx;
              const py = y0 + r * scale + dy;
              if (px < W && py < H) {
                const idx = (py * W + px) * 3;
                buf[idx] = color[0];
                buf[idx + 1] = color[1];
                buf[idx + 2] = color[2];
              }
            }
          }
        }
      }
    }
    x += charW;
  }
}

// 1. 分配 RGB 缓冲区
const pixels = Buffer.alloc(W * H * 3, 0);
for (let i = 0; i < pixels.length; i += 3) {
  pixels[i] = BG[0];
  pixels[i + 1] = BG[1];
  pixels[i + 2] = BG[2];
}

// 2. 绘制文本（两行）
const title1 = 'INTERVIEW BUDDY';
const title2 = 'AI - 35+  -  16 GUAN';

// 中文字符 fallback: 用 ASCII-only 第二行
const title2Ascii = 'AI - 35+ - 16 GUAN';

const t1W = title1.length * charW;
const t2W = title2Ascii.length * charW;
drawText(pixels, title1, Math.floor((W - t1W) / 2), 220, ACCENT);
drawText(pixels, title2Ascii, Math.floor((W - t2W) / 2), 320, [180, 180, 180]);

// 副标题
const sub = 'BYTEDANCE  ALIBABA  TENCENT  BILIBILI';
const subW = sub.length * charW;
drawText(pixels, sub, Math.floor((W - subW) / 2), 420, [120, 120, 120]);

// 3. PNG 编码
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// 加 filter byte (0 = None) 到每行
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  pixels.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const idat = zlib.deflateSync(raw);

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const outPath =
  process.argv[2] || '/Users/opc-1/Downloads/O/jianli/interview-buddy/public/og-image.png';
fs.mkdirSync(require('node:path').dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log(`OK: ${outPath} (${png.length} bytes, ${W}x${H})`);
