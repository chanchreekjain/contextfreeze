/**
 * The core promise: freeze a page, reload it, and get the same place back -
 * even though 1600px of content lazy-loads in above the anchor AFTER restore
 * has already started.
 */
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8731);
const probe = readProbe();
const { check, finish } = reporter();

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(probe);

console.log("\n== capture ==");
await page.goto(url);
await page.waitForTimeout(2200); // let both lazy waves land

await page.fill("#q", "adaptive traffic signal");
await page.fill("#notes", "half written comment\nsecond line");
await page.fill("#secret", "hunter2");
await page.selectOption("#mode", "c");
await page.check("#agree");
await page.evaluate(() => { document.getElementById("rich").innerHTML = "<b>rich</b> text draft"; });
await page.evaluate(async () => {
  const clip = document.getElementById("clip");
  if (clip.readyState < 1) {
    await new Promise((r) => clip.addEventListener("loadedmetadata", r, { once: true }));
  }
  clip.currentTime = 12.5;
  clip.playbackRate = 1.5;
});
// A highlight that spans an inline tag boundary - the case a naive
// single-text-node search would miss.
await page.evaluate(() => {
  const p = document.getElementById("p118");
  p.innerHTML = 'Paragraph 118 &mdash; the quick <em>brown fox</em> jumps over the lazy dog.';
  const range = document.createRange();
  range.setStart(p.firstChild, 16);
  range.setEnd(p.lastChild, 12);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
// Scroll LAST: Playwright's fill/check/selectOption each scroll their target
// into view, so a scroll set earlier would be silently undone.
await page.evaluate(() => {
  document.getElementById("p120").scrollIntoView();
  document.getElementById("side").scrollTop = 1600;
});
await page.waitForTimeout(100);

const before = await page.evaluate(() => ({
  context: window.__cf.capturePage(),
  p120Top: document.getElementById("p120").getBoundingClientRect().top,
  sideTop: document.getElementById("side").scrollTop,
}));

console.log(`  ${before.context.scrolls.length} scrolls, ${before.context.fields.length} fields, ` +
  `${before.context.media.length} media, ${JSON.stringify(before.context).length} bytes`);

check("password never captured",
  !before.context.fields.some((f) => f.inputType === "password" || f.value === "hunter2"),
  before.context.fields.map((f) => f.ref.id ?? f.ref.name).join(","));
check("document scroll captured with an anchor",
  before.context.scrolls.some((s) => s.container === null && s.anchor !== null));
check("nested scroller captured",
  before.context.scrolls.some((s) => s.container !== null));
check("highlight captured across an inline tag",
  Boolean(before.context.selection?.text?.includes("brown fox")));

console.log("\n== reload + restore ==");
await page.reload();
// Restore IMMEDIATELY, before either lazy wave lands. This is the race the
// retry loop and the settle passes exist for.
const report = await page.evaluate((ctx) => window.__cf.restorePage(ctx), before.context);
console.log("  report:", JSON.stringify(report));
await page.waitForTimeout(2500);

const after = await page.evaluate(() => ({
  p120Top: document.getElementById("p120").getBoundingClientRect().top,
  sideTop: document.getElementById("side").scrollTop,
  q: document.getElementById("q").value,
  notes: document.getElementById("notes").value,
  mode: document.getElementById("mode").value,
  agree: document.getElementById("agree").checked,
  rich: document.getElementById("rich").innerHTML,
  secret: document.getElementById("secret").value,
  clipTime: document.getElementById("clip").currentTime,
  clipRate: document.getElementById("clip").playbackRate,
  clipPaused: document.getElementById("clip").paused,
  selection: String(window.getSelection()),
}));

console.log("\n== assertions ==");
check("landed on the same paragraph, not the same pixel",
  Math.abs(after.p120Top - before.p120Top) <= 8,
  `before ${before.p120Top.toFixed(1)}px, after ${after.p120Top.toFixed(1)}px`);
check("nested scroller restored",
  Math.abs(after.sideTop - before.sideTop) <= 8, `${before.sideTop} -> ${after.sideTop}`);
check("text input restored", after.q === "adaptive traffic signal", after.q);
check("textarea restored", after.notes === "half written comment\nsecond line");
check("select restored", after.mode === "c", after.mode);
check("checkbox restored", after.agree === true);
check("contenteditable restored", after.rich.includes("rich"), after.rich);
check("password NOT restored", after.secret === "", JSON.stringify(after.secret));
check("media timestamp restored", Math.abs(after.clipTime - 12.5) < 0.5, String(after.clipTime));
check("playback rate restored", after.clipRate === 1.5, String(after.clipRate));
check("media left paused - never auto-plays", after.clipPaused === true);
check("highlight re-found", after.selection.includes("brown fox"));

await browser.close();
close();
finish();
