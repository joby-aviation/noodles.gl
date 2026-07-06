# Sub-plan 06: Concept Essays

A small set of Raymond Chen-style long-form essays covering the concepts that reference pages cannot: how the system *thinks*. Reference pages answer "what does this operator do"; the essays answer "why does the whole thing work this way" — and every Remarks section gets something authoritative to link to instead of re-explaining the execution model in fragments.

## Goals

- Four to six published essays on the load-bearing concepts, cross-linked from operator Remarks and included in the machine-readable surface (`llms-full.txt`, docs mirrors, docs-index).
- Rescue the knowledge currently trapped in the unpublished `dev-docs/architecture.md` and in maintainers' heads.

## Non-goals

- Tutorials or how-tos (`docs/users/` owns those).
- One essay per subsystem — only concepts that multiple operator pages need to reference earn an essay.

## Requirements

1. WHEN an operator's Remarks needs to explain pull-based execution, path resolution, memoization, or the timeline model THEN it SHALL link to the relevant essay instead of re-explaining it inline.
2. WHEN the essays are published THEN they SHALL appear in the docs sidebar, in `llms-full.txt`, in the raw `.md` mirrors, and in the docs-index bundle consumed by the in-app assistant (all automatic once they live under `docs/`).
3. WHEN an essay makes a claim about engine behavior THEN the claim SHALL be traceable to source (file reference in an HTML comment) so future maintainers can re-verify it.

## Design

### Essay set (initial)

| # | Working title | Core question | Primary sources |
|---|---|---|---|
| 1 | Why Noodles pulls instead of pushes | Demand-driven execution, dirty flags, topological order, the RAF loop — and what that means for when your operator actually runs | `graph-executor.ts`, `dev-docs/architecture.md` |
| 2 | The path system, or: why every node has an address | Unix-style paths, relative resolution, containers, what `op('./sibling')` costs and buys | `utils/path-utils.ts`, `docs/developers/paths-containers.md` |
| 3 | What memoization actually caches | Value identity vs reference identity, why "pure operators" is a rule and not a suggestion, how to accidentally defeat the cache | `utils/memoize.ts` |
| 4 | Why the timeline is not a keyframe list | The native timeline model, bezier interpolation, how keyframed fields interact with the reactive graph, why hand-editing the `timeline` JSON is forbidden | `timeline-editor.tsx`, timeline stores |
| 5 | Fields are observables | What a Field really is (RxJS BehaviorSubject + Zod), value vs reference connections, why accessor fields are special | `fields.ts`, `docs/developers/field-system.md` |
| 6 | *(candidate)* The two kinds of truth in noodles.json | What's serialized vs derived, why only non-default inputs are saved, migrations as the file format's memory | `serialization.ts`, `__migrations__/` |

Essay 6 doubles as companion prose to the file-format spec (sub-plans 02/03) — the spec is normative RFC 2119 register; the essay is the Chen-voice "why".

### Placement and form

- Location: `docs/concepts/<slug>.md` — a new top-level docs section, sibling to `users/` and `developers/`, since the audience is both. New sidebar category "Concepts" in `website/sidebars.ts` between the existing two.
- Voice: Remarks rules from sub-plan 01's style guide apply wholesale (open with the real question, explain the constraint, second-person warnings, no marketing). Length target 800–1500 words — a blog post, not a chapter.
- Traceability: claims about engine behavior carry `<!-- src: noodles-editor/src/noodles/graph-executor.ts -->` comments so re-verification is mechanical.
- Cross-linking: sub-plan 01's 16 priority pages link to the relevant essays from Remarks; the essays link back to representative operator pages ("see TripsLayer for what this does to animation").

### Writing process

Essays are **LLM-drafted** under sub-plan 01's D6 protocol (context pack, traceability, no invented history, `<!-- verify -->` flags), from source + `dev-docs/architecture.md` + git/PR history, then **reviewed by a maintainer for historical accuracy** — the "what we tried first" material can't be derived from code, and wrong history is worse than no history. The maintainer review is the knowledge-capture event; budget it. For essays specifically, a short maintainer interview (10 minutes of "why is it pull-based? what broke with push?") recorded as bullet notes in the PR is often the cheapest way to feed the drafting session real history.

## Implementation steps

1. Create `docs/concepts/` with essays 1–5 (essay 6 when the file-format spec lands); add the sidebar category.
2. Wire cross-links into the 16 priority operator pages (sub-plan 01 step 6 — coordinate; ideally the same author pass).
3. Verify inclusion in `generate-context.ts` docs-index (it walks `docs/**/*.md` — automatic) and in sub-plan 02's mirrors/`llms-full.txt` (automatic once 02 lands).
4. Fold the still-accurate parts of `dev-docs/architecture.md` into essays rather than duplicating; leave `architecture.md` as the internal deep-dive with links to the published essays.

## Verification

1. `npm run build:website` — sidebar renders, `onBrokenLinks: 'throw'` passes for all cross-links both directions.
2. Maintainer sign-off recorded per essay (PR review) for historical claims.
3. Spot-check: the in-app assistant, asked "why didn't my operator re-run?", surfaces essay 1 via the docs-index.

## Dependencies

- None inbound (essays can be written any time). Outbound: 01's Remarks link to them; 02 distributes them; the file-format spec (02/03) pairs with essay 6.

## Open questions

- Whether `dev-docs/architecture.md` should eventually be retired into the essays entirely, or remain as the contributor-facing superset.
