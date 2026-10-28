import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("native search moves a through via clear of a top pad without blocking an inner-layer wire", () => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [{ name: "signal", pointsToConnect: [{ x: -2, y: 0, layer: "inner1", pcb_port_id: "a" }, { x: 2, y: 0, layer: "bottom", pcb_port_id: "b" }] }],
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1, layers: ["top"], connectedTo: ["foreign-pad"] }],
  }
  const validator = getPipeline9ViaPlacementValidator({ boardObstacles: srj.obstacles,
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 })
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "signal", A: { x: -2, y: 0, z: 1 }, B: { x: 2, y: 0, z: 3 },
    bounds: srj.bounds, obstacleRoutes: [], minDistBetweenEnteringPoints: 4,
    layerCount: 4, availableZ: [1, 3], viaDiameter: 0.3, traceThickness: 0.15,
    viaPlacementValidator: validator, captureSearchDebug: false,
  })
  const maximum = solver.MAX_ITERATIONS
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.MAX_ITERATIONS).toBe(maximum)
  expect(solver.solvedPath!.vias.length).toBeGreaterThan(0)
  for (const via of solver.solvedPath!.vias) {
    expect(validator({ ...via, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(true)
  }
  expect(solver.solvedPath!.route[0]).toMatchObject({ x: -2, y: 0, z: 1 })
  expect(solver.solvedPath!.route.at(-1)).toMatchObject({ x: 2, y: 0, z: 3 })
})
