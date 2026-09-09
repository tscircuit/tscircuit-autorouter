import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("one physical transition preserves destination filtering and clearance", () => {
  for (const scenario of [0, 1, 2, 3]) {
    for (let mask = 0; mask < 64; mask++) {
      const opts = {
        connectionName: "route",
        minDistBetweenEnteringPoints: 0.2,
        bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
        A: { x: 0.2, y: 0.2, z: 0 },
        B: { x: 1.8, y: 1.8, z: 5 },
        obstacleRoutes: [],
        availableZ: [0, 1, 2, 3, 4, 5],
        layerCount: 6,
        futureConnections:
          scenario === 2
            ? [
                {
                  connectionName: "future",
                  points: [
                    { x: 0, y: 1, z: 0 },
                    { x: 2, y: 1, z: 0 },
                  ],
                },
              ]
            : [],
      }
      const control =
        new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(opts)
      const candidate =
        new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
          ...opts,
          viaExpansion: "physical",
        })
      const ancestor = {
        x: 1,
        y: 1,
        z: 1,
        g: 0,
        h: 0,
        f: 0,
        parent: null,
      }
      const node = {
        x: scenario === 1 ? 0.05 : 1,
        y: 1,
        z: 0,
        g: 0,
        h: 0,
        f: 0,
        parent: scenario === 3 ? ancestor : null,
      }
      let candidateViaChecks = 0
      const original = candidate.isNodeTooCloseToObstacle.bind(candidate)
      candidate.isNodeTooCloseToObstacle = (...args) => {
        if (args[2]) candidateViaChecks++
        return original(...args)
      }
      for (let z = 0; z < 6; z++) {
        if ((mask & (1 << z)) === 0) continue
        control.exploredNodes.add(control.getNodeKey({ ...node, z }))
        candidate.exploredNodes.add(candidate.getNodeKey({ ...node, z }))
      }
      expect(candidate.getNeighbors(node)).toEqual(control.getNeighbors(node))
      expect(candidateViaChecks).toBeLessThanOrEqual(1)
      expect(candidate.exploredNodes).toEqual(control.exploredNodes)
      expect(candidate.debug_nodesTooCloseToObstacle).toEqual(
        control.debug_nodesTooCloseToObstacle,
      )
      expect(candidate.debug_nodePathToParentIntersectsObstacle).toEqual(
        control.debug_nodePathToParentIntersectsObstacle,
      )
    }
  }
})
