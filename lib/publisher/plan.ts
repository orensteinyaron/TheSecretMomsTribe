/**
 * The deterministic decision core: for each due channel of a piece, decide
 * whether to STAGE it (and as what media), SKIP it, FAIL it, or NOOP — combining
 * the preflight guards (§2) with the format → media matrix (§3). Pure; no I/O.
 *
 * The orchestrator (CLI / live session) consumes these: 'stage' → download asset
 * + drive the browser composer and stop at publish; 'skip'/'fail' → the matching
 * lifecycle write; 'noop' → leave the row untouched.
 */

import type { Channel } from '../lifecycle/types.js';
import { type MediaMatrixOptions, resolveMedia } from './media-matrix.js';
import { preflightChannel } from './preflight.js';
import type { ChannelAction, DuePiece } from './types.js';

export function planChannel(
  piece: DuePiece,
  channel: Channel,
  now: Date,
  opts: MediaMatrixOptions = {},
): ChannelAction {
  const pf = preflightChannel(piece, channel, now);
  if (pf.action !== 'proceed') {
    return { channel, action: pf.action, reason: pf.reason };
  }
  const media = resolveMedia(piece.renderProfileSlug, channel, opts);
  if (media.action === 'skip') {
    return { channel, action: 'skip', reason: media.reason };
  }
  const ch = piece.channels.find((c) => c.channel === channel);
  const caption = ch?.caption ?? piece.caption ?? '';
  return { channel, action: 'stage', media, caption };
}

/** Plan every channel attached to a piece. */
export function planPiece(piece: DuePiece, now: Date, opts: MediaMatrixOptions = {}): ChannelAction[] {
  return piece.channels.map((c) => planChannel(piece, c.channel, now, opts));
}
