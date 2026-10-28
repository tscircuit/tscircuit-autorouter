import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  normalizePipeline9NodeRootConnectionNames,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("regional native routing preserves canonical owners when a registered net key is another net's literal ID", (): void => {
  const connMap = new ConnectivityMap({ netA: ["a", "aa"], netB: ["netA", "b"] })
  const raw: NodeWithPortPoints = { capacityMeshNodeId: "namespace-region", center: { x: 0, y: 0 },
    width: 4, height: 4, availableZ: [0, 1], portPoints: [
      { x: -2, y: -1, z: 0, connectionName: "route-a", rootConnectionName: "a" },
      { x: 2, y: -1, z: 0, connectionName: "route-a", rootConnectionName: "a" },
      { x: -2, y: 1, z: 0, connectionName: "route-b", rootConnectionName: "netA" },
      { x: 2, y: 1, z: 0, connectionName: "route-b", rootConnectionName: "netA" },
    ] }
  const canonical = normalizePipeline9NodeRootConnectionNames(raw, connMap)
  expect(canonical.portPoints.map((point) => point.rootConnectionName)).toEqual(["netA", "netA", "netB", "netB"])
  // This valid namespace collision demonstrates why a second resolution is wrong.
  expect(normalizePipeline9NodeRootConnectionNames(canonical, connMap).portPoints[0]!.rootConnectionName).toBe("netB")
  const solver = new Pipeline9RegionalFallbackSolver({ nodeWithPortPoints: canonical, connMap,
    useNativeRouting: true,
    colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1,
    obstacleMargin: 0.1, effort: 0.1, obstacles: [], layerCount: 2, cacheProvider: null })
  expect(solver.highDensitySolver.unsolvedNodePortPoints[0]!.portPoints.map((point) => point.rootConnectionName))
    .toEqual(["netA", "netA", "netB", "netB"])
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(new Set(solver.getOutput().map((route) => route.rootConnectionName))).toEqual(new Set(["netA", "netB"]))
})
