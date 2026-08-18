/**
 * Ultra-mode shared types: the session-projection table entry and the log
 * fold both halves of the plugin read. Zero host-side imports so the browser
 * program can load it without dragging in cordis Context augmentations.
 *
 * Ultra state is recorded purely through the harness-owned `command/run`
 * event the commands runtime appends before every admitted `/ultra`
 * execution — out-of-repo session events are dropped by current harness
 * builds, so the plugin defines no event type of its own. The last
 * `/ultra` command wins: `/ultra` or `/ultra on` activates, `/ultra off`
 * deactivates.
 * @module dsh-ultra/ultra-types
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Wire payload of the `ultra` session projection: whole-value replace. */
export interface UltraProjection {
  /** Whether ultra mode is in force for the session. */
  readonly active: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Ultra-mode state folded from `command/run` events (`ultra` commands);
     * `{ active: false }` for a log with none.
     */
    ultra: UltraProjection
  }
}

/**
 * Whether ultra mode is in force. The last `command/run` of an `ultra`
 * command wins; a prefix with none is inactive.
 *
 * @param events The session log or any prefix of it.
 * @param end Fold `events[0, end)`; defaults to the whole log.
 * @returns Whether ultra mode is active.
 */
export function foldUltra(events: readonly SessionEvent[], end = events.length): boolean {
  let active = false
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'command/run' && event.data.name === 'ultra') {
      active = event.data.args === undefined || event.data.args.trim() !== 'off'
    }
  }
  return active
}
