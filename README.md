# Doer

A live checklist that floats above the Claude Code prompt. Claude sets the goal it is solving as the header, then ticks steps off as it works, so you are never left guessing what it is doing.

- **Done:** green disc with a tick, green text, and the tokens and time the step took at the right
- **In progress:** slowly turning dotted ring, marked *in progress* in serif italics
- **Not started:** filled light grey circle, grey text
- Each row starts with the model that runs the step, so the steps line up in one column
- Circles sit on the text baseline

Rows use the app's own font at your interface size. It works on light and dark themes, on a white band in light mode.

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
