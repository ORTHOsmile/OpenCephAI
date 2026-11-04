// SYNTHETIC test image: a grey gradient with a few bright ellipses. No patient data.
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out', 'synthetic.png'); fs.mkdirSync(path.dirname(OUT), { recursive: true });
const W = 1200, H = 1400, raw = Buffer.alloc((W + 1) * H);
const blobs = [[400,300,120,90],[1100,210,60,60],[800,900,160,120],[600,1100,200,80]];
for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; for (let x = 0; x < W; x++) {
  let v = 30 + 60 * (x / W) + 30 * (y / H);
  for (const [cx, cy, rx, ry] of blobs) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1) v += 90;
  raw[y * (W + 1) + 1 + x] = Math.min(255, v | 0); } }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
fs.writeFileSync(OUT, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
