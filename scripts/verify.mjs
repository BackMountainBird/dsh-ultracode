/**
 * Offline checks for session folds, host registration, and the browser bundle.
 * Run `pnpm build` before `pnpm verify` to check the delivered artifacts.
 * @module dsh-ultracode/verify
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { foldUltra, chainUltra, deepestRankedEffort, Config, apply } from '../lib/index.js'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { UltraChip } from '../lib/client/UltraChip.js'
import { Session, SessionId, appendPluginRecord } from '@deepseek-ai/dsh-session'

/** Capture plugin contributions without starting a provider or a browser. */
function hostFixture() {
  const hooks = new Map()
  let section, command, projection
  const ctx = {
    systemPrompt: { section: value => { section = value } },
    sessions: { get: () => undefined },
    llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high' }, { id: 'max' }] } }) },
    on: (name, handler) => { hooks.set(name, handler) },
    inject: (services, callback) => callback(ctx),
    commands: { register: value => { command = value } },
    sessionProjections: { register: value => { projection = value } },
  }
  apply(ctx, Config({}))
  return { ctx, hooks, section, command, projection }
}

const sessionFixture = (events = [], header = {}, id = 'session-test') => {
  const baseline = Session.create(SessionId(id))
  const session = Session.create(SessionId(id), [], { ...baseline.header, ...header }, 0)
  for (const event of events) session.append(event.type, event.data)
  return session
}

const modelFixture = () => {
  let selection = { provider: 'provider', model: 'model', reasoningEffort: 'low' }
  return { current: () => selection, select: value => { selection = value } }
}

test('command switches inject an attributed notice and repeated switches stay silent', async () => {
  const { command } = hostFixture()
  const events = [run('ultra', '')]
  const notices = []
  const agent = { session: sessionFixture(events), model: modelFixture(), inject: message => notices.push(message) }
  assert.equal((await command.handler({ agent, rawInput: '' })).kind, 'success')
  assert.equal(agent.model.current().reasoningEffort, 'max')
  assert.equal(notices.length, 1)
  assert.equal(notices[0].source.kind, 'dsh-ultracode')
  assert.equal(notices[0].source.form, 'notice')
  agent.session.append('command/run', run('ultra', '').data)
  await command.handler({ agent, rawInput: '' })
  assert.equal(notices.length, 1)
  agent.session.append('command/run', run('ultra', 'off').data)
  await command.handler({ agent, rawInput: 'off' })
  assert.equal(notices.length, 2)
  assert.equal(agent.model.current().reasoningEffort, undefined)
})

test('an empty seeded fork never inherits a later parent switch', () => {
  const { ctx, section } = hostFixture()
  ctx.sessions.get = () => sessionFixture([run('ultra', '')], {}, 'parent')
  const agent = { session: sessionFixture([], { parentSession: 'parent', delegationDepth: 1, isSeeded: true }) }
  assert.equal(section.text({ agent }), '')
})

test('created agents inherit effort using their serving model and the worker policy', async () => {
  const { ctx, hooks, section } = hostFixture()
  const agent = { session: sessionFixture([run('ultra', '')]), model: modelFixture() }
  const initialize = () => hooks.get('agent/created')({ agent, signal: new AbortController().signal })
  await initialize()
  assert.equal(agent.model.current().reasoningEffort, 'max')
  assert.ok(section.text({ agent }).includes('use it on every substantive task'))
  agent.session = sessionFixture([], { parentSession: 'parent', delegationDepth: 1, isSeeded: false })
  ctx.sessions.get = () => sessionFixture([run('ultra', '')], {}, 'parent')
  ctx.llm.resolveModelInfo = async () => ({ reasoning: { efforts: [{ id: 'high' }] } })
  await initialize()
  assert.equal(agent.model.current().reasoningEffort, 'high')
  assert.ok(section.text({ agent }).includes('opt-in rule stands'))
  ctx.sessions.get = () => undefined
  await initialize()
  assert.equal(agent.model.current().reasoningEffort, undefined)
})

test('browser command failures remain visible and never perform a second model selection', async () => {
  let client, entry
  const style = { dataset: {}, remove() {} }
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: module => { client = module.factory(createRequire(import.meta.url)) } } },
    document: { createElement: () => style, head: { append() {} } },
  })
  const calls = []
  const ctx = {
    effect: callback => callback(), locale: { register() {} },
    slots: { inject: (name, callback) => callback(), register: options => { entry = options } },
    remote: { commands: { execute: async (...args) => {
      calls.push(args)
      return { ok: true, value: { result: { kind: 'error', text: 'model unavailable' } } }
    } } },
  }
  client.apply(ctx)
  const injected = entry.inject('session-test')
  assert.equal(await injected.toggle(false), 'model unavailable')
  assert.equal(calls[0][1], '/ultra')
  ctx.remote.commands.execute = async () => ({ ok: true, value: { result: { kind: 'success' } } })
  assert.equal(await injected.toggle(true), null)
})

test('projection publishes switch state and keeps unchanged references', () => {
  const { projection } = hostFixture()
  const initial = projection.init({})
  assert.equal(projection.apply(initial, run('plan', '')), initial)
  const active = projection.apply(initial, run('ultra', ''))
  assert.deepEqual(projection.wire.view(active), { active: true })
  assert.equal(projection.apply(active, run('ultra', '')), active)
  assert.deepEqual(projection.apply(active, run('ultra', 'off')), { active: false })
})

test('restored effort ownership records are validated before use', async () => {
  const { hooks } = hostFixture()
  const session = sessionFixture()
  appendPluginRecord(session, 'plugin:dsh-ultracode/effort-pin', {
    selection: { provider: 'provider', model: 'model', reasoningEffort: 123 },
  })
  await assert.rejects(hooks.get('agent/created')({ agent: { session, model: modelFixture() } }), /reasoningEffort/)
})

test('the rendered chip uses the stylesheet class and composer marker', () => {
  const markup = renderToStaticMarkup(createElement(UltraChip, {
    useProjection: () => ({ active: true }), toggle: async () => null, t: key => key,
  }))
  assert.ok(markup.includes('class="dsh-ultracode-chip"'))
  const component = readFileSync(new URL('../lib/client/UltraChip.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(component.includes('data-dsh-ultracode'))
  assert.ok(client.includes('data-dsh-ultracode'))
})

test('chainUltra: subagent children inherit, forks stop at their own seed', () => {
  const on = [run('ultra', '')]
  const off = [run('ultra', 'off')]
  // Real shapes: the shared driver stamps depth on EVERY subagent child;
  // only seeded children (forks) carry seedLength. Spawn children have none.
  const spawn = (id, events, parent, depth) => ({ id, events, parent, depth })
  const fork = (id, events, parent, depth, seedLength) => ({ id, events, parent, depth, seedLength })
  const resolve = table => id => table.get(id)
  // Spawn child (depth 1, no seed) of an ultra-on parent inherits.
  assert.equal(chainUltra(spawn('child', [], 'parent', 1), resolve(new Map([['parent', spawn('parent', on)]]))), true)
  // Spawn child of a plain parent does not.
  assert.equal(chainUltra(spawn('child', [], 'parent', 1), resolve(new Map([['parent', spawn('parent', off)]]))), false)
  // Two-level spawn delegation walks to the grandparent.
  const deep = new Map([
    ['mid', spawn('mid', [], 'root', 1)],
    ['root', spawn('root', on)],
  ])
  assert.equal(chainUltra(spawn('leaf', [], 'mid', 2), resolve(deep)), true)
  // A REAL fork (depth 1, seeded — the driver's actual stamping) never
  // consults the live parent, even an ultra-on one or a later switch-on:
  // seeded children inherit only through their frozen prefix.
  assert.equal(chainUltra(fork('fork', [], 'parent', 1, 120), resolve(new Map([['parent', spawn('parent', on)]]))), false)
  assert.equal(chainUltra(fork('fork', off, 'parent', 1, 120), resolve(new Map([['parent', spawn('parent', on)]]))), false)
  // A fork seeded from an ultra-on parent folds on by itself and freezes.
  assert.equal(chainUltra(fork('fork', on, 'parent', 1, 120), resolve(new Map([['parent', spawn('parent', off)]]))), true)
  // A disposed parent (unresolvable) ends the walk without inheriting.
  assert.equal(chainUltra(spawn('child', [], 'gone', 1), resolve(new Map())), false)
  // A malformed cyclic lineage terminates instead of looping.
  assert.equal(chainUltra(spawn('a', [], 'b', 1), resolve(new Map([['b', spawn('b', [], 'a', 1)]]))), false)
})

test('deepestRankedEffort picks the deepest entry under the known vocabulary', () => {
  const ids = list => list.map(id => ({ id }))
  // DeepSeek shape: max wins.
  assert.equal(deepestRankedEffort(ids(['off', 'low', 'high', 'max'])), 'max')
  // GLM/Kimi shape: stops at high.
  assert.equal(deepestRankedEffort(ids(['off', 'low', 'medium', 'high'])), 'high')
  // Display order is not depth order; rank must not depend on position.
  assert.equal(deepestRankedEffort(ids(['high', 'off', 'medium', 'low'])), 'high')
  // Unranked spellings are never guessed, even alone.
  assert.equal(deepestRankedEffort(ids(['turbo'])), undefined)
  // `off` alone is not worth pinning (pinning off would disable reasoning).
  assert.equal(deepestRankedEffort(ids(['off'])), undefined)
  assert.equal(deepestRankedEffort([]), undefined)
})

test('an absent section config materializes the default policy (regression: undefined section crashed prompt interpolation)', () => {
  const resolved = Config({})
  assert.equal(resolved.effort, 'auto')
  assert.ok(resolved.section.includes('Ultra mode is on'))
  assert.ok(resolved.section.trim().length > 100)
})

test('the default child policy is a worker policy, not the orchestration mandate (regression: children inheriting the mandate recursed workflows without bound)', () => {
  const resolved = Config({})
  // Child text present and substantial.
  assert.ok(resolved.childSection.includes('Ultra mode is on'))
  assert.ok(resolved.childSection.trim().length > 100)
  // The mandate's workflow-by-default instructions must not leak into it.
  assert.ok(!resolved.childSection.includes('use it on every substantive task'))
  assert.ok(!resolved.childSection.includes('one workflow per phase'))
  // The child keeps the workflow tool's default opt-in rule.
  assert.ok(resolved.childSection.includes('opt-in rule stands'))
  // A timed-out wave narrows instead of multiplying.
  assert.ok(resolved.childSection.includes('instead of spawning replacement waves'))
})

/** One synthetic `command/run` event. */
const run = (name, args) => ({
  type: 'command/run',
  data: { commandId: 'cmd-x', name, ...(args === undefined ? {} : { args }), source: { kind: 'user' } },
  seq: 0,
  time: 0,
})
const other = type => ({ type, data: {}, seq: 0, time: 0 })

test('a log without /ultra commands folds inactive', () => {
  assert.equal(foldUltra([other('turn/start'), run('plan', 'off'), other('user/message')]), false)
})

test('/ultra activates; /ultra off deactivates; last one wins', () => {
  assert.equal(foldUltra([run('ultra', '')]), true)
  assert.equal(foldUltra([run('ultra', 'off')]), false)
  assert.equal(foldUltra([run('ultra', ''), run('ultra', 'off')]), false)
  assert.equal(foldUltra([run('ultra', 'off'), run('ultra', ' on ')]), true)
  assert.equal(foldUltra([run('ultra', ''), other('turn/end'), run('ultra', 'off')]), false)
})

test('unrelated commands never flip the state', () => {
  assert.equal(foldUltra([run('ultra', ''), run('plan', ''), run('model', 'x')]), true)
})

test('the end bound excludes the event at that index (pre-switch state)', () => {
  const events = [run('ultra', ''), run('ultra', 'off')]
  assert.equal(foldUltra(events, events.length - 1), true)
  assert.equal(foldUltra(events), false)
})

test('an empty log folds inactive', () => {
  assert.equal(foldUltra([]), false)
})

test('the pre-switch fold excludes the last command only (idempotence base)', () => {
  // A genuine switch: ON when the log was OFF — pre-switch fold must be false,
  // so the handler announces a switch (not "already on") and narrates.
  const events = [run('ultra', 'off'), run('ultra', '')]
  assert.equal(foldUltra(events, events.length - 1), false)
  // A repeat: ON when the log already ended ON — pre-switch fold is true.
  assert.equal(foldUltra([run('ultra', '')], 1), true)
})
