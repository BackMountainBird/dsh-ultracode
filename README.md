# dsh-ultra

Ultra mode for [DeepSeek Harness](https://github.com/deepseek-harness) — a per-session effort tier, installed as an out-of-tree plugin bundle.

While active, every model request of the session is pinned to the configured reasoning effort (default `auto`: the deepest effort the serving model declares) and a deployment-owned orchestration-policy section rides the system prompt: workflow fan-out by default on substantive tasks, adversarial verification before reporting, context hygiene. Modeled on Claude Code's `ultracode` tier — the tier's substance is the standing orchestration policy, not a deeper reasoning parameter.

- `/ultra` — switch the current session to ultra mode
- `/ultra off` — leave it
- Composer **ULTRA** chip in the web UI with an animated rainbow border while active (static under `prefers-reduced-motion`)

State is recorded purely through the harness-owned `command/run` session event (appended by the commands runtime before every admitted `/ultra` execution), so resume and fork restore it from the log and the `ultra` projection the web chip reads folds the same events. No custom session events, no tool-catalog changes.

## Install

Requires a dsh installation (or source checkout) with a profile:

```sh
dsh plugin --profile <name> add dsh-ultra          # from npm, once published
dsh plugin --profile <name> add /path/to/dsh-ultra # from a local checkout
```

The local install stays linked to the checkout: rebuild with `pnpm run build` after changes. Validate with `dsh --profile <name> --dump-config`.

## Configuration (profile `dsh-ultra` row)

| Field | Default | Meaning |
|---|---|---|
| `section` | built-in policy text | Rendered as the `ultra:policy` prompt section while active |
| `effort` | `auto` | Effort pinned while active: `auto` resolves each request to the deepest effort the serving model declares (`max` on DeepSeek, `high` on GLM/Kimi routes); a literal value must be one of the serving adapter's declared efforts (fails loud otherwise) |
| `promptSectionOrder` | `120` | Prompt-section order |

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run build
```

Host plugin in `src/` (command, effort pin via the `agent/request` waterfall, prompt section, session projection); browser half in `src/client/` (composer chip via the `conversation.input.right` seat, rainbow stylesheet). Pinned against `@deepseek-ai/dsh-*@0.1.0-rc.7`.
