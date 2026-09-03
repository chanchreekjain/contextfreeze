/**
 * Fits any PNG onto an exact store screenshot canvas.
 *
 *   npm run screenshot -- shot.png                 -> 1280x800
 *   npm run screenshot -- a.png b.png c.png        -> all of them
 *   npm run screenshot -- shot.png 640 480         -> any size
 *
 * Use forward slashes in paths. Git Bash treats a backslash as an escape
 * character, so C:\Users\CJ\shot.png arrives here as C:UsersCJshot.png.
 *
 * Stores reject screenshots that are not exactly the advertised size, and
 * getting a window to be precisely 1280x800 by dragging its edge is a miserable
 * way to spend an evening. Capture whatever you like, then run this: it scales
 * the image down if it is too big, centres it, and fills the rest with a colour
 * sampled from the image's own corner so the padding does not look bolted on.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { inflateSync } from "node:zlib";
import { encodePng } from "./png.mjs";

/* ----------------------------------------------------------------- decode */

function readChunks(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG file");
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Returns { width, height, pixels } as straight RGBA. */
function decodePng(buffer) {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("PNG has no header");

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8];
  const colourType = ihdr.data[9];
  const interlace = ihdr.data[12];

  // Deliberately narrow: this only has to read screenshots, and a half-working
  // decoder that guesses at formats it does not support is worse than one that
  // says so.
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth} (only 8 is handled)`);
  if (interlace !== 0) throw new Error("interlaced PNGs are not handled");
  if (colourType !== 2 && colourType !== 6) {
    throw new Error(`unsupported colour type ${colourType} (only RGB and RGBA are handled)`);
  }

  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)),
  );

  const out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) line[i] = (line[i] + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`unknown row filter ${filter}`);
    }

    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = line[from];
      out[to + 1] = line[from + 1];
      out[to + 2] = line[from + 2];
      out[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    previous = line;
  }

  return { width, height, pixels: out };
}

/* ------------------------------------------------------------------- fit */

function sample(image, x, y) {
  const cx = Math.min(Math.max(Math.round(x), 0), image.width - 1);
  const cy = Math.min(Math.max(Math.round(y), 0), image.height - 1);
  const i = (cy * image.width + cx) * 4;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2], image.pixels[i + 3]];
}

/** Bilinear, so a downscaled screenshot does not come out crunchy. */
function bilinear(image, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0, 0];
  const corners = [
    [sample(image, x0, y0), (1 - fx) * (1 - fy)],
    [sample(image, x0 + 1, y0), fx * (1 - fy)],
    [sample(image, x0, y0 + 1), (1 - fx) * fy],
    [sample(image, x0 + 1, y0 + 1), fx * fy],
  ];
  for (const [colour, weight] of corners) {
    for (let c = 0; c < 4; c++) out[c] += colour[c] * weight;
  }
  return out.map(Math.round);
}

function fit(input, target) {
  const image = decodePng(readFileSync(input));

  // Never scale up - enlarging a screenshot just makes it soft and obviously
  // stretched. Small captures get centred on the canvas instead.
  const scale = Math.min(target.width / image.width, target.height / image.height, 1);
  const drawWidth = Math.round(image.width * scale);
  const drawHeight = Math.round(image.height * scale);
  const offsetX = Math.round((target.width - drawWidth) / 2);
  const offsetY = Math.round((target.height - drawHeight) / 2);

  // Backdrop from the image's own top-left pixel, so padding reads as part of
  // the shot rather than a grey border someone forgot to crop.
  const backdrop = sample(image, 0, 0);

  const canvas = Buffer.alloc(target.width * target.height * 4);
  for (let y = 0; y < target.height; y++) {
    for (let x = 0; x < target.width; x++) {
      const i = (y * target.width + x) * 4;
      const inside =
        x >= offsetX && x < offsetX + drawWidth && y >= offsetY && y < offsetY + drawHeight;
      const colour = inside
        ? bilinear(image, (x - offsetX) / scale, (y - offsetY) / scale)
        : backdrop;

      canvas[i] = colour[0];
      canvas[i + 1] = colour[1];
      canvas[i + 2] = colour[2];
      canvas[i + 3] = 255; // store screenshots are opaque
    }
  }

  const out = join(
    dirname(input),
    `${basename(input, extname(input))}-${target.width}x${target.height}.png`,
  );
  writeFileSync(out, encodePng(target.width, target.height, canvas));
  console.log(`${out}  (source ${image.width}x${image.height}, scaled ${Math.round(scale * 100)}%)`);
}

/* -------------------------------------------------------------------- cli */

const args = process.argv.slice(2);
const sizes = args.filter((a) => /^\d+$/.test(a)).map(Number);
const inputs = args.filter((a) => !/^\d+$/.test(a));

if (!inputs.length) {
  console.error("usage: npm run screenshot -- <file.png> [more.png ...] [width height]");
  console.error("       paths use forward slashes:  ~/Pictures/Screenshots/shot1.png");
  process.exit(1);
}

const target = { width: sizes[0] ?? 1280, height: sizes[1] ?? 800 };

for (const input of inputs) {
  if (!existsSync(input)) {
    console.error(`Cannot find: ${input}`);
    // A Windows path with no separator left in it means the shell ate the
    // backslashes on the way here, which is easy to miss and baffling to debug.
    if (/^[A-Za-z]:[^\\/]/.test(input)) {
      console.error("");
      console.error("That path lost its backslashes - Git Bash treats \\ as an escape character.");
      console.error("Use forward slashes instead:");
      console.error("  npm run screenshot -- ~/Pictures/Screenshots/shot1.png");
    }
    process.exitCode = 1;
    continue;
  }

  try {
    fit(input, target);
  } catch (error) {
    console.error(`${input}: ${error.message}`);
    process.exitCode = 1;
  }
}
