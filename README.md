# Doer

A live checklist that floats above the Claude Code prompt. Claude sets the goal it is solving as the header, then ticks steps off as it works, so you are never left guessing what it is doing.

- **Done:** green disc with a tick, green text, and the tokens and time the step took at the right
- **In progress:** slowly turning dotted ring, marked *in progress* in serif italics
- **Not started:** filled light grey circle
- The header and the steps not yet done use the app's own text colour, so they match the chat
- Each row starts with the model that runs the step, so the steps line up in one column
- Circles sit on the text baseline

Rows use the app's own font at your interface size. It works on light and dark themes and sits straight on the app's tray above the prompt, with no card or border of its own.

## Git chip

When the session runs inside a git repository, the right end of the header shows the branch and its most urgent state, one at a time. It is read only, so it never commits, pushes or merges.

| Shows | When | Colour |
|---|---|---|
| `Conflicts` | a merge or rebase has unresolved files | red |
| `Checks failing` | a CI run on the last pushed commit failed | red |
| `Checks running` | CI on the last pushed commit is still going | grey |
| `2 unpushed` | commits not yet on the remote branch | grey |
| `5 changed` | files changed or added but not committed | grey |
| `no remote` | the repository has no remote to push to | grey |
| `clean` | none of the above | green |
| `No repo` | the session is not inside a git repository | grey |

The chip refreshes when a session starts and when each turn ends, in the background, so it never slows Claude down. CI states need the [GitHub CLI](https://cli.github.com) (`gh`) signed in; without it the chip skips them.

## Sync counter

If a script of yours syncs a repository on its own (a Stop hook that commits and pushes, say), it can write `<pushed> <failed> <ok|fail>` to `~/.claude/autosync.count`. The header then shows `4 pushed · 1 failed` at the right, red when the last sync failed. Without that file there is no counter.

## Run total and context gauge

Once a step is done, the header shows the run so far at the right: `14m · 84k T`, the time and tokens of every done step added up. Beside it, `Context 64%` is how full the session's context window is. It is grey, turns amber from 75% and red from 85%, so you see auto-compact coming.

## Solving line

The active step gets a dim second line, `Solving: …`, naming the problem its agent is working on, not the solution. Claude sets it per step with `goal`, written the way Apple writes: plain everyday words anyone could follow, the problem as you would see it, under 8 words, no code names or jargon.

| Yes | No |
|---|---|
| `Finished steps don't show as done` | `band misses steps finished without going active` |
| `The app can't find your repo` | `git status exits 128` |
| `Search results load slowly` | `patch the N+1 query` |

Without a goal, the line shows the task description of a running subagent on the step's model.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install live-checklist --marketplace starkitekt/Doer
```

Answer `y` to add the marketplace, then press Enter to pick the user scope.

From a shell:

```bash
claude plugin install live-checklist --marketplace starkitekt/Doer
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, then **Add marketplace** with `starkitekt/Doer`, then **Add plugin**.

## Use

The mod gives Claude a tool, `set`. Claude calls it with a title and a list of steps (`done`, `active`, `pending` or `wait`) whenever a step starts or finishes. Titles, steps and goals are kept to one line; a step with no text is skipped, and a blank title reads `Tasks`.

In the desktop app the band also follows the app's own task list (the steps Claude ticks off under its message), so it fills in every chat with no extra call. Once Claude calls `set` in a chat, `set` owns the band there, with its title and Solving lines. Run `claude plugin test .` for the test suite in `tests/`. To make it a habit, add a line like this to your `CLAUDE.md`:

> For every multi-step task, show a live checklist with the live-checklist tool. Make the title the goal you are solving, and update it at each step.

## License

MIT © 2026 [starkitekt](https://github.com/starkitekt). You are free to use, change and share it. Keep the copyright notice in `LICENSE` and in the source headers.
