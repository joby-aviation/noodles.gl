# In-app agent benchmark

Runs the editor's own assistant (`src/ai-chat/`) against scripted tasks in a real
browser and grades what it did to the project. It exists to answer two questions
with numbers rather than impressions: which on-device model is good enough for
which kind of task, and whether a change to the prompt, tools or context handling
made the assistant better or worse.

```sh
# From noodles-editor/
npm run bench:agent -- --provider webllm --model Qwen3-4B-q4f16_1-MLC --tasks T1,T2
npm run bench:agent -- --provider webllm --model Qwen3-4B-q4f16_1-MLC --knobs ctx=16384
npm run bench:agent -- --provider anthropic --model claude-haiku-4-5 --headless   # needs ANTHROPIC_API_KEY
npm run bench:agent:report -- bench/agent/results/<runId>.summary.json
npm run bench:agent:report -- --compare bench/agent/results/<before>.summary.json bench/agent/results/<after>.summary.json
```

The runner starts its own Vite dev server on a free port, opens system Chrome with a
persistent profile in `.profile/` (so model weights download once), and calls
`window.__noodlesAgentBench.run()` — a dev-only hook in
`src/ai-chat/bench/bench-hook.ts` that drives the same `AgentSession`, provider
factory and modification applier the chat panel uses. The hook only loads with
`?agentBench=1` on a dev build.

## Tasks

`tasks/*.md` — Markdown with YAML frontmatter, the prompt as the body. The
frontmatter follows the eval harness from PR #509 (`id`, `taskVersion`, `family`,
`tags`, `budget`, `grader`) plus fields for driving the in-app assistant:

| Field | Meaning |
| --- | --- |
| `tier` | T1 knowledge, T2 single edit, T3 multi-step build, T4 debug |
| `start` | an example under `src/examples/`, or `blank` |
| `setup.modifications` | applied before the first turn, e.g. to break a project for T4 |
| `turns` | scripted follow-up messages after the prompt |

Checks are listed in `grade.ts`. Scoring is #509's 0–4 scale: the fraction of
checks passed, capped at 40% when a mechanical check (`edgesValid`,
`applySucceeded`, `noNewOperatorErrors`, `noConsoleErrors`) fails. A run passes
when every check does.

## Results

`results/<runId>.summary.json` is small and meant to be committed, so runs from
different machines can be merged with `bench:agent:report a.json b.json`. Each
records the GPU adapter, device memory and git SHA. `results/raw/` keeps the full
transcript, tool calls and final project per run and is gitignored — regrade from
it after changing a check instead of re-running the model.

The columns worth watching on small models are `Trimmed` (the transcript
overflowed the window and was cut), `JSON fallbacks` (constrained output did not
parse) and `Unknown tools` (the model named a tool it was not offered). These come
from `diagnostic` events the providers emit and the chat panel ignores.
