# Seeded differential-pair corpus

This corpus separates electrical routing availability from differential-pair quality. It is intended for comparing autorouter revisions on identical inputs, including unsuccessful and partially routed cases. A skew, gap, or clearance miss never removes emitted copper from the benchmark artifacts.

## Sources and electrical model

The procedural USB-C USB 2.0 family models D+/D− connector escapes, separate series-resistor terminals, controller terminals, neighboring contacts, competing pairs, keepouts, and two- or four-layer routing. It is a reduced routing model, not a complete USB-C schematic or certified footprint. In particular, it does not claim to model all duplicated receptacle contacts, CC circuitry, power circuitry, or signal integrity.

The existing-board families come from the repository's core differential-pair pad-clearance fixture and Pico USB bug report 85. Seeded keepouts alter congestion without moving electrical terminals relative to their pads. Global orientation, reflection, translation, and uniform scale vary placement while transforming trace widths and declared rules together. These mutations are related examples from a small number of source families, not thousands of independently designed boards.

Each resistor has two separate copper nets. `srj.differentialPairs` pairs corresponding positive and negative copper segments. The sidecar `logicalPaths` describes their series order and resistor terminal correspondence; it never shorts the two resistor pads or merges D+ with D−. Logical-path skew sums planar copper lengths across these segments and excludes resistor bodies and via barrels.

## Splits and labels

Family splits are assigned before mutations. All procedural USB variants belong to the same training family, core-pad variants are validation, and Pico variants are held-out test. A result on the held-out family should not be used to tune the generator or solver and then presented as an untouched test result.

Stable IDs contain family, seed, and variant. Source hashes, mutation parameters, geometry fingerprints, and validation reports accompany the exported package. Duplicate checks distinguish transformed variants from independent geometry. Report results by source family and by kind as well as overall; pooled sample counts can otherwise exaggerate the amount of independent evidence.

- `control`: carries a constructive copper witness that must pass the corpus's witness checks. This proves a route under those checks, not that every autorouter will find it or that the board passes full manufacturing DRC.
- `stress`: valid input with unknown routability and unknown pair-quality feasibility.
- `infeasible`: contains a deliberately declared all-layer barrier; keep these out of routable-control success rates.

## Measurement contract

The benchmark uses the repository's solver construction and relaxed DRC infrastructure. It records available output separately from solved/failed flags, stores routes before evaluating quality, and preserves pre-power route checkpoints where the selected solver exposes them. Timeouts cannot recover copper a solver has not exposed.

The versioned pair metric contract reports planar length and skew, sampled edge-to-edge gap, coupled and uncoupled length, terminal coverage, via count and layer sequence, and relaxed clearance. Coupling samples at 0.05 mm spacing, accepts gap error within 0.05 mm and parallel angle within 15 degrees, and counts terminal escapes in total uncoupled length. This is a reproducible geometric proxy, not an impedance or electromagnetic simulation. Missing, ambiguous, discontinuous, and unmeasurable routes must not receive a passing compliance score. Missing constraints remain undeclared or unknown rather than receiving guessed defaults.

Per-sample outputs are retained even when scoring fails. Compare identical sample IDs, geometry, metric contracts, effort, and time budgets. Runtime comparisons also require the same machine class and runtime/dependency environment. Treat solver revision changes as the experimental variable.

## Reproduce

Install the pinned dependencies with `bun install --frozen-lockfile`. The committed pilot is at `scripts/differential-pair-corpus/pilot`. Generate the complete corpus locally (input generation does not route anything):

```sh
bun scripts/differential-pair-corpus/generate.ts --seed 20260928 --count 2048 --out /tmp/differential-pair-corpus-2048
bun scripts/differential-pair-corpus/generate.ts --seed 20260928 --count 80 --pilot --out /tmp/differential-pair-pilot
```

The second command selects 14 strata covering the source families, one to three USB ports, labels, and layer-transition presence. IDs and inputs match the corresponding entries in the full corpus. The export contains `manifest.json`, validation results, sample records, and JavaScript/type entrypoints; it requires no transpilation. It has no reserved SRJ dataset number and is not published to npm.

Run routing benchmarks on Blacksmith from the repository root. For a testbox whose Bun is not on `PATH`, use `/home/runner/.bun/bin/bun` and the runner entrypoint directly:

```sh
blacksmith testbox warmup benchmark-testbox.yml
blacksmith testbox run --id YOUR_TESTBOX '/home/runner/.bun/bin/bun install --frozen-lockfile && /home/runner/.bun/bin/bun scripts/differential-pair-benchmark/index.ts --dataset scripts/differential-pair-corpus/pilot --out-dir results/pair-pilot-baseline --timeout-ms 30000 --effort 1'
```

The repository entrypoint is `./benchmark.sh --differential-pairs --help`. The runner supports `--limit N`, `--sample ID`, and `--solver EXPORT`, processes samples sequentially, and creates a separate bounded process per sample. The timeout covers process startup, routing, checkpointing, and evaluation. Default output directories are `results/runNNN`.

After changing the solver, repeat the same command with a fresh output directory and `--baseline results/pair-pilot-baseline/results.json`. If the experiment intentionally changes the matching-solver dependency, add `--allow-dependency-change`; the report records both dependency locks. Otherwise mismatched locks, dataset contents, metric versions, Bun versions, and run settings reject the comparison before routing. Hardware differences suppress runtime deltas. A matching CPU description alone does not control system load, so use the same testbox and repeated runs for performance claims.

```sh
blacksmith testbox download --id YOUR_TESTBOX results/pair-pilot-baseline/ /tmp/pair-pilot-baseline/
blacksmith testbox stop --id YOUR_TESTBOX
```

Each sample directory retains the input record, available output SRJ, measurement results, and process logs. `summary.json` separates labels and source families; `comparison.json` records matched per-sample changes when a baseline is supplied.

## Scale validation

Seed `20260928`, count `2048`, generator version 2 produced 5,738 declared copper-segment pairs across 1,230 procedural USB samples, 409 core-pad samples, and 409 Pico samples. The label counts were 309 controls, 1,664 stress cases, and 75 deliberate infeasible cases. Structural and witness validation found no errors, exact duplicates, or repeated pre-transform geometry fingerprints. These are generator-validation results, not a claim that the autorouter solved 2,048 boards. The generated corpus is approximately 103 MB; the tracked pilot is approximately 420 KB.
