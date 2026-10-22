// SPDX-License-Identifier: MIT
// Copyright (c) 2026 starkitekt. Doer: live-checklist mod, https://github.com/starkitekt/Doer
// Keep this notice in all copies and derived works (MIT License, see LICENSE).

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Item, List, Status } from '../types'

const list = atom({ plugin: 'live-checklist', key: 'list' } as const, null)
const isOpen = atom({ plugin: 'live-checklist', key: 'isOpen' } as const, true)

const STATUSES: Status[] = ['done', 'active', 'pending', 'wait']

const DESCRIPTION = [
  'Shows the person a live checklist above their prompt; its title is the goal you are solving, stated as the outcome. Call it at the start of every multi-step task,',
  'and again whenever a step starts or finishes, sending the whole list each time.',
  'status: done, active (being worked on now), pending, or wait (waiting on the person, e.g. an approval).',
  'Keep each text to a few crisp words, no filler. Send an empty items list to clear it.',
].join(' ')

// Colours per theme. Light: every colour, rings included, at least 5:1 on white and on cream.
// Dark: text at least 5:1, rings at least 3:1. 'mid' is for a theme the band cannot tell.
type Palette = { blue: string; tick: string; grey: string; ring: string; fill: string; ink: string }
const PALETTES: Record<'light' | 'dark' | 'mid', Palette> = {
  light: { blue: '#2058D8', tick: '#FFFFFF', grey: '#5C636E', ring: '#5F6672', fill: '#FFFFFF', ink: '#1F1E1D' },
  dark: { blue: '#7AA7FF', tick: '#1F1E1D', grey: '#A1A1AA', ring: '#80808A', fill: 'none', ink: '#F0EEE6' },
  mid: { blue: '#3B7BE8', tick: '#FFFFFF', grey: '#8A9099', ring: '#8A9099', fill: 'none', ink: '#8A9099' },
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">${body}</svg>`

// done: blue disc with a tick. active: four grey arcs turning once every 6 s over a 10% blue fill
// (circumference 43.98 = 4 x 11.0). pending / wait: a plain clear circle.
const glyphs = (p: Palette): Record<Status, string> => {
  const clear = svg(`<circle cx="9" cy="9" r="7" fill="${p.fill}" stroke="${p.ring}" stroke-width="1.2"/>`)
  return {
    done: svg(`<circle cx="9" cy="9" r="7.5" fill="${p.blue}"/><path d="M5.6 9.2l2.3 2.3 4.5-4.7" fill="none" stroke="${p.tick}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
    active: svg(`<circle cx="9" cy="9" r="7" fill="${p.blue}" fill-opacity="0.1"/><circle cx="9" cy="9" r="7" fill="none" stroke="${p.ring}" stroke-width="1.6" stroke-dasharray="6.4 4.6" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 9 9" to="360 9 9" dur="6s" repeatCount="indefinite"/></circle>`),
    pending: clear,
    wait: clear,
  }
}
const GLYPHS = { light: glyphs(PALETTES.light), dark: glyphs(PALETTES.dark), mid: glyphs(PALETTES.mid) }
// Plus Jakarta Sans. The Text element has no font setting, so on the desktop each line is drawn
// as a small SVG in the installed font. Advance widths (per em, ASCII 32-126) were measured from
// the font files, so each line is sized and truncated to fit without a page to measure in.
type Face = 'r' | 'sb' | 'b' | 'i'
const ADV: Record<Face, number[]> = {
  r: [0.17,0.282,0.395,0.79,0.646,0.974,0.734,0.245,0.295,0.295,0.479,0.606,0.27,0.498,0.286,0.429,0.732,0.371,0.6,0.609,0.63,0.616,0.597,0.543,0.628,0.597,0.286,0.306,0.606,0.606,0.606,0.499,0.929,0.652,0.693,0.781,0.742,0.612,0.581,0.821,0.736,0.256,0.383,0.654,0.531,0.836,0.736,0.878,0.643,0.878,0.641,0.646,0.512,0.7,0.652,0.984,0.597,0.623,0.584,0.315,0.429,0.315,0.606,0.598,0.352,0.572,0.667,0.6,0.667,0.615,0.393,0.662,0.573,0.229,0.229,0.548,0.229,0.908,0.573,0.655,0.667,0.667,0.338,0.509,0.388,0.573,0.517,0.797,0.487,0.536,0.449,0.317,0.3,0.317,0.606],
  sb: [0.175,0.341,0.464,0.873,0.647,1.022,0.774,0.289,0.351,0.351,0.52,0.642,0.328,0.566,0.347,0.481,0.716,0.392,0.598,0.611,0.646,0.615,0.601,0.554,0.631,0.601,0.347,0.367,0.642,0.642,0.642,0.555,0.928,0.692,0.692,0.777,0.741,0.601,0.584,0.813,0.734,0.272,0.39,0.671,0.539,0.874,0.739,0.878,0.646,0.878,0.654,0.647,0.532,0.712,0.682,1.008,0.64,0.648,0.576,0.382,0.481,0.382,0.642,0.641,0.372,0.578,0.67,0.606,0.67,0.613,0.402,0.655,0.586,0.245,0.245,0.567,0.245,0.919,0.586,0.653,0.67,0.67,0.362,0.512,0.405,0.586,0.55,0.855,0.535,0.569,0.471,0.371,0.363,0.371,0.642],
  b: [0.178,0.371,0.498,0.915,0.647,1.046,0.793,0.311,0.379,0.379,0.54,0.66,0.357,0.6,0.378,0.506,0.708,0.403,0.597,0.611,0.654,0.615,0.602,0.559,0.632,0.602,0.378,0.398,0.66,0.66,0.66,0.583,0.927,0.712,0.691,0.774,0.74,0.595,0.586,0.808,0.733,0.279,0.393,0.679,0.543,0.893,0.741,0.878,0.648,0.878,0.661,0.647,0.542,0.718,0.697,1.02,0.661,0.66,0.571,0.416,0.506,0.416,0.66,0.663,0.381,0.58,0.672,0.608,0.672,0.612,0.406,0.652,0.593,0.252,0.252,0.577,0.252,0.924,0.593,0.652,0.672,0.672,0.374,0.514,0.413,0.593,0.566,0.883,0.558,0.586,0.481,0.398,0.395,0.398,0.66],
  i: [0.17,0.283,0.395,0.79,0.647,1.001,0.742,0.245,0.311,0.312,0.479,0.607,0.27,0.498,0.286,0.433,0.734,0.372,0.62,0.609,0.631,0.615,0.598,0.544,0.629,0.599,0.286,0.306,0.607,0.607,0.607,0.5,0.931,0.652,0.7,0.796,0.745,0.613,0.582,0.827,0.737,0.257,0.383,0.655,0.532,0.837,0.737,0.881,0.642,0.881,0.642,0.647,0.513,0.7,0.652,0.984,0.597,0.623,0.585,0.316,0.425,0.315,0.607,0.598,0.352,0.573,0.666,0.612,0.669,0.617,0.396,0.663,0.574,0.231,0.232,0.547,0.231,0.909,0.574,0.658,0.666,0.67,0.338,0.51,0.39,0.574,0.517,0.797,0.49,0.536,0.45,0.318,0.301,0.317,0.607],
}
const ELL: Record<Face, number> = { r: 0.686, sb: 0.747, b: 0.778, i: 0.686 }
const FACE: Record<Face, string> = {
  r: 'font-weight="400"',
  sb: 'font-weight="600"',
  b: 'font-weight="700"',
  i: 'font-weight="400" font-style="italic"',
}
const CAP = 0.745
const FAMILY = "'Plus Jakarta Sans', system-ui, sans-serif"
type Run = { text: string; size: number; face: Face; color: string; gap?: number }
const charW = (c: string, f: Face) => {
  const n = c.charCodeAt(0)
  return n >= 32 && n <= 126 ? ADV[f][n - 32] : 0.62
}
const measure = (s: string, f: Face) => [...s].reduce((a, c) => a + charW(c, f), 0)
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fit = (s: string, f: Face, size: number, max: number) => {
  if (measure(s, f) * size <= max) return s
  let out = ''
  let w = ELL[f] * size
  for (const c of s) {
    const cw = charW(c, f) * size
    if (w + cw > max) break
    out += c
    w += cw
  }
  return out.trimEnd() + '…'
}
// One line of runs on a shared baseline, caps centred in the line height.
const typeset = (runs: Run[], height: number, max: number) => {
  const base = (height + CAP * Math.max(...runs.map(r => r.size))) / 2
  let x = 0
  const parts: string[] = []
  for (const r of runs) {
    x += r.gap ?? 0
    const t = fit(r.text, r.face, r.size, Math.max(0, max - x))
    parts.push(
      `<text x="${x.toFixed(1)}" y="${base.toFixed(1)}" font-size="${r.size}" ${FACE[r.face]} fill="${r.color}">${esc(t)}</text>`,
    )
    x += measure(t, r.face) * r.size
  }
  const width = Math.ceil(x * 1.02) + 2
  return {
    width,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FAMILY}" text-rendering="geometricPrecision">${parts.join('')}</svg>`,
  }
}

const ALT: Record<Status, string> = { done: 'Done', active: 'In progress', pending: 'Not started', wait: 'Waiting on you' }
const TEXT_MARK: Record<Status, string> = { done: '✓', active: '◌', pending: '○', wait: '○' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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

  on('tool.call', { tool: 'mcp__live-checklist__set' }, async ($, e) => {
    const input = e as unknown as { title?: unknown; items?: unknown }
    const raw = Array.isArray(input.items) ? input.items : []
    const items: Item[] = raw
      .filter((i): i is { text: unknown; status: unknown } => typeof i === 'object' && i !== null)
      .map(i => ({
        text: String(i.text ?? '').slice(0, 200),
        status: (STATUSES as unknown[]).includes(i.status) ? (i.status as Status) : 'pending',
      }))
    const title = typeof input.title === 'string' ? input.title.slice(0, 120) : 'Tasks'
    const next: List | null = items.length ? { title, items } : null
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

    const total = l.items.length
    const done = l.items.filter(i => i.status === 'done')
    const rest = l.items.filter(i => i.status !== 'done')
    const shownDone = done.slice(-3)
    const shownRest = rest.slice(0, 7)
    const hidden = rest.length - shownRest.length

    const glyph = (s: Status, k: string) =>
      graphic ? (
        s === 'active' ? (
          <Svg key={k} source={G[s]} alt={ALT[s]} width={18} height={18} isInteractive />
        ) : (
          <Svg key={k} source={G[s]} alt={ALT[s]} width={18} height={18} />
        )
      ) : (
        <Text key={k} color={s === 'done' ? P.blue : P.grey} bold={s === 'done'}>
          {TEXT_MARK[s]}
        </Text>
      )

    // Jakarta lines need a graphic surface and a known theme (their colours are baked in).
    const jak = graphic && mode !== 'mid'
    const words = (k: string, runs: Run[], height: number, max: number) => {
      const t = typeset(runs, height, max)
      return <Svg key={k} source={t.source} alt={runs.map(r => r.text).join(' ')} width={t.width} height={height} />
    }
    const note = (k: string, text: string) =>
      jak ? (
        words(k, [{ text, size: 12, face: 'r', color: P.grey }], 16, 460)
      ) : (
        <Text key={k} size="footnote" color={P.grey}>
          {text}
        </Text>
      )

    const row = (i: Item, k: string) => {
      const isDone = i.status === 'done'
      const isNow = i.status === 'active'
      if (jak) {
        const runs: Run[] = [
          { text: i.text, size: 14, face: isDone ? 'b' : 'r', color: isDone ? P.blue : isNow ? P.ink : P.grey },
        ]
        if (i.status === 'wait') runs.push({ text: 'your turn', size: 12, face: 'i', color: P.grey, gap: 8 })
        return (
          <Box key={k} flexDirection="row" alignItems="center" gap="sm">
            {glyph(i.status, k + 'g')}
            {words(k + 't', runs, 20, 460)}
          </Box>
        )
      }
      return (
        <Box key={k} flexDirection="row" alignItems="center" gap="sm">
          {glyph(i.status, k + 'g')}
          <Text
            key={k + 't'}
            color={isDone ? P.blue : isNow ? undefined : P.grey}
            weight={isDone ? 'bold' : 'regular'}
            wrap="truncate-end"
          >
            {i.text}
          </Text>
          {i.status === 'wait' ? (
            <Text key={k + 'w'} size="caption" color={P.grey} italic>
              your turn
            </Text>
          ) : null}
        </Box>
      )
    }

    return (
      <Box
        flexDirection="column"
        rowGap={1}
        paddingX="md"
        paddingY="sm"
        borderStyle="round"
        borderColor="promptBorder"
        borderDimColor
      >
        {jak ? (
          <Box key="head" flexDirection="row" alignItems="center" gap="md">
            <Box key="t" flexGrow={1}>
              {words('title', [{ text: l.title, size: 21, face: 'sb', color: P.ink }], 28, 420)}
            </Box>
            {words(
              'count',
              [
                { text: String(done.length), size: 21, face: 'sb', color: P.blue },
                { text: `/${total}`, size: 21, face: 'r', color: P.grey },
              ],
              28,
              120,
            )}
          </Box>
        ) : (
          <Box key="head" flexDirection="row" alignItems="flex-start" gap="md">
            <Box key="t" flexGrow={1}>
              <Text key="title" size="title" weight="semibold" wrap="truncate-end">
                {l.title}
              </Text>
            </Box>
            <Box key="count" flexDirection="row">
              <Text key="d" size="title" weight="semibold" color={P.blue} tabular>
                {String(done.length)}
              </Text>
              <Text key="n" size="title" color={P.grey} tabular>
                {`/${total}`}
              </Text>
            </Box>
          </Box>
        )}
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
