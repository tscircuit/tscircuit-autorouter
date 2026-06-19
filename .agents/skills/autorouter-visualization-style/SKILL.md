---
name: autorouter-visualization-style
description: Structure and color `GraphicsObject` and SVG debug visualizations in the `tscircuit-autorouter` repo. Use when changing a solver `visualize()` method, `convertSrjToGraphicsObject`, pipeline 7 topology or overlay visuals, PNG/SVG snapshot outputs, or any layer-aware debug rendering where this repo's existing color, dash, opacity, label, and drift conventions should be preserved.
---

# Autorouter Visualization Style

Use the existing repo visual language. Do not invent a fresh palette or a new layer-separation scheme unless the user explicitly asks for one.

## Quick Start

Choose the visualization mode before editing:

1. Use solver-native visualization when showing internal state, candidates, staged progress, merge batches, topology generation, or failed geometry.
2. Use final SRJ visualization when showing the routed board output as traces, vias, jumpers, and obstacles.
3. Use pipeline 7 component-topology visualization as the canonical style for component-region structure, not the full pipeline composite.

Keep rendered artifacts on a white background. Snapshot stability in this repo depends on that.

## Follow These Rules

Preserve semantic separation before adding positional drift:

- Use color first for meaning.
- Use dash/opacity second for non-top or auxiliary geometry.
- Use small XY drift only when multiple items would otherwise collapse into the same pixels.

Prefer shared helpers over one-off styling logic:

- Use `createRectFromCapacityNode` for capacity-node rectangles.
- Use `getGraphicsLayerFromLayerNames` and related helpers for `layer: "z..."`.
- Use `getPresuppliedTraceVisualization` when overlaying input traces against generated routes.
- Use `getLastStepGraphicsObject` or `getLastStepSvg` when only the terminal frame matters.

Keep labels semantic and multiline. Include IDs, `availableZ`, batch/state tags, or connection names when they explain the geometry.

## Style Decision Tree

If the view is final routed output:

- Follow the `convertSrjToGraphicsObject` style.
- Keep top-layer traces visually dominant.
- Keep lower-layer traces dashed and more transparent instead of drifting them.

If the view is pipeline 7 component topology:

- Follow the restrained board-structure palette from `componentTopologyGeneratorSolver.visualize()`.
- Use slight diagonal drift for stacked layer rectangles via `createRectFromCapacityNode(..., { rectMargin, zOffset })`.
- Keep topology edges solid; distinguish state with color and stroke width, not dash.

If the view is a dense debug overlay:

- Add very small XY drift to coincident paths or label markers.
- When a point or label is shifted away from its true location, add a faint dashed leader line back to the true position.
- Keep the drift deterministic and small enough that the real geometry is still obvious.

## Read Before Editing

Use the norms below when you need exact palette, opacity, drift, snapshot, and pipeline 7 conventions.

## Visualization Norms

### Canonical views

Use one of these three views deliberately:

1. Solver-native debug view: inspect internal state, candidates, batches, topology growth, or failed geometry.
2. Final SRJ view: inspect final routed traces, vias, jumpers, and obstacles after `getOutputSimpleRouteJson()`.
3. Pipeline 7 component-topology view: inspect component-region mesh structure. This is the canonical pipeline 7 structural style.

Do not mix all three styles into one render unless the task explicitly calls for a composite.

### Background and snapshot rules

- Keep SVG/PNG renders on a white background.
- Treat terminal-step geometry as the stable contract for stepped visualizations.
- Assume visible geometry, stroke widths, opacity, dashes, and colors are snapshot-sensitive.

Relevant files:

- `tests/fixtures/getLastStepGraphicsObject.ts`
- `tests/fixtures/getLastStepSvg.ts`
- `tests/fixtures/svg-matcher.ts`
- `tests/features/topology/bga-topology/getComponentTopologySvg.ts`

### Layer and color rules

Use shared layer encoding:

- Use `layer: "z0"`, `layer: "z1"`, or `layer: "z0,1"` for generated geometry when possible.
- Use `getGraphicsLayerFromLayerNames`, `getGraphicsLayerForConnectionPoint`, and `getGraphicsLayerForObstacle`.

Relevant files:

- `lib/utils/getGraphicsObjectLayer.ts`
- `lib/utils/createRectFromCapacityNode.ts`

Use the `convertSrjToGraphicsObject` conventions for final routed output:

- top traces: solid, dominant, typically red when layer-derived
- bottom traces: blue, dashed `[0.2, 0.2]`, lower opacity
- inner fallback colors: `inner1` green, `inner2` yellow
- vias: blue fill
- through-obstacle segments: translucent, dashed `[0.1, 0.1]`
- obstacles: red translucent fill in the base SRJ-to-graphics conversion
- jumpers: orange translucent pads with gray body

Important nuance:

- When a per-connection color exists, keep it; top-vs-bottom semantics are often conveyed by opacity/dash rather than replacing the net color outright.

Relevant file:

- `lib/utils/convertSrjToGraphicsObject.ts`

Use these when editing the full pipeline 7 composite:

- fallback board bounds: `rgba(255,0,0,0.25)`
- explicit board outline: `rgba(0,136,255,0.95)`
- top obstacles: translucent red
- bottom obstacles: translucent blue

Relevant file:

- `lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts`

Use the restrained structural palette for pipeline 7 component topology:

- non-component obstacles: gray fill/stroke
- routable mesh nodes: light blue fill with darker blue stroke
- obstacle-containing mesh nodes: warm red/orange fill and stroke
- board outline: dark gray

Relevant file:

- `lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver.ts`

### Drift and overlap-separation rules

Prefer semantics before drift:

1. Use color to show role or layer.
2. Use dash to show lower-layer, transition, candidate, or auxiliary state.
3. Use opacity to demote secondary geometry.
4. Use XY drift only when overlap would hide information.

For stacked layer rectangles, use the shared helper:

- `x += lowestZ * width * zOffset`
- `y -= lowestZ * width * zOffset`

This produces a slight diagonal spread by layer.

Common usages:

- debug capacity nodes: `rectMargin: 0.025`, `zOffset: 0.01`
- pipeline 7 component topology: `rectMargin: 0.01`, `zOffset: 0.02`

Relevant files:

- `lib/utils/createRectFromCapacityNode.ts`
- `lib/solvers/CapacityPathingSolver/CapacityPathingSolver.ts`
- `lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver.ts`

Use deterministic, tiny offsets for coincident routes, such as:

- `(i % 5) * 0.02` on both axes for coincident routes
- scaled node-size offsets like `0.02 * min(width, height) * (...)` for terminals
- z-based drift like `point.z * 0.02` when separating same-XY paths by layer

When shifted away from the true location, add a faint dashed leader back to the original position.

Relevant files:

- `lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableViaCapacityPathing/AssignableViaCapacityPathingSolver_DirectiveSubOptimal.ts`
- `lib/solvers/CapacityPathingSectionSolver/visualizeSection.ts`
- `lib/solvers/PortPointPathingSolver/visualizePointPathSolver.ts`
- `lib/solvers/CapacityMeshSolver/CapacityEdgeToPortSegmentSolver.ts`

Do not drift when exact alignment is itself informative and the stage already distinguishes state by stroke color or other styling.

Example:

- `SingleLayerNodeMergerSolver` uses color-coded strokes for current-batch vs next-batch status and intentionally avoids `zOffset`.

Relevant file:

- `lib/solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver.ts`

### Labeling rules

Keep labels semantic, multiline, and terse.

Good label ingredients:

- `capacityMeshNodeId`
- `availableZ`
- `containsObstacle`
- connection name
- batch/state words such as `pending`, `active`, `expanded`, `gapfill`, `processed`

Avoid labels that only repeat obvious geometry.

Relevant files:

- `lib/utils/createRectFromCapacityNode.ts`
- `lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver.ts`
- `lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver.ts`
- `lib/solvers/BgaTopologyGeneratorSolver/GapFill.ts`
- `lib/solvers/BgaTopologyGeneratorSolver/RemoveMeshNodeOverlappingSolver.ts`

### Pipeline 7 topology rules

- Treat `componentTopologyGeneratorSolver.visualize()` as the reference style for component-topology snapshots.
- Keep topology edges solid.
- Encode edge state with color and stroke width instead of dashes.
- Typical states include gray pending edges, orange active/candidate edges, and red disconnected edges.
- Use slight rect drift for stacked single-layer and multi-layer nodes.

There is also a geometry-level split rule before rendering:

- QFP, QFP thermal-pad, and SOIC topology generators emit one multi-layer region only when the region is large enough.
- Otherwise they split into separate single-layer nodes with `:z${z}` suffixes.

Relevant files:

- `lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver.ts`
- `lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver.ts`
- `lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver.ts`
- `lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver.ts`
- `lib/solvers/BgaTopologyGeneratorSolver/DetectEdgesNotConnectedToMesh.ts`
- `lib/solvers/BgaTopologyGeneratorSolver/ExpandUnconnectedEdgesToMesh.ts`
- `lib/solvers/BgaTopologyGeneratorSolver/GapFill.ts`

### Final routed-output rules

- Preserve the distinction between final board-output visuals and solver-internal debug visuals.
- Prefer `convertSrjToGraphicsObject` for end-to-end or final-output views.
- Keep top-layer geometry visually dominant.
- Keep lower-layer geometry readable through dash and opacity, not big positional shifts.
- Preserve pre-supplied route overlays with absolute opacity control via `getPresuppliedTraceVisualization`.

Relevant files:

- `lib/utils/convertSrjToGraphicsObject.ts`
- `lib/utils/getPresuppliedTraceVisualization.ts`
- `tests/pipeline-preload-route-obstacles.test.ts`

### Key source files

- `lib/utils/convertSrjToGraphicsObject.ts`
- `lib/utils/getPresuppliedTraceVisualization.ts`
- `lib/utils/getGraphicsObjectLayer.ts`
- `lib/utils/createRectFromCapacityNode.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts`
- `lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver.ts`
- `lib/solvers/CapacityPathingSectionSolver/visualizeSection.ts`
- `lib/solvers/PortPointPathingSolver/visualizePointPathSolver.ts`
- `tests/fixtures/getLastStepGraphicsObject.ts`
- `tests/fixtures/getLastStepSvg.ts`

## Output Checklist

Before finishing:

1. Confirm whether the visualization is component-topology, solver-internal, or final-output.
2. Confirm layer semantics still read correctly without labels.
3. Confirm stacked items separate only enough to disambiguate them.
4. Confirm white-background SVG/PNG output still looks correct.
5. Confirm any changed snapshot-facing visuals preserve existing semantics unless the task explicitly changes them.
