/**
 * Writes the Android launcher icons (all densities) from the same design as
 * the PWA icons. Run after `npx cap add android`: node scripts/make-android-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const res = path.join(here, '..', 'android', 'app', 'src', 'main', 'res');

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TEAL = [15, 61, 55, 255];
const CORAL = [242, 107, 58, 255];
const WHITE = [255, 255, 255, 255];

/** shape: 'square' (rounded tile), 'circle', or 'foreground' (adaptive, content in the middle 2/3). */
function icon(size, shape) {
  const inset = shape === 'foreground' ? size / 6 : 0;
  const inner = size - inset * 2;
  const radius = inner * 0.22;
  const inside = (x, y) => {
    const lx = x - inset;
    const ly = y - inset;
    if (shape === 'foreground') return true; // background is drawn edge to edge
    if (shape === 'circle') return Math.hypot(x - size / 2, y - size / 2) <= size / 2;
    const cx = Math.min(Math.max(lx, radius), inner - radius);
    const cy = Math.min(Math.max(ly, radius), inner - radius);
    return (lx - cx) ** 2 + (ly - cy) ** 2 <= radius ** 2;
  };
  const p = (fx, fy) => [inset + inner * fx, inset + inner * fy];
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
    if (!inside(x, y)) return [0, 0, 0, 0];
    if (dist(x, y, dx, dy) <= inner * 0.12) return CORAL;
    if (dist(x, y, rx, ry) <= inner * 0.12 && dist(x, y, rx, ry) >= inner * 0.06) return WHITE;
    if (segDist(x, y) <= inner * 0.045) return WHITE;
    return TEAL;
  };
}

const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, size] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png(size, icon(size, 'square')));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), png(size, icon(size, 'circle')));
  const fg = Math.round(size * 2.25); // adaptive icon foreground is 108dp for a 48dp icon
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), png(fg, icon(fg, 'foreground')));
  console.log('wrote mipmap-' + d);
}

// Splash background colour to match the brand.
const valuesDir = path.join(res, 'values');
const colors = path.join(valuesDir, 'ic_launcher_background.xml');
if (fs.existsSync(colors)) {
  fs.writeFileSync(colors, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F3D37</color>\n</resources>\n');
  console.log('set adaptive icon background colour');
}
