/**
 * The extension's toolbar icons, at every size Chrome asks for.
 *
 *   node tools/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CORNER_RADIUS, GRADIENT_FROM, GRADIENT_TO, MARK, PAPER, markPoints } from "./brand.mjs";
import { encodePng, insidePolygon, insideRoundedRect, mix, raster } from "./png.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const SIZES = [16, 32, 48, 128];

mkdirSync(OUT, { recursive: true });

for (const size of SIZES) {
  // Full bleed, unlike the store icon: a browser toolbar gives you no room to
  // waste, so every pixel goes to the mark.
  const pixels = raster(size, size, (x, y) => {
    if (!insideRoundedRect(x, y, 0, 0, size, size, size * CORNER_RADIUS)) return null;
    if (insidePolygon(x, y, markPoints(0, 0, size))) return [...PAPER, 255];
    return [...mix(GRADIENT_FROM, GRADIENT_TO, (x / size + y / size) / 2), 255];
  });
  writeFileSync(join(OUT, `icon${size}.png`), encodePng(size, size, pixels));
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
