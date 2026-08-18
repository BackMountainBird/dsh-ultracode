/**
 * Offline self-check: foldUltra semantics over synthetic session logs.
 * Run with `node scripts/verify.mjs` (zero dependencies).
 * @module dsh-ultra/verify
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { foldUltra, Config } from '../lib/index.js'

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
