import { chromium } from "playwright";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "fixtures");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wav": "audio/wav" };

export async function serve(port) {
  const server = createServer((req, res) => {
    const rel = (req.url || "/").split("?")[0].replace(/^\/+/, "") || "page.html";
    const path = join(FIXTURES, rel);
    if (!existsSync(path)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(port, r));
  return { url: `http://127.0.0.1:${port}/page.html`, close: () => server.close() };
}

/** CF_CHROME lets CI or a sandbox point at an already-downloaded Chromium. */
export function launch() {
  return chromium.launch(process.env.CF_CHROME ? { executablePath: process.env.CF_CHROME } : {});
}

export function readProbe() {
  return readFileSync(join(FIXTURES, "probe.js"), "utf8");
}

export function reporter() {
  const results = [];
  return {
    check(name, pass, detail) {
      results.push({ name, pass });
      console.log(`${pass ? "  PASS" : "  FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
    },
    finish() {
      const failed = results.filter((r) => !r.pass);
      console.log(`\n${results.length - failed.length}/${results.length} passed`);
      if (failed.length) {
        console.log("FAILED: " + failed.map((f) => f.name).join(" | "));
        process.exitCode = 1;
      }
    },
  };
}
