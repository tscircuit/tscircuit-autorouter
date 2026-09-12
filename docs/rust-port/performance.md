# Rust performance validation

Measured locally on 2026-09-11. The final module exceeds the 1.5× target on
SRJ18: the faster of the two TypeScript means divided by the slower of the two
Rust means is **1.5104×**, or **33.8% less solve time**.

## Measurements

Per-board timing records for these four runs are committed in
[srj18-matched.json](measurements/srj18-matched.json).

| Comparison | Backend | Mean successful-board time | P50 | P95 |
| --- | --- | ---: | ---: | ---: |
| First comparison | TypeScript | 43.696s | 27.713s | 110.866s |
| First comparison | Rust/WASM | 28.929s | 19.423s | 69.878s |
| Confirmation | TypeScript | 46.658s | 29.741s | 119.706s |
| Confirmation | Rust/WASM | 28.655s | 19.388s | 69.432s |

Both Rust runs used identical compiled module bytes. The confirmation TypeScript
and Rust runs were consecutive. The TypeScript source was unchanged between its
two runs; its timing varied by about 6.8%. The conservative headline above uses
both runs without selecting the slower TypeScript baseline or faster Rust result.

Settings: Pipeline 9, SRJ18, effort 1, concurrency 4, 600-second sample timeout.
Runs were serialized locally, with no simultaneous builds, tests, profiles, or
other agent CPU work. Binding initialization and initial pipeline construction
precede the benchmark's solve timer in both implementations. The mean includes
the same 13 successful boards; the three failed boards are checked for parity
but are not added to this timing metric.

## Exactness and interface checks

- Both complete Rust runs match the frozen TypeScript reference on all 16
  outcomes, errors, recorded routing work, via counts, and DRC results.
- All 13 successful trace files are byte-for-byte identical in both runs.
- The continuity port matches full ordered error objects on 41 focused cases
  and all 16 converted SRJ18 inputs. Cases include duplicate and built-in IDs,
  lone UTF-16 surrogates, nonfinite numbers, signed zero, pad geometries, and
  opaque cyclic/BigInt metadata that must remain untouched.
- The borrowed via-planning constructor passes 3,332 MultiHead/Via solver steps,
  992 facade comparisons, and three restored-state checks against TypeScript.
- Statistics transfer preserves own `undefined` properties and independent
  snapshots. The raw-versus-adapter oracle covers constructor, every step,
  completion, and reset; three public integration tests passed 308 assertions.
- Focused native tests, the WASM target check, release binding build, repository
  type check, and JavaScript/declaration build pass. No formatting or linting
  was run; this is not a claim that the entire repository test suite was run.

The reference is the existing frozen TypeScript checkout at
`/private/tmp/tscircuit-autorouter-ts-reference`, based on commit
`22800e78d093292efdc2259d3528aed59eec0c7e` with its retained local changes.
These results do not establish parity with newer upstream main. The previously
recorded unexposed native bus-variant limitation remains outside the exported
variants and the SRJ18 result above.

## Changes behind the result

The ports retain the source routing algorithms, ordering, and iteration budgets.
Recent improvements target representation and boundaries: one JSON statistics
transfer, typed coordinates with shared immutable point payloads, borrowed
via-planning constructor inputs, shared trace/connectivity data, and direct
ports of setup and trace-continuity helpers. Public solver classes and diagnostic
adapters retain their TypeScript entry points. The continuity checker keeps
readable-name generation and exact error formatting in TypeScript.

Isolated measurements, including the relevant boundary costs:

- Statistics transfer: 2.48× faster in alternating old/new runs.
- Trace continuity: 1.69×–3.04× faster across boards 2, 8, 12, and 13.

These isolated ratios are not whole-board speedups. See the new
[continuity source mapping](../../rust/trace-contiguity/README.md) for that port's
file correspondence.

## Artifacts

Full reports, trace files, commands, compiled module snapshots and SHA256 hashes
are under `/private/tmp/rust-migration/speedup-goal/`:

- `reference-matched/` and `rust-contiguity/`: first comparison.
- `reference-confirmation/` and `rust-confirmation/`: consecutive confirmation.
- Each Rust `comparison.json` records exactness checks and per-board timings.
- `rust-confirmation/repeat-comparison.json` also compares the two Rust runs.
- `contiguity-timing-results.json` and `stats-transport-timing.json`: isolated timings.
- `progress.md`: the profile and experiment history, including rejected changes.

No commits or pushes were made for these passes.

## Dependency preparation audit

While preparing the length-matching dependency patch, `bun patch` unexpectedly
resolved and reinstalled packages. Further install/patch-commit operations were
stopped and the patch was generated manually from captured originals. Routing
package sources and nested versions were audited against the frozen checkout,
accounting for intentional tracked patches; the frozen checkout was not edited.

Eight installed tooling/UI packages differ from the frozen environment. There
was no pre-operation inventory establishing their previous local versions, so
they were not restored by guessing. They include browser metadata, lucide-react,
the tscircuit CLI, nested Biome packages, and postcss's nested nanoid. Full package
versions and source checks are recorded in
`/private/tmp/rust-migration/length-hook-stage/dependency-audit.md`.
