// Writes the 240×120 PNG of seeded colour tiles used by the example apps (no third-party
// content) to the path given as the first argument:
//   node scripts/generate-hero-png.js examples/vite-app/src/hero.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const [w, h] = [240, 120];
let seed = 41;
const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
const raw = Buffer.alloc((w * 3 + 1) * h);
for (let y = 0; y < h; y++) {
  raw[y * (w * 3 + 1)] = 0;
  for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    // 4×4 tiles of seeded colours, so the file is a few kilobytes.
    const tile = ((y / 4) | 0) * 1000 + ((x / 4) | 0);
    seed = tile * 2654435761 + 41;
    raw[o] = next();
    raw[o + 1] = next();
    raw[o + 2] = next();
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0);
ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(
  process.argv[2],
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
