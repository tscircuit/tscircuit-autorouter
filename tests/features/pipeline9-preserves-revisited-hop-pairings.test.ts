import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("revisited logical branches retain exact physical pairs and registered electrical aliases", (): void => {
  const pairs: [PortPoint, PortPoint][] = []
  for (const [name, layers] of [
    ["first", [0, 1]],
    ["second", [0, 1]],
  ] as const) {
    for (const z of layers) {
      pairs.push(
        [-1, 1].map((x) => ({
          connectionName: name,
          rootConnectionName: "signal",
          portPointId: `${x}:${z}`,
          x,
          y: 0,
          z,
        })) as [PortPoint, PortPoint],
      )
    }
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "partial-revisit",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1, 2],
    portPoints: pairs.flat(),
    portPointsInPairs: pairs,
  }
  const connMap = new ConnectivityMap({
    signal: ["first", "second"],
    "signal-alias": ["same-net-alias"],
    foreign: ["first__physical_hop_partial-revisit_0", "unrelated"],
  })
  connMap.addConnections([["first", "same-net-alias"]])
  const originalNetMap = structuredClone(connMap.netMap)
  const originalNode = structuredClone(node)
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap,
    obstacles: [],
    layerCount: 3,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    shareSameNetCopper: true,
  })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.routes).toHaveLength(2)
  expect(solver.routes.every((route) => route.vias.length === 0)).toBe(true)
  const restored = solver.restoreSharedCopperBranches(solver.routes)
  expect(
    restored
      .map((route) => [
        route.connectionName,
        route.route[0]!.z,
        route.route.at(-1)!.z,
      ])
      .sort(),
  ).toEqual([
    ["first", 0, 0],
    ["first", 1, 1],
    ["second", 0, 0],
    ["second", 1, 1],
  ])
  const aliases = solver.routes
    .map((route) => route.connectionName)
    .filter((name) => name !== "first" && name !== "second")
  expect(aliases.length).toBeGreaterThan(0)
  expect(
    aliases.every((name) => solver.connMap.areIdsConnected(name, "first")),
  ).toBe(true)
  expect(solver.connMap.areIdsConnected("unrelated", "first")).toBe(false)
  expect(solver.connMap.getNetConnectedToId("first")).toBe(
    connMap.getNetConnectedToId("first"),
  )
  expect(connMap.netMap).toEqual(originalNetMap)
  expect(node).toEqual(originalNode)
})
