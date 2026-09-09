import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("physical via expansion preserves complete search states and order", () => {
  let originalChecks = 0
  let physicalChecks = 0
  const layerSets = [
    [0, 1],
    [0, 3],
    [0, 1, 2, 3],
    [0, 2, 5],
  ]
  for (const availableZ of layerSets) {
    for (const scenario of [0, 1, 2, 3]) {
      const obstacleRoutes: HighDensityIntraNodeRoute[] = []
      if (scenario % 2 !== 0) {
        obstacleRoutes.push({
          connectionName: "obstacle",
          traceThickness: 0.1,
          viaDiameter: 0.2,
          route: [
            { x: 1, y: 0.2, z: 0 },
            { x: 1, y: 1.2, z: 0 },
          ],
          vias: scenario === 3 ? [{ x: 1, y: 1.2 }] : [],
        })
      }
      const futurePoints =
        scenario < 2
          ? [
              { x: 4, y: 4, z: 0 },
              { x: 5, y: 4, z: 0 },
            ]
          : [
              { x: 0.4, y: 1, z: 0 },
              { x: 1.6, y: 1, z: 0 },
            ]
      const opts = {
        connectionName: "route",
        minDistBetweenEnteringPoints: 0.4,
        bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
        A: { x: 0.2, y: 0.2, z: availableZ[0]! },
        B: { x: 1.8, y: 1.8, z: availableZ[availableZ.length - 1]! },
        viaDiameter: 0.2,
        traceThickness: 0.1,
        obstacleMargin: 0.05,
        availableZ,
        layerCount: 6,
        obstacleRoutes,
        futureConnections: [
          {
            connectionName: "future",
            points: futurePoints,
          },
        ],
        hyperParameters: { CELL_SIZE_FACTOR: 1 },
      }
      const control =
        new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(opts)
      const candidate =
        new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
          ...opts,
          viaExpansion: "physical",
        })
      for (const solver of [control, candidate]) {
        const original = solver.isNodeTooCloseToObstacle.bind(solver)
        solver.isNodeTooCloseToObstacle = (...args) => {
          if (args[2]) {
            if (solver === control) originalChecks++
            else physicalChecks++
          }
          return original(...args)
        }
      }
      while (!control.solved && !control.failed) {
        control.step()
        candidate.step()
        expect(candidate.solved).toBe(control.solved)
        expect(candidate.failed).toBe(control.failed)
        expect(candidate.error).toBe(control.error)
        expect(candidate.iterations).toBe(control.iterations)
        expect(candidate.exploredNodes).toEqual(control.exploredNodes)
        expect(candidate.candidates).toEqual(control.candidates)
      }
      expect(control.iterations).toBeGreaterThan(0)
      expect(candidate.solvedPath).toEqual(control.solvedPath)
      expect(candidate.debug_exploredNodesOrdered).toEqual(
        control.debug_exploredNodesOrdered,
      )
      expect(candidate.debug_nodesTooCloseToObstacle).toEqual(
        control.debug_nodesTooCloseToObstacle,
      )
      expect(candidate.debug_nodePathToParentIntersectsObstacle).toEqual(
        control.debug_nodePathToParentIntersectsObstacle,
      )
    }
  }
  expect(physicalChecks).toBeLessThan(originalChecks)
})
