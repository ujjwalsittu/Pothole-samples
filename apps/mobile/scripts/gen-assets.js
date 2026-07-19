#!/usr/bin/env node
/**
 * Generates the placeholder brand PNGs (icon, splash, adaptive-icon) without
 * any image library: raw RGBA pixels -> zlib deflate -> hand-built PNG chunks.
 * Dark navy background (#0B1220) with an amber road/pothole glyph.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NAVY = [0x0b, 0x12, 0x20, 255];
const CARD = [0x11, 0x1a, 0x2e, 255];
const AMBER = [0xf5, 0x9e, 0x0b, 255];
const DARK = [0x06, 0x0a, 0x14, 255];
const TEXT = [0xe5, 0xe7, 0xeb, 255];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(file, width, height, paint) {
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = paint(x, y) || NAVY;
      const o = (y * width + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = c[3];
    }
  }
  // add filter byte 0 per scanline
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    px.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  console.log(`gen-assets: wrote ${path.basename(file)} (${width}x${height}, ${png.length} bytes)`);
}

/**
 * Draws the brand glyph inside a square region [cx-half, cx+half].
 * A perspective road (trapezoid) with a center dashed line and a dark
 * pothole ellipse ringed in amber.
 */
function glyph(x, y, cx, cy, half) {
  const u = (x - cx) / half; // -1..1
  const v = (y - cy) / half; // -1..1
  if (u < -1 || u > 1 || v < -1 || v > 1) return null;
  // road trapezoid: narrow at top (horizon), wide at bottom
  const t = (v + 1) / 2; // 0 top -> 1 bottom
  const roadHalf = 0.18 + 0.62 * t;
  const inRoad = Math.abs(u) <= roadHalf && v >= -0.85 && v <= 0.95;
  // pothole ellipse, slightly right of center, lower half
  const pu = (u - 0.12) / 0.30;
  const pv = (v - 0.35) / 0.17;
  const pd = pu * pu + pv * pv;
  if (inRoad && pd <= 1) return DARK; // the pothole
  if (inRoad && pd <= 1.45) return AMBER; // amber ring
  if (inRoad) {
    // dashed center line
    const dashW = 0.035 * (0.4 + t);
    const dash = Math.abs(u + 0.0) <= dashW && Math.floor((v + 1) / 0.22) % 2 === 0;
    if (dash) return AMBER;
    return CARD; // road surface
  }
  // amber road edges
  const edge = Math.abs(Math.abs(u) - roadHalf) <= 0.045 && v >= -0.85 && v <= 0.95;
  if (edge) return AMBER;
  return null;
}

const ASSETS = path.resolve(__dirname, '..', 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// icon.png 1024x1024
writePng(path.join(ASSETS, 'icon.png'), 1024, 1024, (x, y) => {
  return glyph(x, y, 512, 512, 400) || NAVY;
});

// adaptive-icon.png 1024x1024 (glyph within safe zone)
writePng(path.join(ASSETS, 'adaptive-icon.png'), 1024, 1024, (x, y) => {
  return glyph(x, y, 512, 512, 300) || NAVY;
});

// splash.png 1284x2778 (glyph in upper-middle, amber bar as wordmark placeholder)
writePng(path.join(ASSETS, 'splash.png'), 1284, 2778, (x, y) => {
  const g = glyph(x, y, 642, 1150, 330);
  if (g) return g;
  // "wordmark" bar under the glyph
  if (y >= 1590 && y <= 1614 && x >= 642 - 260 && x <= 642 + 260) return TEXT;
  if (y >= 1650 && y <= 1662 && x >= 642 - 160 && x <= 642 + 160) return AMBER;
  return NAVY;
});
