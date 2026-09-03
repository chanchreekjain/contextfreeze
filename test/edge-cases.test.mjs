/**
 * The failure modes that matter: a viewport whose top has nothing anchorable in
 * it, and a page that changed underneath us between freeze and restore.
 */
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8732);
const probe = readProbe();
const { check, finish } = reporter();
const browser = await launch();

async function fresh() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.addInitScript(probe);
  await page.goto(url);
  await page.waitForTimeout(2200);
  return page;
}

console.log("\n== a textless banner at the top of the viewport ==");
{
  const page = await fresh();
  await page.evaluate(() => {
    const hero = document.createElement("div");
    hero.id = "hero";
    hero.style.cssText = "height:300px;background:#357;"; // no text at all
    const p150 = document.getElementById("p150");
    p150.parentElement.insertBefore(hero, p150);
    hero.scrollIntoView();
  });
  await page.waitForTimeout(100);

  const ctx = await page.evaluate(() => window.__cf.capturePage());
  const doc = ctx.scrolls.find((s) => s.container === null);
  check("still finds an anchor by probing further down the viewport",
    Boolean(doc?.anchor), doc?.anchor?.id ?? "null");
  check("the anchor it picked is below the banner",
    (doc?.anchorOffset ?? -1) > 250, String(Math.round(doc?.anchorOffset ?? -1)));
  await page.close();
}

console.log("\n== the anchor element is gone by restore time ==");
{
  const page = await fresh();
  await page.evaluate(() => document.getElementById("p120").scrollIntoView());
  await page.waitForTimeout(100);
  const ctx = await page.evaluate(() => window.__cf.capturePage());
  const capturedTop = ctx.scrolls.find((s) => s.container === null)?.scrollTop ?? 0;

  await page.reload();
  // Deleting p120 shifts every later paragraph up by one, so the recorded
  // structural path now points at p121. The text guard has to catch that.
  await page.evaluate(() => document.getElementById("p120").remove());

  const report = await page.evaluate((c) => window.__cf.restorePage(c), ctx);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    y: window.scrollY,
    impostor: document.querySelector(
      "html > body:nth-of-type(1) > main:nth-of-type(1) > p:nth-of-type(121)")?.id,
  }));

  check("the old structural path now resolves to a different paragraph",
    after.impostor === "p121", String(after.impostor));
  check("text guard rejected the impostor and fell back to the pixel offset",
    Math.abs(after.y - capturedTop) < 60, `captured ${capturedTop}, after ${after.y}`);
  check("report still accounts for the scroll", report.scrolls[0] >= 1,
    JSON.stringify(report.scrolls));
  await page.close();
}

console.log("\n== user interaction aborts the restore ==");
{
  const page = await fresh();
  await page.evaluate(() => document.getElementById("p200").scrollIntoView());
  await page.waitForTimeout(100);
  const ctx = await page.evaluate(() => window.__cf.capturePage());

  await page.reload();
  const pending = page.evaluate((c) => window.__cf.restorePage(c), ctx);
  await page.waitForTimeout(50);
  await page.mouse.wheel(0, 200); // the user takes over
  const report = await pending;

  check("restore returns promptly once the user touches the page",
    report.elapsedMs < 2000, `${report.elapsedMs}ms`);
  await page.close();
}

await browser.close();
close();
finish();
