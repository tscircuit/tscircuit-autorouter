This is a dormant functional prototype. No production pipeline, worker entrypoint,
benchmark variant, or public export imports it. It has no measured speedup claim.

`buildHyperGraphWithRegionSelector.ts` copies the repository's native
`buildHyperGraph.ts`. The proof asserts byte-for-byte equality after changing
relative imports to repository aliases, renaming the function, adding an optional
second selector parameter, and replacing the two endpoint selector calls. Native
region/port construction, assignable-via handling, connection publication,
connectivity queries, exception ordering, and all routing policies are unchanged.

The private selector admits one synchronous whole-builder invocation. At the first
original endpoint query it checks the current builtin/prototype contracts and the
remaining callback frontier: dense plain connection/point arrays, connection
names, endpoint coordinates/layers, the native connectivity-map lookup and its
plain backing map, every region's finite nonnegative rectangle, candidate-region
ports, and their incident layer arrays. Descriptor checks never call an input
getter or inspect a Proxy through reflection. An unsupported observation surface
retains the original selector before index activation. Once active, an unexpected
point/graph or retired span throws; no recovery path restarts routing.

The index builds a balanced X-interval tree over conservatively padded region
rectangles. Its padding contains the original 1e-3 distance tolerance plus an
outward floating-point margin. Query results are sorted by the original region
ordinal. Each candidate still uses the original point-to-box/layer predicate and
incident-port preference. The first matching fallback region therefore follows
native source order. Repeated endpoint object identities share only geometric
shortlists; no selected region or routing result is cached. The index and callable
selector never escape the synchronous wrapper. The separate selection export is
only a numeric proof harness; its caller supplies plain fixture graphs.

The durable oracle is
`tests/solvers/native-endpoint-region-shortlist-functional-proof.test.ts` (one test):

- complete native graph and connection output on all 16 pinned SRJ18 boards,
  stopped immediately before Tiny construction/search;
- 20,000 randomized ordered selections and 2,640 IEEE boundary selections;
- getter, Proxy, customized lookup, original lookup error, invalid layer/geometry,
  missing-net, late bootstrap mutation/getter, Math getter, and customized WeakMap method observation traces;
- exact native source transformation and positive admission on all 16 boards.

Run it from the repository with:

```
bun test --timeout 9999999 tests/solvers/native-endpoint-region-shortlist-functional-proof.test.ts
```

`docs/benchmarks/parallel-native-endpoint-region-proof.json` records the functional
work census. Guard counts are explicit: reducing predicate calls does not imply
lower wall time. The current prototype is Bun/Node-only (`node:util` Proxy
inspection); activating it in the pipeline would need a separately reviewed
protected factory hook, supported-runtime eligibility, and remote paired timing.
The full afae remote stage budget puts an upper limit on this opportunity: even
removing all preparation and stitching would move its 1.2394x arithmetic mean only
to 1.3100x. This index is secondary to search and authoritative DRC work.
