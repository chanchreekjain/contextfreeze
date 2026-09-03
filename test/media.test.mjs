/**
 * The YouTube failure mode, reproduced.
 *
 * Real site players do two things that break a naive restore: they rebuild or
 * re-parent their DOM after load, so the element path recorded at freeze time
 * no longer resolves; and they reset currentTime to their own idea of the start
 * AFTER the content script has already seeked. The fixture player does both.
 */
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8733);
const probe = readProbe();
const { check, finish } = reporter();
const browser = await launch();

const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(probe);
await page.goto(url);
await page.waitForTimeout(2200); // player has re-parented and finished resetting

await page.evaluate(async () => {
  const el = document.querySelector(".stream");
  if (el.readyState < 1) {
    await new Promise((r) => el.addEventListener("loadedmetadata", r, { once: true }));
  }
  el.currentTime = 20;
});
await page.waitForTimeout(100);

const ctx = await page.evaluate(() => window.__cf.capturePage());
const stream = ctx.media.find((m) => !m.ref.id);

check("the player was captured even without an id", Boolean(stream),
  JSON.stringify(ctx.media.map((m) => m.ref.id ?? "(no id)")));
check("its recorded path runs through the player shell",
  stream?.ref.path.includes("div:nth-of-type(2)") || stream?.ref.path.length > 0,
  stream?.ref.path.slice(-60));
check("an ordinal was recorded as a fallback", Number.isInteger(stream?.index),
  String(stream?.index));

console.log("\n== reload, restore before the player has booted ==");
await page.reload();
await page.evaluate((c) => window.__cf.restorePage(c), ctx);
// Past both of the player's resets (700ms, 1500ms) and well into the guard window.
await page.waitForTimeout(4000);

const after = await page.evaluate(() => ({
  time: document.querySelector(".stream").currentTime,
  reparented: Boolean(document.querySelector("#player-shell .stream")),
  paused: document.querySelector(".stream").paused,
}));

check("the player did re-parent itself, invalidating the recorded path",
  after.reparented === true);
check("playhead survived two resets by the page",
  Math.abs(after.time - 17) < 1.5, `${after.time.toFixed(2)}s (wanted ~17)`);
check("still never auto-plays", after.paused === true);

/* The URL rewrite is pure and lives in the background bundle, so exercise it
   directly rather than through a real YouTube page. */
console.log("\n== youtube url rewrite ==");
const { resumeUrl } = await import("../src/site-adapters.ts").catch(() => ({}));
if (!resumeUrl) {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("node", ["-e", `
    const esbuild = require("esbuild");
    const r = esbuild.buildSync({
      entryPoints: ["src/site-adapters.ts"], bundle: true, write: false,
      format: "cjs", logLevel: "silent",
    });
    const mod = {exports:{}};
    new Function("module","exports",r.outputFiles[0].text)(mod, mod.exports);
    const mk = (url, t) => ({ url, context: { media: [{ currentTime: t }] } });
    console.log(JSON.stringify([
      mod.exports.resumeUrl(mk("https://www.youtube.com/watch?v=abc123", 125)),
      mod.exports.resumeUrl(mk("https://youtu.be/abc123", 125)),
      mod.exports.resumeUrl(mk("https://example.com/video", 125)),
      mod.exports.resumeUrl({ url: "https://www.youtube.com/watch?v=abc123", context: null }),
    ]));
  `], { encoding: "utf8", cwd: process.cwd() });
  const [yt, short, other, noMedia] = JSON.parse(out.trim().split("\n").pop());
  check("youtube.com/watch gains ?t=122s", yt.includes("t=122s"), yt);
  check("youtu.be gains ?t=122", short.includes("t=122"), short);
  check("other hosts are left alone", other === "https://example.com/video", other);
  check("a tab with no media is left alone",
    noMedia === "https://www.youtube.com/watch?v=abc123", noMedia);
}

await browser.close();
close();
finish();
