import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  opts: { y?: number; rootConnectionName?: string } = {},
): HighDensityRoute => ({
  connectionName,
  rootConnectionName: opts.rootConnectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: -1, y: opts.y ?? 0, z: 0 },
    { x: 1, y: opts.y ?? 0, z: 0 },
  ],
  vias: [],
})

const makeConnection = (
  connection: Partial<SimpleRouteConnection> &
    Pick<SimpleRouteConnection, "name">,
): SimpleRouteConnection => ({
  ...connection,
  pointsToConnect: connection.pointsToConnect ?? [
    { x: -1, y: 0, layer: "top" },
    { x: 1, y: 0, layer: "top" },
  ],
})

const makeSimpleSrj = (
  overrides: Partial<SimpleRouteJson> = {},
): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    makeConnection({
      name: "net1",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    }),
  ],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  ...overrides,
})

test("TraceWidthSolver uses top-level trace width defaults and per-connection overrides", () => {
  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("net1"), makeRoute("net2", { y: 2 })],
    connection: [
      makeConnection({ name: "net1" }),
      makeConnection({ name: "net2", nominalTraceWidth: 0.3 }),
    ],
    minTraceWidth: 0.15,
    traceWidthMultiplier: 4,
    layerCount: 2,
  })

  solver.solve()

  const widthsByConnection = new Map(
    solver
      .getHdRoutesWithWidths()
      .map((route) => [route.connectionName, route.traceThickness]),
  )

  expect(widthsByConnection.get("net1")).toBe(0.6)
  expect(widthsByConnection.get("net2")).toBe(0.3)
})

test("TraceWidthSolver applies a connection multiplier through root connection names", () => {
  const solver = new TraceWidthSolver({
    hdRoutes: [
      makeRoute("power_mst0", {
        rootConnectionName: "power",
      }),
    ],
    connection: [makeConnection({ name: "power", traceWidthMultiplier: 8 })],
    minTraceWidth: 0.15,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.getHdRoutesWithWidths()[0]?.traceThickness).toBe(1.2)
})

test("NetToPointPairsSolver preserves trace width settings when it splits a multi-point net", () => {
  const srj = makeSimpleSrj({
    connections: [
      makeConnection({
        name: "power",
        nominalTraceWidth: 0.6,
        traceWidthMultiplier: 4,
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      }),
    ],
  })

  const solver = new NetToPointPairsSolver(srj)
  solver.solve()

  expect(solver.newConnections).toHaveLength(2)
  expect(
    solver.newConnections.every(
      (connection) =>
        connection.rootConnectionName === "power" &&
        connection.nominalTraceWidth === 0.6 &&
        connection.traceWidthMultiplier === 4,
    ),
  ).toBe(true)
})

test("AutoroutingPipelineSolver4 routes a top-level nominal trace width end to end", () => {
  const solver = new AutoroutingPipelineSolver4(
    makeSimpleSrj({ nominalTraceWidth: 0.6 }),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.highDensityRouteSolver?.traceWidth).toBe(0.6)

  const output = solver.getOutputSimpleRouteJson()
  const wireWidths = (output.traces ?? []).flatMap((trace) =>
    trace.route
      .filter((point) => point.route_type === "wire")
      .map((point) => point.width),
  )

  expect(wireWidths.length).toBeGreaterThan(0)
  expect(new Set(wireWidths)).toEqual(new Set([0.6]))
})

test("Pipeline5 keeps non-default trace widths on the local path because hd-cache requests are width agnostic", () => {
  const remoteEligibleNode: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_remote_width",
    center: { x: 0, y: 0 },
    width: 4,
    height: 3,
    availableZ: [0, 1],
    portPoints: [
      { x: -2, y: -1.5, z: 0, connectionName: "A" },
      { x: 2, y: -1.5, z: 0, connectionName: "A" },
      { x: -2, y: 0, z: 1, connectionName: "B" },
      { x: 2, y: 0, z: 1, connectionName: "B" },
      { x: -2, y: 1.5, z: 0, connectionName: "C" },
      { x: 2, y: 1.5, z: 0, connectionName: "C" },
    ],
  }

  let fetchCallCount = 0
  const fetchImpl = Object.assign(
    async () => {
      fetchCallCount += 1
      throw new Error("non-default trace widths should not reach hd-cache")
    },
    { preconnect: () => {} },
  ) as typeof fetch

  const solver = new Pipeline5HdCacheHighDensitySolver({
    nodePortPoints: [remoteEligibleNode],
    traceWidth: 0.6,
    fetchImpl,
  })

  const localSolveCalls: Array<{
    node: NodeWithPortPoints
    nodeIndex: number
  }> = []
  ;(solver as any).solveNodeLocally = (
    node: NodeWithPortPoints,
    nodeIndex: number,
  ) => {
    localSolveCalls.push({ node, nodeIndex })
  }
  ;(solver as any).launchRemoteSolves()

  expect(fetchCallCount).toBe(0)
  expect(localSolveCalls).toEqual([
    {
      node: remoteEligibleNode,
      nodeIndex: 0,
    },
  ])
  expect(solver.stats.remoteRequestsStarted).toBe(0)
  expect(solver.pendingEffects).toEqual([])
})
