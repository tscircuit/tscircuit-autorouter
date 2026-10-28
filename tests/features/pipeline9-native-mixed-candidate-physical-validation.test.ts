import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { createPipeline9RegularNodeSolverFromCanonicalNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { SimpleRouteJson } from "lib/types/srj-types"
import originalContext from "../fixtures/pipeline9-native-world-guards/cmn42-strict-context-known-search-limitation.json"
import candidate from "../fixtures/pipeline9-native-world-guards/srj24-25-cmn57-promoted-candidate.json"

test("the captured promoted cmn57 candidate cannot publish new copper against a colliding movable replacement", (): void => {
  const connMap = new ConnectivityMap(candidate.connectivityNetMap)
  const routes = candidate.routes as HighDensityRoute[]
  const target = routes.find((r) => r.connectionName === "source_net_altium_pcb_13_mst2")!
  const replacement = routes.find((r) => r.connectionName === "source_net_altium_pcb_14_fixed_6_0")!
  expect(connMap.getNetConnectedToId(target.connectionName)).toBe("connectivity_net6")
  expect(replacement.rootConnectionName).toBe("connectivity_net22")
  expect(connMap.getNetConnectedToId("source_net_altium_pcb_14")).toBe("connectivity_net22")
  const params = {
    ...candidate,
    routes: [target, replacement],
    connMap,
    traceClearance: candidate.obstacleMargin,
    boardObstacles: [],
    viaToPadClearance: 0.1,
  }
  expect(arePipeline9NativeRoutesPhysicallyValid(params)).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: [target], immutableRoutes: [replacement] })).toBeFalse()
  const separated = { ...replacement, route: replacement.route.map((p) => ({ ...p, x: p.x + 5 })), vias: replacement.vias.map((p) => ({ ...p, x: p.x + 5 })) }
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: [target, separated] })).toBeTrue()

  const node = candidate.node as NodeWithPortPoints
  const highDensity = createPipeline9RegularNodeSolverFromCanonicalNode({
    nodeWithPortPoints: node, connMap, colorMap: {}, viaDiameter: 0.3,
    physicalBoardObstacles: originalContext.originalSrj.obstacles as SimpleRouteJson["obstacles"],
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: originalContext.originalSrj as SimpleRouteJson,
      routingConnMap: connMap, derivedRouteAliases: [
        { connectionName: "source_net_altium_pcb_13_mst2", parentConnectionName: "source_net_altium_pcb_13" },
        { connectionName: "source_net_altium_pcb_14_fixed_6_0", parentConnectionName: "source_net_altium_pcb_14" },
        { connectionName: "source_net_altium_pcb_14_fixed_8_0", parentConnectionName: "source_net_altium_pcb_14" },
        { connectionName: "source_net_altium_pcb_17_fixed_2_0", parentConnectionName: "source_net_altium_pcb_17" },
      ] }),
    viaHoleDiameter: candidate.viaHoleDiameter,
    minViaHoleEdgeToViaHoleEdgeClearance: candidate.minViaHoleEdgeToViaHoleEdgeClearance,
    traceWidth: 0.1, obstacleMargin: candidate.obstacleMargin, effort: 1,
    nodePfById: {}, obstacles: [], layerCount: 4, priorityDagSearch: true,
    cacheProvider: null,
  })
  highDensity.step()
  const growShrink = highDensity.activeSubSolver!
  Reflect.set(growShrink, "scaleFactor", 2)
  Reflect.get(growShrink, "createActiveSubSolver").call(growShrink)
  const portfolio = Reflect.get(growShrink, "activeSubSolver") as PortfolioSingleIntraNodeSolver
  const provisional = new IntraNodeRouteSolver({ nodeWithPortPoints: node })
  provisional.solvedRoutes = routes.map((route) => ({
    ...route,
    route: route.route.map((point) => ({ ...point, x: node.center.x + 2 * (point.x - node.center.x), y: node.center.y + 2 * (point.y - node.center.y) })),
    vias: route.vias.map((point) => ({ ...point, x: node.center.x + 2 * (point.x - node.center.x), y: node.center.y + 2 * (point.y - node.center.y) })),
  }))
  provisional.solved = true
  portfolio.solved = true
  portfolio.onSolve({ solver: provisional, hyperParameters: {}, h: 0, g: 0, f: 0 })
  expect(provisional.failed).toBeTrue()
  expect(portfolio.solved).toBeFalse()
  expect(portfolio.stats.physicalCandidateRejectionCount).toBe(1)
  expect(highDensity.routes).toEqual([])
})
