| task | session model | tier | n | total (median [range]) | mechanical | judge | turns | lookups | cost |
|---|---|---|---|---|---|---|---|---|---|
| animate-camera | us.anthropic.claude-opus-4-8 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 7 | 21 | $0.97 |
| animate-camera | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **4.00** [3.90–4.00] | 4.00 | 4.00 | 9 | 7 | $0.30 |
| animate-camera | us.anthropic.claude-sonnet-5 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 37 | 35 | $1.09 |
| author-scatterplot | us.anthropic.claude-opus-4-8 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 26 | 22 | $1.12 |
| author-scatterplot | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **1.60** [1.60–1.60] | 3.00 | 2.53 | 9 | 7 | $0.27 |
| author-scatterplot | us.anthropic.claude-sonnet-5 | T0 | 3 | **3.90** [3.77–4.00] | 4.00 | 3.80 | 41 | 38 | $1.05 |
| code-refs-containers | us.anthropic.claude-opus-4-8 | T0 | 3 | **1.17** [1.10–1.38] | 1.60 | 0.73 | 41 | 52 | $2.21 |
| code-refs-containers | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **1.60** [1.60–4.00] | 3.11 | 3.20 | 41 | 47 | $1.41 |
| code-refs-containers | us.anthropic.claude-sonnet-5 | T0 | 3 | **1.27** [1.10–1.27] | 1.60 | 0.93 | 41 | 40 | $1.42 |
| contextualize-operator | us.anthropic.claude-opus-4-8 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 25 | 23 | $0.96 |
| contextualize-operator | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 31 | 32 | $0.60 |
| contextualize-operator | us.anthropic.claude-sonnet-5 | T0 | 3 | **1.23** [1.23–4.00] | 0.00 | 2.46 | 31 | 32 | $0.76 |
| debug-blank-viz | us.anthropic.claude-opus-4-8 | T0 | 3 | **3.85** [3.85–4.00] | 4.00 | 3.70 | 15 | 12 | $0.55 |
| debug-blank-viz | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **1.60** [1.60–1.60] | 2.86 | 2.80 | 5 | 3 | $0.17 |
| debug-blank-viz | us.anthropic.claude-sonnet-5 | T0 | 3 | **1.60** [1.60–3.85] | 2.86 | 3.70 | 19 | 15 | $0.51 |
| modify-arcs | us.anthropic.claude-opus-4-8 | T0 | 3 | **4.00** [4.00–4.00] | 4.00 | 4.00 | 8 | 5 | $0.44 |
| modify-arcs | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **3.85** [3.85–3.85] | 4.00 | 3.70 | 5 | 2 | $0.15 |
| modify-arcs | us.anthropic.claude-sonnet-5 | T0 | 3 | **3.85** [3.85–3.85] | 4.00 | 3.70 | 13 | 10 | $0.43 |
| sql-h3-pipeline | us.anthropic.claude-opus-4-8 | T0 | 3 | **0.47** [0.47–0.47] | 0.00 | 0.93 | 41 | 40 | $2.19 |
| sql-h3-pipeline | us.anthropic.claude-sonnet-4-6 | T0 | 3 | **0.47** [0.33–0.47] | 0.00 | 0.93 | 41 | 60 | $1.10 |
| sql-h3-pipeline | us.anthropic.claude-sonnet-5 | T0 | 3 | **0.30** [0.15–0.47] | 0.00 | 0.59 | 41 | 40 | $1.05 |

_Scale 0–4. The [range] across sessions is the per-task noise band; cross-tier deltas inside overlapping bands are reported as "no change". Turns/lookups/cost are per-session medians — the efficiency axis that stays measurable when a cell saturates the score scale: "same 4.00, half the lookups" is a real tier gain._
