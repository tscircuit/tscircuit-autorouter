Conservative legalization QA at `2f77750b872ddfeae0026987de3bf01e253f9992` failed both numerical regressions.

| Case | Result | Errors | Censored | Original assertions |
| --- | --- | ---: | --- | --- |
| Bug107 | Numerical failure | 92 | No | All retained |
| Full MIDI keyboard | Numerical failure | 1 | No | All retained |

Bug107 errors: 18 trace overlaps, 63 via/trace clearances, one pad/trace clearance, ten via/via clearances. Full final routes and original DRC objects were captured after the original evaluation.

MIDI retains the exact via89/via97 drill clearance failure from the prior candidate: actual gap −0.19447727465848702 mm, required 0.1 mm.

No SVG assertion was reached after the numerical failures. Both tests completed before their external caps. The frozen source clone is clean, all original test and fixture hashes match, and no numerical or SVG assertions were removed. These local durations are correctness diagnostics, not benchmark comparisons.
