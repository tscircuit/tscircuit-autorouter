import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 rejects final copper with a cross-net trace contact", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = srj.connections.map((connection) => ({
    type: "pcb_trace",
    pcb_trace_id: connection.name,
    connection_name: connection.name,
    route: connection.pointsToConnect.map(({ x, y }) => ({
      route_type: "wire",
      x,
      y,
      width: srj.minTraceWidth,
      layer: "top",
    })),
  }))
  const finalStageInput: Pipeline7PowerTraceExpansionInput = {
    ...srj,
    traces,
    fixedTraces: [],
  }
  const finalStage = new PowerTraceExpansionSolver(finalStageInput, {
    onlyConnectionNames: [],
  })
  finalStage.solve()
  expect(finalStage.solved).toBe(true)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.srjWithPointPairs = srj
  solver.powerTraceExpansionSolver = finalStage
  solver.currentPipelineStepIndex = solver.pipelineDef.length
  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.stats.finalDrcIssueCount).toBe(1)
  expect(solver.error).toContain("1 DRC errors remain")
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow()
  expect(() => solver.getOutputSimpleRouteJson()).toThrow()
})
