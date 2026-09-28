# Port-point pathing: checked contracts and concrete regressions

This is an incremental verification of **port-point** pathing, not a claim of
full solver verification. Source inspection found no `FourPoint` pathing class.
The implementation is owned by `tscircuit/tscircuit-autorouter`:

- `AutoroutingPipelineSolver2_PortPointPathing` uses
  `HyperPortPointPathingSolver`, which constructs `PortPointPathingSolver`.
- Pipelines 4, 7, 8 and 9 use `buildHyperGraph` followed by
  `TinyHypergraphPortPointPathingSolver`; that adapter serializes regions, ports,
  route endpoints and net identities into `tiny-hypergraph`.
- Inspected autorouter revision: `8e8adc693d63f89583b71862f7c39c9d82791a79`.
- Its exact `tiny-hypergraph` dependency pin:
  `c1043b3043ddf0c4d841fe5a6d9a515165960911`.
  Adapter execution here used a fresh GitHub source archive of that exact pin.
- Lean toolchain: `leanprover/lean4:v4.19.0`; Bun: `1.3.14`.

## Findings and fixes

1. **Missing root names authorize unrelated port reuse.** The old comparison
   accepted `undefined === undefined`. Two differently named routes with
   distinct endpoints in the same pair of regions both claimed the only shared
   port and the solver reported success. Every availability selector now
   requires a defined, equal root name for sharing. The regression exercises
   ordinary, center-first and off-board selection. No root metadata is invented.
2. **Ripping one shared-net route loses a surviving reservation.** The map stores
   one representative owner even when several same-net routes share a port.
   Removing its current owner previously deleted the reservation, despite the
   other committed path still using it. Ripping now transfers ownership to a
   surviving path, including ports reserved by off-board routing, and deletes
   the reservation only when no path needs it. Tests cover both physical path
   ports and an off-board reserved port which neither route traverses.
3. **Connection aliases overwrite canonical copper net IDs.** For routes
   `(route-a, net-a)` and `(net-a, net-b)`, the combined alias map assigned a
   region with `_connectedTo: ["net-a"]` to `net-b`. `buildHyperGraph` already
   normalizes that field to canonical net IDs. Separate maps now give canonical
   IDs priority while preserving alias-only compatibility. The regression
   checks both connection orderings, independent of numeric net-index order.

Each primary regression was executed before the associated fix and failed for
its expected behavioral assertion. The added off-board survivor regression
further covers the second fix. These are actual TypeScript failures, not bugs
in an abstract model alone.

## Checked scope

`PathingContract.lean` defines endpoint references and reciprocal incidence,
finite graph walks, fresh tagged terminal IDs, explicit optional root ownership,
committed route/port incidence and canonical-first net lookup. Fifteen checked
theorems establish:

- reciprocal incidence survives terminal injection;
- original walks lift to terminal-to-terminal walks, and every extended walk
  projects to an original walk, so endpoint reachability is equivalent;
- injecting and removing terminal port tags recovers the original sequence;
- missing roots do not authorize reuse, whereas equal present roots do;
- removing a route preserves every distinct surviving ownership witness;
- canonical net lookup wins over any alias value.

All theorem axioms are printed. Dependencies are empty or the standard Lean
`propext` / `Quot.sound`; there are no unfinished proofs or custom axioms.
See [CORRESPONDENCE.md](CORRESPONDENCE.md) for source-to-model mappings.

The model assumes unique, resolving original IDs, fresh generated terminal IDs,
valid incidence, and resolving connection endpoints. Tagged IDs enforce
freshness in Lean; TypeScript string generation is **not** proved fresh.
The state-removal theorem does not prove correspondence of the mutable
representative-owner map; the actual solve/rip regressions test that gap.
There is no complete serialization/metadata round-trip theorem, search
optimality proof, completeness proof, progress/termination proof, or geometric
routing proof. The port-list theorem models terminal removal when rebuilding
input nodes; solved output intentionally retains physical endpoint ports.

Geometry and costs use JavaScript binary64. The proofs abstract coordinates
away and do not replace floating-point predicates with real-number claims.
Cross-check fixtures use finite integer/half-integer coordinates and z=0;
NaN/infinity, extreme magnitudes, tolerance boundaries, crossing/capacity costs
and multi-layer geometric correctness remain outside the checked scope.
The rip fix scans surviving paths, so no performance improvement is claimed.

## Joint tiny-hypergraph boundary

The sibling verification shares the exact
`tests/verification/fixtures/chain.json` fixture. Our test reconstructs the
adapter's object graph, executes the pinned tiny solver, and checks all eight
port endpoint orientations in both route directions: output incidence, paired
prev/next links, coordinates, net names and terminal PCB IDs (16 runs).

`crossCheck.ts` executes Lean's `CrossCheck.lean`, then compares its nine
optional-root cases with the actual public reuse helper and its six injected
chain expectations with actual adapter solve output. These 15 finite
cross-checks support correspondence; they are not a universal translation proof.

The sibling loader fixes and numeric solver verification are in
[tscircuit/tiny-hypergraph#213](https://github.com/tscircuit/tiny-hypergraph/pull/213).
They reject malformed reciprocal incidence and repair references after obstacle
filtering. Those fixes are **not** included in the dependency pin used here;
this PR does not bump that dependency or claim malformed graphs are now rejected
by the full pipeline.

## Reproduce

From the repository root, install package dependencies with `bun install` and
install Lean 4.19.0 with elan if it is not already available. No mathlib or other
Lean package download is needed.

```sh
~/.elan/bin/elan toolchain install leanprover/lean4:v4.19.0
~/.elan/bin/lake +leanprover/lean4:v4.19.0 -d verification/pathing build
~/.elan/bin/lake +leanprover/lean4:v4.19.0 -d verification/pathing env lean verification/pathing/PathingContract.lean
bun verification/pathing/crossCheck.ts
bun node_modules/typescript/bin/tsc --noEmit --pretty false
bun test --timeout 9999999 \
  tests/bugs/port-point-pathing-missing-root-ownership.test.ts \
  tests/bugs/port-point-pathing-rip-shared-port.test.ts \
  tests/bugs/port-point-pathing-rip-offboard-reservation.test.ts \
  tests/features/tinyhypergraph-canonical-net-id-collision.test.ts \
  tests/features/build-hypergraph-net-id.test.ts \
  tests/verification/pathing-terminal-chain.test.ts \
  tests/prev-next-port-point-pairs.test.ts \
  tests/tinyhypergraph-terminal-port-ids.test.ts \
  tests/tinyhypergraph-pipeline-error-propagation.test.ts \
  tests/solvers/tinyhypergraph-candidate-portfolio.test.ts \
  tests/pipeline-immutability/autorouting-pipeline2-port-point-pathing.test.ts \
  tests/features/portpointpathing01.test.ts \
  tests/features/tinyhypergraph-port-bridge-repro.test.ts
```

Recorded result: Lean build and axiom inspection pass; 15 executable
cross-checks pass; repository TypeScript check passes; focused Bun suite has
16 passing tests, one existing skipped test, zero failures and 1,109 assertions.
The full test suite and benchmarks were not run.
