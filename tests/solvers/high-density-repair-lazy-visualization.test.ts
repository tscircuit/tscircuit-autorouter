import { expect, spyOn, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { HighDensityRepairSolver } from "high-density-repair02"

test("renders completed repair regions only when visualization is requested", (): void => {
  const nodeWithPortPoints: NodeWithPortPoints[] = [0, 1].map((nodeIndex) => ({
    capacityMeshNodeId: `node${nodeIndex}`,
    center: { x: nodeIndex * 4, y: 0 },
    width: 2,
    height: 2,
    portPoints: [
      {
        connectionName: `trace${nodeIndex}`,
        x: nodeIndex * 4 - 0.5,
        y: 0,
        z: 0,
      },
      {
        connectionName: `trace${nodeIndex}`,
        x: nodeIndex * 4 + 0.5,
        y: 0,
        z: 0,
      },
    ],
  }))
  const hdRoutes: HighDensityRoute[] = nodeWithPortPoints.map(
    (node, nodeIndex) => ({
      connectionName: `trace${nodeIndex}`,
      regionId: node.capacityMeshNodeId,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: node.center.x - 0.5, y: 0, z: 0 },
        { x: node.center.x + 0.5, y: 0, z: 0 },
      ],
      vias: [],
    }),
  )
  const visualize = spyOn(HighDensityRepairSolver.prototype, "visualize")

  try {
    const solver = new Pipeline4HighDensityRepairSolver({
      nodeWithPortPoints,
      hdRoutes,
      obstacles: [],
    })
    while (solver.activeSampleIndex === 0 && !solver.failed) solver.step()

    expect(solver.activeSampleIndex).toBe(1)
    expect(solver.solved).toBeFalse()
    expect(visualize).not.toHaveBeenCalled()

    solver.visualize()
    expect(visualize).toHaveBeenCalledTimes(1)
  } finally {
    visualize.mockRestore()
  }
})
