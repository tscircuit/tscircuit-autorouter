# repair04 V11: bounded repair benchmark

The complete current SRJ33 dataset changes from **0/15 to 5/15 boards passing final default DRC (+33.33 percentage points)**. The complete older revision changes from **0/37 to 7/37 (+18.92 points)**. Both sides include the dedicated via-in-pad and via-to-pad clearance checks. Current newly passing boards: sample006, sample048, sample049, sample050, sample056.

The baseline has zero passing boards, so a relative percentage increase is undefined; a +30% relative improvement cannot be established from that baseline. The result reaches the 30-percentage-point interpretation of the requested target.

This report describes frozen production V11 before the subsequent main-branch simplification update and repair04 atomic-transition correction. Its measurements do not apply automatically to the later PR code; V12 requires a fresh full baseline and candidate run. It does not infer CI success from benchmark results. The original V8 claim omitted `checkViasInPads` and `checkViaPadClearance`; its clean-board totals are withdrawn. Historical V9 and V10 evidence remains separate. Complete V10 produced 0→4/15 current passes and 0→6/37 older-revision passes, with three candidate timeouts across all37 boards. No earlier run or focused sample050 final-output proof contributes candidate results to V11.

- Solver: [tscircuit/repair04](https://github.com/tscircuit/repair04), frozen benchmark commit `6a17c030740005b46847def22a7da2920ef57f77`.
- Pipeline9 integration: [PR #2420](https://github.com/tscircuit/tscircuit-autorouter/pull/2420), frozen benchmark commit `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`.
- Bootstrap: [handbook guide](https://github.com/tscircuit/handbook/blob/main/guides/bootstrapping-repos.md), actual create-repo templates and [create-repo PR #70](https://github.com/tscircuit/create-repo/pull/70).

No later verified delivery commit was supplied; validation identifies the exact frozen production commits.

## Complete dataset results

| Dataset and checker | Baseline passing | Candidate passing | Change |
|---|---:|---:|---:|
| Current SRJ33, default DRC | 0/15 | 5/15 | +33.33 pp |
| Current SRJ33, relaxed DRC | 0/15 | 5/15 | +33.33 pp |
| Older SRJ33, default DRC | 0/37 | 7/37 | +18.92 pp |
| Older SRJ33, relaxed DRC | 0/37 | 7/37 | +18.92 pp |

The current revision is [`026a78cb005ab33dde24f2db8fefbfd8d8efa614`](https://github.com/tscircuit/dataset-srj33-drc-failures/tree/026a78cb005ab33dde24f2db8fefbfd8d8efa614), committed September 5, 2026 at 19:34:04 UTC. All 15 published inputs are included. Their raw hashes match the corresponding inputs in the complete older revision [`f566b62be0f83395d9ab63ddc068f9d645b68b16`](https://github.com/tscircuit/dataset-srj33-drc-failures/tree/f566b62be0f83395d9ab63ddc068f9d645b68b16). Membership follows the published dataset, not repair04 outcomes.

The dataset's independent authenticity audit retained these 15, classified 16 as DRC-passed under a separate router/conversion run, and excluded six with unconfirmed error evidence: sample004, sample010, sample020, sample025, sample032, sample052. These labels are distinct from this benchmark's baseline. All 37 remain in the older-denominator result, with audit labels in the CSV.

| Current board | Baseline default errors | Final default errors | Baseline relaxed errors | Final relaxed errors |
|---|---:|---:|---:|---:|
| sample002 | 9 | 3 | 9 | 3 |
| sample003 | 20 | not solved | 20 | not solved |
| sample005 | 91 | 4 | 91 | 4 |
| sample006 | 1 | 0 | 1 | 0 |
| sample044 | 32 | 20 | 32 | 20 |
| sample045 | 75 | not solved | 75 | not solved |
| sample046 | 25 | 3 | 25 | 3 |
| sample048 | 17 | 0 | 17 | 0 |
| sample049 | 8 | 0 | 8 | 0 |
| sample050 | 17 | 0 | 17 | 0 |
| sample051 | 3 | 3 | 3 | 3 |
| sample053 | 73 | 9 | 73 | 9 |
| sample054 | 8 | 1 | 8 | 1 |
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

V11 adds existing unlocked via-pad violations to the local score during an explicitly authorized, unrestricted layer-change search. It computes the current via ordinals for each candidate, so insertion or removal cannot leave stale score indices. This makes an existing manufacturing defect visible to the search; it does not alter layer permissions, selected-via restrictions, fixed-point locks, candidate acceptance or the full reference checker.

Regions start at 10×10 mm and may expand to 16×16 or 24×24 mm. The external solver receives only the cropped SRJ, clipped route fragments, bounds, a boundary margin and locked-point masks. The parent retains full-board state and merge provenance. Original endpoints, boundary cut points and collars, ports, required electrical contacts, variable widths and fixed copper remain protected.

Existing-via relocation is selected by exact checker identity and source route/via geometry, not just nearby coordinates. In that mode, count, order, layer span, diameter, unrelated vias and locked contacts remain fixed. Layer bridges require the separate layer-change permission. New or moved vias must clear every relevant pad, including same-net and rotated pads; an independent parent guard checks the merged proposal. No same-net exemption permits a new via in an SMD pad.

Each reference callback uses the same converter inputs as final output: original declared connection aliases, point-pair connections, processed pipeline obstacles, layer count, via-hole diameter, connectivity map and collision-safe final trace IDs. Generated escape-via routing obstacles stay in regional context but cannot replace actual emitted vias with through-obstacle tokens. Current preloaded replacements are included consistently. Merge and full-board checks reject stale metadata, broken anchors, new pad violations and worsened generic-obstacle clearances.

![V11 sample006 before and after](repair04-v11-srj33-sample006.svg)

The figure compares complete baseline and V11 final sample006 outputs. Default expanded DRC changes from 1 to 0 errors; all 10 vias in the full board are identical before and after. The early repair04 pass uses trace movements only. The advanced pass is conditional and skips boards already clean under the expanded reference check. The normal joint stage still runs. This does not claim that one isolated local repair04 region alone reaches a zero-error final board.

## Validation and runtime

Only statuses supplied with hash-bound validation evidence are reported here:

- GitHub Bun Test (core) at `6a17c030740005b46847def22a7da2920ef57f77`: **passed** — Completed successfully at the exact frozen commit; run 34005302980, attempt 1.
- GitHub Format Check (core) at `6a17c030740005b46847def22a7da2920ef57f77`: **passed** — Completed successfully at the exact frozen commit; run 34005302990, attempt 1.
- GitHub Type Check (core) at `6a17c030740005b46847def22a7da2920ef57f77`: **passed** — Completed successfully at the exact frozen commit; run 34005303271, attempt 1.
- GitHub Build (router) at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — Completed successfully for this PR head; run 34005824263, attempt 1. GitHub PR jobs check out a merge commit; this workflow status does not establish execution of the frozen benchmark tree.
- GitHub Type Check (router) at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — Completed successfully for this PR head; run 34005824466, attempt 1. GitHub PR jobs check out a merge commit; this workflow status does not establish execution of the frozen benchmark tree.
- GitHub Format Check (router) at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — Completed successfully for this PR head; run 34005824304, attempt 1. GitHub PR jobs check out a merge commit; this workflow status does not establish execution of the frozen benchmark tree.
- GitHub Vercel Build (router) at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — Completed successfully for this PR head; run 34005824334, attempt 1. GitHub PR jobs check out a merge commit; this workflow status does not establish execution of the frozen benchmark tree.
- Core regression suite at `6a17c030740005b46847def22a7da2920ef57f77`: **passed** — 45 tests pass with 442 assertions, including the existing via-pad scoring regression.
- Pipeline9 focused tests at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — 12 tests pass with 133 assertions.
- Pipeline9 additional focused tests at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — 6 tests pass with 32 assertions.
- Router package build at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — ESM and TypeScript declaration builds pass.
- Router TypeScript at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — TypeScript checking completes successfully.
- External Vercel preview at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **passed** — Exact frozen-head preview is READY. The configured Bun 1.4.2 installer and production site build completed; the deployment audit records the log hashes.
- Bun Test workflow and actual Linux checkout at `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **failed** — The workflow for this PR head tested merge9fa6c7e09205e03d21a7a989c0ef096801ea4fe4, including a different pre-repair03 simplification implementation. Eight shards passed; after an installation retry the ninth recorded51passes/7skips/1failure. Bug94 passed four correctness assertions and failed only its expected SVG comparison in552480.65ms. This is not a test of the exact frozen benchmark tree.

CI workflow associated with PR head `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`: **failed**. Bun Test workflow associated with this PR head; actual checkout was merge9fa6c7e09205e03d21a7a989c0ef096801ea4fe4 with a different pre-repair03 implementation. Its only test failure was the expected SVG comparison. No frozen-tree CI pass is claimed. Workflow head attribution does not establish the actual checkout tree.

**Large-board runtime:** The frozen test declares no timeout; CI owns the 1,200-second budget through `bun test --timeout 1200000`. The historical test budget was 300 seconds. Comparing the committed test sources confirms that all five original assertions, including the default DRC limit, targeted-overlap checks and snapshot assertion, are preserved. The separately recorded test status in the workflow for PR head `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6` is **failed**. The actual checkout was `9fa6c7e09205e03d21a7a989c0ef096801ea4fe4`. This merge includes a different pre-repair03 implementation; it does not establish a test result for the frozen benchmark tree. Recorded runtime: 552.48 seconds. This larger budget acknowledges substantial runtime overhead. It is not evidence that the solver meets the old 300-second budget. The separate full-run test is not counted as an additional dataset entry. An earlier audit matched the frozen-source checkpoint to sample054; that audit does not establish checkpoint identity for the CI merge source. A passing at-most-five default-DRC test is also not a claim that the expanded manufacturing checker reports zero errors.

Historical V9 failed bugreport94's unchanged DRC expectation as well as its old timeout. The status above belongs only to its explicitly recorded test commit. Pending validation remains pending; neither focused tests nor this development benchmark establish all CI checks passed.

## Reproduction and evidence

The original full baseline ran Pipeline9 with `enableRepair04: false`. V11 reuses the expanded V9 baseline: 37 original outputs and 37 post-repair03 checkpoints remain byte-for-byte unchanged. The recorded checker/converter sources and the shared bundled dependency sources were verified identical before reuse. Historical checkpoint error arrays remain raw historical data and are not presented as expanded-suite stage counts.

Each candidate restores its checkpoint and executes all remaining real pipeline stages. Before routing a candidate, its disabled replay must reproduce the saved full baseline. Here, 37/37 replay gates pass and 37/37 are byte-exact. The gate allows at most 1e-12 mm numeric-only differences and rejects changed structure or metadata; per-board exactness is recorded. Failed gates cannot produce passing candidates. The disabled control skips both repair04 passes and disables the joint-proposal acceptance guard. Final DRC coverage is identical on both sides.

Runs use Bun `1.4.2` on `linux/arm64`, effort `1`, at most two workers per four-CPU Blacksmith VM, and a hard 30-minute limit for each disabled or candidate replay child. A timeout remains a failed board. Replays measure the conditional pipeline tail, not full candidate end-to-end runtime. Baseline full-run timings and candidate tail timings are not a speed comparison. Bounded search can still take many minutes on large boards; the explicit region and candidate limits are described above.

The CSV contains all 37 boards. `originalInputFileSha256` hashes the raw published file; `preparedInputSha256` (JSON `inputSha256`) hashes the input after existing legacy-metadata migration. Early and advanced repair04 stage counts come from the full raw summary. A missing stage statistic stays blank rather than becoming zero. Unsolved CSV timings are blank; a zero-valued failure placeholder in raw JSON does not mean a timeout took zero time.

Every saved passing output is independently reconverted and checked without rerouting, using its original conversion context and both added via-pad checks. The small archive contains exact final bytes, minimal contexts and hashes. Its 7 passing examples are a subset of the complete benchmark, never a replacement denominator. From this PR checkout after installing dependencies:

```sh
mkdir -p work/repair04-saved-output-check
tar -xzf /path/to/repair04-v11-passing-outputs.tar.gz -C work/repair04-saved-output-check
bun scripts/benchmark/verify-repair04-saved-outputs.ts work/repair04-saved-output-check/repair04-v11-passing-outputs
```

- Validation suite: `repair04-via-pad-v1`.
- Frozen replay bundle SHA-256: `aefccfa07483e9977bc20f2b13549678c6b0f0417415e9b1bd65d0492166ccab`.
- Frozen runner SHA-256: `8db5423024a65daf1e8740046a22e45907fe59de9b6a6d08dad4deb23f2db1e5`.
- Complete baseline fingerprint SHA-256: `d31a2d01e6e9eaee72ad457ead10c0f9e52bb1584359c659188bb998ef7e7571`.
- Reused expanded baseline summary SHA-256: `6660cb648d3e7809ac776e3a33b6dae8780fb78a7f54ba34535d78e4ddacf212`.
- Passing archive SHA-256: `f2c7ef4da799f1b7915b54d29793fa74a7af5069453f19a0d101429a0f99a9c2`.
- Complete `repair04-v11-evidence.tar.gz` SHA-256: `b275bfa02c526ddd4d038ef0d011e651d13d4bd9b5f4613353cebfbe66a54f73`.
- Baseline routing source: `ba756a5ae2cf4c9a8c11bce21666a28362927e94`.
- Comparison tooling commit: `3a59a7e12b3003056ac5ebd9a46d411ad7fec7e6`.

`repair04-v11-srj33-provenance.json` binds exact comparison, configuration, validation and source-manifest hashes. Every file in the full evidence archive is checked against its internal checksum list before this report is rendered. Frozen source, dependency inventories, protocol, baseline reuse evidence, logs and raw results remain separately versioned. No dependency lockfile existed; executions use the same frozen bundle.

SRJ33 cases were used during development and tuning. This is a development benchmark for the recorded revisions and budgets, not a held-out estimate of performance on other boards.
