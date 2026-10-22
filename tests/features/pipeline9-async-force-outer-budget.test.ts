import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import {
  expectHighDensityForceImproveState,
} from "../fixtures/expectHighDensityForceImproveState"

const input: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  connections: [
    {
      name: "signal",
      pointsToConnect: [
        { x: -3, y: 0, layer: "top" },
        { x: 3, y: 0, layer: "top" },
      ],
    },
  ],
}

test("async force commits stop at the same outer pipeline budget as native steps", async (): Promise<void> => {
  for (const extraIterations of [0, 1, 2, 4]) {
    const serial = new Pipeline9(structuredClone(input), {
      effort: 0.1,
      cacheProvider: null,
    })
    const parallel = new Pipeline9(structuredClone(input), {
      effort: 0.1,
      cacheProvider: null,
    })
    for (const solver of [serial, parallel]) {
      solver.solveUntilPhase("highDensityForceImproveSolver")
      solver.step()
      solver.MAX_ITERATIONS = solver.iterations + extraIterations
    }
    serial.solve()
    const runtime = createPipeline9TestRuntime(2)
    try {
      await parallel.solveAsync(runtime)
    } finally {
      await runtime.dispose()
    }
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.error).toBe(serial.error)
    expect(parallel.solved).toBe(serial.solved)
    expect(parallel.failed).toBe(serial.failed)
    expectHighDensityForceImproveState(
      parallel.highDensityForceImproveSolver!,
      serial.highDensityForceImproveSolver!,
    )
  }
})
