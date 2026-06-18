---
name: graphics-object-visualization
description: >
  Work with `GraphicsObject` debug visualizations in this autorouter codebase.
  Use when a solver exposes `.visualize()`, when converting a `GraphicsObject`
  to SVG or PNG, when snapshot-testing visual output, when extracting only the
  last step of a stepped visualization, or when debugging routing stages by
  saving rendered artifacts.
---

# Graphics Object Visualization

This repo uses `GraphicsObject` as the common debug format between solvers,
tests, fixtures, and exported artifacts.

## Mental model

The usual flow is:

1. A solver produces a `GraphicsObject` from `visualize()` or `preview()`.
2. That `GraphicsObject` is consumed in one of three ways:
   - Rendered interactively in React with `InteractiveGraphics`
   - Converted to SVG with `getSvgFromGraphicsObject`
   - Converted to PNG with `getPngBufferFromGraphicsObject`
3. Tests snapshot either:
   - The raw `GraphicsObject` with `toMatchGraphicsSvg`
   - A derived SVG string with `toMatchSvgSnapshot`

Base entrypoints live in:

- `lib/solvers/BaseSolver.ts`
- `tests/fixtures/getLastStepGraphicsObject.ts`
- `tests/fixtures/getLastStepSvg.ts`
- `lib/testing/PipelineStageDebugRunner.ts`

## Solver visualization vs SRJ visualization

There are two common visualization sources in this repo:

### 1. Solver-native visualization

Use this when you want to inspect the solver's internal state, intermediate
debug geometry, failed routes, labels, expansion steps, or staged progress.

```ts
const solver = new AutoroutingPipelineSolver(simpleRouteJson)
solver.solve()

const graphics = solver.visualize()
```

This comes from the solver itself. Many solvers override `visualize()` and may
include step-tagged elements or solver-specific shapes.

### 2. Output SRJ visualization

Use this when you want to inspect the final routed result as board traces and
obstacles, independent of solver internals.

```ts
const result = solver.getOutputSimpleRouteJson()
const graphics = convertSrjToGraphicsObject(result)
```

This is the pattern used in `tests/e2e3.test.ts`, `tests/e2e1.test.ts`,
`tests/e2e3-jumpers.test.ts`, and other end-to-end tests. It snapshots the
final routing output, not the internal stepping behavior.

From `tests/e2e3.test.ts`:

```ts
const solver = new AutoroutingPipelineSolver(simpleSrj)
solver.solve()

const result = solver.getOutputSimpleRouteJson()
expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(import.meta.path)
```

Use this pattern when the test is about final correctness of emitted traces.

## Full pipeline: solver -> GraphicsObject -> SVG / PNG

### Solver to `GraphicsObject`

`BaseSolver.visualize()` returns a `GraphicsObject` shape. Concrete solvers
override it.

```ts
visualize(): GraphicsObject {
  return {
    lines: [],
    points: [],
    rects: [],
    circles: [],
  }
}
```

`preview()` is the lighter-weight sibling for progress-oriented rendering.

### `GraphicsObject` to SVG

For a direct conversion:

```ts
import { getSvgFromGraphicsObject } from "graphics-debug"

const svg = getSvgFromGraphicsObject(solver.visualize(), {
  backgroundColor: "white",
})
```

This is the explicit pattern used in tests like
`tests/stitch-solver/multilayer-connection-stitch.test.ts`:

```ts
const svg = getSvgFromGraphicsObject(solver.visualize(), {
  backgroundColor: "white",
})

await expect(svg).toMatchSvgSnapshot(import.meta.path)
```

Use this when you need control over SVG generation options before snapshotting.

### `GraphicsObject` to PNG

PNG export is mainly used for saved debug artifacts rather than regular snapshot
tests. The repo already does this in `lib/testing/PipelineStageDebugRunner.ts`.

```ts
const png = await getPngBufferFromGraphicsObject(stageSolver.visualize(), {
  pngWidth: 1536,
  pngHeight: 1536,
})

await writeFile(pngPath, png)
```

The important distinction is:

- SVG is preferred for diffable snapshots and review in tests.
- PNG is preferred for artifact capture, reports, or visual stage dumps.

## Interactive rendering in fixtures and debuggers

When you want a live browser/debugger view, pass the `GraphicsObject` directly
to React components from `graphics-debug/react`.

```tsx
import { InteractiveGraphics } from "graphics-debug/react"

return <InteractiveGraphics graphics={solver.visualize()} />
```

This pattern appears throughout legacy fixtures, for example
`fixtures/legacy/mesh-under-obstacle/meshunderobstacle1.fixture.tsx` and
`fixtures/legacy/segment-to-point/segmenttopoint1.fixture.tsx`.

Use this path when:

- You need to inspect geometry manually
- You want pan/zoom style debugging
- You are building a fixture or debugger UI rather than a snapshot test

## Snapshot testing patterns

This repo uses three main patterns.

### Pattern 1: Snapshot the full `GraphicsObject`

```ts
expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
```

Use this when the full visualization is stable and meaningful. This is common
for solver-specific tests like:

- `tests/multi-head-hd/hdpolyline03_limited_candidates.test.tsx`
- `tests/features/pipeline6-poly-hypergraph.test.ts`
- many `tests/features/*` and `tests/bugs/*` cases

This matcher turns the `GraphicsObject` into SVG internally, then snapshots it.

### Pattern 2: Snapshot the last step only

Many solvers emit `step` values on shapes. For those, the repo standard is to
strip earlier steps before snapshotting.

Use the existing helper:

```ts
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(import.meta.path)
```

This is common in:

- `tests/e2e2.test.ts`
- many `tests/repro/*`
- many `tests/bugs/*`
- many `tests/features/pour-via-escape/*`

The helper chain is:

1. `solver.visualize()` returns a `GraphicsObject`
2. `getLastStepGraphicsObject(...)` filters by max `step`
3. `getSvgFromGraphicsObject(...)` converts that filtered result to SVG
4. `toMatchSvgSnapshot(...)` snapshots the final SVG string

Core implementation:

```ts
const allSteps = [
  ...(graphicsObject.lines?.map((l: any) => l.step) ?? []),
  ...(graphicsObject.points?.map((p: any) => p.step) ?? []),
  ...(graphicsObject.circles?.map((c: any) => c.step) ?? []),
  ...(graphicsObject.rects?.map((r: any) => r.step) ?? []),
].filter((step) => step !== undefined)

const maxStep = Math.max(...allSteps, -1)
```

Use this pattern when intermediate construction steps are noisy and only the
terminal state matters for the test.

### Pattern 3: Snapshot final output SRJ

For end-to-end route validation, convert emitted SRJ back into graphics:

```ts
const result = solver.getOutputSimpleRouteJson()
expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(import.meta.path)
```

This is the pattern in `tests/e2e3.test.ts`.

Use this when:

- The contract under test is the final autorouter output
- You do not want internal solver-state churn to invalidate snapshots
- The solver may internally step through multiple debug states, but only final
  traces matter

## Choosing the right pattern

Use `solver.visualize()` directly when:

- You are testing a specific solver's internal geometry
- You want to inspect subsolver state
- You need labels, failed candidates, staged overlays, or intermediate shapes

Use `getLastStepSvg(solver.visualize())` when:

- The visualization is step-based
- Earlier steps are noisy
- The final state is the only stable thing worth snapshotting

Use `convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson())` when:

- You are writing e2e tests
- You care about final routed traces, not debug internals
- You want output snapshots that remain stable across internal refactors

Use `getPngBufferFromGraphicsObject(...)` when:

- You need an artifact file on disk
- You are capturing pipeline stages
- You are producing review/debug images outside snapshot tests

## Presupplied trace and overlay workflows

The repo also uses `GraphicsObject` as an overlay format for non-solver sources.
See `lib/utils/getPresuppliedTraceVisualization.ts`.

```ts
const traceVisualization = convertSrjToGraphicsObject({
  ...srj,
  obstacles: [],
})
```

That helper converts traces from SRJ into a partially transparent
`GraphicsObject`, which can then be layered with solver visualization during
debugging.

Use this when comparing:

- Existing/preloaded traces vs newly-routed traces
- Solver geometry vs emitted route output
- Input artifacts vs transformed output

## Practical examples

### Example: inspect a solver interactively

```tsx
import { InteractiveGraphics } from "graphics-debug/react"

const solver = new CapacitySegmentToPointSolver(inputs as any)
solver.solve()

return <InteractiveGraphics graphics={solver.visualize()} />
```

### Example: snapshot a stable solver visualization

```ts
const solver = new MultiHeadPolyLineIntraNodeSolver3({
  nodeWithPortPoints,
  hyperParameters: { SEGMENTS_PER_POLYLINE: 5 },
})
solver.solve()

expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
```

### Example: snapshot only the terminal step

```ts
const solver = new CapacityMeshSolver(simpleSrj)
solver.solve()

expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(import.meta.path)
```

### Example: snapshot final e2e output

```ts
const solver = new AutoroutingPipelineSolver(simpleSrj)
solver.solve()

const result = solver.getOutputSimpleRouteJson()
expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(import.meta.path)
```

### Example: export stage PNGs

```ts
const png = await getPngBufferFromGraphicsObject(stageSolver.visualize(), {
  pngWidth: 1536,
  pngHeight: 1536,
})

await writeFile(pngPath, png)
```

## Guidance for agents

- Prefer existing helpers over reimplementing visualization plumbing.
- Default to SVG for tests because snapshots and diffs are easier to review.
- Default to `getLastStepSvg(...)` when a solver uses `step`-tagged output.
- For e2e tests like `tests/e2e3.test.ts`, prefer snapshotting
  `convertSrjToGraphicsObject(result)` rather than raw solver internals.
- For manual debugging UIs, prefer `InteractiveGraphics`.
- For artifact capture or stage-by-stage debug dumps, prefer PNG export.
