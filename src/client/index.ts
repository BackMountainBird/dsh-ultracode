/**
 * Ultra mode for DeepSeek Harness — browser half.
 *
 * Occupies the composer bar's `conversation.input.right` list seat with a
 * ULTRA chip: off-state offers the tier, on-state executes `/ultra off`.
 * State rides the host-computed `ultra` projection through the standard-kit
 * `useProjection` (zero client-side ultra state), and while active the
 * composer card (`[data-composer-card]`) carries `data-dsh-ultracode='on'`,
 * which the injected global stylesheet renders as an animated rainbow
 * border — static under `prefers-reduced-motion`.
 * @module dsh-ultracode/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls the commands and session remote channel declarations into
// the TypertClientRemote namespace map this program's ctx.remote resolves to.
import type {} from '@deepseek-ai/dsh-commands/remote'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-slots LocaleNamespaceMap merge surface.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the session standard kit (useProjection) and sessions merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { UltraChip } from './UltraChip.tsx'
import { en, zh, type UltraKey } from './locales.ts'
import { deepestRankedEffort } from '../ultra-types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer ULTRA chip's copy. */
    ultra: UltraKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ultra'

/** Injected business face of the ULTRA chip. */
export interface UltraChipInjected {
  /**
   * Switch ultra mode through the command channel.
   * @param off - true executes `/ultra off`, false executes `/ultra`.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  toggle: (off: boolean) => Promise<string | null>
}

/** Required services: slots, commands Remote, locale, and the session model API. */
export const inject = ['slots', 'remote', 'remote.commands', 'remote.session', 'locale', 'connection', 'sessions']

/**
 * Mirror the ultra effort pin in the session's own model selection, so the
 * native effort picker shows the tier actually in force instead of the last
 * manual pick. On switch the selection re-submits with the deepest effort the
 * serving model declares; on exit it re-submits without one, restoring the
 * provider default. The request-side pin remains the guarantee — this is
 * display consistency, best-effort after the switch itself.
 * @param ctx - client root context.
 * @param sessionId - the toggled session.
 * @param off - whether ultra mode was just switched off.
 */
async function syncSelectionEffort(ctx: ClientContext, sessionId: SessionId, off: boolean): Promise<void> {
  // The client sessions service; the host-side SessionStore merge also keys
  // 'sessions', so the cast goes through unknown.
  const sessions = ctx.get('sessions') as unknown as ISessions
  if (sessions.subagentAddress(sessionId) !== undefined) return
  const binding = sessions.binding(sessionId)
  const projected = binding === undefined
    ? undefined
    : binding.session.projections.faceOf('modelSelection').getSnapshot() as ModelSelectionProjection | undefined
  const current = projected?.next ?? projected?.lastUsed
  if (current === null || current === undefined) return
  const catalog = await ctx.remote.session.modelCatalog()
  if (!catalog.ok) throw new Error(`session.modelCatalog failed: ${catalog.error.code}: ${catalog.error.message}`)
  const efforts = catalog.value.groups
    .filter(group => group.id === current.provider)
    .flatMap(group => group.models)
    .find(model => model.id === current.model)?.reasoning?.efforts
  const deepest = off || efforts === undefined ? undefined : deepestRankedEffort(efforts)
  const result = await ctx.remote.session.selectModel({
    sessionId,
    provider: current.provider,
    model: current.model,
    ...deepest === undefined ? {} : { reasoningEffort: deepest },
  })
  if (!result.ok) {
    throw new Error(`session.selectModel failed: ${result.error.code}: ${result.error.message}`)
  }
}

/**
 * Client plugin body: register the ULTRA chip over the command channel and
 * the global rainbow stylesheet.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ultracode: dictionaries')

  const style = document.createElement('style')
  style.dataset.dshUltra = ''
  style.textContent = RAINBOW_CSS
  document.head.append(style)
  ctx.effect(() => () => { style.remove() }, 'dsh-ultracode: rainbow stylesheet')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'dsh-ultracode',
    locale: NS,
      inject: (sessionId: SessionId): UltraChipInjected => ({
        // Failure strings stay English (error-surface policy: not localized).
        toggle: async (off: boolean) => {
          const result = await ctx.remote.commands.execute(sessionId, off ? '/ultra off' : '/ultra', [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return 'unknown command: /ultra'
        try {
          await syncSelectionEffort(ctx, sessionId, off)
        } catch (error: unknown) {
          return `ultra switched, but the effort picker sync failed: ${error instanceof Error ? error.message : String(error)}`
        }
        return null
      },
    }),
  }, UltraChip))
}

/** Rainbow composer border + chip skin; animation opt-out under reduced motion. */
const RAINBOW_CSS = [
  '@property --dsh-ultracode-angle { syntax: \'<angle>\'; initial-value: 0deg; inherits: false; }',
  '[data-composer-card][data-dsh-ultracode=\'on\'] { position: relative; }',
  [
    '[data-composer-card][data-dsh-ultracode=\'on\']::after {',
    '  content: \'\';',
    '  position: absolute;',
    '  inset: -2px;',
    '  border-radius: inherit;',
    '  padding: 2px;',
    '  background: conic-gradient(from var(--dsh-ultracode-angle), #ff5f6d, #ffc371, #47ffb1, #5b8cff, #b15cff, #ff5f6d);',
    '  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);',
    '  -webkit-mask-composite: xor;',
    '  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);',
    '  mask-composite: exclude;',
    '  pointer-events: none;',
    '  animation: dsh-ultracode-spin 2.5s linear infinite;',
    '}',
  ].join('\n'),
  '@keyframes dsh-ultracode-spin { to { --dsh-ultracode-angle: 360deg; } }',
  [
    '.dsh-ultracode-chip {',
    '  font: inherit;',
    '  border: 1px solid currentColor;',
    '  border-radius: 999px;',
    '  padding: 1px 10px;',
    '  font-size: 12px;',
    '  line-height: 18px;',
    '  font-weight: 600;',
    '  letter-spacing: 0.04em;',
    '  cursor: pointer;',
    '  background: transparent;',
    '  color: inherit;',
    '  opacity: 0.75;',
    '}',
  ].join('\n'),
  [
    '.dsh-ultracode-chip[data-state=\'on\'] {',
    '  border: none;',
    '  color: #141419;',
    '  opacity: 1;',
    '  background: linear-gradient(90deg, #ff5f6d, #ffc371, #47ffb1, #5b8cff, #b15cff, #ff5f6d);',
    '  background-size: 200% 100%;',
    '  animation: dsh-ultracode-slide 2.5s linear infinite;',
    '}',
  ].join('\n'),
  [
    '.dsh-ultracode-chip[data-state=\'busy\'] {',
    '  opacity: 0.5;',
    '  pointer-events: none;',
    '}',
  ].join('\n'),
  '.dsh-ultracode-error { color: #e5484d; font-size: 11px; margin-left: 6px; }',
  '@keyframes dsh-ultracode-slide { to { background-position: 200% 0; } }',
  '@media (prefers-reduced-motion: reduce) {',
  '  [data-composer-card][data-dsh-ultracode=\'on\']::after { animation: none; }',
  '  .dsh-ultracode-chip[data-state=\'on\'] { animation: none; }',
  '}',
].join('\n')
