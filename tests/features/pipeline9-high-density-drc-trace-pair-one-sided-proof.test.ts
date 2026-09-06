import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson as ForceSimpleRouteJson } from "high-density-repair03/lib"
import {
  applyTracePairSegmentDisplacementForError,
  getTraceRoutePairForError,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import { isPipeline9HighDensityRouteInsideBounds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityRouteInsideBounds"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("native one-sided trace repair preserves bounded copper rejected by two-sided HD force", (): void => {
  const anchored: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "pair-node",
    traceThickness: 0.1,
    viaDiameter: 0.6,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const movable: HighDensityRoute = {
    ...anchored,
    connectionName: "B",
    rootConnectionName: "B",
    route: [
      { x: -2, y: 1, z: 0 },
      { x: -1, y: 0.15, z: 0 },
      { x: 1, y: 0.7, z: 0 },
      { x: 2, y: 1, z: 0 },
    ],
  }
  const routes = [anchored, movable]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pair-node",
    center: { x: 0, y: 2 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    // Declared node handoffs do not need invented PCB terminal identities.
    portPoints: routes.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point) => ({
        ...point,
        connectionName: route.connectionName,
      })),
    ),
  }
  const connMap = new ConnectivityMap({ A: ["A"], B: ["B"] })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.6,
    bounds: { minX: -3, maxX: 3, minY: -1, maxY: 5 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
        x: point.x,
        y: point.y,
        layer: "top",
      })),
    })),
  }
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: routes,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.3,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const errors = getPipeline9DrcErrors(evaluator, routes)
  expect(errors).toHaveLength(1)
  expect(errors[0]!.type).toBe("pcb_trace_error")
  const traceRouteIndexById = new Map([
    ["A_0", 0],
    ["B_0", 1],
  ])
  expect(getTraceRoutePairForError(errors[0]!, traceRouteIndexById)).toEqual([
    0, 1,
  ])
  const original = structuredClone({ routes, node, srj, errors })
  const forceContext = evaluator.getForceContext(routes)
  // The operator has the normal via-radius padding around the HD domain.
  // Moving A's interior edge point outward fits that padding but violates the
  // exact node boundary. Moving only B's interior point inward is legal.
  let geometryRejections = 0
  let yieldedCandidates = 0
  for (const candidate of getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: routes,
    errors,
    traceRouteIndexById,
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.6,
    viaHoleDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    forceContext,
    effort: 1,
    onCandidateRejected: (reason): void => {
      if (reason === "geometry") geometryRejections++
    },
  })) {
    yieldedCandidates++
    expect(
      isPipeline9HighDensityDrcCandidateBetter(
        getPipeline9DrcErrors(evaluator, candidate),
        errors,
      ),
    ).toBe(false)
  }
  expect({ yieldedCandidates, geometryRejections }).toMatchObject({
    yieldedCandidates: 0,
  })
  expect(geometryRejections).toBeGreaterThan(0)

  const nativeRoutes = structuredClone(routes)
  const forceSrj: ForceSimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.6,
    bounds: { minX: -2.3, maxX: 2.3, minY: -0.3, maxY: 4.3 },
    obstacles: forceContext.obstacles,
    connections: [],
  }
  expect(
    applyTracePairSegmentDisplacementForError(
      forceSrj,
      nativeRoutes,
      errors[0]!,
      traceRouteIndexById,
      1,
    ),
  ).toEqual({ movedRouteIndex: 1 })
  const repaired = materializeRoutes(nativeRoutes)
  const repairedErrors = getPipeline9DrcErrors(evaluator, repaired)
  expect(repairedErrors).toHaveLength(0)
  expect(isPipeline9HighDensityDrcCandidateBetter(repairedErrors, errors)).toBe(
    true,
  )
  expect(repaired[0]).toEqual(anchored)
  expect(repaired[1]!.route[1]!.y).toBeCloseTo(0.2, 12)
  expect(repaired[1]!.route[0]).toEqual(movable.route[0])
  expect(repaired[1]!.route.at(-1)).toEqual(movable.route.at(-1))
  expect(repaired.every((route) => route.vias.length === 0)).toBe(true)
  expect(
    repaired.every((route, index) =>
      isPipeline9HighDensityRouteInsideBounds(
        route,
        { minX: -2, maxX: 2, minY: 0, maxY: 4 },
        2,
        { originalRoute: routes[index]!, node },
      ),
    ),
  ).toBe(true)
  expect({ routes, node, srj, errors }).toEqual(original)
})
