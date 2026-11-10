import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("preserved or externally completed owned copper is rejected", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  const hop = srj.connections[0]!
  srj.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "preserved",
      connection_name: hop.name,
      route: hop.pointsToConnect.map((point) => ({
        route_type: "wire" as const,
        x: point.x,
        y: point.y,
        width: 0.1,
        layer: "top",
      })),
    },
  ]
  expect(() => new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)).toThrow(
    "preserved copper",
  )
  srj.traces = []
  hop.externallyConnectedPointIds = [
    hop.pointsToConnect.map((point): string => point.pointId!),
  ]
  expect(() => new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)).toThrow(
    "preserved copper",
  )
})
