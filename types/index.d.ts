// SPDX-License-Identifier: MIT
// Copyright (c) 2026 starkitekt. Doer: live-checklist mod, https://github.com/starkitekt/Doer
// Keep this notice in all copies and derived works (MIT License, see LICENSE).

export type Status = 'done' | 'active' | 'pending' | 'wait'
export type Item = { text: string; status: Status }
export type List = { title: string; items: Item[] }

declare module 'claude-code' {
  interface PluginState {
    'live-checklist': { list: List | null; isOpen: boolean }
  }
}
