import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import { precomputeIntraNodeRouteParams } from "lib/solvers/HighDensitySolver/precomputeIntraNodeRouteParams"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("regional inputs keep legacy requests or a complete explicit pair list when fixed copper is added", (): void => {
  const ports: PortPoint[] = [
    { x: -1, y: -0.8, z: 0, connectionName: "new" },
    { x: -1, y: -0.4, z: 0, connectionName: "new" },
    { x: -1, y: 0.4, z: 0, connectionName: "new" },
    { x: -1, y: 0.8, z: 0, connectionName: "new" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "legacy-and-fixed",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: ports,
  }
  const fixed: PreloadedHighDensityRoute = {
    connectionName: "fixed-section",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 0,
    preloadedRoutePositionEnd: 1,
  }
  for (const pairs of [undefined, []]) {
    const problem = createRegionalFallbackProblem(
      { ...node, portPointsInPairs: pairs },
      [fixed],
    )
    expect(problem.nodeWithPortPoints.portPointsInPairs).toEqual(pairs)
    const tasks = precomputeIntraNodeRouteParams(problem.nodeWithPortPoints)
      .connectionTasks
    expect(tasks.map((task) => task.connectionName)).toEqual([
      "new",
      "fixed-section",
    ])
    expect(tasks[0]!.points).toHaveLength(4)
    expect(tasks[1]!.points).toHaveLength(2)
  }
  const explicit = createRegionalFallbackProblem(
    {
      ...node,
      portPointsInPairs: [
        [ports[0], ports[1]],
        [ports[2], ports[3]],
      ],
    },
    [fixed],
  )
  expect(explicit.nodeWithPortPoints.portPointsInPairs).toHaveLength(3)
  expect(
    precomputeIntraNodeRouteParams(explicit.nodeWithPortPoints)
      .connectionTasks.map((task) => task.connectionName),
  ).toEqual(["new", "new", "fixed-section"])
  const repairOnly = createRegionalFallbackProblem(
    { ...node, portPoints: [] },
    [fixed],
  )
  expect(repairOnly.nodeWithPortPoints.portPointsInPairs).toHaveLength(1)
  expect(
    precomputeIntraNodeRouteParams(repairOnly.nodeWithPortPoints).connectionTasks,
  ).toHaveLength(1)
})
