import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"
import { createMeshInput } from "../fixtures/constrained-corridor-mesh-fixture"

test("both analytic witnesses preserve loud finite nondegenerate crop invariants", (): void => {
  for (const existingPath of [false, true]) for (const kind of ["flat", "nan", "infinity", "reversed"] as const) {
    const input = createMeshInput()
    input.start.y = 0
    input.end.y = 0
    if (existingPath) input.existingPath = [input.start, input.end]
    if (kind === "flat") input.bounds.minY = input.bounds.maxY = 0
    if (kind === "nan") input.bounds.minX = Number.NaN
    if (kind === "infinity") input.bounds.maxX = Infinity
    if (kind === "reversed") input.bounds.maxX = input.bounds.minX - 1
    const child = new FindClearancePathSolver(input)
    expect((): void => {
      // Direct phase entry verifies the invariant error itself, independent of
      // BaseSolver's error-reporting wrapper around public step().
      for (let step = 0; step < 100 && !child.solved; step++) child._step()
    }).toThrow("Mesh corridor requires nondegenerate finite bounds")
    expect(child.solved).toBe(false)
    expect(child.stats.nodesPopped).toBe(0)
  }
})
