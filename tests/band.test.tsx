// SPDX-License-Identifier: MIT
// Copyright (c) 2026 starkitekt. Doer: live-checklist mod, https://github.com/starkitekt/doer
// Adversarial tests: garbage input, odd timing, failing engine calls, every surface.
// Run with `claude plugin test .` in the repo root.

import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'
type Proc = { exitCode: number; stdout: string } | 'throw'

const SET = 'mcp__live-checklist__set'
const PLAN = 'mcp__ccd_turn__update_plan'
const WRAP = 'mcp__ccd_turn__wrap_up'
const PLUGIN = 'live-checklist'
const PROPS = { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 } } as any
const GREEN = { light: '#127338', dark: '#2DB65F', mid: '#1F934A' }
const MIN = 60_000

type World = {
  theme?: unknown
  configThrows?: boolean
  usage?: { percent?: number } | 'throw'
  agents?: unknown[] | 'throw'
  spawn?: unknown
  git?: (argv: readonly string[]) => Proc
  sync?: { text: string; mtime: number } | null
  plan?: 'ok' | 'error' | 'deny'
}

// The engine beneath the plugin, stubbed call by call. A stub that throws is skipped by the kit,
// so the plugin's call rejects, as a failing engine call would.
async function boot($: $T, on: OnT, w: World = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/t' })
  const proc = (r: Proc) => {
    if (r === 'throw') throw new Error('spawn failed')
    return { value: { ...r, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  }
  on('tool.register', () => ({ value: { tool: SET } }) as any)
  on('session.start', (_, e) => ({ cwd: (e as any).cwd }) as any)
  on('process.run', (_, e) => proc((w.git ?? (() => 'throw' as const))((e as any).argv)) as any)
  on('fs.stat', () => {
    if (!w.sync) throw new Error('ENOENT')
    return { value: { kind: 'file', size: w.sync.text.length, mtimeMs: w.sync.mtime, isLink: false } } as any
  })
  on('fs.read', () => {
    if (!w.sync) throw new Error('ENOENT')
    return { value: w.sync.text } as any
  })
  on('config.list', () => {
    if (w.configThrows) throw new Error('config down')
    return { value: [{ key: 'theme', label: 'Theme', kind: 'string', value: w.theme ?? 'light' }] } as any
  })
  on('session.usage', () => {
    if (w.usage === 'throw') throw new Error('usage down')
    return { value: { startedAt: 0, context: { window: 200_000, ...(w.usage ?? {}) }, rateLimits: [] } } as any
  })
  on('agent.list', () => {
    if (w.agents === 'throw') throw new Error('agents down')
    return { value: w.agents ?? [] } as any
  })
  on('agent.spawn', () => (w.spawn ?? { model: 'claude-haiku-5-5', agentId: 'a1' }) as any)
  // The app's own task list tools, answered as the app would.
  on('tool.call', { tool: PLAN } as any, () =>
    (w.plan === 'deny' ? { deny: 'no' } : w.plan === 'error' ? { result: 'bad', text: 'bad', isError: true } : { result: 'Plan shown.' }) as any)
  on('tool.call', { tool: WRAP } as any, () => ({ result: 'Wrapped.' }) as any)
  // What the engine draws when the plugin hands the band back.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e) as any
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as any)
  await clock.settle()
  const set = async (input: object) => ((await $.tool.call({ tool: SET, ...input } as any)) as any)?.result as string
  const plan = async (input: object) => (await $.tool.call({ tool: PLAN, ...input } as any)) as any
  const wrap = async () => (await $.tool.call({ tool: WRAP, recap: 'r' } as any)) as any
  const draw = async (surface: Surface = 'desktop', props: object = {}) => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...PROPS, ...props } })
    const texts = (await ui.findAll({ type: 'Text' } as any)).map(t => ({ text: t.text, color: t.props.color }))
    const svgs = surface === 'terminal' ? [] : (await ui.findAll({ type: 'Svg' } as any)).map(s => String(s.props.alt))
    await ui.unmount()
    const all = texts.map(t => t.text)
    return { texts, svgs, all, color: (text: string) => texts.find(t => t.text === text)?.color }
  }
  return { clock, set, plan, wrap, draw }
}

const step = (text: string, status: string, extra: object = {}) => ({ text, status, ...extra })

// ---- Input ----------------------------------------------------------------------------------

test('payloads with no usable steps clear the band and never throw', async ($, on) => {
  const { set, draw } = await boot($, on)
  const junk: object[] = [
    {},
    { items: 'nope' },
    { items: null },
    { items: { 0: step('a', 'done') } },
    { items: [null, 1, 'str', [], true] },
    { items: [{}] },
    { items: [{ status: 'done' }] },
    { items: [step('   ', 'active')] },
    { items: [step('\n\t', 'done')] },
    { items: [{ text: { nested: 1 }, status: 'done' }] },
    { items: [{ text: ['a', 'b'], status: 'done' }] },
    { items: [{ text: null, status: 'pending' }] },
  ]
  for (const input of junk) {
    await set({ title: 'Seed', items: [step('seed', 'pending')] })
    expect(await set(input)).toBe('Checklist cleared.')
    expect((await draw()).all).toEqual(['engine'])
  }
})

test('a number as step text is kept as its digits', async ($, on) => {
  const { set, draw } = await boot($, on)
  await set({ title: 'T', items: [{ text: 42, status: 'pending' }] })
  expect((await draw()).all).toContain('42')
})

test('long text and titles are capped, and kept on one line', async ($, on) => {
  const { set, draw } = await boot($, on)
  await set({ title: 'Title\nwith\r\nbreaks ' + 'T'.repeat(5000), items: [step('line one\nline two\t' + 'x'.repeat(10_000), 'pending')] })
  const { all } = await draw()
  const title = all[0] ?? ''
  const row = all.find(t => t.startsWith('line')) ?? ''
  expect(title.length).toBeLessThanOrEqual(120)
  expect(row.length).toBeLessThanOrEqual(200)
  expect(title).toStartWith('Title with breaks')
  expect(row).toStartWith('line one line two x')
  for (const t of all) expect(t).not.toMatch(/[\r\n\t]/)
})

test('an empty, blank or non-text title reads Tasks; a number is kept', async ($, on) => {
  const { set, draw } = await boot($, on)
  for (const title of ['', '   ', NaN, null, { a: 1 }, ['x'], undefined]) {
    await set({ title, items: [step('a', 'pending')] })
    expect((await draw()).all[0]).toBe('Tasks')
  }
  await set({ title: 42, items: [step('a', 'pending')] })
  expect((await draw()).all[0]).toBe('42')
})

test('an unknown status counts as not started', async ($, on) => {
  const { set } = await boot($, on)
  const r = await set({ title: 'T', items: [step('a', 'DONE'), step('b', 'finished'), { text: 'c', status: 7 }, step('d', 'done')] })
  expect(r).toBe('Checklist shown: 1/4 done.')
})

test('a thousand steps: last 3 done, next 7, and notes count the rest', async ($, on) => {
  const { set, draw } = await boot($, on)
  const items = [...Array.from({ length: 500 }, (_, n) => step(`done ${n}`, 'done')), ...Array.from({ length: 500 }, (_, n) => step(`todo ${n}`, 'pending'))]
  expect(await set({ title: 'Big', items })).toBe('Checklist shown: 500/1000 done.')
  const { all } = await draw()
  expect(all).toContain('497 earlier done')
  expect(all).toContain('+493 more')
  expect(all.filter(t => /^(done|todo) \d+$/.test(t))).toEqual(['done 497', 'done 498', 'done 499', ...Array.from({ length: 7 }, (_, n) => `todo ${n}`)])
})

test('model names shorten, and a blank one falls back', async ($, on) => {
  const { set, draw } = await boot($, on)
  await set({
    title: 'T',
    items: [
      step('a', 'pending', { model: 'claude-sonnet-5-5' }),
      step('b', 'pending', { model: 'HAIKU' }),
      step('c', 'pending', { model: '  some-very-long-model  ' }),
      step('d', 'pending', { model: '   ' }),
      step('e', 'pending', { model: 12 }),
    ],
  })
  const { all } = await draw()
  for (const m of ['Sonnet', 'Haiku', 'some-ver']) expect(all).toContain(m)
})

test('a goal is trimmed, capped, single-line, and ignored when not a string', async ($, on) => {
  const { set, draw } = await boot($, on)
  await set({ title: 'T', items: [step('a', 'active', { goal: '  why\nit breaks ' + 'g'.repeat(500) })] })
  const solving = (await draw()).all.find(t => t.startsWith('Solving: ')) ?? ''
  expect(solving).toStartWith('Solving: why it breaks g')
  expect(solving.length).toBeLessThanOrEqual('Solving: '.length + 160)
  await set({ title: 'T2', items: [step('b', 'active', { goal: { x: 1 } })] })
  expect((await draw()).all.some(t => t.startsWith('Solving: '))).toBe(false)
})

test('a goal shows only while its step is active', async ($, on) => {
  const { set, draw } = await boot($, on)
  await set({ title: 'T', items: [step('a', 'done', { goal: 'g1' }), step('b', 'active', { goal: 'g2' }), step('c', 'pending', { goal: 'g3' }), step('d', 'wait', { goal: 'g4' })] })
  expect((await draw()).all.filter(t => t.startsWith('Solving: '))).toEqual(['Solving: g2'])
})

// ---- Step identity and timing ---------------------------------------------------------------

test('a new list does not inherit the old list goals, models or timers', async ($, on) => {
  const { set, draw, clock } = await boot($, on)
  await set({ title: 'Alpha', items: [step('Find leak', 'active', { goal: 'old problem', model: 'Opus' })] })
  await clock.advance(10 * MIN)
  await set({ title: 'Beta', items: [step('Write docs', 'active')] })
  const during = await draw()
  expect(during.all).not.toContain('Solving: old problem')
  expect(during.all).not.toContain('Opus')
  await clock.advance(2 * MIN)
  await set({ title: 'Beta', items: [step('Write docs', 'done')] })
  expect((await draw()).all).toContain('0 T / 2m')
})

test('a renamed step in the same list keeps its start', async ($, on) => {
  const { set, draw, clock } = await boot($, on)
  await set({ title: 'T', items: [step('Fix bug', 'active')] })
  await clock.advance(3 * MIN)
  await set({ title: 'T', items: [step('Fix the bug', 'active')] })
  await clock.advance(2 * MIN)
  await set({ title: 'T', items: [step('Fix the bug', 'done')] })
  expect((await draw()).all).toContain('0 T / 5m')
})

test('steps with the same text keep their own times', async ($, on) => {
  const { set, draw, clock } = await boot($, on)
  await set({ title: 'T', items: [step('Run tests', 'active'), step('Run tests', 'pending')] })
  await clock.advance(1 * MIN)
  await set({ title: 'T', items: [step('Run tests', 'done'), step('Run tests', 'active')] })
  await clock.advance(3 * MIN)
  await set({ title: 'T', items: [step('Run tests', 'done'), step('Run tests', 'done')] })
  const stats = (await draw()).all.filter(t => t.includes(' T / '))
  expect(stats).toEqual(['0 T / 1m', '0 T / 3m'])
})

test('a reordered list keeps each step its own start', async ($, on) => {
  const { set, draw, clock } = await boot($, on)
  await set({ title: 'T', items: [step('X', 'active'), step('Y', 'pending')] })
  await clock.advance(2 * MIN)
  await set({ title: 'T', items: [step('Y', 'active'), step('X', 'done')] })
  await clock.advance(5 * MIN)
  await set({ title: 'T', items: [step('Y', 'done'), step('X', 'done')] })
  expect((await draw()).all.filter(t => t.includes(' T / '))).toEqual(['0 T / 5m', '0 T / 2m'])
})

test('a step done without going active times from the last update', async ($, on) => {
  const { set, draw, clock } = await boot($, on)
  await set({ title: 'T', items: [step('A', 'pending')] })
  await clock.advance(4 * MIN)
  await set({ title: 'T', items: [step('A', 'done')] })
  expect((await draw()).all).toContain('0 T / 4m')
})

test('resending a done step keeps its numbers, and the run total adds up', async ($, on) => {
  const { set, draw, clock } = await boot($, on)
  await set({ title: 'T', items: [step('A', 'active'), step('B', 'pending')] })
  await clock.advance(2 * MIN)
  await set({ title: 'T', items: [step('A', 'done'), step('B', 'active')] })
  await clock.advance(3 * MIN)
  await set({ title: 'T', items: [step('A', 'done'), step('B', 'done')] })
  await clock.advance(10 * MIN)
  await set({ title: 'T', items: [step('A', 'done'), step('B', 'done')] })
  const { all } = await draw()
  expect(all.filter(t => t.includes(' T / '))).toEqual(['0 T / 2m', '0 T / 3m'])
  expect(all).toContain('5m · 0 T')
})

// ---- Header: context gauge ------------------------------------------------------------------

test('the context gauge colour matches the number it shows', async ($, on) => {
  const cases: [number, string, string][] = [
    [0, 'Context 0%', 'grey'],
    [74.4, 'Context 74%', 'grey'],
    [74.6, 'Context 75%', 'warning'],
    [84.4, 'Context 84%', 'warning'],
    [84.5, 'Context 85%', 'error'],
    [100, 'Context 100%', 'error'],
    [250, 'Context 100%', 'error'],
    [-3, 'Context 0%', 'grey'],
  ]
  const world: World = {}
  const { set, draw } = await boot($, on, world)
  await set({ title: 'T', items: [step('a', 'pending')] })
  for (const [percent, label, tone] of cases) {
    world.usage = { percent }
    const d = await draw()
    expect(d.all).toContain(label)
    const c = d.color(label)
    if (tone === 'grey') expect(String(c)).toStartWith('#')
    else expect(c).toBe(tone)
  }
})

test('no gauge when the percent is missing, not a number, or usage fails', async ($, on) => {
  const world: World = {}
  const { set, draw } = await boot($, on, world)
  await set({ title: 'T', items: [step('a', 'pending')] })
  for (const usage of [{}, { percent: NaN }, { percent: Infinity }, 'throw'] as World['usage'][]) {
    world.usage = usage
    const { all } = await draw()
    expect(all[0]).toBe('T')
    expect(all.some(t => t.startsWith('Context'))).toBe(false)
  }
})

// ---- Header: git chip -----------------------------------------------------------------------

const SHA = 'a'.repeat(40)
const porcelain = (lines: string[]) => ({ exitCode: 0, stdout: lines.join('\n') + '\n' })
const head = (extra: string[] = [], upstream = true) => [
  `# branch.oid ${SHA}`,
  '# branch.head main',
  ...(upstream ? ['# branch.upstream origin/main', '# branch.ab +0 -0'] : []),
  ...extra,
]
const gitWorld = (status: Proc, gh: Proc = 'throw', remote: Proc = { exitCode: 0, stdout: 'origin\n' }) => (argv: readonly string[]): Proc =>
  argv[0] === 'gh' ? gh : argv[1] === 'remote' ? remote : status

const GIT_CASES: { name: string; run: (argv: readonly string[]) => Proc; label: string | null; tone?: string }[] = [
  { name: 'not a repo', run: gitWorld({ exitCode: 128, stdout: '' }), label: 'No repo' },
  { name: 'git missing', run: () => 'throw', label: null },
  { name: 'conflicts beat everything', run: gitWorld(porcelain(head(['u UU N... 100644 100644 100644 100644 x y z f', '1 .M N... a']))), label: 'main · Conflicts', tone: 'error' },
  { name: 'unpushed', run: gitWorld(porcelain([`# branch.oid ${SHA}`, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1'])), label: 'main · 2 unpushed' },
  { name: 'changed', run: gitWorld(porcelain(head(['1 .M N... a', '2 R. N... b', '? c', '! ignored']))), label: 'main · 3 changed' },
  { name: 'no remote', run: gitWorld(porcelain(head([], false)), 'throw', { exitCode: 0, stdout: '' }), label: 'main · no remote' },
  { name: 'fresh repo, no commits', run: gitWorld(porcelain(['# branch.oid (initial)', '# branch.head main']), 'throw', { exitCode: 0, stdout: '' }), label: 'main · no remote' },
  { name: 'local branch of a repo with a remote', run: gitWorld(porcelain(head([], false))), label: 'main · clean', tone: GREEN.light },
  { name: 'detached', run: gitWorld(porcelain([`# branch.oid ${SHA}`, '# branch.head (detached)'])), label: 'aaaaaaa · clean' },
  { name: 'CRLF output', run: gitWorld({ exitCode: 0, stdout: head(['1 .M N... a']).join('\r\n') + '\r\n' }), label: 'main · 1 changed' },
  { name: 'checks failing', run: gitWorld(porcelain(head()), { exitCode: 0, stdout: '[{"status":"completed","conclusion":"success"},{"status":"completed","conclusion":"failure"}]' }), label: 'main · Checks failing', tone: 'error' },
  { name: 'checks running', run: gitWorld(porcelain(head()), { exitCode: 0, stdout: '[{"status":"in_progress"}]' }), label: 'main · Checks running' },
  { name: 'gh not signed in', run: gitWorld(porcelain(head()), { exitCode: 1, stdout: '' }), label: 'main · clean' },
  { name: 'gh garbage', run: gitWorld(porcelain(head()), { exitCode: 0, stdout: '<html>rate limited' }), label: 'main · clean' },
  { name: 'gh an object', run: gitWorld(porcelain(head()), { exitCode: 0, stdout: '{"runs":[]}' }), label: 'main · clean' },
  { name: 'gh nulls', run: gitWorld(porcelain(head()), { exitCode: 0, stdout: '[null, 3, "x"]' }), label: 'main · clean' },
]

for (const c of GIT_CASES) {
  test(`git chip: ${c.name}`, async ($, on) => {
    const { set, draw } = await boot($, on, { git: c.run })
    await set({ title: 'T', items: [step('a', 'pending')] })
    const d = await draw()
    expect(d.all[0]).toBe('T')
    const chip = d.texts.find(t => / · |^No repo$/.test(t.text) && !t.text.includes(' T'))
    if (c.label === null) expect(chip).toBeUndefined()
    else {
      expect(chip?.text).toBe(c.label)
      if (c.tone) expect(chip?.color).toBe(c.tone)
    }
  })
}

// ---- Header: sync counter -------------------------------------------------------------------
// Every case uses the same mtime, so a counter cached from an earlier session would show up as a miss.

const SYNC_CASES: { name: string; text: string | null; shows: string | null; alert?: boolean }[] = [
  { name: 'missing file', text: null, shows: null },
  { name: 'last sync failed', text: '3 1 fail', shows: '3 pushed · 1 failed', alert: true },
  { name: 'padding and newline', text: '  7 0 ok\n', shows: '7 pushed · 0 failed' },
  { name: 'garbage', text: 'hello world', shows: null },
  { name: 'empty', text: '', shows: null },
  { name: 'one number', text: '5', shows: null },
  { name: 'negative', text: '-2 -1 ok', shows: null },
]

for (const c of SYNC_CASES) {
  test(`sync counter: ${c.name}`, async ($, on) => {
    const { set, draw } = await boot($, on, { sync: c.text === null ? null : { text: c.text, mtime: 5 } })
    await set({ title: 'T', items: [step('a', 'pending')] })
    const d = await draw()
    const counter = d.texts.find(t => t.text.includes('pushed'))
    if (c.shows === null) expect(counter).toBeUndefined()
    else {
      expect(counter?.text).toBe(c.shows)
      if (c.alert) expect(counter?.color).toBe('error')
    }
  })
}

test('the sync counter follows the file as it changes', async ($, on) => {
  const world: World = { sync: { text: '1 0 ok', mtime: 10 } }
  const { set, draw, clock } = await boot($, on, world)
  await set({ title: 'T', items: [step('a', 'pending')] })
  expect((await draw()).all).toContain('1 pushed · 0 failed')
  world.sync = { text: '2 0 ok', mtime: 20 }
  await clock.advance(4000)
  expect((await draw()).all).toContain('2 pushed · 0 failed')
  world.sync = null
  await clock.advance(4000)
  expect((await draw()).all.some(t => t.includes('pushed'))).toBe(false)
})

// ---- Solving line from subagents ------------------------------------------------------------

const agent = (id: string, description: string, extra: object = {}) => ({ id, description, type: 'general-purpose', status: 'running', ...extra })

test('without a goal, the line names a running subagent on the step model', async ($, on) => {
  const world: World = { spawn: { model: 'claude-haiku-5-5', agentId: 'a1' } }
  const { set, draw } = await boot($, on, world)
  await $.agent.spawn({ prompt: 'p', description: 'band misses steps' })
  world.agents = [agent('a1', 'band misses steps')]
  await set({ title: 'T', items: [step('x', 'active', { model: 'Haiku' }), step('y', 'active', { model: 'Opus' })] })
  expect((await draw()).all.filter(t => t.startsWith('Solving: '))).toEqual(['Solving: band misses steps'])
})

test('finished, nested and unknown subagents are not named', async ($, on) => {
  const world: World = { spawn: { model: 'claude-haiku-5-5', agentId: 'a1' } }
  const { set, draw } = await boot($, on, world)
  await $.agent.spawn({ prompt: 'p', description: 'd' })
  world.agents = [agent('a1', 'done one', { status: 'completed' }), agent('a1', 'nested', { parentId: 'p' }), agent('zz', 'stranger')]
  await set({ title: 'T', items: [step('x', 'active', { model: 'Haiku' })] })
  expect((await draw()).all.some(t => t.startsWith('Solving: '))).toBe(false)
})

test('a refused spawn passes through untouched and is not recorded', async ($, on) => {
  const world: World = { spawn: { deny: 'not allowed' } }
  const { set, draw } = await boot($, on, world)
  const r = await $.agent.spawn({ prompt: 'p', description: 'd' }).catch(err => ({ deny: String(err) }))
  expect(JSON.stringify(r)).toContain('not allowed')
  world.agents = [agent('a1', 'ghost')]
  await set({ title: 'T', items: [step('x', 'active', { model: 'Haiku' })] })
  expect((await draw()).all.some(t => t.startsWith('Solving: '))).toBe(false)
})

test('a failing agent list still draws the band', async ($, on) => {
  const { set, draw } = await boot($, on, { agents: 'throw' })
  await set({ title: 'T', items: [step('x', 'active')] })
  expect((await draw()).all).toContain('x')
})

// ---- Theme and surfaces ---------------------------------------------------------------------

test('the palette follows the theme, and a broken config gets the middle one', async ($, on) => {
  const cases: [World, string][] = [
    [{ theme: 'dark-daltonized' }, GREEN.dark],
    [{ theme: 'light-ansi' }, GREEN.light],
    [{ theme: { odd: 1 } }, GREEN.mid],
    [{ theme: 'auto' }, GREEN.mid],
    [{ configThrows: true }, GREEN.mid],
  ]
  const world: World = {}
  const { set, draw } = await boot($, on, world)
  await set({ title: 'T', items: [step('finished', 'done')] })
  for (const [w, green] of cases) {
    Object.assign(world, { theme: undefined, configThrows: false }, w)
    expect((await draw()).color('finished')).toBe(green)
  }
})

test('every surface draws the band; the terminal uses text marks', async ($, on) => {
  const { set, draw } = await boot($, on)
  await set({ title: 'T', items: [step('a', 'done'), step('b', 'active'), step('c', 'pending'), step('d', 'wait')] })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const d = await draw(surface)
    expect(d.all[0]).toBe('T')
    for (const t of ['a', 'b', 'c', 'd']) expect(d.all).toContain(t)
    if (surface === 'terminal') {
      for (const mark of ['✓', '◌', '○', 'in progress']) expect(d.all).toContain(mark)
    }
  }
})

test('a survey or an empty list hands the band back to the engine', async ($, on) => {
  const { set, draw } = await boot($, on)
  expect((await draw()).all).toEqual(['engine'])
  await set({ title: 'T', items: [step('a', 'pending')] })
  expect((await draw('desktop', { hasSurvey: true })).all).toEqual(['engine'])
  expect(await set({ title: 'T', items: [] })).toBe('Checklist cleared.')
  expect((await draw()).all).toEqual(['engine'])
})

// ---- The app's task list ---------------------------------------------------------------------

const P = (content: string, status: string) => ({ content, status })
// Each row's state, read from its glyph: Done, In progress, Not started.
const states = (svgs: string[]) => svgs.filter(a => a !== 'in progress')

test("the app's task list fills the band, in the band's words", async ($, on) => {
  const { plan, draw } = await boot($, on)
  const r = await plan({ items: [P('Read code', 'completed'), P('Fix it', 'in_progress'), P('Test', 'pending'), P('Odd', 'weird')], scope: 'first_task' })
  expect(r.result).toBe('Plan shown.')
  const d = await draw()
  expect(d.all[0]).toBe('Tasks')
  expect(states(d.svgs)).toEqual(['Done', 'In progress', 'Not started', 'Not started'])
})

test('advance, done and start move the steps as the app does', async ($, on) => {
  const { plan, clock, draw } = await boot($, on)
  await plan({ items: [P('a', 'in_progress'), P('b', 'pending'), P('c', 'pending'), P('d', 'pending')] })
  await clock.advance(2 * MIN)
  await plan({ advance: true })
  expect(states((await draw()).svgs)).toEqual(['Done', 'In progress', 'Not started', 'Not started'])
  expect((await draw()).all.some(t => t.endsWith('/ 2m'))).toBe(true)
  await plan({ done: [2, 3], start: 4 })
  expect(states((await draw()).svgs)).toEqual(['Done', 'Done', 'Done', 'In progress'])
  // Out of range or junk numbers change nothing.
  await plan({ done: [0, 9, 'x', 1.5], start: -1 })
  expect(states((await draw()).svgs)).toEqual(['Done', 'Done', 'Done', 'In progress'])
})

test('wrap_up checks off the step still running', async ($, on) => {
  const { plan, wrap, draw } = await boot($, on)
  await plan({ items: [P('a', 'completed'), P('b', 'in_progress')] })
  expect((await wrap()).result).toBe('Wrapped.')
  expect(states((await draw()).svgs)).toEqual(['Done', 'Done'])
})

test('after set, ticking the app list still finishes steps and shows their tokens', async ($, on) => {
  const { set, plan, wrap, clock, draw } = await boot($, on)
  await set({ title: 'Mine', items: [step('own step', 'active', { goal: 'Steps look wrong' }), step('next', 'pending')] })
  expect((await draw()).all).toContain('Solving: Steps look wrong')
  await clock.advance(2 * MIN)
  await plan({ advance: true })
  let d = await draw()
  expect(d.all[0]).toBe('Mine')
  expect(states(d.svgs)).toEqual(['Done', 'In progress'])
  expect(d.all.some(t => t.endsWith('/ 2m'))).toBe(true)
  await wrap()
  expect(states((await draw()).svgs)).toEqual(['Done', 'Done'])
  // A new app list takes the band over, under the same title.
  await plan({ items: [P('other', 'in_progress')] })
  d = await draw()
  expect(d.all[0]).toBe('Mine')
  expect(d.all).toContain('other')
  expect(d.all).not.toContain('own step')
})

test('a refused or failed app list, junk, or a step move with no list leaves the band alone', async ($, on) => {
  const world: World = {}
  const { plan, wrap, draw } = await boot($, on, world)
  expect((await plan({ advance: true })).result).toBe('Plan shown.')
  await wrap()
  expect((await draw()).all).toEqual(['engine'])
  await plan({ items: [P('kept', 'pending')] })
  for (const mode of ['deny', 'error'] as const) {
    world.plan = mode
    const r = await plan({ items: [P('lost', 'pending')] })
    expect(mode === 'deny' ? r.deny : r.isError).toBeTruthy()
  }
  world.plan = 'ok'
  for (const junk of [{ items: 'x' }, { items: [null, 3, { status: 'pending' }] }, { done: 'all' }, {}]) await plan(junk)
  const d = await draw()
  expect(d.all).toContain('kept')
  expect(d.all).not.toContain('lost')
})

test('a new app list keeps the time of a step it carries over', async ($, on) => {
  const { plan, clock, draw } = await boot($, on)
  await plan({ items: [P('a', 'in_progress'), P('b', 'pending')] })
  await clock.advance(3 * MIN)
  await plan({ items: [P('a', 'completed'), P('b', 'in_progress'), P('c', 'pending')] })
  expect((await draw()).all.some(t => t.endsWith('/ 3m'))).toBe(true)
})

// ---- Wording --------------------------------------------------------------------------------

test('a prompt with a task list tool is told to word steps as the problem, once', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }) as any)
  await boot($, on)
  const compose = async (tools: string[]) =>
    ((await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools, outputStyle: null, traits: [] } as any)) as any).sections as { id: string; text: string }[]
  const ids = async (tools: string[]) => (await compose(tools)).map(s => s.id)
  expect(await ids([PLAN])).toEqual(['intro', 'live-checklist:wording'])
  expect(await ids([SET, PLAN])).toEqual(['intro', 'live-checklist:wording'])
  expect(await ids(['Bash'])).toEqual(['intro'])
  expect((await compose([SET]))[1]?.text).toContain('never what you will do')
})
