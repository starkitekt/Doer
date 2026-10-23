// SPDX-License-Identifier: MIT
// Copyright (c) 2026 starkitekt. Doer: live-checklist mod, https://github.com/starkitekt/Doer
// Keep this notice in all copies and derived works (MIT License, see LICENSE).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Git, Item, List, Meter, Status } from '../types'

const list = atom({ plugin: 'live-checklist', key: 'list' } as const, null)
const isOpen = atom({ plugin: 'live-checklist', key: 'isOpen' } as const, true)
const meter = atom({ plugin: 'live-checklist', key: 'meter' } as const, { tokens: 0, model: '' } as Meter)
const git = atom({ plugin: 'live-checklist', key: 'git' } as const, null as Git | null)

// The repo's one most urgent state, in this order: conflicts, checks failing, checks running,
// unpushed commits, changed files, else clean. null outside a git repo. Read-only: it runs
// git status and, once the last commit is pushed, gh for its CI runs (skipped if gh is missing).
type Run = (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string }>
const readGit = async (run: Run): Promise<Git | null> => {
  const st = await run(['git', 'status', '--porcelain=v2', '--branch'], 5000)
  if (st.exitCode !== 0) return null
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

const STATUSES: Status[] = ['done', 'active', 'pending', 'wait']

const DESCRIPTION = [
  'Shows the person a live checklist above their prompt; its title is the goal you are solving, stated as the outcome. Call it at the start of every multi-step task,',
  'and again whenever a step starts or finishes, sending the whole list each time.',
  'status: done, active (being worked on now), pending, or wait (waiting on the person, e.g. an approval).',
  'model: which model runs the step (Opus, Sonnet, Haiku); left out, the session model. Tokens and time are measured for you.',
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

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) refreshGit($)
    return r
  })

  on('session.start', async ($, e, next) => {
    refreshGit($)
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
    const raw = Array.isArray(input.items) ? input.items : []
    const now = await $.clock.now()
    const m = (await read($, meter)) ?? { tokens: 0, model: '' }
    const prev = await read($, list)
    const before = prev?.items ?? []
    const items: Item[] = raw
      .filter((i): i is { text: unknown; status: unknown; model?: unknown } => typeof i === 'object' && i !== null)
      .map((i, n) => {
        const text = String(i.text ?? '').slice(0, 200)
        const status: Status = (STATUSES as unknown[]).includes(i.status) ? (i.status as Status) : 'pending'
        // The same step from the last update: by text, else by position.
        const was = before.find(b => b.text === text) ?? before[n]
        const asked = typeof i.model === 'string' && i.model.trim() ? shortModel(i.model) : undefined
        const item: Item = { text, status, model: asked ?? was?.model ?? (m.model ? shortModel(m.model) : undefined) }
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
    const title = typeof input.title === 'string' ? input.title.slice(0, 120) : 'Tasks'
    const next: List | null = items.length ? { title, items, at: now, tokAt: m.tokens } : null
    await update($, list, () => next)
    const done = items.filter(i => i.status === 'done').length
    return { result: next ? `Checklist shown: ${done}/${items.length} done.` : 'Checklist cleared.' }
  }).catch(() => ({ result: 'Checklist could not be updated.' }))

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
      return (
        <Box key={k} flexDirection="row" alignItems="center" gap="sm">
          <Box key={k + 'm'} width={7} flexShrink={0}>
            <Text key="m" size="footnote" weight="medium" color={P.grey} wrap="truncate-end">
              {i.model ?? sessionModel}
            </Text>
          </Box>
          {glyph(i.status, k + 'g')}
          <Box key={k + 'b'} flexGrow={1} flexShrink={1} flexDirection="row" alignItems="center" gap="sm">
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
          {g ? (
            <Text key="git" size="footnote" color={g.tone === 'alert' ? 'error' : g.tone === 'ok' ? P.accent : P.grey} wrap="truncate-end">
              {g.label}
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
