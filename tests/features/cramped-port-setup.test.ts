import { expect, spyOn, test } from "bun:test"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"

test("stepping a cramped-port solver reuses the adjacency index built at construction", (): void => {
  const setup = spyOn(
    MultiTargetNecessaryCrampedPortPointSolver.prototype,
    "_setup",
  )
  try {
    const solver = new MultiTargetNecessaryCrampedPortPointSolver({
      capacityMeshNodes: [],
      sharedEdgeSegments: [],
      simpleRouteJson: {
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        layerCount: 2,
        minTraceWidth: 0.1,
        obstacles: [],
        connections: [],
      },
    })
    expect(setup).toHaveBeenCalledTimes(1)
    solver.step()
    expect(solver.solved).toBe(true)
    expect(setup).toHaveBeenCalledTimes(1)
  } finally {
    setup.mockRestore()
  }
})
