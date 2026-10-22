# Judge calibration — grader's guide

**The ask:** hand-grade ~12 eval transcripts against the rubric (~2–2½ h total,
splittable) so we can check the LLM judge agrees with humans. Bar: ≥80%
within-±1 agreement per rubric dimension
([07 D4](../../dev-docs/specs/agent-ready-docs/07-cuj-evals.md)).

## Rules (they're the whole experiment)

- Both graders score the **same** sheets, **independently**. No comparing
  notes until both are done.
- Stay blind: don't open `mapping.json`, any run's `scores.json` (the judge's
  answers), or the other grader's folder.
- Every score needs a quote + location (`(L123)` or `noodles.json:14`).

## How

```bash
cd evals
cp -r calibration/worksheets calibration/<your-name>   # once
```

Then per worksheet in your copy (~12 min each): follow the numbered steps at
the top of the sheet — fetch materials, read prompt → mechanical.json →
artifacts → transcript, fill the YAML block in place.

Scoring in brief:
- **Anchors**: one integer 0–4 — pick the level whose *description* fits; the
  anchor text is the yardstick, not your gut.
- **Checklist**: `pass`/`fail` per criterion; `na` only if the session had no
  opportunity. Score `efficiency` even though it's informational.
- Mechanical results are facts — don't re-litigate them. Score dimensions
  independently of each other.

Commit your filled folder when done (`calibration/materials/` stays local).

## Which sheets

> **Shared sample** (stratified across both rubric families, all 7 tasks, all
> 3 session models, and a pass/fail mix — codes only, on purpose):
>
> **c01 · c04 · c14 · c16 · c33 · c34 · c37 · c41 · c47 · c53 · c56 · c59**

Both graders grade exactly that sample (overlap is required: human↔human
agreement is what separates rubric bugs from judge bugs). Extra sheets are
optional solo work — helpful exemplars, not part of the agreement record.

## Afterwards

```bash
npx tsx harness/calibrate.ts --agreement --series <series> --graders <a>,<b>
```

Failing dimensions get their anchors sharpened (rubricVersion bump → series
regrade); humans-disagree = rubric bug, humans-agree-judge-doesn't = judge
bug. Either way, your scores stand — only the judge re-runs.
