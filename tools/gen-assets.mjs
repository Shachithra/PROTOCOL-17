// Generates Protocol 17 static assets with zero dependencies:
//   assets/textures/{grain,noise,scanlines}.png
//   assets/icons/{icon-192,icon-512,maskable-512}.png
//   favicon.ico  (PNG-in-ICO)
// Run: node tools/gen-assets.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- PNG encoder ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// rgba: Uint8Array of w*h*4
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy
      ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
      : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(
          raw,
          y * (w * 4 + 1) + 1
        );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function newCanvas(w, h, fill = [0, 0, 0, 0]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = fill[0];
    buf[i * 4 + 1] = fill[1];
    buf[i * 4 + 2] = fill[2];
    buf[i * 4 + 3] = fill[3];
  }
  return { buf, w, h };
}

function setPx(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  // alpha-over onto existing
  const oa = c.buf[i + 3] / 255;
  const na = a / 255;
  const outA = na + oa * (1 - na);
  if (outA <= 0) return;
  c.buf[i] = Math.round((r * na + c.buf[i] * oa * (1 - na)) / outA);
  c.buf[i + 1] = Math.round((g * na + c.buf[i + 1] * oa * (1 - na)) / outA);
  c.buf[i + 2] = Math.round((b * na + c.buf[i + 2] * oa * (1 - na)) / outA);
  c.buf[i + 3] = Math.round(outA * 255);
}

/* ---------------- textures ---------------- */

function grain(size = 64) {
  const c = newCanvas(size, size, [0, 0, 0, 0]);
  for (let i = 0; i < size * size; i++) {
    const v = Math.random();
    const bright = Math.random() > 0.5;
    const a = Math.floor(v * 90);
    const idx = i * 4;
    c.buf[idx] = bright ? 230 : 40;
    c.buf[idx + 1] = bright ? 227 : 38;
    c.buf[idx + 2] = bright ? 221 : 36;
    c.buf[idx + 3] = a;
  }
  return encodePNG(size, size, c.buf);
}

function noise(size = 128) {
  const c = newCanvas(size, size, [0, 0, 0, 0]);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(Math.random() * 255);
    const idx = i * 4;
    c.buf[idx] = v;
    c.buf[idx + 1] = v;
    c.buf[idx + 2] = v;
    c.buf[idx + 3] = Math.random() > 0.72 ? 110 : 0;
  }
  return encodePNG(size, size, c.buf);
}

function scanlines(w = 4, h = 4) {
  const c = newCanvas(w, h, [0, 0, 0, 0]);
  for (let x = 0; x < w; x++) setPx(c, x, 0, [0, 0, 0, 160]);
  return encodePNG(w, h, c.buf);
}

/* ---------------- icons ---------------- */

const GLYPH = {
  "1": [
    "..#..",
    ".##..",
    "..#..",
    "..#..",
    "..#..",
    "..#..",
    ".###."
  ],
  "7": [
    "#####",
    "....#",
    "...#.",
    "..#..",
    "..#..",
    "..#..",
    "..#.."
  ]
};

function drawGlyph17(c, originX, originY, scale, color) {
  const drawChar = (ch, ox) => {
    const rows = GLYPH[ch];
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] !== "#") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPx(c, ox + x * scale + sx, originY + y * scale + sy, color);
          }
        }
      }
    }
  };
  drawChar("1", originX);
  drawChar("7", originX + 7 * scale);
}

function icon(size, { maskable = false, frame = true } = {}) {
  const c = newCanvas(size, size, [5, 5, 5, 255]);

  if (frame) {
    const inset = maskable ? Math.round(size * 0.06) : Math.round(size * 0.1);
    const th = Math.max(2, Math.round(size * 0.012));
    for (let x = inset; x < size - inset; x++) {
      for (let t = 0; t < th; t++) {
        setPx(c, x, inset + t, [101, 99, 94, 255]);
        setPx(c, x, size - inset - t, [101, 99, 94, 255]);
      }
    }
    for (let y = inset; y < size - inset; y++) {
      for (let t = 0; t < th; t++) {
        setPx(c, inset + t, y, [101, 99, 94, 255]);
        setPx(c, size - inset - t, y, [101, 99, 94, 255]);
      }
    }
  }

  // glyph 17
  const scale = Math.max(2, Math.round(size / 40));
  const glyphW = 12 * scale; // 5 + gap2 + 5
  const glyphH = 7 * scale;
  const ox = Math.round((size - glyphW) / 2);
  const oy = Math.round((size - glyphH) / 2);
  drawGlyph17(c, ox, oy, scale, [230, 227, 221, 255]);

  return encodePNG(size, size, c.buf);
}

function icoFromPNG(png32) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 32; // width
  entry[1] = 32; // height
  entry[2] = 0; // palette
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png32.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([header, entry, png32]);
}

/* ---------------- write ---------------- */

mkdirSync(join(root, "assets", "textures"), { recursive: true });
mkdirSync(join(root, "assets", "icons"), { recursive: true });

writeFileSync(join(root, "assets", "textures", "grain.png"), grain());
writeFileSync(join(root, "assets", "textures", "noise.png"), noise());
writeFileSync(join(root, "assets", "textures", "scanlines.png"), scanlines());

writeFileSync(join(root, "assets", "icons", "icon-192.png"), icon(192));
writeFileSync(join(root, "assets", "icons", "icon-512.png"), icon(512));
writeFileSync(
  join(root, "assets", "icons", "maskable-512.png"),
  icon(512, { maskable: true, frame: false })
);

writeFileSync(join(root, "favicon.ico"), icoFromPNG(icon(32, { frame: false })));

console.log("assets written.");
