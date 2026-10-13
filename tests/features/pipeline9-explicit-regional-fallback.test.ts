import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import { precomputeIntraNodeRouteParams } from "lib/solvers/HighDensitySolver/precomputeIntraNodeRouteParams"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type Connection = SimpleRouteJson["connections"][number]
type ConnectionPoint = Connection["pointsToConnect"][number]

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_4",
  center: { x: 3.4875, y: -5.2375 },
  width: 5.475,
  height: 9.525,
  availableZ: [0, 1],
  useExplicitPortPointPairs: true,
  portPoints: [
    {
      x: 0.75,
      y: -6,
      z: 0,
      connectionName: "source_net_0_mst0",
      rootConnectionName: "connectivity_net3",
    },
    {
      x: 0.9875,
      y: -0.475,
      z: 0,
      connectionName: "source_net_0_mst0",
      rootConnectionName: "connectivity_net3",
    },
    {
      x: 0.75,
      y: -1.90875,
      z: 0,
      connectionName: "source_net_3_mst1",
      rootConnectionName: "connectivity_net0",
    },
    {
      x: 5,
      y: -0.475,
      z: 0,
      connectionName: "source_net_3_mst1",
      rootConnectionName: "connectivity_net0",
    },
    {
      x: 2.5,
      y: -0.475,
      z: 0,
      connectionName: "source_net_0_mst2",
      rootConnectionName: "connectivity_net3",
    },
    {
      x: 3.9625,
      y: -0.475,
      z: 1,
      connectionName: "source_net_0_mst2",
      rootConnectionName: "connectivity_net3",
    },
    {
      x: 0.75,
      y: -4.1675,
      z: 0,
      connectionName: "source_net_2_mst2",
      rootConnectionName: "connectivity_net1",
    },
    {
      x: 6.225,
      y: -5.2375,
      z: 0,
      connectionName: "source_net_2_mst2",
      rootConnectionName: "connectivity_net1",
    },
  ],
}

const fixedRoutes: PreloadedHighDensityRoute[] = [
  {
    connectionName: "source_net_0_fixed_0_0",
    rootConnectionName: "connectivity_net3",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -7.27, z: 0 },
      { x: 0.9539681227515293, y: -6.31603187724847, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 0,
    preloadedRoutePositionEnd: 1,
  },
  {
    connectionName: "source_net_0_fixed_0_1",
    rootConnectionName: "connectivity_net3",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.9539681227515293, y: -6.31603187724847, z: 0 },
      { x: 0.9539681227515293, y: -0.19605561044583464, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 1,
    preloadedRoutePositionStart: 1,
    preloadedRoutePositionEnd: 2,
  },
  {
    connectionName: "source_net_0_fixed_0_2",
    rootConnectionName: "connectivity_net3",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.9539681227515293, y: -0.19605561044583464, z: 0 },
      { x: 0.9539681227515293, y: -0.12896812275152936, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 2,
    preloadedRoutePositionStart: 2,
    preloadedRoutePositionEnd: 3,
  },
]

const preloadedTrace: SimplifiedPcbTrace = {
  type: "pcb_trace",
  pcb_trace_id: "source_net_0_mst0_0",
  connection_name: "source_net_0",
  route: fixedRoutes.flatMap((fixedRoute, routeIndex) =>
    fixedRoute.route.slice(routeIndex === 0 ? 0 : 1).map((point) => ({
      route_type: "wire" as const,
      x: point.x,
      y: point.y,
      width: fixedRoute.traceThickness,
      layer: "top",
    })),
  ),
}

test("explicit fallback preserves new edges and fixed splices", (): void => {
  const originalNode = structuredClone(node)
  const fallback = createRegionalFallbackProblem(node, fixedRoutes)
  expect(fallback.nodeWithPortPoints.portPoints).toHaveLength(10)
  expect(fallback.nodeWithPortPoints.portPointsInPairs).toHaveLength(5)
  const tasks = precomputeIntraNodeRouteParams(fallback.nodeWithPortPoints)
  expect(tasks.explicitConnectionPairs).toHaveLength(5)
  expect(
    new Set(
      tasks.explicitConnectionPairs!.map((task): string => task.connectionName),
    ),
  ).toEqual(
    new Set([
      ...node.portPoints.map((point): string => point.connectionName),
      fixedRoutes[0]!.connectionName,
    ]),
  )
  expect(node).toEqual(originalNode)

  const familyPoints: PortPoint[] = [
    { x: 0, y: 0, z: 0, connectionName: "star", portPointId: "origin" },
    { x: 1, y: 0, z: 0, connectionName: "star", portPointId: "branch1" },
    { x: 2, y: 0, z: 0, connectionName: "star", portPointId: "branch2" },
    {
      x: 0,
      y: 1,
      z: 0,
      connectionName: "linked",
      portPointId: "linked0",
      nextPortPointId: "linked1",
    },
    {
      x: 1,
      y: 1,
      z: 0,
      connectionName: "linked",
      portPointId: "linked1",
      prevPortPointId: "linked0",
      nextPortPointId: "linked2",
    },
    {
      x: 2,
      y: 1,
      z: 0,
      connectionName: "linked",
      portPointId: "linked2",
      prevPortPointId: "linked1",
    },
  ]
  const familyNode: NodeWithPortPoints = { ...node, portPoints: familyPoints }
  const familyFallback = createRegionalFallbackProblem(familyNode, [])
  expect(
    familyFallback.nodeWithPortPoints.portPointsInPairs!.map(
      ([start, end]): Array<string | undefined> => [
        start.portPointId,
        end.portPointId,
      ],
    ),
  ).toEqual([
    ["origin", "branch1"],
    ["origin", "branch2"],
    ["linked0", "linked1"],
    ["linked1", "linked2"],
  ])
  expect(
    precomputeIntraNodeRouteParams(familyFallback.nodeWithPortPoints)
      .explicitConnectionPairs,
  ).toHaveLength(4)
  const partialNode: NodeWithPortPoints = {
    ...familyNode,
    portPointsInPairs: [[familyPoints[0]!, familyPoints[1]!]],
  }
  const partialFallback = createRegionalFallbackProblem(partialNode, [])
  expect((): void => {
    precomputeIntraNodeRouteParams(partialFallback.nodeWithPortPoints)
  }).toThrow("leave node points unpaired")
  const completeNode: NodeWithPortPoints = {
    ...node,
    portPointsInPairs: [
      [node.portPoints[0]!, node.portPoints[1]!],
      [node.portPoints[2]!, node.portPoints[3]!],
      [node.portPoints[4]!, node.portPoints[5]!],
      [node.portPoints[6]!, node.portPoints[7]!],
    ],
  }
  expect(
    createRegionalFallbackProblem(
      completeNode,
      fixedRoutes,
    ).nodeWithPortPoints.portPointsInPairs!.slice(0, 4),
  ).toEqual(completeNode.portPointsInPairs!)

  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: fixedRoutes,
    connMap: new ConnectivityMap({
      connectivity_net0: ["source_net_3_mst1"],
      connectivity_net1: ["source_net_2_mst2"],
      connectivity_net3: [
        "source_net_0_mst0",
        "source_net_0_mst2",
        ...fixedRoutes.map((route) => route.connectionName),
      ],
    }),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.failedSolvers).toHaveLength(1)
  expect(solver.stats).toMatchObject({
    fallbackNodeCount: 1,
    reroutedFixedRouteCount: 2,
    reroutedFixedRouteSectionCount: 1,
  })
  expect(solver.routes).toHaveLength(4)
  expect(
    new Set(solver.routes.map((route): string => route.connectionName)),
  ).toEqual(
    new Set(node.portPoints.map((point): string => point.connectionName)),
  )
  for (const point of node.portPoints) {
    const route = solver.routes.find(
      (candidate): boolean => candidate.connectionName === point.connectionName,
    )
    expect(route).toBeDefined()
    // The regional portfolio rounds endpoints to its existing 0.001mm grid.
    expect(
      [route!.route[0]!, route!.route.at(-1)!].some(
        (endpoint): boolean =>
          endpoint.z === point.z &&
          Math.hypot(endpoint.x - point.x, endpoint.y - point.y) <= 0.001,
      ),
    ).toBeTrue()
  }
  expect([...solver.fixedRouteReplacements.keys()]).toEqual([
    "source_net_0_fixed_0_0",
  ])

  const updatedFixedRoutes = solver.getUpdatedFixedHdRoutes()
  expect(updatedFixedRoutes).toHaveLength(2)
  expect(updatedFixedRoutes[0]!.route[0]).toEqual(fixedRoutes[0]!.route[0])
  expect(updatedFixedRoutes[0]!.route.at(-1)).toEqual(
    fixedRoutes[1]!.route.at(-1),
  )
  expect(updatedFixedRoutes[1]).toBe(fixedRoutes[2])
  const routes = [...solver.routes, ...updatedFixedRoutes]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -10, maxX: 10, minY: -15, maxY: 10 },
    obstacles: [],
    connections: routes.map(
      (route): Connection => ({
        name: route.connectionName,
        __netConnectionName: route.rootConnectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point): ConnectionPoint => ({
            x: point.x,
            y: point.y,
            layer: mapZToLayerName(point.z, 2),
          }),
        ),
      }),
    ),
  }
  // Regional fragments end at mesh boundaries rather than physical pads.
  expect(
    getDrcErrors(convertToCircuitJson(srj, routes), {
      includeTraceContinuity: false,
    }).errors,
  ).toEqual([])
  expect(
    solver.preloadedTraceMutationMasks.get(
      updatedFixedRoutes[0]!.connectionName,
    ),
  ).toEqual(Array(updatedFixedRoutes[0]!.route.length - 1).fill(true))
  expect(
    solver.preloadedTraceMutationMasks.has(fixedRoutes[2]!.connectionName),
  ).toBeFalse()

  const { updatedPreloadedTraces, mutatedPreloadedTraces } =
    applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces: [preloadedTrace],
      originalFixedRoutes: fixedRoutes,
      updatedFixedRoutes,
      replacedConnectionNames: new Set(solver.fixedRouteReplacements.keys()),
      layerCount: 2,
      defaultViaHoleDiameter: 0.15,
      obstacles: [],
      connMap: solver.connMap,
    })
  expect(mutatedPreloadedTraces).toHaveLength(1)
  expect(updatedPreloadedTraces[0]!.pcb_trace_id).toBe(
    preloadedTrace.pcb_trace_id,
  )
  expect(updatedPreloadedTraces[0]!.route[0]).toMatchObject(
    preloadedTrace.route[0]!,
  )
  expect(updatedPreloadedTraces[0]!.route.at(-1)).toMatchObject(
    preloadedTrace.route.at(-1)!,
  )
  expect(updatedPreloadedTraces[0]!.route.length).toBeGreaterThan(
    preloadedTrace.route.length,
  )
})
