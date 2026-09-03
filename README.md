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
| Video / audio | `currentTime`, `playbackRate`, plus an ordinal | A player's DOM path is the least stable thing about it — YouTube rebuilds its player subtree on every load |
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

### Video is a special case

Restoring a timestamp by seeking the `<video>` element does not survive contact
with a real site player, for two reasons:

1. The player **rebuilds or re-parents its DOM** after load, so the element path
   recorded at freeze time no longer resolves. ContextFreeze therefore records an
   ordinal too, and falls back to "the only `<video>` on the page".
2. The player **resets `currentTime` after you have already seeked**, while it
   finishes initialising. A single seek silently snaps back to zero a second
   later. So the seek is *guarded*: for 12 seconds the element is watched, and if
   the playhead jumps backwards past a tolerance it is put back — bounded to 8
   corrections, and abandoned the moment you take over.

Better still, where a site has its own resume mechanism, use it rather than
fighting the player. `src/site-adapters.ts` rewrites the URL a restore opens:
a YouTube watch page comes back as `?t=122s`, which the player honours before it
even starts. The content-script seek stays as a backstop, and the two agree.

Resume rewinds by **3 seconds** (`RESUME_REWIND_SECONDS`), because coming back
mid-sentence is worse than a few seconds of overlap. Set it to 0 for exact resume.

### Highlights are painted, not selected

Restoring a native text selection loses every fight: the first click clears it,
and an SPA that calls `focus()` on load — Gmail opening a compose window, for
one — clears it before you ever see it. So the mark is painted with the CSS
Custom Highlight API instead. It is not a selection, so nothing clears it, and it
mutates no DOM, so no page's own code trips over it. It steps aside as soon as
you highlight something of your own.

---

## Checkpoints

A freeze captures a whole window. A **checkpoint** captures one named place
*inside* one page — and unlike a freeze, you can see it working.

- **Mark this spot** (`Ctrl+Shift+S`) drops a checkpoint where you are in an
  article, labelled with the text you were looking at, so the list reads like
  *"...the quick brown fox jumps over..."* rather than *"14,203px"*.
- **Flag this moment** (`Ctrl+Shift+Y`) drops a flag at the current second of a
  video or podcast, labelled `12:05`.
- Many per page. Click **Jump** in the popup to go straight there.
- **Name it as you drop it.** (Freezes too — see below.) A checkpoint always arrives with a sensible label
  already filled in, so naming stays optional: a keyboard-shortcut drop shows a
  small in-page prompt (Enter to save, Escape to keep the default, and it
  disappears on its own after 12s), and a drop from the popup goes straight into
  renaming it in the list.
- Jumping inside the page you are already on does **not** reload it. Only a tab
  that has navigated elsewhere gets navigated back, and the checkpoint is handed
  over through the same handshake a restore uses.
- A flag jumps to the **exact** second you marked. (The 3-second rewind applies
  to resuming a freeze, not to a mark you placed deliberately.)

Freezes work the same way: after **Freeze this window** the new row goes
straight into being renamed, and `Ctrl+Shift+F` shows the in-page prompt. A list
of timestamps is not something you can search through a week later.

### "Remember where I left off"

Once a page has at least one checkpoint of yours, it also keeps a self-updating
**Last position** entry, refreshed whenever you switch away from or close the
tab.

This is deliberately opt-in per page. Recording the scroll position of every
page you ever open would put a browsing history in extension storage, and that
is not a thing to switch on quietly. Mark one spot on an article and it starts
following it; do nothing and it records nothing.

### What counts as "the same page"

Flags on one video have to share a page, or jumping to one flag would hide all
the others. So `pageKey()` normalises: every YouTube URL for a video — `?t=`
variants and `youtu.be` short links included — keys to `youtube:<id>`, and
elsewhere tracking parameters and hashes are stripped.

### Getting them out again

Extension storage is only as durable as a Chrome profile. Anything worth keeping
for years has to be able to leave, so the popup footer has **Copy**,
**Save .md**, **Save .json** and **Import**.

The Markdown export is meant to be readable in Notepad in five years with no
software at all — grouped by page, with the plain URL, the text you had marked,
and CRLF line endings. Video flags export as ordinary timestamped links
(`watch?v=...&t=725s`), so they still work when this extension is long gone.

The JSON export is lossless and re-importable. Import **merges** rather than
replaces, so restoring a backup never deletes the checkpoints you have made
since — and it refuses a file it does not understand rather than importing junk.

---

## When it does not work: Diagnose

The popup footer has a **Diagnose** button. It reports what capture can actually
*see* on the page in front of it — how many open shadow roots, how many custom
elements expose no root (which means closed, and unreachable), how many iframes
and how many of those are cross-origin, every editable field it found with its
content length and full path, what capture recorded, and **what it skipped
despite having content, with the reason**.

It reports shapes, counts and lengths only. No field contents appear in it
anywhere, so it is safe to paste into a bug report.

This exists because three fixes in a row were made by reasoning about what a
site probably does, and all three were wrong. A page that will not restore
should be able to explain itself.

## Nothing captured is ever silently lost

If a field cannot be put back — the element is gone, the page never rebuilt it,
an editor overwrote it — the text is **not** discarded. It comes out in the
restore report, and the popup offers to hand it back so you can paste it
yourself. A half-written comment disappearing without a word is the worst thing
this extension could do, so it does not do it.

## Where it actually earns its keep

Worth being honest about: on some sites you will not notice it, because the site
or the browser already does the job.

- **Chrome restores scroll position itself** on reload and back/forward. On a
  plain article you often cannot tell ContextFreeze apart from doing nothing.
  Its scroll restore matters when the window was *closed* and reopened later,
  when the page is an infinite-scroll feed Chrome gets wrong, or when the thing
  you need back is a **nested** scroller Chrome ignores entirely.
- **Gmail, and any app with draft autosave, restores your text itself.**

The cases nothing else covers: long documentation with a scrolled sidebar,
search results and forum threads deep in a scroll, video players without resume,
dashboards and forms with no autosave, and — the one nothing else does at all —
**the sentence you had highlighted**.

## Web components and shadow DOM

Capture and restore cross **open shadow roots**. This is not a nicety: Reddit's
comment composer is a web component, so `document.querySelectorAll` could not
see it and an unposted draft comment was never captured at all — no error, no
clue, just nothing to restore. Meanwhile the highlight on the same page worked
fine, because a Reddit post body is ordinary light DOM. That asymmetry is what
gave it away.

Stored element paths use ` >>> ` to mark a hop into a shadow root, and ids and
`name` attributes found inside one are **not** recorded as document-wide
shortcuts — inside a shadow tree an id is scoped to that tree, and the same id
repeats across every instance of a component, so a document-wide lookup would
cheerfully hand back a different instance's field.

**Closed** shadow roots stay unreachable. Nothing can be done about those from a
content script.

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

## What counts as "your" text

A field is only captured if **you could have typed into it**. Pages keep hidden
fields for their own purposes — clipboard shims, measurement mirrors, template
stores — and a real Reddit post page carries a 2340-character textarea that no
human ever touched. Sweeping that into every freeze meant storing a page's
private scratch space and writing it back on restore.

So capture skips a field with no rendered box, `visibility: hidden`, zero
opacity, zero size, anything inside `aria-hidden`, or a box parked far
off-canvas. A field merely **scrolled out of view is still yours** and is kept —
that distinction is measured in document coordinates, not viewport ones.

## What it deliberately does not save

- **Passwords.** `input[type=password]` is never read. Storage is plaintext
  `chrome.storage.local`, so credentials must not enter it.
- Hidden, file, and button inputs.
- Any field still holding the page's own default value.

Everything stays on your machine. There is no server, no sync, no telemetry.

---

## Install

**From a release zip** — download it, unzip it, then in Chrome:
`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
the unzipped folder.

**From source:**

```bash
npm install
npm run build
```

Then load `dist/` the same way. `npm run package` produces
`release/contextfreeze-<version>.zip`, ready to hand to someone or upload.

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
├── checkpoints.ts         checkpoint storage and page keying
├── export.ts              markdown and JSON serialisation, and a strict parser
├── messages.ts            typed popup <-> worker <-> content protocol
├── storage.ts             freeze CRUD + the pending-restore handoff
├── site-adapters.ts       per-site resume URLs (YouTube's ?t=)
├── background/index.ts    orchestration: freeze a window, reopen a freeze
├── content/
│   ├── index.ts           message handling + the restore handshake
│   ├── element-path.ts    find-this-element-again strategies
│   ├── capture.ts         reading the context layer off a live page
│   ├── restore.ts         the retry loop (the hard part)
│   ├── checkpoint.ts      dropping and jumping to a single marked place
│   ├── dom.ts             traversal that crosses open shadow boundaries
│   ├── diagnose.ts        what capture can see on this page, and what it skipped
│   ├── namer.ts           the in-page "name this checkpoint" prompt
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

`test/media.test.mjs` — the YouTube failure mode reproduced: a player with no
id that re-parents itself after load *and* resets its playhead to zero twice
while initialising. Plus the URL rewrite, exercised directly.

`test/export.test.mjs` — the serialisers, including that a corrupt bundle keeps
its good entries and that junk is refused outright. Pure functions, no browser.

`test/shadow-dom.test.mjs` — the Reddit case: a web component whose editor is
inside an open shadow root, proving the draft is captured, restored, and that a
highlight made in there is painted back in the same tree.

`test/diagnose.test.mjs` — that the report tells the truth about closed roots
and shadow-nested fields, and that no field value ever leaks into it.

`test/visibility.test.mjs` — that a page's hidden scratch fields stay out and
that a field scrolled far out of view stays in.

`test/checkpoints.test.mjs` — marking a spot and jumping back to it, flagging a
moment and landing on the exact second, and the page-keying rules that keep a
video's flags together.

`test/namer.test.mjs` — the naming prompt, and the part that actually matters:
that our own overlay stays invisible to the capture layer, so an input floating
in the page is never captured as a form field or chosen as a scroll anchor.

`test/edge-cases.test.mjs` — the other failure modes:

- a **textless banner** filling the top of the viewport, which used to produce a
  null anchor and a silent downgrade to pixel restore
- the **anchor element deleted** between freeze and restore, so its structural
  path now resolves to a *different* paragraph — the text guard has to reject
  the impostor rather than confidently scrolling to the wrong place
- the **user taking over** mid-restore, which must abort it promptly

Set `CF_CHROME` to an existing Chromium binary to skip Playwright's download.

---

## Permissions, and why each one

| Permission | What it is for |
|---|---|
| `tabs` | reading each tab's URL and title when freezing a window |
| `tabGroups` | recording a group's name and colour, and putting it back |
| `storage` | freezes and checkpoints, on your machine only |
| `scripting` | injecting the content script once into tabs that were already open when you installed it |
| `downloads` | the `.md` and `.json` exports |
| `<all_urls>` | a bookmark is only useful if it works on the page you are actually reading |

There is no server, no sync and no telemetry. Nothing leaves your machine unless
you export it yourself.

## Roadmap

- [ ] Auto-freeze on window close, so you never lose a session you forgot to save
- [ ] Checkpoint markers drawn in the scrollbar and on the video timeline
- [ ] `all_frames` capture for embedded players
- [ ] Site adapters beyond YouTube (Vimeo, Coursera, podcast players)
- [ ] Report what ContextFreeze actually added over Chrome's own restore
- [ ] Restore into the current window instead of always opening a new one
- [ ] Export/import a freeze as JSON
- [ ] Fuzzy anchor matching, so a lightly-edited page still restores
- [ ] Site adapters for editors that are collapsed until clicked (Reddit's
      composer is the known case — its draft is captured, but there is nothing
      on the page to write it back into until you open it)

## Publishing

`STORE-LISTING.md` holds every field a store submission asks for — descriptions,
a single-purpose statement, a written justification for each permission, and the
data-use disclosures — so a submission is a paste rather than an improvisation.

`npm run store-assets` generates the required artwork into `store/`. Note that
the **store** icon is inset with transparent padding while the **toolbar** icon
is full bleed; a store grid gives you room to breathe and a browser toolbar does
not.

Screenshots have to be real captures, so those are yours to take.

`docs/privacy.html` is the privacy policy, ready to serve from GitHub Pages
(Settings → Pages → deploy from `main`, folder `/docs`).

## The icon

`npm run icons` regenerates every size from a five-point polygon — pure Node, no
ImageMagick, no headless browser, since a build that needs those to make a 16px
PNG is a build that breaks on someone else's machine. `tools/png.mjs` writes the
PNGs by hand: supersampled, premultiplied when downsampling so the rounded
corners do not fringe, and zlib for the IDAT chunk. `tools/brand.mjs` holds the
one definition of the mark, so the logo on a store tile is provably the same
shape as the one in the toolbar rather than a lookalike that drifted.

The mark is a bookmark with a sheared top. At 16px the silhouette is all that
survives, so it carries the whole identity: the deep notch says bookmark, the
slant keeps it from being every other bookmark icon ever drawn. An earlier
version had a pointed top and read as an up arrow.

## Licence

MIT
