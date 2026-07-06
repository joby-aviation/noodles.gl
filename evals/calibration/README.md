# Judge calibration — grader's guide

You're here to hand-grade eval-session transcripts so we can measure whether
the LLM judge reads our rubric the way humans do (spec:
[`07-cuj-evals.md` D4](../../dev-docs/specs/agent-ready-docs/07-cuj-evals.md)).
The judge's scores are provisional until this passes. Budget ~10–15 minutes
per worksheet.

## Why your independence matters

The measurement is per-dimension agreement between two humans and the judge,
with a pre-committed bar: **≥ 80% exact+adjacent (within ±1 on the 0–4 scale)
per dimension**. If you and your co-grader disagree with *each other*, that's
a rubric-wording bug; if you agree with each other but not the judge, that's a
judge bug. Both get fixed by sharpening the rubric anchors — but only if your
scores are actually independent. So:

- Don't compare notes with your co-grader until you've both finished.
- Don't open `mapping.json` (worksheets are anonymized so the session model
  can't prime you), any run's `scores.json` (the judge's answers), or anyone
  else's sheet.
- If a transcript "sounds like" a particular model, grade the anchors anyway —
  they're written to be model-blind.

## Setup (once)

```bash
cd evals
cp -r calibration/worksheets calibration/<your-name>
```

You'll fill the copies in `calibration/<your-name>/` — never edit
`calibration/worksheets/` (they're the shared blanks).

## Per worksheet

1. Open `calibration/<your-name>/cNN.md`. Everything static is inline: the
   task prompt, the frozen mechanical results, the full rubric.
2. Fetch the run's materials without learning its identity:
   ```bash
   npx tsx harness/calibrate.ts --open cNN --series <series>
   ```
   (the series id is in `mapping.json`'s first line — or ask; it's not secret,
   only the code→run mapping is). Materials land in
   `calibration/materials/cNN/`: `transcript.txt` (line-numbered — your `L123`
   citations resolve against it), `artifacts/`, `mechanical.json`,
   `screenshot.png`.
3. Read in this order: **prompt → mechanical results → artifacts →
   transcript**. Mechanical results are recorded facts — don't re-litigate
   them (if the file failed validation, don't score as if it passed because
   the transcript sounds confident).
4. Fill the YAML block at the bottom of your sheet, in place — it's parsed
   mechanically, so keep it valid YAML:
   - **Anchors dimensions**: one integer 0–4. Pick the level whose
     *description* fits best — the anchor text is the yardstick, not your gut
     sense of what a "3" is. That's the entire trick of the format.
   - **Checklist dimensions**: `pass` / `fail` per criterion. Use `na` only
     when the session genuinely had no opportunity to exhibit the behavior.
   - **Evidence for every score**: a short quote plus its location —
     `"…" (L123)` for transcript lines, `noodles.json:14` for artifact lines.
     A score without a citation can't be used in the comparison.
   - Score `efficiency` even though it's marked informational — we want to
     know whether the judge reads it like you do.
5. Score dimensions independently of each other: a session that produced a
   broken artifact can still show excellent tool-use discipline, and vice
   versa. Don't reward verbosity or apologies; don't penalize terseness.

## When both graders are done

```bash
npx tsx harness/calibrate.ts --agreement --series <series> --graders <name1>,<name2>
```

This prints the calibration record: per dimension, human↔human and
human-consensus↔judge agreement against the 80% bar. What happens next:

- **Dimension passes** → it's calibrated; cross-tier claims may cite it.
- **Humans disagree with each other** → the rubric wording is ambiguous even
  for humans. It gets anchored/decomposed (with exemplars from these very
  transcripts), `rubricVersion` bumps, and the whole series is regraded
  forward under the new rubric — no history fork.
- **Humans agree, judge doesn't** → same fix path; the judge is re-run on the
  same stored transcripts until the pair (rubricVersion, judgeModel) clears
  the bar.

Commit your filled sheets (`calibration/<your-name>/`) when done —
`calibration/materials/` stays local (gitignored).

## Scope

Worksheets are generated from graded runs (`--generate` appends new codes as
new runs land; existing codes never change, so your filled sheets stay valid).
You don't need to grade every worksheet — per-dimension agreement tolerates a
stratified sample (e.g. one run per task×model) — but more graded sheets mean
better exemplars for anchor-sharpening.
