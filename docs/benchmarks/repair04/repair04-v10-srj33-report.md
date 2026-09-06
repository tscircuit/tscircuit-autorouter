# repair04 V10: bounded repair benchmark

The complete current SRJ33 dataset changes from **0/15 to 4/15 boards passing final default DRC (+26.67 percentage points)**. The complete older revision changes from **0/37 to 6/37 (+16.22 points)**. Both sides include the dedicated via-in-pad and via-to-pad clearance checks. Current newly passing boards: sample006, sample048, sample049, sample056.

The baseline has zero passing boards, so a relative percentage increase is undefined; a +30% relative improvement cannot be established from that baseline. The result does not reach a 30-percentage-point gain.

This report describes frozen production V10, not intermediate prototypes. It does not infer CI success from benchmark results. The original V8 claim omitted `checkViasInPads` and `checkViaPadClearance`; its clean-board totals are withdrawn. Historical V9 evidence remains separate. Neither earlier run contributes candidate results to V10.

- Solver: [tscircuit/repair04](https://github.com/tscircuit/repair04), frozen benchmark commit `fc78a05d4c65cb41dc38214bbeed5f4d5657055d`.
- Pipeline9 integration: [PR #2420](https://github.com/tscircuit/tscircuit-autorouter/pull/2420), frozen benchmark commit `0e9cd6f8f4d31a09439948fed6e7f0155290ad8c`.
- Bootstrap: [handbook guide](https://github.com/tscircuit/handbook/blob/main/guides/bootstrapping-repos.md), actual create-repo templates and [create-repo PR #70](https://github.com/tscircuit/create-repo/pull/70).

The later delivery router commit `984831c791a5cf6b5160ca293dd4d1a11971544b` and core commit `bdc284a4085c4e7ab533e1269e8b9c18ca2e98dd` are recorded separately. Their committed changes are limited to verified dependency transport metadata, reviewed test/snapshot expectations, CI configuration and documentation. The rebuilt replay bundle is byte-identical to frozen V10. This establishes executable equivalence, not a new routing measurement or a successful CI run on the later commit.

## Complete dataset results

| Dataset and checker | Baseline passing | Candidate passing | Change |
|---|---:|---:|---:|
| Current SRJ33, default DRC | 0/15 | 4/15 | +26.67 pp |
| Current SRJ33, relaxed DRC | 0/15 | 4/15 | +26.67 pp |
| Older SRJ33, default DRC | 0/37 | 6/37 | +16.22 pp |
| Older SRJ33, relaxed DRC | 0/37 | 6/37 | +16.22 pp |

The current revision is [`026a78cb005ab33dde24f2db8fefbfd8d8efa614`](https://github.com/tscircuit/dataset-srj33-drc-failures/tree/026a78cb005ab33dde24f2db8fefbfd8d8efa614), committed September 5, 2026 at 19:34:04 UTC. All 15 published inputs are included. Their raw hashes match the corresponding inputs in the complete older revision [`f566b62be0f83395d9ab63ddc068f9d645b68b16`](https://github.com/tscircuit/dataset-srj33-drc-failures/tree/f566b62be0f83395d9ab63ddc068f9d645b68b16). Membership follows the published dataset, not repair04 outcomes.

The dataset's independent authenticity audit retained these 15, classified 16 as DRC-passed under a separate router/conversion run, and excluded six with unconfirmed error evidence: sample004, sample010, sample020, sample025, sample032, sample052. These labels are distinct from this benchmark's baseline. All 37 remain in the older-denominator result, with audit labels in the CSV.

| Current board | Baseline default errors | Final default errors | Baseline relaxed errors | Final relaxed errors |
|---|---:|---:|---:|---:|
| sample002 | 9 | 2 | 9 | 2 |
| sample003 | 20 | not solved | 20 | not solved |
| sample005 | 91 | 4 | 91 | 4 |
| sample006 | 1 | 0 | 1 | 0 |
| sample044 | 32 | 17 | 32 | 17 |
| sample045 | 75 | not solved | 75 | not solved |
| sample046 | 25 | 3 | 25 | 3 |
| sample048 | 17 | 0 | 17 | 0 |
| sample049 | 8 | 0 | 8 | 0 |
| sample050 | 17 | 2 | 17 | 2 |
| sample051 | 3 | 3 | 3 | 3 |
| sample053 | 73 | 12 | 73 | 12 |
| sample054 | 8 | 2 | 8 | 2 |
| sample055 | 40 | not solved | 40 | not solved |
| sample056 | 6 | 0 | 6 | 0 |

The current candidate completes 12/15 solves and times out on 3/15. Across all 37 boards, baseline/candidate completed counts are 37/34; timeout counts are 0/3. Every input remains in the denominator. Unsolved candidates: sample003, sample045, sample055. Candidates without a validated replay: None. Pass-to-fail regressions: 0. Final default error-count regressions: None. Null measurements mean unavailable, not zero.

The JSON field `strictDrc` means the existing default `getDrcErrors` thresholds with `includeViaPadChecks: true`. Relaxed DRC supplies 0.1 mm trace and via clearance with the same added checks. Both measure final output after both repair04 passes, joint repair, length matching and power expansion. A local score or intermediate-stage zero never counts as a passing board. These totals measure the complete integration, including the joint-proposal acceptance guard; no separate ablation isolates each stage's contribution.

## Bounded repair policy

Pipeline9 now runs these stages in order:

1. Immediately after repair03 (`globalDrcForceImproveSolver`), repair04 tries trace movements only: at most three regions, each with 512 candidate evaluations by default. Existing vias are fixed and layer changes are disabled.
2. The normal `pipeline9JointDrcRepairSolver` runs, with a final-reference acceptance guard that rejects a worsening proposal while retaining its verified input. Solver errors still surface.
3. Advanced repair04 reads the joint stage's current HD routes and current updated/mutated preloaded copper. A board with zero expanded reference errors passes through unchanged. Otherwise it may try relocation of explicitly identified existing via-pad violations, followed by guarded layer bridges. This stage has a shared limit of 32 regions. Relocation searches use at most 512 candidates per region; bridge searches use at most 8,000. The explicit `traceOnlyFirst: false` flag skips repeating the planar search before a permitted bridge.
4. Length matching and power expansion consume the accepted advanced output.

Regions start at 10×10 mm and may expand to 16×16 or 24×24 mm. The external solver receives only the cropped SRJ, clipped route fragments, bounds, a boundary margin and locked-point masks. The parent retains full-board state and merge provenance. Original endpoints, boundary cut points and collars, ports, required electrical contacts, variable widths and fixed copper remain protected.

Existing-via relocation is selected by exact checker identity and source route/via geometry, not just nearby coordinates. In that mode, count, order, layer span, diameter, unrelated vias and locked contacts remain fixed. Layer bridges require the separate layer-change permission. New or moved vias must clear every relevant pad, including same-net and rotated pads; an independent parent guard checks the merged proposal. No same-net exemption permits a new via in an SMD pad.

Each reference callback uses the same converter inputs as final output: original declared connection aliases, point-pair connections, processed pipeline obstacles, layer count, via-hole diameter, connectivity map and collision-safe final trace IDs. Generated escape-via routing obstacles stay in regional context but cannot replace actual emitted vias with through-obstacle tokens. Current preloaded replacements are included consistently. Merge and full-board checks reject stale metadata, broken anchors, new pad violations and worsened generic-obstacle clearances.

![V10 sample006 before and after](repair04-v10-srj33-sample006.svg)

The figure compares complete baseline and V10 final sample006 outputs. Default expanded DRC changes from 1 to 0 errors; all 10 vias in the full board are identical before and after. The early repair04 pass uses trace movements only. The advanced pass is conditional and skips boards already clean under the expanded reference check. The normal joint stage still runs. This does not claim that one isolated local repair04 region alone reaches a zero-error final board.

## Validation and runtime

Only statuses supplied with hash-bound validation evidence are reported here:

- Core full tests at `bdc284a4085c4e7ab533e1269e8b9c18ca2e98dd`: **passed** — 44 tests pass; 430 assertions; no routing benchmark executed.
- Core TypeScript at `bdc284a4085c4e7ab533e1269e8b9c18ca2e98dd`: **passed** — TypeScript checking passes after the dependency transport change.
- Frozen Linux CI group 9 at `0e9cd6f8f4d31a09439948fed6e7f0155290ad8c`: **failed** — Bugreport94 reached its snapshot assertion after 571,967.35 ms; its first four assertions passed, including the at-most-five default DRC limit. The SVG comparison differed by 36.036%; no exact DRC count or expanded-zero result is inferred.
- macOS bugreport94 full test at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed** — The full solve took 255,275.48 ms. One test passed with five assertion calls: four existing correctness assertions pass and the fifth records the expected SVG in snapshot update mode. No exact DRC count or expanded-zero result is claimed.
- macOS bugreport94 snapshot review at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed** — Independent Resvg overview and detail review found no material visual blocker; all 473 pad rectangles and 236 connection markers remain exact.
- GitHub Bun Test workflow at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed** — Completed successfully at this exact commit, workflow run 34004418653, attempt 2. This records the GitHub workflow, separately from the external Vercel preview status.
- GitHub Build workflow at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed** — Completed successfully at this exact commit, workflow run 34004418558, attempt 1. This records the GitHub workflow, separately from the external Vercel preview status.
- GitHub Type Check workflow at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed** — Completed successfully at this exact commit, workflow run 34004418604, attempt 1. This records the GitHub workflow, separately from the external Vercel preview status.
- GitHub Format Check workflow at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed** — Completed successfully at this exact commit, workflow run 34004418661, attempt 2. This records the GitHub workflow, separately from the external Vercel preview status.
- GitHub Vercel Build workflow at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed** — Completed successfully at this exact commit, workflow run 34004418592, attempt 1. This records the GitHub workflow, separately from the external Vercel preview status.
- Linux CI group9 retry at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed** — Exact-head retry job101410483299 passed:52 tests passed,7 skipped,0 failed;470 assertion calls. Bugreport94 passed all five unchanged assertions, including snapshot comparison, in519393.18ms. No exact DRC count or expanded-zero result is inferred.
- Delivery first Format installation attempt at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **failed** — The first attempt failed before validation because the pinned repair03 codeload dependency failed to resolve. The later retry passed; transport flakes are not claimed resolved.
- Delivery first group2 installation attempt at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **failed** — The first attempt failed before tests because the pinned repair03 codeload dependency failed to resolve. The completed workflow retry is recorded separately.
- External Vercel preview deployment at `984831c791a5cf6b5160ca293dd4d1a11971544b`: **failed** — The external preview retry failed during bun install resolving the pinned repair03 codeload dependency. GitHub Vercel Build passed separately; this report does not claim all PR statuses are green.

Final delivery CI for `984831c791a5cf6b5160ca293dd4d1a11971544b`: **passed**. Runtime equivalence does not establish that this CI run passed.

**Large-board runtime:** The equivalent delivery test declares no timeout; CI owns the 1,200-second budget through `bun test --timeout 1200000`, increased from its previous 600,000 ms CLI setting. The expected SVG was updated after review to reflect the changed routing. Comparing the committed test sources confirms that all five original assertions, including the default DRC limit, targeted-overlap checks and snapshot assertion, are preserved. The separately recorded test status at `984831c791a5cf6b5160ca293dd4d1a11971544b` is **passed**. Recorded runtime: 519.39 seconds. A passing test establishes its at-most-five assertion; the log does not supply an exact DRC count. This larger budget acknowledges substantial runtime overhead. It is not evidence that the solver meets the old 300-second budget. The separate full-run test is not an additional dataset entry: its post-repair03 geometry, replay context and disabled output match sample054, which remains in both denominators. A passing at-most-five default-DRC test is also not a claim that the expanded manufacturing checker reports zero errors.

Historical V9 failed bugreport94's unchanged DRC expectation as well as its old timeout. The status above belongs only to its explicitly recorded test commit. Pending validation remains pending; neither focused tests nor this development benchmark establish all CI checks passed.

## Reproduction and evidence

The original full baseline ran Pipeline9 with `enableRepair04: false`. V10 reuses the expanded V9 baseline: 37 original outputs and 37 post-repair03 checkpoints remain byte-for-byte unchanged. All five checker/converter sources and the shared bundled dependency sources were verified identical before reuse. Historical checkpoint error arrays remain raw historical data and are not presented as expanded-suite stage counts.

Each candidate restores its checkpoint and executes all remaining real pipeline stages. Before routing a candidate, its disabled replay must reproduce the saved full baseline. Here, 37/37 replay gates pass and 37/37 are byte-exact. The gate allows at most 1e-12 mm numeric-only differences and rejects changed structure or metadata; per-board exactness is recorded. Failed gates cannot produce passing candidates. The disabled control skips both repair04 passes and disables the joint-proposal acceptance guard. Final DRC coverage is identical on both sides.

Runs use Bun `1.4.2` on `linux/arm64`, effort `1`, at most two workers per four-CPU Blacksmith VM, and a hard 30-minute limit for each disabled or candidate replay child. A timeout remains a failed board. Replays measure the conditional pipeline tail, not full candidate end-to-end runtime. Baseline full-run timings and candidate tail timings are not a speed comparison. Bounded search can still take many minutes on large boards; the explicit region and candidate limits are described above.

The CSV contains all 37 boards. `originalInputFileSha256` hashes the raw published file; `preparedInputSha256` (JSON `inputSha256`) hashes the input after existing legacy-metadata migration. Early and advanced repair04 stage counts come from the full raw summary. A missing stage statistic stays blank rather than becoming zero. Unsolved CSV timings are blank; a zero-valued failure placeholder in raw JSON does not mean a timeout took zero time.

Every saved passing output is independently reconverted and checked without rerouting, using its original conversion context and both added via-pad checks. The small archive contains exact final bytes, minimal contexts and hashes. Its 6 passing examples are a subset of the complete benchmark, never a replacement denominator. From this PR checkout after installing dependencies:

```sh
mkdir -p work/repair04-saved-output-check
tar -xzf /path/to/repair04-v10-passing-outputs.tar.gz -C work/repair04-saved-output-check
bun scripts/benchmark/verify-repair04-saved-outputs.ts work/repair04-saved-output-check/repair04-v10-passing-outputs
```

- Validation suite: `repair04-via-pad-v1`.
- Frozen replay bundle SHA-256: `87327ab808627d4635513fb8b5b3268f11451da8d01fb73f98293fd5371ad4cc`.
- Frozen runner SHA-256: `8db5423024a65daf1e8740046a22e45907fe59de9b6a6d08dad4deb23f2db1e5`.
- Complete baseline fingerprint SHA-256: `d31a2d01e6e9eaee72ad457ead10c0f9e52bb1584359c659188bb998ef7e7571`.
- Reused expanded baseline archive SHA-256: `e6304f73dc060a93fada88d9e743a3483074468bede11d1fd53675818611cf8a`.
- Passing archive SHA-256: `755ca4e1f9abf1604b2608bce0135b5656b736dd5b0ce59dd35afc82ba0e960f`.
- Complete `repair04-v10-evidence.tar.gz` SHA-256: `0cb2cd6ed6811ef846e2b6ded9f72f05be0577abbcdff04f1a5e026cf1530268`.
- Baseline routing source: `ba756a5ae2cf4c9a8c11bce21666a28362927e94`.
- Comparison tooling commit: `0e9cd6f8f4d31a09439948fed6e7f0155290ad8c`.

`repair04-v10-srj33-provenance.json` binds exact comparison, configuration, validation and source-manifest hashes. Every file in the full evidence archive is checked against its internal checksum list before this report is rendered. Frozen source, dependency inventories, protocol, baseline reuse evidence, logs and raw results remain separately versioned. No dependency lockfile existed; executions use the same frozen bundle.

SRJ33 cases were used during development and tuning. This is a development benchmark for the recorded revisions and budgets, not a held-out estimate of performance on other boards.
