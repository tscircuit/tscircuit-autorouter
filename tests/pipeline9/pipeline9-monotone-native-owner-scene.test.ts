import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getCanonicalPipeline9PortRoot } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getCanonicalPipeline9PortRoot"
import { doPipeline9RoutesHaveCopperConflict } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../lib/types/high-density-types"

test("final native-scene certificate keeps canonical owners distinct from alias-like root names", () => {
  for (const scenario of ["foreign-alias", "foreign-ordinary", "same-owner"] as const) {
    const connMap = new ConnectivityMap({ connectivity_net0: ["wire", "own-wire"], connectivity_net1: ["other-wire", ...(scenario !== "foreign-ordinary" ? ["connectivity_net0"] : [])] })
    const sameOwner = scenario === "same-owner"
    const nativeConnection = sameOwner ? "own-wire" : "other-wire"
    const nativeRoot = sameOwner ? "connectivity_net0" : "connectivity_net1"
    const family: NodeWithPortPoints = { capacityMeshNodeId: "family", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: [{ x: -2, y: 0, z: 0, connectionName: "wire", rootConnectionName: "connectivity_net0" }, { x: 2, y: 0, z: 0, connectionName: "wire", rootConnectionName: "connectivity_net0" }] }
    // Interior endpoints exclude this native task from the boundary family.
    // Its endpoints clear the deferred family, while its actual wire crosses it.
    const native: NodeWithPortPoints = { capacityMeshNodeId: "native", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: [{ x: 0, y: -1, z: 0, connectionName: nativeConnection, rootConnectionName: nativeRoot }, { x: 0, y: 1, z: 0, connectionName: nativeConnection, rootConnectionName: nativeRoot }] }
    const crossing: HighDensityIntraNodeRoute = { connectionName: nativeConnection, rootConnectionName: nativeRoot, traceThickness: 0.15, viaDiameter: 0.6, vias: [], route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }], regionId: "native" }
    expect(getCanonicalPipeline9PortRoot(crossing, connMap) === getCanonicalPipeline9PortRoot(family.portPoints[0]!, connMap)).toBe(sameOwner)
    const solver = new Pipeline9HighDensitySolver({ enableMonotoneFamilyCompilation: true, nodePortPoints: [native, family], fixedHdRoutes: [], connMap, obstacles: [], layerCount: 2, viaDiameter: 0.6, viaHoleDiameter: 0.3, viaHoleClearance: 0.1, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1 })
    const nativeOrder: string[] = []
    const internal = solver as unknown as { activeNode: NodeWithPortPoints; startRegularSolver(node: NodeWithPortPoints): void; finishActiveNode(routes: HighDensityIntraNodeRoute[]): void }
    internal.startRegularSolver = (node: NodeWithPortPoints): void => {
      nativeOrder.push(node.capacityMeshNodeId)
      // Stop once rejection dispatches the deferred task to native routing.
      // No artificial success or empty native route is supplied for that task.
      if (node.capacityMeshNodeId === "family") return
      internal.activeNode = node
      internal.finishActiveNode([crossing])
    }
    for (let iteration = 0; iteration < 10 && !solver.solved && !solver.failed && !nativeOrder.includes("family"); iteration++) solver.step()
    expect(solver.failed).toBe(false)
    expect(nativeOrder).toEqual(sameOwner ? ["native"] : ["native", "family"])
    expect(solver.stats.monotoneFamilySceneInvalidatedCells).toBe(sameOwner ? 0 : 1)
    expect(solver.stats.monotoneFamilySolvedCells).toBe(sameOwner ? 1 : 0)
    const committed = solver.routes.find((route) => route.connectionName === "wire")
    if (sameOwner) {
      expect(solver.solved).toBe(true)
      expect(committed).toBeDefined()
      expect(doPipeline9RoutesHaveCopperConflict({ left: committed!, right: crossing, clearance: 0.15, layerCount: 2 })).toBe(true)
    } else {
      expect(solver.solved).toBe(false)
      expect(committed).toBeUndefined()
      expect(solver.stats.monotoneFamilyFinalScenePredicates).toBeGreaterThan(0)
    }
  }
})
