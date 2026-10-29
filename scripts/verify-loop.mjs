/** Exercise ultra against the released DSH loop, without network requests. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as Ultra from '../lib/index.js'

class Adapter extends LlmAdapter {
  requests = []
  async resolveModel(provider, model) {
    if (model === 'plain') return { provider, id: model, name: model }
    return { provider, id: model, name: model, reasoning: {
      efforts: ['low', model === 'small' ? 'high' : 'max'].map(id => ({ id, name: id })),
      defaultEffort: 'low',
    } }
  }
  async * stream(request) {
    this.requests.push(request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture(t, config = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, NativeToolExecutor, AgentRegistry, CommandRuntime]) {
    await ctx.plugin(plugin)
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  const ultraFiber = await ctx.plugin(Ultra, config)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('ultra-integration'), { provider: 'mock', model: 'large' })
  return { ctx, agent, adapter, ultraFiber }
}

const prompt = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const activate = agent => agent.session.append('command/run', { commandId: 'ultra-test', name: 'ultra', args: '', source: { kind: 'user' } })
const command = (ctx, agent, line) => ctx.commands.execute(agent, line, [], new AbortController().signal)
const send = async (agent, text) => { agent.followup(prompt(text)); await agent.whenIdle() }

test('ultra sends pinned requests through the real loop and survives manual model changes', { timeout: 10000 }, async t => {
  const { agent, adapter } = await fixture(t)
  activate(agent)
  agent.followup(prompt('first task'))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 1, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')))
  assert.equal(adapter.requests[0].reasoningEffort, 'max')
  assert.ok(adapter.requests[0].messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('first task'))))
  agent.model.select({ provider: 'mock', model: 'small', reasoningEffort: 'low' })
  agent.followup(prompt('second task'))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 2)
  assert.equal(adapter.requests[1].model, 'small')
  assert.equal(adapter.requests[1].reasoningEffort, 'high')
  assert.ok(adapter.requests[1].messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('second task'))))
})

test('commands update the durable selection and /ultra off restores adapter defaults', async t => {
  const { ctx, agent, adapter } = await fixture(t)
  const on = await command(ctx, agent, '/ultra')
  assert.equal(on.result.kind, 'success')
  assert.equal(agent.model.current().reasoningEffort, 'max')
  await send(agent, 'active')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'max')
  assert.equal((await command(ctx, agent, '/ultra off')).result.kind, 'success')
  assert.equal(agent.model.current().reasoningEffort, undefined)
  await send(agent, 'inactive')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'low')
  assert.equal(adapter.requests.length, 2)
})

test('correcting a captured selection preserves separate queued followup turns', async t => {
  const { agent, adapter } = await fixture(t)
  activate(agent)
  agent.followup(prompt('TASK A'))
  agent.followup(prompt('TASK B'))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 2)
  const texts = request => request.messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  assert.ok(texts(adapter.requests[0]).includes('TASK A'))
  assert.ok(!texts(adapter.requests[0]).includes('TASK B'))
  assert.equal(texts(adapter.requests[1]).filter(text => text === 'TASK A').length, 1)
  assert.equal(texts(adapter.requests[1]).filter(text => text === 'TASK B').length, 1)
})

test('fixed efforts stay fixed and unsupported selections fail without sending a request', async t => {
  const { ctx, agent, adapter } = await fixture(t, { effort: 'low' })
  assert.equal((await command(ctx, agent, '/ultra')).result.kind, 'success')
  await send(agent, 'fixed effort')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'low')
  agent.model.select({ provider: 'mock', model: 'plain' })
  await send(agent, 'unsupported effort')
  assert.equal(adapter.requests.length, 1)
  assert.match(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.error.message, /does not declare effort low/)
})

test('auto leaves models without reasoning metadata usable', async t => {
  const { ctx, agent, adapter } = await fixture(t)
  agent.model.select({ provider: 'mock', model: 'plain' })
  assert.equal((await command(ctx, agent, '/ultra')).result.kind, 'success')
  await send(agent, 'no reasoning')
  assert.equal(adapter.requests.length, 1)
  assert.equal(adapter.requests[0].reasoningEffort, undefined)
})

test('spawned children inherit their own model effort while empty forks remain independent', async t => {
  const { ctx, agent: parent, adapter } = await fixture(t)
  await command(ctx, parent, '/ultra')
  const createChild = async (id, isSeeded) => (await ctx.agents.create({
    sessionId: SessionId(id), parentAgent: parent,
    agentOptions: { provider: 'mock', model: 'small' },
    meta: { parentSession: parent.id, delegationDepth: 1, origin: 'subagent', isSeeded },
    ...(isSeeded ? { seed: [], inheritedEventCount: 0 } : {}),
  })).agent
  const child = await createChild('ultra-spawn', false)
  assert.equal(child.model.current().reasoningEffort, 'high')
  const fork = await createChild('ultra-fork', true)
  assert.equal(fork.model.current().reasoningEffort, undefined)
  await send(child, 'delegated task')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'high')
  await command(ctx, parent, '/ultra off')
  await send(child, 'parent switched off')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'low')
  await send(fork, 'independent fork')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'low')
})

test('pin ownership survives plugin reload and preserves later manual selections', async t => {
  const { ctx, agent: parent, adapter, ultraFiber } = await fixture(t)
  await command(ctx, parent, '/ultra')
  const { agent: child } = await ctx.agents.create({
    sessionId: SessionId('reload-child'), parentAgent: parent,
    agentOptions: { provider: 'mock', model: 'small' },
    meta: { parentSession: parent.id, delegationDepth: 1, origin: 'subagent' },
  })
  await send(child, 'before reload')
  await ultraFiber.dispose()
  await ctx.plugin(Ultra)
  await command(ctx, parent, '/ultra off')
  await send(child, 'after reload')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'low')
  await command(ctx, parent, '/ultra')
  await send(child, 'pin again')
  child.model.select({ provider: 'mock', model: 'small', reasoningEffort: 'low' })
  await command(ctx, parent, '/ultra off')
  await send(child, 'keep manual choice')
  assert.equal(child.model.current().reasoningEffort, 'low')
})

test('replayed child history releases a persisted pin after the parent exits ultra', async t => {
  const { ctx, agent: parent, adapter } = await fixture(t)
  await command(ctx, parent, '/ultra')
  const options = {
    sessionId: SessionId('replayed-child'), parentAgent: parent,
    agentOptions: { provider: 'mock', model: 'small' },
    meta: { parentSession: parent.id, delegationDepth: 1, origin: 'subagent', isSeeded: false },
  }
  const handle = await ctx.agents.create(options)
  await send(handle.agent, 'before restoring history')
  const seed = handle.agent.session.snapshotEvents()
  await handle.dispose()
  await command(ctx, parent, '/ultra off')
  const restored = await ctx.agents.create({ ...options, seed })
  assert.equal(restored.agent.model.current().reasoningEffort, undefined)
  await send(restored.agent, 'restored task')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'low')
})

test('switching off while prompt assembly is waiting re-prepares before sending', async t => {
  const { ctx, agent, adapter } = await fixture(t)
  await command(ctx, agent, '/ultra')
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  let first = true
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    if (first) {
      first = false
      entered.resolve()
      await release.promise
    }
    return next()
  })
  agent.followup(prompt('OFF RACE'))
  await entered.promise
  await command(ctx, agent, '/ultra off')
  release.resolve()
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 1)
  assert.equal(adapter.requests[0].reasoningEffort, 'low')
})
