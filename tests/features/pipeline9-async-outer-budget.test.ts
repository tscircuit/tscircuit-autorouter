import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { getPipeline9LogicalStats } from "../fixtures/getPipeline9LogicalStats"

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

test("async high density respects the outer pipeline budget at the same serial step", async (): Promise<void> => {
  for (const extraIterations of [0, 1, 7, 30]) {
    const solvers = [
      new Pipeline9(structuredClone(input), {
        effort: 0.1,
        cacheProvider: null,
      }),
      new Pipeline9(structuredClone(input), {
        effort: 0.1,
        cacheProvider: null,
      }),
    ]
    for (const solver of solvers) {
      solver.solveUntilPhase("highDensityRouteSolver")
      solver.step()
      solver.MAX_ITERATIONS = solver.iterations + extraIterations
    }
    const [serial, parallel] = solvers as [Pipeline9, Pipeline9]
    serial.solve()
    const runtime = createPipeline9TestRuntime(2)
    try {
      await parallel.solveAsync(runtime)
    } finally {
      await runtime.dispose()
    }
    expect(parallel.error).toBe(serial.error)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.solved).toBe(serial.solved)
    expect(parallel.failed).toBe(serial.failed)
    expect(parallel.highDensityRouteSolver!.routes).toEqual(
      serial.highDensityRouteSolver!.routes,
    )
    expect(getPipeline9LogicalStats(parallel.highDensityRouteSolver!.stats)).toEqual(
      getPipeline9LogicalStats(serial.highDensityRouteSolver!.stats),
    )
    expect(parallel.highDensityRouteSolver!.iterations).toBe(
      serial.highDensityRouteSolver!.iterations,
    )
  }
})
