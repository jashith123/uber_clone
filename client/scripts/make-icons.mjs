/**
 * Generates the PWA icons as real PNG files with no dependencies
 * (Node's zlib + a tiny PNG encoder). Run: node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * stride + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Black rounded tile, white pickup dot, white destination ring, white route stroke. */
function icon(size, { padding = 0 } = {}) {
  const S = size;
  const pad = S * padding;
  const inner = S - pad * 2;
  const radius = inner * 0.22;
  const inRounded = (x, y) => {
    const lx = x - pad;
    const ly = y - pad;
    if (lx < 0 || ly < 0 || lx > inner || ly > inner) return false;
    const cx = Math.min(Math.max(lx, radius), inner - radius);
    const cy = Math.min(Math.max(ly, radius), inner - radius);
    return (lx - cx) ** 2 + (ly - cy) ** 2 <= radius ** 2;
  };
  const p = (fx, fy) => [pad + inner * fx, pad + inner * fy];
  const [dx, dy] = p(0.31, 0.69);
  const [rx, ry] = p(0.69, 0.31);
  const [ax, ay] = p(0.4, 0.6);
  const [bx, by] = p(0.6, 0.4);
  const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);
  const segDist = (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
  };
  return (x, y) => {
    if (!inRounded(x, y)) return padding ? [0, 0, 0, 255] : [0, 0, 0, 0];
    const white =
      dist(x, y, dx, dy) <= inner * 0.12 ||
      (dist(x, y, rx, ry) <= inner * 0.12 && dist(x, y, rx, ry) >= inner * 0.06) ||
      segDist(x, y) <= inner * 0.045;
    return white ? [255, 255, 255, 255] : [0, 0, 0, 255];
  };
}

const files = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { padding: 0.1 }],
  ['apple-touch-icon.png', 180, {}],
];
for (const [name, size, opts] of files) {
  fs.writeFileSync(path.join(outDir, name), png(size, icon(size, opts)));
  console.log('wrote', name);
}
