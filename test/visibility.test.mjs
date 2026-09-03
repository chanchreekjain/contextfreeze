/**
 * A field only counts if you could have typed into it.
 *
 * Real pages keep hidden textareas for their own purposes - clipboard shims,
 * measurement mirrors, template stores. A Reddit post page carries one holding
 * 2340 characters that no human ever touched, and it was being swept into every
 * freeze and written back on restore.
 *
 * A field scrolled out of view is a different thing entirely and must survive.
 */
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8739);
const { check, finish } = reporter();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(readProbe());
await page.goto(url);
await page.waitForTimeout(2400);

// Something the user really did type, far down the page.
await page.evaluate(() => {
  const el = document.getElementById("notes");
  el.value = "a real comment, typed by a person";
});

const ctx = await page.evaluate(() => window.__cf.capturePage());
const captured = ctx.fields.map((f) => f.ref.id ?? f.ref.name ?? f.kind);

console.log("\n== the page's own scratch fields stay out ==");
for (const [id, why] of [
  ["scratch-none", "display:none"],
  ["scratch-offcanvas", "parked off-canvas"],
  ["scratch-aria", "inside aria-hidden"],
  ["scratch-zero", "zero-sized"],
]) {
  check(`${why} is not captured`, !captured.includes(id), captured.join(", "));
}

console.log("\n== what the user typed still is ==");
check("a real field is captured", captured.includes("notes"), captured.join(", "));
check("scrolled out of view is NOT the same as hidden",
  await page.evaluate(() => {
    window.scrollTo({ top: 20000, behavior: "instant" });
    const fields = window.__cf.capturePage().fields;
    return fields.some((f) => f.ref.id === "notes");
  }),
  "the field is far above the viewport but still perfectly real");

console.log("\n== and the diagnostic explains itself ==");
const report = await page.evaluate(() => window.__cf.diagnose());
check("hidden fields are listed but marked as not captured",
  report.includes("HIDDEN - not captured"),
  (report.match(/[^\n]*HIDDEN[^\n]*/) || [])[0]?.trim());
check("it no longer claims a rootless custom element means a closed root",
  !report.includes("likely closed roots"),
  "that was an inference printed as a finding");
check("it says why a hidden field was skipped",
  report.includes("the page's own scratch field"),
  (report.match(/[^\n]*scratch field[^\n]*/) || [])[0]?.trim());

await browser.close();
close();
finish();
