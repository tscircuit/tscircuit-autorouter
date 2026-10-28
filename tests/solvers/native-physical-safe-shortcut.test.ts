import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { createNativeSingleRouteSolverWithPhysicalValidation } from "lib/solvers/HighDensitySolver/createNativeSingleRouteSolverWithPhysicalValidation"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("a physically clear simple route keeps the constant-step shortcut and generic Native construction", (): void => {
  const opts: ConstructorParameters<typeof Native>[0] = {
    connectionName: "safe", regionId: "safe-shortcut", A: { x: -2, y: 1, z: 0 }, B: { x: 2, y: 1, z: 0 },
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, minDistBetweenEnteringPoints: 0.1,
    obstacleRoutes: [], futureConnections: [], layerCount: 2, traceThickness: 0.1, viaDiameter: 0.3,
  }
  let checks = 0
  const solver = createNativeSingleRouteSolverWithPhysicalValidation(opts, { traceThickness: 0.1, viaDiameter: 0.3 },
    (route): boolean => {
      checks++
      return arePipeline9NativeRoutesPhysicallyValid({ routes: [route], connMap: new ConnectivityMap({}),
        layerCount: 2, traceClearance: 0.1, viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
        viaToPadClearance: 0.1, boardObstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.4,
          height: 0.4, layers: ["top"], connectedTo: [] }] })
    })
  expect(checks).toBe(1)
  expect(solver.solved).toBeTrue()
  expect(solver.iterations).toBe(0)
  expect(solver.solvedPath!.route).toEqual([opts.A, opts.B])
  const generic = createNativeSingleRouteSolverWithPhysicalValidation(opts, { traceThickness: 0.1, viaDiameter: 0.3 })
  expect(generic.constructor).toBe(Native)
  expect(generic.solvedPath).toEqual(solver.solvedPath)
  expect(solver.MAX_ITERATIONS).toBe(generic.MAX_ITERATIONS)
})
