import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("current materialized forest geometry remains fixed through bounded and exact reference validation", () => {
  const forest: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: "explicit-owned-copper", connection_name: "forest", connectsTo: ["a", "b"], route: [
    { route_type: "wire", x: -2, y: 0, width: 0.15, layer: "top", start_pcb_port_id: "pa" },
    { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "top", end_pcb_port_id: "pb" },
  ] }
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 }, obstacles: [], traces: [forest], connections: [
      { name: "forest", pointsToConnect: [{ x: -2, y: 0, layer: "top", pointId: "a", pcb_port_id: "pa" }, { x: 2, y: 0, layer: "top", pointId: "b", pcb_port_id: "pb" }] },
      { name: "new", pointsToConnect: [{ x: 0, y: -2, layer: "top", pointId: "c", pcb_port_id: "pc" }, { x: 0, y: 2, layer: "top", pointId: "d", pcb_port_id: "pd" }] },
    ] }
  for (const connection of input.connections) for (const point of connection.pointsToConnect) input.obstacles.push({
    type: "rect", center: { x: point.x, y: point.y }, width: 0.5, height: 0.5, layers: ["top"], connectedTo: [connection.name, point.pcb_port_id!],
    circuitJsonMetadata: { pcb_port_id: point.pcb_port_id!, pcb_smtpad_id: `pad_${point.pointId}` },
  })
  const currentForest: SimplifiedPcbTrace = { ...forest, route: [forest.route[0]!,
    { route_type: "wire", x: 0, y: 1, width: 0.15, layer: "top" }, forest.route[1]!] }
  const route: HighDensityRoute = { connectionName: "new", rootConnectionName: "new", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 0, y: -2, z: 0 }, { x: 0, y: 2, z: 0 }], vias: [] }
  const solver = new Pipeline9JointDrcRepairSolver({ srj: input, srjWithPointPairs: input, originalSrj: input,
    newConnections: [input.connections[1]!], newHdRoutes: [route], updatedPreloadedTraces: [currentForest], mutatedPreloadedTraceIds: new Set([forest.pcb_trace_id]),
    generatedFixedTraceIds: new Set([forest.pcb_trace_id]), connMap: getConnectivityMapFromSimpleRouteJson(input), obstacles: input.obstacles,
    layerCount: 2, defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {} })
  expect(solver.initialBoundedRegionalRepairSolver).toBeDefined()
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.generatedForestBoundedRepairTraceCount).toBe(1)
  expect(solver.stats.initialBoundedRegionalRepairAttemptedRegionCount).toBeGreaterThan(0)
  expect(solver.initialBoundedRegionalRepairSolver!.budget.maxCandidateAttempts).toBe(4096)
  expect(solver.initialBoundedRegionalRepairSolver!.budget.maxPathSearchNodes).toBe(40_000_000)
  expect(solver.getUpdatedPreloadedTraces()).toEqual([currentForest])
  const traces = solver.getOutput().map((value, index) => ({ type: "pcb_trace" as const, pcb_trace_id: `new_${index}`, connection_name: "new",
    route: convertHdRouteToSimplifiedRoute(value, 2, { connectionPoints: input.connections[1]!.pointsToConnect }) }))
  expect(evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: [{ ...currentForest, __replaces_pcb_trace_id: forest.pcb_trace_id }, ...traces] }).errors).toEqual([])
})
