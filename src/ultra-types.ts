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
 * Well-known effort spellings, shallowest to deepest. Both shipped adapters
 * (llm-deepseek, llm-pi-ai) draw their effort ids from this vocabulary, so
 * tier logic can rank a model's declared set; ids outside it are opaque and
 * never guessed.
 */
export const EFFORT_RANK: readonly string[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * The deepest declared effort worth pinning, or `undefined` when the set has
 * no ranked entry above `off` (pinning `off` would disable reasoning — the
 * opposite of ultra — and unranked ids are not guessed).
 * @param efforts - one model's declared efforts, any order.
 * @returns the effort id to pin, or undefined to leave selection unpinned.
 */
export function deepestRankedEffort(efforts: readonly { id: string }[]): string | undefined {
  let best: string | undefined
  let bestRank = 0
  for (const effort of efforts) {
    const rank = EFFORT_RANK.indexOf(effort.id)
    if (rank > bestRank) {
      best = effort.id
      bestRank = rank
    }
  }
  return best
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
