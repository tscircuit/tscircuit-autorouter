import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { ViaPlacement } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("a grown node validates restored world-space via circles against the unchanged board", (): void => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: 9.4, maxX: 10.18, minY: 4.4, maxY: 5.6 }, minBoardEdgeClearance: 0,
    obstacles: [], connections: [{ name: "signal", pointsToConnect: [] }] }
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: srj, boardObstacles: [],
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 })
  const observed: ViaPlacement[] = []
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: { capacityMeshNodeId: "world-node", center: { x: 10, y: 5 },
      width: 0.2, height: 0.2, availableZ: [1, 3], portPoints: [
        { x: 9.9, y: 5, z: 1, connectionName: "signal" },
        { x: 10.1, y: 5, z: 3, connectionName: "signal" }] },
    layerCount: 4, viaDiameter: 0.3, traceWidth: 0.15,
    viaPlacementValidator: (placement, connectionName): boolean => {
      observed.push({ ...placement })
      return validate(placement, connectionName)
    },
  })
  solver.scaleFactor = 2
  solver.growthAttempts = 1
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(observed.length).toBeGreaterThan(0)
  expect(observed.every(({ x, y }) => Math.abs(x - 10) <= 0.101 && Math.abs(y - 5) <= 0.101)).toBe(true)
  expect(validate({ x: 10.1, y: 5, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(false)
  for (const via of solver.solvedRoutes[0]!.vias) {
    expect(validate({ ...via, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(true)
    expect(via.x + 0.15).toBeLessThanOrEqual(srj.bounds.maxX + 1e-9)
  }
  expect(solver.solvedRoutes[0]!.route[0]).toMatchObject({ x: 9.9, y: 5, z: 1 })
  expect(solver.solvedRoutes[0]!.route.at(-1)).toMatchObject({ x: 10.1, y: 5, z: 3 })
})
