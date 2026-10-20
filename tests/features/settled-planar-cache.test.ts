import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("planar point cache only retains unexplored grid cells", (): void => {
  for (const endLayer of [0, 1]) {
    const options = {
      connectionName: "signal",
      minDistBetweenEnteringPoints: 0.2,
      bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 },
      A: { x: 0.5, y: 0.5, z: 0 },
      B: { x: 3.5, y: 3.5, z: endLayer },
      traceThickness: 0.1,
      obstacleMargin: 0.1,
      layerCount: 2,
      futureConnections: [],
      obstacleRoutes: [
        {
          connectionName: "obstacle",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          route: [
            { x: 1, y: 2, z: 0 },
            { x: 3, y: 2, z: 0 },
          ],
          vias: [],
        },
      ],
    }
    const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
      options,
    )
    const reference =
      new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(options)
    // Preserve the previous cache-retention policy without changing the search.
    reference.freePlanarObstaclePoints = new Proxy(
      reference.freePlanarObstaclePoints,
      {
        get(target, property): unknown {
          if (property === "delete") return target.has.bind(target)
          if (property === "clear") return target.get.bind(target)
          const value: unknown = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      },
    )
    let observedPendingCache = false
    let referencePeak = 0
    let optimizedPeak = 0
    for (
      let step = 0;
      step < 2000 && !solver.solved && !solver.failed;
      step++
    ) {
      solver.step()
      reference.step()
      expect(reference.solved).toBe(solver.solved)
      expect(reference.failed).toBe(solver.failed)
      expect(solver.solvedPath).toEqual(reference.solvedPath)
      expect(solver.iterations).toBe(reference.iterations)
      observedPendingCache ||= solver.freePlanarObstaclePoints.size > 0
      referencePeak = Math.max(
        referencePeak,
        reference.freePlanarObstaclePoints.size,
      )
      optimizedPeak = Math.max(
        optimizedPeak,
        solver.freePlanarObstaclePoints.size,
      )
      for (const key of solver.freePlanarObstaclePoints.keys()) {
        expect(solver.exploredNodes.has(key)).toBeFalse()
      }
    }
    expect(observedPendingCache).toBeTrue()
    expect(solver.solved).toBeTrue()
    expect(solver.freePlanarObstaclePoints.size).toBe(0)
    expect(reference.freePlanarObstaclePoints.size).toBeGreaterThan(0)
    expect(referencePeak).toBeGreaterThan(optimizedPeak)
  }
})
