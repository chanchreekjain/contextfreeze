/**
 * Checkpoints: named places inside one page, and flags at moments in a video.
 */
import { execFileSync } from "node:child_process";
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8735);
const probe = readProbe();
const { check, finish } = reporter();

/* --------------------------------------------------------------- pageKey --
   Flags on one video must share a key however the URL was written, or jumping
   to one flag would hide all the others. */
console.log("\n== page keys ==");
{
  const out = execFileSync("node", ["-e", `
    const esbuild = require("esbuild");
    const r = esbuild.buildSync({
      entryPoints: ["src/checkpoints.ts"], bundle: true, write: false,
      format: "cjs", logLevel: "silent", external: ["chrome"],
    });
    const mod = { exports: {} };
    new Function("module", "exports", r.outputFiles[0].text)(mod, mod.exports);
    console.log(JSON.stringify([
      mod.exports.pageKey("https://www.youtube.com/watch?v=abc123"),
      mod.exports.pageKey("https://www.youtube.com/watch?v=abc123&t=122s"),
      mod.exports.pageKey("https://youtu.be/abc123?t=90"),
      mod.exports.pageKey("https://en.wikipedia.org/wiki/Kafka?utm_source=x#History"),
      mod.exports.pageKey("https://en.wikipedia.org/wiki/Kafka"),
    ]));
  `], { encoding: "utf8", cwd: process.cwd() });
  const [plain, timed, short, tracked, clean] = JSON.parse(out.trim().split("\n").pop());

  check("a youtube video keys to its id", plain === "youtube:abc123", plain);
  check("...and ?t= does not create a second page", timed === plain, timed);
  check("...nor does the youtu.be short form", short === plain, short);
  check("tracking params and hashes are stripped", tracked === clean, `${tracked} vs ${clean}`);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(probe);
await page.goto(url);
await page.waitForTimeout(2400);

/* ------------------------------------------------------------- positions */
console.log("\n== marking a spot in an article ==");
await page.evaluate(() => document.getElementById("p160").scrollIntoView());
await page.waitForTimeout(100);

const spot = await page.evaluate(() => window.__cf.dropCheckpoint("position"));
check("a spot was captured", Boolean(spot), spot ? spot.kind : "null");
check("it is labelled with the text you were looking at",
  spot?.label.includes("Paragraph 160"), JSON.stringify(spot?.label));
check("it carries an anchor, not just a pixel offset",
  Boolean(spot?.scroll?.anchor), spot?.scroll?.anchor?.id ?? "null");

// Wander off, then jump back.
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(100);
await page.evaluate((c) => window.__cf.jumpTo({ ...c, id: "x", key: "k" }), spot);
await page.waitForTimeout(1600);

const landed = await page.evaluate(() => document.getElementById("p160").getBoundingClientRect().top);
check("jumping lands back on the marked paragraph", Math.abs(landed) <= 8, `${landed.toFixed(1)}px`);

check("marking near the top still records a checkpoint",
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    return Boolean(window.__cf.dropCheckpoint("position"));
  }),
  "a freeze would skip this, a deliberate mark must not");

/* ----------------------------------------------------------------- flags */
console.log("\n== flagging a moment in a video ==");
await page.evaluate(async () => {
  for (const el of document.querySelectorAll("audio")) {
    if (el.readyState < 1) {
      await new Promise((r) => el.addEventListener("loadedmetadata", r, { once: true }));
    }
  }
});
const flag = await page.evaluate(() => {
  const el = window.__cfPick = document.querySelectorAll("audio")[0];
  el.currentTime = 21.5;
  return window.__cf.dropCheckpoint("media");
});

check("a flag was captured", flag?.kind === "media", flag?.kind ?? "null");
check("it is labelled as a timestamp", /^\d+:\d\d$/.test(flag?.label ?? ""), flag?.label);

// Scrub away, then jump to the flag.
await page.evaluate(() => {
  for (const el of document.querySelectorAll("audio")) el.currentTime = 0;
});
await page.evaluate((c) => window.__cf.jumpTo({ ...c, id: "x", key: "k" }), flag);
await page.waitForTimeout(900);

const flagged = await page.evaluate((index) => {
  const list = document.querySelectorAll("audio");
  return list[index].currentTime;
}, flag.media.index);

check("jumping to a flag lands on the exact second, with no rewind",
  Math.abs(flagged - flag.media.currentTime) < 0.4,
  `${flagged.toFixed(2)}s vs marked ${flag.media.currentTime.toFixed(2)}s`);

await browser.close();
close();
finish();
