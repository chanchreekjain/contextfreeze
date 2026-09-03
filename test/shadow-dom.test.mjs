/**
 * Reddit's comment composer is a web component. Its editor lives inside an open
 * shadow root, and `document.querySelectorAll` does not cross that boundary -
 * so an unposted draft comment was never captured at all. Nothing to restore,
 * no error, no clue.
 *
 * The highlight on the same page worked, because the post body is ordinary
 * light DOM. That asymmetry is exactly what this covers.
 */
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8737);
const { check, finish } = reporter();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(readProbe());
await page.goto(url);
await page.waitForTimeout(2400);

console.log("\n== the boundary itself ==");
check("the composer is invisible to a plain document query",
  await page.evaluate(() => document.querySelectorAll("#subject").length) === 0,
  "document.querySelectorAll('#subject') finds nothing");

// Type a draft into the shadow-DOM composer.
await page.evaluate(() => {
  const root = document.getElementById("composer").shadowRoot;
  root.getElementById("subject").value = "Why tab managers lose your place";
  root.getElementById("body").innerHTML = "Half-written reply that was never posted.";
});

const ctx = await page.evaluate(() => window.__cf.capturePage());

console.log("\n== capture ==");
const subject = ctx.fields.find((f) => f.value.includes("Why tab managers"));
const body = ctx.fields.find((f) => f.value.includes("Half-written reply"));

check("the shadow input is captured", Boolean(subject),
  ctx.fields.map((f) => f.ref.path.split(" >>> ").length > 1 ? "shadow" : "light").join(","));
check("the shadow contenteditable is captured", Boolean(body), body?.kind ?? "missing");
check("its path records the hop into the shadow root",
  subject?.ref.path.includes(" >>> "), subject?.ref.path);
check("a shadow-scoped id is NOT stored as a document-wide shortcut",
  subject?.ref.id === undefined,
  "ids repeat across component instances, so #subject would be ambiguous");

console.log("\n== reload and restore ==");
await page.reload();
await page.evaluate((c) => window.__cf.restorePage(c), ctx);
await page.waitForTimeout(2500);

const after = await page.evaluate(() => {
  const root = document.getElementById("composer").shadowRoot;
  return {
    subject: root.getElementById("subject").value,
    body: root.getElementById("body").innerHTML,
  };
});

check("the shadow input comes back",
  after.subject === "Why tab managers lose your place", JSON.stringify(after.subject));
check("the draft comment comes back",
  after.body.includes("Half-written reply"), JSON.stringify(after.body));

console.log("\n== highlights inside a shadow tree ==");
await page.evaluate(() => {
  const quote = document.getElementById("composer").shadowRoot.getElementById("quote");
  const range = document.createRange();
  range.setStart(quote.firstChild, 7);
  range.setEnd(quote.firstChild, 24);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
const withSelection = await page.evaluate(() => window.__cf.capturePage());
check("a selection made inside a shadow tree is captured",
  Boolean(withSelection.selection?.text),
  JSON.stringify(withSelection.selection?.text ?? null));

await page.reload();
await page.evaluate((c) => window.__cf.restorePage(c), withSelection);
await page.waitForTimeout(2500);

check("and painted back inside that same tree",
  await page.evaluate(() => {
    const mark = CSS.highlights?.get("contextfreeze");
    return mark ? Array.from(mark).map((r) => r.toString()).join("") : "";
  }) !== "",
  "the ::highlight rule has to be injected into the shadow root too");

await browser.close();
close();
finish();
