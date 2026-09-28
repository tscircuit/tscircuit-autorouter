# Current-main applicability audit

Refreshed on 2026-09-28. The historical inspection revision
`8e8adc693d63f89583b71862f7c39c9d82791a79` and historical tiny pin
`c1043b3043ddf0c4d841fe5a6d9a515165960911` remain immutable references for the
initial findings, not the current candidate base.

- Freshly fetched autorouter `origin/main`:
  `34dc48b0bec14d802eda5936f0bd76a426a41136`.
- PR #2755 remained open and unmerged. This main was merged into the existing
  branch, preserving both prior commits without rewriting shared history.
- `PortPointPathingSolver.ts`, `getRegionNetIdByRegionId.ts`, and
  `createTinyRouteNetIndexer.ts` are byte-identical between the historical
  revision and fetched main. Therefore all three confirmed ownership defects
  remain applicable; none has an equivalent fix on current main.
- The `buildSerializedTinyGraph` terminal-injection body is also unchanged.
  Other adapter logic has changed upstream, so focused adapter execution is
  repeated against the current dependency, not assumed equivalent.
- Current main's consumer `tiny-hypergraph` pin is
  `31459ceef75e443d3ea6efca75cde10b90d63180`. No dependency manifest changes
  are introduced by this PR; the updated pin comes from the main merge.
- The dependency-owning sibling fetched tiny-hypergraph `origin/main` at
  `0750fa4c95e25a61d0e9e7250aa08c2046e671d8`. Its PR #213 remains open and
  unmerged, refreshed to `99a1d5324b9890688788638979694a7c5f940005`.
  Those loader fixes are not silently substituted for the consumer pin.

The structural assumptions and limits in `CORRESPONDENCE.md` remain in force.
This work makes no performance claim and has no benchmark comparison to
transfer to the new base. It does not claim complete TypeScript or binary64
verification. No snapshots or manual CI reruns are part of this refresh.

## Refreshed validation

A fresh `bun install` in this isolated checkout installed main's current
manifest. Local commands after the merge:

- `bun run format:check`: pass, 1,614 files.
- `bunx tsc --noEmit`: pass, including `verification/**/*.ts`.
- `lake +leanprover/lean4:v4.19.0 -d verification/pathing build` via elan:
  pass, all 15 theorem axiom reports unchanged.
- `bun verification/pathing/crossCheck.ts`: 15 comparisons pass, including six
  actual solves using the current consumer pin.
- Focused `bun test --timeout 9999999`: 15 tests pass, 1,108 assertions,
  11 files. These comprise the three `tests/bugs/port-point-pathing-*`
  ownership regressions, canonical-net collision and build-hypergraph-net-id
  regressions, shared terminal-chain test, prev/next pairing tests, terminal PCB
  IDs, pipeline error propagation, candidate portfolio, and pipeline2 input
  immutability. No snapshot test was run in this refresh.

No equivalent fixes were already merged, so PR #2755 remains useful. The
preserved historical proof assumptions still apply; this refreshed validation
adds current-main applicability evidence, not stronger universal proof claims.
