import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-joint-drc-repair-solver"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 joint DRC uses the SRJ trace-to-pad clearance", () => {
  const routeY = -0.36
  const connection: SimpleRouteConnection = {
    name: "route",
    pointsToConnect: [
      {
        x: -2,
        y: routeY,
        layer: "top",
        pointId: "route_start",
        pcb_port_id: "route_start",
      },
      {
        x: 2,
        y: routeY,
        layer: "top",
        pointId: "route_end",
        pcb_port_id: "route_end",
      },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: -2, y: routeY },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["route_start"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pad_route_start",
        pcb_port_id: "route_start",
      },
    },
    {
      type: "rect",
      center: { x: 2, y: routeY },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
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
      layers: ["top"],
      connectedTo: ["foreign_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad_foreign" },
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, minY: -1, maxX: 3, maxY: 1 },
    obstacles,
    connections: [connection],
  }
  const route: HighDensityRoute = {
    connectionName: "route",
    rootConnectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: routeY, z: 0, pcb_port_id: "route_start" },
      { x: 2, y: routeY, z: 0, pcb_port_id: "route_end" },
    ],
    vias: [],
  }

  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: [connection],
    newHdRoutes: [route],
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: { route: "red" },
  })

  expect(solver.stats.initialJointDrcIssueCount).toBe(0)
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()).toEqual([route])
})
