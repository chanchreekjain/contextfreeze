/**
 * A small in-page prompt for naming a checkpoint at the moment you drop one.
 *
 * Everything lives inside a shadow root. That is not decoration: it keeps the
 * page's CSS out, keeps our markup out of the page's own DOM semantics, and -
 * the bit that actually matters - means `document.querySelectorAll("input")`
 * cannot see our input, so a freeze taken while this is open will never capture
 * or restore it.
 */

const HOST_ATTR = "data-contextfreeze";
const AUTO_DISMISS_MS = 12_000;

const STYLE = `
:host { all: initial; }
.card {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  width: 300px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #16181c;
  color: #e8eaed;
  box-shadow: 0 8px 28px rgba(0,0,0,.35);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: light) {
  .card { background: #fff; color: #14171a; box-shadow: 0 8px 28px rgba(0,0,0,.18); }
  input { border-color: #d7dbe0 !important; background: #fff !important; color: #14171a !important; }
  .hint { color: #6b7280 !important; }
}
.title { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; font-weight: 600; }
.mark { width: 8px; height: 8px; border-radius: 2px; background: #6ea8fe; transform: rotate(45deg); }
input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #343a42;
  border-radius: 6px;
  background: #1e2126;
  color: #e8eaed;
  font: inherit;
}
input:focus { outline: 2px solid #6ea8fe; outline-offset: -1px; }
.hint { margin-top: 7px; font-size: 11px; color: #9aa0a6; }
`;

/**
 * Shows the prompt and resolves with the name the user typed, or null if they
 * kept the default. Naming is always optional - the checkpoint already exists
 * and already has a sensible label by the time this appears.
 */
export function askForName(defaultLabel: string, title: string): Promise<string | null> {
  // Never stack two.
  document.querySelectorAll(`[${HOST_ATTR}="namer"]`).forEach((el) => el.remove());

  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute(HOST_ATTR, "namer");
    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLE;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      '<div class="title"><span class="mark"></span><span></span></div>' +
      '<input type="text" spellcheck="false">' +
      '<p class="hint">Enter to save · Esc to cancel</p>';

    const titleText = card.querySelector(".title span:last-child") as HTMLElement;
    titleText.textContent = title;

    const input = card.querySelector("input") as HTMLInputElement;
    input.value = defaultLabel;

    root.append(style, card);
    document.documentElement.appendChild(host);

    // Give focus back to whatever had it, so Esc leaves the page exactly as it was.
    const previous = document.activeElement as HTMLElement | null;
    let settled = false;

    const close = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      host.remove();
      try { previous?.focus?.({ preventScroll: true }); } catch { /* gone */ }
      resolve(value);
    };

    const timer = setTimeout(() => close(null), AUTO_DISMISS_MS);

    input.addEventListener("keydown", (event) => {
      // The page must not see these keys - Escape closes overlays on plenty of
      // sites, and space would scroll or pause a video.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        const value = input.value.trim();
        close(value && value !== defaultLabel ? value : null);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    });
    input.addEventListener("blur", () => close(null));

    input.focus({ preventScroll: true });
    input.select();
  });
}
