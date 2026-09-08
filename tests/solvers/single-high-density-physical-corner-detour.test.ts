import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("single-route search detours around foreign corner copper between legal terminals", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0.45, y: -0.45 },
        width: 0.4,
        height: 0.4,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.1,
  })
  const terminals = [
    { x: 0.25, y: 0, z: 0 },
    { x: 0, y: -0.25, z: 0 },
  ] as const
  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    for (const [A, B] of [terminals, [terminals[1], terminals[0]]] as const) {
      const solver = new Solver({
        connectionName: "route-net",
        obstacleRoutes: [],
        minDistBetweenEnteringPoints: 0.05,
        bounds: { minX: -0.25, maxX: 0.25, minY: -0.25, maxY: 0.25 },
        A,
        B,
        traceThickness: 0.2,
        obstacleMargin: 0.1,
        availableZ: [0],
        layerCount: 2,
        physicalClearanceContext: {
          traceClearanceIndex: index,
          viaClearanceIndex: index,
          canonicalNetId: "route-net",
          solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
        },
      })
      expect(solver.solved).toBeFalse()
      expect(solver.failed).toBeFalse()
      solver.solve()
      expect(solver.failed).toBeFalse()
      expect(solver.solved).toBeTrue()
      const route = solver.solvedPath
      if (!route) throw new Error("Expected a physically legal solved route")
      expect(route.route[0]).toEqual(A)
      expect(route.route.at(-1)).toEqual(B)
      expect(route.route.length).toBeGreaterThan(2)
      expect(route.vias).toEqual([])
      for (let i = 1; i < route.route.length; i++) {
        expect(
          index.isSegmentClear({
            start: route.route[i - 1]!,
            end: route.route[i]!,
            canonicalNetId: "route-net",
            copperDiameter: route.traceThickness,
          }),
        ).toBeTrue()
      }
    }
  }
})
