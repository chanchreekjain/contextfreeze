# ContextFreeze

Save and restore your **deep-work browser context** — not just the URLs.

Tab managers hand you back a list of links. ContextFreeze hands you back the
place you were standing: how far down each page you had read, the half-written
comment in the textarea, the second the tutorial video was paused at, and the
sentence you had highlighted in the docs.

---

## How it actually works

ContextFreeze does **not** serialise the DOM.

Saving a page's HTML and pasting it back gives you a corpse: event listeners
are not serialisable, and React/Vue re-mount on load and overwrite whatever you
injected. You get something that looks right and does nothing.

So instead ContextFreeze reloads the real page and re-applies a small
**context layer** — a few kilobytes of JSON describing where you were inside it:

| Signal | How it is stored | Why not the obvious way |
|---|---|---|
| Page scroll | An **anchor element** near the top of the viewport, plus its offset | A raw `scrollY` lands you in the wrong place the moment lazy images, infinite scroll or a reflow change what lives at that pixel |
| Nested scrollers | Same anchor trick, per container, up to 12 | Docs sidebars and chat panes are usually the context you actually lose |
| Form fields | Value + the element's `id`/`name`/structural path | — |
| Video / audio | `currentTime` and `playbackRate` | — |
| Highlight | The selected text, re-found by walking text nodes | XPath breaks on a single inserted node |
| Tab groups, pinning | Title and colour, regrouped on restore | — |

The interesting engineering is in **restore timing**. `DOMContentLoaded` fires
long before a modern site has rendered the content an anchor points at, so
restore is a retry loop with backoff: it keeps re-attempting each outstanding
item for up to 15 seconds, refuses the raw-pixel scroll fallback for the first
3 seconds so the anchor gets a fair chance to win, and then runs four more
"settle" passes to correct for content that loaded *after* it scrolled.

If you touch the wheel, keyboard or mouse, it stops immediately. It will never
fight you for control of the page.

---

## What it will not do

Stated plainly, because the failure modes are inherent and not bugs:

- **SPA in-memory state** that is not in the URL or `localStorage` — a
  half-configured dashboard filter, an open modal. Unrecoverable by any extension.
- **Login sessions.** The tab reloads with whatever cookies you still have. If
  the session expired, you land on a login page.
- **DRM video** (Netflix, Prime). *Unverified — EME-protected playback is
  expected to reject programmatic seeks, but this has not been tested.*
- **`chrome://` pages, the Web Store, the built-in PDF viewer.** Chrome forbids
  content scripts there. Their URLs are recorded; their context is not.
- **Cross-origin iframes.** v0 runs in the top frame only, so an embedded
  YouTube player inside a blog post is not captured. `youtube.com/watch` itself is.
- **Pages that changed since capture.** Anchors miss and it falls back to the
  pixel offset, or gives up and leaves you at the top.
- **Rich text editors** (Notion, Google Docs). They keep their own document
  model; writing into their `contenteditable` will be overwritten.

## What it deliberately does not save

- **Passwords.** `input[type=password]` is never read. Storage is plaintext
  `chrome.storage.local`, so credentials must not enter it.
- Hidden, file, and button inputs.
- Any field still holding the page's own default value.

Everything stays on your machine. There is no server, no sync, no telemetry.

---

## Install (unpacked)

```bash
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `dist/` folder.

`Ctrl+Shift+F` freezes the current window without opening the popup.

> Tabs that were already open when you installed the extension get their content
> script injected once, on install. Tabs opened before *that* need one reload
> before they can be captured — the popup tells you how many were skipped.

### Building on Windows

If `node_modules` was installed from a Linux shell (WSL, a container, a remote
session), esbuild's platform binary will be the Linux one. Run `npm install`
once from Windows before `npm run build` there.

---

## Layout

```
src/
├── types.ts               the context layer, documented field by field
├── messages.ts            typed popup <-> worker <-> content protocol
├── storage.ts             freeze CRUD + the pending-restore handoff
├── background/index.ts    orchestration: freeze a window, reopen a freeze
├── content/
│   ├── index.ts           message handling + the restore handshake
│   ├── element-path.ts    find-this-element-again strategies
│   ├── capture.ts         reading the context layer off a live page
│   ├── restore.ts         the retry loop (the hard part)
│   └── text-range.ts      re-finding a highlight across text nodes
└── popup/index.ts         the UI
```

`npm run watch` rebuilds on change. `npm run typecheck` runs `tsc --noEmit`.

---

## Tests

```bash
npx playwright install chromium   # once
npm test
```

`capture.ts` and `restore.ts` touch nothing but the DOM, so they can be driven
in a plain page without installing the extension at all. The suite builds a
fixture that deliberately fights the restore: **1600px of content lazy-loads in
above the anchor after restore has already started**, so a pixel-offset restore
lands in the wrong place by design and only the anchor plus settle passes get it
right.

`test/roundtrip.test.mjs` — freeze a page with a scrolled article, a scrolled
sidebar, five form fields, a seeked audio element and a highlight spanning an
inline tag; reload; restore; assert every one of them came back, that the
password did not, and that the media did not auto-play.

`test/edge-cases.test.mjs` — the failure modes:

- a **textless banner** filling the top of the viewport, which used to produce a
  null anchor and a silent downgrade to pixel restore
- the **anchor element deleted** between freeze and restore, so its structural
  path now resolves to a *different* paragraph — the text guard has to reject
  the impostor rather than confidently scrolling to the wrong place
- the **user taking over** mid-restore, which must abort it promptly

Set `CF_CHROME` to an existing Chromium binary to skip Playwright's download.

---

## Roadmap

- [ ] Auto-freeze on window close, so you never lose a session you forgot to save
- [ ] `all_frames` capture for embedded players
- [ ] Restore into the current window instead of always opening a new one
- [ ] Export/import a freeze as JSON
- [ ] Fuzzy anchor matching, so a lightly-edited page still restores

## Licence

MIT
