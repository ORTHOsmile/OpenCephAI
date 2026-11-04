import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

// App icon (owner, 15 Oct 2026): the OpenCephAI head on a white rounded tile, corners see-through. This reads the
// real PNG the bundler uses (RGBA, 8-bit, no interlace) and checks one corner pixel and the tile's left edge.
function pixels(file: string): { w: number; h: number; at: (x: number, y: number) => number[] } {
  const buf = readFileSync(join(__dirname, '../src-tauri/icons', file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], colour = buf[25];
  expect([depth, colour]).toEqual([8, 6]); // 8-bit RGBA
  const idat: Buffer[] = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4] : 0, b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + i] = (line[i] + pred) & 0xff;
    }
  }
  return { w, h, at: (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 4)] };
}

describe('the app icon is the OpenCephAI head on a white rounded tile', () => {
  it('icon.png: corner see-through, tile edge solid white', () => {
    const p = pixels('icon.png');
    expect(p.at(0, 0)[3]).toBe(0);                                 // rounded corner: transparent
    const mid = p.at(Math.round(p.w * 0.12), Math.round(p.h / 2)); // just inside the tile's left edge
    expect(mid[3]).toBe(255);
    expect(Math.min(mid[0], mid[1], mid[2])).toBeGreaterThan(240);  // white, not the old grey
  });
});
