import { expect, test } from "bun:test"
import { NativeExploredNodeSet } from "lib/data-structures/NativeExploredNodeSet"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("owned Native bitmap searches preserve every queue and closure step", (): void => {
  for (const offset of [0, -12.37]) {
    for (const targetLayer of [0, 1, 3]) {
      const options = {
        connectionName: "current",
        obstacleRoutes: [
          {
            connectionName: "obstacle",
            traceThickness: 0.1,
            viaDiameter: 0.3,
            route: [
              { x: offset, y: -0.7, z: 0 },
              { x: offset, y: 0.7, z: 0 },
            ],
            vias: [],
          },
        ],
        futureConnections: [
          {
            connectionName: "future",
            points: [
              { x: offset - 0.2, y: 0.4, z: 1 },
              { x: offset + 0.8, y: 0.4, z: 1 },
            ],
          },
        ],
        minDistBetweenEnteringPoints: 0.2,
        bounds: {
          minX: offset - 1,
          maxX: offset + 1,
          minY: -1,
          maxY: 1,
        },
        A: { x: offset - 0.9, y: -0.5, z: 0 },
        B: { x: offset + 0.9, y: 0.5, z: targetLayer },
        availableZ: [0, 1, 3],
        layerCount: 4,
        captureSearchDebug: false,
      }
      const reference = new Native(options)
      const mirrored = new Native({ ...options, nativeExplorationBitmap: true })
      expect(reference.exploredNodes.constructor).toBe(Set)
      expect(mirrored.exploredNodes).toBeInstanceOf(NativeExploredNodeSet)
      while (
        !reference.solved &&
        !reference.failed &&
        reference.iterations < 500
      ) {
        reference.step()
        mirrored.step()
        expect(mirrored.iterations).toBe(reference.iterations)
        expect(mirrored.solved).toBe(reference.solved)
        expect(mirrored.failed).toBe(reference.failed)
        expect(mirrored.error).toBe(reference.error)
        expect([...mirrored.exploredNodes]).toEqual([
          ...reference.exploredNodes,
        ])
        expect(mirrored.candidates).toEqual(reference.candidates)
        expect(mirrored.solvedPath).toEqual(reference.solvedPath)
      }
    }
  }
})
