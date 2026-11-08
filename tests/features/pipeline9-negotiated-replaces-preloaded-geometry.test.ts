import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9NegotiatedClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9NegotiatedClearanceSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("negotiation evaluates replacement copper without retaining its old colliding path", (): void => {
  const original: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "retained-trace",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    layerCount: 1,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "left-port" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "right-port" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["foreign-pad"],
        circuitJsonMetadata: { pcb_smtpad_id: "foreign-pad" },
      },
      ...[-2, 2].map((x) => ({
        type: "rect" as const,
        center: { x, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["signal", x < 0 ? "left-port" : "right-port"],
      })),
    ],
    traces: [original],
  }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  Object.assign(pipeline, {
    srjWithPointPairs: srj,
    getUpdatedPreloadedTraces: (): SimplifiedPcbTrace[] => [original],
    pipeline9JointDrcRepairSolver: { getOutput: (): [] => [] },
    netToPointPairsSolver: { newConnections: [] },
  })
  const stage = pipeline.pipelineDef.find(
    (step) => step.solverName === "negotiatedClearanceSolver",
  )!
  const params = stage.getConstructorParams(
    pipeline,
  )[0] as ConstructorParameters<typeof Pipeline9NegotiatedClearanceSolver>[0]
  const repaired: SimplifiedPcbTrace = {
    ...original,
    route: [
      original.route[0]!,
      { route_type: "wire", x: -1, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: 1, y: 1, layer: "top", width: 0.1 },
      original.route[1]!,
    ],
  }
  expect(params.evaluate([], [original]).errorCount).toBeGreaterThan(0)
  expect(params.evaluate([], [repaired]).errorCount).toBe(0)
  expect(original.route).toHaveLength(2)
  expect(repaired.__replaces_pcb_trace_id).toBeUndefined()
})
