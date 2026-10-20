import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("route search stops expanding after accepting its checked goal connection", (): void => {
  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    const solver = new Solver({
      connectionName: "signal",
      minDistBetweenEnteringPoints: 0.2,
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
      A: { x: 1, y: 1, z: 0 },
      B: { x: 3, y: 1, z: 0 },
      obstacleRoutes: [],
      futureConnections: [
        {
          connectionName: "other",
          points: [{ x: 1, y: 3, z: 0 }, { x: 3, y: 3, z: 0 }],
        },
      ],
    })
    const getNeighbors = solver.getNeighbors.bind(solver)
    let expansions = 0
    solver.getNeighbors = (node: Node): Node[] => {
      expect(solver.solved).toBeFalse()
      expansions++
      return getNeighbors(node)
    }
    solver.solve()

    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(expansions).toBeGreaterThan(0)
    expect(expansions).toBe(solver.iterations - 1)
    expect(solver.solvedPath!.route[0]).toEqual(solver.A)
    expect(solver.solvedPath!.route.at(-1)).toEqual(solver.B)
    expect(solver.solvedPath!.vias).toEqual([])
  }
})
