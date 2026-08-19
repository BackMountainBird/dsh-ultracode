/**
 * Ultra mode for DeepSeek Harness — host half.
 *
 * A per-session effort tier: while active, every model request is pinned to
 * the configured adapter-owned reasoning effort (default `max`) through the
 * `agent/request` waterfall, a deployment-owned policy section rides the
 * system prompt, and the workflow tool's explicit user opt-in requirement is
 * lifted for the session (declared in the section text). Claude Code's
 * ultracode tier is the reference: the tier's substance is the standing
 * orchestration policy, not a deeper reasoning parameter.
 *
 * State lives entirely in the session log: the commands runtime appends
 * `command/run` before every admitted `/ultra` execution and that event is
 * the fold input for the prompt section, the effort pin, and the `ultra`
 * session projection the web chip reads. A plugin-source notice user message
 * narrates each switch so the model learns the change without diffing
 * sections. No custom session event is defined (out-of-repo events are
 * dropped by current harness builds), and the tool catalog never changes.
 *
 * Mounting is host-plane: the command registers globally, the section into
 * the shared registry, so the plugin needs no per-agent realm.
 *
 * @module dsh-ultra
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ReasoningEffortId as ReasoningEffort } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
// Declaration merge only: pulls the Events map ('agent/request') and the
// AssembleContext { agent } merge.
import type {} from '@deepseek-ai/dsh-agent'
// Declaration merge only: makes ctx.systemPrompt's section face visible.
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only edge: resolves ctx.commands for the optional command child.
import type {} from '@deepseek-ai/dsh-commands'
// Type-only: resolves ctx.sessionProjections for the optional projection child.
import type {} from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { foldUltra, deepestRankedEffort, type UltraProjection } from './ultra-types.ts'

export type { UltraProjection } from './ultra-types.ts'
export { foldUltra, deepestRankedEffort, EFFORT_RANK } from './ultra-types.ts'

export const name = 'dsh-ultra'

export const inject = ['systemPrompt', 'llm']

/** Plugin configuration. */
export interface Config {
  /**
   * Guidance rendered as the `ultra:policy` prompt section while ultra mode
   * is active.
   */
  section?: string
  /**
   * Reasoning effort pinned on every request while ultra mode is active:
   * `auto` (default) resolves each request to the deepest effort the serving
   * model declares under the well-known `off|low|medium|high|xhigh|max`
   * vocabulary (`max` on DeepSeek, `high` on GLM/Kimi routes that stop there;
   * a model declaring nothing above `off` is left unpinned). Any other value
   * pins literally and must be one of the serving adapter's declared efforts
   * — an unsupported value fails loud at request assembly.
   */
  effort?: string
  /** Prompt-section order for the policy (default `120`). */
  promptSectionOrder?: number
}

/** Default ultra policy: the tier's substance — the standing orchestration mandate. */
const DEFAULT_SECTION
  = 'Ultra mode is on: optimize for the most exhaustive, correct answer, not the fastest '
  + 'or cheapest — token cost is not a constraint. The workflow tool\'s explicit user '
  + 'opt-in requirement is lifted for this session: use it on every substantive task by '
  + 'default. For multi-phase work, run one workflow per phase (understand → design → '
  + 'implement → review) and read each result before deciding the next; compose the '
  + 'quality patterns documented in the workflow tool description as the task fits. '
  + 'Verify adversarially before reporting: cross-check conclusions that came from '
  + 'parallel work with an independent pass, and ground counts and "all instances" '
  + 'claims in a check you ran, not in one subagent\'s summary. Scale fan-out to the '
  + 'serving provider\'s capacity: when parallel subagent requests time out, retry the '
  + 'same work as a narrower wave instead of abandoning it. Sandbox, approval '
  + 'policy, and your other operating rules are unchanged; report failures, skipped '
  + 'steps, and uncertainty as such. Solo only on conversational turns, trivial '
  + 'mechanical edits, or work already verified.'

export const Config: z<Config> = z.object({
  section: z.string().default(DEFAULT_SECTION),
  effort: z.string().default('auto'),
  promptSectionOrder: z.natural().default(120),
})

/** Wire payload schema of the `ultra` projection. */
const ultraProjectionSchema: ZodType<UltraProjection> = zod.object({
  active: zod.boolean(),
})

/** One-line switch notice the model reads at its next step boundary. */
function notice(active: boolean) {
  const text = active
    ? 'The user switched this session to ultra mode: reasoning effort is pinned and the ultra policy is in force.'
    : 'The user switched this session out of ultra mode.'
  return createUserMessage({
    content: [{ type: 'text', text }],
    // The notice is already one sentence, so it is its own summary.
    source: { kind: 'plugin', plugin: 'dsh-ultra', form: 'notice', summary: text },
  })
}

/**
 * Host plugin body: the `ultra:policy` prompt section, the effort pin, the
 * global `/ultra` command, and the `ultra` session projection.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  // The schema defaults an absent `section`; an explicitly blank one is a
  // misconfiguration and fails loud at load rather than rendering an empty
  // policy while the tier claims to be active.
  if (config.section === undefined || config.section.trim() === '') {
    throw new Error('dsh-ultra: config `section` must be a non-empty string')
  }
  const section = config.section
  const fixedEffort = config.effort === undefined || config.effort === 'auto'
    ? undefined
    : ReasoningEffortId(config.effort)

  ctx.systemPrompt.section({
    name: 'ultra:policy',
    order: config.promptSectionOrder ?? 120,
    text: (context) => {
      if (context.agent === undefined) return ''
      return foldUltra(context.agent.session.events) ? section : ''
    },
  })

  // Effort pin: prepend (cordis keeps one flat hook array per event; the
  // chain runs array-head-first, i.e. head = outermost, whose post-`next()`
  // override wins) guarantees this listener stays outside the per-agent
  // model-selection listener installed at agent creation — which strips an
  // inner listener's reasoningEffort and re-applies the session selection.
  // Model-selection still owns provider/model; ultra owns the effort while
  // active. A fixed config value pins literally; `auto` resolves each
  // request against the serving model's declared efforts, so the same
  // profile serves DeepSeek (`max`) and GLM/Kimi (`high`) routes.
  ctx.on('agent/request', async ({ agent, signal }, next) => {
    const resolved = await next()
    if (!foldUltra(agent.session.events)) return resolved
    if (fixedEffort !== undefined) return { ...resolved, reasoningEffort: fixedEffort }
    const info = await ctx.llm.resolveModelInfo(resolved.provider, resolved.model, signal)
    const efforts = info.reasoning?.efforts
    const deepest = efforts === undefined ? undefined : deepestRankedEffort(efforts)
    return deepest === undefined ? resolved : { ...resolved, reasoningEffort: ReasoningEffortId(deepest) }
  }, true)

  // The command child activates only when a command registry is composed
  // (headless assemblies stay unaffected).
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'ultra',
      description: 'Toggle ultra mode (pinned max effort + orchestration policy)',
      input: { hint: '[off]' },
      handler: ({ agent, rawInput }) => {
        const off = rawInput.trim() === 'off'
        // The runtime already appended THIS execution's `command/run` — the
        // committed state — before invoking the handler, so the pre-switch
        // state is the fold over everything before that final event. The
        // idempotence check compares the REQUESTED target (!off) with that
        // pre-switch state.
        const was = foldUltra(agent.session.events, agent.session.events.length - 1)
        if (!off === was) {
          return {
            kind: 'success',
            text: off ? 'Ultra mode is already off.' : 'Ultra mode is already on. Use /ultra off to leave.',
          } as const
        }
        // Narrate the switch so the model learns it without waking the driver.
        agent.inject(notice(!off))
        return {
          kind: 'success',
          text: off
            ? 'Ultra mode off.'
            : 'Ultra mode on (effort pinned, ultra policy active). Use /ultra off to leave.',
        } as const
      },
    })
  })

  // The projection child activates only when a projection registry is
  // composed; the web chip reads the folded {active} value.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'ultra', { active: boolean }>({
      key: 'ultra',
      schema: ultraProjectionSchema,
      init: () => ({ active: false }),
      apply: (state, event) => {
        if (event.type === 'command/run' && event.data.name === 'ultra') {
          const next = event.data.args === undefined || event.data.args.trim() !== 'off'
          return next === state.active ? state : { active: next }
        }
        return state
      },
      view: state => ({ active: state.active }),
      stateVersion: 1,
    })
  })
}
