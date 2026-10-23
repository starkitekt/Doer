// SPDX-License-Identifier: MIT
// Copyright (c) 2026 starkitekt. Doer: live-checklist mod, https://github.com/starkitekt/Doer
// Keep this notice in all copies and derived works (MIT License, see LICENSE).

export type Status = 'done' | 'active' | 'pending' | 'wait'
// model: who runs the step. startedAt / startTok: clock and token meter when it started.
// tokens / ms: what it took, set once it is done.
export type Item = {
  text: string
  status: Status
  model?: string
  startedAt?: number
  startTok?: number
  tokens?: number
  ms?: number
}
// at / tokAt: clock and token meter at the last update, the start for a step done without being active.
export type List = { title: string; items: Item[]; at?: number; tokAt?: number }
// tokens: new tokens across every model response this session (input, cache writes, output).
// model: the model that last answered on the main thread.
export type Meter = { tokens: number; model: string }

declare module 'claude-code' {
  interface PluginState {
    'live-checklist': { list: List | null; isOpen: boolean; meter: Meter }
  }
}
