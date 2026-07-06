# Sub-plan 01: Operator Reference Pages

MSDN CD-era reference documentation for every operator, published on the Docusaurus site: one page per operator with formal Syntax/Inputs/Outputs/Requirements sections generated from source, and hand-written Remarks in the Raymond Chen voice.

## Goals

- One reference page per operator (~130), each accurate to the code by construction.
- Field tables (name, type, default, flags) generated from `operators.ts`; prose (descriptions, Remarks, Examples) hand-written and never clobbered by regeneration.
- A generated category index page in the spirit of the MapLibre style-spec root.
- A style guide so multiple contributors converge on the same two voices.
- CI that fails when code and docs drift.

## Non-goals

- Machine-readable JSON output (sub-plan 02).
- Documenting fields.ts field classes themselves (covered by the existing `docs/developers/field-system.md`; reference pages link to it).
- Hand-written prose for all 130 ops in the first pass — 16 priority ops first, the rest ship as accurate skeletons.

## Requirements

1. WHEN a contributor runs `npm run generate:op-docs` THEN the system SHALL create or update one markdown file per operator under `docs/reference/operators/`, rewriting only marker-delimited regions.
2. WHEN a reference page contains hand-written content outside generated markers (including the Description column of field tables) THEN regeneration SHALL preserve it byte-for-byte.
3. WHEN an operator's `createInputs`/`createOutputs`/`displayName`/`description` change without regenerating docs THEN CI SHALL fail.
4. WHEN the generator runs twice in a row THEN the second run SHALL be a no-op (idempotence).
5. WHEN the website builds THEN every reference page SHALL appear in the sidebar without manual sidebar edits per page, and broken links SHALL fail the build (existing `onBrokenLinks: 'throw'`).

## Verified groundwork

- `noodles-editor/scripts/parse-operators.ts` already extracts `{name, displayName, description, inputs[], outputs[]}` per op via the TS Compiler API, with `fieldType`, `defaultValue` (literals only), and `options` (min/max/softMin/softMax/step/values/accessor/optional/showByDefault/accept/language/returnType). Consumed by `scripts/generate-context.ts`.
- 133 real Op classes exist in `opTypes` (operators.ts:8167). Extension ops are real classes and parse normally. The only virtual ops are the 13 `mathOps` aliases (operators.ts:1089) with `mathOpDescriptions`.
- There is no per-field `description` option and no per-field keyframeable flag in `fields.ts` — the Flags column is limited to optional/accessor/advanced; keyframeability belongs in prose.
- Docusaurus reads `../docs` directly, `routeBasePath: '/'`, manual `website/sidebars.ts`, no frontmatter convention (H1-first), `editUrl` points at `docs/` on GitHub — pages must be real committed files.

## Design

### D1. Coexistence: committed files with marker-delimited generated regions

Each op gets one committed file at `docs/reference/operators/<kebab>.md`. The generator rewrites only content between markers, and scaffolds the full template when the file doesn't exist:

```markdown
<!-- gen:begin inputs -->
...script-owned...
<!-- gen:end inputs -->
```

Rejected alternatives:

- *Build-time merge of separate prose files*: breaks `editUrl`, loses GitHub markdown preview, and `generate-context.ts` (which indexes `docs/**/*.md` for the in-app assistant) would index proseless skeletons.
- *Prose in source*: multi-paragraph essays as string literals inside an 8,353-line `operators.ts` — unreviewable diffs, doc edits coupled to app rebuilds.
- *MDX components over a JSON reference file* (the MapLibre style-spec approach — pages contain `<OpInputs op="IconLayerOp" />` rendered at build time): cleaner in that the generator never parses its own output, but it fails a structural constraint of this program — sub-plan 02 serves the markdown files **as data** (raw `.md` mirrors, `llms-full.txt`, docs-index for the in-app assistant), and a component tag carries no field table for those consumers. It would also switch the `.md`-only docs tree to MDX and break GitHub preview of the tables. With markers, the markdown *is* the artifact everywhere.

The marker pattern has broad precedent (`terraform-docs`, `doctoc`, README-injection tools). Known weak spot: nothing prevents hand-edits inside a generated region other than the next regeneration reverting them — so the generator emits a one-line warning comment at the top of each region ("generated — edits here are overwritten, except the Description column").

**The Description-column problem.** Field tables live inside generated regions, but their Description column is hand-written. Solved by **read-back preservation**: before rewriting a table region, the generator parses the existing table keyed by field name (column 1) and carries each row's Description cell forward. New fields get an empty cell; removed fields drop out; renamed fields lose their text — visible in the diff, which is the correct signal. No sidecar files.

### D2. Page template

The "Syntax" equivalent for a node-based operator is the serialized node form plus the expression-language access form. Sections in fixed order (`[gen]` = inside markers, `[hand]` = outside):

```markdown
# <DisplayName>

<!-- gen:begin summary -->
<one-line static description>
<!-- gen:end summary -->

[hand: optional expanded intro paragraph]

## Syntax
<!-- gen:begin syntax -->
```json
{ "type": "<ClassName>", "id": "/<kebab-name>" }
```
```js
op('/<kebab-name>').out.<firstOutput>   // read an output
op('/<kebab-name>').par.<firstInput>    // read an input parameter
```
<!-- gen:end syntax -->

## Inputs
<!-- gen:begin inputs -->
| Name | Type | Default | Flags | Description |
<!-- gen:end inputs -->

## Outputs
<!-- gen:begin outputs -->
| Name | Type | Description |
<!-- gen:end outputs -->

## Remarks
[hand — Chen voice]

## Examples
[hand — noodles.json fragments, expression snippets, links to example projects]

## Requirements
<!-- gen:begin requirements -->
| | |
|---|---|
| **Category** | [Number](./index.md#number) |
| **Type name** | `NumberOp` |
| **Defined in** | `noodles-editor/src/noodles/operators.ts` |
<!-- gen:end requirements -->

## History
<!-- gen:begin history -->
[generated from src/noodles/__migrations__/ — one bullet per migration that touches
this operator, e.g. "v7 — input `data` renamed to `items`"; omitted entirely when
no migration mentions the op]
<!-- gen:end history -->

## See Also
[hand — seeded once by the scaffold with same-category siblings, then hand-curated]
```

Cell rendering rules:

- Enum `values` render in the Type column: `` `StringLiteralField` — `"pixels"` \| `"meters"` \| `"common"` ``.
- Numeric ranges render in the Default column: `` `1` (0–1, step 0.01) ``; soft ranges annotated `soft max 100`.
- Flags column badges: `optional`, `accessor`, `advanced` (= `showByDefault: false`).
- `accept`/`language`/`returnType` render as small annotations under the Type value.
- Non-literal defaults (compound objects, `new ExtensionField()`, arrow functions, transformed colors) render the source text truncated to ~48 chars in backticks with a `*` footnote: "computed default — see source."

### Worked example: `docs/reference/operators/number.md`

```markdown
# Number

<!-- gen:begin summary -->
A number.
<!-- gen:end summary -->

Produces a single numeric constant. The simplest operator in Noodles; also the one
you will place most often.

## Syntax

<!-- gen:begin syntax -->
```json
{ "type": "NumberOp", "id": "/my-number" }
```

```js
op('/my-number').par.val   // the input parameter
op('/my-number').out.val   // the computed output
```
<!-- gen:end syntax -->

## Inputs

<!-- gen:begin inputs -->
| Name | Type | Default | Flags | Description |
|------|------|---------|-------|-------------|
| `val` | `NumberField` | `0` (step 1) | | The numeric value to emit. |
<!-- gen:end inputs -->

## Outputs

<!-- gen:begin outputs -->
| Name | Type | Description |
|------|------|-------------|
| `val` | `NumberField` | The value of the `val` input, passed through unchanged. |
<!-- gen:end outputs -->

## Remarks

Number is an identity function: `execute` returns its input untouched. So why does it
exist at all, when every NumberField on every other operator can hold a literal?
Because a Number node gives the value an *address*. Once a constant has a path, three
things become possible: five layers can reference `op('/point-size').out.val` and you
change it in one place; the timeline can animate it; and an Expression node can do
arithmetic on it. If you find yourself typing the same literal into two different
parameter fields, that is the graph telling you it wants a Number node.

The output is a plain `NumberField` with no step or range constraints — constraints
on the *input* field are UI affordances for the editor's drag-to-scrub control, not a
contract on the value. Wire in `Infinity` via an expression and Number will happily
pass it along.

## Examples

Drive the radius of two Scatterplot layers from one constant:

```js
// In each layer's getRadius expression
op('/dot-radius').out.val * 2
```

## Requirements

<!-- gen:begin requirements -->
| | |
|---|---|
| **Category** | [Number](./index.md#number) |
| **Type name** | `NumberOp` |
| **Defined in** | `noodles-editor/src/noodles/operators.ts` |
<!-- gen:end requirements -->

## See Also

[Math](./math.md), [MapRange](./map-range.md), [Extent](./extent.md),
[BezierCurve](./bezier-curve.md), [Ramp](./ramp.md), [Time](./time.md)
```

For a complex op like IconLayer, the same skeleton holds; its Remarks carry the Chen material (the icon cache and its cap, why `getIcon` accepts a URL *or* an accessor returning `{url, width, height}`, the `sizeUnits`/`billboard` gotchas) and See Also links the upstream deck.gl IconLayer docs.

### D3. Generator

New file `noodles-editor/scripts/generate-operator-docs.ts` (tsx). npm scripts in `noodles-editor/package.json`:

```json
"generate:op-docs": "tsx scripts/generate-operator-docs.ts"
```

with a `--check` flag (render to memory, diff against disk, exit 1 with a file list).

**Parser extensions** (`parse-operators.ts`, additive only so `generate-context.ts` is unaffected):

1. `defaultValueText?: string` on `OperatorInput` — when `getConstantValue` returns `undefined` for a present argument, capture `expr.getText(sourceFile)`.
2. Export `parseMathOps()` reading the `mathOps` and `mathOpDescriptions` object literals (both simple string maps, parseable with the existing `parseObjectLiteral`).

**Data flow:**

```
parseOperatorsFile(src/noodles/operators.ts)   → Map<className, meta>
categories (src/noodles/components/categories.ts)
parseMathOps()                                 → alias map
  ↓
buildDocModel(): className → { kebabName, category, meta, aliases? }
  ↓
per op: renderRegions() → file exists ? preserveDescriptions() + spliceRegions()
                                      : renderScaffold()
  ↓
renderIndex() → docs/reference/operators/index.md (fully generated, header says so)
```

Decisions:

- **Flat directory**, `<kebab>.md` from decamelized displayName (`IconLayerOp` → `icon-layer.md`, `DuckDbOp` → `duck-db.md`), with a collision assert. Per-category subdirectories were rejected: category membership changes over time and moving files orphans prose and breaks URLs. MSDN was alphabetical; the categorized view belongs to the index.
- **Index page**: one H2 per category (13 from `categories.ts`, unlisted ops fall back to `utility` exactly as `generate-context.ts` does), each op as `[DisplayName](./kebab.md) — description`. The index header also carries the **coverage signal**: "N of M operators have written Remarks" — the generator knows which pages have empty Remarks sections, and making the number visible on the landing page is what keeps Phase C's prose backlog burning down.
- **History region**: a `parseMigrations()` pass over `src/noodles/__migrations__/*.ts` (they use structured helpers — `renameHandle`, `changeDefaultValue` — plus op-type string literals, so a static scan attributes most migrations to operators). Emits the generated History section per page: "v7 — input `data` renamed to `items`", "v14 — MapStyleOp removed, use MaplibreBasemapOp". Migrations are the repo's existing record of "what we tried first" — this mines them instead of asking anyone to remember. Unattributable migrations are listed on the index page rather than dropped silently.
- **Math aliases**: one `math.md` page. Generated "Operations" region lists the 19 `operator` enum values; generated "Aliases" region lists the 13 virtual ops with their descriptions, each noted as "inserts a Math node with `operator` preset". No 13 stub pages.
- **Splice safety**: error on missing or duplicated markers rather than guessing.
- **Prose-staleness stamp**: each page gets a generated comment recording a hash of the operator's source range (`<!-- gen:src-hash abc123 -->`). When the hash changes but nothing outside the generated regions was touched since, the page lands on a "needs prose review" list emitted by `--check` (a warning list, not a build failure). Schema drift is caught hard by CI; this converts silent *prose* rot into a visible queue.
- **Examples are tested**: `--check` also extracts fenced `json` blocks from Examples sections and validates them (project-shaped snippets against the project schema / lint rules from sub-plans 02/04), and verifies that `op('/path').out.X` / `.par.X` snippets reference fields that exist on the documented operator. Broken examples are worse than no examples — agents copy them verbatim.

### D4. Sidebar

One addition to `website/sidebars.ts` between the two existing categories:

```ts
{
  type: 'category',
  label: 'Operator Reference',
  collapsed: true,
  link: { type: 'doc', id: 'reference/operators/index' },
  items: [{ type: 'autogenerated', dirName: 'reference/operators' }],
},
```

Autogenerated items sort alphabetically — correct for a reference — and op #134 needs no sidebar edit. Verify at build time whether Docusaurus dedupes `index` from the autogenerated list when it's the category link; if it double-lists, exclude it via a custom `sidebarItemsGenerator`.

### D5. Style guide

New page `docs/developers/documenting-operators.md`, added to the Framework Developers sidebar group after `creating-operators`. Public docs site rather than dev-docs because the audience is the same contributors who read "Creating Operators", and `generate-context.ts` indexes it so the in-app assistant learns the house style for free.

**Why these choices** (include this rationale in the guide itself — a style guide that doesn't argue for its rules gets renegotiated in every PR):

- *Why a fixed MSDN section order*: knowledge is only retrievable if the reader knows where to look **before** they look. A fixed order turns reading into addressing — a human jumps straight to Inputs; an agent can extract "the Remarks section of PathLayer" mechanically. The sections function as an API, and APIs don't reorder themselves per page.
- *Why two voices, strictly separated*: the tables are a **contract** — they must be tersely checkable and are machine-harvested, so they carry no opinion. Remarks are **judgment** — they need an author's voice or nobody reads them. Mixing the two erodes both: hedged tables you can't trust, sterile remarks you don't finish. The separation also gives agents a clean rule: treat generated regions as ground truth, treat Remarks as expert advice.
- *Why Chen specifically*: reference docs rot because nobody reads them, and nobody reads them because they answer questions nobody asked. The Chen form — open with the question a real user hit, explain the constraint that made the design inevitable — guarantees each Remarks section answers an *actual* question, and narrative encodes causality better than bullet lists (you remember "the waiter, not the kitchen" long after you've forgotten a performance note). The voice is also a quality filter: you cannot write in it without knowing something, which is why "at least one thing not derivable from the field table" is enforceable rather than aspirational.
- *Why RFC 2119 is confined to the file-format spec*: capitalized MUST/SHOULD is a compatibility signal, and signals dilute with use. Operator behavior legitimately evolves (that's what migrations are for); the file format is the promise other tools build on. Keywords go where the promise is.

Contents (~1 page):

1. **Workflow** — run `npm run generate:op-docs` after adding/changing an op; edit only outside `<!-- gen: -->` markers, *except* the Description column of field tables, which is preserved; CI fails if you forget to regenerate.
2. **Normative voice** (summary, tables, behavior statements): present tense, third person, MSDN register ("Returns the…", "If *data* is empty, the output is `undefined`"). Plain lowercase prose — **RFC 2119 keywords do not appear on operator reference pages.**
3. **RFC 2119 scope** — the capitalized keywords MUST / MUST NOT / SHOULD / SHOULD NOT / MAY (defined by [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), the IETF convention RFC 7946/GeoJSON is written in) are reserved **exclusively for the `noodles.json` file-format spec**: `docs/developers/authoring-noodles-json.md` and the JSON Schema documentation (sub-plans 02/03), where Noodles makes interoperability promises — the `version` field, node/edge shapes, handle naming (`out.`/`par.`), and the edge-id formula. Used the way RFC 7946 uses them: sparingly, capitalized, only for contract-strength statements ("`sourceHandle` MUST begin with `out.`"). Everywhere else, ordinary prose.
4. **Remarks voice** (Raymond Chen): first person plural allowed; answer "why is it like this", "what will bite you", "what did we try first". Open with the question a real user actually hits; explain the constraint that made the design inevitable; warn in second person about the trap the reader is about to walk into. Every Remarks section must contain at least one thing not derivable from the field table. Never restate what the tables already say. No marketing adjectives.
5. **Examples** — every example must load; reference real projects under `noodles-editor/src/examples/` where possible.
6. **Before/after voice sample** (include verbatim in the guide). Normative — belongs in tables and behavior statements:

   > `AccessorOp` returns a function evaluated per data item. Avoid heavy computation in accessors.

   Remarks — the Chen voice, carrying what the table cannot:

   > An accessor doesn't run once — it runs once *per row*, and again every time deck.gl decides the attribute needs recomputing. Nobody sets out to compute a great-circle distance three million times a second; it happens one innocent-looking line at a time. If your expression does more than index into `d`, do that work upstream in a CodeOp and let the accessor just read the answer. The accessor is the waiter, not the kitchen.

   The NumberOp page in D2 demonstrates the same moves: open with the obvious objection ("why does an identity function exist?"), answer with design rationale (a constant with an *address* can be shared, animated, referenced), then flag the non-obvious contract (input min/max are UI affordances, not value clamps).

### D6. LLM prose drafting protocol

The intent is that **an LLM drafts all of the prose** — Remarks, Examples, field descriptions — with maintainers reviewing rather than writing. The plan must set the LLM up to succeed, and must make its characteristic failure mode — confident fabrication, especially of history — impossible to merge. The protocol below ships as a "Drafting with an LLM" section of the style guide, so any drafting session picks it up automatically (the style guide is indexed by `generate-context.ts` and lives at a stable URL).

**Exemplar canon first.** Before any batch drafting, maintainer + LLM co-write 2–3 pages to convergence (suggested: NumberOp — the philosophical one, IconLayerOp — the gotcha-dense layer, DuckDbOp — the one with reactive-reference semantics). These become the few-shot exemplars every subsequent drafting prompt references. Voice is transmitted by example, not by adjective list; the style guide's rules exist to *review* against, the exemplars exist to *write* from.

**Context pack per operator.** The drafting session must read, in order:
1. The operator's `execute()` source — the actual contract.
2. The operator's **unit tests** — they encode the edge cases someone cared enough to pin (SelectOp's clamp-vs-wrap behavior is a test before it's a sentence).
3. Migrations touching the op (the generated History region) — the only sanctioned source of "what we tried first".
4. Example projects using the op (`grep` the type across `src/examples/*/noodles.json`) — real usage for the Examples section.
5. For layer ops: the upstream deck.gl layer docs — Remarks should cover what Noodles *adds or changes*, not re-document deck.gl.
6. `critical-user-journeys.md` — the questions users actually ask.

**Hard rules** (merge-blocking, checked in review):
- Every behavioral claim must be traceable to code or tests read in the drafting session. No claims from the model's general knowledge of "how such things usually work".
- **No invented history.** "What we tried first" may come from migrations, git log, PR descriptions, or a maintainer's note — never from plausible inference. When the history isn't in the record, write the *constraint* rationale (which is derivable from code) and skip the origin story.
- Anything uncertain gets flagged inline: `<!-- verify: is the 50-entry icon cache cap intentional or historical? -->`. Flags are for the maintainer reviewer; a page merges only when its flags are resolved or removed.
- Never restate what the generated tables already say (the voice rules enforce this, but it's the first thing to check in review).

**Delivery cadence.** Draft PRs in batches of ~10 pages grouped by category (all layer ops together, etc.), so one reviewer holds one mental model per batch. Reviewer attention goes to flagged claims and one spot-checked page per batch; the mechanical checks (Examples validation, drift, idempotence) are CI's job, not the reviewer's.

**Human + agent batch workflow (the long tail, ~114 pages).** This is not open-ended "write the rest eventually" — it's a repeatable loop with defined roles. The human is the **historian and taste arbiter**; the agent is the **drafter and evidence gatherer**. Humans never start from a blank page; agents never invent history.

Per batch (~10 ops, one category, one PR):

1. **Order the backlog by impact, not alphabet**: count each op type's occurrences across `src/examples/*/noodles.json` (and product analytics if available); document the most-used categories first. The index coverage counter is the backlog tracker — no separate spreadsheet.
2. **Questions before prose**: the agent assembles the D6 context packs for the whole batch and emits a *question sheet* — every would-be `<!-- verify -->` flag, collected up front ("is IconLayer's 50-entry cache cap intentional?", "why does GeoJsonLayer have both `stroked` and `getLineWidth`?"). This is the batch's entire demand on human memory, concentrated into one sitting.
3. **The human answers in bulk** — or writes "no history known" per item, which licenses the agent to write the constraint rationale and skip the origin story. Ten minutes of maintainer time per batch, async, in a PR comment or the question-sheet file.
4. **The agent drafts all pages**, incorporating the answers, exemplar canon open in context, and opens the PR with a one-line provenance note per page (which sources fed it, which answers it used).
5. **Review is sampling, not proofreading**: the reviewer checks the resolved question sheet, reads one randomly-chosen page in full, and skims the rest for voice. CI holds the mechanical line. If the sampled page fails, the batch goes back — the sample *is* the quality gate, so failing it must be expensive.
6. **Merge; the coverage counter ticks; the next batch starts.** At ~1 batch per week of one maintainer-hour each, the long tail clears in a quarter without any heroic documentation sprint.

The question-sheet step is the load-bearing one: it converts the scarce resource (maintainer memory) from a per-page review obligation into a per-batch interview, and it's the only step where knowledge that exists nowhere but in someone's head enters the repository.

## Implementation steps

1. Extend `noodles-editor/scripts/parse-operators.ts` (`defaultValueText`, `parseMathOps()`, `parseMigrations()`); verify `npm run generate:context` output is unchanged except additive keys.
2. Write `noodles-editor/scripts/generate-operator-docs.ts` (functions: `buildDocModel`, `kebabName`, `renderInputsTable`, `renderRegion`, `renderHistory`, `parseExistingDescriptions`, `spliceRegions`, `renderIndexPage` incl. coverage count, `stampSourceHash`, `checkExamples`, `main({check})`); add the npm script.
3. First generation: commit ~121 files under `docs/reference/operators/` (133 classes − 13 aliases folded into `math.md` + `index.md`; exact count from the collision assert).
4. Sidebar entry in `website/sidebars.ts`; link the new index from `docs/users/operators-guide.md`.
5. Write `docs/developers/documenting-operators.md`; add to sidebar.
6. Prose, per the D6 protocol: co-write the exemplar canon (NumberOp, IconLayerOp, DuckDbOp) with a maintainer, then LLM-draft the remaining priority pages — FileOp, CodeOp, ExpressionOp, AccessorOp, MathOp (carries the aliases), ScatterplotLayerOp, PathLayerOp, GeoJsonLayerOp, DeckRendererOp, MaplibreBasemapOp, MapViewOp + MapViewStateOp (cross-linked pair), ContainerOp, TripsLayerOp — then the rest in category batches of ~10.
7. CI: add `npm run generate:op-docs -- --check` to the `lint-format` job in `.github/workflows/test.yml` (working-directory `noodles-editor`). The check covers drift, Examples validation, and emits the prose-staleness warning list. No `deploy-docs.yml` change — docs are committed; generating at deploy time would mask drift.
8. Accrual ritual: add a line to the PR template (create `.github/pull_request_template.md` if absent): "Does this PR change an operator's behavior? Update its Remarks in `docs/reference/operators/`." Cheap, but it's the difference between docs written once and docs that keep pace.

## Verification

1. Idempotence: run the generator twice; the second run is a no-op.
2. Prose survival: edit a Description cell and a Remarks paragraph, re-run, confirm both survive.
3. Drift: change a default in `operators.ts`; `--check` fails.
4. `npm run build:website` locally: passes `onBrokenLinks: 'throw'`, sidebar renders, confirm index dedup behavior.
5. `npm run generate:context` still succeeds and indexes the new pages.

## Dependencies

- None inbound. Outbound: 02 embeds the Remarks sections of these pages in `/r/ops/*.json`; 03's `get_operator` returns them; 02 degrades gracefully until this lands.

## Open questions

- Whether to add a per-field `description` option to `fields.ts` later so descriptions also surface in the editor UI. If so, the generator prefers source and treats the markdown cell as fallback; the marker format doesn't change.
