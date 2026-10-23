import { expect, test } from "bun:test"
import { applyPipeline9TerminalEscapeRelocations } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TerminalEscapeRelocations"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("terminal escape changes the interior pad attachment while preserving the exact electrical tree terminal", (): void => {
  const connection = { name: "ab", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 2, y: 0, layer: "top", pcb_port_id: "B" }],
    electricalBranch: { netId: "ab", startVertexId: "A", endVertexId: "B", logicalConnectionNames: ["ab"] } }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [connection], obstacles: [
      { type: "rect", obstacleId: "pcb_smtpad_0", center: { x: 0, y: 0 }, width: 1, height: 1, ccwRotationDegrees: 35, layers: ["top"], connectedTo: ["A"] },
      { type: "rect", obstacleId: "pcb_smtpad_1", center: { x: 0.6, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign"] },
    ] }
  const route: HighDensityRoute = { connectionName: "ab", rootConnectionName: "ab", startPcbPortId: "A", endPcbPortId: "B", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0, pcb_port_id: "A" }, { x: 2, y: 0, z: 0, pcb_port_id: "B" }], vias: [] }
  const result = applyPipeline9TerminalEscapeRelocations({ srj, originalSrj: srj, routes: [route], newConnections: [connection], syntheticConnectionNames: new Set(),
    drcEvaluator: ({ routes, hdRoutes }) => ({ errors: (routes ?? hdRoutes)![0]!.route.length > 2 ? [] : [{
      type: "pcb_pad_trace_clearance_error", pcb_trace_id: "ab_0", pcb_pad_id: "pcb_smtpad_1",
    }] }), })
  expect(result.acceptedCandidateCount).toBe(1)
  expect(result.routes[0]!.route[0]).toEqual(route.route[0]!)
  expect(result.routes[0]!.route.at(-1)).toEqual(route.route.at(-1)!)
  expect(result.routes[0]!.route[1]!.pcb_port_id).toBeUndefined()
  expect(result.routes[0]!.route[1]!.x !== 0 || result.routes[0]!.route[1]!.y !== 0).toBe(true)
  expect(() => assertSharedElectricalTreeRoutes({ connections: [connection], routes: result.routes, layerCount: 2 })).not.toThrow()
  expect(result.remainingErrors).toEqual([])
  expect(route.route).toHaveLength(2)
})
