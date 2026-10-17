import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("Pipeline9 cannot introduce vias between disjoint clear layer blocks", (): void => {
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "separate-planes",
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 1.05,
      availableZ: [1, 3, 6],
      portPoints: [
        { x: -0.2, y: 0.28, z: 1, connectionName: "a" },
        { x: 0.2, y: 0.29, z: 1, connectionName: "a" },
        { x: -0.2, y: 0.28, z: 3, connectionName: "b" },
        { x: 0.2, y: 0.29, z: 3, connectionName: "b" },
      ],
    },
    connMap: new ConnectivityMap({}),
    colorMap: {},
    viaDiameter: 0.2032,
    traceWidth: 0.1524,
    minimumTraceWidth: 0.1524,
    obstacleMargin: 0.1,
    effort: 1,
    nodePfById: {},
    obstacles: [],
    layerCount: 8,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.routes).toHaveLength(2)
  for (const route of solver.routes) {
    expect(route.vias).toEqual([])
    expect(new Set(route.route.map((point) => point.z))).toEqual(
      new Set([route.connectionName === "a" ? 1 : 3]),
    )
  }
})
