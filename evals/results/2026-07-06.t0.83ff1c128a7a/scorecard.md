| task | session model | tier | n | total (median [range]) | mechanical | judge | turns | lookups | cost |
|---|---|---|---|---|---|---|---|---|---|
| author-scatterplot | us.anthropic.claude-opus-4-8 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 26 | 22 | $1.12 |
| author-scatterplot | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **1.60** [1.60–1.60] | 3.00 | 2.53 | 9 | 7 | $0.27 |
| author-scatterplot | us.anthropic.claude-sonnet-5 | T0 | 3 | **3.90** [3.77–4.00] | 4.00 | 3.80 | 41 | 38 | $1.05 |
| contextualize-operator | us.anthropic.claude-opus-4-8 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 25 | 23 | $0.96 |
| contextualize-operator | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 31 | 32 | $0.60 |
| contextualize-operator | us.anthropic.claude-sonnet-5 | T0 | 3 | **1.23** [1.23–4.00] | 0.00 | 2.46 | 31 | 32 | $0.76 |

_Scale 0–4. The [range] across sessions is the per-task noise band; cross-tier deltas inside overlapping bands are reported as "no change". Turns/lookups/cost are per-session medians — the efficiency axis that stays measurable when a cell saturates the score scale: "same 4.00, half the lookups" is a real tier gain._
