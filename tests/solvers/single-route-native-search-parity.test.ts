import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Future } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { referenceGetNeighbors } from "./referenceSingleRouteNeighbors"

test("complete native search retains heap ties, route witnesses, iterations and zero-key behavior", (): void => {
  for (const Solver of [SingleHighDensityRouteSolver, Future]) {
    for (const layerCount of [1, 2, 4, 6]) {
      for (const y of [-0.7, 0, 0.7]) {
        const options = {
          connectionName: "route", rootConnectionName: "root", regionId: "region",
          minDistBetweenEnteringPoints: 0.2, captureSearchDebug: true,
          bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
          A: { x: -1, y, z: 0 }, B: { x: 1, y: -y, z: layerCount - 1 },
          availableZ: Array.from({ length: layerCount }, (_, i) => i), layerCount,
          obstacleRoutes: [{ connectionName: "foreign", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: -0.4, z: 0 }, { x: 0, y: 0.4, z: 0 }], vias: [] }],
          futureConnections: [{ connectionName: "future", points: [{ x: -0.5, y: 0.5, z: 0 }, { x: 0.5, y: 0.5, z: 1 }] }],
        }
        const actual = new Solver(options)
        const reference = new Solver(options)
        reference.getNeighbors = referenceGetNeighbors
        while (!actual.solved && !actual.failed) {
          actual.step()
          reference.step()
          expect(actual.iterations).toBe(reference.iterations)
          expect(actual.solved as boolean).toBe(reference.solved)
          expect(actual.failed as boolean).toBe(reference.failed)
          expect(actual.error).toBe(reference.error)
          expect(actual.candidates.getTopN(8)).toEqual(reference.candidates.getTopN(8))
        }
        expect(actual.solvedPath).toEqual(reference.solvedPath)
        expect(actual.MAX_ITERATIONS).toBe(reference.MAX_ITERATIONS)
        expect(actual.debug_exploredNodesOrdered).toEqual(reference.debug_exploredNodesOrdered)
        expect([...actual.exploredNodes]).toEqual([...reference.exploredNodes])
      }
    }
    const makeZero = (): InstanceType<typeof Solver> => {
      const solver = new Solver({ connectionName: "zero", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.1, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 }, A: { x: 0, y: 0, z: 0 }, B: { x: 1, y: 1, z: 0 }, futureConnections: [{ connectionName: "future", points: [{ x: 0, y: 1, z: 0 }] }] })
      solver.gridMinXIndex = 0
      solver.gridMinYIndex = 0
      return solver
    }
    const actual = makeZero()
    const reference = makeZero()
    reference.getNeighbors = referenceGetNeighbors
    expect(actual.getNodeKey(actual.candidates.peek()!)).toBe(0)
    actual.step()
    reference.step()
    expect(actual.failed).toBe(true)
    expect(actual.error).toBe(reference.error)
    expect(actual.solvedPath).toEqual(reference.solvedPath)
  }
})
