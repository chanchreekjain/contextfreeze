/**
 * Naming a checkpoint as you drop it.
 *
 * The thing most worth proving is not the UI - it is that our own overlay stays
 * invisible to the capture layer. An input floating in the page would otherwise
 * be captured as a form field and restored into future sessions, and a visible
 * text node near the viewport edge could be chosen as a scroll anchor.
 */
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8736);
const { check, finish } = reporter();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(readProbe());
await page.goto(url);
await page.waitForTimeout(2400);

const inputsBefore = await page.evaluate(() => document.querySelectorAll("input").length);

await page.evaluate(() => {
  window.__name = window.__cf.askForName("Paragraph 160 - the quick brown fox", "position");
});
const namer = page.locator('[data-contextfreeze="namer"] input');
await namer.waitFor({ state: "visible", timeout: 3000 });

console.log("\n== the overlay stays out of the page ==");
check("it is not visible to document.querySelectorAll",
  (await page.evaluate(() => document.querySelectorAll("input").length)) === inputsBefore,
  `${inputsBefore} inputs before and after`);

const captured = await page.evaluate(() => window.__cf.capturePage());
check("a freeze taken while it is open does not capture it",
  !captured.fields.some((f) => f.value.includes("quick brown fox") && f.kind === "input"),
  captured.fields.map((f) => f.ref.id ?? f.kind).join(","));

check("it is prefilled with the default label, so naming is optional",
  (await namer.inputValue()).includes("Paragraph 160"), await namer.inputValue());

console.log("\n== typing a name ==");
await namer.fill("Section on failure modes");
await namer.press("Enter");
check("Enter resolves with the typed name",
  (await page.evaluate(() => window.__name)) === "Section on failure modes");
check("the overlay is removed afterwards",
  (await page.locator('[data-contextfreeze="namer"]').count()) === 0);

console.log("\n== keeping the default ==");
await page.evaluate(() => { window.__name2 = window.__cf.askForName("12:05", "media"); });
await namer.waitFor({ state: "visible", timeout: 3000 });
await namer.press("Escape");
check("Escape resolves null, leaving the default label alone",
  (await page.evaluate(() => window.__name2)) === null);

console.log("\n== it does not leak keys to the page ==");
await page.evaluate(() => {
  window.__pageSawKeys = 0;
  document.addEventListener("keydown", () => { window.__pageSawKeys++; });
  window.__name3 = window.__cf.askForName("x", "position");
});
await namer.waitFor({ state: "visible", timeout: 3000 });
await namer.press("Escape");
check("Escape inside the namer never reaches the page",
  (await page.evaluate(() => window.__pageSawKeys)) === 0,
  String(await page.evaluate(() => window.__pageSawKeys)));

await browser.close();
close();
finish();
