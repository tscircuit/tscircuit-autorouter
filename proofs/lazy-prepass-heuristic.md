# Lazy independent-route heuristic proof

Check with Lean 4.28.0, without additional packages:

```sh
lean proofs/LazyPrepassHeuristic.lean
```

This proof supports exploring `USE_LAZY_ROUTE_HEURISTIC: true` **only in
`DuplicateCongestedPortSolver.routeSolveOptions`**, configured by
`lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts`.
It does not establish a measured performance win. Baseline/candidate workload
measurements and differential output checks are separate requirements.

## Implementation mapping

The package's `DuplicateCongestedPortSolver.getPortUseCounts` constructs a fresh
plain `TinyHyperGraphSolver` for each connection. Its `createSingleRouteProblem`
sets `routeCount` to one and copies that connection's endpoint. In package
`lib/core.ts`, `computeProblemSetup` eagerly fills `portHCostToEndOfRoute` for
every port. Enabling the option skips this array. `computeH` then computes the
same expression when search requests a heuristic:

```ts
const dx = portX[portId] - portX[endPortId]
const dy = portY[portId] - portY[endPortId]
Math.sqrt(dx * dx + dy * dy) * DISTANCE_TO_COST
```

The base solver's `getRouteEndPortId` returns `problem.routeEndPort[routeId]`,
which is also the endpoint used in eager setup. Coordinates, endpoint, and
distance scale stay fixed during each independent solve. The proof does not
cover subclasses changing those inputs or overriding endpoint selection.

`eagerLookup_eq` proves lookup in the tabulated heuristic equals direct
evaluation at every valid port. `demand_preserves_search_trace` transports this
equality through an arbitrary deterministic bounded transition sequence.
Transitions may choose later queries adaptively. State can include candidate
heap contents, insertion order, costs, route segments, statistics, and terminal
status. The observation theorem consequently applies to port-use counts and
the graph produced by duplicating those ports.

`Value` is opaque, so this argument requires no real-number interpretation of
JavaScript arithmetic. Both branches retain exactly the same operation order;
no square-root approximation, reassociation, tolerance, or changed comparison
is justified by this proof. JavaScript Numbers and `Float64Array` elements both
hold binary64 values. Exact equal heuristic values preserve computed priorities,
ties, candidate insertion order, and iteration-budget behavior. Native
JavaScript arithmetic/storage semantics and the inspected TypeScript-to-model
mapping are assumptions of the application, not verified Lean implementations.
No claim is made about NaN payload-bit preservation, which search does not read.

## Cost scope and required evidence

For one independent route with P ports, eager setup evaluates the distance
expression P times. Lazy mode evaluates it Q times, where Q counts all
`computeH` calls, including repeated ports. `saved_evaluations` proves the exact
P − Q saving conditional on Q ≤ P; `strict_evaluation_improvement` requires
Q < P. These hypotheses must be measured, not assumed for arbitrary graphs.
The option also removes an 8P-byte heuristic buffer for each independent solve;
this is an allocation bound, not a claim of an 8P-byte process RSS reduction.

Required external validation is fixed-input baseline/candidate timing and query
counts, exact prepass report/output equality (including equal-priority route
choices), and representative Pipeline 9 completion/output checks. The proof
does not establish routing optimality, faster elapsed time, or physical route
quality by itself. It does not authorize enabling lazy heuristics in the main
selective-rerip or section solvers.
