import { expect, spyOn, test } from "bun:test"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("only strictly dominated exact points skip collision checks", (): void => {
  for (const via of [false, true]) {
    for (const mode of ["dominated", "tie", "alias"]) {
      const solver = new SingleHighDensityRouteSolver({
        connectionName: "signal",
        obstacleRoutes: [
          {
            connectionName: "obstacle",
            traceThickness: 0.1,
            viaDiameter: 0.3,
            route: [
              { x: 0, y: -1, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
            vias: [],
          },
        ],
        minDistBetweenEnteringPoints: 0.01,
        bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
        A: { x: -4, y: -4, z: 0 },
        B: { x: 4, y: 4, z: 0 },
        traceThickness: 0.1,
        obstacleMargin: 0.1,
        viaDiameter: 0.3,
        availableZ: [0, 1],
      })
      const parent: Node = {
        x: 2,
        y: 2,
        z: 0,
        g: 10,
        h: 0,
        f: 10,
        parent: solver.candidates.peek(),
      }
      const target: Node = {
        x: via ? parent.x : parent.x + solver.cellStep,
        y: parent.y,
        z: via ? 1 : 0,
        g: 0,
        h: 0,
        f: 0,
        parent,
      }
      solver.setNodeCosts(target)
      const queued: Node = {
        ...target,
        x: target.x + (mode === "alias" ? 1e-12 : 0),
        f: target.f - (mode === "tie" ? 0 : 1),
      }
      const getNeighbors = solver.getNeighbors.bind(solver)
      solver.getNeighbors = (): Node[] => [queued]
      solver.step()
      solver.getNeighbors = getNeighbors
      const collisions = spyOn(solver, "isNodeTooCloseToObstacle")
      const scoring = spyOn(solver, "setNodeCosts")
      const neighbors = solver.getNeighbors(parent)
      const matches = (node: Node): boolean =>
        node.x === target.x && node.y === target.y && node.z === target.z
      expect(neighbors.some(matches)).toBe(mode !== "dominated")
      expect(collisions.mock.calls.some(([node]) => matches(node))).toBe(
        mode !== "dominated",
      )
      expect(
        scoring.mock.calls.filter(([node]) => matches(node)),
      ).toHaveLength(1)
      collisions.mockRestore()
      scoring.mockRestore()
    }
  }
})
