/**
 * The diagnostic exists because three fixes in a row were made by reasoning
 * about what a site probably does, and all three were wrong. So the two things
 * worth testing are that it tells the truth about what it can see, and that it
 * is safe to paste into a chat window.
 */
import { launch, readProbe, reporter, serve } from "./harness.mjs";

const { url, close } = await serve(8738);
const { check, finish } = reporter();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(readProbe());
await page.goto(url);
await page.waitForTimeout(2400);

const SECRET = "hunter2-should-never-appear";
const DRAFT = "Half-written reply that was never posted";

await page.evaluate(([secret, draft]) => {
  document.getElementById("secret").value = secret;
  document.getElementById("notes").value = draft;
  const root = document.getElementById("composer").shadowRoot;
  root.getElementById("body").innerHTML = draft + " from a web component";

  // A custom element that keeps its root closed - the case nothing can reach.
  class SealedBox extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: "closed" }).innerHTML = "<textarea>invisible</textarea>";
    }
  }
  customElements.define("sealed-box", SealedBox);
  document.body.appendChild(document.createElement("sealed-box"));
}, [SECRET, DRAFT]);
await page.waitForTimeout(100);

const report = await page.evaluate(() => window.__cf.diagnose());

console.log("\n== it is safe to paste ==");
check("no password value appears anywhere in it", !report.includes(SECRET));
check("no draft text appears anywhere in it", !report.includes(DRAFT));
check("it says so explicitly", report.includes("lengths only"));

console.log("\n== it tells the truth about the page ==");
check("it counts the open shadow roots", /open shadow roots: [1-9]/.test(report),
  (report.match(/open shadow roots: \d+/) || [])[0]);
check("it lists an element whose root it cannot reach",
  report.includes("sealed-box"),
  (report.match(/.*sealed-box.*/) || [])[0]?.trim());
check("...without claiming that proves a closed root",
  report.includes("indistinguishable") && !report.includes("likely closed roots"),
  "no shadow DOM at all looks identical to a closed root from out here");
check("it lists a field living inside a shadow root",
  /\[shadow depth \d\]/.test(report),
  (report.match(/\[shadow depth \d\][^\n]*/) || [])[0]);
check("it shows the path, including the shadow hop",
  report.includes(" >>> "),
  (report.match(/[^\n]* >>> [^\n]*/) || [])[0]?.trim().slice(0, 70));

console.log("\n== it explains what it skipped ==");
check("the password is listed as skipped by design",
  /input\[type=password\].*by design/.test(report),
  (report.match(/.*type=password.*/) || [])[0]?.trim());
check("it counts what capture actually recorded",
  /fields: \d+/.test(report), (report.match(/fields: \d+[^\n]*/) || [])[0]);

console.log("\n== unrestored text is handed back, not dropped ==");
const ctx = await page.evaluate(() => window.__cf.capturePage());
await page.reload();
// Remove the composer entirely: its field can never be resolved on this load.
await page.evaluate(() => document.getElementById("composer").remove());
const restoreReport = await page.evaluate((c) => window.__cf.restorePage(c), ctx);

check("the vanished field's text comes back in the report",
  restoreReport.unrestored.some((f) => f.value.includes("web component")),
  restoreReport.unrestored.map((f) => `${f.label}:${f.value.length}`).join(", "));
check("fields that DID restore are not listed as lost",
  !restoreReport.unrestored.some((f) => f.label === "notes"),
  restoreReport.unrestored.map((f) => f.label).join(", "));

await browser.close();
close();
finish();
