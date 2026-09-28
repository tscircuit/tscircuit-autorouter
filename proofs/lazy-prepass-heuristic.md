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
Lean's `FixedRoute` makes coordinates, endpoint, and scale immutable inputs;
`Arithmetic` supplies subtraction, multiplication, addition, and square root
without assuming any algebraic laws. `routeHeuristic` spells out the actual
expression, including the shared `dx` and `dy` locals and operation order.

`eagerLookup_eq` proves lookup in the tabulated heuristic equals direct
evaluation at every valid port. `demand_preserves_search_trace` transports this
equality through an arbitrary deterministic bounded transition sequence.
Transitions may choose later queries adaptively. State can include candidate
heap contents, insertion order, costs, route segments, deterministic counters,
and terminal status. Wall-clock timings and the heuristic table representation
are outside this common logical search state. `fixed_route_trace_equivalence`
specializes the theorem to the explicitly modeled expression and fixed route;
it does not assume two separately chosen evaluators are equal. The observation
theorem consequently applies to port-use counts and the graph produced by
duplicating those ports, once the inspected implementation mapping holds.

`Value` is opaque, so this argument requires no real-number interpretation of
JavaScript arithmetic. Both branches retain exactly the same operation order;
no square-root approximation, reassociation, tolerance, or changed comparison
is justified by this proof. The runtime correspondence requires the same
deterministic implementations of those four operations in both modes, unchanged
coordinates/endpoints/scale, valid port indexes, and the same primitive values
when eagerly stored and read back. JavaScript Numbers and `Float64Array`
elements both hold binary64 values, including signed zero and infinity; finite
values incur no additional precision reduction on this store/read round trip.
Exact equal heuristic values preserve computed priorities,
ties, candidate insertion order, and iteration-budget behavior. Native
JavaScript arithmetic/storage semantics and the inspected TypeScript-to-model
mapping are assumptions of the application, not verified Lean implementations.
No claim is made about NaN payload-bit preservation, which search does not read.
The proof does not establish that real inputs avoid NaNs or infinities, nor
verify JavaScript, the JIT, or IEEE-754 implementations. It also does not claim
cross-engine bitwise equality of square-root results: equivalence is within a
runtime applying its same operations to both modes. Browser/runtime timing
measurements remain necessary to generalize any elapsed-time result beyond Bun.

## Cost scope and required evidence

For one independent route with P ports, eager setup evaluates the distance
expression P times. Lazy mode evaluates it Q times, where Q counts all
`computeH` calls, including repeated ports. `saved_evaluations` proves the exact
P − Q saving conditional on Q ≤ P; `strict_evaluation_improvement` requires
Q < P. These hypotheses must be measured, not assumed for arbitrary graphs.
`audited_expression_exact` checks an operational call log while retaining the
computed value: two subtractions, three multiplications, one addition, and one
square root. It counts shared `dx`/`dy` computations once each. `primitive_count`
derives seven arithmetic calls per visit by induction on a finite visit stream;
`primitive_savings` proves the exact 7(P − Q) reduction when Q ≤ P. The eager
visit stream enumerates all ports and the demand stream contains every query,
including duplicates. No axiom asserting expression equality or work reduction
is added.
For counters accumulated across independent routes, `batch_primitive_savings`
applies to their concatenated visit streams. It requires only the aggregate
Q ≤ P bound and does not incorrectly infer that every individual route saved
arithmetic. Changing the fixed endpoint between routes does not change the
audited operation sequence for a distance evaluation.

Algorithmically, the change removes the unconditional all-port heuristic
initialization loop and its P table writes; it replaces Q table reads during
search with Q executions of the unchanged expression. Thus the arithmetic
saving is conditional and negative when Q > P. It does not prune a search path,
change a priority, improve a route, or reduce the search expansion count.
The operation model excludes coordinate loads, function/branch overhead,
allocation zeroing, cache behavior, and JIT decisions, so it proves neither a
weighted instruction saving nor an elapsed-time speedup by itself.
The option also removes an 8P-byte heuristic buffer for each independent solve;
this is an allocation bound, not a claim of an 8P-byte process RSS reduction.

Required external validation is fixed-input baseline/candidate timing and query
counts, exact prepass report/output equality (including equal-priority route
choices), and representative Pipeline 9 completion/output checks. The proof
does not establish routing optimality, faster elapsed time, or physical route
quality by itself. It does not authorize enabling lazy heuristics in the main
selective-rerip or section solvers.
