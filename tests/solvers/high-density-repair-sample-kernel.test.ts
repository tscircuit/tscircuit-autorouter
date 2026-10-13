import { expect, test } from "bun:test"
import { HighDensityRepairSolver, type DatasetSample } from "high-density-repair02"
import { solveHighDensityRepairSample } from "../../lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"

test("the worker kernel matches the solver wrapper including dense multilayer copper and iterations", (): void => {
  const sample: DatasetSample = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "dense-node",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      portPoints: [],
    },
    nodeHdRoutes: Array.from({ length: 12 }, (_, index) => ({
      connectionName: `trace-${index}`,
      rootConnectionName: `net-${Math.floor(index / 2)}`,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: index * 0.03, diameter: 0.3 }],
      route: [
        { x: -2, y: index * 0.03, z: 0 },
        { x: 0, y: index * 0.03, z: 0 },
        { x: 0, y: index * 0.03, z: 1 },
        { x: 2, y: index * 0.03, z: 1 },
      ],
    })),
    clearanceObstacles: [{ type: "rect", center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.2, zLayers: [0, 1], connectedTo: [] }],
  }
  for (const input of [sample, { ...sample, nodeWithPortPoints: undefined }]) {
    const sequential = new HighDensityRepairSolver({ sample: structuredClone(input), margin: 0.2, repairBoundaryDiagonals: false })
    sequential.solve()
    const actual = solveHighDensityRepairSample({ sample: structuredClone(input), margin: 0.2 })
    expect(sequential.solved).toBe(true)
    expect(actual.iterations).toBe(sequential.iterations)
    expect(JSON.stringify(actual.repairedRoutes)).toBe(JSON.stringify(sequential.getOutput().repairedRoutes))
    for (const key of Object.keys(actual.stats) as (keyof typeof actual.stats)[]) {
      expect(actual.stats[key]).toBe(Number(sequential.stats[key] ?? 0))
    }
  }
})
