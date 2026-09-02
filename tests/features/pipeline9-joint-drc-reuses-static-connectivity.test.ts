import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 reuses obstacle connectivity while evaluating changed repair geometry", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: route.route.map((point, index) => ({
        x: point.x,
        y: point.y,
        layer: "top",
        pointId: `${route.connectionName}_${index}`,
      })),
    })),
    obstacles: [
      {
        type: "rect",
        center: { x: 4, y: 4 },
        width: 0.5,
        height: 0.5,
        layers: ["top", "bottom"],
        connectedTo: ["distant_pad"],
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  let connectivityChecks = 0
  const areIdsConnected = connMap.areIdsConnected.bind(connMap)
  connMap.areIdsConnected = (left: string, right: string): boolean => {
    if (right === "distant_pad") connectivityChecks += 1
    return areIdsConnected(left, right)
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: srj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  const evaluate = solver.exactRepairSolver!.params.drcEvaluator!
  const initial = evaluate({ traces: [], routes })
  const warmedConnectivityChecks = connectivityChecks
  const candidate = structuredClone(routes)
  expect(evaluate({ traces: [], routes: candidate })).toEqual(initial)

  // Reusing static lookup data must not reuse the candidate's copper geometry.
  for (const point of candidate[1]!.route) point.x = 0.5
  const changed = evaluate({ traces: [], routes: candidate })
  expect(Array.isArray(initial)).toBeFalse()
  expect(Array.isArray(changed)).toBeFalse()
  if (Array.isArray(initial) || Array.isArray(changed)) {
    throw new Error("Expected DRC errors with centers")
  }
  expect(initial.errorsWithCenters).toMatchObject([{ center: { x: 0, y: 0 } }])
  expect(changed.errorsWithCenters).toMatchObject([
    { center: { x: 0.5, y: 0 } },
  ])
  expect(warmedConnectivityChecks).toBeGreaterThan(0)
  expect(connectivityChecks).toBe(warmedConnectivityChecks)
})
