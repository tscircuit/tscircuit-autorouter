import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 reference cache reuses revisited geometry and bounds retained candidates", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      vias: [],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
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
    obstacles: [],
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
    obstacles: [],
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  const reference = solver as unknown as {
    cachedReferenceDrcEvaluator: DrcEvaluator
    referenceDrcValidationCount: number
  }
  const evaluate = reference.cachedReferenceDrcEvaluator
  const first = evaluate({ traces: [], routes })
  const changedRoutes = structuredClone(routes)
  for (const point of changedRoutes[1]!.route) point.x = 0.5
  const second = evaluate({ traces: [], routes: changedRoutes })
  const validationCount = reference.referenceDrcValidationCount
  expect(evaluate({ traces: [], routes: structuredClone(routes) })).toBe(first)
  expect(reference.referenceDrcValidationCount).toBe(validationCount)

  for (const point of changedRoutes[1]!.route) point.x = 0.75
  const mutated = evaluate({ traces: [], routes: changedRoutes })
  expect(mutated).not.toBe(second)
  expect(reference.referenceDrcValidationCount).toBe(validationCount + 1)
  if (Array.isArray(mutated)) throw new Error("Expected reference errors with centers")
  expect(mutated.errorsWithCenters!.find(
    (error) => error.pcb_trace_error_id === "overlap_horizontal_0_vertical_0",
  )).toMatchObject({ center: { x: 0.75, y: 0 } })

  // Sixteen distinct newer candidates must evict the initial geometry.
  for (let index = 0; index < 16; index++) {
    const candidate = structuredClone(routes)
    for (const point of candidate[1]!.route) point.x = 0.01 * (index + 1)
    evaluate({ traces: [], routes: candidate })
  }
  const afterEviction = evaluate({ traces: [], routes })
  expect(afterEviction).not.toBe(first)
  expect(afterEviction).toEqual(first)
  expect(evaluate({ traces: [], routes: structuredClone(routes) })).toBe(afterEviction)
})
