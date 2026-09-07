import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("joint repair supplies independent reference validation to its candidate portfolio", () => {
  const routes: HighDensityRoute[] = [0, 1, 2].map((index) => ({
    connectionName: `net${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: index === 2 ? 1 : index * 0.15, z: 0, pcb_port_id: `net${index}_0` },
      { x: 1, y: index === 2 ? 1 : index * 0.15, z: 0, pcb_port_id: `net${index}_1` },
    ],
    vias: [],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: route.route.map((point, index) => ({
        x: point.x,
        y: point.y,
        layer: "top",
        pointId: `${route.connectionName}_${index}`,
        pcb_port_id: point.pcb_port_id,
      })),
    })),
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  const reference = solver.exactRepairSolver!.params.referenceDrcEvaluator
  expect(reference).toBeDefined()
  if (!reference) throw new Error("Joint repair needs reference validation")
  expect(reference).not.toBe(solver.exactRepairSolver!.params.drcEvaluator)
  const initial = reference({ traces: [], routes })
  const changedRoutes = structuredClone(routes)
  // Preserve the third route's terminals while adding a clearance violation.
  changedRoutes[2]!.route.splice(1, 0, { x: 0, y: 0.3, z: 0 })
  const changed = reference({ traces: [], routes: changedRoutes })
  const initialErrors = Array.isArray(initial) ? initial : initial.errors
  const changedErrors = Array.isArray(changed) ? changed : changed.errors
  expect(initialErrors).toHaveLength(1)
  expect(changedErrors.length).toBeGreaterThan(initialErrors.length)
})
