#!/usr/bin/env node
// Generates the platform icons from assets/icon.png. Pure Node.js, no dependencies
// (no ImageMagick): it runs on any OS, and the VS Code extension calls it directly.
//
//   node tools/gen_icons.js [all|android|windows|ios|web]      (default: all)
//
// Desktop windows use assets/icon.png directly (nothing to generate).
// Outputs are committed, so this only needs to run when assets/icon.png changes.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG decode / encode

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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Returns { width, height, data } with data = RGBA (8 bits per channel).
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file');
  let pos = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error('only 8-bit non-interlaced PNG is supported (re-save icon.png as RGBA PNG)');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (colorType === 6) { [r, g, b, a] = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]]; }
    else if (colorType === 2) { [r, g, b] = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]]; }
    else if (colorType === 0) { r = g = b = px[i]; }
    else if (colorType === 4) { r = g = b = px[i * 2]; a = px[i * 2 + 1]; }
    else { const idx = px[i]; [r, g, b] = [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]]; if (trns && idx < trns.length) a = trns[idx]; }
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

// img = { width, height, data: RGBA }; withAlpha=false writes an RGB PNG (alpha dropped).
function encodePng(img, withAlpha = true) {
  const ch = withAlpha ? 4 : 3;
  const rows = Buffer.alloc((img.width * ch + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    const o = y * (img.width * ch + 1);
    rows[o] = 0;
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4, d = o + 1 + x * ch;
      rows[d] = img.data[s]; rows[d + 1] = img.data[s + 1]; rows[d + 2] = img.data[s + 2];
      if (withAlpha) rows[d + 3] = img.data[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; ihdr[9] = withAlpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- image operations

// Centers the image on a transparent square canvas.
function padSquare(img) {
  const n = Math.max(img.width, img.height);
  const data = Buffer.alloc(n * n * 4);
  const ox = Math.floor((n - img.width) / 2), oy = Math.floor((n - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    img.data.copy(data, ((y + oy) * n + ox) * 4, y * img.width * 4, (y + 1) * img.width * 4);
  }
  return { width: n, height: n, data };
}

// Area-averaging resize with premultiplied alpha (good quality for both up and down scaling).
function resize(img, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = img.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = x * scale, x1 = (x + 1) * scale, y0 = y * scale, y1 = (y + 1) * scale;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.min(Math.ceil(y1), img.height); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.min(Math.ceil(x1), img.width); sx++) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
          const i = (sy * img.width + sx) * 4, al = img.data[i + 3] / 255;
          r += img.data[i] * al * w; g += img.data[i + 1] * al * w; b += img.data[i + 2] * al * w;
          a += al * w; wsum += w;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / wsum) * 255);
    }
  }
  return { width: size, height: size, data: out };
}

function flattenOnWhite(img) {
  const data = Buffer.from(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const al = data[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * al + 255 * (1 - al));
    data[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}

// ICO with PNG-compressed entries (supported since Windows Vista).
function encodeIco(pngs) {   // pngs: [{ size, png: Buffer }]
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((p, i) => {
    const o = 6 + 16 * i;
    head[o] = p.size >= 256 ? 0 : p.size; head[o + 1] = p.size >= 256 ? 0 : p.size;
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(p.png.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += p.png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

// ---------------------------------------------------------------- generators

function write(root, rel, data, log) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  log(`  ${rel}`);
}

const TARGETS = {
  android(root, sq, log) {
    const dpi = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const [name, size] of Object.entries(dpi)) {
      write(root, `android/app/src/main/res/mipmap-${name}/ic_launcher.png`, encodePng(resize(sq, size)), log);
    }
  },
  windows(root, sq, log) {   // embedded in the exe through icons/app.rc
    const sizes = [256, 128, 64, 48, 32, 24, 16];
    write(root, 'icons/icon.ico', encodeIco(sizes.map((size) => ({ size, png: encodePng(resize(sq, size)) }))), log);
    write(root, 'icons/icon-1024.png', encodePng(resize(sq, 1024)), log);
  },
  web(root, sq, log) {       // favicon + iPhone home-screen icon + installable-app (PWA) icons
    const dir = 'icons/web';
    write(root, `${dir}/favicon.ico`, encodeIco([48, 32, 16].map((size) => ({ size, png: encodePng(resize(sq, size)) }))), log);
    write(root, `${dir}/apple-touch-icon.png`, encodePng(flattenOnWhite(resize(sq, 180)), false), log);   // iOS ignores alpha
    write(root, `${dir}/icon-192.png`, encodePng(resize(sq, 192)), log);
    write(root, `${dir}/icon-512.png`, encodePng(resize(sq, 512)), log);
    write(root, `${dir}/manifest.webmanifest`, JSON.stringify({
      name: 'raylib button', short_name: 'raylib button', start_url: '.', display: 'fullscreen',
      background_color: '#000000', theme_color: '#000000',
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
    }, null, 2) + '\n', log);
  },
  ios(root, sq, log) {       // single 1024x1024 image without alpha (App Store requirement)
    const dir = 'ios/AppIcon.xcassets';
    write(root, `${dir}/AppIcon.appiconset/icon-1024.png`, encodePng(flattenOnWhite(resize(sq, 1024)), false), log);
    write(root, `${dir}/Contents.json`, '{ "info": { "author": "xcode", "version": 1 } }\n', log);
    write(root, `${dir}/AppIcon.appiconset/Contents.json`, JSON.stringify({
      images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
      info: { author: 'xcode', version: 1 },
    }, null, 2) + '\n', log);
  },
};

// root: project folder; target: all|android|windows|ios; log: function(line)
function generate(root, target = 'all', log = console.log) {
  const names = target === 'all' ? Object.keys(TARGETS) : [target];
  for (const n of names) if (!TARGETS[n]) throw new Error(`unknown target '${target}' (all|${Object.keys(TARGETS).join('|')})`);
  const src = path.join(root, 'assets', 'icon.png');
  if (!fs.existsSync(src)) throw new Error(`missing ${src}`);
  const sq = padSquare(decodePng(fs.readFileSync(src)));
  for (const n of names) { log(`${n}:`); TARGETS[n](root, sq, log); }
  return names;
}

module.exports = { generate, targets: Object.keys(TARGETS) };

if (require.main === module) {
  try {
    generate(path.resolve(__dirname, '..'), process.argv[2] || 'all');
    console.log('icons generated');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
