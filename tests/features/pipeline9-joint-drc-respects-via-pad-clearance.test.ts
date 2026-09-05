import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 joint DRC uses the SRJ via-to-pad clearance", () => {
  const viaX = 0.46
  const connection: SimpleRouteConnection = {
    name: "route",
    pointsToConnect: [
      {
        x: viaX,
        y: -1,
        layer: "top",
        pointId: "route_start",
        pcb_port_id: "route_start",
      },
      {
        x: viaX,
        y: 1,
        layer: "bottom",
        pointId: "route_end",
        pcb_port_id: "route_end",
      },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: viaX, y: -1 },
      width: 0.3,
      height: 0.3,
      layers: ["top"],
      connectedTo: ["route_start"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pad_route_start",
        pcb_port_id: "route_start",
      },
    },
    {
      type: "rect",
      center: { x: viaX, y: 1 },
      width: 0.3,
      height: 0.3,
      layers: ["bottom"],
      connectedTo: ["route_end"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pad_route_end",
        pcb_port_id: "route_end",
      },
    },
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top", "bottom"],
      connectedTo: ["foreign_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad_foreign" },
    },
    {
      type: "rect",
      center: { x: 0.66, y: 0.75 },
      width: 0.3,
      height: 0.1,
      layers: ["bottom"],
      connectedTo: ["trigger_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad_repair_trigger" },
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaEdgeToPadEdgeClearance: 0.05,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -1, minY: -1.5, maxX: 1, maxY: 1.5 },
    obstacles,
    connections: [connection],
  }
  const route: HighDensityRoute = {
    connectionName: "route",
    rootConnectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: viaX, y: -1, z: 0, pcb_port_id: "route_start" },
      { x: viaX, y: 0, z: 0 },
      { x: viaX, y: 0, z: 1 },
      { x: viaX, y: 1, z: 1, pcb_port_id: "route_end" },
    ],
    vias: [{ x: viaX, y: 0 }],
  }

  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: [connection],
    newHdRoutes: [route],
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: { route: "red" },
  })

  expect(solver.stats.initialJointDrcIssueCount).toBeGreaterThan(0)
  expect(solver.exactRepairSolver).toBeDefined()
  const indexedDrcResult = (
    solver as unknown as { drcEvaluator: DrcEvaluator }
  ).drcEvaluator({ traces: [], routes: [route], hdRoutes: [route] })
  const indexedErrors = Array.isArray(indexedDrcResult)
    ? indexedDrcResult
    : indexedDrcResult.errors
  expect(
    indexedErrors.filter(
      (error) =>
        (error.type ?? error.error_type) === "pcb_pad_pad_clearance_error",
    ),
  ).toHaveLength(0)

  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: [connection],
    originalConnections: [connection],
    hdRoutes: [route],
    layerCount: 2,
    obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const drc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces,
    drcOptions: { traceClearance: 0.05 },
  })
  const strictErrors = checkViaPadClearance(drc.circuitJson, {
    minClearance: 0.1,
  })
  const declaredErrors = checkViaPadClearance(drc.circuitJson, {
    minClearance: 0.05,
  })

  expect(strictErrors.length).toBeGreaterThan(0)
  expect(declaredErrors).toHaveLength(0)
})
