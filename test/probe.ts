/**
 * Test-only entry point. The capture, restore and checkpoint modules touch
 * nothing but the DOM, so they can be exercised in a plain page - no extension
 * install, no chrome.* APIs, no service worker.
 *
 * This must mirror what src/content/index.ts sets up, or the tests quietly
 * exercise a different program than the extension runs. The selection tracker
 * is the live example: it has to be installed at load, and the first version of
 * this file forgot to, which made a real fix look like a failure.
 */
import { capturePage, installSelectionTracker } from "../src/content/capture";
import { dropCheckpoint, jumpTo } from "../src/content/checkpoint";
import { restorePage } from "../src/content/restore";

installSelectionTracker();

(window as unknown as Record<string, unknown>).__cf = {
  capturePage,
  restorePage,
  dropCheckpoint,
  jumpTo,
};
