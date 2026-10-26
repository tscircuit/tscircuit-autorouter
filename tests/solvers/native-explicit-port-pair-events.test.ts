import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { actualNet299Node } from "./nativeExplicitPairTestUtils"

test("native kernels preserve the two actual Net299 routing events and legacy star policy", (): void => {
  const params = {
    nodeWithPortPoints: structuredClone(actualNet299Node),
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    layerCount: 8,
    connMap: new ConnectivityMap({ net299: ["source_net_altium_pcb_299"] }),
    cacheProvider: null,
    captureSearchDebug: false,
    priorityFamilySize: 4,
  }
  const expected = actualNet299Node.portPointsInPairs!.map(([a, b]) => [
    { x: a.x, y: a.y, z: a.z },
    { x: b.x, y: b.y, z: b.z },
  ])
  const legacyNode = structuredClone(actualNet299Node)
  delete legacyNode.portPointsInPairs
  const legacy = new CachedIntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: legacyNode,
  })
  const native = new CachedIntraNodeRouteSolver(params)
  expect(native.unsolvedConnections.map((t) => t.points)).toEqual(expected)
  expect(native.MAX_ITERATIONS).toBe(legacy.MAX_ITERATIONS)
  const priority = new PriorityDagIntraNodeSolver(params)
  const tasks: typeof native.unsolvedConnections = Reflect.get(priority, "tasks")
  expect(tasks.map((task) => task.points).reverse()).toEqual(expected)
  expect(tasks.map((task) => task.routeEventId).sort()).toEqual([0, 1])
  native.unsolvedConnections = []
  Reflect.get(native, "queueConnectionForPostrouteRepair").call(
    native,
    "source_net_altium_pcb_299",
  )
  expect(native.unsolvedConnections.map((t) => t.points)).toEqual(expected)
  expect(
    native.unsolvedConnections.map((t) => Reflect.get(t, "routeEventId")),
  ).toEqual([0, 1])
  const copiedPairNode = structuredClone(actualNet299Node)
  copiedPairNode.portPointsInPairs = copiedPairNode.portPointsInPairs!.map(
    ([start, end]) => [
      { ...start, rootConnectionName: undefined },
      { ...end, rootConnectionName: undefined },
    ],
  )
  const copied = new CachedIntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: copiedPairNode,
  })
  expect(
    copied.unsolvedConnections.map((task) => task.rootConnectionName),
  ).toEqual(["source_net_altium_pcb_299", "source_net_altium_pcb_299"])
  const group = legacy.unsolvedConnections.pop()!
  expect(
    Reflect.get(legacy, "queueExtraBranchesForMultiPointConnection").call(
      legacy,
      group,
    ),
  ).toBe(true)
  expect(legacy.unsolvedConnections).toHaveLength(3)
  const empty = new CachedIntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: { ...legacyNode, portPointsInPairs: [] },
  })
  expect(empty.unsolvedConnections).toEqual([group])
})
