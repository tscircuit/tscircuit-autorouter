import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import {
  areIdsInitiallyConnected,
  getInitiallyConnectedMapFromSimpleRouteJson,
} from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("Pipeline9 materializes coincident terminals as a direct route while preserving full net connectivity", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 4, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a", pcb_port_id: "pcb_a" },
          { x: 0, y: 0, layer: "top", pointId: "b", pcb_port_id: "pcb_b" },
          { x: 2, y: 0, layer: "top", pointId: "c", pcb_port_id: "pcb_c" },
        ],
      },
    ],
  }
  const before = structuredClone(srj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.srjWithPointPairs!.connections).toHaveLength(2)
  expect(solver.routingSrjWithPointPairs!.connections).toHaveLength(1)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const direct = traces.find(
    (trace) =>
      trace.connectsTo?.includes("a") && trace.connectsTo.includes("b"),
  )
  expect(direct).toBeDefined()
  expect(direct!.route).toHaveLength(2)
  expect(direct!.route[0]).toMatchObject({ start_pcb_port_id: "pcb_a" })
  expect(direct!.route[1]).toMatchObject({ end_pcb_port_id: "pcb_b" })
  expect(
    direct!.route.every(
      (point) =>
        point.route_type === "wire" &&
        point.x === 0 &&
        point.y === 0 &&
        point.layer === "top",
    ),
  ).toBe(true)
  const connected = getInitiallyConnectedMapFromSimpleRouteJson({
    ...srj,
    traces,
  })
  expect(areIdsInitiallyConnected(connected, "a", "b")).toBe(true)
  expect(areIdsInitiallyConnected(connected, "a", "c")).toBe(true)
  const circuitTrace = convertToCircuitJson(srj, traces).find(
    (element) =>
      element.type === "pcb_trace" &&
      element.pcb_trace_id === direct!.pcb_trace_id,
  )
  expect(circuitTrace).toMatchObject({
    route: [
      expect.objectContaining({ start_pcb_port_id: "pcb_a" }),
      expect.objectContaining({ end_pcb_port_id: "pcb_b" }),
    ],
  })
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors,
  ).toEqual([])
  expect(srj).toEqual(before)
})
