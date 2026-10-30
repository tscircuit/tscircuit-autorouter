import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("initial indexed bounded repair checks false negatives with full DRC before publication", (): void => {
  const endpoint = (x: number, id: string): Obstacle => ({
    type: "rect", center: { x, y: 0 }, width: 0.5, height: 0.5,
    layers: ["top"], connectedTo: [id],
    circuitJsonMetadata: { pcb_smtpad_id: `pad_${id}`, pcb_port_id: id },
  })
  const connection = {
    name: "route",
    pointsToConnect: [
      { x: -2, y: 0, layer: "top", pcb_port_id: "start" },
      { x: 2, y: 0, layer: "top", pcb_port_id: "end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3, minViaHoleDiameter: 0.15,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [endpoint(-2, "start"), endpoint(2, "end"), {
      type: "rect", center: { x: 0, y: 0 }, width: 0.5, height: 0.5,
      layers: ["top"], connectedTo: ["foreign_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "foreign_pad" },
    }],
    connections: [connection],
  }
  const routes = [{
    connectionName: "route", rootConnectionName: "route", traceThickness: 0.1,
    viaDiameter: 0.3, vias: [],
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "start" },
      { x: 2, y: 0, z: 0, pcb_port_id: "end" },
    ],
  }]
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj, srjWithPointPairs: srj, originalSrj: srj, newConnections: [connection],
    newHdRoutes: routes, updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set(),
    connMap, obstacles: srj.obstacles, layerCount: 2, defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {},
  })
  const initial = solver.initialBoundedRegionalRepairSolver!
  const checked = initial.params.drcEvaluator({ traces: [], routes, hdRoutes: routes })
  expect((Array.isArray(checked) ? checked : checked.errors).length).toBeGreaterThan(0)
  const telemetry = solver as unknown as { referenceDrcFalseNegativeCount: number }
  expect(telemetry.referenceDrcFalseNegativeCount).toBeGreaterThan(0)

  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: [connection], originalConnections: [connection], hdRoutes: solver.getOutput(),
    layerCount: 2, obstacles: srj.obstacles, defaultViaHoleDiameter: 0.15, connMap,
  })
  expect(evaluateRelaxedDrc({ inputSrj: srj, srjWithPointPairs: srj, routedTraces }).errors).toHaveLength(0)
})
