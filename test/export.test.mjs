/**
 * Export and import. No browser needed - these are pure functions, so they are
 * bundled and called directly.
 */
import * as esbuild from "esbuild";
import { reporter } from "./harness.mjs";

const { check, finish } = reporter();

const built = await esbuild.build({
  entryPoints: ["src/export.ts"],
  bundle: true,
  write: false,
  format: "cjs",
  logLevel: "silent",
});
const module = { exports: {} };
new Function("module", "exports", built.outputFiles[0].text)(module, module.exports);
const { toBundle, toMarkdown, parseBundle } = module.exports;

const CHECKPOINTS = [
  {
    id: "a", key: "https://en.wikipedia.org/wiki/The_Trial",
    url: "https://en.wikipedia.org/wiki/The_Trial",
    title: "The Trial - Wikipedia", label: "Before the Law",
    kind: "position", auto: false, createdAt: Date.UTC(2026, 8, 3, 14, 30),
    scroll: { container: null, scrollTop: 4200, scrollLeft: 0, anchor: { path: "x" },
              anchorText: "Before the law stands a doorkeeper", anchorOffset: 0 },
  },
  {
    id: "b", key: "https://en.wikipedia.org/wiki/The_Trial",
    url: "https://en.wikipedia.org/wiki/The_Trial",
    title: "The Trial - Wikipedia", label: "Last position",
    kind: "position", auto: true, createdAt: Date.UTC(2026, 8, 3, 15, 0),
    scroll: { container: null, scrollTop: 9000, scrollLeft: 0, anchor: { path: "y" },
              anchorText: "the priest told him the parable", anchorOffset: 0 },
  },
  {
    id: "c", key: "youtube:abc123",
    url: "https://www.youtube.com/watch?v=abc123",
    title: "Kafka, explained", label: "12:05",
    kind: "media", auto: false, createdAt: Date.UTC(2026, 8, 3, 16, 0),
    media: { ref: { path: "v" }, tag: "video", index: 0, currentTime: 725.4,
             playbackRate: 1, wasPaused: true, duration: 3600 },
  },
];

console.log("\n== markdown ==");
const md = toMarkdown(CHECKPOINTS, new Date(Date.UTC(2026, 8, 3, 17, 0)));

check("it names both pages once each",
  (md.match(/^## /gm) || []).length === 2, String((md.match(/^## /gm) || []).length));
check("every page carries its plain URL",
  md.includes("https://en.wikipedia.org/wiki/The_Trial") &&
  md.includes("https://www.youtube.com/watch?v=abc123"));
check("a video flag exports as a link that jumps to the second",
  md.includes("watch?v=abc123&t=725s"),
  (md.match(/https:\/\/www\.youtube\.com\/watch\S*/g) || []).join(" "));
check("the quoted text you marked is carried across",
  md.includes('"Before the law stands a doorkeeper"'));
check("the self-updating entry says so",
  md.includes("(updates as you read)"));
check("line endings are CRLF, because the destination is Notepad",
  md.includes("\r\n") && !/[^\r]\n/.test(md));
check("no run of blank lines survives",
  !md.includes("\r\n\r\n\r\n"));

console.log("\n== json round trip ==");
const json = JSON.stringify(toBundle(CHECKPOINTS));
const parsed = parseBundle(json);
check("a bundle we wrote parses back", parsed.ok === true, parsed.ok ? "" : parsed.error);
check("with every checkpoint intact",
  parsed.ok && parsed.checkpoints.map((c) => c.id).join(",") === "a,b,c",
  parsed.ok ? parsed.checkpoints.map((c) => c.id).join(",") : "-");

console.log("\n== refusing junk ==");
check("plain text is refused", parseBundle("hello").ok === false);
check("someone else's JSON is refused",
  parseBundle('{"format":"other","checkpoints":[]}').ok === false);
check("a bundle with no usable entries is refused",
  parseBundle(JSON.stringify({ format: "contextfreeze-checkpoints", version: 1,
                               checkpoints: [{ id: 1 }] })).ok === false);
check("a partly-corrupt bundle keeps the good entries",
  (() => {
    const mixed = parseBundle(JSON.stringify({
      format: "contextfreeze-checkpoints", version: 1,
      checkpoints: [CHECKPOINTS[0], { nonsense: true }, CHECKPOINTS[2]],
    }));
    return mixed.ok && mixed.checkpoints.length === 2;
  })());

finish();
