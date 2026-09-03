# Store listing copy

Everything a store submission form asks for, written out so it can be pasted
rather than improvised at 1am. The same copy works for the Chrome Web Store and
for Microsoft Edge Add-ons.

---

## Name

```
ContextFreeze
```

## Short description (132 characters max)

```
Restores where you were in a page, not just which pages were open: scroll position, drafts, video timestamps, highlights.
```

_(120 characters.)_

## Category

Productivity → Workflow & Planning

## Detailed description

```
Tab managers hand you back a list of links. ContextFreeze hands you back the
place you were standing.

Freeze a window and it remembers, for every tab: how far down each page you had
read, the half-written comment in the text box, the second a tutorial video was
paused at, and the sentence you had highlighted. Restore it later and you carry
on where you left off.

WHAT IT RESTORES

• Scroll position — anchored to the text you were reading, not a pixel offset,
  so it still lands correctly after images and lazy content load
• Nested scrollers — documentation sidebars, chat panes, code viewers. The part
  no other tab manager captures
• Form contents — text boxes, drafts, rich-text editors
• Video and audio timestamps, resumed a few seconds early so you can re-orient
• The sentence you had highlighted
• Tab order, pinned tabs, and tab groups with their names and colours

CHECKPOINTS AND FLAGS

Mark a spot in a long article (Ctrl+Shift+S) and jump straight back to it later.
Flag a moment in a video (Ctrl+Shift+Y) and jump to that exact second. Several
per page, each one nameable, all listed in the popup.

Once a page has one of your checkpoints, it also keeps a self-updating "Last
position" — so it remembers where you left off, on the pages you chose, and only
those.

IT ALL STAYS YOURS

No server. No account. No sync. No telemetry. Nothing ever leaves your computer.

Passwords are never read. Neither are fields you cannot see — a page's own
hidden scratch fields are skipped.

Export everything to Markdown you can read in Notepad in five years, or to JSON
you can import back. Video flags export as ordinary timestamped links, so they
keep working even if you stop using this extension entirely.

WHEN A PAGE WON'T COOPERATE

There is a Diagnose button. It reports exactly what the extension can see on the
page in front of it and what it skipped, in plain text with no field contents in
it — so a bug report can be a paste rather than a guess.

And if something cannot be put back, the text is not thrown away. The popup
hands it to you.

Open source, MIT licensed: github.com/chanchreekjain/contextfreeze
```

---

## Single purpose statement

> ContextFreeze saves and restores your position within web pages — scroll
> location, form contents, media timestamps and text selections — so you can
> return to reading or working exactly where you left off.

---

## Permission justifications

Stores ask for these one at a time. Answer each in terms of the user-facing
feature it enables; a justification that just restates the permission's name is
what gets a submission bounced.

**`storage`**
> Stores saved sessions and checkpoints on the user's own device. Nothing is
> transmitted; there is no server and no sync.

**`tabs`**
> Reads the URL and title of each tab in a window when the user chooses to freeze
> it, and reopens those URLs when they restore it. Without it a saved session
> cannot record which pages it contained.

**`tabGroups`**
> Records the name and colour of any tab group when freezing a window, and
> recreates the groups on restore, so a restored window is organised the way the
> user left it.

**`scripting`**
> Injects the content script once, at install time, into tabs that were already
> open. Without it those tabs cannot be captured until the user manually reloads
> each one, which is a confusing first-run experience.

**`downloads`**
> Saves the user's own exported checkpoints as a .md or .json file, from the
> Export buttons in the popup. Used only in response to that click.

**`host_permissions: <all_urls>`**
> The extension records scroll position, form contents and media timestamps on
> whatever page the user chooses to save, and restores them on that same page.
> The user decides which pages that is; the extension cannot know in advance
> which sites they will want to bookmark, so it cannot enumerate a narrower set.
> No data is sent anywhere — it is written to chrome.storage.local on the user's
> own machine.

---

## Data use disclosures

| Question | Answer |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | **No** — `input[type=password]` is never read |
| Personal communications | **Yes** — a saved draft may be a message the user was writing. Stored locally only, never transmitted |
| Location | No |
| Web history | **Yes** — URLs of pages the user explicitly saves. Stored locally only |
| User activity | No |
| Website content | **Yes** — form contents, selected text and scroll anchors from pages the user explicitly saves. Stored locally only |

All three certifications apply:

- Data is **not** sold to third parties
- Data is **not** used or transferred for any purpose unrelated to the single purpose above
- Data is **not** used or transferred to determine creditworthiness or for lending

## Privacy policy URL

Publish `docs/privacy.html` with GitHub Pages (Settings → Pages → deploy from
`main`, folder `/docs`) and use:

```
https://chanchreekjain.github.io/contextfreeze/privacy.html
```

---

## Assets

Generated by `npm run store-assets` into `store/`:

| File | Size | Needed for |
|---|---|---|
| `icon-store-128.png` | 128×128 | required |
| `promo-small-440x280.png` | 440×280 | required |
| `promo-marquee-1400x560.png` | 1400×560 | optional, used if featured |

**Screenshots are yours to take** — 1280×800, between 1 and 5, full bleed with
square corners. Worth capturing:

1. The popup open over a long article, showing several named checkpoints
2. The popup on a YouTube video showing flags at timestamps
3. A saved window in the list, with its tab count and name
4. The Markdown export open in a text editor, showing a clickable timestamp link
