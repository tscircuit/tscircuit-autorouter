import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("shared copper restores independent logical routes and terminal IDs", (): void => {
  const pairs: [PortPoint, PortPoint][] = ["mst-1", "mst-2"].map(
    (connectionName) => [
      {
        connectionName,
        rootConnectionName: connectionName,
        portPointId: "left",
        pcb_port_id: "pad-a",
        x: -1,
        y: 0,
        z: 0,
      },
      {
        connectionName,
        rootConnectionName: connectionName,
        portPointId: "right",
        pcb_port_id: "pad-b",
        x: 1,
        y: 0,
        z: 0,
      },
    ],
  )
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "shared-terminals",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: pairs.flat(),
    portPointsInPairs: pairs,
  }
  const params = {
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({ signal: ["mst-1", "mst-2"] }),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    effort: 1,
    preserveTerminalPcbPortIds: true,
    shareSameNetCopper: true,
  }
  const solver = new Pipeline9HighDensitySolver(params)
  expect(solver.stats.sharedCopperConnectionCount).toBe(1)
  expect(solver.unsolvedNodePortPoints[0]!.portPoints).toHaveLength(2)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(1)
  const physicalRoot = params.connMap.getNetConnectedToId("mst-1")!
  expect(solver.routes[0]!.rootConnectionName).toBe(physicalRoot)
  expect(
    solver.routingNodePortPoints[0]!.portPoints.every(
      (point) => point.rootConnectionName === physicalRoot,
    ),
  ).toBe(true)
  const logicalRoutes = solver.restoreSharedCopperBranches(solver.routes)
  expect(logicalRoutes.map((route) => route.connectionName).sort()).toEqual([
    "mst-1",
    "mst-2",
  ])
  expect(logicalRoutes.map((route) => route.rootConnectionName).sort()).toEqual(
    ["mst-1", "mst-2"],
  )
  for (const route of logicalRoutes) {
    expect(route.startPcbPortId).toBe("pad-a")
    expect(route.endPcbPortId).toBe("pad-b")
  }
  logicalRoutes[0]!.route[0]!.x = 99
  expect(logicalRoutes[1]!.route[0]!.x).toBe(-1)
  expect(solver.routes[0]!.route[0]!.x).toBe(-1)
  expect(() =>
    solver.restoreSharedCopperBranches([
      { ...solver.routes[0]!, regionId: "missing-region" },
    ]),
  ).toThrow("lost its physical region")

  const physicalSolver = new Pipeline9HighDensitySolver({
    ...params,
    shareSameNetCopper: false,
    minimumTraceWidth: 0.15,
  })
  expect(physicalSolver.stats.sharedCopperConnectionCount).toBe(0)
  expect(physicalSolver.unsolvedNodePortPoints[0]).toBe(node)
  expect(
    () =>
      new Pipeline9HighDensitySolver({
        ...params,
        minimumTraceWidth: 0.15,
      }),
  ).toThrow(
    "Shared legacy copper cannot replace physical/fixed-copper routing demands",
  )
})
