import { expect, test } from "bun:test"
import { getBaseMaxIterations } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
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
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 repairs co-owned via clearance while preserving a verified rounded outer anchor", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "A",
      rootConnectionName: "A",
      regionId: "rounded-node",
      startPcbPortId: "A-start",
      endPcbPortId: "A-end",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [-2, 0, 2].map((x) => ({ x, y: -0.5, z: 0 })),
      vias: [],
    },
    {
      connectionName: "B",
      rootConnectionName: "B",
      regionId: "rounded-node",
      startPcbPortId: "B-start",
      endPcbPortId: "B-end",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0.23, z: 0 },
        { x: 0, y: -0.25, z: 0 },
        { x: 0, y: -0.25, z: 1 },
        { x: 2, y: -0.25, z: 1 },
      ],
      vias: [{ x: 0, y: -0.25 }],
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "rounded-node",
    center: { x: 0, y: -0.77 },
    width: 4,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -2, y: -0.5, z: 0, connectionName: "A", pcb_port_id: "A-start" },
      { x: 2, y: -0.5, z: 0, connectionName: "A", pcb_port_id: "A-end" },
      {
        x: 0,
        y: 0.22999999999999998,
        z: 0,
        connectionName: "B",
        pcb_port_id: "B-start",
      },
      { x: 2, y: -0.25, z: 1, connectionName: "B", pcb_port_id: "B-end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 1 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: node.portPoints
        .filter((port) => port.connectionName === route.connectionName)
        .map((port) => ({
          x: port.x,
          y: port.y,
          layer: port.z === 0 ? "top" : "bottom",
          pcb_port_id: port.pcb_port_id,
        })),
    })),
  }
  const nativeBounds = getBoundsFromNodeWithPortPoints(node)
  expect(nativeBounds.maxY).toBe(0.22999999999999998)
  expect(routes[1]!.route[0]!.y).toBeGreaterThan(nativeBounds.maxY)
  expect(
    isPipeline9HighDensityRouteInsideBounds(routes[1]!, nativeBounds, 2),
  ).toBe(false)
  expect(
    isPipeline9HighDensityRouteInsideBounds(routes[1]!, nativeBounds, 2, {
      originalRoute: routes[1]!,
      node,
    }),
  ).toBe(true)
  const originalInputs = structuredClone({ routes, node, srj })
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    hdRoutes: routes,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  let currentRoutes = routes
  let currentErrors = getPipeline9DrcErrors(evaluator, currentRoutes)
  expect(currentErrors).toHaveLength(1)
  expect(currentErrors[0]).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    __trace_segment_owner_trace_id: "A_0",
    __via_owner_trace_ids: ["B_0"],
  })
  let acceptedCount = 0
  const rejections: Record<string, number> = {}
  for (
    let pass = 0;
    pass < getBaseMaxIterations(1) && currentErrors.length > 0;
    pass++
  ) {
    let accepted = false
    for (const candidate of getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: currentRoutes,
      errors: currentErrors,
      traceRouteIndexById: new Map([
        ["A_0", 0],
        ["B_0", 1],
      ]),
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      connMap,
      forceContext: evaluator.getForceContext(currentRoutes),
      effort: 1,
      onCandidateRejected: (reason): void => {
        rejections[reason] = (rejections[reason] ?? 0) + 1
      },
    })) {
      const errors = getPipeline9DrcErrors(evaluator, candidate)
      if (!isPipeline9HighDensityDrcCandidateBetter(errors, currentErrors)) {
        continue
      }
      currentRoutes = candidate
      currentErrors = errors
      acceptedCount++
      accepted = true
      break
    }
    if (!accepted) break
  }
  if (currentErrors.length > 0) {
    console.info("Pipeline9 rounded-anchor force diagnostics", {
      currentErrors,
      acceptedCount,
      rejections,
    })
  }
  expect(acceptedCount).toBeGreaterThan(0)
  expect(currentErrors).toHaveLength(0)
  for (const [index, originalRoute] of routes.entries()) {
    expect(currentRoutes[index]!.route[0]).toEqual(originalRoute.route[0])
    expect(currentRoutes[index]!.route.at(-1)).toEqual(
      originalRoute.route.at(-1),
    )
    expect(currentRoutes[index]).toMatchObject({
      connectionName: originalRoute.connectionName,
      rootConnectionName: originalRoute.rootConnectionName,
      startPcbPortId: originalRoute.startPcbPortId,
      endPcbPortId: originalRoute.endPcbPortId,
      regionId: originalRoute.regionId,
    })
  }

  const escapedInterior = structuredClone(currentRoutes[0]!)
  escapedInterior.route.splice(1, 0, { x: 0, y: 0.23, z: 0 })
  expect(
    isPipeline9HighDensityRouteInsideBounds(escapedInterior, nativeBounds, 2, {
      originalRoute: routes[0]!,
      node,
    }),
  ).toBe(false)
  const movedAnchor = structuredClone(currentRoutes[1]!)
  movedAnchor.route[0]!.x = 0.001
  expect(
    isPipeline9HighDensityRouteInsideBounds(movedAnchor, nativeBounds, 2, {
      originalRoute: routes[1]!,
      node,
    }),
  ).toBe(false)
  const invalidOriginal = structuredClone(routes[1]!)
  invalidOriginal.route[0]!.y = 0.2301
  expect(
    isPipeline9HighDensityRouteInsideBounds(invalidOriginal, nativeBounds, 2, {
      originalRoute: invalidOriginal,
      node,
    }),
  ).toBe(false)
  const invalidInterior = structuredClone(routes[1]!)
  invalidInterior.route[1] = { x: 0.5, y: 0.23, z: 0 }
  expect(
    isPipeline9HighDensityRouteInsideBounds(invalidInterior, nativeBounds, 2, {
      originalRoute: invalidInterior,
      node,
    }),
  ).toBe(false)
  expect(
    isPipeline9HighDensityRouteInsideBounds(routes[1]!, nativeBounds, 2, {
      originalRoute: routes[1]!,
      node: {
        ...node,
        portPoints: node.portPoints.filter(
          (port) => port.connectionName !== "B",
        ),
      },
    }),
  ).toBe(false)
  expect({ routes, node, srj }).toEqual(originalInputs)
})
