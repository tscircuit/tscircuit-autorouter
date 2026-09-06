import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9FixedRouteObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("Pipeline9 forces move a trace away from a fixed via without moving an unrelated via on that trace", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "mutable-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 0.25, z: 0 },
      { x: -1, y: 0.25, z: 0 },
      { x: 1, y: 0.25, z: 0 },
      { x: 3, y: 0.25, z: 0 },
      { x: 3, y: 2, z: 0 },
      { x: 3, y: 2, z: 1 },
      { x: 4, y: 2, z: 1 },
    ],
    vias: [{ x: 3, y: 2 }],
  }
  const fixedRoute: HighDensityRoute = {
    connectionName: "B",
    rootConnectionName: "B",
    regionId: "fixed-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const inputRoutes = [route, fixedRoute]
  const originalRoutes = structuredClone(inputRoutes)
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "mutable-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [
      { x: -4, y: 0.25, z: 0, connectionName: "A" },
      { x: 4, y: 2, z: 1, connectionName: "A" },
    ],
  }
  const connMap = new ConnectivityMap({ A: ["A"], B: ["B"] })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    obstacles: [],
    connections: inputRoutes.map((hdRoute) => ({
      name: hdRoute.connectionName,
      pointsToConnect: [hdRoute.route[0]!, hdRoute.route.at(-1)!].map(
        (point) => ({
          x: point.x,
          y: point.y,
          layer: point.z === 0 ? "top" : "bottom",
        }),
      ),
    })),
  }
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: inputRoutes,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const viaTraceErrors = getPipeline9DrcErrors(drcEvaluator, inputRoutes).filter(
    (error) => error.type === "pcb_via_trace_clearance_error",
  )
  expect(viaTraceErrors.length).toBeGreaterThan(0)
  expect(viaTraceErrors[0]!.__via_owner_trace_ids).toEqual(["B_0"])
  expect(viaTraceErrors[0]!.__trace_segment_owner_trace_id).toBe("A_0")
  let repairedRoute: HighDensityRoute | undefined
  for (const candidate of getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: [route],
    errors: viaTraceErrors,
    traceRouteIndexById: new Map([["A_0", 0]]),
    obstacles: getPipeline9FixedRouteObstacles({
      fixedObstacleRoutes: [fixedRoute],
      layerCount: 2,
    }),
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    effort: 1,
  })) {
    if (
      getPipeline9DrcErrors(drcEvaluator, [...candidate, fixedRoute]).length ===
      0
    ) {
      repairedRoute = candidate[0]
      break
    }
  }
  expect(repairedRoute).toBeDefined()
  expect(repairedRoute!.vias).toEqual(route.vias)
  expect(repairedRoute!.route[0]).toEqual(route.route[0])
  expect(repairedRoute!.route.at(-1)).toEqual(route.route.at(-1))
  expect(inputRoutes).toEqual(originalRoutes)
})
