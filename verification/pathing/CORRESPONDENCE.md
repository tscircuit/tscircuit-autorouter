# Checked model correspondence

Source examined: `tscircuit/tscircuit-autorouter` revision
`8e8adc693d63f89583b71862f7c39c9d82791a79`, specifically
`lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts`
and `createTinyRouteNetIndexer.ts` in the same directory. The model does not
implement net indexing: that function interns mutuallyConnectedNetworkId strings
in first-observed order, a separate contract requiring executable boundary tests.

`PathingContract.lean` imports only Lean's bundled `Std`. Run from repository root:

```sh
~/.elan/bin/lake +leanprover/lean4:v4.19.0 -d verification/pathing build
~/.elan/bin/lake +leanprover/lean4:v4.19.0 -d verification/pathing env lean verification/pathing/PathingContract.lean
```

The first command builds the library; the second explicitly repeats kernel
checking and prints theorem axioms even when the build cache is current.

## Terminal transformation

- `Graph.endpoints` models serialized ports' region1Id/region2Id references.
  `Graph.listed` models membership in regions' pointIds arrays. `WellFormed`
  requires reciprocity in both directions.
- `terminalEndpoints` corresponds to the original port-copy loop and the two
  terminal `ports.push` operations in `buildSerializedTinyGraph`.
- `terminalListed` corresponds to the original region-copy loop, singleton
  terminal pointIds, and the two original-region pointIds pushes.
- `terminal_incidence_preserved` proves all memberships remain reciprocal.
- A `Step` crosses a port between its actual endpoints. `Walk` is a finite
  sequence of such steps. `terminal_path_lifting` encloses an original walk
  with terminal edges. `terminal_path_projection` collapses terminal visits,
  including repeated visits, into zero steps. `terminal_reachability_iff`
  proves that this structural transformation preserves reachability exactly.
- `terminal_port_sequence_roundtrip` proves list-level injection followed by
  terminal removal is identity. It models the structural removal of terminal
  ports (compare the `_tinyTerminal` filter in
  `buildInputNodesWithPortPoints`). It is **not** a theorem about
  all serialized metadata or actual solved-route conversion.

Required TypeScript correspondence assumptions: original region and port IDs
are unique and resolve; all generated terminal IDs are fresh and distinct;
original incidence is valid; connection endpoints resolve to original regions.
The tagged `Extended` type enforces freshness in the model, whereas generated
TypeScript strings do not enforce it. PointIds order and multiplicity are
abstracted away. Applying the single-connection result repeatedly requires
freshness for every connection; no theorem here establishes string freshness.

## Legacy pathing state

`legacyReuse none none = true` is a checked counterexample to treating missing
roots as shared ownership. `validatedReuse` corresponds to the explicit
`rootConnectionName !== undefined` guard followed by equality in
`PortPointPathingSolver.getPortPointReusePenalty`. Missing current roots never
authorize reuse; equal present roots do. Natural identifiers model equality of
resolved root names, not numeric JavaScript coercion.

`surviving_owner_preserves_occupancy` states that removing one route from a list
of committed (route, port) incidences leaves each distinct surviving route's
port occupied. This is the invariant required of `ripConnection`; it does not
by itself prove that the mutable TypeScript representative-owner map agrees
with the committed route list. Concrete regression tests must check that gap.

## Scope

These are model-level structural proofs, not verification of the search
algorithm, a TypeScript translation, or all adapters. No optimality, termination,
capacity, layer, intersection, cost, or floating-point claims are made. There
is no real arithmetic in this model, so geometry computed with JavaScript
binary64 is deliberately outside its correspondence claims. Runtime fixtures
and property tests must establish evidence about actual implementation behavior.

All reported proofs build without `sorry`, `admit`, or custom axioms. The
`#print axioms` output contains only the standard Lean axioms `propext` and
`Quot.sound` where simplification needs them. Projection and the missing-root
rejection theorem have no axioms. No `Classical.choice` is needed.

## Executable cross-check oracle

After building, run:

```sh
~/.elan/bin/lake +leanprover/lean4:v4.19.0 -d verification/pathing env lean --run verification/pathing/CrossCheck.lean
```

It emits JSONL: nine `reuse` rows for current/assigned roots drawn from
`null`, `0`, and `1`, followed by six `chain` rows containing injected sequence
length and projected original ports. A TypeScript test can consume these values
and compare the actual public reuse helper and terminal adapter against the
executable Lean definitions. Finite examples are cross-checks, not proof of
TypeScript correspondence for all inputs.

`resolveNet`, `canonical_net_has_priority`, and
`alias_used_only_without_canonical` specify canonical-first optional-field
resolution: a defined canonical value is preserved even when an alias differs.
Both theorems are axiom-free. They specify the intended alias contract; they
do not prove that every TypeScript consumer uses that priority.
