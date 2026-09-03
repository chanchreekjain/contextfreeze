/**
 * Renders the ContextFreeze icon at every size Chrome asks for.
 *
 * Deliberately dependency-free: a build that needs ImageMagick or a headless
 * browser to produce a 16px PNG is a build that breaks on someone else's
 * machine. Node's zlib is the only thing here that is not arithmetic.
 *
 *   node tools/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const SIZES = [16, 32, 48, 128];
/** Rendered at 4x and box-filtered down; cheaper to write than real anti-aliasing. */
const SUPERSAMPLE = 4;

/* ------------------------------------------------------------------ design */

const CORNER_RADIUS = 0.22;
/** Diagonal, indigo into azure. */
const GRADIENT_FROM = [0x2b, 0x2f, 0xd6];
const GRADIENT_TO = [0x35, 0xb8, 0xff];

/**
 * A bookmark with a sheared top - a shard of one. Unit square, y downwards.
 *
 * Five points on purpose. At 16px the silhouette is the only thing that
 * survives, so it has to carry the whole identity: the deep notch says
 * bookmark, and the slanted top edge keeps it from being every other bookmark
 * icon ever drawn. An earlier version had a pointed top and read as an up arrow.
 */
const MARK = [
  [0.30, 0.21],
  [0.70, 0.12],
  [0.70, 0.86],
  [0.50, 0.65],
  [0.30, 0.86],
];

/* ------------------------------------------------------------------ render */

function insideRoundedRect(x, y, radius) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function gradientAt(x, y) {
  // Diagonal ramp, eased so the middle does not read as a flat band.
  const raw = (x + y) / 2;
  const t = raw * raw * (3 - 2 * raw);
  return [
    Math.round(GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * t),
    Math.round(GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * t),
    Math.round(GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * t),
  ];
}

function render(size) {
  const big = size * SUPERSAMPLE;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Accumulate premultiplied, or the transparent outside bleeds black into
      // the rounded corners.
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const u = (x * SUPERSAMPLE + sx + 0.5) / big;
          const v = (y * SUPERSAMPLE + sy + 0.5) / big;
          if (!insideRoundedRect(u, v, CORNER_RADIUS)) continue;

          const [cr, cg, cb] = insidePolygon(u, v, MARK) ? [255, 255, 255] : gradientAt(u, v);
          r += cr; g += cg; b += cb; a += 255;
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = a / samples;
      const i = (y * size + x) * 4;
      if (alpha > 0) {
        // Back out of premultiplication so the PNG stores straight alpha.
        pixels[i] = Math.round(r / (a / 255));
        pixels[i + 1] = Math.round(g / (a / 255));
        pixels[i + 2] = Math.round(b / (a / 255));
      }
      pixels[i + 3] = Math.round(alpha);
    }
  }
  return pixels;
}

/* --------------------------------------------------------------- png writer */

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

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10..12 are compression, filter and interlace methods - all zero.

  // One filter byte per scanline. Filter 0 (none) compresses fine at these sizes.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const from = y * size * 4;
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, from, from + size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------- main */

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(OUT, `icon${size}.png`), encodePng(size, render(size)));
  console.log(`icon${size}.png`);
}

// The same mark, as vector, for the popup header.
writeFileSync(
  join(OUT, "mark.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b2fd6"/>
      <stop offset="1" stop-color="#35b8ff"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <path d="${MARK.map(([x, y], i) => `${i ? "L" : "M"}${(x * 100).toFixed(1)} ${(y * 100).toFixed(1)}`).join(" ")}Z" fill="#fff"/>
</svg>
`,
);
console.log("mark.svg");
