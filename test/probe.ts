/**
 * Test-only entry point. The capture and restore modules touch nothing but the
 * DOM, so they can be exercised in a plain page - no extension install, no
 * chrome.* APIs, no service worker. This exposes them on window for Playwright.
 */
import { capturePage } from "../src/content/capture";
import { restorePage } from "../src/content/restore";

(window as unknown as Record<string, unknown>).__cf = { capturePage, restorePage };
