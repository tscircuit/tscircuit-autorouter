import { expect, spyOn, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("via neighbors share one broadphase and skip it when all destination layers are explored", (): void => {
  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    const solver = new Solver({
      connectionName: "current",
      minDistBetweenEnteringPoints: 0.1,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      A: { x: -2, y: -2, z: 0 },
      B: { x: 2, y: 2, z: 0 },
      layerCount: 6,
      obstacleRoutes: [
        {
          connectionName: "obstacle",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          route: [
            { x: 1, y: 1, z: 0 },
            { x: 1.5, y: 1.5, z: 0 },
          ],
          vias: [{ x: 1, y: 1 }],
        },
      ],
    })
    const node: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
    const segmentSearch = spyOn(solver.obstacleSegmentIndex!, "search")
    const viaSearch = spyOn(solver.obstacleViaIndex!, "search")
    try {
      const neighbors = solver.getNeighbors(node)
      expect(neighbors.filter((neighbor) => neighbor.z !== node.z)).toHaveLength(
        5,
      )
      expect(segmentSearch).toHaveBeenCalledTimes(1)
      expect(viaSearch).toHaveBeenCalledTimes(9)
      segmentSearch.mockClear()
      for (const z of solver.availableZ) {
        solver.exploredNodes.add(solver.getNodeKey({ ...node, z }))
      }
      expect(
        solver.getNeighbors(node).every((neighbor) => neighbor.z === 0),
      ).toBe(true)
      expect(segmentSearch).not.toHaveBeenCalled()
    } finally {
      segmentSearch.mockRestore()
      viaSearch.mockRestore()
    }
  }
})
