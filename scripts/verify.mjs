/**
 * Offline self-check: foldUltra semantics over synthetic session logs.
 * Run with `node scripts/verify.mjs` (zero dependencies).
 * @module dsh-ultra/verify
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { foldUltra, chainUltra, deepestRankedEffort, Config } from '../lib/index.js'

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
