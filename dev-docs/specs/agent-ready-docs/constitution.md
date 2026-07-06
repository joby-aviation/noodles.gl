# Constitution

The cross-cutting rules of the agent-ready docs program, consolidated from the sub-plans where they were first stated. Sub-plans and implementation PRs comply with these articles; a PR that can't comply argues for amending the article instead, in the same PR, with rationale. If Spec Kit is adopted post-merge, this file becomes `.specify/memory/constitution.md` unchanged.

Rules carry their rationale. A rule that doesn't argue for itself gets renegotiated in every PR.

## Article 1: One owner per fact

Every fact has exactly one owning surface; everything else derives from it. `operators.ts` owns operator schemas. `docs/` markdown owns prose. `deploy-docs.yml` owns the public machine-readable surface. `src/agent-tools/` owns live tool definitions. Migrations own format history. Generators harvest from owners; they never define.

*Why: two owners of one fact is a drift engine. Every consolidation in this program (tool surfaces, deploy paths, validation lint) is a repair of exactly this violation.*

## Article 2: Generated and hand-written content never mix silently

Machine-owned content lives inside explicit markers; regeneration is idempotent, preserves prose byte-for-byte, and errors on ambiguous boundaries rather than guessing. Anything a script can compute is computed, with a `--check` drift gate in CI. Any prose a script can't compute gets a staleness signal instead (source-hash stamps, one scanner, one review queue for all long-form prose).

*Why: hand-maintained facts rot no matter how diligent the authors. AGENTS.md said version 6 while the code said 14.*

## Article 3: No invented history

Behavioral claims trace to code or tests read in the authoring session. Historical claims ("what we tried first") come only from the record: migrations, git log, PR descriptions, or a maintainer's note. When the record is silent, write the constraint rationale, which is derivable from code, and skip the origin story. Uncertainty is flagged inline for a human, never smoothed over.

*Why: confident, plausible, false lore is the one failure mode that poisons a repository of knowledge permanently.*

## Article 4: Two voices, strictly separated

Normative content (tables, schemas, behavior statements) is terse, present-tense, and checkable; it carries no opinion. Commentary (Remarks, essays) carries judgment and must contain at least one thing not derivable from the normative content. RFC 2119 keywords appear only in the `noodles.json` file-format spec, where interoperability promises live.

*Why: mixing the voices erodes both, producing hedged tables you can't trust and sterile remarks you don't finish. The separation also gives agents a clean rule: generated regions are ground truth, commentary is advice.*

## Article 5: Deletion and consolidation carry their courtesy

A proposal to delete, retire, or consolidate existing work states three things: what the original was for, the concrete failure mode now, and what preserves the capability. It then invites correction of the asserted intent: if the intent was misread, the spec changes, not the code.

*Why: the author of the original knows history the proposer doesn't, and a proposal that skips the courtesy converts that knowledge into defensiveness instead of review.*

## Article 6: Nothing changes what a greenfield agent sees without taking a sanctioned path

Any PR that alters the resources a fresh agent session encounters is either measured (labeled smoke eval), stripped (excluded by the eval tier builder), or forbidden (never committed, e.g. eval tasks verbatim in skills). Silent absorption into the baseline is prohibited.

*Why: it's how a measurement program stops measuring without anyone deciding to stop.*

## Article 7: Count what is countable; judge only what requires judgment

Anything a parser can compute from an artifact is a process metric, not a rubric dimension. Rubric dimensions have no bare scales: every dimension is anchored (per-level descriptions) or a checklist (binary sub-criteria), and applicability is tag-matched, never judged.

*Why: a judge spending attention on countable facts is wasted attention, and a count is more trustworthy than a judgment of the same fact.*

## Article 8: No quality claim without a calibrated instrument

Cross-tier or before/after claims cite only rubric dimensions whose (rubricVersion, judgeModel) pair passed human calibration at the pre-committed threshold, and only deltas outside the measured noise band. Instruments are versioned (rubric, judge model, validator); changing an instrument triggers regrade or recalibration, never a silent series break.

*Why: picking the bar after seeing the scores, or comparing scores from different instruments, is self-grading.*

## Article 9: Dependencies flow toward plain Node

Code meant to run under `npx` or in CI imports nothing Vite-built; shared definitions live at the most dependency-free point all consumers can import, and executors bind at the edge. One canonical tool registry; JSON Schema is the interchange format; snake_case names are canonical with aliases for compatibility.

*Why: the reverse arrow is impossible to build, and every hard-coded copy made to work around it becomes a drift liability (mcp-proxy's 224 lines of schemas).*

## Article 10: Capability outlives its container

Renames and moves keep aliases for at least one release cycle. Versioned formats retain every published schema version; new versions add files, they don't replace them. Machine-readable responses embed their provenance (version, commit) so consumers can detect skew instead of suffering it.

*Why: consumers pinned to an old release did nothing wrong.*

## Article 11: Review is sampling backed by machines

CI holds the mechanical line (drift, validation, link integrity, examples that load); human review spends itself on judgment: flagged uncertainties, one deeply-read sample per batch, historical accuracy. A failed sample bounces the whole batch, which is what keeps sampling honest. Generated bulk is committed separately from hand-written content so diffs stay reviewable.

*Why: two maintainers cannot proofread 130 pages, and don't need to if the machines are trustworthy and the sample is expensive to fail.*

## Amendment

Amend by PR to this file with the change and its rationale in the same diff. An amendment that weakens an article names the failure mode it accepts.
