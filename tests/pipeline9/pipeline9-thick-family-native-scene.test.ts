import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints, HighDensityIntraNodeRoute } from "../../lib/types/high-density-types"

test("pending family is invalidated by a later native cell overhang before any family is committed", () => {
  const family: NodeWithPortPoints = { capacityMeshNodeId: "family", center: { x: 0, y: 0 }, width: 10, height: 6,
    portPoints: [-2, 2].flatMap((y, i) => [{ x: -5, y, z: 0, connectionName: `n${i}` }, { x: 5, y, z: 0, connectionName: `n${i}` }]) }
  const native: NodeWithPortPoints = { capacityMeshNodeId: "native", center: { x: 10, y: 0 }, width: 10, height: 6,
    portPoints: [{ x: 8, y: 0, z: 0, connectionName: "native" }, { x: 8, y: 1, z: 1, connectionName: "native" }] }
  const solver = new Pipeline9HighDensitySolver({ enableThickFamilyCompilation: true, nodePortPoints: [native, family], fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: 0.6, traceWidth: 0.2, obstacleMargin: 0.15, effort: 1 })
  const nativeOrder: string[] = []
  // A controlled native-cell test double supplies an overhang. This isolates
  // scheduling from the native engine's choice of a particular geometric route.
  const internal = solver as unknown as { activeNode: NodeWithPortPoints; startRegularSolver(node: NodeWithPortPoints): void; finishActiveNode(routes: HighDensityIntraNodeRoute[]): void }
  internal.startRegularSolver = (node: NodeWithPortPoints): void => {
    nativeOrder.push(node.capacityMeshNodeId)
    internal.activeNode = node
    const routes: HighDensityIntraNodeRoute[] = node.capacityMeshNodeId === "native" ? [{ connectionName: "native", traceThickness: 0.2, viaDiameter: 0.6, vias: [], route: [{ x: 0, y: -3, z: 0 }, { x: 0, y: 3, z: 0 }] }] : []
    internal.finishActiveNode(routes)
  }
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(nativeOrder).toEqual(["native", "family"])
  expect(solver.stats.thickFamilySceneInvalidatedCells).toBe(1)
  expect(solver.stats.thickFamilySolvedCells).toBe(0)
  expect(solver.stats.thickFamilyFinalScenePredicates).toBeGreaterThan(0)
})
