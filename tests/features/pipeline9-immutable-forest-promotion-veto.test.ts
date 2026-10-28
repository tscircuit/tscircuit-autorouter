import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("immutable forests cannot be promoted or hidden by a coarse rounded owner exemption", (): void => {
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [
      { name: "foreign", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "foreign-port" }] },
      { name: "forest", pointsToConnect: [{ x: 0.004, y: 0, layer: "top", pcb_port_id: "forest-port" }] },
    ] }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  expect(connMap.getNetConnectedToId("forest")).toBe(connMap.getNetConnectedToId("foreign"))
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj: srj, routingConnMap: connMap })
  const ports = [{ x: -1, y: 0, z: 0, connectionName: "foreign" }, { x: 1, y: 0, z: 0, connectionName: "foreign" }]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "immutable-forest-veto", center: { x: 0, y: 0 },
    width: 2.2, height: 2.2, availableZ: [0], portPoints: ports, portPointsInPairs: [[ports[0]!, ports[1]!]] }
  const fixed = { connectionName: "forest", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0.004, z: 0 }, { x: 1, y: 0.004, z: 0 }], vias: [], preloadedTraceIndex: 0, preloadedRouteIndex: 0 }
  const solver = new Pipeline9HighDensitySolver({ useNativeRegionalRouting: true, nodePortPoints: [],
    fixedHdRoutes: [fixed], immutablePreloadedTraceIndices: [0], connMap, physicalOwnership, physicalBoardObstacles: srj.obstacles,
    obstacles: [], layerCount: 2, viaDiameter: 0.3, viaHoleDiameter: 0.15,
    traceWidth: 0.1, obstacleMargin: 0.15, physicalTraceClearance: 0.1, effort: 0.1, cacheProvider: null })
  solver.activeNode = node
  expect(() => Reflect.get(solver, "startRegionalFallback").call(solver, new Set(["forest"])))
    .toThrow('cannot promote immutable preloaded route "forest"')
  Reflect.get(solver, "startRegionalFallback").call(solver)
  const candidate: HighDensityRoute = { connectionName: "foreign", traceThickness: 0.1, viaDiameter: 0.3,
    route: ports, vias: [] }
  expect(solver.activeFallbackSolver!.highDensitySolver.solutionValidator!([candidate])).toBeFalse()
  solver.activeFallbackSolver!.getOutput = (): HighDensityRoute[] => [candidate]
  Reflect.get(solver, "finishRegionalFallback").call(solver)
  expect(solver.failed).toBeTrue()
  expect(solver.error).toBe("Pipeline9 regional fallback conflicts with immutable preloaded route(s): forest")
  expect(solver.fixedRouteReplacements.size).toBe(0)
  expect(solver.stats.promotedFallbackAttemptCount).toBe(0)
  expect(solver.getUpdatedFixedHdRoutes()).toEqual([fixed])
  solver.fixedRouteReplacements.set("forest", { ...fixed, route: ports })
  expect(() => solver.getUpdatedFixedHdRoutes()).toThrow('attempted to mutate immutable preloaded route "forest"')
})
