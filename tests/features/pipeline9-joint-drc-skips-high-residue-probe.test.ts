import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 skips the fast probe for a high initial DRC residue", () => {
  const connections: SimpleRouteConnection[] = []
  const routes: HighDensityRoute[] = []
  for (let routeIndex = 0; routeIndex < 7; routeIndex++) {
    const connectionName = `route_${routeIndex}`
    const angleRadians = (routeIndex * Math.PI) / 7
    const x = Math.cos(angleRadians)
    const y = Math.sin(angleRadians)
    connections.push({
      name: connectionName,
      pointsToConnect: [
        {
          x: -x,
          y: -y,
          layer: "top",
          pointId: `${connectionName}_start`,
        },
        {
          x,
          y,
          layer: "top",
          pointId: `${connectionName}_end`,
        },
      ],
    })
    routes.push({
      connectionName,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -x, y: -y, z: 0 },
        { x, y, z: 0 },
      ],
      vias: [],
    })
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections,
    obstacles: [],
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: connections,
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

  expect(Number(solver.stats.initialJointDrcIssueCount)).toBeGreaterThan(16)
  expect(solver.stats.exactRepairFastProbeAttempted).toBeFalse()
})
