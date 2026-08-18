/**
 * Ultra mode for DeepSeek Harness — browser half.
 *
 * Occupies the composer bar's `conversation.input.right` list seat with a
 * ULTRA chip: off-state offers the tier, on-state executes `/ultra off`.
 * State rides the host-computed `ultra` projection through the standard-kit
 * `useProjection` (zero client-side ultra state), and while active the
 * composer card (`[data-composer-card]`) carries `data-dsh-ultra='on'`,
 * which the injected global stylesheet renders as an animated rainbow
 * border — static under `prefers-reduced-motion`.
 * @module dsh-ultra/client
 */

import type { ClientContext, SessionId, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, IApiClient, SessionModels } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-slots LocaleNamespaceMap merge surface.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
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
export const inject = ['slots', 'remote', 'remote.commands', 'locale', 'connection', 'sessions']

/** The session wire face the effort sync uses. */
type SessionsWire = Pick<IApiClient['sessions'], 'models' | 'selectModel'>

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
  const sessions = ctx.get('sessions') as SessionRuntime
  if (sessions.subagentAddress(sessionId) !== undefined) return
  const connection = ctx.get('connection') as ConnectionHandle
  const wire = connection.api.sessions as SessionsWire
  const { result } = await wire.models({ sessionId })
  if (!result.ok) throw new Error(`session.models failed: ${result.error.code}: ${result.error.message}`)
  const current = result.value.current as SessionModels['current']
  if (current === null || current === undefined) return
  const efforts = result.value.groups
    .filter(group => group.id === current.provider)
    .flatMap(group => group.models)
    .find(model => model.id === current.model)?.reasoning?.efforts
  const deepest = off || efforts === undefined ? undefined : deepestRankedEffort(efforts)
  const { result: selected } = await wire.selectModel({
    sessionId,
    provider: current.provider,
    model: current.model,
    ...deepest === undefined ? {} : { reasoningEffort: deepest },
  })
  if (!selected.ok) {
    throw new Error(`session.selectModel failed: ${selected.error.code}: ${selected.error.message}`)
  }
}

/**
 * Client plugin body: register the ULTRA chip over the command channel and
 * the global rainbow stylesheet.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ultra: dictionaries')

  const style = document.createElement('style')
  style.dataset.dshUltra = ''
  style.textContent = RAINBOW_CSS
  document.head.append(style)
  ctx.effect(() => () => { style.remove() }, 'dsh-ultra: rainbow stylesheet')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'dsh-ultra',
    locale: NS,
    inject: (sessionId: SessionId): UltraChipInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      toggle: async (off: boolean) => {
        const result = await ctx.remote.commands.execute(sessionId, off ? '/ultra off' : '/ultra')
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
  '@property --dsh-ultra-angle { syntax: \'<angle>\'; initial-value: 0deg; inherits: false; }',
  '[data-composer-card][data-dsh-ultra=\'on\'] { position: relative; }',
  [
    '[data-composer-card][data-dsh-ultra=\'on\']::after {',
    '  content: \'\';',
    '  position: absolute;',
    '  inset: -2px;',
    '  border-radius: inherit;',
    '  padding: 2px;',
    '  background: conic-gradient(from var(--dsh-ultra-angle), #ff5f6d, #ffc371, #47ffb1, #5b8cff, #b15cff, #ff5f6d);',
    '  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);',
    '  -webkit-mask-composite: xor;',
    '  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);',
    '  mask-composite: exclude;',
    '  pointer-events: none;',
    '  animation: dsh-ultra-spin 2.5s linear infinite;',
    '}',
  ].join('\n'),
  '@keyframes dsh-ultra-spin { to { --dsh-ultra-angle: 360deg; } }',
  [
    '.dsh-ultra-chip {',
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
    '.dsh-ultra-chip[data-state=\'on\'] {',
    '  border: none;',
    '  color: #141419;',
    '  opacity: 1;',
    '  background: linear-gradient(90deg, #ff5f6d, #ffc371, #47ffb1, #5b8cff, #b15cff, #ff5f6d);',
    '  background-size: 200% 100%;',
    '  animation: dsh-ultra-slide 2.5s linear infinite;',
    '}',
  ].join('\n'),
  [
    '.dsh-ultra-chip[data-state=\'busy\'] {',
    '  opacity: 0.5;',
    '  pointer-events: none;',
    '}',
  ].join('\n'),
  '.dsh-ultra-error { color: #e5484d; font-size: 11px; margin-left: 6px; }',
  '@keyframes dsh-ultra-slide { to { background-position: 200% 0; } }',
  '@media (prefers-reduced-motion: reduce) {',
  '  [data-composer-card][data-dsh-ultra=\'on\']::after { animation: none; }',
  '  .dsh-ultra-chip[data-state=\'on\'] { animation: none; }',
  '}',
].join('\n')
