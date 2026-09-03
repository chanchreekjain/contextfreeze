import { RESUME_REWIND_SECONDS } from "./constants";
import type { FrozenTab } from "./types";

/**
 * Some sites own their player so thoroughly that fighting it from a content
 * script is the wrong move: they reinitialise after load and reset the playhead
 * to whatever they think is correct. Where a site has its own resume mechanism,
 * use that instead - it runs before the player starts, so there is nothing to
 * fight.
 *
 * This rewrites the URL a restore opens. The content script still does its own
 * seek as a backstop, and the two agree because both rewind by the same amount.
 */
/**
 * A URL that opens the page already at `seconds`, or null if the site has no
 * such mechanism and we would just be inventing a query parameter.
 */
export function timestampedUrl(rawUrl: string, seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 1) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const whole = Math.floor(seconds);
  const host = url.hostname.replace(/^www\./, "");

  // youtube.com/watch?v=... and the m. mobile host both honour ?t=90s
  if ((host === "youtube.com" || host === "m.youtube.com") && url.pathname === "/watch") {
    url.searchParams.set("t", whole + "s");
    return url.toString();
  }

  // youtu.be/<id> short links take a bare seconds value
  if (host === "youtu.be") {
    url.searchParams.set("t", String(whole));
    return url.toString();
  }

  return null;
}

export function resumeUrl(tab: FrozenTab): string {
  const media = tab.context?.media?.[0];
  if (!media) return tab.url;
  return timestampedUrl(tab.url, media.currentTime - RESUME_REWIND_SECONDS) ?? tab.url;
}
