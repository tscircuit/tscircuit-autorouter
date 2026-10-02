import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9ReportedViaMerges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ReportedViaMerges"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("merges reported same-net vias while an unrelated trace crossing remains", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "a",
      rootConnectionName: "same-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "b",
      rootConnectionName: "same-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0.2, z: 0 },
        { x: 0, y: 0.2, z: 0 },
        { x: 0, y: 0.2, z: 1 },
        { x: 2, y: 0.2, z: 1 },
      ],
      vias: [{ x: 0, y: 0.2 }],
    },
    {
      connectionName: "crossing-horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 3, z: 0 },
        { x: 1, y: 3, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "crossing-vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 2, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      vias: [],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: routes.map((route, routeIndex) => ({
      name: route.connectionName,
      ...(route.rootConnectionName
        ? { __netConnectionName: route.rootConnectionName }
        : {}),
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
        (point, pointIndex) => ({
          x: point.x,
          y: point.y,
          layer: point.z === 0 ? "top" : "bottom",
          pointId: `port_${routeIndex}_${pointIndex}`,
          pcb_port_id: `port_${routeIndex}_${pointIndex}`,
        }),
      ),
    })),
  }
  srj.obstacles = srj.connections.flatMap((connection) =>
    connection.pointsToConnect.map((point) => ({
      type: "rect" as const,
      center: { x: point.x, y: point.y },
      width: 0.15,
      height: 0.15,
      layers: [point.layer!],
      connectedTo: [connection.name, point.pointId!],
      circuitJsonMetadata: {
        pcb_smtpad_id: `pad_${point.pointId}`,
        pcb_port_id: point.pointId!,
      },
    })),
  )
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const drcEvaluator = createPipeline9RelaxedDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    srjWithPointPairs: srj,
    originalSrj: srj,
    mutatedPreloadedTraces: [],
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const before = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  const beforeErrors = Array.isArray(before) ? before : before.errors
  expect(beforeErrors.map((error) => error.type).sort()).toEqual([
    "pcb_trace_error",
    "pcb_via_clearance_error",
  ])
  const original = structuredClone(routes)
  const result = applyPipeline9ReportedViaMerges({
    srj,
    routes,
    connMap,
    drcEvaluator,
    referenceResult: before,
  })
  const afterErrors = Array.isArray(result.referenceResult)
    ? result.referenceResult
    : result.referenceResult.errors
  expect(result.accepted).toBe(true)
  expect(afterErrors.map((error) => error.type)).toEqual(["pcb_trace_error"])
  expect(result.referenceValidationCount).toBe(1)
  expect(routes).toEqual(original)
  expect(result.routes[2]).toBe(routes[2])
  expect(result.routes[3]).toBe(routes[3])
  for (const [index, route] of result.routes.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
  }
  const rejected = applyPipeline9ReportedViaMerges({
    srj,
    routes,
    connMap,
    referenceResult: before,
    drcEvaluator: (): ReturnType<DrcEvaluator> => before,
  })
  expect(rejected.accepted).toBe(false)
  expect(rejected.routes).toBe(routes)
  const blockedSrj: SimpleRouteJson = {
    ...srj,
    minViaEdgeToPadEdgeClearance: 0.1,
    obstacles: [
      ...srj.obstacles,
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.05,
        height: 0.05,
        layers: ["top", "bottom"],
        connectedTo: ["foreign-pad"],
      },
    ],
  }
  const blocked = applyPipeline9ReportedViaMerges({
    srj: blockedSrj,
    routes,
    connMap,
    referenceResult: before,
    drcEvaluator: (): ReturnType<DrcEvaluator> => ({ errors: [] }),
  })
  expect(blocked.accepted).toBe(false)
  expect(blocked.routes).toBe(routes)
  expect(blocked.referenceValidationCount).toBe(0)
})
