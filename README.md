<p align="right">
  <strong>English</strong> · <a href="./README_ZH.md">简体中文</a>
</p>

# DeepSeek Harness Ultracode

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-ultracode"><img src="https://img.shields.io/npm/v/dsh-ultracode.svg" alt="npm version"></a> <a href="./LICENSE"><img src="https://img.shields.io/npm/l/dsh-ultracode.svg" alt="MIT license"></a> <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724" alt="DeepSeek Harness plugin">
</p>

## One switch. Maximum depth.

`dsh-ultracode` adds an **ultra tier** to DeepSeek Harness: one per-session switch that pins every model request to the serving model's deepest reasoning effort and activates a standing orchestration policy — workflow fan-out by default on substantive tasks, adversarial verification before reporting, context hygiene.

Modeled on Claude Code's `ultracode` tier: the tier's substance is the standing orchestration policy, not a deeper reasoning parameter. Works on any provider whose adapter declares efforts from the shared vocabulary — DeepSeek (`max`), GLM / Kimi routes (`high` or `max`, whichever the model declares), or fully custom OpenAI-compatible routes.

<p align="center">
  <img src="./assets/readme.gif" width="100%" alt="Toggling ultra mode from the composer: the ULTRA chip switches the tier, the effort picker follows, and the composer card carries an animated rainbow border">
</p>

<p align="center">
  <em>Toggle it from the composer: a <strong>ULTRA</strong> chip appears next to the model selector, and while active the composer card carries an animated rainbow border.</em>
</p>

## What it changes

| Capability | What it changes |
| --- | --- |
| **Per-session effort tier** | One switch pins every model request to the serving model's deepest declared effort (`auto`), or a literal configured value. |
| **Orchestration policy** | A deployment-owned prompt section rides the system prompt while active: standing workflow opt-in, adversarial verification, narrow-the-wave retries on provider limits. |
| **Composer chip + rainbow border** | A ULTRA chip in the composer bar; the composer card glows while the tier is in force (static under `prefers-reduced-motion`). |
| **Picker consistency** | Toggling re-syncs the native effort picker through the public models API, so the display always matches the pinned reality. |
| **Delegation-aware** | Spawn subagents inherit the effective state through the delegation chain; forks inherit through their seeded prefix and freeze there. |

## Install

> [!NOTE]
> Requires an existing [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation (`@deepseek-ai/dsh-* >= 0.1.0-rc.6`).

### npm

```sh
dsh plugin --profile <name> add dsh-ultracode
```

### Build from source

```sh
git clone https://github.com/BackMountainBird/dsh-ultracode.git
cd dsh-ultracode
pnpm install
pnpm build
dsh plugin --profile <name> add .
```

Run `pnpm build` again after changing the source. The local plugin install remains linked to this checkout.

Validate the composed profile and restart DSH:

```sh
dsh --profile <name> --dump-config
dsh --profile <name> web
```

Then switch the tier on — from the composer chip, or directly:

> /ultra
>
> Use ultra mode to audit every integration point of this repository against its pinned dependencies, with parallel verification.

Leave with `/ultra off` (or click the chip again).

## How it works

1. **The switch is one command.** `/ultra` (and `/ultra off`) execute through the harness command runtime, which appends the `command/run` session event *before* the handler runs. That event is the durable state — the plugin defines no session event of its own, so resume and replay restore it for free, and the last command wins.
2. **The policy rides the system prompt.** While active, an `ultra:policy` section renders into every request. The text is deployment-owned config; the default is the orchestration policy (standing workflow opt-in, adversarial verification, context hygiene, narrow the wave when a provider's concurrency limit times parallel subagents out).
3. **The effort is pinned per request.** An `agent/request` waterfall listener — prepended, so it stays outside the per-agent model-selection listener that would strip it — replaces each request's reasoning effort. `auto` (default) resolves the deepest effort the serving model declares under the shared `off…max` vocabulary; a literal value pins exactly and fails loud if the adapter does not declare it.
4. **Delegation inherits it.** Spawn children walk the delegation chain (each child's `parentSession`, resolved against the live session store) and get the pin and policy too — the effort resolving against the *child's* model. Fork children inherit only through their seeded completed-turn prefix; a parent's later switch never reaches an already-spawned branch.
5. **The model is told.** Each genuine switch injects one plugin-source notice user message, so the model learns the change without diffing prompt sections.
6. **The picker follows.** The chip's toggle also re-submits the session's model selection through the public models API (deepest effort on switch, provider default on exit), so the native effort picker shows the tier actually in force. The request-side pin remains the guarantee.
7. **The web half is one client bundle.** A ULTRA chip occupies the composer's `conversation.input.right` seat; state rides the host-computed `ultra` projection (zero client-side ultra state), and while active the chip marks the composer card — an injected stylesheet renders the rainbow border. The bundle ships as a closure factory (`window.__ModuleLoader__.load`) with platform externals resolved through the loader's module table.

## Configuration

Profile row `dsh-ultracode`:

```yaml
- id: dsh-ultracode
  config:
    effort: auto
```

| Field | Default | Meaning |
| --- | --- | --- |
| `section` | built-in policy text | Rendered as the `ultra:policy` prompt section while active |
| `effort` | `auto` | `auto` pins each request to the deepest effort the serving model declares; a literal value must be one of the serving adapter's declared efforts (fails loud otherwise) |
| `promptSectionOrder` | `120` | Prompt-section order |

## Boundaries

- State is the harness-owned `command/run` event: no custom session events, and the tool catalog never changes across modes (request-cache stability).
- Inheritance only ever adds: subagent sessions have no user command surface, so children cannot opt out.
- The request-side pin is the truth; the picker sync is display consistency — a manual pick made mid-ultra realigns on the next toggle, while requests keep running pinned.
- Fan-out capacity belongs to the provider: the default policy tells the model to retry timed-out parallel work as a narrower wave instead of abandoning it.
- Ultra does not touch plan mode: the two are independent logged states and compose freely (`/plan` + `/ultra` = max-effort planning under plan's read-only constraints).

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm run verify
```

Host half in `src/` (command, effort pin, prompt section, session projection, delegation-chain walk); browser half in `src/client/` (composer chip, rainbow stylesheet, picker sync). Peer floors are `@deepseek-ai/dsh-*@^0.1.0-rc.6`; devDependencies pin the floor so development cannot drift onto newer-only APIs.

## License

[MIT](./LICENSE)
