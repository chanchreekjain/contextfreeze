/**
 * Zips dist/ into a file you can hand to someone, attach to a release, or
 * upload to the Chrome Web Store.
 *
 *   npm run package
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const out = join(root, "release");

if (!existsSync(dist)) {
  console.error("dist/ is missing - run `npm run build` first.");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
mkdirSync(out, { recursive: true });

const zip = join(out, `contextfreeze-${version}.zip`);
rmSync(zip, { force: true });

// -r recurse, -q quiet, -X drop the extra filesystem attributes the Web Store
// does not want. Paths are relative to dist/ so the zip has no wrapper folder,
// which is what Chrome expects.
execFileSync("zip", ["-rqX", zip, "."], { cwd: dist, stdio: "inherit" });
console.log(`release/contextfreeze-${version}.zip`);
