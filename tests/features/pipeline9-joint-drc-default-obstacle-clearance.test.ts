import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("joint repair uses the declared default clearance unless explicitly overridden", (): void => {
  const routes: HighDensityRoute[] = [0, 0.2001].map((y, index) => ({
    connectionName: `signal_${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y, z: 0, pcb_port_id: `signal_${index}_start` },
      { x: 1, y, z: 0, pcb_port_id: `signal_${index}_end` },
    ],
  }))
  for (const clearance of [undefined, 0.09]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      defaultObstacleMargin: 0.10668,
      minTraceToPadEdgeClearance: clearance,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      obstacles: [],
      connections: routes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: route.route.map((point) => ({
          x: point.x,
          y: point.y,
          layer: "top",
          pointId: point.pcb_port_id,
          pcb_port_id: point.pcb_port_id,
        })),
      })),
    }
    const original = structuredClone(srj)
    const solver = new Pipeline9JointDrcRepairSolver({
      srj,
      srjWithPointPairs: srj,
      originalSrj: srj,
      newConnections: srj.connections,
      newHdRoutes: routes,
      updatedPreloadedTraces: [],
      mutatedPreloadedTraceIds: new Set(),
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      obstacles: [],
      layerCount: 2,
      defaultViaDiameter: 0.3,
      defaultViaHoleDiameter: 0.15,
      effort: 1,
      colorMap: {},
    })
    expect(solver.stats.initialJointDrcIssueCount).toBe(
      clearance === undefined ? 1 : 0,
    )
    expect(srj).toEqual(original)
  }
})
