import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getDifferentialPairsForPostProcessing } from "lib/utils/getDifferentialPairsForPostProcessing"

function createTerminatedDifferentialPairSrj(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.125,
    defaultObstacleMargin: 0.125,
    bounds: { minX: 0, maxX: 16, minY: 0, maxY: 10 },
    obstacles: [],
    differentialPairs: [
      {
        connectionNames: ["clk_p", "clk_n"],
        lengthTolerance: 0.25,
      },
    ],
    connections: [
      {
        name: "clk_p",
        netConnectionName: "net_clk_p",
        pointsToConnect: [
          { pointId: "mcu_p", x: 2, y: 6, layer: "top" },
          { pointId: "ddr_p", x: 14, y: 6, layer: "top" },
        ],
      },
      {
        name: "net_clk_p",
        pointsToConnect: [
          { pointId: "mcu_p", x: 2, y: 6, layer: "top" },
          { pointId: "term_p", x: 8, y: 6, layer: "top" },
        ],
      },
      {
        name: "clk_n",
        netConnectionName: "net_clk_n",
        pointsToConnect: [
          { pointId: "mcu_n", x: 2, y: 4, layer: "top" },
          { pointId: "ddr_n", x: 14, y: 4, layer: "top" },
        ],
      },
      {
        name: "net_clk_n",
        pointsToConnect: [
          { pointId: "mcu_n", x: 2, y: 4, layer: "top" },
          { pointId: "term_n", x: 8, y: 4, layer: "top" },
        ],
      },
    ],
  }
}

test("Pipeline9 resolves terminated multi-hop MST differential pairs into length-matching lanes", (): void => {
  const input = createTerminatedDifferentialPairSrj()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)

  const resolved = getDifferentialPairsForPostProcessing({
    pipelineName: "Pipeline9",
    srj: solver.srj,
    pointPairConnections: solver.netToPointPairsSolver!.newConnections,
    pathHopsByConnectionName:
      solver.netToPointPairsSolver!.pathHopsByConnectionName,
    hdRoutes: solver.effortCleanupSolver!.getOutput(),
  })

  expect(resolved.differentialPairs).toHaveLength(0)
  expect(resolved.differentialPairLanes).toHaveLength(1)
  expect(resolved.differentialPairLanes[0]!.connectionNames[0]).toHaveLength(2)
  expect(resolved.differentialPairLanes[0]!.connectionNames[1]).toHaveLength(2)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(4)
})
