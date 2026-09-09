import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

class IndependentQuerySolver extends SingleHighDensityRouteSolver {
  override getNeighborObstacleQuery(): undefined {
    return undefined
  }
}

test("shared neighbor queries preserve exact wire and via collision decisions", (): void => {
  for (const offset of [0, -17.3, 52.8]) {
    const options: ConstructorParameters<
      typeof SingleHighDensityRouteSolver
    >[0] = {
      connectionName: "routed-net",
      minDistBetweenEnteringPoints: 0.2,
      bounds: {
        minX: offset,
        maxX: offset + 2,
        minY: offset,
        maxY: offset + 2,
      },
      A: { x: offset, y: offset + 0.2, z: 0 },
      B: { x: offset + 2, y: offset + 1.8, z: 0 },
      traceThickness: 0.15,
      obstacleMargin: 0.1,
      layerCount: 3,
      availableZ: [0, 1, 2],
      obstacleRoutes: [
        {
          connectionName: "foreign-wire",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          route: [
            { x: offset + 0.6, y: offset + 0.4, z: 0 },
            { x: offset + 0.6, y: offset + 1.6, z: 0 },
          ],
          vias: [],
        },
        {
          connectionName: "foreign-via",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          route: [
            { x: offset + 1.3, y: offset + 1.1, z: 0 },
            { x: offset + 1.3, y: offset + 1.1, z: 2 },
          ],
          vias: [{ x: offset + 1.3, y: offset + 1.1 }],
        },
      ],
    }
    const shared = new SingleHighDensityRouteSolver(options)
    const independent = new IndependentQuerySolver(options)
    for (const z of [0, 1, 2]) {
      for (const x of [-0.7, 0, 0.25, 0.4, 0.85, 1.05, 1.55, 2, 2.7]) {
        for (const y of [-0.7, 0, 0.2, 0.65, 1.1, 1.35, 1.8, 2, 2.7]) {
          const node: Node = {
            x: offset + x,
            y: offset + y,
            z,
            g: 0,
            h: 0,
            f: 0,
            parent: null,
          }
          shared.exploredNodes.clear()
          independent.exploredNodes.clear()
          expect(shared.getNeighbors(node)).toEqual(
            independent.getNeighbors(node),
          )
        }
      }
    }
  }
})
