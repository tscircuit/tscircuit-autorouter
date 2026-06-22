---
name: tscircuit-visualization
description: Work with tscircuit visualization in this repo. Use when changing `GraphicsObject` solver `visualize()` or `preview()` output, `convertSrjToGraphicsObject`, layer-aware SVG/PNG rendering, visual snapshot tests, final routed-output graphics, topology graphics, capacity-node rects, or graphics-debug image export.
---

# tscircuit Visualization

Use `GraphicsObject` for solver debug views, final SRJ output views, SVG snapshots, PNG artifacts, and interactive debug fixtures.

## Graphics Object Types

Import types from `graphics-debug`:

```ts
import type {
  GraphicsObject,
  Point,
  Line,
  InfiniteLine,
  Rect,
  Circle,
  Polygon,
  Arrow,
  Text,
} from "graphics-debug"
```

Do not redefine or explain those shapes in repo docs or tests.

## Image Functions

Use these library functions from `graphics-debug`:

- `import { getSvgFromGraphicsObject } from "graphics-debug"`
- `import { getPngBufferFromGraphicsObject } from "graphics-debug"`
- `import { InteractiveGraphics } from "graphics-debug/react"`

Call them with white backgrounds for stable snapshots/artifacts:

- SVG: `getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })`
- PNG: `await getPngBufferFromGraphicsObject(graphics, { backgroundColor: "white", pngWidth: 1536, pngHeight: 1536 })`

Repo helpers:

- `tests/fixtures/getLastStepGraphicsObject.ts`
- `tests/fixtures/getLastStepSvg.ts`
- `lib/testing/PipelineStageDebugRunner.ts`

## Minimal SVG Tests

Prefer minimal SVG snapshot tests over large debug dumps.

Use one of these patterns:

```ts
expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
```

```ts
expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(import.meta.path)
```

```ts
const result = solver.getOutputSimpleRouteJson()
expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(import.meta.path)
```

Update snapshots with:

```bash
BUN_UPDATE_SNAPSHOTS=1 bun test
```

Relevant paths:

- `tests/fixtures/svg-matcher.ts`
- `tests/fixtures/getLastStepSvg.ts`
- `lib/utils/convertSrjToGraphicsObject.ts`

## Rect Norms

Use `createRectFromCapacityNode` for capacity-node rectangles.

Rect defaults:

- Capacity rects: blue/cyan fill from `availableZ`
- Obstacle rects: red translucent fill
- Multi-layer capacity rects: neutral translucent fill
- Jumper pads: orange translucent fill with orange stroke

Relevant paths:

- `lib/utils/createRectFromCapacityNode.ts`
- `lib/utils/convertSrjToGraphicsObject.ts`

## Line Norms

Use line width to mean physical or solver-relevant width. Do not use width only as decoration.

Line defaults:

- Final top-layer traces: solid and visually dominant
- Final non-top traces: dashed and lower opacity
- Through-obstacle lines: translucent with short dash
- Jumper body lines: gray and narrower than pads
- Topology edges: solid; encode state with color and stroke width

Relevant paths:

- `lib/utils/convertSrjToGraphicsObject.ts`
- `lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts`

## Other Type Norms

- Points: use connection color, layer helpers, and terse labels for points-to-connect.
- Circles: use blue fill for vias and `layer: "z..."` across the via span.
- Labels/text: keep semantic and terse; prefer multiline labels only when IDs, `availableZ`, state, or connection names matter.
- Polygons/arrows/infinite lines: check `graphics-debug` types first, then match nearby solver usage before adding new style.

Relevant paths:

- `lib/utils/convertSrjToGraphicsObject.ts`
- `lib/utils/createRectFromCapacityNode.ts`

## Layer And Connection Colors

Use `layer: "z0"`, `layer: "z1"`, or `layer: "z0,1"` for layer-aware geometry.

Use helper functions instead of hand-mapping layer strings:

- `getGraphicsLayerFromLayerNames`
- `getGraphicsLayerForConnectionPoint`
- `getGraphicsLayerForObstacle`

Connection colors come from `getColorMap(srj)` when available. Preserve per-connection colors; use layer styling through dash, opacity, and `layer`, not by replacing a known connection color.

Fallback layer colors for final routed output:

- `top`: red
- `bottom`: blue
- `inner1`: green
- `inner2`: yellow

Relevant paths:

- `lib/utils/getGraphicsObjectLayer.ts`
- `lib/utils/convertSrjToGraphicsObject.ts`
- `lib/solvers/colors.ts`

## Gaps For Stacked Rects

Separate stacked layer rects with a small deterministic diagonal offset only when overlap hides information.

Use `createRectFromCapacityNode(node, { rectMargin, zOffset })`.

Normal values:

- Debug capacity nodes: `rectMargin: 0.025`, `zOffset: 0.01`
- Component topology: `rectMargin: 0.01`, `zOffset: 0.02`

The helper applies z-based drift from the lowest available layer. Keep exact alignment when alignment is the information being tested.

Relevant paths:

- `lib/utils/createRectFromCapacityNode.ts`
- `lib/solvers/CapacityPathingSolver/CapacityPathingSolver.ts`
- `lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver.ts`
- `lib/solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver.ts`

## Choosing The View

Use solver-native visualization for internal state, candidates, failed geometry, staged progress, and labels.

Use `convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson())` for final emitted routes, vias, jumpers, and obstacles.

Use component-topology visualization for pipeline 7 structure.

Keep SVG and PNG backgrounds white. Treat colors, dash arrays, opacity, stroke widths, labels, and z offsets as snapshot-sensitive.
