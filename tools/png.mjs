/**
 * A minimal RGBA PNG encoder and a tiny supersampled rasteriser.
 *
 * Shared by the icon and store-asset generators so there is one implementation
 * of "put these shapes in a file", and so the whole visual identity can be
 * rebuilt from source with nothing but Node installed. No ImageMagick, no
 * headless browser - a build that needs those to make a 16px PNG is a build
 * that breaks on someone else's machine.
 */
import { deflateSync } from "node:zlib";

/* --------------------------------------------------------------- encoding */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA

  // One filter byte per scanline; filter 0 (none) compresses fine at these sizes.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- rasterising */

/**
 * Renders by asking `shade(x, y)` for a colour at a point, `samples` times per
 * pixel per axis. Slow and completely uninteresting, which is the right trade
 * for images generated once that are at most 1400px wide.
 *
 * `shade` returns [r, g, b, a] with a in 0..255, or null for nothing at all.
 */
export function raster(width, height, shade, samples = 4) {
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Accumulate premultiplied, or transparent edges bleed black.
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const colour = shade(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples);
          if (!colour) continue;
          const alpha = colour[3];
          r += colour[0] * alpha;
          g += colour[1] * alpha;
          b += colour[2] * alpha;
          a += alpha;
        }
      }

      const total = samples * samples;
      const i = (y * width + x) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
      }
      pixels[i + 3] = Math.round(a / total);
    }
  }
  return pixels;
}

/* ---------------------------------------------------------------- geometry */

export function insideRoundedRect(x, y, left, top, width, height, radius) {
  if (x < left || y < top || x > left + width || y > top + height) return false;
  const cx = Math.min(Math.max(x, left + radius), left + width - radius);
  const cy = Math.min(Math.max(y, top + radius), top + height - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

export function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function mix(from, to, t) {
  const e = t * t * (3 - 2 * t); // ease, so a long ramp has no flat band
  return [
    Math.round(from[0] + (to[0] - from[0]) * e),
    Math.round(from[1] + (to[1] - from[1]) * e),
    Math.round(from[2] + (to[2] - from[2]) * e),
  ];
}
