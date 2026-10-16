// Renders the extension icons (green tile + shuttlecock) as PNGs without dependencies.
// Usage: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

function shade(x, y) {
  // Unit coordinates in [0, 1].
  const r = 0.2;
  const dx = Math.max(r - x, 0, x - (1 - r));
  const dy = Math.max(r - y, 0, y - (1 - r));
  if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
  const head = (x - 0.5) ** 2 + (y - 0.7) ** 2 < 0.11 ** 2;
  const inSkirt = y > 0.18 && y < 0.62 && Math.abs(x - 0.5) < 0.06 + (0.62 - y) * 0.45;
  const rib = inSkirt && [0.5, 0.42, 0.58].some((cx) => Math.abs(x - (cx + (cx - 0.5) * (0.62 - y) * 2)) < 0.012);
  if (head) return [251, 191, 36, 255];
  if (inSkirt && !rib) return [236, 253, 245, 255];
  return [4, 120, 87, 255];
}

function png(size) {
  const samples = 4;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = shade((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
          for (let i = 0; i < 4; i += 1) acc[i] += px[i];
        }
      }
      for (let i = 0; i < 4; i += 1) row[1 + x * 4 + i] = Math.round(acc[i] / samples ** 2);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = new URL('../public/icon/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`${size}.png`, outDir), png(size));
console.log('Icons written to public/icon/');
