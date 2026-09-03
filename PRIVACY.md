# ContextFreeze privacy policy

_Last updated: 3 September 2026_

ContextFreeze has no server. It makes no network requests of any kind. Nothing
it reads from your browser ever leaves your computer unless you export it
yourself.

## What it stores

Only when you ask it to — by freezing a window, marking a spot, or flagging a
moment — ContextFreeze records, for the pages involved:

- the page URL and title
- how far down the page you were, described as a nearby element and an offset
- the contents of visible form fields, text boxes and rich-text editors
- the current timestamp and playback rate of a video or audio element
- text you had selected
- tab order, pinned state, and tab group names and colours

## What it never stores

- **Passwords.** `input[type=password]` is never read, at any time.
- Hidden, `file`, and button inputs.
- Fields you cannot see — a page's own hidden scratch fields are skipped.
- Anything on a page you have not explicitly frozen or checkpointed.
- Your browsing history. A page only starts remembering your position after you
  deliberately mark it.

## Where it is stored

In `chrome.storage.local`, which lives on your computer inside your browser
profile. It is not synced to any account and not transmitted anywhere.

## What it is used for

Putting you back where you were. That is the only purpose. The data is never
sold, never shared, never used for advertising, never used to build a profile of
you, and never used for creditworthiness or lending decisions.

## Sharing

None. There is no analytics, no telemetry, no crash reporting, and no third
party of any kind involved.

The only way data leaves the extension is when **you** use the export buttons,
which write a file to a location you choose on your own computer.

## Deleting it

- Individual freezes and checkpoints: the × button in the popup.
- Everything: remove ContextFreeze from `chrome://extensions`. Uninstalling an
  extension deletes its local storage.

## Permissions

Every permission the extension requests, and why, is documented in the project
README: https://github.com/chanchreekjain/contextfreeze#permissions-and-why-each-one

## Contact

Issues and questions: https://github.com/chanchreekjain/contextfreeze/issues
