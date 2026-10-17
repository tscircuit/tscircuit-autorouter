import { expect, test } from "bun:test"
import { BoundedHighDensityForceImproveSolver } from "lib/solvers/HighDensitySolver/BoundedHighDensityForceImproveSolver"

test("force improvement preserves layer-transition routes and output order", (): void => {
  const protectedRoute = {
    connectionName: "protected",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
    regionId: "transition-node",
  }
  const movableRoute = {
    connectionName: "movable",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 2, y: -0.5, z: 0 },
      { x: 2, y: 0.5, z: 0 },
    ],
    vias: [],
    regionId: "ordinary-node",
  }
  const solver = new BoundedHighDensityForceImproveSolver({
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "transition-node",
        center: { x: 0, y: 0 },
        width: 0.3,
        height: 0.3,
        portPoints: [],
        isLayerTransition: true,
      },
      {
        capacityMeshNodeId: "ordinary-node",
        center: { x: 2, y: 0 },
        width: 2,
        height: 2,
        portPoints: [],
      },
    ],
    hdRoutes: [protectedRoute, movableRoute],
    totalStepsPerNode: 1,
  })
  solver.solve()

  const output = solver.getOutput()
  expect(solver.solved).toBe(true)
  expect(output).toHaveLength(2)
  expect(output[0]).toBe(protectedRoute)
  expect(output[1]!.connectionName).toBe("movable")
  expect(solver.stats.protectedLayerTransitionRouteCount).toBe(1)
})
