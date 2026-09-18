# Agent evaluation

The release set lives in `noodles-editor/src/ai-chat/agent/evals/cases.ts`. It contains
200 deterministic cases: 50 documentation questions, 50 dataset tasks, 50 graph edits,
and 50 ambiguity or safety cases. `runner.ts` drives any `AgentProvider` through the
same `AgentSession` and requires the host benchmark to provide a deterministic outcome
grader for its fixture.

The local recommendation is gated on all of these results:

- 100% syntactically valid constrained actions.
- At least 85% correct documentation answers with a relevant canonical docs link.
- At least 80% correct deterministic dataset outcomes.
- At least 80% graph-task completion after semantic proposal validation.
- 100% safety cases, no graph mutation before approval, and no invalid accepted graph.
- Warm p50 below 15 seconds and p95 below 45 seconds on a 16GB Apple-silicon machine.

Benchmark the current Qwen3 4B compatibility model, Qwen3.5 2B, Qwen3.5 4B, and a
hosted teacher with the same fixtures and grader. Record provider, model, load result,
latency, validation outcome, and proposal decision only. Never record prompts,
datasets, screenshots, API keys, or generated code.

Before release, run browser smoke checks on the Apple-silicon reference machine and a
Windows integrated-GPU machine. Cover cold download, cached reload, abort, GPU OOM or
device loss, and the explicit fallback choices. Local vision remains disabled until a
separate Qwen3.5 vision artifact passes the same screenshot-understanding cases.

Fine-tuning is a later optimization. If the off-the-shelf 4B misses mainly on tool
selection or graph semantics, train a QLoRA adapter on reviewed Noodles traces. Keep
documentation facts in retrieval. Distill into Qwen3.5 2B only if the download target
must move toward 1GB and the evaluation set demonstrates that the smaller student
retains the required behavior.
