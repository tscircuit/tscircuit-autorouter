# Joint component escape order experiment

This prototype chooses discrete portal orders using both the package escape
regions and their adjacent area-routing regions. It runs after uniform port
distribution and before high-density routing in Pipeline9. Disable it with
`jointComponentEscapePlanning: false` for a control on the same source revision.

The planner groups connections between detected packages, and also between one
package and its external terminal set. It considers existing package boundary
and internal escape interfaces. A mode permutes the assigned nets among the
existing slots of one shared edge on one layer. The planner searches individual
modes and pairs of modes together. This can cross a local minimum where changing
either package exit alone has no benefit.

The objective counts same-layer, different-net straight-chord crossings in all
regions affected by those modes, using direct length only to break ties. A mode
must strictly reduce crossings. This is a routing-difficulty proxy, not a
certificate of geometric routing or a via-count lower bound. Existing detailed
routing, stitching, and physical validation still produce and assess copper.

## Physical contracts and bounded scope

- Terminal coordinates are protected using the original physical connection
  points, including terminals whose assigned ports omit `pcb_port_id`.
- Port IDs, incidence, layer assignments, and the set of slot coordinates stay
  fixed. Every assigned copy in both adjacent regions moves together.
- Physical trace and pad gaps are resolved separately from search margins.
  Explicit board rules take precedence over the existing reference default.
- Slot orders are checked per net and width. Same-net pad permission comes from
  the connectivity map and does not transfer to another net using that slot.
- Registered net identities and unknown literal IDs have separate namespaces;
  root-name hints cannot give an unregistered connection another net's rights.
- A complete proposed assignment checks neighboring contacts on both sides,
  including simultaneously changed modes and earlier accepted bundles.
- Pad geometry uses conservative rotated bounding rectangles. Unknown contact
  widths prevent an assignment; they are not replaced with a smaller width.
- At most eight interfaces per bundle are searched, prioritized by current
  crossing pressure. Interfaces with up to four slots enumerate permutations;
  five through eight slots use reversal and adjacent swaps. Larger interfaces
  are explicitly counted as unsupported. There is no completeness claim.

The first experiment keeps layers fixed. It does not yet optimize via regions,
fanout layer assignment, or route incidence between different shared edges.
Requested nominal widths are used conservatively even where later width
assignment could shrink a route to the minimum width. This can reject a usable
mode; it cannot establish that the physical board is unroutable.
Affected-region scoring does not simulate detailed routing through the entire
intercomponent corridor. Independent validated copper remains necessary.

## Isolation from the earlier sparse-kernel experiment

The earlier sparse kernel remains explicitly selectable through
`Pipeline9HighDensitySolver({ sparsePhysicalSearch: true, ... })`; it is off by
default. The default Pipeline9 uses native search and the main repair dependency
pin, simplifier integration, materializer, stitcher, and trace-width behavior.
The earlier optional owned-preload repair API remains available to direct
callers, but the Pipeline9 joint-DRC integration is restored to main behavior.
The two-mode control changes only the new escape planner's enable option.

## Local validation and coverage evidence

Ten focused tests cover the simultaneous two-package local minimum, external
terminals, physical terminal identity, blocked slots, exact net ownership,
unaffected wide contacts in the other owner region, explicit 0.05/0.3 mm trace
and pad gaps, registered-versus-literal owner namespaces, and the disabled control. The simultaneous example reduces two
crossings to zero and constructs copper accepted by the independent reference
DRC evaluator. Twenty-seven focused/regression tests pass with 35,035 assertions.
The package build and targeted TypeScript check pass.

Full functional controls at effort 1, with caches disabled:

| Case | Planner off | Planner on | Output |
| --- | --- | --- | --- |
| SRJ18 sample 3 | complete, zero reference DRC | complete, zero reference DRC | identical SHA-256 |
| SRJ24 sample 25 | complete, zero reference DRC | complete, zero reference DRC | identical SHA-256 |

These two cases have no eligible multi-slot package interfaces, so this proves
functional parity, not an improvement in routing.

Captured-stage replay provides a separate coverage check without repeating a
large full-board solve:

| Case | Eligible interfaces | Assignments evaluated | Changed ports |
| --- | ---: | ---: | ---: |
| SRJ18 sample 1 | 0 | 0 | 0 |
| SRJ24 sample 1 | 12 | 134 | 0 |
| SRJ24 sample 25 | 0 | 0 | 0 |
| SRJ24 sample 26 | 0 | 0 | 0 |

SRJ24 sample 1 has seven internal escape interfaces and five exterior interfaces
across five package-to-external-terminal bundles. Its sole blocked interface has
0.099 mm slot-center spacing, below the 0.2 mm required for 0.1 mm wires and a
0.1 mm gap. No searched order improves its crossing objective.

SRJ18 sample 1 has ten package-associated point-pair connections traversing
nineteen occupied interfaces; every interface contains exactly one assignment.
An order-only planner has no decision to make there. Increasing coverage would
require explicit route reassignment between shared edges, or postponing the
earlier exit/layer choices. Swapping positions across unrelated cells while
retaining their old incidence would be invalid.

These observations do not yet establish an end-to-end advantage on actual
datasets. Corpus timing and complete validity comparisons belong on the
isolated Blacksmith runner, with main and the same-revision disabled control.

Useful commands:

```sh
bun test tests/solvers/joint-component-escape-*.test.ts --timeout 9999999
bun scripts/experiments/inspect-joint-component-escape.ts srj24 25 /tmp/joint-stage.json
bun scripts/experiments/check-joint-component-escape.ts srj18 3
```

Activation and charged operation counts are in
`pipeline.jointComponentEscapePlannerSolver.stats`. Rejected-domain examples are
in `blockedPortalSamples`; stage capture can save the exact replay input.
