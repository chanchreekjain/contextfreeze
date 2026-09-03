/**
 * Store artwork, for Chrome Web Store or Microsoft Edge Add-ons - both want the
 * same shapes.
 *
 *   node tools/make-store-assets.mjs
 *
 * Screenshots have to be real captures of the thing working, so those are yours
 * to take. Everything else is generated here.
 *
 * The tiles say what the product does rather than just showing the logo: a
 * stack of text lines with one of them marked, and the bookmark sitting on the
 * marked line. That is literally the feature.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORNER_RADIUS, GRADIENT_FROM, GRADIENT_TO, INK, MUTED, PAPER, markPoints,
} from "./brand.mjs";
import { encodePng, insidePolygon, insideRoundedRect, mix, raster } from "./png.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "store");
mkdirSync(OUT, { recursive: true });

const write = (name, width, height, shade, samples = 4) => {
  writeFileSync(join(OUT, name), encodePng(width, height, raster(width, height, shade, samples)));
  console.log(`store/${name}  ${width}x${height}`);
};

/* ------------------------------------------------------------- store icon */
/**
 * 128x128 with the artwork inset to about 96x96, leaving transparent padding -
 * that is what a store grid expects, and it is NOT what the toolbar icon does.
 */
{
  const SIZE = 128;
  const INSET = 16;
  const box = SIZE - INSET * 2;

  write("icon-store-128.png", SIZE, SIZE, (x, y) => {
    if (!insideRoundedRect(x, y, INSET, INSET, box, box, box * CORNER_RADIUS)) return null;
    if (insidePolygon(x, y, markPoints(INSET, INSET, box))) return [...PAPER, 255];
    const t = ((x - INSET) / box + (y - INSET) / box) / 2;
    return [...mix(GRADIENT_FROM, GRADIENT_TO, t), 255];
  });
}

/* ------------------------------------------------------------- promo tiles */

/** Text lines, one of them marked, with the bookmark sitting on the marked one. */
function tile(width, height) {
  const pad = Math.round(height * 0.16);
  const lineHeight = Math.round(height * 0.055);
  const gap = Math.round(lineHeight * 1.35);
  const lines = 5;
  const marked = 2;
  // Ragged widths, the way a paragraph actually looks.
  const widths = [1, 0.86, 1, 0.72, 0.93];

  const blockTop = Math.round((height - (lines * lineHeight + (lines - 1) * (gap - lineHeight))) / 2);
  const left = pad;
  const right = width - pad;

  const markSize = Math.round(height * 0.42);
  const markLeft = right - markSize * 0.72;
  const markTop = blockTop + marked * gap + lineHeight / 2 - markSize * 0.5;
  const markPts = markPoints(markLeft, markTop, markSize);

  return (x, y) => {
    let colour = [...INK, 255];

    for (let i = 0; i < lines; i++) {
      const top = blockTop + i * gap;
      const lineWidth = (right - left) * widths[i];
      if (!insideRoundedRect(x, y, left, top, lineWidth, lineHeight, lineHeight / 2)) continue;
      colour =
        i === marked
          ? [...mix(GRADIENT_FROM, GRADIENT_TO, (x - left) / lineWidth), 255]
          : [...MUTED, 255];
    }

    if (insidePolygon(x, y, markPts)) return [...PAPER, 255];
    return colour;
  };
}

write("promo-small-440x280.png", 440, 280, tile(440, 280));
write("promo-marquee-1400x560.png", 1400, 560, tile(1400, 560), 3);
