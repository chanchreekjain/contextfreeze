import * as esbuild from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "fixtures");
mkdirSync(out, { recursive: true });

/* ---------------------------------------------------------------- probe */
await esbuild.build({
  entryPoints: [join(here, "probe.ts")],
  outfile: join(out, "probe.js"),
  bundle: true,
  format: "iife",
  target: ["chrome116"],
  logLevel: "warning",
});

/* ------------------------------------------------------------ silent wav */
// 8 kHz, 8-bit unsigned mono, 30 s: small enough to serve, long enough to seek.
const rate = 8000;
const samples = rate * 30;
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + samples, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate, 28);
header.writeUInt16LE(1, 32);
header.writeUInt16LE(8, 34);
header.write("data", 36);
header.writeUInt32LE(samples, 40);
writeFileSync(join(out, "clip.wav"), Buffer.concat([header, Buffer.alloc(samples, 128)]));

/* ----------------------------------------------------------------- page */
const paragraphs = Array.from({ length: 240 }, (_, i) =>
  `<p id="p${i}" class="para">Paragraph ${i} &mdash; the quick brown fox jumps over lazy dog ` +
  `number ${i} while considering whether paragraph ${i} is distinguishable from ` +
  `paragraph ${i + 1}.</p>`).join("\n");

const sideLines = Array.from({ length: 120 }, (_, i) =>
  `<li id="s${i}">Sidebar entry ${i}</li>`).join("\n");

writeFileSync(join(out, "page.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ContextFreeze fixture</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; }
  header { padding: 20px; background: #eef; }
  .lazy-block { height: 400px; padding: 10px; border-bottom: 1px solid #ddd; }
  main { max-width: 700px; margin: 0 auto; padding: 0 20px; }
  .para { margin: 0 0 24px; }
  #side { height: 300px; overflow-y: auto; border: 1px solid #999; margin: 20px auto; max-width: 700px; }
  #side ul { margin: 0; padding: 0 0 0 24px; }
  #side li { height: 40px; }
  form { max-width: 700px; margin: 20px auto; display: grid; gap: 10px; }
  #rich { border: 1px solid #999; min-height: 60px; padding: 8px; }
</style>
</head>
<body>
<header><h1>ContextFreeze fixture</h1></header>

<!-- Content that arrives AFTER load, in two waves. This is precisely what makes
     a raw pixel scroll offset useless and the anchor necessary. -->
<div id="lazy-zone"></div>

<div id="side"><ul>
${sideLines}
</ul></div>

<form id="f">
  <input id="q" name="q" type="text" value="">
  <textarea id="notes" name="notes"></textarea>
  <select id="mode" name="mode">
    <option value="a" selected>Alpha</option>
    <option value="b">Beta</option>
    <option value="c">Gamma</option>
  </select>
  <label><input id="agree" name="agree" type="checkbox"> Agree</label>
  <input id="secret" name="secret" type="password" value="">
  <div id="rich" contenteditable="true"></div>
</form>

<!-- Stands in for a Gmail-style compose box: its content arrives after load,
     and the app then focuses it and slams the caret to the end - twice. -->
<div id="editor" contenteditable="true"></div>

<!-- Stands in for Reddit's comment composer: a web component whose editor lives
     inside an open shadow root, where document.querySelectorAll cannot see it. -->
<my-composer id="composer"></my-composer>

<audio id="clip" src="clip.wav" preload="metadata" controls></audio>

<!-- Stands in for a real site player: it has no id, it re-parents itself into a
     shell after load (so the DOM path recorded at freeze time stops resolving),
     and it resets the playhead to zero twice while initialising. -->
<div id="player-host">
  <audio class="stream" src="clip.wav" preload="metadata" controls></audio>
</div>

<main id="article">
${paragraphs}
</main>

<script>
  function injectLazy(count, tag) {
    const zone = document.getElementById('lazy-zone');
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'lazy-block';
      d.textContent = tag + ' lazy block ' + i;
      zone.appendChild(d);
    }
  }
  setTimeout(() => injectLazy(2, 'first-wave'), 800);
  setTimeout(() => injectLazy(2, 'second-wave'), 1600);

  // The site player boots: re-parent, then stomp on the playhead twice.
  setTimeout(() => {
    const el = document.querySelector('#player-host .stream');
    const shell = document.createElement('div');
    shell.id = 'player-shell';
    el.parentElement.appendChild(shell);
    shell.appendChild(el);
  }, 300);
  setTimeout(() => { document.querySelector('.stream').currentTime = 0; }, 700);
  setTimeout(() => { document.querySelector('.stream').currentTime = 0; }, 1500);

  // The compose box fills in late, then the app grabs focus and collapses the
  // caret to the end - exactly what wipes a restored selection in Gmail.
  setTimeout(() => {
    document.getElementById('editor').textContent =
      'Draft body: the quarterly numbers look wrong in section four, ' +
      'please double check them before we send this out.';
  }, 1200);
  function meddle() {
    const ed = document.getElementById('editor');
    if (!ed.textContent) return;
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  setTimeout(meddle, 1600);
  setTimeout(meddle, 2400);

  // A web component with an open shadow root, holding both a plain field and a
  // rich-text editor - the shape Reddit's composer takes.
  class MyComposer extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>.box{border:1px solid #999;padding:6px;min-height:40px}</style>' +
        '<input id="subject" name="subject" type="text">' +
        '<div id="body" class="box" contenteditable="true"></div>' +
        '<p id="quote">Nested shadow text about the failure modes of tab managers.</p>';
    }
  }
  customElements.define('my-composer', MyComposer);
</script>
</body>
</html>
`);

console.log("fixtures written to test/fixtures");
