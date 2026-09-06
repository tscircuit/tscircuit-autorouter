import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensityForceContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type ForceScopeAccess = {
  startNodeRepair: (node: NodeWithPortPoints) => void
  activeConnectionNames: Set<string>
  activeForceConnectionNames: Set<string>
  activeForceCandidates: Generator<HighDensityRoute[], void, unknown>
  activeRepairObstacles: Obstacle[]
  getRepairNode: (
    node: NodeWithPortPoints,
    connectionNames: ReadonlySet<string>,
  ) => NodeWithPortPoints
}

test("Pipeline9 force scope includes clean owned neighbours but not preloads or another node", (): void => {
  const createRoute = (
    connectionName: string,
    regionId: string,
    y: number,
  ): HighDensityRoute => ({
    connectionName,
    rootConnectionName: connectionName,
    regionId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -5, y, z: 0 },
      { x: -1, y, z: 0 },
      { x: 1, y, z: 0 },
      { x: 5, y, z: 0 },
    ],
    vias: [],
  })
  const routes = [
    createRoute("A", "node", 0),
    createRoute("B", "node", 2),
    createRoute("preload-pseudo", "node", 4),
    createRoute("D", "other-node", 20),
  ]
  const fixedRoutes = [createRoute("E", "node", -4)]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: routes.slice(0, 3).flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point) => ({
        ...point,
        connectionName: route.connectionName,
      })),
    ),
  }
  const connMap = new ConnectivityMap({
    A: ["A", "A_0"],
    B: ["B", "B_0"],
    D: ["D", "D_0"],
    E: ["E"],
    preload: ["preload-pseudo"],
  })
  const drcEvaluator = Object.assign(
    (): never => {
      throw new Error("The scope regression must not assign DRC outcomes")
    },
    {
      getForceContext: (): Pipeline9HighDensityForceContext => ({
        connMap,
        obstacles: [],
      }),
    },
  )
  const original = structuredClone({ routes, fixedRoutes, node })
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: routes,
    fixedHdRoutes: fixedRoutes,
    newConnections: routes
      .filter((route) => route.connectionName !== "preload-pseudo")
      .map((route) => ({
        name: route.connectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point) => ({
            x: point.x,
            y: point.y,
            layer: "top",
          }),
        ),
      })),
    drcEvaluator,
    connMap,
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 1,
  })
  // Exercise scope construction independently from physical DRC correctness.
  // Only A participates in this declared target; B is an owned clean neighbour.
  solver.currentErrors = [
    {
      type: "pcb_trace_error",
      pcb_trace_id: "A_0",
      center: { x: 0, y: -0.1 },
      minimum_clearance: 0.1,
    },
  ]
  const scope = solver as unknown as ForceScopeAccess
  scope.startNodeRepair(node)
  expect(scope.activeConnectionNames).toEqual(new Set(["A"]))
  expect(scope.activeForceConnectionNames).toEqual(new Set(["A", "B"]))
  const firstCandidate = scope.activeForceCandidates.next()
  expect(firstCandidate.done).toBe(false)
  if (firstCandidate.done) throw new Error("The fixture requires a force move")
  expect(firstCandidate.value.map((route) => route.connectionName)).toEqual([
    "A",
    "B",
  ])
  expect(firstCandidate.value[0]).not.toEqual(routes[0])
  expect(firstCandidate.value[1]).toEqual(routes[1])
  for (const [index, candidate] of firstCandidate.value.entries()) {
    expect(candidate.route[0]).toEqual(routes[index]!.route[0])
    expect(candidate.route.at(-1)).toEqual(routes[index]!.route.at(-1))
  }
  const rerouteNode = scope.getRepairNode(node, scope.activeConnectionNames)
  expect(
    new Set(rerouteNode.portPoints.map((point) => point.connectionName)),
  ).toEqual(new Set(["A"]))
  const fixedObstacleOwners = new Set(
    scope.activeRepairObstacles.flatMap((obstacle) => obstacle.connectedTo),
  )
  expect(fixedObstacleOwners.has("A")).toBe(false)
  for (const name of ["B", "preload-pseudo", "E"]) {
    expect(fixedObstacleOwners.has(name)).toBe(true)
  }
  expect(fixedObstacleOwners.has("D")).toBe(false)
  expect(solver.outputHdRoutes).toBe(routes)
  expect({ routes, fixedRoutes, node }).toEqual(original)
})
