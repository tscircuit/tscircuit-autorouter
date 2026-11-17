import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { UniformPortDistributionSolverInput } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 only validates redistributed ports when preloaded copper exists", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const inputs: Array<SimpleRouteJson["traces"]> = [
    undefined,
    [],
    [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed",
        connection_name: "fixed",
        route: [
          { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
          { route_type: "wire", x: 2, y: 1, width: 0.1, layer: "top" },
        ],
      },
    ],
  ]
  for (const traces of inputs) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      { ...srj, traces },
      { cacheProvider: null },
    )
    const stage = solver.pipelineDef.find(
      (step) => step.solverName === "uniformPortDistributionSolver",
    )!
    const [input] = stage.getConstructorParams(solver)
    const validate = (input as UniformPortDistributionSolverInput)
      .isPortPointClear
    if (traces?.length) {
      expect(validate).toBeFunction()
      expect(
        validate!({ x: 1, y: 1, z: 0, connectionName: "other" }),
      ).toBeFalse()
      expect(
        validate!({ x: 1, y: 1, z: 1, connectionName: "other" }),
      ).toBeTrue()
    } else {
      expect(validate).toBeUndefined()
    }
  }
})
