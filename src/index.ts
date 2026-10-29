/**
 * Ultra mode for DeepSeek Harness — host half.
 *
 * A per-session effort tier: while active, every model request is pinned to
 * the configured adapter-owned reasoning effort (default `auto`) through
 * durable model selection, and a deployment-owned policy section rides the
 * system prompt. The section is depth-gated: the top-level session renders
 * the orchestration mandate (the workflow tool's explicit user opt-in
 * requirement is lifted, declared in the section text), while every
 * delegated child renders a worker policy that keeps the workflow tool's
 * default opt-in rule — an orchestration mandate that recursed would make
 * every child fan out workflows of its own. Claude Code's ultracode tier is
 * the reference: the tier's substance is the standing orchestration policy,
 * not a deeper reasoning parameter.
 *
 * State lives entirely in the session log: the commands runtime appends
 * `command/run` before every admitted `/ultra` execution and that event is
 * the fold input for the prompt section, the effort pin, and the `ultra`
 * session projection the web chip reads. A producer-attributed notice user message
 * narrates each switch so the model learns the change without diffing
 * sections. An ignorable plugin record retains effort-pin ownership across
 * reload and resume. The tool catalog never changes.
 *
 * The command and section register globally; scoped lifecycle listeners
 * reconcile each Agent's model selection.
 *
 * @module dsh-ultracode
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ReasoningEffortId as ReasoningEffort } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
// Value import: SessionId is the runtime brand constructor; the store lookup
// keys on it. Also resolves ctx.sessions (SessionStore) for the chain walk.
import { SessionId, appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
// Declaration merge only: makes ctx.systemPrompt's section face visible.
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only edge: resolves ctx.commands for the optional command child.
import type {} from '@deepseek-ai/dsh-commands'
// Type-only: resolves ctx.sessionProjections for the optional projection child.
import type {} from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { foldUltra, chainUltra, deepestRankedEffort, type ChainNode, type UltraProjection } from './ultra-types.ts'

export type { UltraProjection } from './ultra-types.ts'
export { foldUltra, chainUltra, deepestRankedEffort, EFFORT_RANK } from './ultra-types.ts'

export const name = 'dsh-ultracode'

export const inject = ['systemPrompt', 'llm', 'sessions']

/** Plugin configuration. */
export interface Config {
  /**
   * Guidance rendered as the `ultra:policy` prompt section while ultra mode
   * is active for a top-level session (`delegationDepth` zero).
   */
  section?: string
  /**
   * Guidance rendered as the `ultra:policy` prompt section while ultra mode
   * is active for a delegated child (`delegationDepth` above zero): the
   * worker policy, which keeps the workflow tool's default opt-in rule so
   * the top-level orchestration mandate does not recurse.
   */
  childSection?: string
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

/**
 * Default worker policy for delegated children: ultra's quality bar without
 * the orchestration mandate, so fan-out stays at the top-level session.
 */
const DEFAULT_CHILD_SECTION
  = 'Ultra mode is on (inherited from the delegating session): optimize for the most exhaustive, '
  + 'correct answer to your delegated task, not the fastest or cheapest — token cost is not a '
  + 'constraint. You are the executor of this task, not its orchestrator: the workflow tool\'s '
  + 'default opt-in rule stands, so start one only when your task brief explicitly requests '
  + 'orchestration; when parallel work you did start times out, narrow it or report what is '
  + 'missing instead of spawning replacement waves. Verify adversarially before reporting: '
  + 'ground counts and "all instances" claims in a check you ran, not an estimate. Sandbox, '
  + 'approval policy, and your other operating rules are unchanged; report failures, skipped '
  + 'steps, and uncertainty as such.'

export const Config: z<Config> = z.object({
  section: z.string().default(DEFAULT_SECTION),
  childSection: z.string().default(DEFAULT_CHILD_SECTION),
  effort: z.string().default('auto'),
  promptSectionOrder: z.natural().default(120),
})

/** Wire payload schema of the `ultra` projection. */
const ultraProjectionSchema: ZodType<UltraProjection> = zod.object({
  active: zod.boolean(),
})

/** Persisted ownership of an explicit effort, independent of the ultra switch. */
const effortPinSchema = zod.object({
  selection: zod.object({
    provider: zod.string().min(1),
    model: zod.string().min(1),
    reasoningEffort: zod.string().min(1).transform(ReasoningEffortId),
  }).nullable(),
})

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:dsh-ultracode/effort-pin': zod.infer<typeof effortPinSchema>
  }
}

/** Recover ownership after reload/resume; malformed owner records fail validation. */
function effortPinOf(session: Session): ModelSelection | null {
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const record = pluginRecordOf(events[index]!)
    if (record?.type === 'plugin:dsh-ultracode/effort-pin') {
      return effortPinSchema.parse(record.data).selection
    }
  }
  return null
}

/** One-line switch notice the model reads at its next step boundary. */
function notice(active: boolean) {
  const text = active
    ? 'The user switched this session to ultra mode: reasoning effort is pinned and the ultra policy is in force.'
    : 'The user switched this session out of ultra mode.'
  return createUserMessage({
    content: [{ type: 'text', text }],
    // The notice is already one sentence, so it is its own summary.
    source: { kind: 'dsh-ultracode', form: 'notice', summary: text },
  })
}

/** One live session reduced to the chain-walk node shape. */
function chainNodeOf(session: Session): ChainNode {
  return {
    id: session.id as string,
    events: session.snapshotEvents(),
    parent: session.header.parentSession as string | undefined,
    depth: session.header.delegationDepth ?? 0,
    ...session.header.isSeeded ? { seedLength: session.inheritedEventCount } : {},
  }
}

/**
 * The effective ultra state of one session: its own fold, then the
 * delegation-parent chain for subagent children (the parent must still be
 * live in the store; a disposed parent ends the walk). Synchronous — both the
 * section callback and the request waterfall call it inline.
 * @param ctx - plugin context carrying the session store.
 * @param session - the requesting session.
 * @returns whether ultra mode is in force for this session.
 */
function inheritedUltra(ctx: Context, session: Session): boolean {
  return chainUltra(chainNodeOf(session), (id) => {
    const parent = ctx.sessions.get(SessionId(id))
    return parent === undefined ? undefined : chainNodeOf(parent)
  })
}

/** Compare complete selections, including provider-default effort. */
function sameSelection(left: Readonly<ModelSelection>, right: Readonly<ModelSelection>): boolean {
  return left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
}

/**
 * Host plugin body: the `ultra:policy` prompt section, the effort pin, the
 * global `/ultra` command, and the `ultra` session projection.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  // The schemas default absent sections; an explicitly blank one is a
  // misconfiguration and fails loud at load rather than rendering an empty
  // policy while the tier claims to be active.
  if (config.section === undefined || config.section.trim() === '') {
    throw new Error('dsh-ultracode: config `section` must be a non-empty string')
  }
  if (config.childSection === undefined || config.childSection.trim() === '') {
    throw new Error('dsh-ultracode: config `childSection` must be a non-empty string')
  }
  const section = config.section
  const childSection = config.childSection
  const fixedEffort = config.effort === undefined || config.effort === 'auto'
    ? undefined
    : ReasoningEffortId(config.effort)
  // Transient flag for a command changing a selection while assembly awaits.
  // Pin ownership itself is durable, so reload/resume can release old pins.
  const changed = new WeakSet<Agent>()

  // Model selection must be recorded before a step captures it. DSH 0.2.2
  // rejects provider/model/effort changes from the old request waterfall.
  const syncEffort = async (agent: Agent, signal?: AbortSignal, reset = false): Promise<void> => {
    for (;;) {
      signal?.throwIfAborted()
      const current = agent.model.current()
      if (current === undefined) return
      const active = inheritedUltra(ctx, agent.session)
      const owned = effortPinOf(agent.session)
      if (!active && owned === null && !reset) return
      if (!active && !reset && owned !== null && !sameSelection(current, owned)) {
        appendPluginRecord(agent.session, 'plugin:dsh-ultracode/effort-pin', { selection: null })
        return
      }
      let effort: ReasoningEffort | undefined
      if (active) {
        const info = await ctx.llm.resolveModelInfo(current.provider, current.model, signal)
        const efforts = info.reasoning?.efforts
        if (fixedEffort !== undefined && !efforts?.some(value => value.id === fixedEffort)) {
          throw new Error(`dsh-ultracode: model ${current.provider}/${current.model} does not declare effort ${fixedEffort}`)
        }
        const deepest = efforts === undefined ? undefined : deepestRankedEffort(efforts)
        effort = fixedEffort ?? (deepest === undefined ? undefined : ReasoningEffortId(deepest))
        if (effort === undefined) {
          if (owned !== null) appendPluginRecord(agent.session, 'plugin:dsh-ultracode/effort-pin', { selection: null })
          return
        }
      }
      signal?.throwIfAborted()
      const latest = agent.model.current()
      if (latest?.provider !== current.provider || latest.model !== current.model
        || latest.reasoningEffort !== current.reasoningEffort
        || inheritedUltra(ctx, agent.session) !== active) continue
      if (effort !== current.reasoningEffort) {
        agent.model.select({ provider: current.provider, model: current.model, ...effort === undefined ? {} : { reasoningEffort: effort } })
        changed.add(agent)
      }
      const selection = effort === undefined ? null : { provider: current.provider, model: current.model, reasoningEffort: effort }
      if (selection === null ? owned !== null : owned === null || !sameSelection(selection, owned)) {
        appendPluginRecord(agent.session, 'plugin:dsh-ultracode/effort-pin', { selection })
      }
      return
    }
  }

  ctx.on('agent/created', async ({ agent, signal }) => {
    await syncEffort(agent, signal)
  })

  ctx.systemPrompt.section({
    name: 'ultra:policy',
    order: config.promptSectionOrder ?? 120,
    text: (context) => {
      if (context.agent === undefined) return ''
      if (!inheritedUltra(ctx, context.agent.session)) return ''
      // The orchestration mandate belongs to the top-level session: rendering
      // it in a delegated child makes every child fan out workflows of its
      // own, and the harness enforces no delegation-depth budget on the
      // workflow path. Children render the worker policy instead; the
      // durable header depth is the authority (runtime options can only
      // deepen it, and children are always stamped).
      return (context.agent.session.header.delegationDepth ?? 0) > 0 ? childSection : section
    },
  })

  // A manual pick or parent switch may arrive after creation. A step has
  // already captured its selection before pre-step listeners run, so a
  // changed effort requires fresh preparation. Preserve the claimed batch,
  // cancel only that preparation, and latch a waking notice behind its
  // cancellation. No model request is admitted under the stale effort.
  ctx.on('agent/pre-step', async ({ agent, signal, messages, modelSelection }, next) => {
    if (!inheritedUltra(ctx, agent.session) && effortPinOf(agent.session) === null && !changed.has(agent)) return next()
    await syncEffort(agent, signal)
    const selected = agent.model.current()
    changed.delete(agent)
    if (selected === undefined || sameSelection(selected, modelSelection)) return next()
    signal.throwIfAborted()
    agent.inbox.splice('next-step', 0, 0, messages)
    agent.cancel({ kind: 'hook', reason: 'ultra reasoning effort synchronized' }, { keepInbox: true })
    const wake = createUserMessage({
      content: [{ type: 'text', text: 'Ultra mode synchronized the model selection. Continue the pending task.' }],
      source: { kind: 'dsh-ultracode', form: 'notice', summary: 'Ultra model selection synchronized.' },
    })
    agent.send(wake, 'next-turn', true)
    // The replay must precede already queued followups. send() latches the
    // wake after cancellation; synchronous reordering keeps that latch while
    // putting only this plugin's notice ahead of those independent turns.
    if (agent.inbox.nextTurn[0]?.id !== wake.id) {
      agent.inbox.remove(wake.id)
      agent.inbox.prepend('next-turn', wake)
    }
    return { kind: 'reject' }
  }, { prepend: true })

  // The command child activates only when a command registry is composed
  // (headless assemblies stay unaffected).
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'ultra',
      description: 'Toggle ultra mode (pinned max effort + orchestration policy)',
      input: { hint: '[off]' },
      handler: async ({ agent, rawInput, signal }) => {
        const off = rawInput.trim() === 'off'
        // The runtime already appended THIS execution's `command/run` — the
        // committed state — before invoking the handler, so the pre-switch
        // state is the fold over everything before that final event. The
        // idempotence check compares the REQUESTED target (!off) with that
        // pre-switch state.
        const log = agent.session.snapshotEvents()
        const was = foldUltra(log, log.length - 1)
        await syncEffort(agent, signal, off)
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
      stateSchema: ultraProjectionSchema,
      init: () => ({ active: false }),
      apply: (state, event) => {
        if (event.type === 'command/run' && event.data.name === 'ultra') {
          const next = event.data.args === undefined || event.data.args.trim() !== 'off'
          return next === state.active ? state : { active: next }
        }
        return state
      },
      wire: {
        viewSchema: ultraProjectionSchema,
        view: state => ({ active: state.active }),
      },
      stateVersion: 1,
    })
  })
}
