// SPDX-License-Identifier: MIT
// Copyright (c) 2026 starkitekt. Doer: live-checklist mod, https://github.com/starkitekt/Doer
// Keep this notice in all copies and derived works (MIT License, see LICENSE).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentModels, Git, Item, List, Meter, Status, Sync } from '../types'

const list = atom({ plugin: 'live-checklist', key: 'list' } as const, null)
const isOpen = atom({ plugin: 'live-checklist', key: 'isOpen' } as const, true)
const meter = atom({ plugin: 'live-checklist', key: 'meter' } as const, { tokens: 0, model: '' } as Meter)
const git = atom({ plugin: 'live-checklist', key: 'git' } as const, null as Git | null)
const sync = atom({ plugin: 'live-checklist', key: 'sync' } as const, null as Sync | null)
const agentModels = atom({ plugin: 'live-checklist', key: 'agentModels' } as const, {} as AgentModels)

// The repo's one most urgent state, in this order: conflicts, checks failing, checks running,
// unpushed commits, changed files, no remote, else clean. 'No repo' outside a git repo. Read-only: it runs
// git status and, once the last commit is pushed, gh for its CI runs (skipped if gh is missing).
type Run = (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string }>
const readGit = async (run: Run): Promise<Git | null> => {
  const st = await run(['git', 'status', '--porcelain=v2', '--branch'], 5000)
  if (st.exitCode !== 0) return { label: 'No repo', tone: 'quiet' }
  let branch = ''
  let sha = ''
  let ahead = 0
  let hasUpstream = false
  let changed = 0
  let conflicts = 0
  for (const line of st.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14).trim()
    else if (line.startsWith('# branch.oid ')) sha = line.slice(13).trim()
    else if (line.startsWith('# branch.upstream ')) hasUpstream = true
    else if (line.startsWith('# branch.ab ')) ahead = Math.abs(parseInt(line.slice(12), 10)) || 0
    else if (line.startsWith('u ')) conflicts++
    else if (/^[12?] /.test(line)) changed++
  }
  const where = branch === '(detached)' || !branch ? sha.slice(0, 7) || 'git' : branch
  const say = (state: string, tone: Git['tone']): Git => ({ label: `${where} · ${state}`, tone })
  if (conflicts) return say('Conflicts', 'alert')
  // CI only knows commits that are pushed.
  if (hasUpstream && ahead === 0 && /^[0-9a-f]{40}$/.test(sha)) {
    try {
      const ci = await run(['gh', 'run', 'list', '--commit', sha, '--json', 'status,conclusion', '--limit', '30'], 8000)
      if (ci.exitCode === 0) {
        const runs = JSON.parse(ci.stdout) as { status?: string; conclusion?: string }[]
        if (runs.some(r => r.status === 'completed' && ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion ?? '')))
          return say('Checks failing', 'alert')
        if (runs.some(r => r.status !== 'completed')) return say('Checks running', 'quiet')
      }
    } catch {
      // No gh, not signed in, or no network: the chip goes on without CI.
    }
  }
  if (ahead) return say(`${ahead} unpushed`, 'quiet')
  if (changed) return say(`${changed} changed`, 'quiet')
  // A repo with no remote has nowhere to push to: say so instead of 'clean'.
  if (!hasUpstream) {
    const rm = await run(['git', 'remote'], 5000).catch(() => undefined)
    if (rm?.exitCode === 0 && !rm.stdout.trim()) return say('no remote', 'quiet')
  }
  return say('clean', 'ok')
}

// 'claude-opus-5-5' -> 'Opus'. Anything unrecognised is kept, cut to 8 characters.
const shortModel = (m: string) => {
  const hit = /opus|sonnet|haiku|fable/i.exec(m)
  if (hit) return hit[0].charAt(0).toUpperCase() + hit[0].slice(1).toLowerCase()
  return m.trim().slice(0, 8)
}
const fmtTok = (n: number) =>
  n < 1000 ? String(n) : n < 1e6 ? `${+(n / 1e3).toFixed(1)}k` : `${+(n / 1e6).toFixed(1)}M`
const fmtTime = (ms: number) => {
  const m = ms / 60000
  return m < 1 ? '<1m' : m < 60 ? `${Math.round(m)}m` : `${+(m / 60).toFixed(1)}h`
}
const stats = (i: Item) =>
  i.status === 'done' && i.tokens !== undefined && i.ms !== undefined ? `${fmtTok(i.tokens)} T / ${fmtTime(i.ms)}` : ''
// The whole list so far: time and tokens of every done step added up. Empty until one is done.
const runTotal = (items: Item[]) => {
  const done = items.filter(i => i.status === 'done' && i.tokens !== undefined && i.ms !== undefined)
  if (!done.length) return ''
  const sum = (f: (i: Item) => number) => done.reduce((n, i) => n + f(i), 0)
  return `${fmtTime(sum(i => i.ms ?? 0))} · ${fmtTok(sum(i => i.tokens ?? 0))} T`
}

const STATUSES: Status[] = ['done', 'active', 'pending', 'wait']
// The app's task list words (update_plan) in the band's.
const PLAN_STATUS: Record<string, Status> = { completed: 'done', in_progress: 'active', pending: 'pending' }
// A string (or finite number) as one trimmed line, capped; anything else is ''.
const oneLine = (v: unknown, max: number) =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : ''

const DESCRIPTION = [
  'Shows the person a live checklist above their prompt; its title is the goal you are solving, stated as the outcome. Call it at the start of every multi-step task,',
  'and again whenever a step starts or finishes, sending the whole list each time.',
  'status: done, active (being worked on now), pending, or wait (waiting on the person, e.g. an approval).',
  'model: which model runs the step (Opus, Sonnet, Haiku); left out, the session model. Tokens and time are measured for you.',
  "goal: for a step an agent works on, the problem in plain words anyone could follow, the way Apple writes: what is wrong or unknown as the person sees it, never the fix.",
  "Short and calm, under 8 words, everyday words, no code names, file names or jargon (e.g. 'Finished steps don't show as done', not 'band misses steps finished without going active').",
  'Shown under the step while it is active.',
  'Keep each text to a few crisp words, no filler. Send an empty items list to clear it.',
].join(' ')

// Colours per theme. Text and green sit as light as they can while still at least 5:1:
// light on the app's grey tray (#F0F0EF), dark on #1F1E1D, #262624 and #30302E.
// The header and task text use the app's own 'text' colour, so they match the chat in every theme;
// grey is for the model column, stats and notes. ring: the active spinner. open: the to-do circles, one solid grey in every theme (1.6:1 on the tray, so it reads without competing with text).
// 'mid' is for a theme the band cannot tell; its green is the best balance for both (3.85:1).
type Palette = { accent: string; tick: string; grey: string; ring: string; open: string; fill: string; ink: string }
const PALETTES: Record<'light' | 'dark' | 'mid', Palette> = {
  light: { accent: '#127338', tick: '#FFFFFF', grey: '#62656B', ring: '#5F6672', open: '#BEC1C7', fill: '#BEC1C7', ink: '#62656B' },
  dark: { accent: '#2DB65F', tick: '#1F1E1D', grey: '#9F9FA3', ring: '#80808A', open: '#BEC1C7', fill: '#BEC1C7', ink: '#9F9FA3' },
  mid: { accent: '#1F934A', tick: '#FFFFFF', grey: '#8A9099', ring: '#8A9099', open: '#BEC1C7', fill: '#BEC1C7', ink: '#8A9099' },
}

// Rows are the app's own Text, so they take the person's interface font and size (body is 14 px
// at 100%, on a 20 px line with its baseline at 16). Circles are 0.72 of that: 10.08 px across,
// drawn in a 12 x 20 box the row centres on the line, bottom edge on the baseline.
// Svg sizes are CSS pixels, so they follow the app's zoom with the text.
const BOX = 12
const LINE = 20
const BASE = 16
const D = 10.08
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${LINE}" viewBox="0 0 ${BOX} ${LINE}"><g transform="translate(0 ${BASE - D / 2 - BOX / 2})">${body}</g></svg>`

// done: green disc with a tick. active: four grey arcs turning once every 6 s over a 10% green fill
// (r 4.48, circumference 28.15 = 4 x 7.04). pending / wait: a plain filled circle.
const glyphs = (p: Palette): Record<Status, string> => {
  const c = BOX / 2
  const clear = svg(`<circle cx="${c}" cy="${c}" r="${D / 2 - 0.5}" fill="${p.fill}" stroke="${p.open}" stroke-width="1"/>`)
  return {
    done: svg(`<circle cx="${c}" cy="${c}" r="${D / 2}" fill="${p.accent}"/><path d="M3.72 6.12l1.56 1.56 3-3.16" fill="none" stroke="${p.tick}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`),
    active: svg(`<circle cx="${c}" cy="${c}" r="${D / 2}" fill="${p.accent}" fill-opacity="0.1"/><circle cx="${c}" cy="${c}" r="4.48" fill="none" stroke="${p.ring}" stroke-width="1.2" stroke-dasharray="4.1 2.94" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 ${c} ${c}" to="360 ${c} ${c}" dur="6s" repeatCount="indefinite"/></circle>`),
    pending: clear,
    wait: clear,
  }
}
const GLYPHS = { light: glyphs(PALETTES.light), dark: glyphs(PALETTES.dark), mid: glyphs(PALETTES.mid) }

// 'in progress' beside the active step, in the app's serif (Tiempos Text italic, else Georgia).
// Text has no font setting, so it is a small SVG: 14 px, 5.03 em wide in Tiempos (Georgia 5.07),
// on the same baseline as the body text beside it.
const BUSY_W = 74
const busy = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BUSY_W}" height="${LINE}" viewBox="0 0 ${BUSY_W} ${LINE}"><text x="0" y="${BASE}" font-family="'Test Tiempos Text', 'Tiempos Text', Tiempos, Georgia, serif" font-style="italic" font-size="14" fill="${color}">in progress</text></svg>`

const ALT: Record<Status, string> = { done: 'Done', active: 'In progress', pending: 'Not started', wait: 'Waiting on you' }
const TEXT_MARK: Record<Status, string> = { done: '✓', active: '◌', pending: '○', wait: '○' }

// Re-read the git chip in the background, one read at a time, so a turn never waits on git or gh.
let reading = false
function refreshGit($: EngineInterface) {
  if (reading) return
  reading = true
  const run: Run = (argv, timeoutMs) => $.process.run(argv, { timeoutMs })
  void readGit(run)
    .catch(() => null)
    .then(g => update($, git, () => g))
    .catch(() => undefined)
    .finally(() => {
      reading = false
    })
}

// The sync counter: an auto-sync script writes "<pushed> <failed> <ok|fail>" to
// ~/.claude/autosync.count. Checked every few seconds (a stat, read only when it changed),
// since the script runs after the turn ends. No file, no counter.
let syncPath = ''
let syncSeen = -1
let syncTimer: { cancel: () => void } | undefined
async function refreshSync($: EngineInterface) {
  if (!syncPath) {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (!home) return
    syncPath = `${home}/.claude/autosync.count`
  }
  const st = await $.fs.stat(syncPath).catch(() => undefined)
  const mtime = st?.mtimeMs ?? 0
  if (mtime === syncSeen) return
  syncSeen = mtime
  let s: Sync | null = null
  if (st) {
    const [a = '', b = '', c] = String(await $.fs.read(syncPath)).trim().split(/\s+/)
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) s = { pushed: Number(a), failed: Number(b), lastFailed: c === 'fail' }
  }
  await update($, sync, () => s)
}

// Build and store the band's list from a set or update_plan call. Each step keeps its model, goal and
// timing from the last update where it is the same step. Returns the list, or null when it is empty.
async function applyList($: EngineInterface, rawTitle: unknown, raw: unknown[], source: List['source']): Promise<List | null> {
  const now = await $.clock.now()
  const m = (await read($, meter)) ?? { tokens: 0, model: '' }
  const prev = await read($, list)
  const before = prev?.items ?? []
  const title = oneLine(rawTitle, 120) || 'Tasks'
  // Steps with no usable text are dropped, so a bad payload never draws a blank row.
  const clean = raw
    .filter((i): i is { text: unknown; status: unknown; model?: unknown; goal?: unknown } => typeof i === 'object' && i !== null)
    .map(i => ({ ...i, text: oneLine(i.text, 200) }))
    .filter(i => i.text)
  const texts = new Set(clean.map(i => i.text))
  const used = new Set<number>()
  // The same step from the last update, each one claimed once: same text at the same place, else
  // the same text anywhere, else (same list, renamed step) whatever sat at that place, if its text is gone.
  const claim = (text: string, n: number) => {
    const free = (k: number) => k >= 0 && k < before.length && !used.has(k)
    let k = free(n) && before[n]?.text === text ? n : before.findIndex((b, j) => free(j) && b.text === text)
    if (k < 0 && prev?.title === title && free(n) && !texts.has(before[n]?.text ?? '')) k = n
    if (k < 0) return undefined
    used.add(k)
    return before[k]
  }
  const items: Item[] = clean.map((i, n) => {
      const text = i.text
      const status: Status = (STATUSES as unknown[]).includes(i.status) ? (i.status as Status) : 'pending'
      const was = claim(text, n)
      const asked = typeof i.model === 'string' && i.model.trim() ? shortModel(i.model) : undefined
      const item: Item = { text, status, model: asked ?? was?.model ?? (m.model ? shortModel(m.model) : undefined) }
      const goal = oneLine(i.goal, 160) || was?.goal
      if (goal) item.goal = goal
      if (was?.startedAt !== undefined) {
        item.startedAt = was.startedAt
        item.startTok = was.startTok
      }
      if (status === 'active' && item.startedAt === undefined) {
        item.startedAt = now
        item.startTok = m.tokens
      }
      if (status === 'done') {
        if (was?.status === 'done' && was.tokens !== undefined) {
          item.tokens = was.tokens
          item.ms = was.ms
        } else {
          const from = item.startedAt ?? prev?.at ?? now
          const fromTok = item.startTok ?? prev?.tokAt ?? m.tokens
          item.tokens = Math.max(0, m.tokens - fromTok)
          item.ms = Math.max(0, now - from)
        }
      }
      return item
    })
  const next: List | null = items.length ? { title, items, at: now, tokAt: m.tokens, source } : null
  await update($, list, () => next)
  return next
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) refreshGit($)
    return r
  })

  on('session.start', async ($, e, next) => {
    refreshGit($)
    // A new session may have a new HOME, and must read the counter even if the file is unchanged.
    syncPath = ''
    syncSeen = -1
    const checkSync = () => void refreshSync($).catch(() => undefined)
    checkSync()
    syncTimer?.cancel()
    syncTimer = $.clock.every(4000, checkSync)
    await $.tool.register({
      name: 'set',
      description: DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: "The goal you are solving, as a concrete outcome in 3-6 words (e.g. 'Iron levers re-rendered'). Not the person's prompt." },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                status: { type: 'string', enum: STATUSES },
                model: { type: 'string', description: 'Opus, Sonnet or Haiku: the model that runs this step.' },
                goal: { type: 'string', description: "The problem this step is up against, in plain everyday words, under 8 words, no jargon or code names, never the fix (e.g. 'Finished steps don't show as done', not 'patch the done handler')." },
              },
              required: ['text', 'status'],
            },
          },
        },
        required: ['items'],
      },
    })
    return next(e)
  })

  // Note the model each subagent starts on, so a step run on that model can show what its agent is solving.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      if (!r.deny && r.agentId && r.model) {
        const id = r.agentId
        const model = r.model
        // The latest 50 are plenty for the running ones, so a long session never piles them up.
        await update($, agentModels, a => Object.fromEntries([...Object.entries(a ?? {}).slice(-49), [id, model]]))
      }
    } catch {
      // Bookkeeping only: a failure here never touches the spawn.
    }
    return r
  })

  // Count new tokens (uncached input, cache writes, output) of every response, subagents included.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r?.usage
    if (u) {
      const n = u.input_tokens + u.cache_creation_input_tokens + u.output_tokens
      await update($, meter, m => ({ tokens: (m?.tokens ?? 0) + n, model: e.agentId ? (m?.model ?? '') : u.model }))
    }
    return r
  })

  on('tool.call', { tool: 'mcp__live-checklist__set' }, async ($, e) => {
    const input = e as unknown as { title?: unknown; items?: unknown }
    const next = await applyList($, input.title, Array.isArray(input.items) ? input.items : [], 'set')
    const done = next ? next.items.filter(i => i.status === 'done').length : 0
    return { result: next ? `Checklist shown: ${done}/${next.items.length} done.` : 'Checklist cleared.' }
  }).catch(() => ({ result: 'Checklist could not be updated.' }))

  // The app's own task list (update_plan, checked off by wrap_up) drives the band too, so it fills
  // in every session without a second call. Once the session calls set, set owns the band.
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny || r.isError) return r
    try {
      const prev = await read($, list)
      if (prev?.source === 'set') return r
      const input = e as unknown as { items?: unknown; advance?: unknown; done?: unknown; start?: unknown }
      let steps: { text: unknown; status: Status }[]
      if (Array.isArray(input.items)) {
        steps = input.items
          .filter((i): i is { content?: unknown; status?: unknown } => typeof i === 'object' && i !== null)
          .map(i => ({ text: i.content, status: PLAN_STATUS[String(i.status)] ?? 'pending' }))
        // The app's list always has steps: one with none to show is junk, not a clear.
        if (!steps.some(s => oneLine(s.text, 200))) return r
      } else {
        if (!prev) return r
        steps = prev.items.map(i => ({ text: i.text, status: i.status }))
        const at = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) ? steps[n - 1] : undefined)
        if (input.advance === true) {
          const now = steps.find(s => s.status === 'active')
          if (now) now.status = 'done'
          const nextUp = steps.find(s => s.status === 'pending')
          if (nextUp) nextUp.status = 'active'
        }
        for (const n of Array.isArray(input.done) ? input.done : []) {
          const s = at(n)
          if (s) s.status = 'done'
        }
        const s = at(input.start)
        if (s) s.status = 'active'
      }
      await applyList($, prev?.title, steps, 'plan')
    } catch {
      // Mirroring only: the app's own list is never touched.
    }
    return r
  })

  // wrap_up checks off the app's list: the step still running is done.
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, async ($, e, next) => {
    const r = await next(e)
    try {
      const prev = await read($, list)
      if (prev?.source === 'plan' && prev.items.some(i => i.status === 'active'))
        await applyList($, prev.title, prev.items.map(i => ({ ...i, status: i.status === 'active' ? 'done' : i.status })), 'plan')
    } catch {
      // Mirroring only.
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const l = await read($, list)
    if (e.props.hasSurvey || l === null) {
      return next(e)
    }
    // isOpen is kept in state for later use; the band always shows the list.
    await read($, isOpen)
    const ui = $.ui.resolve(e) as unknown as Record<string, any>
    const { Box, Text } = ui
    const Svg = ui.Svg
    const graphic = e.surface !== 'terminal' && Svg !== undefined

    // Follow the person's theme setting: light-* or dark-*; anything else gets the middle palette.
    let mode: 'light' | 'dark' | 'mid' = 'mid'
    try {
      const theme = String((await $.config.list()).find(r => r.key === 'theme')?.value ?? '')
      mode = theme.startsWith('light') ? 'light' : theme.startsWith('dark') ? 'dark' : 'mid'
    } catch {
      mode = 'mid'
    }
    const P = PALETTES[mode]
    const G = GLYPHS[mode]
    // A row saved without a model (an older copy, or set before any response) shows the session's.
    const m = await read($, meter)
    const sessionModel = m?.model ? shortModel(m.model) : ''
    const g = await read($, git)
    const s = await read($, sync)
    // Context gauge: grey, amber from 75%, red from 85% (auto-compact is near).
    const usage = await $.session.usage().catch(() => undefined)
    // Rounded first, so the colour matches the number shown; not a number, no gauge.
    const rawPct = usage?.context.percent
    const pct = typeof rawPct === 'number' && Number.isFinite(rawPct) ? Math.min(100, Math.max(0, Math.round(rawPct))) : undefined
    const total = runTotal(l.items)
    // What the active step's agent is solving: its own goal, else the description of a running
    // subagent on the step's model.
    const models = (await read($, agentModels)) ?? {}
    const live = l.items.some(i => i.status === 'active' && !i.goal)
      ? (await $.agent.list().catch(() => [])).filter(a => !a.parentId && ['pending', 'running', 'waiting'].includes(a.status))
      : []
    const solving = (i: Item) => {
      if (i.status !== 'active') return ''
      if (i.goal) return i.goal
      const model = i.model ?? sessionModel
      return live.find(a => models[a.id] && shortModel(models[a.id] ?? '') === model)?.description ?? ''
    }

    const done = l.items.filter(i => i.status === 'done')
    const rest = l.items.filter(i => i.status !== 'done')
    const shownDone = done.slice(-3)
    const shownRest = rest.slice(0, 7)
    const hidden = rest.length - shownRest.length

    const glyph = (s: Status, k: string) =>
      graphic ? (
        s === 'active' ? (
          <Svg key={k} source={G[s]} alt={ALT[s]} width={BOX} height={LINE} isInteractive />
        ) : (
          <Svg key={k} source={G[s]} alt={ALT[s]} width={BOX} height={LINE} />
        )
      ) : (
        <Text key={k} color={s === 'done' ? P.accent : P.grey}>
          {TEXT_MARK[s]}
        </Text>
      )

    const note = (k: string, text: string) => (
      <Text key={k} size="footnote" color={P.grey}>
        {text}
      </Text>
    )

    // Each row: model column (fixed width, so every glyph and task starts at the same x),
    // glyph, task text, then tokens / time against the right edge once the step is done.
    const row = (i: Item, k: string) => {
      const isDone = i.status === 'done'
      const isNow = i.status === 'active'
      const took = stats(i)
      const why = solving(i)
      const line = (
        <Box key="l" flexDirection="row" alignItems="center" gap="sm">
          <Text key="t" color={isDone ? P.accent : 'text'} weight="regular" wrap="truncate-end">
            {i.text}
          </Text>
          {isNow ? (
            graphic ? (
              <Svg key="w" source={busy(P.grey)} alt="in progress" width={BUSY_W} height={LINE} />
            ) : (
              <Text key="w" color={P.grey} italic>
                in progress
              </Text>
            )
          ) : null}
        </Box>
      )
      // With a Solving line the row tops-aligns, so the model and glyph stay on the step's own line.
      return (
        <Box key={k} flexDirection="row" alignItems={why ? 'flex-start' : 'center'} gap="sm">
          <Box key={k + 'm'} width={7} flexShrink={0}>
            <Text key="m" size="footnote" weight="medium" color={P.grey} wrap="truncate-end">
              {i.model ?? sessionModel}
            </Text>
          </Box>
          {glyph(i.status, k + 'g')}
          <Box key={k + 'b'} flexGrow={1} flexShrink={1} flexDirection="column">
            {line}
            {why ? (
              <Text key="y" size="footnote" color={P.grey} wrap="truncate-end">
                {`Solving: ${why}`}
              </Text>
            ) : null}
          </Box>
          {took ? (
            <Text key={k + 's'} size="footnote" color={P.grey} tabular>
              {took}
            </Text>
          ) : null}
        </Box>
      )
    }

    // No card or border of its own: the app's grey tray around the band is the frame.
    return (
      <Box flexDirection="column" rowGap={1} paddingX="md" paddingY="sm">
        <Box key="head" flexDirection="row" alignItems="center" gap="sm">
          <Box key="tb" flexGrow={1} flexShrink={1}>
            <Text key="title" weight="bold" color="text" wrap="truncate-end">
              {l.title}
            </Text>
          </Box>
          {total ? (
            <Text key="total" size="footnote" color={P.grey} tabular>
              {total}
            </Text>
          ) : null}
          {pct !== undefined ? (
            <Text key="ctx" size="footnote" color={pct >= 85 ? 'error' : pct >= 75 ? 'warning' : P.grey} tabular>
              {`Context ${pct}%`}
            </Text>
          ) : null}
          {g ? (
            <Text key="git" size="footnote" color={g.tone === 'alert' ? 'error' : g.tone === 'ok' ? P.accent : P.grey} wrap="truncate-end">
              {g.label}
            </Text>
          ) : null}
          {s ? (
            <Text key="sync" size="footnote" color={s.lastFailed ? 'error' : P.grey} tabular>
              {`${s.pushed} pushed · ${s.failed} failed`}
            </Text>
          ) : null}
        </Box>
        <Box key="rows" flexDirection="column" gap="xs">
          {done.length > shownDone.length ? note('earlier', `${done.length - shownDone.length} earlier done`) : null}
          {shownDone.map((i, n) => row(i, 'd' + n))}
          {shownRest.map((i, n) => row(i, 'r' + n))}
          {hidden > 0 ? note('more', `+${hidden} more`) : null}
        </Box>
      </Box>
    )
  })
}
