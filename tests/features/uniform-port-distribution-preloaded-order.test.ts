import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("uniform spacing preserves crossing order around retained copper on its layer", (): void => {
  const ports = [0, 3].flatMap((z) =>
    [1.2, 1.8].map((x, i) => ({
      portPointId: `port-${z}-${i}`,
      connectionName: `signal-${z}-${i}`,
      x,
      y: 0,
      z,
    })),
  )
  const nodes: NodeWithPortPoints[] = [-1, 1].map((y, i) => ({
    capacityMeshNodeId: i === 0 ? "lower" : "upper",
    center: { x: 1, y },
    width: 2,
    height: 2,
    availableZ: [0, 3],
    portPoints: ports.map((port) => ({ ...port })),
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0, 3],
    portPoints: ports.map((port) => ({
      ...port,
      connectionNodeIds: ["lower", "upper"],
      distToCentermostPortOnZ: 0,
    })),
  }))
  const preloaded: HighDensityRoute = {
    connectionName: "retained",
    traceThickness: 0.1,
    viaDiameter: 0.45,
    vias: [],
    route: [
      { x: 1, y: -1, z: 3 },
      { x: 1, y: 1, z: 3 },
    ],
  }
  const safePreloaded = {
    ...preloaded,
    route: preloaded.route.map((point) => ({ ...point, x: 0.2 })),
  }
  for (const preloadedRoutes of [[], [preloaded], [safePreloaded]]) {
    const solver = new UniformPortDistributionSolver({
      useLayerAwareGeometry: true,
      layerCount: 4,
      nodeWithPortPoints: nodes,
      inputNodesWithPortPoints: inputNodes,
      obstacles: [],
      preloadedRoutes,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    for (const node of solver.getOutput()) {
      expect(node.portPoints.filter((p) => p.z === 0).map((p) => p.x)).toEqual([
        0.5, 1.5,
      ])
      expect(node.portPoints.filter((p) => p.z === 3).map((p) => p.x)).toEqual(
        preloadedRoutes[0] === preloaded ? [1.2, 1.8] : [0.5, 1.5],
      )
    }
  }
  expect(nodes[0]!.portPoints.map((p) => p.x)).toEqual([1.2, 1.8, 1.2, 1.8])
})
