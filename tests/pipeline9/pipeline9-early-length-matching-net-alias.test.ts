import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 resolves constrained net aliases before selecting and removing early routes", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -2, maxX: 12, minY: -5, maxY: 5 },
    obstacles: [],
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance: 0.01 }],
    connections: [
      {
        name: "positive_connection",
        __netConnectionName: "P",
        pointsToConnect: [{ x: 0, y: 1, layer: "top" }, { x: 10, y: 1, layer: "top" }],
      },
      {
        name: "negative_connection",
        __netConnectionName: "N",
        pointsToConnect: [{ x: 0, y: -1, layer: "top" }, { x: 10, y: -1, layer: "top" }],
      },
      {
        name: "ordinary",
        pointsToConnect: [{ x: 0, y: -3, layer: "top" }, { x: 10, y: -3, layer: "top" }],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solveUntilPhase("componentDetectionSolver")
  expect(solver.lengthMatchingPostProcessingSolver?.solved).toBe(true)
  expect(solver.lengthMatchingPostProcessingSolver!.getOutput().hdRoutes).toHaveLength(2)
  expect(solver.srj.connections.map((connection): string => connection.name)).toEqual(["ordinary"])
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver._getOutputHdRoutes()).toHaveLength(3)
  expect(new Set(solver.getOutputSimplifiedPcbTraces().map((trace): string => trace.connection_name))).toEqual(new Set(["P", "N", "ordinary"]))
})
