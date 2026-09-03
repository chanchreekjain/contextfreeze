/**
 * The Gmail failure, reproduced end to end.
 *
 * Two separate things were breaking it:
 *   1. Clicking the extension icon takes focus off the page, and inside a
 *      contenteditable that collapses the selection - so capture found nothing
 *      to save in the first place.
 *   2. Even when restored, the app focuses its compose box on load and slams
 *      the caret to the end, wiping the selection before you see it.
 */
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8734);
const probe = readProbe();
const { check, finish } = reporter();
const browser = await launch();

const PHRASE = "quarterly numbers look wrong";

const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(probe);
await page.goto(url);
await page.waitForTimeout(3000); // editor filled, app has finished meddling

// The user selects a phrase inside the compose box.
await page.evaluate((phrase) => {
  const editor = document.getElementById("editor");
  const node = editor.firstChild;
  const start = node.data.indexOf(phrase);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + phrase.length);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}, PHRASE);

const liveSelection = await page.evaluate(() => String(getSelection()));
check("the user's selection is live before the popup opens",
  liveSelection.includes(PHRASE), JSON.stringify(liveSelection.slice(0, 40)));

// Clicking the extension icon: focus leaves the page and the editor collapses.
await page.evaluate(() => {
  document.getElementById("editor").blur();
  getSelection().removeAllRanges();
});
const collapsed = await page.evaluate(() => String(getSelection()));
check("...and is gone by the time capture would have run",
  collapsed === "", JSON.stringify(collapsed));

const ctx = await page.evaluate(() => window.__cf.capturePage());
check("captured anyway, from the tracked last selection",
  Boolean(ctx.selection?.text.includes(PHRASE)),
  JSON.stringify(ctx.selection?.text.slice(0, 40) ?? null));
check("recorded as an editable selection",
  ctx.selection?.editable === true, String(ctx.selection?.editable));

console.log("\n== reload, restore while the app meddles ==");
await page.reload();
// Restore starts before the editor even has its text (arrives at 1200ms), and
// the app then focuses and collapses at 1600ms and 2400ms.
const report = await page.evaluate((c) => window.__cf.restorePage(c), ctx);
await page.waitForTimeout(3000);

const after = await page.evaluate(() => ({
  selection: String(getSelection()),
  focused: document.activeElement?.id ?? null,
}));

check("selection survived the app focusing and collapsing twice",
  after.selection.includes(PHRASE), JSON.stringify(after.selection.slice(0, 40)));
check("the editor is focused, ready to keep typing",
  after.focused === "editor", String(after.focused));
check("report counts the highlight as restored",
  report.selection[0] === 1, JSON.stringify(report.selection));

await browser.close();
close();
finish();
