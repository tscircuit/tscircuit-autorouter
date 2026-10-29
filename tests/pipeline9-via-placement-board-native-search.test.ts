import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("native via search finds space for the full pad away from the original board edge", (): void => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.1,
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 }, minBoardEdgeClearance: 0.1,
    obstacles: [], connections: [{ name: "signal", pointsToConnect: [] }] }
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: srj, boardObstacles: [],
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 })
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "signal", A: { x: 0.1, y: 0.1, z: 1 }, B: { x: 0.9, y: 0.1, z: 3 },
    bounds: srj.bounds, obstacleRoutes: [], minDistBetweenEnteringPoints: 0.8,
    layerCount: 4, availableZ: [1, 3], viaDiameter: 0.3, traceThickness: 0.1,
    viaPlacementValidator: validate, captureSearchDebug: false,
  })
  expect(validate({ x: 0.9, y: 0.1, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(false)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedPath!.vias.length).toBeGreaterThan(0)
  for (const via of solver.solvedPath!.vias) {
    expect(validate({ ...via, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(true)
    expect(Math.min(via.x, via.y, 1 - via.x, 1 - via.y)).toBeGreaterThanOrEqual(0.25 - 1e-9)
  }
  expect(solver.solvedPath!.route[0]).toMatchObject({ x: 0.1, y: 0.1, z: 1 })
  expect(solver.solvedPath!.route.at(-1)).toMatchObject({ x: 0.9, y: 0.1, z: 3 })
})
