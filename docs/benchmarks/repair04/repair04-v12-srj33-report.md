# repair04 V12: bounded repair benchmark

The complete current SRJ33 dataset changes from **0/15 to 5/15 boards passing final default DRC (+33.33 percentage points)**. The complete older revision changes from **0/37 to 7/37 (+18.92 points)**. Both sides include the dedicated via-in-pad and via-to-pad clearance checks. Current newly passing boards: sample006, sample048, sample049, sample050, sample056.

The baseline has zero passing boards, so a relative percentage increase is undefined; a +30% relative improvement cannot be established from that baseline. The result reaches the 30-percentage-point interpretation of the requested target.

This report describes frozen production V12, not intermediate prototypes. It does not infer CI success from benchmark results. The original V8 claim omitted `checkViasInPads` and `checkViaPadClearance`; its clean-board totals are withdrawn. Historical V9 and V10 evidence remains separate. Complete V10 produced 0→4/15 current passes and 0→6/37 older-revision passes, with three candidate timeouts across all37 boards. No earlier run or focused sample050 final-output proof contributes candidate results to V12.

- Solver: [tscircuit/repair04](https://github.com/tscircuit/repair04), frozen benchmark commit `5b840f89af83a19f74e9d03e6eed8b8cac4487d3`.
- Pipeline9 integration: [PR #2420](https://github.com/tscircuit/tscircuit-autorouter/pull/2420), frozen benchmark commit `97c7ded4754e976d3ad0d94c52630a81b268984a`.
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
| sample002 | 6 | 2 | 6 | 2 |
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
| sample053 | 73 | not solved | 73 | not solved |
| sample054 | 8 | 1 | 8 | 1 |
| sample055 | 42 | not solved | 42 | not solved |
| sample056 | 6 | 0 | 6 | 0 |

The current candidate completes 11/15 solves and times out on 4/15. Across all 37 boards, baseline/candidate completed counts are 37/33; timeout counts are 0/4. Every input remains in the denominator. Unsolved candidates: sample003, sample045, sample053, sample055. Candidates without a validated replay: None. Pass-to-fail regressions: 0. Final default error-count regressions: None. Null measurements mean unavailable, not zero.

The JSON field `strictDrc` means the existing default `getDrcErrors` thresholds with `includeViaPadChecks: true`. Relaxed DRC supplies 0.1 mm trace and via clearance with the same added checks. Both measure final output after both repair04 passes, joint repair, length matching and power expansion. A local score or intermediate-stage zero never counts as a passing board. These totals measure the complete integration, including the joint-proposal acceptance guard; no separate ablation isolates each stage's contribution.

## Bounded repair policy

Pipeline9 now runs these stages in order:

1. Immediately after repair03 (`globalDrcForceImproveSolver`), repair04 tries trace movements only: at most three regions, each with 512 candidate evaluations by default. Existing vias are fixed and layer changes are disabled.
2. The normal `pipeline9JointDrcRepairSolver` runs, with a final-reference acceptance guard that rejects a worsening proposal while retaining its verified input. Solver errors still surface.
3. Advanced repair04 reads the joint stage's current HD routes and current updated/mutated preloaded copper. A board with zero expanded reference errors passes through unchanged. Otherwise it may try relocation of explicitly identified existing via-pad violations, followed by guarded layer bridges. This stage has a shared limit of 32 regions. Relocation searches use at most 512 candidates per region; bridge searches use at most 8,000. The explicit `traceOnlyFirst: false` flag skips repeating the planar search before a permitted bridge.
4. Length matching and power expansion consume the accepted advanced output.

V12 retains the V11 correction that adds existing unlocked via-pad violations to the local score during an explicitly authorized, unrestricted layer-change search. It computes the current via ordinals for each candidate, so insertion or removal cannot leave stale score indices. This makes an existing manufacturing defect visible to the search; it does not alter layer permissions, selected-via restrictions, fixed-point locks or candidate acceptance. V12 additionally treats marked through-obstacle transitions as fixed atomic copper instead of physical vias, including colocated transitions and atomic edges between ordinary vias. JSON transport may omit undefined object fields without weakening defined metadata or stale-state checks. Both sides also include the same newly merged upstream fixes; the fresh baseline avoids attributing upstream changes to repair04.

Regions start at 10×10 mm and may expand to 16×16 or 24×24 mm. The external solver receives only the cropped SRJ, clipped route fragments, bounds, a boundary margin and locked-point masks. The parent retains full-board state and merge provenance. Original endpoints, boundary cut points and collars, ports, required electrical contacts, variable widths and fixed copper remain protected.

Existing-via relocation is selected by exact checker identity and source route/via geometry, not just nearby coordinates. In that mode, count, order, layer span, diameter, unrelated vias and locked contacts remain fixed. Layer bridges require the separate layer-change permission. New or moved vias must clear every relevant pad, including same-net and rotated pads; an independent parent guard checks the merged proposal. No same-net exemption permits a new via in an SMD pad.

Each reference callback uses the same converter inputs as final output: original declared connection aliases, point-pair connections, processed pipeline obstacles, layer count, via-hole diameter, connectivity map and collision-safe final trace IDs. Generated escape-via routing obstacles stay in regional context but cannot replace actual emitted vias with through-obstacle tokens. Current preloaded replacements are included consistently. Merge and full-board checks reject stale metadata, broken anchors, new pad violations and worsened generic-obstacle clearances.

![V12 sample006 before and after](repair04-v12-srj33-sample006.svg)

The figure compares complete baseline and V12 final sample006 outputs. Default expanded DRC changes from 1 to 0 errors. All 10 physical vias in the full board are identical before and after, including ownership, spans, copper and drill diameters. The early repair04 pass uses trace movements only. The advanced pass is conditional and skips boards already clean under the expanded reference check. The normal joint stage still runs. This does not claim that one isolated local repair04 region alone reaches a zero-error final board.

## Validation and runtime

Only statuses supplied with hash-bound validation evidence are reported here:

- Core GitHub Bun Test at `5b840f89af83a19f74e9d03e6eed8b8cac4487d3`: **passed** ([GitHub Actions run](https://github.com/tscircuit/repair04/actions/runs/34007406617)) — Push workflow completed successfully for frozen core; run 34007406617, attempt 1. Actual checkout log and Git tree independently match the frozen core commit.
- Core GitHub Format Check at `5b840f89af83a19f74e9d03e6eed8b8cac4487d3`: **passed** ([GitHub Actions run](https://github.com/tscircuit/repair04/actions/runs/34007406543)) — Push workflow completed successfully for frozen core; run 34007406543, attempt 1. Actual checkout log and Git tree independently match the frozen core commit.
- Core GitHub Type Check at `5b840f89af83a19f74e9d03e6eed8b8cac4487d3`: **passed** ([GitHub Actions run](https://github.com/tscircuit/repair04/actions/runs/34007406542)) — Push workflow completed successfully for frozen core; run 34007406542, attempt 1. Actual checkout log and Git tree independently match the frozen core commit.
- Core full tests at `5b840f89af83a19f74e9d03e6eed8b8cac4487d3`: **passed** — 48 tests pass with 481 assertions, including physical-via/atomic-span distinction and bounded JSON transport.
- Core TypeScript at `5b840f89af83a19f74e9d03e6eed8b8cac4487d3`: **passed** — TypeScript checking passes.
- Core formatting at `5b840f89af83a19f74e9d03e6eed8b8cac4487d3`: **passed** — Repository format check passes.
- Pipeline9 focused tests at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** — 14 repair04 and joint final-reference tests pass with 127 assertions, including the real generated through-obstacle regression.
- DRC coverage tests at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** — Four checker coverage tests pass with 14 assertions.
- Router package build at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** — ESM and TypeScript declaration builds pass.
- Router TypeScript at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** — TypeScript checking passes.
- Router GitHub build at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** ([GitHub Actions run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34007791911)) — Completed workflow with actual checkout logs proving the tested Git tree equals the frozen router tree.
- Router GitHub type at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** ([GitHub Actions run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34007791880)) — Completed workflow with actual checkout logs proving the tested Git tree equals the frozen router tree.
- Router GitHub vercel-build at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** ([GitHub Actions run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34007791861)) — Completed workflow with actual checkout logs proving the tested Git tree equals the frozen router tree.
- Router GitHub format at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** ([GitHub Actions run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34007791869)) — Format workflow passed after dependency-install retries; actual checkout logs prove the tested Git tree equals the frozen router tree.
- External Vercel preview at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** — Exact frozen97c7 preview is READY; logs show the configured Bun1.4.2 install and site build completed.
- Router GitHub Bun Test at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** ([GitHub Actions run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34007791872)) — All9 shards pass:660 tests passed,63 skipped,0 failed and5332 assertions. Run34007791872 attempt2; every actual checkout tree equals frozen97c7ded. Shards7/9 initially failed dependency installation; only failed jobs were rerun, and retained successes remain in the complete checked inventory.
- Linux bugreport94 full regression and snapshot comparison at `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** — All5 unchanged assertions pass, including default DRC count at most5, both targeted-overlap checks and the Linux SVG comparison, in456228.31ms on Bun1.3.8. Actual PR merge904764 has the exact frozen97c7 tree; this is separate from the Mac snapshot-update review.

Final delivery CI for `97c7ded4754e976d3ad0d94c52630a81b268984a`: **passed** ([GitHub Actions run](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34007791872)). Runtime equivalence does not establish that this CI run passed.

**Large-board runtime:** The frozen test declares no timeout; CI owns the 1,200-second budget through `bun test --timeout 1200000`. The historical test budget was 300 seconds. Comparing the committed test sources confirms that all five original assertions, including the default DRC limit, targeted-overlap checks and snapshot assertion, are preserved. The separately recorded test status at `97c7ded4754e976d3ad0d94c52630a81b268984a` is **passed**. Recorded runtime: 456.23 seconds. A passing test establishes its at-most-five assertion; the log does not supply an exact DRC count. This larger budget acknowledges substantial runtime overhead. It is not evidence that the solver meets the old 300-second budget. This separate regression test contributes no additional benchmark entry. No equality between its intermediate geometry and a V12 dataset run is assumed. A passing at-most-five default-DRC test is also not a claim that the expanded manufacturing checker reports zero errors.

Historical V9 failed bugreport94's unchanged DRC expectation as well as its old timeout. The status above belongs only to its explicitly recorded test commit. Pending validation remains pending; neither focused tests nor this development benchmark establish all CI checks passed.

## Reproduction and evidence

V12 freshly routes every one of the 37 inputs through the complete Pipeline9 with `enableRepair04: false`, using the same frozen router source as the candidate. It does not reuse V9, V10 or V11 baseline geometry or assume a zero-pass baseline. Complete raw baseline results, all available post-repair03 checkpoints and final outputs, and explicit failures/timeouts are hash-bound to the full-baseline executable. Missing files for unsuccessful baseline runs remain part of the fingerprint and denominator.

Each candidate restores its checkpoint and executes all remaining real pipeline stages. Before routing a candidate, its disabled replay must reproduce the saved full baseline. Here, 37/37 replay gates pass and 37/37 are byte-exact. The gate allows at most 1e-12 mm numeric-only differences and rejects changed structure or metadata; per-board exactness is recorded. Failed gates cannot produce passing candidates. The disabled control skips both repair04 passes and disables the joint-proposal acceptance guard. Final DRC coverage is identical on both sides.

Runs use Bun `1.4.2` on `linux/arm64`, effort `1`, at most two workers per four-CPU Blacksmith VM, and a hard 30-minute limit for each disabled or candidate replay child. A timeout remains a failed board. Replays measure the conditional pipeline tail, not full candidate end-to-end runtime. The fresh full baseline has its own 30-minute per-solve limit. Baseline full-run timings and candidate tail timings are not a speed comparison. Bounded search can still take many minutes on large boards; the explicit region and candidate limits are described above.

The CSV contains all 37 boards. `originalInputFileSha256` hashes the raw published file; `preparedInputSha256` (JSON `inputSha256`) hashes the exact `loadScenarios` input after existing legacy-metadata migration and before pipeline normalization. All 37 result hashes must match the frozen prepared-input inventory. The checkpoint contains normalized routing context, whose separate byte hash is retained in the baseline fingerprint. Early and advanced repair04 stage counts come from the full raw summary. A missing stage statistic stays blank rather than becoming zero. Unsolved CSV timings are blank; a zero-valued failure placeholder in raw JSON does not mean a timeout took zero time.

Every saved passing output is independently reconverted and checked without rerouting, using its original conversion context and both added via-pad checks. The [compact passing-output archive](repair04-v12-passing-outputs.tar.gz) contains exact final bytes, minimal contexts and hashes. Its 7 passing examples are a subset of the complete benchmark, never a replacement denominator. From this PR checkout after installing dependencies:

```sh
mkdir -p work/repair04-saved-output-check
tar -xzf /path/to/repair04-v12-passing-outputs.tar.gz -C work/repair04-saved-output-check
bun scripts/benchmark/verify-repair04-saved-outputs.ts work/repair04-saved-output-check/repair04-v12-passing-outputs
```

- Validation suite: `repair04-via-pad-v1`.
- Frozen replay bundle SHA-256: `d7ef0e288462a617df48fc1061e4f4cd8757c3c82dc7b1423f6a6a4e68a4fef1`.
- Frozen runner SHA-256: `8db5423024a65daf1e8740046a22e45907fe59de9b6a6d08dad4deb23f2db1e5`.
- Complete baseline fingerprint SHA-256: `a613ce3bffdda213cb90d1a044852bb30bd649532d6e00ee2ca83fea2f7f8975`.
- Fresh full-baseline executable SHA-256: `8b6dc7d68381ea06c687d6e56c33d2a9bd2b40cc6ed83164b24368bdb8d78fce`.
- Fresh baseline configuration/summary SHA-256: `f43085db3b53a0a1cb5d65fe8bc12b4b3d61f587cc2da6c1f46c5378fc3d10ce` / `da1e2995a631630ef29ba3c68f1ad76c0e9fe98e07d380e841f5eee4a25db8f8`.
- [repair04-v12-passing-outputs.tar.gz](repair04-v12-passing-outputs.tar.gz) SHA-256: `a87357ca8a2c0b1a862fbccf40c32ada7ec156bc1d56f2f73e71f43cd246d6a5`.
- Complete [repair04-v12-evidence.tar.gz](repair04-v12-evidence.tar.gz) SHA-256: `35df7711c581217b6723afb8dece1c9fb71522792501f701b0d355bf464bff78`.
- Fresh baseline routing source: `97c7ded4754e976d3ad0d94c52630a81b268984a`.
- Comparison tooling commit: `97c7ded4754e976d3ad0d94c52630a81b268984a`.

`repair04-v12-srj33-provenance.json` binds exact comparison, configuration, validation and source-manifest hashes. Every file in the full evidence archive is checked against its internal checksum list before this report is rendered. Frozen source, dependency inventories, fresh-baseline protocol, logs and raw results remain separately versioned. No dependency lockfile existed; executions use the same frozen bundle.

SRJ33 cases were used during development and tuning. This is a development benchmark for the recorded revisions and budgets, not a held-out estimate of performance on other boards.
