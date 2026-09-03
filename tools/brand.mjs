/**
 * The one place that knows what ContextFreeze looks like.
 *
 * Both the extension icons and the store artwork are built from these numbers,
 * so the mark on a store tile is provably the same mark as the one in the
 * toolbar rather than a lookalike that drifted.
 */

export const GRADIENT_FROM = [0x2b, 0x2f, 0xd6];
export const GRADIENT_TO = [0x35, 0xb8, 0xff];
export const INK = [0x0e, 0x11, 0x18];
export const PAPER = [0xff, 0xff, 0xff];
export const MUTED = [0x39, 0x40, 0x4d];

export const CORNER_RADIUS = 0.22;

/**
 * A bookmark with a sheared top - a shard of one. Unit square, y downwards.
 *
 * Five points on purpose. At 16px the silhouette is the only thing that
 * survives, so it has to carry the whole identity: the deep notch says
 * bookmark, and the slanted top edge keeps it from being every other bookmark
 * icon ever drawn. An earlier version had a pointed top and read as an up arrow.
 */
export const MARK = [
  [0.30, 0.21],
  [0.70, 0.12],
  [0.70, 0.86],
  [0.50, 0.65],
  [0.30, 0.86],
];

/** The mark scaled and placed into an arbitrary box. */
export function markPoints(left, top, size) {
  return MARK.map(([x, y]) => [left + x * size, top + y * size]);
}
