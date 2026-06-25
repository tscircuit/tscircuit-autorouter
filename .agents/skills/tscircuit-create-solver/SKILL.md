---
name: tscircuit-create-solver
description: Create a new solver with @tscircuit/solver-utils. Use when adding a solver that extends BaseSolver (one iterative algorithm) or BasePipelineSolver (an ordered sequence of sub-solvers), or when wiring up the GenericSolverDebugger. Covers import paths, the override contract, fail-fast on invalid state, and reference solvers (BGA, rectdiff, find-convex-regions).
---

# Creating a tscircuit Solver

A solver is an incremental algorithm built on `@tscircuit/solver-utils`. It does one unit of work per `step()` and reports progress, a visualization, and a typed output. Use `BaseSolver` for a single algorithm. Use `BasePipelineSolver` to run several solvers in sequence.

## Imports

Runtime classes come from the package root. Import them only in `lib/` solver code:

```ts
import {
  BaseSolver,
  BasePipelineSolver,
  definePipelineStep,
  type PipelineStep,
} from "@tscircuit/solver-utils"
```

The orchestrator class is named `BasePipelineSolver`, not `BaseSolverPipeline`.

The debugger UI is a separate subpath. Import it only in `*.page.tsx` and debug files, never in `lib/`:

```ts
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
```

## When to use which

- `BaseSolver`: a leaf, atomic algorithm. One phase of work that mutates internal state toward a result, such as a placement pass, a merge, or one optimization step. References: `MergeCellsSolver` in `tscircuit/find-convex-regions`, `RectDiffSeedingSolver` in `tscircuit/rectdiff`.
- `BasePipelineSolver<TInput>`: orchestrates an ordered list of sub-solvers, feeding each stage its input from earlier stages' outputs. Use when a problem decomposes into phases. References: `BgaTopologyGeneratorSolver` in `tscircuit/tscircuit-autorouter`, `RectDiffPipeline` in `tscircuit/rectdiff`.

## BaseSolver

Override these methods. Never override `step()` or `solve()`; the base class drives the loop, counts iterations, and traps errors.

- `_setup()` optional one-time init, run on the first `step()`.
- `_step()` required. Do one unit of work. Must eventually set `this.solved = true` or `this.failed = true`.
- `getConstructorParams()` return the constructor arguments so a run is reproducible and downloadable from the debugger.
- `getOutput()` the standardized, typed result. Read it after `solved`.
- `visualize()` return a `GraphicsObject`. It must contain at least one non-empty array or the debugger shows "No Graphics Yet".
- `computeProgress()` optional. Return a value in 0..1 for the progress bar.

```ts
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"

export class MergeCellsSolver extends BaseSolver {
  private output: MergeCellsOutput | null = null

  constructor(private readonly input: MergeCellsInput) {
    super()
  }

  override _step(): void {
    const merged = mergeCells(this.input)
    this.output = { cells: merged.cells, depths: merged.depths }
    this.stats = { mergedCells: merged.cells.length }
    this.solved = true
  }

  override getConstructorParams(): [MergeCellsInput] {
    return [this.input]
  }

  override getOutput(): MergeCellsOutput {
    if (!this.output) {
      throw new Error("MergeCellsSolver: getOutput() called before solved")
    }
    return this.output
  }

  override visualize(): GraphicsObject {
    return { points: this.input.pts, rects: [], lines: [], circles: [] }
  }
}
```

For an incremental solver, do exactly one increment per `_step()` and set `solved` only when the work is exhausted. `RectDiffSeedingSolver` in `tscircuit/rectdiff` is the canonical example: heavy init in `_setup()`, one grid candidate placed per `_step()`, `this.stats` updated each step for the debugger, and `this.solved = true` at the end.

## BasePipelineSolver

Subclass `BasePipelineSolver<TInput>`, take a single `inputProblem`, and declare `pipelineDef` with `definePipelineStep`. Each stage is auto-instantiated when reached, stepped incrementally, and its `getOutput()` is captured into `pipelineOutputs[stageName]`. The live sub-solver is also assigned to `this[stageName]`, so declare a property with that exact name.

```ts
import {
  BasePipelineSolver,
  definePipelineStep,
  type BaseSolver,
  type PipelineStep,
} from "@tscircuit/solver-utils"

export class RectDiffPipeline extends BasePipelineSolver<RectDiffInput> {
  gridSolver?: RectDiffGridSolverPipeline
  gapFillSolver?: GapFillSolverPipeline

  override pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep("gridSolver", RectDiffGridSolverPipeline, (p) => [
      {
        bounds: p.inputProblem.bounds,
        obstacles: p.inputProblem.obstacles,
      },
    ]),
    definePipelineStep("gapFillSolver", GapFillSolverPipeline, (p) => [
      { meshNodes: p.gridSolver?.getOutput().meshNodes ?? [] },
    ]),
  ]
}
```

`BgaTopologyGeneratorSolver` in `tscircuit/tscircuit-autorouter` (`lib/solvers/BgaTopologyGeneratorSolver/`) is the fullest reference: a four-stage BGA topology pipeline (build, remove nodes overlapping unmarked obstacles, gap-fill, merge), each stage wired from `inputProblem` and prior stages' `getOutput()`. Stages can themselves be pipelines; `RectDiffPipeline` nests pipelines.

Useful pipeline helpers: `getStageOutput<T>(name)`, `getSolver<T>(name)`, `getCurrentStageName()`, `solveUntilStage(name)`.

## Fail fast on invalid state

If a solver reaches a state it cannot make sense of, throw. Do not silently continue or guess. `step()` traps the throw, sets `failed` and `error`, and re-raises, so the bad state surfaces immediately instead of corrupting later stages. Most existing solvers are lenient here; the direction we are moving is to fail aggressively.

```ts
override _step(): void {
  if (this.candidates.length === 0) {
    throw new Error(`${this.getSolverName()}: no candidates after setup, input is invalid`)
  }
  // ...
}
```

Keep the check tight and the message specific: the solver name plus what was violated. A loud failure on bad input is better than a plausible-looking wrong output.

## Debugging with the React debugger

Render `GenericSolverDebugger` in a `*.page.tsx` React Cosmos file. Pass either a `solver` instance or a `createSolver` factory, and instantiate inside `useMemo` or the factory so it is not rebuilt on every render.

```tsx
import { useMemo } from "react"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"

export default function MergeCellsPage() {
  const solver = useMemo(() => new MergeCellsSolver(exampleInput), [])
  return <GenericSolverDebugger solver={solver} animationSpeed={25} />
}
```

The debugger steps once, solves fully, or animates. It toggles vector and canvas rendering, shows iteration count, elapsed time, and solved/failed badges, renders the pipeline stage table, and lets you download constructor params and test scaffolds. Keep the `/react` import out of `lib/` so the runtime solver stays free of React.

Dev harness: `bun run start` (Cosmos). Tests: `bun test`.
