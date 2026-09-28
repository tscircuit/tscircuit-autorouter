# Shared-spine portfolio experiment

The prototype reuses actual A13 and B01 solvers to generate a thick shared spine, expands it into both differential-pair members, length-tunes, and validates emitted copper before accepting it. **The combined portfolio did not improve final valid-output count over the existing joint search in this run. It remains experimental and is not wired into a production pipeline.**

## Final measured comparison

| Mode | Output available | Output passes applicable checks | Newly selected strategy winners | Exceptions |
| --- | ---: | ---: | ---: | ---: |
| joint | 23/23 | 10/23 | 10 | 0 |
| a | 23/23 | 4/23 | 3 | 0 |
| b | 23/23 | 3/23 | 0 | 0 |
| all | 23/23 | 10/23 | 9 | 0 |

Three inputs already passed the applicable checks. They remain available even if a strategy cannot produce a replacement, so output validity is not evidence of a new strategy win. Both joint and combined modes converted seven initially invalid cases to valid outputs. A13 alone converted one; B01 converted none. B01 produced valid clear-corridor pairs in focused tests, but no accepted replacement on these 23 benchmark inputs.

A13 won sample-08 and the already-valid pilot control in the combined portfolio. A13 alone also replaced sample-14. Core, Pico, and both pilot stress cases remained invalid. There is no claim of a broader solve-rate gain or a statistically established speedup.

## Method and reproduction

The 23 fixed inputs comprise 18 existing length-matching fixtures, two faithful pre-postprocessing captures (core and Pico), and three explicitly labeled pilot post-output reoptimization cases. The pilot cases use saved routed output plus original constraints; they are not raw-board pipeline benchmarks. Inputs and manifests are frozen in [benchmark-data](../../scripts/differential-pair-portfolio/benchmark-data/all.json).

All four modes use the same normalized input hash per case, fixed seed 0, and a 5,000 ms shared per-mode wall budget. A single ordered pass ran on the same Blacksmith ARM64 machine with Bun 1.4.2. The existing joint algorithm also uses terminal-fix dependency revision `db10d1c1ef2ca6bc48327bd444549a4bdd215680`, keeping that fix common to all modes. No source algorithm changed during the final pass.

Implementation SHA256: `56926343c3af32715cd59444c4c479d01947a5f4cb914e189afee2106e9a126b`. The runner hashes its seven implementation files. The code was run before commit and the recorded Git revision refers to the base checkout; implementation hashes identify the measured source. The functional source was subsequently committed as `ab23cc7a26f9d524888da60a90cf025a444c3e6c`.

```sh
bun scripts/differential-pair-portfolio/benchmark.ts \
  --manifest scripts/differential-pair-portfolio/benchmark-data/all.json \
  --budget-ms 5000 --modes joint,a,b,all --out /tmp/pair-portfolio-results
```

The portfolio uses approximately 2 ms cooperative quanta, not parallel workers. Search, expansion, tuning and acceptance validation share the budget. Synchronous steps may overrun; the largest measured solver overrun was 222 ms (rounded up). Results completed after the deadline are not credited as winners. A separate reporting validation is timed and recorded outside the solver budget. Raw per-case timing, CPU, overrun, candidate counts, hashes and diagnostics are in [results.jsonl](results.jsonl).

Applicable checks include continuity, endpoints, metadata, preserved unrelated copper, clearance, skew, paired layer transitions, and declared coupling constraints. Coupling is sampled, with the explicit tolerances documented in the [harness README](../../scripts/differential-pair-portfolio/README.md). Legacy inputs without a hard gap declaration are not being certified for an invented target gap. These counts are not production success-rate or electrical-compliance claims.

## What the experiment established

- Existing high-density solvers can be reused as real pair-corridor generators; pair metadata in their own API is not required. Their output still needs expansion, tuning and full pair validation.
- A13 can help on clear corridors, but searches without fixed obstacles and rejects collisions afterward. B01 searches obstacles directly but has a 15 mm window limit.
- Two real conversion defects surfaced: A13 terminal grid snaps created offset backtracking; B01 replaced terminal via grid coordinates with exact ports while retaining true via stations separately. The adapters now normalize these representations, preserve actual terminals/vias, and pass regression tests.
- Shared-spine success alone is insufficient. Several expanded candidates could not be tuned or violated coupling/clearance after tuning. Both A and B encountered at least one terminal-station rejection in 17/23 cases along the chosen escape direction. Final validation alone does not establish whether a gap violation originated in expansion or length tuning.
- Accepted partial progress survives exhaustion, unsupported strategies cannot claim unchanged input as a win, and an invalid candidate cannot replace already-valid input.

## Next changes worth testing

1. Search several jointly validated terminal escape directions/stations rather than only the terminal-midpoint direction. This addresses the observed terminal-station rejection before a spine router can help.
2. Measure geometry immediately before and after length tuning. For initially valid expansions damaged by tuning, constrain length adjustment to preserve the pair corridor and explicit gap. Fix corner/offset geometry separately when expansion is already invalid.
3. After those changes, choose strategies by case capability and measured useful-candidate yield; uniform interleaving did not raise solve rate here. Keep the existing joint search as the primary strategy until measured gains justify integration.

## Local validation

`bun run format:check`, `bunx tsc --noEmit`, the added-code guard against the base revision, and `bun test tests/differential-pair-portfolio --timeout 9999999` passed in a clean checkout. The focused suite has 15 tests and 91 assertions. No snapshot files were regenerated and no CI reruns were manually dispatched.
