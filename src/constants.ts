/**
 * Resuming a video or podcast exactly where you paused it drops you mid-sentence.
 * Coming back a few seconds early is how people actually pick something back up,
 * so both the generic seek and the YouTube URL rewrite rewind by this much.
 * Set to 0 for pixel-exact resume.
 */
export const RESUME_REWIND_SECONDS = 3;
