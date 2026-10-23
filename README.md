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
| `clean` | none of the above | green |

The chip refreshes when a session starts and when each turn ends, in the background, so it never slows Claude down. CI states need the [GitHub CLI](https://cli.github.com) (`gh`) signed in; without it the chip skips them. Outside a git repository the chip is hidden.

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

The mod gives Claude a tool, `set`. Claude calls it with a title and a list of steps (`done`, `active`, `pending` or `wait`) whenever a step starts or finishes. To make it a habit, add a line like this to your `CLAUDE.md`:

> For every multi-step task, show a live checklist with the live-checklist tool. Make the title the goal you are solving, and update it at each step.

## License

MIT © 2026 [starkitekt](https://github.com/starkitekt). You are free to use, change and share it. Keep the copyright notice in `LICENSE` and in the source headers.
