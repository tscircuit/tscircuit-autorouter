import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

test("Pipeline9 dispatches tiny-hypergraph searches and preserves serial routing", async (): Promise<void> => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    connections: Array.from({ length: 6 }, (_, index) => ({
      name: `signal${index}`,
      pointsToConnect: [
        { x: -7, y: index * 2 - 5, layer: "top" },
        { x: 7, y: index * 2 - 5, layer: "top" },
      ],
    })),
  }
  const runtime = new SolverRuntime()
  const names: string[] = []
  const executor = {
    executeAsync: (Solver: any, problem: any): Promise<any> => {
      names.push(Solver.solverName)
      return runtime.executeAsync(Solver, problem)
    },
  }
  try {
    const serial = new Pipeline9(structuredClone(input), {
      effort: 0.1,
      cacheProvider: null,
    })
    serial.solve()
    for (const resume of [false, true]) {
      const parallel = new Pipeline9(structuredClone(input), {
        effort: 0.1,
        cacheProvider: null,
      })
      if (resume) {
        parallel.solveUntilPhase("portPointPathingSolver")
        parallel.step()
        parallel.step()
      }
      await parallel.solveAsync(executor)
      expect(parallel.solved).toBe(true)
      expect(parallel.failed).toBe(false)
      expect(parallel.iterations).toBe(serial.iterations)
      expect(parallel.getOutputSimpleRouteJson()).toEqual(
        serial.getOutputSimpleRouteJson(),
      )
    }
    expect(names).toContain("TinyHyperGraphRouteSearchSolver")
    expect(names).toContain("TinyHyperGraphIndependentRoutesSolver")
  } finally {
    await runtime.dispose()
  }
})
