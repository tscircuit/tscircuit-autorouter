import { expect, test } from "bun:test"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { Obstacle } from "lib/types/srj-types"
import { createPipeline9RegionalPhysicalProblem } from "../fixtures/pipeline9RegionalPhysicalClearance"

test("regional no-context and no-foreign-copper domains retain their existing solver inputs", (): void => {
  const problem = createPipeline9RegionalPhysicalProblem()
  const legacy = new Pipeline9RegionalFallbackSolver({
    ...problem.params,
    fixedPadClearance: undefined,
  })
  expect(legacy.highDensitySolver.physicalClearanceContext).toBeUndefined()
  const sameNetObstacles: Obstacle[] = problem.obstacles.map(
    (obstacle): Obstacle => ({
      ...obstacle,
      connectedTo: ["target-source"],
    }),
  )
  const distantObstacles: Obstacle[] = problem.obstacles.map(
    (obstacle, index): Obstacle => ({
      ...obstacle,
      center: index === 0 ? { x: 100, y: 100 } : { ...obstacle.center },
    }),
  )
  for (const obstacles of [sameNetObstacles, distantObstacles]) {
    const fixedPadClearance = createPipeline9FixedPadClearance({
      obstacles,
      connMap: problem.connMap,
      layerCount: 2,
      traceToPadClearance: 0.125,
      viaToPadClearance: 0.1875,
    })
    const solver = new Pipeline9RegionalFallbackSolver({
      ...problem.params,
      obstacles,
      boardObstacles: obstacles,
      fixedPadClearance,
    })
    expect(solver.highDensitySolver.physicalClearanceContext).toBeUndefined()
    expect(solver.MAX_ITERATIONS).toBe(legacy.MAX_ITERATIONS)
    expect(solver.highDensitySolver.MAX_ITERATIONS).toBe(
      legacy.highDensitySolver.MAX_ITERATIONS,
    )
    expect(solver.highDensitySolver.traceWidth).toBe(
      legacy.highDensitySolver.traceWidth,
    )
    expect(solver.highDensitySolver.viaDiameter).toBe(
      legacy.highDensitySolver.viaDiameter,
    )
    expect(solver.highDensitySolver.layerCount).toBe(
      legacy.highDensitySolver.layerCount,
    )
    expect(solver.stats).toEqual(legacy.stats)
  }
})
