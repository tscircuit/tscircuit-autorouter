import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints, HighDensityIntraNodeRoute } from "../../lib/types/high-density-types"

test("pending family rejects a later native drill that violates the actual hole gap while copper remains separated", () => {
  const family: NodeWithPortPoints = { capacityMeshNodeId: "family", center: { x: 0, y: 0 }, width: 20, height: 6,
    portPoints: [{ x: -10, y: 0, z: 0, connectionName: "family" }, { x: 10, y: 0, z: 1, connectionName: "family" }] }
  const native: NodeWithPortPoints = { capacityMeshNodeId: "native", center: { x: 30, y: 0 }, width: 10, height: 6,
    portPoints: [{ x: 28, y: 0, z: 0, connectionName: "native" }, { x: 28, y: 1, z: 1, connectionName: "native" }] }
  const solver = new Pipeline9HighDensitySolver({ enableMonotoneFamilyCompilation: true, nodePortPoints: [native, family], fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: 0.6, viaHoleDiameter: 0.3, viaHoleClearance: 1.2, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1 })
  const nativeOrder: string[] = []
  // The test double isolates completed-native scene auditing from the native
  // solver's choice of geometry. At distance 1, annuli and wires clear the
  // family, but the requested 1.2 hole-edge gap requires drill distance 1.5.
  const internal = solver as unknown as { activeNode: NodeWithPortPoints; startRegularSolver(node: NodeWithPortPoints): void; finishActiveNode(routes: HighDensityIntraNodeRoute[]): void }
  internal.startRegularSolver = (node: NodeWithPortPoints): void => {
    nativeOrder.push(node.capacityMeshNodeId)
    internal.activeNode = node
    const routes: HighDensityIntraNodeRoute[] = node.capacityMeshNodeId === "native" ? [{ connectionName: "native", traceThickness: 0.15, viaDiameter: 0.6, vias: [{ x: 0, y: 1 }], route: [{ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 1.2, z: 1 }] }] : []
    internal.finishActiveNode(routes)
  }
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(nativeOrder).toEqual(["native", "family"])
  expect(solver.stats.monotoneFamilySceneInvalidatedCells).toBe(1)
  expect(solver.stats.monotoneFamilySolvedCells).toBe(0)
  expect(solver.stats.monotoneFamilyDrillPredicates).toBeGreaterThan(0)
})
