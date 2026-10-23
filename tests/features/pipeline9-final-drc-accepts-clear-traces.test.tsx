import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"

test("Pipeline9 publishes final copper that passes the declared DRC rules", (): void => {
  const connection: SimpleRouteConnection = {
    name: "signal",
    pointsToConnect: [
      { x: -1, y: 0, layer: "top", pcb_port_id: "signal-start" },
      { x: 1, y: 0, layer: "top", pcb_port_id: "signal-end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    minPadEdgeToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.3,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [connection],
    obstacles: connection.pointsToConnect.map(
      (point): Obstacle => ({
        type: "rect",
        center: { x: point.x, y: point.y },
        layers: ["top"],
        width: 0.2,
        height: 0.2,
        connectedTo: [connection.name],
        circuitJsonMetadata: { pcb_port_id: point.pcb_port_id },
      }),
    ),
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal-copper",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
    ],
  }
  const finalStageInput: Pipeline7PowerTraceExpansionInput = {
    ...srj,
    traces: [trace],
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

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getOutputSimplifiedPcbTraces()).toEqual([trace])
  expect(solver.getOutputSimpleRouteJson().traces).toEqual([trace])
})
