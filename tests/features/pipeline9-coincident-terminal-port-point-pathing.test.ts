import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import {
  areIdsInitiallyConnected,
  getInitiallyConnectedMapFromSimpleRouteJson,
} from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("Pipeline9 paths coincident terminals through port-point pathing while preserving full net connectivity", (): void => {
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
  expect(solver.portPointPathingSolver!.solved).toBe(true)
  const pathedPairs = solver
    .portPointPathingSolver!.getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPointsInPairs ?? [])
  const pathedConnectionNames = new Set(
    pathedPairs.map(([start]) => start.connectionName),
  )
  expect(pathedConnectionNames).toEqual(
    new Set(
      solver.srjWithPointPairs!.connections.map(
        (connection) => connection.name,
      ),
    ),
  )
  expect(
    pathedPairs.some(
      ([start, end]) =>
        (start.pcb_port_id === "pcb_a" && end.pcb_port_id === "pcb_b") ||
        (start.pcb_port_id === "pcb_b" && end.pcb_port_id === "pcb_a"),
    ),
  ).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const coincidentTrace = traces.find(
    (trace) =>
      trace.connectsTo?.includes("a") && trace.connectsTo.includes("b"),
  )
  expect(coincidentTrace).toBeDefined()
  expect(coincidentTrace!.route).toHaveLength(2)
  expect(coincidentTrace!.route[0]).toMatchObject({
    start_pcb_port_id: "pcb_a",
  })
  expect(coincidentTrace!.route[1]).toMatchObject({ end_pcb_port_id: "pcb_b" })
  expect(
    coincidentTrace!.route.every(
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
      element.pcb_trace_id === coincidentTrace!.pcb_trace_id,
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
